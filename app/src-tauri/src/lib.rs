// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod metrics;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn save_pdf(path: String, bytes: Vec<u8>) -> Result<(), String> {
    std::fs::write(&path, &bytes).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_serialplugin::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            save_pdf,
            metrics::capture::start_static_capture,
            metrics::capture::append_samples,
            metrics::capture::get_capture_progress,
            metrics::capture::stop_capture,
            metrics::sampling::analyze_sampling,
            metrics::allan::analyze_allan_variance,
            metrics::allan::analyze_allan_in_place,
            metrics::flash::detect_esp_chip,
            metrics::flash::flash_firmware,
            metrics::flash::list_serial_ports,
            metrics::flash::download_firmware,
            metrics::platform::get_host_info,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
