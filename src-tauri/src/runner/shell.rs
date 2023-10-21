use crate::runner::{RunId, Runnable, RunnableIO, Runner};
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

#[derive(Debug, Clone)]
pub struct ShellConfig {
    pub command: String,
    pub working_directory: String,
}

#[derive(Debug)]
pub struct ShellCommand {
    command: String,
    working_directory: PathBuf,

    // I'd like to not have to ARC everything, but for now, there's a lot of running
    // tasks that needs shared references to synchronization variables, and this
    // seems to be the most reasonable way to implement that.
    done: Arc<AtomicU8>,

    kill: Mutex<Option<tokio::sync::oneshot::Sender<()>>>,
}

impl ShellCommand {
    const NOT_DONE: u8 = 0;
    const SUCCESS: u8 = 1;
    const FAIL: u8 = 2;

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
            done: Arc::new(AtomicU8::new(Self::NOT_DONE)),
            kill: Mutex::new(Some(send_kill)),
        };

        let io = RunnableIO::new(child.stdin.take(), child.stdout.take(), child.stderr.take());

        tokio::spawn(Self::wait_for_child(sel.done.clone(), recv_kill, child));

        return Ok((sel, io));
    }

    async fn wait_for_child(
        done: Arc<AtomicU8>,
        recv_kill: tokio::sync::oneshot::Receiver<()>,
        mut child: Child,
    ) {
        let status = tokio::select! {
            status_res = child.wait() => {
                Some(status_res.expect("waiting on child process encountered an error"))
            }
            _ = recv_kill => {
                match child.kill().await {
                    Ok(()) => {},
                    Err(e) => println!("error killing child: {:?}",e),
                }

                println!("actually sent kill signal");

                done.store(Self::FAIL, Ordering::SeqCst);

                None
            }
        };

        let status = match status {
            Some(status) => {
                if status.success() {
                    Self::SUCCESS
                } else {
                    Self::FAIL
                }
            }
            None => return,
        };

        // TODO: too lazy to think about acq rel order right now
        done.store(status, Ordering::SeqCst);
    }
}

impl Runnable for ShellCommand {
    fn is_done(&self) -> bool {
        return self.done.load(Ordering::SeqCst) != Self::NOT_DONE;
    }

    fn kill(&self) {
        let kill = match self.kill.lock().unwrap().take() {
            Some(k) => k,
            None => return,
        };

        kill.send(()).unwrap();
    }

    fn is_successful(&self) -> Option<bool> {
        let done = self.done.load(Ordering::SeqCst);
        match done {
            Self::SUCCESS => return Some(true),
            Self::FAIL => return Some(false),
            _ => return None,
        }
    }
}
