//! This is maybe a bad name, but I couldn't come up with anything better.

pub mod shell;

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

// Maybe there's a way to use files instead of handling file piping
// manually. IDK how you'd do stdout + stderr collation though. Maybe
// you don't need it in this medium.
pub struct RunnableIO {
    pub stdin: Option<Box<dyn AsyncWrite>>,
    pub stdout: Option<Box<dyn AsyncRead + Unpin + Send>>,
    pub stderr: Option<Box<dyn AsyncRead + Unpin + Send>>,
}

impl RunnableIO {
    pub fn new<SIn, SOut, SErr>(sin: Option<SIn>, sout: Option<SOut>, serr: Option<SErr>) -> Self
    where
        SIn: AsyncWrite + 'static,
        SOut: AsyncRead + Unpin + Send + 'static,
        SErr: AsyncRead + Unpin + Send + 'static,
    {
        return Self {
            stdin: sin.map(|s| -> Box<dyn AsyncWrite> { return Box::new(s) }),
            stdout: sout.map(|s| -> Box<dyn AsyncRead + Unpin + Send> { return Box::new(s) }),
            stderr: serr.map(|s| -> Box<dyn AsyncRead + Unpin + Send> { return Box::new(s) }),
        };
    }
}

pub trait Runnable: core::fmt::Debug + Send + Sync {
    fn is_done(&self) -> bool;
    fn kill(&self);
    fn is_successful(&self) -> Option<bool>;
}

#[derive(Clone, Copy, PartialOrd, Hash, PartialEq, Eq, Serialize, Deserialize, Debug, Type)]
#[repr(transparent)]
pub struct RunId(pub Uuid);

#[derive(Serialize, Clone, Type)]
#[serde(tag = "kind", content = "value")]
pub enum RunnerOutput {
    Stdout(Vec<u8>),
    Stderr(Vec<u8>),
}

#[derive(Serialize, Type)]
pub struct PollOutput {
    pub end: bool,
    pub success: Option<bool>,
    pub data: Vec<RunnerOutput>,
}

pub struct Runner {
    id: RunId,
    runnable: Arc<dyn Runnable + 'static>,
    stdin: Option<Box<dyn AsyncWrite>>,

    // This is silly, but I guess whatever. Make it better later :(
    output: Arc<Mutex<Vec<RunnerOutput>>>,
    channel: tokio::sync::mpsc::Receiver<RunnerOutput>,
}

impl Drop for Runner {
    fn drop(&mut self) {
        self.runnable.kill();
    }
}

impl Runner {
    pub fn new(runnable: impl Runnable + 'static, io: RunnableIO) -> Self {
        let output = Arc::new(Mutex::new(Vec::new()));
        let id = RunId(Uuid::new_v4());
        let stdin = io.stdin;

        let (tx, rx) = tokio::sync::mpsc::channel(128);

        let sel = Self {
            id,
            output,
            stdin,
            runnable: Arc::new(runnable),
            channel: rx,
        };

        if let Some(stdout) = io.stdout {
            tokio::spawn(Self::pipe_to_channel(
                sel.runnable.clone(),
                tx.clone(),
                stdout,
                RunnerOutput::Stdout,
            ));
        }

        if let Some(stderr) = io.stderr {
            tokio::spawn(Self::pipe_to_channel(
                sel.runnable.clone(),
                tx.clone(),
                stderr,
                RunnerOutput::Stderr,
            ));
        }

        let output_write_ref = sel.output.clone();

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

    async fn pipe_to_channel(
        runnable: Arc<dyn Runnable + 'static>,
        tx: tokio::sync::mpsc::Sender<RunnerOutput>,
        mut pipe: impl Unpin + AsyncReadExt,
        func: fn(Vec<u8>) -> RunnerOutput,
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
                if runnable.is_done() {
                    break;
                }

                tokio::time::sleep(std::time::Duration::from_millis(1)).await;
                continue;
            }

            tx.send(func(bytes.clone())).await.expect("wtf");
            bytes.clear();
        }
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

        let mut data = Vec::new();
        match first {
            Some(item) => data.push(item),
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
                Ok(d) => data.push(d),
            }
        }

        return PollOutput {
            data,
            end: self.runnable.is_done(),
            success: self.runnable.is_successful(),
        };
    }
}
