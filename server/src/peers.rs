use leptos::*;

#[server(PingPeer, "/api")]
pub async fn ping_peer() -> Result<(), ServerFnError> {
    return Ok(());
}

pub async fn ping_endpoint() -> &'static str {
    return "Hello, World!";
}

#[component]
pub fn Peers() -> impl IntoView {
    return view! { <div>Hello, World!</div> };
}
