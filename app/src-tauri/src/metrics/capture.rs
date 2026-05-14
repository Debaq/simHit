// Persistencia de capturas estáticas para el módulo de métricas.
//
// El frontend mantiene la conexión serial (vía tauri-plugin-serialplugin) y
// bufferea muestras parseadas; este módulo se encarga de escribirlas a disco
// en el formato canónico definido en docs/trabajo_metricas.md §2.1: CSV con
// header fijo, SHA-256, y session.json con metadatos.
//
// Arquitectura: una sesión activa por proceso. Esto refleja la limitación
// física (un único ESP32 conectado) y mantiene el estado simple.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs::{File, OpenOptions};
use std::io::{BufWriter, Write};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

// ──────────────────── Tipos públicos ────────────────────

#[derive(Debug, Deserialize, Clone)]
pub struct StartCaptureConfig {
    pub duration_seconds: u64,
    pub output_dir: String,
    pub sensor_label: String,
    pub ambient_temp_c_start: f32,
    pub preheat_minutes: u32,
    pub serial_port: String,
    pub baud_rate: u32,
    pub sample_rate_declared_hz: f64,
    pub firmware_version: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct CaptureSession {
    pub id: String,
    pub csv_path: String,
    pub metadata_path: String,
    pub started_at_utc: DateTime<Utc>,
}

// Muestra individual emitida por el frontend. Los campos opcionales se serializan
// como NaN si el sensor no los provee (p.ej. ICM-42688 no tiene magnetómetro).
#[derive(Debug, Deserialize, Clone, Copy)]
pub struct Sample {
    pub timestamp_us: i64,
    pub gyro_x_dps: f64,
    pub gyro_y_dps: f64,
    pub gyro_z_dps: f64,
    pub accel_x_g: f64,
    pub accel_y_g: f64,
    pub accel_z_g: f64,
    pub mag_x_ut: Option<f64>,
    pub mag_y_ut: Option<f64>,
    pub mag_z_ut: Option<f64>,
    pub temp_c: Option<f64>,
}

#[derive(Debug, Serialize, Clone)]
pub struct CaptureProgress {
    pub session_id: String,
    pub elapsed_s: f64,
    pub total_s: f64,
    pub samples_written: u64,
    pub samples_lost: u64,
    pub bytes_written: u64,
}

#[derive(Debug, Serialize, Clone)]
pub struct CaptureSummary {
    pub session_id: String,
    pub csv_path: String,
    pub metadata_path: String,
    pub samples_written: u64,
    pub samples_lost: u64,
    pub bytes_written: u64,
    pub duration_s: f64,
    pub csv_sha256: String,
    pub status: String, // "complete" | "incomplete"
}

#[derive(Debug, Serialize, Clone)]
pub struct CaptureError {
    pub code: String,
    pub message: String,
}

impl CaptureError {
    fn new(code: &str, message: impl Into<String>) -> Self {
        Self { code: code.into(), message: message.into() }
    }
}

impl From<std::io::Error> for CaptureError {
    fn from(e: std::io::Error) -> Self {
        CaptureError::new("DiskWriteError", e.to_string())
    }
}

// ──────────────────── Estado interno ────────────────────

struct ActiveSession {
    id: String,
    csv_path: PathBuf,
    metadata_path: PathBuf,
    writer: BufWriter<File>,
    hasher: Sha256,
    started_at: DateTime<Utc>,
    config: StartCaptureConfig,
    samples_written: u64,
    samples_lost: u64,
    bytes_written: u64,
    last_timestamp_us: Option<i64>,
    dt_sum_us: f64,
    dt_sq_sum_us: f64,
    dt_count: u64,
    // Throttle de eventos: emitir capture://progress a ~4 Hz, no en cada batch.
    last_emit_ms: u128,
}

impl ActiveSession {
    fn mean_dt_us(&self) -> f64 {
        if self.dt_count == 0 { 0.0 } else { self.dt_sum_us / self.dt_count as f64 }
    }
    fn stdev_dt_us(&self) -> f64 {
        if self.dt_count < 2 { return 0.0; }
        let n = self.dt_count as f64;
        let mean = self.mean_dt_us();
        let var = (self.dt_sq_sum_us / n) - mean * mean;
        if var > 0.0 { var.sqrt() } else { 0.0 }
    }
    fn elapsed_s(&self) -> f64 {
        (Utc::now() - self.started_at).num_milliseconds() as f64 / 1000.0
    }
}

// Mutex global con la sesión activa (0 o 1). No usamos tauri::State para que
// los handlers puedan ser simples y sin parámetros extra; el frontend solo
// puede tener una captura corriendo a la vez.
static ACTIVE: Mutex<Option<ActiveSession>> = Mutex::new(None);

const CSV_HEADER: &str = "timestamp_us,gyro_x_dps,gyro_y_dps,gyro_z_dps,accel_x_g,accel_y_g,accel_z_g,mag_x_uT,mag_y_uT,mag_z_uT,temp_c\n";

// ──────────────────── Helpers ────────────────────

fn fmt_opt(v: Option<f64>) -> String {
    match v {
        Some(x) if x.is_finite() => format!("{:.6}", x),
        _ => "NaN".to_string(),
    }
}

fn write_line(session: &mut ActiveSession, line: &str) -> Result<(), CaptureError> {
    session.writer.write_all(line.as_bytes())?;
    session.hasher.update(line.as_bytes());
    session.bytes_written += line.len() as u64;
    Ok(())
}

// ──────────────────── Comandos Tauri ────────────────────

#[tauri::command]
pub fn start_static_capture(config: StartCaptureConfig) -> Result<CaptureSession, CaptureError> {
    let mut guard = ACTIVE.lock().unwrap();
    if guard.is_some() {
        return Err(CaptureError::new("AlreadyRunning", "Ya hay una captura en curso"));
    }

    let id = Uuid::new_v4().to_string();
    let started_at = Utc::now();

    let session_dir = PathBuf::from(&config.output_dir).join(&id);
    std::fs::create_dir_all(&session_dir)?;
    let csv_path = session_dir.join("raw.csv");
    let metadata_path = session_dir.join("session.json");

    let file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&csv_path)?;
    let mut writer = BufWriter::with_capacity(64 * 1024, file);
    writer.write_all(CSV_HEADER.as_bytes())?;
    let mut hasher = Sha256::new();
    hasher.update(CSV_HEADER.as_bytes());

