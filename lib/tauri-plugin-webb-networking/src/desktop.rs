use serde::de::DeserializeOwned;
use tauri::{plugin::PluginApi, AppHandle, Runtime};

use crate::models::*;

pub fn init<R: Runtime, C: DeserializeOwned>(
  app: &AppHandle<R>,
  _api: PluginApi<R, C>,
) -> crate::Result<WebbNetworking<R>> {
  Ok(WebbNetworking(app.clone()))
}

/// Access to the webb-networking APIs.
pub struct WebbNetworking<R: Runtime>(AppHandle<R>);

impl<R: Runtime> WebbNetworking<R> {
  pub fn ping(&self, payload: PingRequest) -> crate::Result<PingResponse> {
    Ok(PingResponse {
      value: payload.value,
    })
  }
}
