use axum::Json;
use http::StatusCode;
use leptos::*;
use serde::{Deserialize, Serialize};

#[server(PingPeer, "/api")]
pub async fn ping_peer() -> Result<(), ServerFnError> {
    return Ok(());
}

#[derive(Deserialize)]
pub struct PingParams {
    pub device_id: String,
}
#[derive(Serialize)]
pub struct PingOutput {
    pub received_device_id: String,
}

pub async fn ping_endpoint(Json(payload): Json<PingParams>) -> (StatusCode, Json<PingOutput>) {
    return (
        StatusCode::OK,
        Json(PingOutput {
            received_device_id: payload.device_id,
        }),
    );
}

#[component]
pub fn Peers() -> impl IntoView {
    return view! { <div>Hello, World!</div> };
}
