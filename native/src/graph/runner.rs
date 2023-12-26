use serde::{Deserialize, Serialize};
use specta::Type;
use std::io::Cursor;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::{Arc, OnceLock};
use strum::Display;
use tokio::io::{AsyncRead, AsyncWrite, BufReader};
use tokio::process::Command;
use tokio::process::{Child, Command as OsCommand};
use tokio::sync::mpsc::Receiver;
use tokio::sync::Mutex;
use uuid::Uuid;

pub trait Runnable: core::fmt::Debug + Send + Sync + 'static {
    fn start(self: Arc<Self>, ctx: Arc<RunCtx>) -> RunnableResult;
}

#[derive(Debug, Clone)]
pub struct RunnableResult(RunData);

#[derive(Debug, Clone)]
pub enum RunStatus {
    Success,
    Error(String),
}

#[derive(Debug, Clone)]
enum RunData {
    Text(String),
    File(PathBuf),
}

#[derive(Clone, Copy, PartialOrd, Hash, PartialEq, Eq, Serialize, Deserialize, Debug, Type)]
#[repr(transparent)]
pub struct RunId(Uuid);

impl std::fmt::Display for RunId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        return write!(f, "run-{}", self.0);
    }
}

pub struct RunCtx {
    pub id: RunId,
    status: OnceLock<RunStatus>,
    logs: OnceLock<RunnableResult>,
    kill_recv: tokio::sync::watch::Receiver<bool>,
}

impl RunCtx {
    fn new() -> (Self, tokio::sync::watch::Sender<bool>) {
        let (kill_send, kill_recv) = tokio::sync::watch::channel(false);

        let id = RunId(Uuid::new_v4());

        let sel = Self {
            id,
            status: OnceLock::new(),
            logs: OnceLock::new(),
            kill_recv,
        };

        return (sel, kill_send);
    }

    pub fn set_status(&self, status: RunStatus) {
        self.status
            .set(status)
            .expect("Tried to set status twice".into());
    }

    pub fn error(&self, text: impl Into<String>) -> RunnableResult {
        let text: String = text.into();
        self.set_status(RunStatus::Error(text.clone()));

        return RunnableResult(RunData::Text(text));
    }

    pub fn text(&self, text: String) -> RunnableResult {
        self.set_status(RunStatus::Success);

        return RunnableResult(RunData::Text(text));
    }

    pub fn set_logs(&self, log_output: RunnableResult) {
        self.logs.set(log_output).expect("failed to set logs");
    }

    /// Wait for the kill signal
    pub async fn wait_for_kill_signal(&self) {
        let mut kill_signal = self.kill_recv.clone();
        if *kill_signal.borrow_and_update() {
            return;
        }

        if let Err(_) = kill_signal.changed().await {
            // If there's an error, then the senders have all
            // been dropped, so then we just wait forever
            std::future::pending::<()>().await;
        }
    }
}

pub struct RunPipe {
    path: PathBuf,
}

impl RunPipe {
    pub fn new() -> Self {
        return Self {
            path: "/tmp/blah".into(),
        };
    }

    pub async fn out_file(&self) -> tokio::fs::File {
        return tokio::fs::File::create(&self.path)
            .await
            .expect("Failed to create temporary file for pipe");
    }

    pub async fn out_file_append(&self) -> tokio::fs::File {
        return tokio::fs::File::options()
            .read(false)
            .append(true)
            .open(&self.path)
            .await
            .expect("Failed to create temporary file for pipe");
    }

    pub fn runnable_result(&self) -> RunnableResult {
        return RunnableResult(RunData::File(self.path.clone()));
    }
}

impl RunnableResult {
    // Only for reading files/text
    //
    // For any kind of bi-directionality, you'd need to use
    // a different API
    pub fn read_result(&self) -> Result<Box<dyn AsyncRead + 'static>, String> {
        match &self.0 {
            RunData::Text(s) => {
                let clone = s.clone().into_bytes();
                return Ok(Box::new(Cursor::new(clone)));
            }
            RunData::File(s) => {
                let child_res = OsCommand::new("tail")
                    .arg("-f")
                    .arg("-c")
                    .arg("+1")
                    .arg(s)
                    .stdout(Stdio::piped())
                    .spawn();

                let mut child = match child_res {
                    Ok(c) => c,
                    Err(e) => {
                        return Err("failed to read file".to_string());
                    }
                };

                let stdout = child.stdout.take().expect("failed to get output of tail");

                return Ok(Box::new(BufReader::new(stdout)));
            }
        }
    }
}

pub struct RunnerResult {
    ctx: Arc<RunCtx>,
    kill_send: tokio::sync::watch::Sender<bool>,
}

pub fn run(runnable: Arc<dyn Runnable>) -> RunnerResult {
    let (ctx, kill_send) = RunCtx::new();
    let ctx = Arc::new(ctx);

    runnable.start(ctx.clone());

    return RunnerResult { ctx, kill_send };
}

impl RunnerResult {
    pub fn is_done(&self) -> bool {
        return self.ctx.status.get().is_some();
    }

    pub fn is_successful(&self) -> bool {
        match self.ctx.status.get() {
            Some(RunStatus::Success) => return true,
            _ => return false,
        }
    }

    pub fn logs(&self) -> Option<RunnableResult> {
        return self.ctx.logs.get().map(|r| r.clone());
    }

    pub fn kill(&self) {
        let _ = self.kill_send.send(true);
    }
}
