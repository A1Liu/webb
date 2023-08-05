// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use lazy_static::lazy_static;
use serde::Serialize;
use std::collections::HashMap;
use std::process::Stdio;
use std::sync::atomic::AtomicBool;
use std::sync::{atomic::Ordering, Arc};
use tokio::io::AsyncReadExt;
use tokio::process::Command;
use tokio::sync::Mutex;
use uuid::Uuid;

struct RunningCommand {
    uuid: Uuid,
    exit_status: Option<CommandStatus>,
    channel: Option<tokio::sync::mpsc::Receiver<CommandData>>,
    kill: Option<tokio::sync::oneshot::Sender<()>>,
}

lazy_static! {
// TODO: will this be a bottleneck?
static ref RUNNING_COMMANDS: Mutex<HashMap<String, RunningCommand>> =
    Mutex::new(HashMap::new());
}

#[derive(Serialize, Clone, Copy)]
pub struct CommandStatus {
    pub success: bool,
    pub exit_code: Option<i32>,
}

#[derive(Serialize)]
pub struct CommandOutput {
    pub end: bool,
    pub status: Option<CommandStatus>,
    pub data: Vec<CommandData>,
}

#[derive(Serialize, Clone)]
pub enum CommandData {
    Status(CommandStatus),
    Stdout(String),
    Stderr(String),
}

#[tauri::command]
async fn poll_command(id: String, command_id: Uuid) -> Result<CommandOutput, String> {
    println!("running poll_command");

    let (mut channel, mut status, first) = loop {
        let mut commands = RUNNING_COMMANDS.lock().await;
        let command = commands.get_mut(&id).ok_or("command doesn't exist")?;

        if command_id != command.uuid {
            return Ok(CommandOutput {
                status: None,
                data: Vec::new(),
                end: true,
            });
        }

        let mut channel = command
            .channel
            .take()
            .ok_or("multiple concurrent consumers")?;

        tokio::select! {
            s = channel.recv() => break (channel, command.exit_status, s),
            _ = tokio::time::sleep(std::time::Duration::from_millis(100)) => {}
        }

        command.channel = Some(channel);
    };

    let mut data = Vec::new();
    match first {
        Some(CommandData::Status(s)) => status = Some(s),
        Some(item) => data.push(item),
        None => {
            return Ok(CommandOutput {
                status,
                data,
                end: true,
            })
        }
    }

    while data.len() < 25 {
        use tokio::sync::mpsc::error::TryRecvError::*;
        match channel.try_recv() {
            Err(Disconnected) => {
                return Ok(CommandOutput {
                    status,
                    data,
                    end: true,
                })
            }
            Err(Empty) => break,
            Ok(CommandData::Status(s)) => status = Some(s),
            Ok(d) => data.push(d),
        }
    }

    let mut commands = RUNNING_COMMANDS.lock().await;
    let command = commands.get_mut(&id).ok_or("command doesn't exist")?;
    if command.uuid == command_id {
        command.exit_status = status;
        command.channel = Some(channel);
    }

    return Ok(CommandOutput {
        status,
        data,
        end: false,
    });
}

#[tauri::command]
async fn run_zsh(id: String, command: String) -> Uuid {
    println!("running zsh");

    let mut child = Command::new("zsh")
        .arg("-c")
        .arg(&command)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("failed to spawn process");

    let stdin = child.stdin.take().expect("Failed to open stdin");
    let stdout = child.stdout.take().expect("Failed to open stdin");
    let stderr = child.stderr.take().expect("Failed to open stdin");

    // Stdin should auto-close for now
    std::mem::drop(stdin);

    let (send_kill, recv_kill) = tokio::sync::oneshot::channel::<()>();
    let (tx, rx) = tokio::sync::mpsc::channel(128);
    let done = Arc::new(std::sync::atomic::AtomicBool::new(false));

    let txstat = tx.clone();
    let donestat = done.clone();

    async fn consume_to_channel(
        done: Arc<AtomicBool>,
        mut pipe: impl Unpin + AsyncReadExt,
        tx: tokio::sync::mpsc::Sender<CommandData>,
    ) {
        let mut bytes = Vec::with_capacity(128);

        loop {
            if tx.is_closed() {
                break;
            }

            let len = match pipe.read_buf(&mut bytes).await {
                Ok(len) => len,
                Err(e) => {
                    println!("e: {:?}", e);
                    continue;
                }
            };

            if len == 0 {
                if done.load(Ordering::SeqCst) {
                    break;
                }

                tokio::time::sleep(std::time::Duration::from_millis(1)).await;
                continue;
            }

            // TODO: should not do string conversion here
            let line = String::from_utf8_lossy(&bytes).into_owned();
            tx.send(CommandData::Stdout(line)).await.expect("wtf");
            bytes.clear();
        }
    }

    tokio::spawn(consume_to_channel(done.clone(), stdout, tx.clone()));
    tokio::spawn(consume_to_channel(done.clone(), stderr, tx.clone()));

    tokio::spawn(async move {
        let status = tokio::select! {
            status_res = child.wait() => {
                Some(status_res.expect("child process encountered an error"))
            }
            _ = recv_kill => {
                child.kill().await.expect("kill failed");
                println!("actually sent kill signal");

                donestat.store(true, Ordering::SeqCst);

                None
            }
        };

        let status = match status {
            Some(s) => s,
            None => return,
        };

        txstat
            .send(CommandData::Status(CommandStatus {
                success: status.success(),
                exit_code: status.code(),
            }))
            .await
            .expect("wtf");

        // TODO: too lazy to think about acq rel order right now
        donestat.store(true, Ordering::SeqCst);
    });

    let mut commands = RUNNING_COMMANDS.lock().await;
    let uuid = Uuid::new_v4();
    if let Some(RunningCommand {
        exit_status,
        kill: Some(kill),
        ..
    }) = commands.insert(
        id,
        RunningCommand {
            uuid,
            exit_status: None,
            channel: Some(rx),
            kill: Some(send_kill),
        },
    ) {
        match exit_status {
            None => {
                // If the kill message can't be sent, it means the receiver doesn't
                // exist, which *should* mean the process doesn't exist anymore anyways
                let _ = kill.send(());
                println!("killed process");
            }
            Some(_) => {}
        }
    }

    return uuid;
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![run_zsh, poll_command])
        .run(tauri::generate_context!())
        .expect("error while running webb");
}
