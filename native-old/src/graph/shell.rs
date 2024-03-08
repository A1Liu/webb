use super::*;
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
    pub working_directory: PathBuf,
}

#[derive(Debug)]
pub struct ShellCommand {
    command: String,
    working_directory: PathBuf,
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
        });
    }

    async fn wait_for_child(ctx: Arc<RunCtx>, mut child: Child) {
        let kill_ctx = ctx.clone();
        let exit_status = tokio::select! {
            status_res = child.wait() => {
                Some(status_res.expect("waiting on child process encountered an error"))
            }
            _ = kill_ctx.wait_for_kill_signal() => {
                match child.kill().await {
                    Ok(()) => {},
                    Err(e) => println!("error killing child: {:?}",e),
                }

                println!("actually sent kill signal");

                ctx.set_status(RunStatus:: Error("Killed process".to_string()));

                None
            }
        };

        match exit_status {
            Some(exit) => {
                if exit.success() {
                    ctx.set_status(RunStatus::Success);
                } else {
                    ctx.set_status(RunStatus::Error("process failed".to_string()));
                }
            }
            None => return,
        }
    }
}

impl Runnable for ShellCommand {
    fn start(self: Arc<ShellCommand>, ctx: Arc<RunCtx>) -> RunnableResult {
        let stdout = RunPipe::new();
        let stderr = RunPipe::new();
        let run_result = stdout.runnable_result();

        tokio::spawn(async move {
            let child_res = OsCommand::new("zsh")
                .arg("-c")
                .arg(&self.command)
                .current_dir(&self.working_directory)
                .stdin(Stdio::piped())
                .stdout(stdout.out_file().await.into_std().await)
                .stderr(stderr.out_file().await.into_std().await)
                .spawn();

            let child = match child_res {
                Ok(c) => c,
                Err(e) => {
                    println!("failed to create command: {}", &self.command);
                    ctx.set_status(RunStatus::Error("Failed to create command".into()));
                    return;
                }
            };

            tokio::spawn(Self::wait_for_child(ctx, child));
        });

        return run_result;
    }
}