    let session = ActiveSession {
        id: id.clone(),
        csv_path: csv_path.clone(),
        metadata_path: metadata_path.clone(),
        writer,
        hasher,
        started_at,
        config: config.clone(),
        samples_written: 0,
        samples_lost: 0,
        bytes_written: CSV_HEADER.len() as u64,
        last_timestamp_us: None,
        dt_sum_us: 0.0,
        dt_sq_sum_us: 0.0,
        dt_count: 0,
        last_emit_ms: 0,
    };
    *guard = Some(session);

    Ok(CaptureSession {
        id,
        csv_path: csv_path.to_string_lossy().into_owned(),
        metadata_path: metadata_path.to_string_lossy().into_owned(),
        started_at_utc: started_at,
    })
}

// Lógica de append separada del comando Tauri para que los tests la usen sin
// necesitar AppHandle. Devuelve (samples_written, snapshot_para_evento_o_none).
fn append_samples_inner(session_id: &str, samples: &[Sample]) -> Result<(u64, Option<CaptureProgress>), CaptureError> {
    let mut guard = ACTIVE.lock().unwrap();
    let s = guard
        .as_mut()
        .ok_or_else(|| CaptureError::new("NoActiveSession", "No hay captura activa"))?;
    if s.id != session_id {
        return Err(CaptureError::new("SessionMismatch", "session_id no coincide"));
    }

    // Detectar gaps por jitter de timestamps. Umbral: 1.5× el período declarado.
    let dt_threshold_us = if s.config.sample_rate_declared_hz > 0.0 {
        (1_500_000.0 / s.config.sample_rate_declared_hz) as i64
    } else {
        i64::MAX
    };

    let mut line = String::with_capacity(128);
    for sm in samples {
        if let Some(prev) = s.last_timestamp_us {
            let dt = sm.timestamp_us - prev;
            if dt > 0 {
                if dt > dt_threshold_us && s.config.sample_rate_declared_hz > 0.0 {
                    let expected = 1_000_000.0 / s.config.sample_rate_declared_hz;
                    let lost = ((dt as f64 / expected).round() as i64 - 1).max(0);
                    s.samples_lost = s.samples_lost.saturating_add(lost as u64);
                }
                let dtf = dt as f64;
                s.dt_sum_us += dtf;
                s.dt_sq_sum_us += dtf * dtf;
                s.dt_count += 1;
            }
        }
        s.last_timestamp_us = Some(sm.timestamp_us);

        line.clear();
        use std::fmt::Write as _;
        let _ = write!(
            line,
            "{},{:.6},{:.6},{:.6},{:.6},{:.6},{:.6},{},{},{},{}\n",
            sm.timestamp_us,
            sm.gyro_x_dps, sm.gyro_y_dps, sm.gyro_z_dps,
            sm.accel_x_g, sm.accel_y_g, sm.accel_z_g,
            fmt_opt(sm.mag_x_ut), fmt_opt(sm.mag_y_ut), fmt_opt(sm.mag_z_ut),
            fmt_opt(sm.temp_c),
        );
        write_line(s, &line)?;
        s.samples_written += 1;
    }

    // Throttle de progreso a ~4 Hz: devolvemos un snapshot si toca emitir.
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let snapshot = if now_ms - s.last_emit_ms >= 250 {
        s.last_emit_ms = now_ms;
        Some(CaptureProgress {
            session_id: s.id.clone(),
            elapsed_s: s.elapsed_s(),
            total_s: s.config.duration_seconds as f64,
            samples_written: s.samples_written,
            samples_lost: s.samples_lost,
            bytes_written: s.bytes_written,
        })
    } else {
        None
    };

    Ok((s.samples_written, snapshot))
}

