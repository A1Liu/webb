//! This is maybe a bad name, but I couldn't come up with anything better.

pub mod lua;
pub mod shell;

use serde::__private::from_utf8_lossy;
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

pub trait Runnable: core::fmt::Debug + Send + Sync {
    fn start(self: Arc<Self>, ctx: RunCtx);
    fn is_done(&self) -> bool;
    fn is_successful(&self) -> Option<bool>;
}

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

pub struct RunCtx {
    tx: tokio::sync::mpsc::Sender<RunnerOutput>,
    kill_receiver: Option<tokio::sync::mpsc::Receiver<()>>,
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
        let tx = self.tx.clone();
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

#[derive(Clone, Copy, PartialOrd, Hash, PartialEq, Eq, Serialize, Deserialize, Debug, Type)]
#[repr(transparent)]
pub struct RunId(Uuid);

#[derive(Serialize, Clone, Type)]
#[serde(tag = "kind", content = "value")]
pub enum RunnerOutput {
    Stdout(Vec<u8>),
    Stderr(Vec<u8>),
}

#[derive(Serialize, Clone, Type)]
#[serde(tag = "kind", content = "value")]
pub enum RunnerOutputExt {
    Stdout(String),
    Stderr(String),
}

impl From<RunnerOutput> for RunnerOutputExt {
    fn from(value: RunnerOutput) -> Self {
        match value {
            RunnerOutput::Stdout(s) => {
                let line = String::from_utf8_lossy(&s).into_owned();
                return RunnerOutputExt::Stdout(line);
            }
            RunnerOutput::Stderr(s) => {
                let line = String::from_utf8_lossy(&s).into_owned();
                return RunnerOutputExt::Stderr(line);
            }
        }
    }
}

#[derive(Serialize, Type)]
pub struct PollOutput {
    pub end: bool,
    pub success: Option<bool>,
    pub data: Vec<RunnerOutputExt>,
}

pub struct Runner {
    id: RunId,
    runnable: Arc<dyn Runnable + 'static>,

    // This is silly, but I guess whatever. Make it better later :(
    output: Arc<Mutex<Vec<RunnerOutput>>>,
    channel: tokio::sync::mpsc::Receiver<RunnerOutput>,
    kill: tokio::sync::mpsc::Sender<()>,
}

impl std::fmt::Debug for Runner {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.runnable.fmt(f)
    }
}

impl Drop for Runner {
    fn drop(&mut self) {
        self.kill();
    }
}

impl Runner {
    pub fn new(runnable: impl Runnable + 'static) -> Self {
        return Self::dyn_new(Arc::new(runnable));
    }

    fn dyn_new(runnable: Arc<dyn Runnable + 'static>) -> Self {
        let output = Arc::new(Mutex::new(Vec::new()));
        let id = RunId(Uuid::new_v4());

        let (kill, rx_kill) = tokio::sync::mpsc::channel(8);
        let (tx, rx) = tokio::sync::mpsc::channel(128);
        runnable.clone().start(RunCtx {
            tx: tx.clone(),
            kill_receiver: Some(rx_kill),
        });

        let sel = Self {
            id,
            output,
            runnable,
            kill,
            channel: rx,
        };

        // let output_write_ref = sel.output.clone();
        // tokio::spawn(async move {
        //     let mut rx = rx;
        //     let output = output_write_ref;
        //     loop {
        //         let s = match rx.recv().await {
        //             Some(s) => s,
        //             None => break,
        //         };
        //         let mut out = output.lock().unwrap();
        //         out.push(s);
        //     }
        // });

        return sel;
    }

    pub async fn poll(&mut self, timeout: Duration) -> PollOutput {
        let first = tokio::select! {
            s = self.channel.recv() => s,
            _ = tokio::time::sleep(timeout) => return PollOutput {
                success: self.runnable.is_successful(),
                data: Vec::new(),
                end: self.runnable.is_done(),
            },
        };

        let mut data = Vec::<RunnerOutputExt>::new();
        match first {
            Some(item) => data.push(item.into()),
            None => {
                return PollOutput {
                    data,
                    end: self.runnable.is_done(),
                    success: self.runnable.is_successful(),
                }
            }
        }

        while data.len() < 25 {
            use tokio::sync::mpsc::error::TryRecvError::*;
            match self.channel.try_recv() {
                Err(Disconnected) => {
                    return PollOutput {
                        data,
                        end: self.runnable.is_done(),
                        success: self.runnable.is_successful(),
                    }
                }
                Err(Empty) => break,
                Ok(d) => data.push(d.into()),
            }
        }

        return PollOutput {
            data,
            end: self.runnable.is_done(),
            success: self.runnable.is_successful(),
        };
    }

    pub fn id(&self) -> RunId {
        return self.id;
    }

    pub fn is_done(&self) -> bool {
        self.runnable.is_done()
    }

    pub fn kill(&self) {
        let kill = self.kill.clone();
        tokio::spawn(async move { kill.send(()).await.unwrap() });
    }

    pub fn is_successful(&self) -> Option<bool> {
        self.runnable.is_successful()
    }
}
