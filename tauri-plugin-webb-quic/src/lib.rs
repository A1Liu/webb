use tauri::{
  plugin::{Builder, TauriPlugin},
  Manager, Runtime,
};

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
use desktop::WebbQuic;
#[cfg(mobile)]
use mobile::WebbQuic;

/// Extensions to [`tauri::App`], [`tauri::AppHandle`] and [`tauri::Window`] to access the webb-quic APIs.
pub trait WebbQuicExt<R: Runtime> {
  fn webb_quic(&self) -> &WebbQuic<R>;
}

impl<R: Runtime, T: Manager<R>> crate::WebbQuicExt<R> for T {
  fn webb_quic(&self) -> &WebbQuic<R> {
    self.state::<WebbQuic<R>>().inner()
  }
}

/// Initializes the plugin.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
  Builder::new("webb-quic")
    .invoke_handler(tauri::generate_handler![commands::ping])
    .setup(|app, api| {
      #[cfg(mobile)]
      let webb_quic = mobile::init(app, api)?;
      #[cfg(desktop)]
      let webb_quic = desktop::init(app, api)?;
      app.manage(webb_quic);
      Ok(())
    })
    .build()
}
