// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
#![cfg_attr(debug_assertions, allow(//
    dead_code,
    unused_imports,
    unused_variables
))]

pub mod commands;
pub mod util;

use commands::{Command, CommandId, CommandOutput};
use lazy_static::lazy_static;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

lazy_static! {
// TODO: will this be a bottleneck?
static ref RUNNING_COMMANDS: Mutex<HashMap<CommandId, Arc<Mutex<Command>>>> =
    Mutex::new(HashMap::new());
}

#[tauri::command]
async fn poll_command(id: CommandId, timeout_ms: u32) -> Option<CommandOutput> {
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
async fn run_zsh(command: String) -> Result<CommandId, String> {
    println!("running zsh");

    let command = Command::new(command)?;
    let uuid = command.id();

    let mut commands = RUNNING_COMMANDS.lock().await;
    if let Some(prev) = commands.insert(uuid, Arc::new(Mutex::new(command))) {
        let mut prev = prev.lock().await;
        prev.kill();
    }

    return Ok(uuid);
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![run_zsh, poll_command])
        .run(tauri::generate_context!())
        .expect("error while running webb");
}
