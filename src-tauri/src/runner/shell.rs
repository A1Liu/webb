use super::{RunCtx, RunId, RunStatus, Runnable, RunnableIO, Runner};
use lazy_static::lazy_static;
use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicU8};
use std::sync::Mutex;
use std::sync::{atomic::Ordering, Arc};
use std::time::Duration;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite};
use tokio::process::{Child, Command as OsCommand};
use uuid::Uuid;

#[derive(Deserialize, Debug, Clone, Type)]
pub struct ShellConfig {
    pub command: String,
    pub working_directory: String,
}

#[derive(Debug)]
pub struct ShellCommand {
    command: String,
    working_directory: PathBuf,
    status: RunStatus,
    kill: Mutex<Option<tokio::sync::oneshot::Sender<()>>>,
}

impl ShellCommand {
    pub async fn new(config: ShellConfig) -> Result<(Self, RunnableIO), String> {
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

        let (send_kill, recv_kill) = tokio::sync::oneshot::channel::<()>();

        let sel = Self {
            command,
            working_directory,
            status: RunStatus::new(),
            kill: Mutex::new(Some(send_kill)),
        };

        let io = RunnableIO::new(child.stdin.take(), child.stdout.take(), child.stderr.take());

        tokio::spawn(Self::wait_for_child(sel.status.clone(), recv_kill, child));

        return Ok((sel, io));
    }

    async fn wait_for_child(
        status: RunStatus,
        recv_kill: tokio::sync::oneshot::Receiver<()>,
        mut child: Child,
    ) {
        let exit_status = tokio::select! {
            status_res = child.wait() => {
                Some(status_res.expect("waiting on child process encountered an error"))
            }
            _ = recv_kill => {
                match child.kill().await {
                    Ok(()) => {},
                    Err(e) => println!("error killing child: {:?}",e),
                }

                println!("actually sent kill signal");

                status.failure();

                None
            }
        };

        match exit_status {
            Some(exit) => {
                if exit.success() {
                    status.success()
                } else {
                    status.failure()
                }
            }
            None => return,
        }
    }
}

impl Runnable for ShellCommand {
    fn is_done(&self) -> bool {
        return self.status.is_done();
    }

    fn kill(&self) {
        let kill = match self.kill.lock().unwrap().take() {
            Some(k) => k,
            None => return,
        };

        kill.send(()).unwrap();
    }

    fn is_successful(&self) -> Option<bool> {
        return self.status.is_successful();
    }
}
