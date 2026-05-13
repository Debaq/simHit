// Análisis de timestamps del CSV generado por capture.rs.
//
// Calcula frecuencia efectiva, jitter, percentiles, histograma de Δt, y
// estima muestras perdidas. Criterio vHIT: ≥ 200 Hz y jitter < 10% del período.
//
// Especificado en docs/trabajo_metricas.md §2.3.

use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::{BufRead, BufReader};

#[derive(Debug, Deserialize)]
pub struct SamplingConfig {
    pub csv_path: String,
    pub declared_hz: f64,
}

#[derive(Debug, Serialize, Clone)]
pub struct SamplingResult {
    pub declared_hz: f64,
    pub measured_hz: f64,
    pub mean_dt_us: f64,
    pub stdev_dt_us: f64,
    pub p50_dt_us: f64,
    pub p99_dt_us: f64,
    pub max_dt_us: f64,
    pub samples_lost_estimate: u64,
    pub histogram_dt_us: Vec<(f64, u64)>,
    pub n_samples: u64,
    pub passes_vhit_criterion: bool,
}

#[derive(Debug, Serialize, Clone)]
pub struct AnalysisError {
    pub code: String,
    pub message: String,
}
impl AnalysisError {
    pub fn new(code: &str, msg: impl Into<String>) -> Self {
        Self { code: code.into(), message: msg.into() }
    }
}
impl From<std::io::Error> for AnalysisError {
    fn from(e: std::io::Error) -> Self { AnalysisError::new("IoError", e.to_string()) }
}

// Carga la columna timestamp_us del CSV. Asume header canónico de capture.rs.
pub(crate) fn load_timestamps(csv_path: &str) -> Result<Vec<i64>, AnalysisError> {
    let f = File::open(csv_path)?;
    let mut rdr = BufReader::new(f);
    let mut header = String::new();
    rdr.read_line(&mut header)?;
    if !header.starts_with("timestamp_us,") {
        return Err(AnalysisError::new("BadHeader", "CSV no tiene el header canónico"));
    }
    let mut out = Vec::with_capacity(1 << 16);
    for line in rdr.lines() {
        let line = line?;
        if line.is_empty() { continue; }
        let comma = line.find(',').ok_or_else(|| AnalysisError::new("BadLine", "Fila sin coma"))?;
        let ts: i64 = line[..comma].parse()
            .map_err(|_| AnalysisError::new("BadTimestamp", format!("Timestamp no parseable: {}", &line[..comma])))?;
        out.push(ts);
    }
    Ok(out)
}

