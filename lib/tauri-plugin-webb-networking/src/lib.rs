use tauri::{
  plugin::{Builder, TauriPlugin},
  Manager, Runtime,
};

use std::{collections::HashMap, sync::Mutex};

pub use models::*;

#[cfg(desktop)]
mod desktop;
#[cfg(mobile)]
mod mobile;

mod commands;
mod error;
mod models;

pub use error::{Error, Result};

#[cfg(desktop)]
use desktop::WebbNetworking;
#[cfg(mobile)]
use mobile::WebbNetworking;

#[derive(Default)]
struct MyState(Mutex<HashMap<String, String>>);

/// Extensions to [`tauri::App`], [`tauri::AppHandle`] and [`tauri::Window`] to access the webb-networking APIs.
pub trait WebbNetworkingExt<R: Runtime> {
  fn webb_networking(&self) -> &WebbNetworking<R>;
}

impl<R: Runtime, T: Manager<R>> crate::WebbNetworkingExt<R> for T {
  fn webb_networking(&self) -> &WebbNetworking<R> {
    self.state::<WebbNetworking<R>>().inner()
  }
}

/// Initializes the plugin.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
  Builder::new("webb-networking")
    .invoke_handler(tauri::generate_handler![commands::execute])
    .setup(|app, api| {
      #[cfg(mobile)]
      let webb_networking = mobile::init(app, api)?;
      #[cfg(desktop)]
      let webb_networking = desktop::init(app, api)?;
      app.manage(webb_networking);

      // manage state so it is accessible by the commands
      app.manage(MyState::default());
      Ok(())
    })
    .build()
}