#[tauri::command]
pub fn append_samples(app: AppHandle, session_id: String, samples: Vec<Sample>) -> Result<u64, CaptureError> {
    let (written, snapshot) = append_samples_inner(&session_id, &samples)?;
    if let Some(prog) = snapshot {
        let _ = app.emit("capture://progress", prog);
    }
    Ok(written)
}

#[tauri::command]
pub fn get_capture_progress(session_id: String) -> Result<CaptureProgress, CaptureError> {
    let guard = ACTIVE.lock().unwrap();
    let s = guard
        .as_ref()
        .ok_or_else(|| CaptureError::new("NoActiveSession", "No hay captura activa"))?;
    if s.id != session_id {
        return Err(CaptureError::new("SessionMismatch", "session_id no coincide"));
    }
    Ok(CaptureProgress {
        session_id: s.id.clone(),
        elapsed_s: s.elapsed_s(),
        total_s: s.config.duration_seconds as f64,
        samples_written: s.samples_written,
        samples_lost: s.samples_lost,
        bytes_written: s.bytes_written,
    })
}

#[tauri::command]
pub fn stop_capture(session_id: String, status: Option<String>) -> Result<CaptureSummary, CaptureError> {
    let mut guard = ACTIVE.lock().unwrap();
    let mut s = guard
        .take()
        .ok_or_else(|| CaptureError::new("NoActiveSession", "No hay captura activa"))?;
    if s.id != session_id {
        // Reinsertar y devolver error.
        let id = s.id.clone();
        *guard = Some(s);
        return Err(CaptureError::new(
            "SessionMismatch",
            format!("session_id no coincide (activa: {})", id),
        ));
    }

    s.writer.flush()?;

    // Calcular hash sin mover el writer (que prestaría s); usamos replace.
    let hasher = std::mem::replace(&mut s.hasher, Sha256::new());
    let digest = hasher.finalize();
    let sha256_hex = digest.iter().map(|b| format!("{:02x}", b)).collect::<String>();

    let ended_at = Utc::now();
    let duration_s = (ended_at - s.started_at).num_milliseconds() as f64 / 1000.0;
    let status = status.unwrap_or_else(|| "complete".to_string());

    let mut metadata = HashMap::new();
    metadata.insert("schema_version", serde_json::json!("simhit-session-1.0"));
    metadata.insert("session_id", serde_json::json!(s.id));
    metadata.insert("type", serde_json::json!("static_capture"));
    metadata.insert("status", serde_json::json!(status));
    metadata.insert("started_at_utc", serde_json::json!(s.started_at.to_rfc3339()));
    metadata.insert("ended_at_utc", serde_json::json!(ended_at.to_rfc3339()));
    metadata.insert("duration_s", serde_json::json!(duration_s));
    metadata.insert("config", serde_json::json!({
        "duration_seconds": s.config.duration_seconds,
        "sensor_label": s.config.sensor_label,
        "ambient_temp_c_start": s.config.ambient_temp_c_start,
        "preheat_minutes": s.config.preheat_minutes,
        "serial_port": s.config.serial_port,
        "baud_rate": s.config.baud_rate,
        "sample_rate_declared_hz": s.config.sample_rate_declared_hz,
    }));
    metadata.insert("firmware", serde_json::json!({
        "version": s.config.firmware_version,
        "sensor": s.config.sensor_label,
        "sample_rate_declared_hz": s.config.sample_rate_declared_hz,
    }));
    metadata.insert("sampling_summary", serde_json::json!({
        "samples_written": s.samples_written,
        "samples_lost": s.samples_lost,
        "mean_dt_us": s.mean_dt_us(),
        "stdev_dt_us": s.stdev_dt_us(),
    }));
    metadata.insert("data_files", serde_json::json!({
        "raw.csv": {
            "sha256": sha256_hex,
            "size_bytes": s.bytes_written,
            "lines": s.samples_written + 1, // +1 por el header
        }
    }));

    let json_str = serde_json::to_string_pretty(&metadata)
        .map_err(|e| CaptureError::new("SerializeError", e.to_string()))?;
    std::fs::write(&s.metadata_path, json_str)?;

    // Marcar CSV como read-only (best-effort; en Windows puede fallar).
    if let Ok(meta) = std::fs::metadata(&s.csv_path) {
        let mut perms = meta.permissions();
        perms.set_readonly(true);
        let _ = std::fs::set_permissions(&s.csv_path, perms);
    }

    Ok(CaptureSummary {
        session_id: s.id.clone(),
        csv_path: s.csv_path.to_string_lossy().into_owned(),
        metadata_path: s.metadata_path.to_string_lossy().into_owned(),
        samples_written: s.samples_written,
        samples_lost: s.samples_lost,
        bytes_written: s.bytes_written,
        duration_s,
        csv_sha256: sha256_hex,
        status,
    })
}

