use std::io::Cursor;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::{Arc, OnceLock};
use tokio::io::{AsyncRead, AsyncWrite, BufReader};
use tokio::process::Command;
use tokio::process::{Child, Command as OsCommand};
use tokio::sync::mpsc::Receiver;
use tokio::sync::Mutex;

pub trait Runnable: core::fmt::Debug + Send + Sync + 'static {
    fn start(self: Arc<Self>, ctx: Arc<RunCtx>) -> RunnableResult;
}

#[derive(Debug, Clone)]
pub struct RunnableResult(RunData);

#[derive(Debug)]
enum RunStatus {
    Success,
    Error(String),
}

#[derive(Debug, Clone)]
enum RunData {
    Text(String),
    File(PathBuf),
}

pub struct RunCtx {
    status: OnceLock<RunStatus>,
    logs: OnceLock<RunnableResult>,
    kill_recv: tokio::sync::watch::Receiver<bool>,
}

impl RunCtx {
    fn new() -> (Self, tokio::sync::watch::Sender<bool>) {
        let (kill_send, kill_recv) = tokio::sync::watch::channel(false);

        let sel = Self {
            status: OnceLock::new(),
            logs: OnceLock::new(),
            kill_recv,
        };

        return (sel, kill_send);
    }

    pub fn fail(&self, error: impl Into<String>) -> RunnableResult {
        self.status
            .set(RunStatus::Error(error.into()))
            .expect("Tried to set status twice".into());
        return RunnableResult(RunData::Text(String::new()));
    }

    pub fn text(&self, text: String) -> RunnableResult {
        self.status
            .set(RunStatus::Success)
            .expect("Tried to set status twice".into());

        return RunnableResult(RunData::Text(text));
    }

    pub fn set_logs(&self, log_output: RunnableResult) {
        self.logs.set(log_output).expect("failed to set logs");
    }

    pub async fn pipe(&self) -> (impl AsyncWrite, RunnableResult) {
        let file_path: PathBuf = "/tmp/blah".into();

        let out_file = tokio::fs::File::create(&file_path)
            .await
            .expect("Failed to create temporary file for pipe");

        return (out_file, RunnableResult(RunData::File(file_path)));
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
