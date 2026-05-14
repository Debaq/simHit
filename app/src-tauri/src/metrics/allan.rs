// Overlapping Allan variance para los 3 ejes del giroscopio.
//
// Implementación según docs/trabajo_metricas.md §2.2:
//   θ_i = Σ ω_i · τ_0  (suma acumulada)
//   σ²(τ) = Σ (θ[i+2m] - 2·θ[i+m] + θ[i])² / (2·τ²·(N-2m))
// donde m = τ/τ_0. Esta forma es estándar IEEE 1554/1139 y permite recorrer
// todos los τ con O(N·n_points) sumas, sin recomputar los promedios de cluster.
//
// Extracción de ARW: ajuste por mínimos cuadrados de la recta de pendiente
// -1/2 en log-log para τ ∈ [1, 10]s; lectura en τ=1s; ARW [°/√h] = σ(1s)·√3600.
// Extracción de BI: σ_min · (1/0.664).

use crate::metrics::sampling::AnalysisError;
use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::{BufRead, BufReader};

#[derive(Debug, Deserialize)]
pub struct AllanConfig {
    pub csv_path: String,
    pub min_tau_s: f64,
    pub max_tau_s: f64,
    pub n_points: usize,
}

#[derive(Debug, Serialize, Clone)]
pub struct AllanResult {
    pub tau_s: Vec<f64>,
    pub sigma_x_dps: Vec<f64>,
    pub sigma_y_dps: Vec<f64>,
    pub sigma_z_dps: Vec<f64>,
    pub arw_deg_sqrt_hr: [f64; 3],
    pub bias_instability_deg_hr: [f64; 3],
    pub tau_at_min_s: [f64; 3],
    pub n_samples_total: u64,
    pub duration_s: f64,
    pub sample_rate_hz: f64,
}

#[tauri::command]
pub fn analyze_allan_variance(config: AllanConfig) -> Result<AllanResult, AnalysisError> {
    let (timestamps, gx, gy, gz) = load_gyro_csv(&config.csv_path)?;
    compute_allan(&timestamps, &gx, &gy, &gz, config.min_tau_s, config.max_tau_s, config.n_points)
}

// Núcleo del cómputo: aceptaba el wrapper CSV-based + el endpoint in-place
// usado por el Allan corto post-CAL. Acá no se hace I/O.
pub fn compute_allan(
    timestamps: &[i64],
    gx: &[f64],
    gy: &[f64],
    gz: &[f64],
    min_tau_s: f64,
    max_tau_s: f64,
    n_points: usize,
) -> Result<AllanResult, AnalysisError> {
    let n = timestamps.len();
    if n < 16 {
        return Err(AnalysisError::new("NotEnoughSamples", "Se necesitan al menos 16 muestras"));
    }
    if gx.len() != n || gy.len() != n || gz.len() != n {
        return Err(AnalysisError::new("ShapeMismatch", "Vectores de longitudes distintas"));
    }

    let duration_s = (timestamps[n - 1] - timestamps[0]) as f64 / 1.0e6;
    let fs = (n as f64 - 1.0) / duration_s.max(1e-9);
    let tau_0 = 1.0 / fs;

    // Generar τ log-espaciado y mapear a cluster sizes m enteros únicos.
    let lmin = min_tau_s.max(tau_0).ln();
    let lmax = max_tau_s.min(duration_s / 2.5).ln();
    if lmax <= lmin {
        return Err(AnalysisError::new("BadRange", "max_tau_s debe ser > min_tau_s"));
    }
    let mut ms: Vec<usize> = Vec::with_capacity(n_points);
    let mut seen_last: usize = 0;
    for i in 0..n_points {
        let tau = (lmin + (lmax - lmin) * (i as f64 / (n_points as f64 - 1.0).max(1.0))).exp();
        let m = (tau / tau_0).round() as usize;
        if m >= 1 && m != seen_last && 2 * m < n {
            ms.push(m);
            seen_last = m;
        }
    }
    if ms.is_empty() {
        return Err(AnalysisError::new("EmptyTauGrid", "No se generaron clusters válidos"));
    }

    // Sumas acumuladas por eje. theta[0] = 0; theta[i] = Σ_{k<i} ω_k · τ_0.
    let theta_x = cumsum_times(gx, tau_0);
    let theta_y = cumsum_times(gy, tau_0);
    let theta_z = cumsum_times(gz, tau_0);

    let mut tau_s = Vec::with_capacity(ms.len());
    let mut sig_x = Vec::with_capacity(ms.len());
    let mut sig_y = Vec::with_capacity(ms.len());
    let mut sig_z = Vec::with_capacity(ms.len());

    for &m in &ms {
        let tau = m as f64 * tau_0;
        let s_x = overlapping_sigma(&theta_x, m, tau);
        let s_y = overlapping_sigma(&theta_y, m, tau);
        let s_z = overlapping_sigma(&theta_z, m, tau);
        tau_s.push(tau);
        sig_x.push(s_x);
        sig_y.push(s_y);
        sig_z.push(s_z);
    }

    let arw = [
        extract_arw(&tau_s, &sig_x),
        extract_arw(&tau_s, &sig_y),
        extract_arw(&tau_s, &sig_z),
    ];
    let (bi_x, tmin_x) = extract_bias_instability(&tau_s, &sig_x);
    let (bi_y, tmin_y) = extract_bias_instability(&tau_s, &sig_y);
    let (bi_z, tmin_z) = extract_bias_instability(&tau_s, &sig_z);

    Ok(AllanResult {
        tau_s,
        sigma_x_dps: sig_x,
        sigma_y_dps: sig_y,
        sigma_z_dps: sig_z,
        arw_deg_sqrt_hr: arw,
        bias_instability_deg_hr: [bi_x, bi_y, bi_z],
        tau_at_min_s: [tmin_x, tmin_y, tmin_z],
        n_samples_total: n as u64,
        duration_s,
        sample_rate_hz: fs,
    })
}