// Para los tests E2E del frontend: limpia cualquier sesión zombie sin escribir
// metadata. No expuesto al frontend (uso interno y testing).
#[allow(dead_code)]
pub fn abort_active() {
    let mut g = ACTIVE.lock().unwrap();
    *g = None;
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;

    // Las pruebas comparten el estático ACTIVE; cargo test debe correr con
    // --test-threads=1 (lo fijamos en el workflow de CI). Aún así, cada test
    // limpia el estado antes y después para tolerar reordenamientos manuales.
    fn cleanup() { abort_active(); }

    fn tmp_dir() -> String {
        let mut p = std::env::temp_dir();
        p.push(format!("simhit-test-{}", Uuid::new_v4()));
        p.to_string_lossy().into_owned()
    }

    fn default_config(out: &str) -> StartCaptureConfig {
        StartCaptureConfig {
            duration_seconds: 60,
            output_dir: out.to_string(),
            sensor_label: "TEST-SENSOR".into(),
            ambient_temp_c_start: 22.0,
            preheat_minutes: 0,
            serial_port: "test".into(),
            baud_rate: 460800,
            sample_rate_declared_hz: 200.0,
            firmware_version: "0.0.0-test".into(),
        }
    }

    fn mksample(ts: i64, gx: f64) -> Sample {
        Sample {
            timestamp_us: ts,
            gyro_x_dps: gx, gyro_y_dps: 0.0, gyro_z_dps: 0.0,
            accel_x_g: 0.0, accel_y_g: 0.0, accel_z_g: 1.0,
            mag_x_ut: None, mag_y_ut: None, mag_z_ut: None,
            temp_c: None,
        }
    }

    #[test]
    fn roundtrip_csv_and_sha256() {
        cleanup();
        let dir = tmp_dir();
        let cfg = default_config(&dir);
        let s = start_static_capture(cfg).expect("start");
        let samples: Vec<Sample> = (0..1000).map(|i| mksample(i * 5000, (i as f64).sin())).collect();
        append_samples_inner(&s.id, &samples).expect("append");
        let sum = stop_capture(s.id.clone(), Some("complete".into())).expect("stop");

        assert_eq!(sum.samples_written, 1000);
        assert_eq!(sum.status, "complete");
        assert_eq!(sum.session_id, s.id);

        // Recalcular SHA-256 leyendo el archivo y compararlo con el reportado.
        let mut f = File::open(&sum.csv_path).expect("open csv");
        let mut buf = Vec::new();
        f.read_to_end(&mut buf).expect("read");
        let mut h = Sha256::new();
        h.update(&buf);
        let hex = h.finalize().iter().map(|b| format!("{:02x}", b)).collect::<String>();
        assert_eq!(hex, sum.csv_sha256, "hash recalculado debe coincidir");

        // Header exacto + número de líneas (header + 1000 muestras).
        let content = String::from_utf8(buf).expect("utf8");
        assert!(content.starts_with(CSV_HEADER), "header canónico");
        assert_eq!(content.lines().count(), 1001);

        // session.json existe y es JSON válido.
        let meta = std::fs::read_to_string(&sum.metadata_path).expect("meta");
        let v: serde_json::Value = serde_json::from_str(&meta).expect("json");
        assert_eq!(v["schema_version"], "simhit-session-1.0");
        assert_eq!(v["status"], "complete");
        assert_eq!(v["data_files"]["raw.csv"]["sha256"], sum.csv_sha256);

        cleanup();
    }

    #[test]
    fn gap_detection_counts_lost_samples() {
        cleanup();
        let dir = tmp_dir();
        let s = start_static_capture(default_config(&dir)).unwrap();
        // 100 muestras a 5000 µs, luego salto de ~3 muestras (20000 µs), 100 más.
        let mut samples = Vec::new();
        for i in 0..100 { samples.push(mksample(i * 5000, 0.0)); }
        let last = 99 * 5000;
        for i in 0..100 { samples.push(mksample(last + 20000 + i * 5000, 0.0)); }
        append_samples_inner(&s.id, &samples).unwrap();
        let sum = stop_capture(s.id, Some("complete".into())).unwrap();
        // El gap declarado fue 20000 µs / 5000 esperado = 4 → 3 muestras perdidas.
        assert_eq!(sum.samples_lost, 3);
        cleanup();
    }

    #[test]
    fn rejects_second_start_while_active() {
        cleanup();
        let dir = tmp_dir();
        let _ = start_static_capture(default_config(&dir)).unwrap();
        let err = start_static_capture(default_config(&dir)).unwrap_err();
        assert_eq!(err.code, "AlreadyRunning");
        cleanup();
    }

    #[test]
    fn rejects_append_with_wrong_session_id() {
        cleanup();
        let dir = tmp_dir();
        let _ = start_static_capture(default_config(&dir)).unwrap();
        let err = append_samples_inner("not-the-real-id", &[mksample(0, 0.0)]).unwrap_err();
        assert_eq!(err.code, "SessionMismatch");
        cleanup();
    }

    #[test]
    fn nan_for_optional_fields() {
        cleanup();
        let dir = tmp_dir();
        let s = start_static_capture(default_config(&dir)).unwrap();
        append_samples_inner(&s.id, &vec![mksample(0, 0.5)]).unwrap();
        let sum = stop_capture(s.id, Some("complete".into())).unwrap();
        let content = std::fs::read_to_string(&sum.csv_path).unwrap();
        let last = content.lines().last().unwrap();
        // mag y temp ausentes → últimos 4 campos deben ser NaN.
        let cols: Vec<&str> = last.split(',').collect();
        assert_eq!(cols.len(), 11);
        for c in &cols[7..] {
            assert_eq!(*c, "NaN", "campos opcionales sin valor deben serializarse como NaN");
        }
        cleanup();
    }
}
