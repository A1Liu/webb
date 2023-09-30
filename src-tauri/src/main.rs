// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod sheet;

use commands::{Command, CommandData, CommandId, CommandOutput, CommandStatus};
use lazy_static::lazy_static;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
use uuid::Uuid;

pub struct RunningCommand {
    pub uuid: Uuid,
    pub exit_status: Option<CommandStatus>,
    pub channel: Option<tokio::sync::mpsc::Receiver<CommandData>>,
    pub kill: Option<tokio::sync::oneshot::Sender<()>>,
}

lazy_static! {
// TODO: will this be a bottleneck?
static ref RUNNING_COMMANDS: Mutex<HashMap<String, Arc<Mutex<Command>>>> =
    Mutex::new(HashMap::new());
}

#[tauri::command]
#[specta::specta]
async fn poll_command(id: String, timeout_ms: u32) -> Option<CommandOutput> {
    println!("running poll_command");

    let command = {
        let commands = RUNNING_COMMANDS.lock().await;
        commands.get(&id)?.clone()
    };

    let mut command = command.lock().await;
    return Some(
        command
            .poll(std::time::Duration::from_millis(timeout_ms as u64))
            .await,
    );
}

#[tauri::command]
#[specta::specta]
async fn run_zsh(id: String, command: String) -> Result<CommandId, String> {
    println!("running zsh");

    let command = Command::new(command)?;
    let uuid = command.id();

    let mut commands = RUNNING_COMMANDS.lock().await;
    if let Some(prev) = commands.insert(id, Arc::new(Mutex::new(command))) {
        let mut prev = prev.lock().await;
        prev.kill();
    }

    return Ok(uuid);
}

fn main() {
    #[cfg(debug_assertions)]
    tauri_specta::ts::export(
        specta::collect_types![run_zsh, poll_command],
        "../web/lib/handlers.ts",
    )
    .unwrap();

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![run_zsh, poll_command])
        .run(tauri::generate_context!())
        .expect("error while running webb");
}
