#[tauri::mobile_entry_point]
fn main() {
    let mut app_builder = super::AppBuilder::new();
    app_builder.builder = app_builder
        .builder
        .plugin(tauri_plugin_barcode_scanner::init());

    app_builder.run();
}
