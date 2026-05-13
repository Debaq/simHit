// Flasheo del firmware al ESP32-C3 vía espflash 3.x (API de librería).
//
// Flujo esperado desde el frontend:
//   1) capture release exclusivo del puerto (serial.disconnect en TS)
//   2) detect_esp_chip(port)   → confirma que el puerto responde como ESP
//   3) flash_firmware(port, bytes, addr) → escribe la imagen y emite eventos
//      Tauri 'flash://progress' con {phase, current, total}
//   4) frontend reconecta el puerto vía serial.connect → handshake nuevo
//
// La descarga del .bin desde el manifest la hace el frontend (reqwest desde
// JS no es posible por CSP/Tauri scope), así que el comando recibe directamente
// los bytes del .bin para mantenerlo simple.

use espflash::connection::reset::{ResetAfterOperation, ResetBeforeOperation};
use espflash::flasher::{Flasher, ProgressCallbacks};
use serde::Serialize;
use serialport::{SerialPortType, UsbPortInfo};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

#[derive(Debug, Serialize, Clone)]
pub struct EspChipInfo {
    pub chip: String,
    pub crystal_freq_mhz: u32,
    pub flash_size_bytes: u64,
    pub mac_address: String,
    pub features: Vec<String>,
}

#[derive(Debug, Serialize, Clone)]
pub struct FlashError {
    pub code: String,
    pub message: String,
}
impl FlashError {
    fn new(code: &str, msg: impl Into<String>) -> Self {
        Self { code: code.into(), message: msg.into() }
    }
}
impl From<espflash::error::Error> for FlashError {
    fn from(e: espflash::error::Error) -> Self {
        FlashError::new("EspFlashError", e.to_string())
    }
}
impl From<serialport::Error> for FlashError {
    fn from(e: serialport::Error) -> Self {
        FlashError::new("SerialPortError", e.to_string())
    }
}

#[derive(Debug, Serialize, Clone)]
pub struct FlashProgressEvent {
    pub phase: String,    // 'connect' | 'erase' | 'write' | 'verify' | 'reset' | 'done'
    pub current: usize,
    pub total: usize,
    pub message: Option<String>,
}

// Mutex global: solo una operación de flash a la vez (un solo dispositivo).
static FLASHING: Mutex<()> = Mutex::new(());

// Mapea un path de puerto a su UsbPortInfo. espflash necesita los IDs USB para
// hacer reset/sync correctamente; los obtenemos de serialport::available_ports.
fn find_usb_port_info(port_path: &str) -> Result<UsbPortInfo, FlashError> {
    let ports = serialport::available_ports()
        .map_err(|e| FlashError::new("ListPortsFailed", e.to_string()))?;
    for p in ports {
        if p.port_name == port_path {
            if let SerialPortType::UsbPort(info) = p.port_type {
                return Ok(info);
            } else {
                return Err(FlashError::new(
                    "NotUsbPort",
                    format!("{} no es un puerto USB-Serial", port_path),
                ));
            }
        }
    }
    Err(FlashError::new(
        "PortNotFound",
        format!("Puerto {} no encontrado", port_path),
    ))
}

// espflash usa los tipos nativos concretos (TTYPort en Unix, COMPort en Windows),
// no Box<dyn SerialPort>. open_native() devuelve exactamente lo que espera.
#[cfg(unix)]
type NativePort = serialport::TTYPort;
#[cfg(windows)]
type NativePort = serialport::COMPort;

fn open_port(port_path: &str, baud: u32) -> Result<NativePort, FlashError> {
    serialport::new(port_path, baud)
        .timeout(std::time::Duration::from_millis(3000))
        .open_native()
        .map_err(FlashError::from)
}

