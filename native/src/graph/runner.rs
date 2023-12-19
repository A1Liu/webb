use std::io::Cursor;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::{Arc, OnceLock};
use tokio::io::{AsyncRead, AsyncWrite};
use tokio::sync::mpsc::Receiver;
use tokio::sync::Mutex;

pub trait Runnable: core::fmt::Debug + Send + Sync + 'static {
    fn start(self: Arc<Self>, ctx: Arc<RunCtx>) -> RunResult;
}

#[derive(Debug)]
pub struct RunResult(RunData);

#[derive(Debug)]
enum RunStatus {
    Success,
    Error(String),
}

#[derive(Debug)]
enum RunData {
    Text(String),
    File(PathBuf),
}

pub struct RunCtx {
    status: OnceLock<RunStatus>,
    logs: OnceLock<RunResult>,
    kill_recv: tokio::sync::watch::Receiver<bool>,
}

impl RunCtx {
    fn create() -> (Self, tokio::sync::watch::Sender<bool>) {
        let (kill_send, kill_recv) = tokio::sync::watch::channel(false);

        let sel = Self {
            status: OnceLock::new(),
            logs: OnceLock::new(),
            kill_recv,
        };

        return (sel, kill_send);
    }

    pub fn fail(&self, error: impl Into<String>) -> RunResult {
        self.status
            .set(RunStatus::Error(error.into()))
            .expect("Tried to set status twice".into());
        return RunResult(RunData::Text(String::new()));
    }

    pub fn text(&self, text: String) -> RunResult {
        self.status
            .set(RunStatus::Success)
            .expect("Tried to set status twice".into());

        return RunResult(RunData::Text(text));
    }

    pub fn set_logs(&self, log_output: RunResult) {
        self.logs.set(log_output).expect("failed to set logs");
    }

    pub async fn pipe(&self) -> (impl AsyncWrite, RunResult) {
        let file_path: PathBuf = "/tmp/blah".into();

        let out_file = tokio::fs::File::create(&file_path)
            .await
            .expect("Failed to create temporary file for pipe");

        return (out_file, RunResult(RunData::File(file_path)));
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

impl RunResult {
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
                panic!("Oops");
            }
        }
    }
}
