//! This is maybe a bad name, but I couldn't come up with anything better.

pub mod lua;
pub mod shared;
pub mod shell;

pub use shared::*;

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

#[derive(Clone, Copy, PartialOrd, Hash, PartialEq, Eq, Serialize, Deserialize, Debug, Type)]
#[repr(transparent)]
pub struct RunId(Uuid);

pub struct Runner {
    id: RunId,
    runnable: Arc<dyn Runnable>,

    // This is silly, but I guess whatever. Make it better later :(
    output: Arc<Mutex<Vec<RunnerOutput>>>,
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
    pub fn new(runnable: impl Runnable) -> Self {
        return Self::new_boxed(Arc::new(runnable));
    }

    pub fn new_boxed(runnable: Arc<dyn Runnable>) -> Self {
        let output = Arc::new(Mutex::new(Vec::new()));
        let id = RunId(Uuid::new_v4());

        let (kill, rx_kill) = tokio::sync::mpsc::channel(8);
        let (tx, rx) = tokio::sync::mpsc::channel(128);
        runnable.clone().start(RunCtx {
            output_sender: tx.clone(),
            kill_receiver: Some(rx_kill),
        });

        let sel = Self {
            id,
            output,
            runnable,
            kill,
        };

        let output_write_ref = sel.output.clone();
        tokio::spawn(async move {
            let mut rx = rx;
            let output = output_write_ref;
            loop {
                let s = match rx.recv().await {
                    Some(s) => s,
                    None => break,
                };
                let mut out = output.lock().unwrap();
                out.push(s);
            }
        });

        return sel;
    }

    pub async fn poll(&self, timeout: Duration) -> PollOutput {
        let mut output = self.output.lock().unwrap();

        let mut data = Vec::<RunnerOutputExt>::new();
        if output.len() == 0 {
            return PollOutput {
                data,
                end: self.runnable.is_done(),
                success: self.runnable.is_successful(),
            };
        }

        let output = std::mem::replace(&mut *output, Vec::new());
        data.extend(output.into_iter().map(|a| a.into()));

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
