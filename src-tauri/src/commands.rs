use lazy_static::lazy_static;
use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::AtomicBool;
use std::sync::Mutex;
use std::sync::{atomic::Ordering, Arc};
use std::time::Duration;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite};
use tokio::process::{Child, Command as OsCommand};
use uuid::Uuid;

pub struct RunnableIO {
    pub stdin: Option<Box<dyn AsyncWrite>>,
    pub stdout: Option<Box<dyn AsyncRead>>,
    pub stderr: Option<Box<dyn AsyncRead>>,
}

pub trait Runnable: Sized + core::fmt::Debug {
    fn new(input: String) -> (Self, RunnableIO);
}

#[derive(Clone, Debug, Deserialize, Type)]
pub struct CommandConfig {
    pub command: String,
    pub working_directory: String,
}

#[derive(Clone, Copy, PartialOrd, Hash, PartialEq, Eq, Serialize, Deserialize, Debug, Type)]
#[repr(transparent)]
pub struct CommandId(Uuid);

#[derive(Serialize, Debug, Clone, Copy, Type)]
pub struct CommandStatus {
    pub success: bool,
    pub exit_code: Option<i32>,
}

#[derive(Serialize, Type)]
pub struct CommandOutput {
    pub end: bool,
    pub status: Option<CommandStatus>,
    pub data: Vec<CommandData>,
}

#[derive(Serialize, Clone, Type)]
#[serde(tag = "kind", content = "value")]
pub enum CommandData {
    Status(CommandStatus),
    Stdout(String),
    Stderr(String),
}

pub struct Command {
    id: CommandId,
    command: String,

    working_directory: PathBuf,

    // I'd like to not have to ARC everything, but for now, there's a lot of running
    // tasks that needs shared references to synchronization variables, and this
    // seems to be the most reasonable way to implement that.
    done: Arc<AtomicBool>,

    channel: tokio::sync::mpsc::Receiver<CommandData>,
    exit_status: Option<CommandStatus>,
    kill: Option<tokio::sync::oneshot::Sender<()>>,
}

impl std::fmt::Debug for Command {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Command")
            .field("id", &self.id)
            .field("command", &self.command)
            .field("exit_status", &self.exit_status)
            .field("done", &self.done.load(Ordering::SeqCst))
            .finish()
    }
}

impl Command {
    pub async fn new(config: CommandConfig) -> Result<Self, String> {
        let command = config.command;
        let working_directory = tokio::fs::canonicalize(config.working_directory)
            .await
            .map_err(|e| "invalid working directory")?;

        let mut child = OsCommand::new("zsh")
            .arg("-c")
            .arg(&command)
            .current_dir(&working_directory)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|_| format!("failed to create command: {}", command))?;

        let stdin = child.stdin.take().ok_or("Failed to open stdin")?;
        let stdout = child.stdout.take().ok_or("Failed to open stdin")?;
        let stderr = child.stderr.take().ok_or("Failed to open stdin")?;

        std::mem::drop(stdin);

        let id = CommandId(Uuid::new_v4());
        let (send_kill, recv_kill) = tokio::sync::oneshot::channel::<()>();
        let (tx, rx) = tokio::sync::mpsc::channel(128);

        let sel = Self {
            id,
            command,
            working_directory,
            done: Arc::new(AtomicBool::new(false)),
            exit_status: None,
            channel: rx,
            kill: Some(send_kill),
        };

        tokio::spawn(Self::pipe_to_channel(
            sel.done.clone(),
            tx.clone(),
            stdout,
            CommandData::Stdout,
        ));
        tokio::spawn(Self::pipe_to_channel(
            sel.done.clone(),
            tx.clone(),
            stderr,
            CommandData::Stderr,
        ));
        tokio::spawn(Self::wait_for_child(
            sel.done.clone(),
            tx.clone(),
            recv_kill,
            child,
        ));

        return Ok(sel);
    }

    async fn pipe_to_channel(
        done: Arc<AtomicBool>,
        tx: tokio::sync::mpsc::Sender<CommandData>,
        mut pipe: impl Unpin + AsyncReadExt,
        func: fn(String) -> CommandData,
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
            tx.send(func(line)).await.expect("wtf");
            bytes.clear();
        }
    }

    async fn wait_for_child(
        done: Arc<AtomicBool>,
        tx: tokio::sync::mpsc::Sender<CommandData>,
        recv_kill: tokio::sync::oneshot::Receiver<()>,
        mut child: Child,
    ) {
        let status = tokio::select! {
            status_res = child.wait() => {
                Some(status_res.expect("waiting on child process encountered an error"))
            }
            _ = recv_kill => {
                match child.kill().await {
                    Ok(_) => {}
                    Err(e) => println!("error killing child: {:?}",e),
                }

                println!("actually sent kill signal");

                done.store(true, Ordering::SeqCst);

                None
            }
        };

        let status = match status {
            Some(s) => s,
            None => return,
        };

        tx.send(CommandData::Status(CommandStatus {
            success: status.success(),
            exit_code: status.code(),
        }))
        .await
        .expect("wtf");

        // TODO: too lazy to think about acq rel order right now
        done.store(true, Ordering::SeqCst);
    }

    pub fn kill(&mut self) {
        if let Some(kill) = self.kill.take() {
            // If the kill message can't be sent, it means the receiver doesn't
            // exist, which *should* mean the process doesn't exist anymore anyways
            let _ = kill.send(());
        }
    }

    pub async fn poll(&mut self, timeout: Duration) -> CommandOutput {
        let first = tokio::select! {
            s = self.channel.recv() => s,
            _ = tokio::time::sleep(timeout) => return CommandOutput {
                status: self.exit_status,
                data: Vec::new(),
                end: self.done.load(Ordering::SeqCst),
            },
        };

        let mut data = Vec::new();
        match first {
            Some(CommandData::Status(s)) => self.exit_status = Some(s),
            Some(item) => data.push(item),
            None => {
                return CommandOutput {
                    status: self.exit_status,
                    data,
                    end: self.done.load(Ordering::SeqCst),
                }
            }
        }

        while data.len() < 25 {
            use tokio::sync::mpsc::error::TryRecvError::*;
            match self.channel.try_recv() {
                Err(Disconnected) => {
                    return CommandOutput {
                        data,
                        status: self.exit_status,
                        end: self.done.load(Ordering::SeqCst),
                    }
                }
                Err(Empty) => break,
                Ok(CommandData::Status(s)) => self.exit_status = Some(s),
                Ok(d) => data.push(d),
            }
        }

        return CommandOutput {
            data,
            status: self.exit_status,
            end: self.done.load(Ordering::SeqCst),
        };
    }

    pub fn id(&self) -> CommandId {
        return self.id;
    }
}
