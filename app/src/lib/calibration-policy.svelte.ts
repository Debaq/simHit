// Política de re-CAL: cuándo advertir al usuario que la calibración IMU
// está demasiado vieja o que la temperatura del chip cambió tanto que el
// bias persistido ya no es confiable.
//
// Pura derivación reactiva sobre serial.imuCal + serial.fwTimestamp +
// serial.currentTempC. No persiste nada propio.

import { serial } from './serial.svelte';

// Umbrales por defecto. Bibliografía típica de IMUs MEMS reporta bias
// térmico ~0.01-0.05 °/s por °C; 3 °C ya genera deltas detectables.
// 30 min es lo que suele recomendar la literatura vHIT entre re-zeros
// (e.g. GN Otometrics user manuals).
export const MAX_CAL_AGE_S = 30 * 60;       // 30 minutos
export const MAX_THERMAL_DRIFT_C = 3.0;     // °C
// Si la cal tiene < este tiempo, la consideramos "fresca" sin importar
// temp (caso recién-CAL: la temp todavía no se estabilizó).
const FRESH_GRACE_S = 60;

export type CalStatus =
  | 'no-cal'         // nunca se calibró (o se limpió con IMU CLR)
  | 'unknown'        // SimHIT no conectado, o firmware viejo sin IMU CAL JSON
  | 'fresh'          // < 60 s desde la CAL — válida, sin chequear temp
  | 'ok'             // age < MAX_CAL_AGE_S y |ΔT| < MAX_THERMAL_DRIFT_C
  | 'aged'           // age >= MAX_CAL_AGE_S
  | 'thermal-drift'; // |ΔT| >= MAX_THERMAL_DRIFT_C (independiente de age)

// Snapshot de la política para el UI. Todo derivado.
export type CalPolicy = {
  status: CalStatus;
  age_s: number | null;
  thermal_drift_c: number | null;
  message: string | null;   // texto para banner; null si status='ok' o 'fresh'
};

export function getCalPolicy(): CalPolicy {
  if (!serial.connected) {
    return { status: 'unknown', age_s: null, thermal_drift_c: null, message: null };
  }
  const cal = serial.imuCal;
  if (!cal) {
    return {
      status: 'no-cal',
      age_s: null,
      thermal_drift_c: null,
      message: 'El sensor no tiene calibración. Ejecute IMU CAL antes del examen.',
    };
  }
  // Edad: usamos el reloj del firmware (millis) para evitar dependencia del
  // reloj wall-clock del host.
  const now_ms = serial.fwTimestamp || cal.now_ms || Date.now();
  const age_s = Math.max(0, (now_ms - cal.cal_ts_ms) / 1000);
  const thermal_drift_c = Number.isFinite(serial.currentTempC) && Number.isFinite(cal.temp_c ?? NaN)
    ? Math.abs(serial.currentTempC - (cal.temp_c as number))
    : null;

  if (age_s < FRESH_GRACE_S) {
    return { status: 'fresh', age_s, thermal_drift_c, message: null };
  }
  if (age_s >= MAX_CAL_AGE_S) {
    const min = Math.floor(age_s / 60);
    return {
      status: 'aged',
      age_s, thermal_drift_c,
      message: `La calibración tiene ${min} min. Recomendado recalibrar (umbral ${Math.floor(MAX_CAL_AGE_S/60)} min).`,
    };
  }
  if (thermal_drift_c !== null && thermal_drift_c >= MAX_THERMAL_DRIFT_C) {
    return {
      status: 'thermal-drift',
      age_s, thermal_drift_c,
      message: `Temperatura del chip cambió ${thermal_drift_c.toFixed(1)} °C desde la CAL (umbral ${MAX_THERMAL_DRIFT_C} °C). El bias del giroscopio puede haber derivado — recalibre.`,
    };
  }
  return { status: 'ok', age_s, thermal_drift_c, message: null };
}
