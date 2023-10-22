use super::{RunCtx, RunId, RunStatus, Runnable, Runner};
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
}

impl ShellCommand {
    pub async fn new(config: ShellConfig) -> Result<Self, String> {
        let command = config.command;
        let working_directory = tokio::fs::canonicalize(&config.working_directory)
            .await
            .map_err(|e| {
                println!(
                    "canonicalize error for {:?}: {:?}",
                    config.working_directory, e
                );
                return "invalid working directory";
            })?;

        return Ok(Self {
            command,
            working_directory,
            status: RunStatus::new(),
        });
    }

    async fn wait_for_child(
        status: RunStatus,
        mut recv_kill: tokio::sync::mpsc::Receiver<()>,
        mut child: Child,
    ) {
        let exit_status = tokio::select! {
            status_res = child.wait() => {
                Some(status_res.expect("waiting on child process encountered an error"))
            }
            _ = recv_kill.recv() => {
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
    fn start(self: Arc<ShellCommand>, mut ctx: RunCtx) {
        let child_res = OsCommand::new("zsh")
            .arg("-c")
            .arg(&self.command)
            .current_dir(&self.working_directory)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn();

        let mut child = match child_res {
            Ok(c) => c,
            Err(e) => {
                println!("failed to create command: {}", &self.command);
                self.status.failure();
                return;
            }
        };

        if let Some(stdout) = child.stdout.take() {
            ctx.pipe_to_stdout(self.clone(), stdout);
        }
        if let Some(stderr) = child.stderr.take() {
            ctx.pipe_to_stderr(self.clone(), stderr);
        }

        tokio::spawn(Self::wait_for_child(
            self.status.clone(),
            ctx.take_kill_receiver(),
            child,
        ));
    }

    fn is_done(&self) -> bool {
        return self.status.is_done();
    }

    fn is_successful(&self) -> Option<bool> {
        return self.status.is_successful();
    }
}