// Allan corto in-situ: el cliente acumula muestras durante N segundos
// post-IMU-CAL con el sensor estático y se las pasa al backend. Diferencia
// con analyze_allan_variance: no hay CSV, las muestras viven en memoria.
#[derive(Debug, serde::Deserialize)]
pub struct AllanInPlaceConfig {
    pub timestamps_us: Vec<i64>,
    pub gx_dps: Vec<f64>,
    pub gy_dps: Vec<f64>,
    pub gz_dps: Vec<f64>,
    pub min_tau_s: f64,
    pub max_tau_s: f64,
    pub n_points: usize,
}

#[tauri::command]
pub fn analyze_allan_in_place(config: AllanInPlaceConfig) -> Result<AllanResult, AnalysisError> {
    compute_allan(
        &config.timestamps_us,
        &config.gx_dps, &config.gy_dps, &config.gz_dps,
        config.min_tau_s, config.max_tau_s, config.n_points,
    )
}

fn cumsum_times(v: &[f64], factor: f64) -> Vec<f64> {
    let mut out = Vec::with_capacity(v.len() + 1);
    out.push(0.0);
    let mut acc = 0.0;
    for &x in v {
        acc += x * factor;
        out.push(acc);
    }
    out
}

// σ(τ) overlapping a partir de theta. N = len(omega) = theta.len() - 1.
fn overlapping_sigma(theta: &[f64], m: usize, tau: f64) -> f64 {
    let n_omega = theta.len() - 1;
    let upper = n_omega.saturating_sub(2 * m);
    if upper == 0 { return 0.0; }
    let mut acc = 0.0;
    for i in 0..upper {
        let d = theta[i + 2 * m] - 2.0 * theta[i + m] + theta[i];
        acc += d * d;
    }
    let denom = 2.0 * tau * tau * upper as f64;
    (acc / denom).sqrt()
}

