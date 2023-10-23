// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
#![cfg_attr(debug_assertions, allow(//
    dead_code,
    unused_imports,
    unused_variables
))]

pub mod commands;
pub mod runner;
pub mod util;

use lazy_static::lazy_static;
use runner::{PollOutput, RunId};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::runner::{Runnable, Runner};

lazy_static! {
// TODO: will this be a bottleneck?
static ref RUNNING_COMMANDS: Mutex<HashMap<RunId, Arc<Mutex<Runner>>>> =
    Mutex::new(HashMap::new());
}

async fn run_runner(runnable: Arc<dyn Runnable + 'static>) -> RunId {
    let command = Runner::new_boxed(runnable);
    let uuid = command.id();
    let mut commands = RUNNING_COMMANDS.lock().await;
    if let Some(prev) = commands.insert(uuid, Arc::new(Mutex::new(command))) {
        let prev = prev.lock().await;
        prev.kill();
    }

    return uuid;
}

#[derive(Clone, Debug, serde::Serialize, specta::Type)]
struct PathSuggest {
    valid: bool,
    closest_path: String,
}

#[tauri::command]
#[specta::specta]
fn user_home_dir() -> std::path::PathBuf {
    let a = dirs::home_dir().unwrap();
    println!("USER HOME DIR: {:?}", a);

    return a;
}

#[tauri::command]
#[specta::specta]
async fn suggest_path(s: String, from: String) -> PathSuggest {
    println!("running suggest_path");

    // Lots of this probably doesn't need to be async, but I'm not too excited about e.g.
    // exhausting the worker threads in the tauri runtime by calling blocking functions here.
    // Additionally, while trying to research this, I accidentally fell down a rabbit hole of
    //  rust drama, and am now exhausted myself.
    let mut jumps = 0;
    let mut cur_str = std::path::Path::new(&from).to_path_buf();
    cur_str.push(&s);

    let closest_path = 'find_closest: loop {
        match tokio::fs::canonicalize(&cur_str).await {
            Ok(v) => break 'find_closest v,
            Err(e) => {
                println!("{:?} had error: {:?}", cur_str, e);
            }
        }

        if !cur_str.pop() {
            break 'find_closest dirs::home_dir().unwrap();
        };
        jumps += 1;
    };

    let closest_path = closest_path.display().to_string();

    let result = PathSuggest {
        valid: jumps == 0,
        closest_path,
    };
    println!("running suggest_path {:#?}", &result);
    return result;
}

#[tauri::command]
#[specta::specta]
async fn poll_command(id: RunId, timeout_ms: u32) -> Option<PollOutput> {
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
async fn run_command(config: commands::CellCommand) -> Result<RunId, String> {
    println!("running command: {}", config.get_name());

    let command = config.create_runnable().await;
    return Ok(run_runner(command).await);
}

macro_rules! generate_handler {
    ( $($func:ident),+ ) => {{
        #[cfg(debug_assertions)]
        tauri_specta::ts::export(
            specta::collect_types![
                $( $func ),*
            ],
            "../web/lib/handlers.ts",
        )
        .unwrap();

        tauri::generate_handler![
            $( $func ),*
        ]
    }};
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(generate_handler![
            //
            run_command,
            poll_command,
            // Utils
            suggest_path,
            user_home_dir
        ])
        .run(tauri::generate_context!())
        .expect("error while running webb");
}
