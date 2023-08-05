// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use lazy_static::lazy_static;
use serde::Serialize;
use std::collections::HashMap;
use std::process::Stdio;
use std::sync::{atomic::Ordering, Arc};
use tokio::io::AsyncReadExt;
use tokio::process::Command;
use tokio::sync::Mutex;

struct RunningCommand {
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
async fn poll_command(id: String) -> Result<CommandOutput, String> {
    let (mut channel, mut status) = {
        let mut commands = RUNNING_COMMANDS.lock().await;
        let command = commands.get_mut(&id).ok_or("command doesn't exist")?;

        let channel = command
            .channel
            .take()
            .ok_or("multiple concurrent consumers")?;

        (channel, command.exit_status)
    };

    let mut data = Vec::new();
    match channel.recv().await {
        Some(CommandData::Status(s)) => status = Some(s),
        Some(item) => data.push(item),
        None => return Ok(CommandOutput { status, data }),
    }

    while data.len() < 25 {
        use tokio::sync::mpsc::error::TryRecvError::*;
        match channel.try_recv() {
            Err(Disconnected) => return Ok(CommandOutput { status, data }),
            Err(Empty) => break,
            Ok(CommandData::Status(s)) => status = Some(s),
            Ok(d) => data.push(d),
        }
    }

    let mut commands = RUNNING_COMMANDS.lock().await;
    let command = commands.get_mut(&id).ok_or("command doesn't exist")?;
    command.exit_status = status;
    command.channel = Some(channel);

    return Ok(CommandOutput { status, data });
}

#[tauri::command]
async fn run_zsh(id: String, command: String) {
    let mut child = Command::new("zsh")
        .arg("-c")
        .arg(&command)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("failed to spawn process");

    let (send_kill, recv_kill) = tokio::sync::oneshot::channel::<()>();

    // Stdin should auto-close for now
    let stdin = child.stdin.take().expect("Failed to open stdin");
    std::mem::drop(stdin);

    let stdout = child.stdout.take().expect("Failed to open stdin");
    let stderr = child.stderr.take().expect("Failed to open stdin");

    let (txout, rx) = tokio::sync::mpsc::channel(128);
    let txerr = txout.clone();
    let txstat = txout.clone();
    let done = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let doneerr = done.clone();
    let donestat = done.clone();
    let doneout = done.clone();

    tokio::spawn(async move {
        let mut bytes = vec![0u8; 128];
        let done = doneout;
        let tx = txout;
        let mut pipe = stdout;

        loop {
            let len = match pipe.read(&mut bytes).await {
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

                continue;
            }

            // TODO: should not do string conversion here
            let line = String::from_utf8_lossy(&bytes[..len]).into_owned();
            tx.send(CommandData::Stdout(line)).await.expect("wtf");
        }
    });

    tokio::spawn(async move {
        let mut bytes = vec![0u8; 128];
        let done = doneerr;
        let tx = txerr;
        let mut pipe = stderr;

        loop {
            let len = match pipe.read(&mut bytes).await {
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

                continue;
            }

            // TODO: should not do string conversion here
            let line = String::from_utf8_lossy(&bytes[..len]).into_owned();
            tx.send(CommandData::Stderr(line)).await.expect("wtf");
        }
    });

    tokio::spawn(async move {
        let status = tokio::select! {
            status_res = child.wait() => {
                Some(status_res.expect("child process encountered an error"))
            }
            _ = recv_kill => {
                child.kill().await.expect("kill failed");
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
    if let Some(RunningCommand {
        exit_status,
        kill: Some(kill),
        ..
    }) = commands.insert(
        id,
        RunningCommand {
            exit_status: None,
            channel: Some(rx),
            kill: Some(send_kill),
        },
    ) {
        match exit_status {
            None => {
                kill.send(()).expect("failed to kill child process");
                println!("killed process");
            }
            Some(_) => {}
        }
    }
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![run_zsh, poll_command])
        .run(tauri::generate_context!())
        .expect("error while running webb");
}