#[tauri::command]
pub fn analyze_sampling(config: SamplingConfig) -> Result<SamplingResult, AnalysisError> {
    let ts = load_timestamps(&config.csv_path)?;
    if ts.len() < 2 {
        return Err(AnalysisError::new("NotEnoughSamples", "Se necesitan al menos 2 muestras"));
    }

    let mut dts: Vec<f64> = Vec::with_capacity(ts.len() - 1);
    for w in ts.windows(2) {
        let d = (w[1] - w[0]) as f64;
        if d > 0.0 { dts.push(d); }
    }
    if dts.is_empty() {
        return Err(AnalysisError::new("NonMonotonic", "Timestamps no monotónicos"));
    }

    let n = dts.len() as f64;
    let mean = dts.iter().sum::<f64>() / n;
    let var = dts.iter().map(|x| (x - mean).powi(2)).sum::<f64>() / n;
    let stdev = var.sqrt();

    let mut sorted = dts.clone();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let pct = |q: f64| -> f64 {
        let idx = ((sorted.len() - 1) as f64 * q).round() as usize;
        sorted[idx]
    };
    let p50 = pct(0.50);
    let p99 = pct(0.99);
    let max = *sorted.last().unwrap();

    let measured_hz = 1.0e6 / mean;

    // Detección de gaps: Δt > 1.5× período declarado.
    let mut lost: u64 = 0;
    if config.declared_hz > 0.0 {
        let period_us = 1.0e6 / config.declared_hz;
        let thr = period_us * 1.5;
        for d in &dts {
            if *d > thr {
                let extra = (d / period_us).round() as i64 - 1;
                if extra > 0 { lost += extra as u64; }
            }
        }
    }

    // Histograma: 40 bins entre p1 y p99 (acota outliers visualmente).
    let lo = pct(0.01).max(0.0);
    let hi = p99 * 1.05;
    let nbins = 40usize;
    let mut bins = vec![0u64; nbins];
    let step = ((hi - lo) / nbins as f64).max(1.0);
    for d in &dts {
        let i = (((d - lo) / step).floor() as isize).clamp(0, nbins as isize - 1) as usize;
        bins[i] += 1;
    }
    let histogram: Vec<(f64, u64)> = bins.into_iter().enumerate()
        .map(|(i, c)| (lo + step * (i as f64 + 0.5), c))
        .collect();

    let passes = config.declared_hz > 0.0
        && measured_hz >= config.declared_hz * 0.99
        && stdev < (1.0e6 / config.declared_hz) * 0.10;

    Ok(SamplingResult {
        declared_hz: config.declared_hz,
        measured_hz,
        mean_dt_us: mean,
        stdev_dt_us: stdev,
        p50_dt_us: p50,
        p99_dt_us: p99,
        max_dt_us: max,
        samples_lost_estimate: lost,
        histogram_dt_us: histogram,
        n_samples: ts.len() as u64,
        passes_vhit_criterion: passes,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn write_csv(timestamps: &[i64]) -> String {
        let mut p = std::env::temp_dir();
        p.push(format!("simhit-sampling-test-{}.csv", uuid::Uuid::new_v4()));
        let mut f = File::create(&p).unwrap();
        writeln!(f, "timestamp_us,gyro_x_dps,gyro_y_dps,gyro_z_dps,accel_x_g,accel_y_g,accel_z_g,mag_x_uT,mag_y_uT,mag_z_uT,temp_c").unwrap();
        for &t in timestamps {
            writeln!(f, "{},0.0,0.0,0.0,0.0,0.0,1.0,NaN,NaN,NaN,NaN", t).unwrap();
        }
        p.to_string_lossy().into_owned()
    }

    #[test]
    fn perfect_timestamps_zero_jitter() {
        let ts: Vec<i64> = (0..1000).map(|i| i * 5000).collect();
        let path = write_csv(&ts);
        let r = analyze_sampling(SamplingConfig { csv_path: path, declared_hz: 200.0 }).unwrap();
        assert!((r.measured_hz - 200.0).abs() < 0.01, "fs medida ≈ 200 Hz");
        assert_eq!(r.stdev_dt_us, 0.0);
        assert_eq!(r.samples_lost_estimate, 0);
        assert!(r.passes_vhit_criterion);
        assert_eq!(r.n_samples, 1000);
    }

    #[test]
    fn detects_single_gap() {
        // 100 muestras, gap de 4 períodos, 100 más.
        let mut ts: Vec<i64> = (0..100).map(|i| i * 5000).collect();
        let last = *ts.last().unwrap();
        ts.push(last + 20000); // 4× período = perdió 3 muestras
        for i in 1..100 { ts.push(last + 20000 + i * 5000); }
        let r = analyze_sampling(SamplingConfig { csv_path: write_csv(&ts), declared_hz: 200.0 }).unwrap();
        assert_eq!(r.samples_lost_estimate, 3);
        assert!(r.max_dt_us >= 20000.0);
    }

    #[test]
    fn rejects_non_canonical_header() {
        let mut p = std::env::temp_dir();
        p.push(format!("bad-header-{}.csv", uuid::Uuid::new_v4()));
        let mut f = File::create(&p).unwrap();
        writeln!(f, "ts,gx,gy,gz").unwrap();
        let err = analyze_sampling(SamplingConfig {
            csv_path: p.to_string_lossy().into_owned(),
            declared_hz: 200.0,
        }).unwrap_err();
        assert_eq!(err.code, "BadHeader");
    }
}