// ARW [°/√h]: ajuste de recta log σ = a + b · log τ con b fijo en -1/2 sobre
// el rango τ ∈ [1, 10] s. σ(1s) [°/s] · √3600 → °/√h.
fn extract_arw(tau: &[f64], sigma: &[f64]) -> f64 {
    let mut acc_a = 0.0;
    let mut n = 0;
    for (&t, &s) in tau.iter().zip(sigma.iter()) {
        if t >= 1.0 && t <= 10.0 && s > 0.0 {
            // log σ = a + (-1/2) log τ → a = log σ + 0.5 log τ
            acc_a += s.log10() + 0.5 * t.log10();
            n += 1;
        }
    }
    if n == 0 {
        // Fallback: usar el punto más cercano a 1 s si quedó fuera de rango.
        let (mut best_i, mut best_d) = (0usize, f64::INFINITY);
        for (i, &t) in tau.iter().enumerate() {
            let d = (t - 1.0).abs();
            if d < best_d { best_d = d; best_i = i; }
        }
        let sigma_1s = sigma[best_i].max(0.0);
        return sigma_1s * (3600.0_f64).sqrt();
    }
    let a = acc_a / n as f64;
    let sigma_1s = 10f64.powf(a);
    sigma_1s * (3600.0_f64).sqrt()
}

// BI [°/h]: σ_min · (1/0.664) · 3600. Retorna (bi, τ_min).
fn extract_bias_instability(tau: &[f64], sigma: &[f64]) -> (f64, f64) {
    let mut min_i = 0usize;
    let mut min_v = f64::INFINITY;
    for (i, &s) in sigma.iter().enumerate() {
        if s > 0.0 && s < min_v { min_v = s; min_i = i; }
    }
    if !min_v.is_finite() { return (0.0, 0.0); }
    let bi = min_v * (1.0 / 0.664) * 3600.0;
    (bi, tau[min_i])
}

