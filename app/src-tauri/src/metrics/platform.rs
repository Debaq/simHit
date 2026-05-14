// Información de la plataforma donde corre la app, embebida en sensor_profile.json
// para trazabilidad: qué SO, arquitectura, qué versión exacta de SimHIT generó
// el perfil. No identifica al usuario.

use serde::Serialize;

#[derive(Debug, Serialize, Clone)]
pub struct HostInfo {
    pub os: String,
    pub arch: String,
    pub family: String,
    pub hostname: String,
    pub app_version: String,
}

#[tauri::command]
pub fn get_host_info() -> HostInfo {
    let hostname = hostname_best_effort();
    HostInfo {
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        family: std::env::consts::FAMILY.to_string(),
        hostname,
        app_version: env!("CARGO_PKG_VERSION").to_string(),
    }
}

// Hostname con fallback razonable: stdlib no expone una API portable estable,
// así que probamos variables de entorno típicas. Sin dep externa.
fn hostname_best_effort() -> String {
    if let Ok(v) = std::env::var("HOSTNAME") { if !v.is_empty() { return v; } }
    if let Ok(v) = std::env::var("COMPUTERNAME") { if !v.is_empty() { return v; } }
    // Último recurso en Linux/macOS: leer /etc/hostname
    if let Ok(s) = std::fs::read_to_string("/etc/hostname") {
        let trimmed = s.trim();
        if !trimmed.is_empty() { return trimmed.to_string(); }
    }
    "unknown".to_string()
}
