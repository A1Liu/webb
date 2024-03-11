// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
#![cfg_attr(debug_assertions, allow(//
    dead_code,
    unused_imports,
    unused_variables
))]

use tauri::Manager;

#[tauri::command]
async fn run_command() -> String {
    return String::new();
}

/*
macro_rules! generate_handler {
    ( $($func:ident),+ ) => {{
        #[cfg(debug_assertions)]
        tauri_specta::ts::export(
            specta::collect_types![
                $( $func ),*
            ],
            "./components/handlers.ts",
        )
        .unwrap();

        tauri::generate_handler![
            $( $func ),*
        ]
    }};
}
*/

fn main() {
    app::AppBuilder::new().run();
}