// Carga timestamps + gyro 3-ejes del CSV canónico.
fn load_gyro_csv(path: &str) -> Result<(Vec<i64>, Vec<f64>, Vec<f64>, Vec<f64>), AnalysisError> {
    let f = File::open(path)?;
    let mut rdr = BufReader::new(f);
    let mut header = String::new();
    rdr.read_line(&mut header)?;
    if !header.starts_with("timestamp_us,gyro_x_dps,gyro_y_dps,gyro_z_dps") {
        return Err(AnalysisError::new("BadHeader", "CSV no tiene el header canónico"));
    }
    let mut ts = Vec::with_capacity(1 << 16);
    let mut gx = Vec::with_capacity(1 << 16);
    let mut gy = Vec::with_capacity(1 << 16);
    let mut gz = Vec::with_capacity(1 << 16);
    for line in rdr.lines() {
        let line = line?;
        if line.is_empty() { continue; }
        let mut it = line.split(',');
        let t: i64 = match it.next().and_then(|s| s.parse().ok()) {
            Some(v) => v,
            None => continue,
        };
        let x: f64 = it.next().and_then(|s| s.parse().ok()).unwrap_or(f64::NAN);
        let y: f64 = it.next().and_then(|s| s.parse().ok()).unwrap_or(f64::NAN);
        let z: f64 = it.next().and_then(|s| s.parse().ok()).unwrap_or(f64::NAN);
        if !x.is_finite() || !y.is_finite() || !z.is_finite() { continue; }
        ts.push(t);
        gx.push(x);
        gy.push(y);
        gz.push(z);
    }
    Ok((ts, gx, gy, gz))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    // LCG determinístico → no necesitamos rand como dep, y los tests son
    // reproducibles bit a bit en CI sin importar la plataforma.
    struct Lcg(u64);
    impl Lcg {
        fn next_uniform(&mut self) -> f64 {
            self.0 = self.0.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
            ((self.0 >> 33) as f64) / ((1u64 << 31) as f64)
        }
        // Aproximación Box-Muller para muestra gaussiana N(0,1).
        fn next_normal(&mut self) -> f64 {
            let u1 = self.next_uniform().max(1e-12);
            let u2 = self.next_uniform();
            (-2.0 * u1.ln()).sqrt() * (2.0 * std::f64::consts::PI * u2).cos()
        }
    }

    fn write_csv(samples: &[(i64, f64, f64, f64)]) -> String {
        let mut p = std::env::temp_dir();
        p.push(format!("simhit-allan-test-{}.csv", uuid::Uuid::new_v4()));
        let mut f = File::create(&p).unwrap();
        writeln!(f, "timestamp_us,gyro_x_dps,gyro_y_dps,gyro_z_dps,accel_x_g,accel_y_g,accel_z_g,mag_x_uT,mag_y_uT,mag_z_uT,temp_c").unwrap();
        for (t, x, y, z) in samples {
            writeln!(f, "{},{:.6},{:.6},{:.6},0,0,1,NaN,NaN,NaN,NaN", t, x, y, z).unwrap();
        }
        p.to_string_lossy().into_owned()
    }

    #[test]
    fn white_noise_has_negative_half_slope() {
        // 60 s a 200 Hz = 12 000 muestras de ruido blanco σ = 0.5 °/s.
        let mut rng = Lcg(0xC0FFEE);
        let n = 12_000usize;
        let fs = 200.0;
        let sigma = 0.5;
        let dt_us = (1.0e6 / fs) as i64;
        let samples: Vec<(i64, f64, f64, f64)> = (0..n)
            .map(|i| {
                let t = (i as i64) * dt_us;
                (t, sigma * rng.next_normal(), sigma * rng.next_normal(), sigma * rng.next_normal())
            })
            .collect();
        let path = write_csv(&samples);
        let r = analyze_allan_variance(AllanConfig {
            csv_path: path,
            min_tau_s: 0.01,
            max_tau_s: 5.0,
            n_points: 40,
        }).unwrap();

        // Para ruido blanco σ(τ) ∝ τ^(-1/2). Ajustamos pendiente log-log sobre
        // el rango utilizable y verificamos que sea cercana a -0.5.
        let logs: Vec<(f64, f64)> = r.tau_s.iter().zip(r.sigma_x_dps.iter())
            .filter(|(_, s)| **s > 0.0)
            .map(|(t, s)| (t.log10(), s.log10()))
            .collect();
        assert!(logs.len() >= 10);
        let n_f = logs.len() as f64;
        let mean_x = logs.iter().map(|(x, _)| x).sum::<f64>() / n_f;
        let mean_y = logs.iter().map(|(_, y)| y).sum::<f64>() / n_f;
        let num: f64 = logs.iter().map(|(x, y)| (x - mean_x) * (y - mean_y)).sum();
        let den: f64 = logs.iter().map(|(x, _)| (x - mean_x).powi(2)).sum();
        let slope = num / den;
        // Tolerancia amplia: 12k muestras tienen ruido estadístico en τ grandes.
        assert!((slope + 0.5).abs() < 0.15, "pendiente ≈ -0.5, fue {}", slope);
    }

    #[test]
    fn deterministic_repeated_runs() {
        let samples: Vec<(i64, f64, f64, f64)> = (0..4000)
            .map(|i| (i as i64 * 5000, ((i as f64) * 0.01).sin() * 0.1, 0.0, 0.0))
            .collect();
        let path = write_csv(&samples);
        let cfg1 = AllanConfig { csv_path: path.clone(), min_tau_s: 0.01, max_tau_s: 1.0, n_points: 30 };
        let cfg2 = AllanConfig { csv_path: path, min_tau_s: 0.01, max_tau_s: 1.0, n_points: 30 };
        let r1 = analyze_allan_variance(cfg1).unwrap();
        let r2 = analyze_allan_variance(cfg2).unwrap();
        assert_eq!(r1.sigma_x_dps, r2.sigma_x_dps);
        assert_eq!(r1.arw_deg_sqrt_hr, r2.arw_deg_sqrt_hr);
        assert_eq!(r1.bias_instability_deg_hr, r2.bias_instability_deg_hr);
    }

    #[test]
    fn rejects_short_csv() {
        let samples: Vec<(i64, f64, f64, f64)> = (0..5).map(|i| (i as i64 * 5000, 0.0, 0.0, 0.0)).collect();
        let err = analyze_allan_variance(AllanConfig {
            csv_path: write_csv(&samples),
            min_tau_s: 0.01,
            max_tau_s: 1.0,
            n_points: 10,
        }).unwrap_err();
        assert_eq!(err.code, "NotEnoughSamples");
    }
}
