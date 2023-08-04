// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use std::process::Stdio;
use std::sync::{atomic::Ordering, Arc};
use tokio::io::AsyncReadExt;
use tokio::process::Command;

#[derive(Serialize)]
struct CommandOutput {
    success: bool,
    exit_code: Option<i32>,
    stdout: String,
    stderr: String,
    combined: String,
}

#[tauri::command]
async fn run_zsh(command: String) -> CommandOutput {
    let mut child = Command::new("zsh")
        .arg("-c")
        .arg(&command)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("failed to spawn process");

    // Stdin should auto-close for now
    let stdin = child.stdin.take().expect("Failed to open stdin");
    std::mem::drop(stdin);

    let stdout = child.stdout.take().expect("Failed to open stdin");
    let stderr = child.stderr.take().expect("Failed to open stdin");

    enum Data {
        Stderr(String),
        Stdout(String),
        Status(std::process::ExitStatus),
    }

    let (txout, mut rx) = tokio::sync::mpsc::channel(128);
    let txerr = txout.clone();
    let txstat = txout.clone();
    let done = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let doneerr = done.clone();
    let donestat = done.clone();
    let doneout = done.clone();

    tokio::spawn(async move {
        let mut bytes = vec![0u8; 128];
        let done = doneout;
        let tx = txout;
        let mut pipe = stdout;

        loop {
            let len = match pipe.read(&mut bytes).await {
                Ok(len) => len,
                Err(e) => {
                    println!("e: {:?}", e);
                    continue;
                }
            };

            if len == 0 && done.load(Ordering::SeqCst) {
                break;
            }

            // TODO: should not do string conversion here
            let line = String::from_utf8_lossy(&bytes[..len]).into_owned();
            tx.send(Data::Stdout(line)).await.expect("wtf");
        }
    });

    tokio::spawn(async move {
        let mut bytes = vec![0u8; 128];
        let done = doneerr;
        let tx = txerr;
        let mut pipe = stderr;

        loop {
            let len = match pipe.read(&mut bytes).await {
                Ok(len) => len,
                Err(e) => {
                    println!("e: {:?}", e);
                    continue;
                }
            };

            if len == 0 && done.load(Ordering::SeqCst) {
                break;
            }

            // TODO: should not do string conversion here
            let line = String::from_utf8_lossy(&bytes[..len]).into_owned();
            tx.send(Data::Stderr(line)).await.expect("wtf");
        }
    });

    tokio::spawn(async move {
        let status = child
            .wait()
            .await
            .expect("child process encountered an error");

        txstat.send(Data::Status(status)).await.expect("wtf");

        // TODO: too lazy to think about acq rel order right now
        donestat.store(true, Ordering::SeqCst);
    });

    let mut output = CommandOutput {
        success: false,
        exit_code: None,
        stdout: String::new(),
        stderr: String::new(),
        combined: String::new(),
    };
    while let Some(i) = rx.recv().await {
        match i {
            Data::Status(s) => {
                output.success = s.success();
                output.exit_code = s.code();
            }
            Data::Stdout(s) => {
                output.stdout += &s;
                output.combined += &s;
            }
            Data::Stderr(s) => {
                output.stderr += &s;
                output.combined += &s;
            }
        }
    }

    return output;
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![run_zsh])
        .run(tauri::generate_context!())
        .expect("error while running webb");
}