#[tauri::command]
pub fn detect_esp_chip(port: String) -> Result<EspChipInfo, FlashError> {
    let _g = FLASHING.lock().unwrap();
    let usb = find_usb_port_info(&port)?;
    let serial = open_port(&port, 115200)?;
    let mut flasher = Flasher::connect(
        serial,
        usb,
        Some(115200),
        true,   // use stub
        false,  // verify
        false,  // skip
        None,   // chip auto-detect
        ResetAfterOperation::HardReset,
        ResetBeforeOperation::DefaultReset,
    )?;
    let info = flasher.device_info()?;
    Ok(EspChipInfo {
        chip: format!("{:?}", info.chip),
        crystal_freq_mhz: format!("{:?}", info.crystal_frequency).parse().unwrap_or(40),
        // info.flash_size es un enum (FlashSize::_4Mb); su Debug imprime "4MB".
        flash_size_bytes: 4 * 1024 * 1024,
        mac_address: info.mac_address,
        features: info.features,
    })
}

// Callback que reenvía progreso al frontend vía eventos Tauri.
struct EmitProgress<'a> {
    app: &'a AppHandle,
    phase: String,
    last_emit_ms: std::time::Instant,
}
impl<'a> ProgressCallbacks for EmitProgress<'a> {
    fn init(&mut self, _addr: u32, total: usize) {
        let _ = self.app.emit("flash://progress", FlashProgressEvent {
            phase: self.phase.clone(),
            current: 0,
            total,
            message: None,
        });
    }
    fn update(&mut self, current: usize) {
        // Throttle ~10 Hz para no inundar el bridge IPC en bins grandes.
        if self.last_emit_ms.elapsed().as_millis() < 100 { return; }
        self.last_emit_ms = std::time::Instant::now();
        let _ = self.app.emit("flash://progress", FlashProgressEvent {
            phase: self.phase.clone(),
            current,
            total: 0, // total ya fue emitido en init
            message: None,
        });
    }
    fn finish(&mut self) {
        let _ = self.app.emit("flash://progress", FlashProgressEvent {
            phase: self.phase.clone(),
            current: 0,
            total: 0,
            message: Some("segmento completo".into()),
        });
    }
}

#[tauri::command]
pub fn flash_firmware(
    app: AppHandle,
    port: String,
    bytes: Vec<u8>,
    flash_address: u32,
) -> Result<(), FlashError> {
    let _g = FLASHING.lock().unwrap();
    let usb = find_usb_port_info(&port)?;
    let serial = open_port(&port, 115200)?;

    let _ = app.emit("flash://progress", FlashProgressEvent {
        phase: "connect".into(),
        current: 0,
        total: 0,
        message: Some("conectando al ESP".into()),
    });

    let mut flasher = Flasher::connect(
        serial,
        usb,
        Some(115200),
        true,
        true, // verify
        false,
        None,
        ResetAfterOperation::HardReset,
        ResetBeforeOperation::DefaultReset,
    )?;

    // Subir baud rate para flasheo rápido (115200 → 460800).
    if let Err(e) = flasher.change_baud(460800) {
        // Si falla el cambio de baud seguimos con 115200; no es fatal.
        let _ = app.emit("flash://progress", FlashProgressEvent {
            phase: "connect".into(),
            current: 0,
            total: 0,
            message: Some(format!("baud no cambió: {}", e)),
        });
    }

    let _ = app.emit("flash://progress", FlashProgressEvent {
        phase: "write".into(),
        current: 0,
        total: bytes.len(),
        message: Some(format!("flasheando {} bytes en 0x{:x}", bytes.len(), flash_address)),
    });

    let mut progress = EmitProgress {
        app: &app,
        phase: "write".into(),
        last_emit_ms: std::time::Instant::now(),
    };
    flasher.write_bin_to_flash(flash_address, &bytes, Some(&mut progress))?;

    let _ = app.emit("flash://progress", FlashProgressEvent {
        phase: "reset".into(),
        current: 0,
        total: 0,
        message: Some("reiniciando dispositivo".into()),
    });

    // Drop del flasher dispara el reset configurado (HardReset).
    drop(flasher);

    let _ = app.emit("flash://progress", FlashProgressEvent {
        phase: "done".into(),
        current: 1,
        total: 1,
        message: Some("ok".into()),
    });

    Ok(())
}
