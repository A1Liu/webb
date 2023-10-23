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
pub struct RunStatus {
    // I'd like to not have to ARC everything, but for now, there's a lot of running
    // tasks that needs shared references to synchronization variables, and this
    // seems to be the most reasonable way to implement that.
    status: Arc<AtomicU8>,
}

impl RunStatus {
    const NOT_DONE: u8 = 0;
    const SUCCESS: u8 = 1;
    const FAIL: u8 = 2;

    pub fn new() -> Self {
        return Self {
            status: Arc::new(AtomicU8::new(Self::NOT_DONE)),
        };
    }
    pub fn is_done(&self) -> bool {
        return self.status.load(Ordering::SeqCst) != Self::NOT_DONE;
    }

    pub fn is_successful(&self) -> Option<bool> {
        let done = self.status.load(Ordering::SeqCst);
        match done {
            Self::SUCCESS => return Some(true),
            Self::FAIL => return Some(false),
            _ => return None,
        }
    }

    pub fn failure(&self) {
        match self.status.compare_exchange(
            Self::NOT_DONE,
            Self::FAIL,
            Ordering::SeqCst,
            Ordering::SeqCst,
        ) {
            Ok(_) => {}
            Err(v) => panic!("already finished this run"),
        }
    }

    pub fn success(&self) {
        match self.status.compare_exchange(
            Self::NOT_DONE,
            Self::SUCCESS,
            Ordering::SeqCst,
            Ordering::SeqCst,
        ) {
            Ok(_) => {}
            Err(v) => panic!("already finished this run"),
        }
    }
}

#[derive(Serialize, Clone, Type)]
#[serde(tag = "kind", content = "value")]
pub enum RunnerOutput {
    Stdout(Vec<u8>),
    Stderr(Vec<u8>),
}

pub trait Runnable: core::fmt::Debug + Send + Sync {
    fn start(self: Arc<Self>, ctx: RunCtx);
    fn is_done(&self) -> bool;
    fn is_successful(&self) -> Option<bool>;
}

pub struct RunCtx {
    pub output_sender: tokio::sync::mpsc::Sender<RunnerOutput>,
    pub kill_receiver: Option<tokio::sync::mpsc::Receiver<()>>,
}

impl RunCtx {
    pub fn pipe_to_stdout(
        &self,
        runnable: Arc<dyn Runnable + 'static>,
        pipe: impl Unpin + AsyncReadExt + Send + 'static,
    ) {
        self.pipe_to_channel(runnable, pipe, RunnerOutput::Stdout)
    }

    pub fn pipe_to_stderr(
        &self,
        runnable: Arc<dyn Runnable + 'static>,
        pipe: impl Unpin + AsyncReadExt + Send + 'static,
    ) {
        self.pipe_to_channel(runnable, pipe, RunnerOutput::Stderr)
    }

    pub fn take_kill_receiver(&mut self) -> tokio::sync::mpsc::Receiver<()> {
        return self.kill_receiver.take().unwrap();
    }

    fn pipe_to_channel(
        &self,
        runnable: Arc<dyn Runnable + 'static>,
        mut pipe: impl Unpin + AsyncReadExt + Send + 'static,
        func: fn(Vec<u8>) -> RunnerOutput,
    ) {
        let tx = self.output_sender.clone();
        tokio::spawn(async move {
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
                    if runnable.is_done() {
                        break;
                    }

                    tokio::time::sleep(std::time::Duration::from_millis(1)).await;
                    continue;
                }

                tx.send(func(bytes.clone())).await.expect("wtf");
                bytes.clear();
            }
        });
    }
}
