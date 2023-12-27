use crate::graph::shell::ShellConfig;
use crate::graph::Runnable;
use crate::graph::{lua::LuaCommand, shell::ShellCommand};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicU8};
use std::sync::Mutex;
use std::sync::{atomic::Ordering, Arc};
use std::time::Duration;
use strum::IntoStaticStr;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite};
use tokio::process::{Child, Command as OsCommand};
use uuid::Uuid;

#[derive(Serialize, Deserialize, Clone, Type, IntoStaticStr)]
#[serde(tag = "kind")]
pub enum CellCommandKind {
    Shell { working_directory: PathBuf },
    Lua,
}

#[derive(Serialize, Deserialize, Clone, Type)]
pub struct CellCommand {
    pub kind: CellCommandKind,
    pub source: String,
}

impl CellCommand {
    pub fn get_name(&self) -> &'static str {
        return (&self.kind).into();
    }

    pub async fn create_runnable(self) -> Arc<dyn Runnable + 'static> {
        use CellCommandKind::*;

        match self.kind {
            Lua => {
                return Arc::new(LuaCommand::new(self.source));
            }
            Shell { working_directory } => {
                return Arc::new(
                    ShellCommand::new(ShellConfig {
                        working_directory,
                        command: self.source,
                    })
                    .await
                    .unwrap(),
                )
            }
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Type)]
pub enum Direction {
    Up,
    Down,
    Left,
    Right,
}

#[derive(Serialize, Deserialize, Clone, Type)]
#[serde(tag = "kind")]
pub enum SheetCommand {
    CreateCell { language: CellCommandKind },
    MoveFocus { direction: Direction },
}
