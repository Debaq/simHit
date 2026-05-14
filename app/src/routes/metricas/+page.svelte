<script lang="ts">
  import TopBar from '$lib/components/TopBar.svelte';
  import { serial } from '$lib/serial.svelte';
  import { capture } from '$lib/capture.svelte';
  import { analysis } from '$lib/analysis.svelte';
  import { synthetic } from '$lib/synthetic.svelte';
  import { acceptance } from '$lib/acceptance.svelte';
  import { firmware } from '$lib/firmware.svelte';
  import { flash } from '$lib/flash.svelte';
  import { allanInPlace } from '$lib/allan-inplace.svelte';
  import { getCalPolicy } from '$lib/calibration-policy.svelte';
  import { biasDrift } from '$lib/bias-drift.svelte';
  import { onMount } from 'svelte';

  // Vista de Métricas / Caracterización. La sección "Captura" usa el módulo
  // real (src-tauri/src/metrics/capture.rs). Flash, análisis y perfil siguen
  // como mockup hasta que se implementen los módulos correspondientes.

  type Step = 'flash' | 'detect' | 'capture' | 'analysis' | 'profile';
  let step = $state<Step>('flash');

  // 1) Firmware — chequeo de versión y actualizaciones. El flasheo real
  // (espflash + .bin embebido o descargado) es el último componente del
  // módulo de métricas; por ahora solo detectamos versión y advertimos.

  // Consultar el manifest + listar puertos USB al montar la vista.
  // Arrancar el monitor de drift del bias (no estorba al simulador: solo
  // engancha al captureSink y lee el stream gyro existente).
  onMount(() => {
    void firmware.check(false);
    void refreshUsbPorts();
    biasDrift.start();
    return () => biasDrift.stop();
  });

  // Política de re-CAL — derivada de serial.imuCal + temperatura corriente.
  // Se re-evalúa automáticamente cuando cambian los inputs reactivos.
  let calPolicy = $derived.by(() => {
    // Tocar los reactivos relevantes para que Svelte sepa rebuilear:
    void serial.imuCal; void serial.currentTempC; void serial.fwTimestamp;
    void serial.connected;
    return getCalPolicy();
  });

  // Lista de puertos USB-Serial para instalación desde cero (sin firmware).
  let usbPorts = $state<Array<{ port_name: string; vid: number; pid: number; manufacturer: string | null; product: string | null }>>([]);
  let selectedManualPort = $state<string>('');
  let listingPorts = $state(false);
  // Slug del driver de sensor a instalar. Default: el marcado como default
  // en el manifest. Solo importa para instalación desde cero (sin firmware
  // previo); en update el flash.start sin slug autodetecta.
  let selectedSensorSlug = $state<string>('');
  $effect(() => {
    if (!selectedSensorSlug && firmware.manifest) {
      const def = (firmware.manifest.supported_sensors ?? []).find((s) => s.default);
      selectedSensorSlug = def?.slug ?? firmware.manifest.supported_sensors?.[0]?.slug ?? '';
    }
  });

  async function refreshUsbPorts() {
    listingPorts = true;
    try {
      usbPorts = await flash.listPorts();
      if (!selectedManualPort && usbPorts.length > 0) {
        selectedManualPort = usbPorts[0].port_name;
      }
    } catch (e) {
      console.warn('list_serial_ports falló', e);
    } finally {
      listingPorts = false;
    }
  }

  function fmtVidPid(vid: number, pid: number): string {
    return `${vid.toString(16).padStart(4, '0')}:${pid.toString(16).padStart(4, '0')}`;
  }

  // 2) Identificación del sensor. Datos reales provenientes del banner que
  // el firmware emite en el boot ("Gyro WHO_AM_I @0xXX = 0xYY (Nombre)"),
  // capturado por serial.svelte.ts en serial.detectedSensor.
  // Una entrada por driver de firmware (no por chip), igual que el campo
  // SENSOR_DRIVER del .ino y los slugs de firmware/manifest.json. Cada driver
  // puede usar uno o varios chips combinados (caso L3G + LSM303D).
  type ChipPart = { label: string; role: string; addr: string; whoami?: string };
  type CatalogEntry = {
    slug: string;                  // coincide con manifest.supported_sensors[].slug
    label: string;
    families: string[];            // familia(s) reportada(s) por el firmware en boot
    fusion: 'externa' | 'interna';
    vendor: string;
    parts: ChipPart[];             // chips concretos que cubre este driver
    notes?: string;
  };
  const SENSOR_CATALOG: CatalogEntry[] = [
    {
      slug: 'l3g-lsm303',
      label: 'L3G + LSM303D',
      families: ['L3GD20H', 'L3GD20', 'L3G4200D'],
      fusion: 'externa',
      vendor: 'STMicroelectronics',
      parts: [
        { label: 'L3GD20H',  role: 'Gyro 3 ejes (±2000 dps)', addr: '0x6A/0x6B', whoami: '0xD7' },
        { label: 'L3GD20',   role: 'Gyro 3 ejes (±2000 dps) — variante previa', addr: '0x6A/0x6B', whoami: '0xD4' },
        { label: 'L3G4200D', role: 'Gyro 3 ejes (±2000 dps) — familia previa', addr: '0x69',      whoami: '0xD3' },
        { label: 'LSM303D',  role: 'Accel ±16 g + Mag ±12 gauss (6 ejes combinados)', addr: '0x1D/0x1E' },
      ],
      notes: 'El firmware discrimina la variante L3G por WHO_AM_I; el LSM303 va apareado y aporta accel + mag. Fusión Madgwick en el ESP32.',
    },
    {
      slug: 'icm-42688',
      label: 'ICM-42688',
      families: ['ICM-42688'],
      fusion: 'externa',
      vendor: 'TDK InvenSense',
      parts: [
        { label: 'ICM-42688', role: 'Gyro + Accel (6-DOF, ±2000 dps, ±16 g)', addr: '0x68/0x69', whoami: '0x47' },
      ],
      notes: 'Sin magnetómetro. Muy bajo ruido (ARW ~0.3 °/√h, BI ~24 °/h). Yaw deriva con el tiempo si no se suma un mag externo.',
    },
    {
      slug: 'mpu9250',
      label: 'MPU-9250 + AK8963',
      families: ['MPU9250'],
      fusion: 'externa',
      vendor: 'InvenSense (TDK)',
      parts: [
        { label: 'MPU-9250', role: 'Gyro + Accel (±2000 dps, ±16 g)', addr: '0x68/0x69', whoami: '0x71' },
        { label: 'AK8963',   role: 'Magnetómetro 3 ejes (±4900 µT)', addr: '0x0C' },
      ],
      notes: 'Descontinuado pero abundante. El AK8963 está físicamente dentro del package; se accede por bypass I2C del MPU.',
    },
    {
      slug: 'bno055',
      label: 'BNO055',
      families: ['BNO055'],
      fusion: 'interna',
      vendor: 'Bosch Sensortec',
      parts: [
        { label: 'BNO055', role: '9-DOF (gyro + accel + mag) con fusión Kalman interna', addr: '0x28/0x29', whoami: '0xA0' },
      ],
      notes: 'Saca yaw/pitch/roll directamente (no requiere Madgwick en el ESP32). El firmware bypasea el bias-removal para no degradar la fusión interna. Disponibilidad incierta (chip cercano a EOL).',
    },
    {
      slug: 'mpu6050',
      label: 'MPU-6050',
      families: ['MPU-6050'],
      fusion: 'externa',
      vendor: 'InvenSense (TDK)',
      parts: [
        { label: 'MPU-6050', role: 'Gyro + Accel (6-DOF, ±2000 dps, ±16 g)', addr: '0x68/0x69', whoami: '0x68' },
      ],
      notes: 'Versión sin magnetómetro del MPU-9250. Muy abundante en módulos GY-521. Fusión Madgwick en el ESP32.',
    },
    {
      slug: 'itg-adxl-hmc',
      label: 'HW-579',
      families: ['ITG-3205'],
      fusion: 'externa',
      vendor: 'placa combo (varios fabricantes)',
      parts: [
        { label: 'ITG-3205',  role: 'Gyro 3 ejes ±2000 dps', addr: '0x68/0x69', whoami: '0x68' },
        { label: 'ADXL345',   role: 'Accel ±16 g (full-res)', addr: '0x53' },
        { label: 'HMC5883L',  role: 'Magnetómetro ±1.3 G', addr: '0x1E' },
      ],
      notes: 'Placa breakout de 3 chips. Algunos lotes recientes traen QMC5883L en lugar de HMC5883L (mapping distinto, addr 0x0D); el driver actual solo soporta HMC y deja mag NaN si no responde.',
    },
    {
      slug: 'icm-20948',
      label: 'ICM-20948',
      families: ['ICM-20948'],
      fusion: 'externa',
      vendor: 'TDK InvenSense',
      parts: [
        { label: 'ICM-20948', role: 'Gyro + Accel + AK09916 mag (9-DOF, ±2000 dps, ±16 g)', addr: '0x68/0x69', whoami: '0xEA' },
      ],
      notes: 'Sucesor del MPU-9250: mismo paquete 9-DOF pero EN PRODUCCIÓN (TDK lo mantiene), industrial temp range, mejor ruido. AK09916 reemplaza al AK8963 con mapeo similar pero registros distintos. Recomendado por sobre MPU-9250 para nuevos diseños.',
    },
  ];
  // El sensor reportado por el firmware (familia) se mapea al driver del
  // catálogo, no a un chip individual.
  let detectedSensor = $derived.by<CatalogEntry | null>(() => {
    const ds = serial.detectedSensor;
    if (!ds) return null;
    return SENSOR_CATALOG.find((c) => c.families.includes(ds.family)) ?? null;
  });
  // Info del firmware: prefiere la versión real (banner "SimHit FW x.y.z");
  // si no llegó, cae al formato de trama como heurística.
  let firmwareInfo = $derived({
    version: serial.firmwareVersionString ?? (serial.firmwareVersion === 'extended' ? '1.2.0' : '1.0.0'),
    git: serial.firmwareVersion,
    sample_rate: 200,
  });

  // 3) Capture — config UI. Los valores se pasan al store al iniciar.
  // El sensor por defecto se sincroniza con el detectado en serial.
  let captureCfg = $state({
    durationMin: 30,
    preheatMin: 15,
    ambientTempC: 24.8,
    sensorLabel: 'L3GD20H',
  });

  // Sincroniza la etiqueta del sensor con la detección del firmware.
  $effect(() => {
    if (detectedSensor && captureCfg.sensorLabel !== detectedSensor.label) {
      captureCfg.sensorLabel = detectedSensor.label;
    }
  });
  let captureErrorMsg = $state<string | null>(null);

  async function startCapture() {
    captureErrorMsg = null;
    if (!serial.connected) {
      captureErrorMsg = 'Conecte SimHIT desde la barra superior antes de iniciar.';
      return;
    }
    try {
      await capture.start({
        durationSeconds: captureCfg.durationMin * 60,
        preheatSeconds: captureCfg.preheatMin * 60,
        sensorLabel: captureCfg.sensorLabel,
        ambientTempC: captureCfg.ambientTempC,
        sampleRateHz: 200,
      });
    } catch (e) {
      captureErrorMsg = String(e);
    }
  }

  async function stopCaptureManual() {
    await capture.cancel();
  }

  // Si el USB se desconecta durante la grabación, cancelar limpiamente.
  $effect(() => {
    if (!serial.connected && (capture.stage === 'recording' || capture.stage === 'flushing')) {
      void capture.cancel();
      captureErrorMsg = 'Conexión perdida. La sesión quedó marcada como incompleta.';
    }
  });

  // Avanzar al paso de análisis cuando la captura termina exitosamente.
  $effect(() => {
    if (capture.stage === 'done' && step === 'capture') {
      setTimeout(() => { if (step === 'capture') step = 'analysis'; }, 600);
    }
  });

  function fmtBytes(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
    return `${(n / 1024 / 1024).toFixed(2)} MiB`;
  }

  // 4) Análisis — corre sobre el CSV cerrado por capture.rs.
  // Auto-disparo cuando entramos al paso 'analysis' y hay un CSV disponible.
  $effect(() => {
    if (step === 'analysis' && analysis.state === 'idle' && capture.csvPath) {
      void analysis.run(capture.csvPath, 200);
    }
  });

  // Veredicto consolidado a partir del resultado real del análisis.
  let verdict = $derived.by(() => {
    const a = analysis.allan;
    const s = analysis.sampling;
    if (!a || !s) {
      return { overall: 'Pending' as const, criteria: [] as Array<{ name: string; value: string; threshold: string; status: 'pass' | 'marginal' | 'fail' | 'muted' }> };
    }
    const arwMax = Math.max(...a.arw_deg_sqrt_hr);
    const biMax = Math.max(...a.bias_instability_deg_hr);
    const status = (v: number, pass: number, fail: number): 'pass' | 'marginal' | 'fail' =>
      v < pass ? 'pass' : v < fail ? 'marginal' : 'fail';
    const cs = [
      { name: 'ARW (°/√h)', value: arwMax.toFixed(2), threshold: '< 2', status: status(arwMax, 2, 4) },
      { name: 'Bias instability (°/h)', value: biMax.toFixed(1), threshold: '< 50', status: status(biMax, 50, 100) },
      {
        name: 'Frec. efectiva (Hz)',
        value: s.measured_hz.toFixed(2),
        threshold: '≥ 198',
        status: (s.measured_hz >= 198 ? 'pass' : s.measured_hz >= 180 ? 'marginal' : 'fail') as 'pass' | 'marginal' | 'fail',
      },
      { name: 'Rango dinámico (°/s)', value: '2000', threshold: '≥ 500', status: 'pass' as const },
      { name: 'Latencia E2E (ms)', value: '—', threshold: '< 50', status: 'muted' as const },
    ];
    const hasFail = cs.some((c) => c.status === 'fail');
    const hasMarg = cs.some((c) => c.status === 'marginal');
    const overall = hasFail ? 'Fail' : hasMarg ? 'Marginal' : 'Pass';
    return { overall: overall as 'Pass' | 'Marginal' | 'Fail', criteria: cs };
  });

  // ─────── Plot SVG de Allan (log-log) ───────
  const ALLAN_W = 600;
  const ALLAN_H = 280;
  const ALLAN_PAD = { l: 56, r: 16, t: 12, b: 36 };
  function logScale(v: number, min: number, max: number, range: number, pad: number) {
    return pad + ((Math.log10(v) - Math.log10(min)) / (Math.log10(max) - Math.log10(min))) * range;
  }

  type AllanBounds = { tauMin: number; tauMax: number; sigMin: number; sigMax: number };
  let allanBounds = $derived.by<AllanBounds | null>(() => {
    const a = analysis.allan;
    if (!a || a.tau_s.length === 0) return null;
    const tauMin = a.tau_s[0];
    const tauMax = a.tau_s[a.tau_s.length - 1];
    const all = [...a.sigma_x_dps, ...a.sigma_y_dps, ...a.sigma_z_dps].filter((v) => v > 0);
    if (all.length === 0) return null;
    let sigMin = Math.min(...all);
    let sigMax = Math.max(...all);
    // Padding visual en log.
    sigMin = Math.pow(10, Math.floor(Math.log10(sigMin)));
    sigMax = Math.pow(10, Math.ceil(Math.log10(sigMax)));
    return { tauMin, tauMax, sigMin, sigMax };
  });

  const plotW = ALLAN_W - ALLAN_PAD.l - ALLAN_PAD.r;
  const plotH = ALLAN_H - ALLAN_PAD.t - ALLAN_PAD.b;

  function buildAllanPath(sigma: number[], b: AllanBounds, tau: number[]): string {
    let d = '';
    let first = true;
    for (let i = 0; i < tau.length; i++) {
      const s = sigma[i];
      if (!(s > 0)) continue;
      const x = logScale(tau[i], b.tauMin, b.tauMax, plotW, ALLAN_PAD.l);
      const y = ALLAN_H - ALLAN_PAD.b - ((Math.log10(s) - Math.log10(b.sigMin)) / (Math.log10(b.sigMax) - Math.log10(b.sigMin))) * plotH;
      d += `${first ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)} `;
      first = false;
    }
    return d;
  }

  function fmtTime(s: number) {
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${String(r).padStart(2, '0')}`;
  }

  // ─────────── Referencia de sensores (literatura / datasheets) ───────────
  // Valores típicos para comparar el resultado contra rangos publicados.
  // No reemplaza datasets reales: es solo guía visual para detectar resultados
  // anómalos vs lo esperado para el sensor identificado.
  type SensorReference = {
    label: string;
    source: string;
    arw_deg_sqrt_hr: number;
    bias_instability_deg_hr: number;
    range_dps: number;
  };
  const SENSOR_REFERENCES: Record<string, SensorReference> = {
    'ICM-42688': { label: 'ICM-42688-P', source: 'TDK InvenSense datasheet rev 1.6',
                    arw_deg_sqrt_hr: 0.30, bias_instability_deg_hr: 24, range_dps: 2000 },
    'BNO055':    { label: 'BNO055',       source: 'Bosch datasheet rev 1.4',
                    arw_deg_sqrt_hr: 0.55, bias_instability_deg_hr: 40, range_dps: 2000 },
    'MPU9250':   { label: 'MPU-9250',     source: 'InvenSense datasheet rev 1.1',
                    arw_deg_sqrt_hr: 0.45, bias_instability_deg_hr: 35, range_dps: 2000 },
    'L3GD20H':   { label: 'L3GD20H',      source: 'STMicro datasheet rev 2',
                    arw_deg_sqrt_hr: 0.50, bias_instability_deg_hr: 50, range_dps: 2000 },
  };
  let showReference = $state(false);
  let referenceData = $derived(detectedSensor ? SENSOR_REFERENCES[detectedSensor.label] ?? null : null);

  // Info del host (SO, arch, hostname, versión de app) — consultada una vez al
  // montar la vista. Se incluye en sensor_profile.json para trazabilidad.
  type HostInfo = { os: string; arch: string; family: string; hostname: string; app_version: string };
  let hostInfo = $state<HostInfo | null>(null);
  onMount(async () => {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      hostInfo = await invoke<HostInfo>('get_host_info');
    } catch (e) {
      console.warn('get_host_info no disponible', e);
    }
  });

  function buildProfile() {
    return {
      schema_version: 'simhit-profile-1.0',
      generated_by: { app: 'SimHIT', version: '2026.5.0' },
      generated_at_utc: new Date().toISOString(),
      sensor: detectedSensor,
      firmware: firmwareInfo,
      platform: {
        ...(hostInfo ?? {}),
        esp32_mac: serial.espMacAddress,
      },
      acceptance_preset: { id: acceptance.active.id, name: acceptance.active.name },
      calibration: serial.imuCal ? {
        ...serial.imuCal,
        // Edad de la CAL al momento del export (s), usando el reloj del firmware.
        age_s: serial.imuCal.now_ms != null
          ? (serial.imuCal.now_ms - serial.imuCal.cal_ts_ms) / 1000
          : null,
        // Allan corto medido al final del CAL (si el usuario lo corrió).
        allan_in_place: allanInPlace.result,
      } : null,
      session: {
        id: capture.sessionId,
        csv_path: capture.csvPath,
        csv_sha256: capture.summary?.csv_sha256,
        duration_s: capture.summary?.duration_s,
        samples_written: capture.summary?.samples_written,
      },
      metrics: {
        sampling: analysis.sampling,
        allan: analysis.allan,
        synthetic: synthetic.result,
      },
      verdict,
      reference: referenceData,
    };
  }

  let exportError = $state<string | null>(null);
  let exporting = $state<'none' | 'json' | 'pdf'>('none');

  async function exportJson() {
    exportError = null;
    exporting = 'json';
    try {
      const { save } = await import('@tauri-apps/plugin-dialog');
      const { invoke } = await import('@tauri-apps/api/core');
      const defaultName = `sensor_profile_${detectedSensor?.label ?? 'unknown'}_${new Date().toISOString().slice(0, 10)}.json`;
      const target = await save({
        defaultPath: defaultName,
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
      if (!target) { exporting = 'none'; return; }
      const text = JSON.stringify(buildProfile(), null, 2);
      const bytes = new TextEncoder().encode(text);
      await invoke('save_pdf', { path: target, bytes: Array.from(bytes) });
    } catch (e) {
      exportError = String(e);
    } finally {
      exporting = 'none';
    }
  }

  async function exportPdf() {
    exportError = null;
    exporting = 'pdf';
    try {
      const { save } = await import('@tauri-apps/plugin-dialog');
      const { invoke } = await import('@tauri-apps/api/core');
      const html2pdfMod = await import('html2pdf.js');
      const html2pdf = html2pdfMod.default ?? html2pdfMod;

      const defaultName = `sensor_profile_${detectedSensor?.label ?? 'unknown'}_${new Date().toISOString().slice(0, 10)}.pdf`;
      const target = await save({
        defaultPath: defaultName,
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      });
      if (!target) { exporting = 'none'; return; }

      const article = document.querySelector('article.profile-export') as HTMLElement | null;
      if (!article) throw new Error('No se encontró el bloque exportable');

      document.body.classList.add('is-exporting');
      try {
        const blob: Blob = await html2pdf()
          .from(article)
          .set({
            margin: [14, 14, 14, 14],
            filename: defaultName,
            image: { type: 'jpeg', quality: 0.96 },
            html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
            jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
            pagebreak: { mode: ['css', 'legacy'] },
          })
          .outputPdf('blob');
        const buf = new Uint8Array(await blob.arrayBuffer());
        await invoke('save_pdf', { path: target, bytes: Array.from(buf) });
      } finally {
        document.body.classList.remove('is-exporting');
      }
    } catch (e) {
      exportError = String(e);
    } finally {
      exporting = 'none';
    }
  }

  // Compara una métrica medida contra el rango "esperado" de la referencia:
  // ratio = medido / referencia. ratio≈1 → coherente, ratio>>1 → peor del esperado.
  function refRatio(measured: number | undefined | null, reference: number): { ratio: number; status: 'ok' | 'warn' | 'bad' } {
    if (measured == null || !isFinite(measured) || reference === 0) return { ratio: NaN, status: 'warn' };
    const r = measured / reference;
    const status = r <= 1.5 ? 'ok' : r <= 3.0 ? 'warn' : 'bad';
    return { ratio: r, status };
  }
</script>

<div class="app">
  <TopBar />

  <main class="layout">
    <!-- Stepper -->
    <nav class="stepper">
      {#each [
        { id: 'flash', label: 'Firmware', n: 1 },
        { id: 'detect', label: 'Sensor', n: 2 },
        { id: 'capture', label: 'Captura', n: 3 },
        { id: 'analysis', label: 'Análisis', n: 4 },
        { id: 'profile', label: 'Perfil', n: 5 },
      ] as s}
        <button
          class="step"
          class:active={step === s.id}
          class:done={['flash','detect','capture','analysis','profile'].indexOf(s.id) < ['flash','detect','capture','analysis','profile'].indexOf(step)}
          onclick={() => (step = s.id as Step)}
        >
          <span class="step-n">{s.n}</span>
          <span class="step-l">{s.label}</span>
        </button>
      {/each}
    </nav>

    <!-- ─────────────── STEP 1: FIRMWARE ─────────────── -->
    {#if step === 'flash'}
      <section class="panel">
        <header class="panel-h">
          <h2>Firmware</h2>
          <p class="lead">Versión instalada en el dispositivo y chequeo de actualizaciones publicadas en el repo.</p>
        </header>

        <!-- Política de re-CAL: edad y drift térmico de la última calibración -->
        {#if calPolicy.status === 'aged' || calPolicy.status === 'thermal-drift' || calPolicy.status === 'no-cal'}
          <div class="warn-msg">
            <span class="warn-ic">!</span>
            <div>
              <b>
                {#if calPolicy.status === 'no-cal'}Sin calibración
                {:else if calPolicy.status === 'aged'}Calibración vieja
                {:else}Deriva térmica detectada
                {/if}
              </b>
              <div>{calPolicy.message}</div>
              {#if calPolicy.age_s != null || calPolicy.thermal_drift_c != null}
                <div style="font-size:11px;margin-top:4px;color:var(--text-muted);font-family:ui-monospace,monospace">
                  {#if calPolicy.age_s != null}edad CAL: {(calPolicy.age_s / 60).toFixed(1)} min{/if}
                  {#if calPolicy.thermal_drift_c != null} · ΔT: {calPolicy.thermal_drift_c.toFixed(2)} °C{/if}
                  {#if Number.isFinite(serial.currentTempC)} · temp actual: {serial.currentTempC.toFixed(1)} °C{/if}
                </div>
              {/if}
            </div>
          </div>
        {/if}

        <!-- Drift del bias detectado en runtime (ventana quieta con promedio ≠ 0) -->
        {#if biasDrift.driftDetected && biasDrift.lastQuietMean}
          <div class="warn-msg">
            <span class="warn-ic">!</span>
            <div>
              <b>Deriva del bias del giroscopio</b>
              <div>
                Con el sensor sostenido en quietud el firmware reporta una velocidad angular residual.
                Eso indica que el bias calibrado quedó desfasado — recalibre antes del próximo examen.
              </div>
              <div style="font-size:11px;margin-top:4px;color:var(--text-muted);font-family:ui-monospace,monospace">
                Última ventana quieta (mean): {biasDrift.lastQuietMean.map((v) => v.toFixed(3)).join(', ')} °/s
                · Peak sesión: {biasDrift.driftPeak.map((v) => v.toFixed(3)).join(', ')} °/s
              </div>
            </div>
          </div>
        {/if}

        <div class="grid-2">
          <div class="card">
            <div class="card-h">Versión instalada</div>
            {#if !serial.connected}
              <div class="empty small">
                <div class="empty-ic">🔌</div>
                <p class="empty-d">Conecte SimHIT para leer la versión del firmware.</p>
              </div>
            {:else if serial.firmwareVersionString}
              <div class="sensor-info">
                <div class="sensor-name">v{serial.firmwareVersionString}</div>
                <dl class="kv">
                  <dt>Formato de trama</dt><dd>{serial.firmwareVersion}</dd>
                  <dt>Puerto</dt><dd><code>{serial.portPath ?? '—'}</code></dd>
                  <dt>Errores CRC</dt><dd>{serial.crcErrors}</dd>
                </dl>
                <button class="block" onclick={() => serial.sendCommand('VERSION')} title="Consultar versión al firmware">
                  ↻ Revisar versión
                </button>
              </div>
            {:else}
              <div class="empty small">
                <div class="empty-ic">📡</div>
                <div class="empty-t">Sin versión recibida</div>
                <p class="empty-d">El firmware actual puede ser anterior a v1.0.0 (no emite banner). Use VERSION para consultar:</p>
                <button class="primary" onclick={() => serial.sendCommand('VERSION')}>Revisar versión</button>
              </div>
            {/if}
          </div>

          <div class="card">
            <div class="card-h">Actualizaciones</div>
            {#if firmware.checking}
              <div class="empty small">
                <div class="spinner-sm"></div>
                <p class="empty-d">Consultando manifest…</p>
              </div>
            {:else if firmware.lastError}
              <div class="warn-msg" style="margin-bottom:10px">
                <span class="warn-ic">!</span>
                <div><b>No se pudo verificar.</b><div>{firmware.lastError}</div></div>
              </div>
              <button class="primary block" onclick={() => firmware.check(true)}>Reintentar</button>
            {:else if !firmware.manifest}
              <div class="empty small">
                <button class="primary" onclick={() => firmware.check(true)}>Verificar actualizaciones</button>
              </div>
            {:else}
              {@const m = firmware.manifest.latest}
              {@const st = firmware.status}
              <div class="update-box" class:up={st === 'up-to-date'} class:avail={st === 'update-available'} class:dev={st === 'newer-than-remote'}>
                <div class="update-h">
                  {#if st === 'up-to-date'}<span class="ic">✓</span><b>Firmware al día</b>
                  {:else if st === 'update-available'}<span class="ic">↑</span><b>Actualización disponible</b>
                  {:else if st === 'newer-than-remote'}<span class="ic">⚙</span><b>Build de desarrollo</b>
                  {:else}<span class="ic">?</span><b>Sin información</b>
                  {/if}
                </div>
                <dl class="kv compact">
                  <dt>Última publicada</dt><dd><b>v{m.version}</b> ({m.channel})</dd>
                  <dt>Fecha</dt><dd>{m.released_at}</dd>
                  <dt>App mínima</dt><dd>{m.min_compatible_app}</dd>
                  {#if firmware.lastChecked}
                    <dt>Verificado</dt><dd>{firmware.lastChecked.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}</dd>
                  {/if}
                </dl>
                {#if m.notes}<p class="note inline" style="margin-top:8px">{m.notes}</p>{/if}
              </div>
              <div class="actions-row" style="margin-top:10px">
                <button onclick={() => firmware.check(true)} disabled={flash.stage !== 'idle' && flash.stage !== 'done' && flash.stage !== 'error'}>↻ Refrescar manifest</button>
                {#if firmware.status === 'update-available' || firmware.status === 'newer-than-remote'}
                  <button
                    class="primary"
                    onclick={() => flash.start()}
                    disabled={!serial.portPath || (flash.stage !== 'idle' && flash.stage !== 'done' && flash.stage !== 'error')}
                  >
                    ⬇ Flashear v{m.version}
                  </button>
                {/if}
              </div>

              {#if flash.stage !== 'idle'}
                {@const f = flash}
                {@const pct = f.progress >= 0 ? Math.round(f.progress * 100) : null}
                <div class="flash-progress" style="margin-top:14px">
                  <div class="flash-stage">
                    {#if f.stage === 'downloading'}📥 Descargando firmware
                    {:else if f.stage === 'verifying'}🔐 Verificando SHA-256
                    {:else if f.stage === 'connecting'}📡 Conectando al ESP
                    {:else if f.stage === 'writing'}✍ Escribiendo flash
                    {:else if f.stage === 'resetting'}⟳ Reiniciando dispositivo
                    {:else if f.stage === 'done'}✓ Firmware actualizado
                    {:else if f.stage === 'error'}✗ Error
                    {/if}
                  </div>
                  {#if pct !== null}
                    <div class="bar"><div class="bar-fill" style:width="{pct}%"></div></div>
                    <div class="flash-pct">{pct}% · {(f.downloadedBytes / 1024).toFixed(0)} / {(f.totalBytes / 1024).toFixed(0)} KiB</div>
                  {:else}
                    <div class="bar"><div class="bar-fill indet"></div></div>
                  {/if}
                  {#if f.message}<div class="flash-msg">{f.message}</div>{/if}
                  {#if f.error}<div class="err-inline">{f.error}</div>{/if}
                  {#if f.stage === 'done' || f.stage === 'error'}
                    <div class="actions-row" style="margin-top:8px">
                      <button onclick={() => flash.reset()}>Cerrar</button>
                    </div>
                  {/if}
                </div>
              {/if}
            {/if}
          </div>
        </div>

        <div class="card">
          <div class="card-h">Instalación desde cero (dispositivo sin firmware)</div>
          <p class="note inline" style="margin-top:0;margin-bottom:12px">
            Si la gafa está virgen o el firmware está corrupto, no emite el banner SimHit y no aparece en la tarjeta de arriba.
            Use esta sección: elija el puerto USB-Serial al que está conectada y flashee directamente — el ROM bootloader del
            ESP32 entra al modo descarga vía DTR/RTS sin importar el estado del firmware.
          </p>

          <div class="form" style="margin-bottom:10px">
            <label>
              <span>Puerto USB-Serial</span>
              <select bind:value={selectedManualPort} disabled={listingPorts || usbPorts.length === 0}>
                {#if usbPorts.length === 0}
                  <option value="">— No se detectan puertos USB —</option>
                {:else}
                  {#each usbPorts as p}
                    <option value={p.port_name}>
                      {p.port_name} — {p.product ?? p.manufacturer ?? 'sin descripción'} [{fmtVidPid(p.vid, p.pid)}]
                    </option>
                  {/each}
                {/if}
              </select>
            </label>

            {#if firmware.manifest && (firmware.manifest.supported_sensors?.length ?? 0) > 0}
              <label>
                <span>Driver de sensor</span>
                <select bind:value={selectedSensorSlug}>
                  {#each firmware.manifest.supported_sensors ?? [] as s}
                    <option value={s.slug}>{s.label}{s.default ? ' — default' : ''}</option>
                  {/each}
                </select>
              </label>
            {/if}
          </div>

          <div class="actions-row">
            <button onclick={refreshUsbPorts} disabled={listingPorts}>
              {listingPorts ? 'Buscando…' : '↻ Refrescar puertos'}
            </button>
            <button
              class="primary"
              onclick={() => flash.start(selectedManualPort, selectedSensorSlug || undefined)}
              disabled={!selectedManualPort || !firmware.manifest || (flash.stage !== 'idle' && flash.stage !== 'done' && flash.stage !== 'error')}
            >
              🆕 Flashear en {selectedManualPort || '(seleccione puerto)'}
            </button>
          </div>

          <p class="note inline" style="margin-top:10px">
            ⚠ Asegúrese de elegir el puerto correcto: si flashea por error el puerto equivocado, espflash devolverá un error
            inmediato ("Failed to connect"). No hay riesgo de bricking del puerto seleccionado.
          </p>
        </div>

        {#if serial.firmwareVersionString && firmware.manifest && firmware.status === 'update-available'}
          <div class="actions-row right">
            <button class="primary" onclick={() => (step = 'detect')}>Continuar igual →</button>
          </div>
        {:else if serial.firmwareVersionString}
          <div class="actions-row right">
            <button class="primary" onclick={() => (step = 'detect')}>Continuar a sensor →</button>
          </div>
        {/if}
      </section>

    <!-- ─────────────── STEP 2: SENSOR DETECT ─────────────── -->
    {:else if step === 'detect'}
      <section class="panel">
        <header class="panel-h">
          <h2>Identificación del sensor</h2>
          <p class="lead">El firmware emite el WHO_AM_I del giroscopio en el banner de boot. La identificación es automática al conectar.</p>
        </header>

        {#if !serial.connected}
          <div class="warn-msg">
            <span class="warn-ic">!</span>
            <div>
              <b>SimHIT no está conectado.</b>
              <div>Conéctelo desde la barra superior — el sensor se identifica automáticamente al iniciar la sesión.</div>
            </div>
          </div>
        {/if}

        <div class="grid-2">
          <div class="card">
            <div class="card-h">Sensor detectado</div>
            {#if serial.detectedSensor && detectedSensor}
              <div class="sensor-info">
                <div class="sensor-name">{serial.detectedSensor.name}</div>
                <dl class="kv">
                  <dt>Dirección I²C</dt><dd><code>{serial.detectedSensor.addr}</code></dd>
                  <dt>WHO_AM_I</dt><dd><code>{serial.detectedSensor.whoami}</code></dd>
                  <dt>Familia</dt><dd>{serial.detectedSensor.family}</dd>
                  <dt>Driver</dt><dd>{detectedSensor.label}</dd>
                  <dt>Fusión</dt><dd>{detectedSensor.fusion}</dd>
                  <dt>Magnetómetro</dt><dd>{detectedSensor.parts.some((p) => /mag/i.test(p.role)) ? 'Sí' : 'No'}</dd>
                  <dt>Firmware</dt><dd>{serial.firmwareVersion} ({firmwareInfo.git})</dd>
                  <dt>Sample rate</dt><dd>{firmwareInfo.sample_rate} Hz</dd>
                  {#if serial.calibrated}
                    <dt>Calibración</dt><dd style="color:var(--success)">✓ Aplicada</dd>
                  {:else}
                    <dt>Calibración</dt><dd style="color:var(--text-muted)">Pendiente</dd>
                  {/if}
                </dl>
                <button class="primary block" onclick={() => (step = 'capture')}>
                  Continuar a captura →
                </button>
              </div>
            {:else if serial.connected}
              <div class="empty small">
                <div class="empty-ic">📡</div>
                <div class="empty-t">Esperando handshake…</div>
                <p class="empty-d">El firmware identifica el sensor durante el boot. Si no aparece, reinicie SimHIT (desconectar/conectar el USB).</p>
              </div>
            {:else}
              <div class="empty small">
                <div class="empty-ic">🔌</div>
                <p class="empty-d">Conecte SimHIT para iniciar la identificación.</p>
              </div>
            {/if}
          </div>

          <div class="card">
            <div class="card-h">Catálogo soportado</div>
            <ul class="sensor-list">
              {#each SENSOR_CATALOG as s}
                {@const hasMag = s.parts.some((p) => /mag/i.test(p.role))}
                <li class:hit={detectedSensor?.slug === s.slug}>
                  <div class="sensor-list-h">
                    <div>
                      <b>{s.label}</b>
                      <span class="vendor">{s.vendor}</span>
                    </div>
                    <div class="sensor-tags">
                      <span class="tag" class:tag-on={hasMag}>{hasMag ? 'magnetómetro ✓' : 'sin magnetómetro'}</span>
                      <span class="tag" class:tag-accent={s.fusion === 'interna'}>fusión {s.fusion}</span>
                    </div>
                  </div>
                  <ul class="parts-list">
                    {#each s.parts as p}
                      <li>
                        <b>{p.label}</b> — {p.role}
                        <span class="part-tags">
                          <span class="tag">addr <code>{p.addr}</code></span>
                          {#if p.whoami}<span class="tag">WAI <code>{p.whoami}</code></span>{/if}
                        </span>
                      </li>
                    {/each}
                  </ul>
                  {#if s.notes}<div class="sensor-notes">{s.notes}</div>{/if}
                </li>
              {/each}
            </ul>
          </div>
        </div>
      </section>

    <!-- ─────────────── STEP 3: CAPTURE ─────────────── -->
    {:else if step === 'capture'}
      <section class="panel">
        <header class="panel-h">
          <h2>Captura estática</h2>
          <p class="lead">Grabación prolongada con sensor inmóvil para Allan variance y caracterización del bias.</p>
        </header>

        {#if !serial.connected}
          <div class="warn-msg">
            <span class="warn-ic">!</span>
            <div>
              <b>SimHIT no está conectado.</b>
              <div>Conéctelo desde la barra superior y calíbrelo antes de iniciar la captura.</div>
            </div>
          </div>
        {/if}

        <div class="grid-2">
          <div class="card">
            <div class="card-h">Configuración</div>
            <div class="form">
              <label>
                <span>Sensor</span>
                <input type="text" bind:value={captureCfg.sensorLabel} disabled={capture.stage !== 'idle' && capture.stage !== 'done' && capture.stage !== 'error'} />
              </label>
              <label>
                <span>Duración (min)</span>
                <input type="number" min="1" max="720" bind:value={captureCfg.durationMin} disabled={capture.stage !== 'idle' && capture.stage !== 'done' && capture.stage !== 'error'} />
              </label>
              <label>
                <span>Pre-calentamiento (min)</span>
                <input type="number" min="0" max="60" bind:value={captureCfg.preheatMin} disabled={capture.stage !== 'idle' && capture.stage !== 'done' && capture.stage !== 'error'} />
              </label>
              <label>
                <span>Temp. ambiente (°C)</span>
                <input type="number" step="0.1" bind:value={captureCfg.ambientTempC} disabled={capture.stage !== 'idle' && capture.stage !== 'done' && capture.stage !== 'error'} />
              </label>

              {#if capture.stage === 'idle' || capture.stage === 'error'}
                <button class="primary block" onclick={startCapture} disabled={!serial.connected}>▶ Iniciar captura</button>
              {:else if capture.stage === 'done'}
                <button class="primary block" onclick={() => (step = 'analysis')}>Ver análisis →</button>
                <button class="block" onclick={() => capture.reset()}>Nueva captura</button>
              {:else if capture.stage === 'recording' || capture.stage === 'preheat'}
                <button class="block danger-btn" onclick={stopCaptureManual}>■ Detener</button>
              {:else}
                <button class="block" disabled>En curso…</button>
              {/if}

              {#if captureErrorMsg}
                <div class="err-inline">{captureErrorMsg}</div>
              {/if}
            </div>
          </div>

          <div class="card">
            <div class="card-h">Progreso</div>
            {#if capture.stage === 'idle' || capture.stage === 'error'}
              <div class="empty small">
                <div class="empty-ic" style="font-size:36px">⏱</div>
                <p class="empty-d">Esperando inicio.</p>
                {#if capture.error}<p class="err-inline">{capture.error}</p>{/if}
              </div>
            {:else}
              {@const preheatPct = capture.preheatTotal > 0 ? (capture.preheatElapsed / capture.preheatTotal) * 100 : 100}
              {@const recPct = capture.recTotal > 0 ? (capture.recElapsed / capture.recTotal) * 100 : 0}
              <div class="prog-block">
                <div class="prog-stage" class:active={capture.stage === 'preheat'} class:done={capture.stage !== 'preheat'}>
                  <span class="dot"></span>
                  <span class="lab">Pre-calentamiento</span>
                  <span class="val">{capture.stage === 'preheat' ? `${capture.preheatElapsed}/${capture.preheatTotal} s` : 'completo'}</span>
                </div>
                <div class="prog-stage" class:active={capture.stage === 'recording' || capture.stage === 'flushing'} class:done={capture.stage === 'done'}>
                  <span class="dot"></span>
                  <span class="lab">{capture.stage === 'flushing' ? 'Cerrando archivo…' : 'Grabando'}</span>
                  <span class="val">{fmtTime(Math.floor(capture.recElapsed))} / {fmtTime(capture.recTotal)}</span>
                </div>

                <div class="bar">
                  <div class="bar-fill" style:width="{capture.stage === 'preheat' ? preheatPct : recPct}%"></div>
                </div>

                <div class="mini-stats">
                  <div><span>Muestras</span><b>{capture.samplesWritten.toLocaleString()}</b></div>
                  <div><span>Perdidas</span><b class:warn={capture.samplesLost > 5}>{capture.samplesLost}</b></div>
                  <div><span>Tasa efectiva</span><b>{capture.stage === 'recording' && capture.recElapsed > 0 ? (capture.samplesWritten / capture.recElapsed).toFixed(1) : '—'} Hz</b></div>
                </div>

                <div class="mini-stats">
                  <div><span>Tamaño CSV</span><b>{fmtBytes(capture.bytesWritten)}</b></div>
                  <div><span>Estado</span><b>{capture.stage}</b></div>
                  <div><span>Sesión</span><b class="mono-short">{capture.sessionId?.slice(0, 8) ?? '—'}</b></div>
                </div>

                {#if capture.stage === 'done' && capture.summary}
                  <div class="ok-msg">
                    <span class="ok-ic">✓</span>
                    <div>
                      Captura cerrada · {capture.summary.status}.<br>
                      <small style="font-family:ui-monospace,monospace;font-size:11px;word-break:break-all">SHA-256: {capture.summary.csv_sha256}</small>
                    </div>
                  </div>
                {/if}
              </div>
            {/if}
          </div>
        </div>
      </section>

    <!-- ─────────────── STEP 4: ANALYSIS ─────────────── -->
    {:else if step === 'analysis'}
      <section class="panel">
        <header class="panel-h">
          <h2>Análisis</h2>
          <p class="lead">Allan variance overlapping y métricas de sampling sobre el CSV cerrado.</p>
        </header>

        {#if !capture.csvPath}
          <div class="warn-msg">
            <span class="warn-ic">!</span>
            <div><b>Sin captura disponible.</b><div>Vuelva al paso 3 y realice una captura primero.</div></div>
          </div>
        {:else if analysis.state === 'running'}
          <div class="card">
            <div class="card-h">Procesando…</div>
            <div class="empty small">
              <div class="spinner-sm"></div>
              <p class="empty-d">Calculando Allan variance + sampling sobre {capture.samplesWritten.toLocaleString()} muestras.</p>
            </div>
          </div>
        {:else if analysis.state === 'error'}
          <div class="warn-msg">
            <span class="warn-ic">!</span>
            <div><b>Error de análisis</b><div>{analysis.error}</div></div>
          </div>
          <div class="actions-row">
            <button class="primary" onclick={() => capture.csvPath && analysis.run(capture.csvPath, 200)}>Reintentar</button>
          </div>
        {:else if analysis.state === 'done' && analysis.allan && analysis.sampling && allanBounds}
          {@const a = analysis.allan}
          {@const s = analysis.sampling}
          {@const b = allanBounds}
          {@const eMinTau = Math.ceil(Math.log10(b.tauMin))}
          {@const eMaxTau = Math.floor(Math.log10(b.tauMax))}
          {@const eMinSig = Math.log10(b.sigMin)}
          {@const eMaxSig = Math.log10(b.sigMax)}
          {@const hist = s.histogram_dt_us}
          {@const maxC = Math.max(...hist.map((bin) => bin[1]), 1)}

          <div class="card">
            <div class="card-h">Allan variance σ(τ) — overlapping (3 ejes)</div>
            <div class="allan-wrap">
              <svg viewBox="0 0 {ALLAN_W} {ALLAN_H}" class="allan">
                <!-- Grid τ -->
                {#each Array.from({ length: Math.max(0, eMaxTau - eMinTau + 1) }, (_, k) => eMinTau + k) as e}
                  {@const x = logScale(Math.pow(10, e), b.tauMin, b.tauMax, plotW, ALLAN_PAD.l)}
                  <line x1={x} y1={ALLAN_PAD.t} x2={x} y2={ALLAN_H - ALLAN_PAD.b} stroke="var(--border)" stroke-dasharray="2 3" />
                  <text x={x} y={ALLAN_H - ALLAN_PAD.b + 16} text-anchor="middle" font-size="10" fill="var(--text-muted)">10^{e}</text>
                {/each}
                <!-- Grid σ -->
                {#each Array.from({ length: Math.max(0, Math.floor(eMaxSig) - Math.ceil(eMinSig) + 1) }, (_, k) => Math.ceil(eMinSig) + k) as e}
                  {@const y = ALLAN_H - ALLAN_PAD.b - ((e - eMinSig) / (eMaxSig - eMinSig)) * plotH}
                  <line x1={ALLAN_PAD.l} y1={y} x2={ALLAN_W - ALLAN_PAD.r} y2={y} stroke="var(--border)" stroke-dasharray="2 3" />
                  <text x={ALLAN_PAD.l - 6} y={y + 3} text-anchor="end" font-size="10" fill="var(--text-muted)">10^{e}</text>
                {/each}
                <!-- Curvas X / Y / Z -->
                <path d={buildAllanPath(a.sigma_x_dps, b, a.tau_s)} fill="none" stroke="var(--primary)" stroke-width="2" />
                <path d={buildAllanPath(a.sigma_y_dps, b, a.tau_s)} fill="none" stroke="var(--accent)" stroke-width="2" />
                <path d={buildAllanPath(a.sigma_z_dps, b, a.tau_s)} fill="none" stroke="var(--success)" stroke-width="2" />
                <text x={ALLAN_W/2} y={ALLAN_H - 4} text-anchor="middle" font-size="11" fill="var(--text-muted)">τ (s)</text>
                <text x="14" y={ALLAN_H/2} text-anchor="middle" font-size="11" fill="var(--text-muted)" transform="rotate(-90 14 {ALLAN_H/2})">σ(τ) (°/s)</text>
                <!-- Leyenda -->
                <g transform="translate({ALLAN_W - ALLAN_PAD.r - 70}, {ALLAN_PAD.t + 6})">
                  <rect x="-6" y="-4" width="76" height="52" fill="var(--surface)" stroke="var(--border)" rx="3" />
                  <line x1="0" y1="6" x2="14" y2="6" stroke="var(--primary)" stroke-width="2" />
                  <text x="18" y="9" font-size="10" fill="var(--text)">X (yaw)</text>
                  <line x1="0" y1="22" x2="14" y2="22" stroke="var(--accent)" stroke-width="2" />
                  <text x="18" y="25" font-size="10" fill="var(--text)">Y (pitch)</text>
                  <line x1="0" y1="38" x2="14" y2="38" stroke="var(--success)" stroke-width="2" />
                  <text x="18" y="41" font-size="10" fill="var(--text)">Z (roll)</text>
                </g>
              </svg>

              <div class="allan-readout">
                <div class="ro-block">
                  <div class="ro-h">ARW (°/√h)</div>
                  <dl class="kv compact">
                    <dt>X</dt><dd>{a.arw_deg_sqrt_hr[0].toFixed(3)}</dd>
                    <dt>Y</dt><dd>{a.arw_deg_sqrt_hr[1].toFixed(3)}</dd>
                    <dt>Z</dt><dd>{a.arw_deg_sqrt_hr[2].toFixed(3)}</dd>
                  </dl>
                </div>
                <div class="ro-block">
                  <div class="ro-h">Bias instab. (°/h)</div>
                  <dl class="kv compact">
                    <dt>X</dt><dd>{a.bias_instability_deg_hr[0].toFixed(1)}</dd>
                    <dt>Y</dt><dd>{a.bias_instability_deg_hr[1].toFixed(1)}</dd>
                    <dt>Z</dt><dd>{a.bias_instability_deg_hr[2].toFixed(1)}</dd>
                  </dl>
                </div>
                <div class="ro-block">
                  <div class="ro-h">τ del mínimo</div>
                  <dl class="kv compact">
                    <dt>X</dt><dd>{a.tau_at_min_s[0].toFixed(2)} s</dd>
                    <dt>Y</dt><dd>{a.tau_at_min_s[1].toFixed(2)} s</dd>
                    <dt>Z</dt><dd>{a.tau_at_min_s[2].toFixed(2)} s</dd>
                  </dl>
                </div>
              </div>
            </div>
          </div>

          <div class="grid-2">
            <div class="card">
              <div class="card-h">Sampling</div>
              <dl class="kv">
                <dt>Declarada</dt><dd>{s.declared_hz.toFixed(1)} Hz</dd>
                <dt>Medida</dt><dd><b>{s.measured_hz.toFixed(2)} Hz</b></dd>
                <dt>Δt medio</dt><dd>{s.mean_dt_us.toFixed(1)} µs</dd>
                <dt>Δt σ</dt><dd>{s.stdev_dt_us.toFixed(2)} µs</dd>
                <dt>Δt p50</dt><dd>{s.p50_dt_us.toFixed(0)} µs</dd>
                <dt>Δt p99</dt><dd>{s.p99_dt_us.toFixed(0)} µs</dd>
                <dt>Δt máx</dt><dd>{s.max_dt_us.toFixed(0)} µs</dd>
                <dt>Muestras perdidas</dt><dd class:warn-val={s.samples_lost_estimate > 5}>{s.samples_lost_estimate}</dd>
                <dt>Cumple vHIT</dt><dd>{s.passes_vhit_criterion ? '✓ sí' : '✗ no'}</dd>
              </dl>
            </div>
            <div class="card">
              <div class="card-h">Histograma de Δt</div>
              <svg viewBox="0 0 280 160" class="hist">
                {#each hist as bin, i}
                  {@const w = 280 / hist.length}
                  {@const h = (bin[1] / maxC) * 130}
                  <rect x={i * w + 0.5} y={140 - h} width={Math.max(1, w - 1)} height={h} fill="var(--primary)" opacity="0.85" />
                {/each}
                <line x1="0" y1="140" x2="280" y2="140" stroke="var(--border-strong)" />
                <text x="2" y="155" font-size="9" fill="var(--text-muted)">{hist[0]?.[0].toFixed(0) ?? 0}</text>
                <text x="278" y="155" font-size="9" fill="var(--text-muted)" text-anchor="end">{hist[hist.length-1]?.[0].toFixed(0) ?? 0}</text>
                <text x="140" y="155" font-size="9" fill="var(--text-muted)" text-anchor="middle">Δt (µs)</text>
              </svg>
            </div>
          </div>
        {:else}
          <div class="empty small">
            <p class="empty-d">Sin datos.</p>
          </div>
        {/if}

        <div class="card">
          <div class="card-h">Validación sintética de detectores</div>
          <p class="note inline" style="margin-top:0;margin-bottom:12px">
            Pasa una grilla de impulsos gaussianos (peak × duración × ruido × repeticiones) por el pipeline real
            y compara contra el ground truth derivado del preset clínico activo
            (<b>{acceptance.active.name}</b>).
          </p>

          {#if synthetic.state === 'idle' || synthetic.state === 'error'}
            <div class="actions-row">
              <button class="primary" onclick={() => synthetic.run()}>▶ Ejecutar validación</button>
              <span class="note inline" style="margin:0;padding:6px 10px">Grid por defecto: 6 × 4 × 3 × 30 = 2160 ensayos</span>
            </div>
            {#if synthetic.error}<div class="err-inline">{synthetic.error}</div>{/if}
          {:else if synthetic.state === 'running'}
            <div class="empty small">
              <div class="spinner-sm"></div>
              <p class="empty-d">Generando trazas y evaluando detectores…</p>
            </div>
          {:else if synthetic.state === 'done' && synthetic.result}
            {@const r = synthetic.result}
            <div class="mini-stats" style="margin-bottom:12px">
              <div><span>Trials</span><b>{r.totalTrials}</b></div>
              <div><span>In-spec</span><b>{r.inSpecCount}</b></div>
              <div><span>Out-of-spec</span><b>{r.outOfSpecCount}</b></div>
              <div><span>Tiempo</span><b>{r.durationMs.toFixed(0)} ms</b></div>
            </div>

            <table class="tbl" style="margin-bottom:12px">
              <thead>
                <tr>
                  <th>Detector</th>
                  <th>TP</th><th>FP</th><th>TN</th><th>FN</th>
                  <th>Accuracy</th><th>Precision</th><th>Recall</th><th>F1</th>
                </tr>
              </thead>
              <tbody>
                {#each r.perDetector as d}
                  <tr>
                    <td><b>{d.detector}</b></td>
                    <td>{d.confusion.tp}</td>
                    <td>{d.confusion.fp}</td>
                    <td>{d.confusion.tn}</td>
                    <td>{d.confusion.fn}</td>
                    <td class:warn-val={d.accuracy < 0.9}>{(d.accuracy * 100).toFixed(1)}%</td>
                    <td>{(d.precision * 100).toFixed(1)}%</td>
                    <td>{(d.recall * 100).toFixed(1)}%</td>
                    <td>{(d.f1 * 100).toFixed(1)}%</td>
                  </tr>
                {/each}
                <tr style="border-top:2px solid var(--border-strong)">
                  <td><b>Global (∧)</b></td>
                  <td>{r.globalConfusion.tp}</td>
                  <td>{r.globalConfusion.fp}</td>
                  <td>{r.globalConfusion.tn}</td>
                  <td>{r.globalConfusion.fn}</td>
                  <td colspan="4" style="color:var(--text-muted);font-size:11px">
                    Aceptación combinada (todos los detectores pass)
                  </td>
                </tr>
              </tbody>
            </table>

            <div class="actions-row">
              <button onclick={() => synthetic.run()}>↻ Re-ejecutar</button>
              <button onclick={() => synthetic.reset()}>Limpiar</button>
            </div>
          {/if}
        </div>

        <div class="actions-row right">
          <button onclick={() => (step = 'capture')}>← Nueva captura</button>
          <button class="primary" onclick={() => (step = 'profile')} disabled={analysis.state !== 'done'}>Generar perfil →</button>
        </div>
      </section>

    <!-- ─────────────── STEP 5: PROFILE / VERDICT ─────────────── -->
    {:else if step === 'profile'}
      <section class="panel">
        <header class="panel-h">
          <h2>Perfil del sensor</h2>
          <p class="lead">Veredicto consolidado y artefacto exportable con hashes verificables.</p>
        </header>

        <article class="profile-export">
          <div class="export-head">
            <div>
              <div class="export-tag">SimHIT — Perfil de caracterización del sensor</div>
              <div class="export-title">{detectedSensor?.label ?? '(sin sensor)'} · {new Date().toLocaleString('es', { dateStyle: 'short', timeStyle: 'short' })}</div>
            </div>
            <div class="export-meta">
              <div><span>Preset</span><b>{acceptance.active.name}</b></div>
              <div><span>Firmware</span><b>v{firmwareInfo.version}</b></div>
              <div><span>Sesión</span><b class="mono-short">{capture.sessionId?.slice(0, 8) ?? '—'}</b></div>
            </div>
          </div>

        <div class="card verdict-card" class:pass={verdict.overall === 'Pass'} class:fail={verdict.overall === 'Fail'} class:marginal={verdict.overall === 'Marginal'}>
          <div class="verdict-head">
            <div class="verdict-badge" class:bad={verdict.overall === 'Fail'} class:warn={verdict.overall === 'Marginal'} class:pending={verdict.overall === 'Pending'}>
              {verdict.overall.toUpperCase()}
            </div>
            <div>
              <div class="verdict-sub">Cumplimiento vHIT</div>
              <h3 class="verdict-sensor">{detectedSensor?.label ?? 'sin sensor'}</h3>
            </div>
          </div>
          {#if verdict.criteria.length > 0}
            <table class="verdict-tbl">
              <thead>
                <tr><th>Criterio</th><th>Medido</th><th>Umbral Pass</th><th></th></tr>
              </thead>
              <tbody>
                {#each verdict.criteria as c}
                  <tr>
                    <td>{c.name}</td>
                    <td>{c.value}</td>
                    <td>{c.threshold}</td>
                    <td>
                      {#if c.status === 'pass'}<span class="badge ok">Pass</span>
                      {:else if c.status === 'marginal'}<span class="badge warn-b">Marginal</span>
                      {:else if c.status === 'fail'}<span class="badge bad">Fail</span>
                      {:else}<span class="badge muted">No medido</span>
                      {/if}
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          {:else}
            <p class="empty-d">Sin análisis disponible. Vuelva al paso anterior.</p>
          {/if}
        </div>

        {#if analysis.allan && analysis.sampling}
          <div class="card">
            <div class="card-h">Métricas medidas (resumen)</div>
            <div class="grid-2">
              <dl class="kv">
                <dt>Frecuencia efectiva</dt><dd><b>{analysis.sampling.measured_hz.toFixed(2)} Hz</b></dd>
                <dt>Δt σ (jitter)</dt><dd>{analysis.sampling.stdev_dt_us.toFixed(2)} µs</dd>
                <dt>Muestras escritas</dt><dd>{analysis.sampling.n_samples.toLocaleString()}</dd>
                <dt>Muestras perdidas</dt><dd>{analysis.sampling.samples_lost_estimate}</dd>
              </dl>
              <dl class="kv">
                <dt>ARW máx (3 ejes)</dt><dd><b>{Math.max(...analysis.allan.arw_deg_sqrt_hr).toFixed(3)} °/√h</b></dd>
                <dt>BI máx (3 ejes)</dt><dd>{Math.max(...analysis.allan.bias_instability_deg_hr).toFixed(1)} °/h</dd>
                <dt>Duración análisis</dt><dd>{analysis.allan.duration_s.toFixed(1)} s</dd>
                <dt>Fs análisis</dt><dd>{analysis.allan.sample_rate_hz.toFixed(2)} Hz</dd>
              </dl>
            </div>
            {#if capture.summary}
              <p class="note inline" style="margin-top:10px">
                CSV: <code class="mono-short">{capture.csvPath}</code><br>
                SHA-256: <code class="mono-short" style="word-break:break-all">{capture.summary.csv_sha256}</code>
              </p>
            {/if}
          </div>
        {/if}

        {#if showReference && referenceData && analysis.allan && analysis.sampling}
          {@const a = analysis.allan}
          {@const arwMax = Math.max(...a.arw_deg_sqrt_hr)}
          {@const biMax = Math.max(...a.bias_instability_deg_hr)}
          {@const rArw = refRatio(arwMax, referenceData.arw_deg_sqrt_hr)}
          {@const rBi = refRatio(biMax, referenceData.bias_instability_deg_hr)}
          <div class="card">
            <div class="card-h">Comparación con referencia · {referenceData.label}</div>
            <table class="tbl">
              <thead>
                <tr><th>Métrica</th><th>Medido</th><th>Referencia</th><th>Ratio</th><th></th></tr>
              </thead>
              <tbody>
                <tr>
                  <td>ARW (°/√h)</td>
                  <td>{arwMax.toFixed(3)}</td>
                  <td>{referenceData.arw_deg_sqrt_hr.toFixed(2)}</td>
                  <td><b>{isFinite(rArw.ratio) ? rArw.ratio.toFixed(2) + '×' : '—'}</b></td>
                  <td><span class="badge {rArw.status === 'ok' ? 'ok' : rArw.status === 'warn' ? 'warn-b' : 'bad'}">
                    {rArw.status === 'ok' ? 'Coherente' : rArw.status === 'warn' ? 'Elevado' : 'Anómalo'}
                  </span></td>
                </tr>
                <tr>
                  <td>Bias instability (°/h)</td>
                  <td>{biMax.toFixed(1)}</td>
                  <td>{referenceData.bias_instability_deg_hr.toFixed(0)}</td>
                  <td><b>{isFinite(rBi.ratio) ? rBi.ratio.toFixed(2) + '×' : '—'}</b></td>
                  <td><span class="badge {rBi.status === 'ok' ? 'ok' : rBi.status === 'warn' ? 'warn-b' : 'bad'}">
                    {rBi.status === 'ok' ? 'Coherente' : rBi.status === 'warn' ? 'Elevado' : 'Anómalo'}
                  </span></td>
                </tr>
                <tr>
                  <td>Rango dinámico (°/s)</td>
                  <td>—</td>
                  <td>{referenceData.range_dps}</td>
                  <td>—</td>
                  <td><span class="badge muted">Configurable</span></td>
                </tr>
              </tbody>
            </table>
            <p class="note inline">Fuente: <i>{referenceData.source}</i>. Ratio ≤ 1.5× = coherente con datasheet; &gt; 3× sugiere problema de montaje, vibración o configuración.</p>
          </div>
        {/if}
        </article>

        <div class="card no-export">
          <div class="card-h">Exportar</div>
          <div class="actions-row">
            <button class="primary" onclick={exportJson} disabled={exporting !== 'none' || !analysis.allan}>
              {exporting === 'json' ? 'Guardando…' : '📄 sensor_profile.json'}
            </button>
            <button onclick={exportPdf} disabled={exporting !== 'none' || !analysis.allan}>
              {exporting === 'pdf' ? 'Generando PDF…' : '📕 Exportar PDF'}
            </button>
            <button onclick={() => (showReference = !showReference)} disabled={!referenceData}>
              📊 {showReference ? 'Ocultar' : 'Mostrar'} referencia
            </button>
          </div>
          <p class="note inline">
            schema: <code>simhit-profile-1.0</code>. Incluye SHA-256 del CSV, configuración de firmware, sensor, preset clínico, y todas las métricas calculadas.
          </p>
          {#if exportError}<div class="err-inline">{exportError}</div>{/if}
        </div>

        <div class="actions-row right no-export">
          <button onclick={() => (step = 'flash')}>↺ Empezar de nuevo</button>
        </div>
      </section>
    {/if}
  </main>
</div>

<style>
  .app {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    background: var(--bg);
  }
  .layout {
    flex: 1;
    width: 100%;
    padding: 78px 20px 32px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  /* Stepper */
  .stepper {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 8px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 8px;
  }
  .step {
    display: flex; align-items: center; gap: 8px;
    padding: 8px 12px;
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    color: var(--text-muted);
    cursor: pointer;
    text-align: left;
  }
  .step:hover { background: var(--primary-soft); color: var(--primary); }
  .step.active { background: var(--primary); color: white; border-color: var(--primary); }
  .step.active .step-n { background: rgba(255,255,255,.25); color: white; }
  .step.done { color: var(--success); }
  .step.done .step-n { background: var(--success); color: white; }
  .step-n {
    width: 24px; height: 24px; border-radius: 50%;
    background: var(--surface-2);
    display: grid; place-items: center;
    font-size: 12px; font-weight: 700;
    flex-shrink: 0;
  }
  .step-l { font-size: 13px; font-weight: 500; }

  /* Panels */
  .panel { display: flex; flex-direction: column; gap: 16px; }
  .panel-h h2 { margin: 0 0 4px; font-size: 22px; color: var(--text); }
  .panel-h .lead { margin: 0; color: var(--text-muted); font-size: 13px; }

  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 18px;
  }
  .card-h {
    font-size: 11px; font-weight: 700; letter-spacing: .05em;
    text-transform: uppercase; color: var(--text-muted);
    margin-bottom: 12px;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--border);
  }
  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  @media (max-width: 760px) { .grid-2 { grid-template-columns: 1fr; } }

  .empty {
    flex: 1;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 8px; padding: 32px 16px; text-align: center;
  }
  .empty.small { padding: 20px 12px; }
  .empty-ic { font-size: 42px; opacity: .6; }
  .empty-t { font-size: 15px; font-weight: 600; color: var(--text); }
  .empty-d { color: var(--text-muted); font-size: 13px; margin: 0 0 8px; }
  .actions-row {
    display: flex; gap: 8px; flex-wrap: wrap;
  }
  .actions-row.right { justify-content: flex-end; }
  .bar {
    height: 10px;
    background: var(--surface-2);
    border-radius: 999px;
    overflow: hidden;
    border: 1px solid var(--border);
  }
  .bar-fill {
    height: 100%;
    background: var(--primary);
    transition: width .15s ease-out;
  }
  .ok-msg {
    display: flex; align-items: center; gap: 10px;
    padding: 12px 14px;
    background: rgba(22,163,74,.08);
    border: 1px solid rgba(22,163,74,.3);
    border-radius: var(--radius-sm);
    font-size: 13px; color: var(--text);
    margin-top: 10px;
  }
  .ok-ic {
    width: 22px; height: 22px; border-radius: 50%;
    background: var(--success); color: white;
    display: grid; place-items: center;
    font-weight: 700; font-size: 14px;
    flex-shrink: 0;
  }

  .note {
    font-size: 12px; color: var(--text-muted);
    padding: 10px 14px;
    background: var(--surface-2);
    border-radius: var(--radius-sm);
    border-left: 3px solid var(--accent);
  }
  .note.inline { margin-top: 10px; }

  /* Sensor */
  .sensor-name {
    font-size: 24px; font-weight: 700; color: var(--primary);
    margin-bottom: 12px;
  }
  .sensor-info .block { margin-top: 14px; }
  button.block { width: 100%; }

  .kv {
    display: grid; grid-template-columns: auto 1fr; gap: 6px 12px;
    margin: 0;
  }
  .kv dt { color: var(--text-muted); font-size: 12px; }
  .kv dd { margin: 0; font-size: 13px; color: var(--text); font-family: ui-monospace, monospace; }
  .kv.compact { gap: 2px 10px; }
  .kv.compact dt, .kv.compact dd { font-size: 12px; }

  .tbl {
    width: 100%; border-collapse: collapse; font-size: 12px;
  }
  .tbl th, .tbl td {
    text-align: left; padding: 6px 8px;
    border-bottom: 1px solid var(--border);
  }
  .tbl th { color: var(--text-muted); font-weight: 600; font-size: 11px; text-transform: uppercase; }
  .tbl tr.hit { background: var(--primary-soft); }
  .tbl tr.hit td { color: var(--primary); font-weight: 600; }
  .tbl code { font-size: 11px; }

  /* Form */
  .form { display: flex; flex-direction: column; gap: 10px; }
  .form label {
    display: grid; grid-template-columns: 160px 1fr; gap: 12px;
    align-items: center;
  }
  .form label span { font-size: 12px; color: var(--text-muted); }
  .form input {
    padding: 6px 10px;
    border: 1px solid var(--border-strong);
    background: var(--surface);
    border-radius: var(--radius-sm);
    font: inherit; font-size: 13px;
    color: var(--text);
  }
  .form input:disabled { opacity: .5; }

  /* Progress block */
  .prog-block { display: flex; flex-direction: column; gap: 10px; }
  .prog-stage {
    display: grid; grid-template-columns: 16px 1fr auto; gap: 10px;
    align-items: center;
    padding: 8px 10px;
    background: var(--surface-2);
    border-radius: var(--radius-sm);
    opacity: .5;
  }
  .prog-stage.active { opacity: 1; border-left: 3px solid var(--primary); }
  .prog-stage.done { opacity: .85; border-left: 3px solid var(--success); }
  .prog-stage .dot {
    width: 12px; height: 12px; border-radius: 50%;
    background: var(--border-strong);
  }
  .prog-stage.active .dot { background: var(--primary); animation: pulse 1.4s infinite; }
  .prog-stage.done .dot { background: var(--success); }
  .prog-stage .lab { font-size: 13px; }
  .prog-stage .val { font-size: 12px; color: var(--text-muted); font-family: ui-monospace, monospace; }
  @keyframes pulse { 50% { opacity: .4; } }

  .mini-stats {
    display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px;
    margin-top: 4px;
  }
  .mini-stats > div {
    background: var(--surface-2);
    border-radius: var(--radius-sm);
    padding: 8px;
    text-align: center;
  }
  .mini-stats span {
    display: block;
    font-size: 10px; color: var(--text-muted);
    text-transform: uppercase; letter-spacing: .04em;
  }
  .mini-stats b { font-size: 16px; font-family: ui-monospace, monospace; }
  .mini-stats b.warn { color: var(--danger); }

  /* Allan */
  .allan-wrap {
    display: grid; grid-template-columns: 1fr 200px; gap: 16px;
    align-items: start;
  }
  @media (max-width: 760px) { .allan-wrap { grid-template-columns: 1fr; } }
  .allan { width: 100%; height: auto; max-height: 320px; }
  .allan-readout { display: flex; flex-direction: column; gap: 12px; }
  .ro-block {
    background: var(--surface-2);
    border-radius: var(--radius-sm);
    padding: 10px 12px;
  }
  .ro-h {
    font-size: 10px; text-transform: uppercase; letter-spacing: .04em;
    color: var(--text-muted); font-weight: 700;
    margin-bottom: 6px;
  }

  /* Verdict */
  .verdict-card.pass {
    border-color: rgba(22,163,74,.35);
    background: linear-gradient(180deg, rgba(22,163,74,.04), transparent 80%);
  }
  .verdict-head {
    display: flex; align-items: center; gap: 16px;
    margin-bottom: 14px;
  }
  .verdict-badge {
    padding: 10px 22px;
    border-radius: 999px;
    background: var(--success);
    color: white;
    font-weight: 700;
    font-size: 14px;
    letter-spacing: .08em;
  }
  .verdict-sub { font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: var(--text-muted); }
  .verdict-sensor { margin: 2px 0 0; font-size: 18px; }

  .verdict-tbl { width: 100%; border-collapse: collapse; font-size: 13px; }
  .verdict-tbl th, .verdict-tbl td {
    text-align: left; padding: 8px 10px;
    border-bottom: 1px solid var(--border);
  }
  .verdict-tbl th { font-size: 11px; color: var(--text-muted); text-transform: uppercase; font-weight: 600; }
  .verdict-tbl td:nth-child(2), .verdict-tbl td:nth-child(3) { font-family: ui-monospace, monospace; }

  .badge {
    display: inline-block;
    padding: 2px 10px;
    border-radius: 999px;
    font-size: 11px; font-weight: 600;
  }
  .badge.ok { background: rgba(22,163,74,.15); color: var(--success); }
  .badge.muted { background: var(--surface-2); color: var(--text-muted); }

  code {
    font-family: ui-monospace, monospace;
    font-size: 0.9em;
    background: var(--surface-2);
    padding: 1px 5px;
    border-radius: 3px;
  }

  .warn-msg {
    display: flex; align-items: flex-start; gap: 10px;
    padding: 12px 14px;
    background: rgba(225, 29, 72, .06);
    border: 1px solid rgba(225, 29, 72, .25);
    border-radius: var(--radius-sm);
    font-size: 13px;
  }
  .warn-msg b { display: block; margin-bottom: 2px; }
  .warn-ic {
    width: 22px; height: 22px; border-radius: 50%;
    background: var(--danger); color: white;
    display: grid; place-items: center;
    font-weight: 700; font-size: 14px; flex-shrink: 0;
  }
  .err-inline {
    margin-top: 8px;
    padding: 8px 10px;
    background: rgba(225, 29, 72, .08);
    border-left: 3px solid var(--danger);
    border-radius: 4px;
    font-size: 12px;
    color: var(--text);
  }
  .danger-btn {
    color: var(--danger);
    border-color: rgba(225, 29, 72, .3);
  }
  .danger-btn:hover { background: rgba(225, 29, 72, .08); border-color: var(--danger); }
  .mono-short { font-family: ui-monospace, monospace; font-size: 12px; }

  .spinner-sm {
    width: 32px; height: 32px;
    border: 3px solid var(--border);
    border-top-color: var(--primary);
    border-radius: 50%;
    margin: 12px auto;
    animation: spin .8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  .hist { width: 100%; height: auto; max-height: 200px; }

  .warn-val { color: var(--danger); font-weight: 600; }

  .badge.bad { background: rgba(225,29,72,.15); color: var(--danger); }
  .badge.warn-b { background: rgba(234,88,12,.15); color: var(--primary); }

  .verdict-card.fail {
    border-color: rgba(225,29,72,.35);
    background: linear-gradient(180deg, rgba(225,29,72,.04), transparent 80%);
  }
  .verdict-card.marginal {
    border-color: rgba(234,88,12,.35);
    background: linear-gradient(180deg, rgba(234,88,12,.04), transparent 80%);
  }
  .verdict-badge.bad { background: var(--danger); }
  .verdict-badge.warn { background: var(--primary); }
  .verdict-badge.pending { background: var(--text-muted); }

  .sensor-list {
    list-style: none; padding: 0; margin: 0;
    display: flex; flex-direction: column; gap: 8px;
  }
  .sensor-list li {
    padding: 10px 12px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    border-left: 3px solid transparent;
  }
  .sensor-list li.hit {
    border-left-color: var(--primary);
    background: var(--primary-soft);
  }
  .sensor-list-h {
    display: flex; justify-content: space-between; align-items: flex-start;
    gap: 12px; margin-bottom: 4px; flex-wrap: wrap;
  }
  .sensor-list b { font-size: 14px; color: var(--text); }
  .vendor {
    font-size: 11px; color: var(--text-muted);
    margin-left: 6px;
  }
  .sensor-tags {
    display: flex; gap: 4px; flex-wrap: wrap;
  }
  .tag {
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 999px;
    background: var(--surface);
    border: 1px solid var(--border);
    color: var(--text-muted);
  }
  .tag code { background: transparent; padding: 0; }
  .tag.tag-on { background: rgba(22,163,74,.12); color: var(--success); border-color: rgba(22,163,74,.3); }
  .tag.tag-accent { background: var(--accent-soft); color: var(--accent); border-color: var(--accent); }
  .sensor-contents {
    font-size: 12px; color: var(--text);
    margin-top: 4px;
  }
  .sensor-notes {
    font-size: 11px; color: var(--text-muted);
    margin-top: 4px; line-height: 1.4;
  }

  .update-box {
    padding: 12px;
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    border-left: 4px solid var(--text-muted);
  }
  .update-box.up    { border-left-color: var(--success); background: rgba(22,163,74,.06); }
  .update-box.avail { border-left-color: var(--primary); background: var(--primary-soft); }
  .update-box.dev   { border-left-color: var(--accent);  background: var(--accent-soft); }
  .update-h {
    display: flex; align-items: center; gap: 8px;
    margin-bottom: 8px; font-size: 14px;
  }
  .update-h .ic {
    width: 24px; height: 24px; border-radius: 50%;
    display: grid; place-items: center;
    background: var(--text-muted); color: white;
    font-weight: 700; font-size: 14px;
  }
  .update-box.up    .update-h .ic { background: var(--success); }
  .update-box.avail .update-h .ic { background: var(--primary); }
  .update-box.dev   .update-h .ic { background: var(--accent); }

  .flash-progress {
    padding: 12px;
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    border: 1px solid var(--border);
  }
  .flash-stage {
    font-size: 13px; font-weight: 600;
    margin-bottom: 8px; color: var(--text);
  }
  .flash-pct {
    font-size: 11px; color: var(--text-muted);
    margin-top: 4px; font-family: ui-monospace, monospace;
    text-align: right;
  }
  .flash-msg {
    font-size: 11px; color: var(--text-muted);
    margin-top: 6px;
  }
  .bar-fill.indet {
    width: 30%;
    animation: indet 1.4s infinite linear;
  }
  @keyframes indet {
    0%   { margin-left: -30%; width: 30%; }
    50%  { margin-left: 50%;  width: 30%; }
    100% { margin-left: 100%; width: 0%; }
  }

  /* Bloque exportable a PDF */
  .profile-export {
    display: flex; flex-direction: column; gap: 16px;
    background: transparent;
  }
  .export-head {
    display: flex; justify-content: space-between; align-items: flex-end;
    gap: 16px; padding-bottom: 10px;
    border-bottom: 2px solid var(--primary);
  }
  .export-tag {
    font-size: 10px; text-transform: uppercase; letter-spacing: .08em;
    color: var(--primary); font-weight: 700;
  }
  .export-title {
    font-size: 20px; font-weight: 700; color: var(--text); margin-top: 4px;
  }
  .export-meta {
    display: flex; gap: 16px;
  }
  .export-meta > div {
    text-align: right;
  }
  .export-meta span {
    display: block; font-size: 10px; text-transform: uppercase;
    letter-spacing: .04em; color: var(--text-muted);
  }
  .export-meta b { font-size: 12px; font-family: ui-monospace, monospace; }

  /* Modo exportación: oculta UI auxiliar para que html2pdf solo capture el artículo */
  :global(body.is-exporting) .no-export { display: none !important; }
  :global(body.is-exporting) .profile-export {
    background: white;
    padding: 8px;
  }
</style>
