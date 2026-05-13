# Roadmap — Issue #13: Soporte impulsos verticales (pitch)

Referencia: [issue #13](https://github.com/Debaq/simHit/issues/13).

Estado actual: el simulador solo detecta impulsos horizontales (canales LL / RL) usando `serial.gyroYaw`. Los canales verticales LA, LP, RA, RP nunca se capturan. El campo `pitchTol` del preset de aceptación queda como código muerto. La práctica vertical (`practica-vert`) está bloqueada.

---

## Contexto anatómico — movimiento diagonal

El movimiento de cabeza en vHIT no es puro yaw ni puro pitch para los planos verticales:

- **Plano horizontal** (canales LL / RL): cabeza neutra mirando al frente. Impulso puro en yaw.
- **Plano RALP** (Right Anterior + Left Posterior): cabeza girada ~45° a la derecha. Impulso diagonal: combina yaw y pitch en frame absoluto.
- **Plano LARP** (Left Anterior + Right Posterior): cabeza girada ~45° a la izquierda. Impulso diagonal.

**Implicación:** la cabeza NO se mueve solo arriba/abajo. El sensor entrega yaw y pitch simultáneos durante el mismo impulso. La detección y evaluación deben trabajar sobre la **proyección de la velocidad combinada sobre el eje del canal**, no sobre yaw o pitch crudos por separado.

Además, las marcas de pose objetivo y las zonas de tolerancia en HeadLiveView no son compatibles entre planos: cada plano tiene su propia pose de inicio (yaw_target ≠ 0) y su propio eje de desplazamiento esperado.

---

## Fases

### F0 — Split tolerancias H/V en aceptación

**Archivos:** `app/src/lib/acceptance.svelte.ts`, `app/src/routes/docente/dificultad/+page.svelte`

- Ampliar `AcceptanceCfg`: duplicar `peakMin/Max`, `gainMin/Max`, `durMinMs/MaxMs` en variantes `*H` y `*V`.
- `yawTol` / `pitchTol` / `rollTol` ya existen separados ✓.
- Actualizar `BUILTIN` (principiante / estándar / avanzado): valores V iniciales = H, ajustables luego.
- `sanitizePreset`: migrar legado → asignar `*H = *V = valor_actual`.
- UI dificultad: pestañas o secciones separadas para H y V.

**Salida:** PR independiente sin cambio de comportamiento (solo schema + UI).

---

### F1 — Tipos canal extendidos

**Archivos:** `app/src/lib/simulator.svelte.ts`, `app/src/lib/practice.svelte.ts`, callers.

- `Impulse.side: 'LL'|'RL'|'LA'|'LP'|'RA'|'RP'`.
- Propagar firma a `consumeImpulse`, `attempts`, informes, revisor.
- Sin lógica de detección aún: solo asegurar que tipos compilen y rutas existentes sigan funcionando con LL/RL.

---

### F2 — Detección combinada yaw+pitch

**Archivos:** `app/src/lib/serial.svelte.ts`, `app/src/lib/simulator.svelte.ts`.

- Exponer `serial.drainGyroPitch()` análogo a `drainGyroYaw()`.
- En `tickWithSensor`: drenar yaw y pitch en paralelo.
- Constantes de eje por canal (vectores unitarios en plano sagital-horizontal):

  ```ts
  type ChannelAxis = { yaw: number; pitch: number };
  const CHANNEL_AXES: Record<Channel, ChannelAxis> = {
    LL: { yaw: -1, pitch: 0 },
    RL: { yaw: +1, pitch: 0 },
    LA: { yaw: -Math.SQRT1_2, pitch: -Math.SQRT1_2 },  // izq + abajo
    LP: { yaw: -Math.SQRT1_2, pitch: +Math.SQRT1_2 },  // izq + arriba
    RA: { yaw: +Math.SQRT1_2, pitch: +Math.SQRT1_2 },  // der + arriba
    RP: { yaw: +Math.SQRT1_2, pitch: -Math.SQRT1_2 },  // der + abajo
  };
  // Convención de signos pitch (arriba/abajo) a verificar contra firmware.
  ```

- **Trigger combinado:** magnitud `|v| = √(yaw² + pitch²)` cruza `IMPULSE_START_THR`.
- **Identificación de canal**:
  1. Pose de cabeza (`headYaw`) define plano: `< −umbral` → LARP (LA/RP); `> +umbral` → RALP (RA/LP); cerca de 0 → horizontal (LL/RL como hoy). Umbral inicial ~25°.
  2. Signo de la proyección `(gyroYaw, gyroPitch) · axis` define ant vs post.
- **Captura:** señal proyectada va en `capturing.head` (unidimensional, ya consumido por `evaluateImpulse`). Componentes crudos `headYawRaw[]`, `headPitchRaw[]` se guardan para revisor / informe.

---

### F3 — Evaluación según plano

**Archivos:** `app/src/lib/simulator.svelte.ts:evaluateImpulse`.

- Seleccionar rangos `*H` o `*V` de `AcceptanceCfg` según `imp.side`.
- `ampMax` = `yawTol` para LL/RL, `pitchTol` para verticales (ya implementado conceptualmente, ampliar al set completo).
- Las métricas se calculan sobre la señal proyectada (ya unidimensional desde F2).

---

### F4 — Bundle docente + escenarios

**Archivos:** `app/src/lib/bundle.svelte.ts`, `app/src/lib/scenario.svelte.ts`, `app/src/routes/docente/+page.svelte`.

- Agregar entry `practica-vert` ("5. Práctica vertical") en lista de escenarios predefinidos.
- Habilitar selección de canales LA / LP / RA / RP en el editor de goals.
- Verificar que `Scenario.channels` define los 6 canales (ya lo hace según ROADMAP.md, validar).

---

### F5 — HUD práctica vertical (parcial)

**Archivos:** `app/src/routes/practica/+page.svelte`.

- Mostrar canal correcto en HUD (LA / LP / RA / RP).
- Render impulsos verticales en el revisor.
- **Sin marca de pose objetivo nueva** (queda como TODO visible, depende de F0.5).
- HUD básico permite practicar pero la guía visual completa llega en F0.5.

---

### F6 — QA manual

- Hardware SimHIT conectado.
- Verificar:
  - Girar cabeza ~45° a derecha → impulsos diagonales capturados como RA o RP según dirección.
  - Girar cabeza ~45° a izquierda → LA / LP.
  - Cabeza neutra → LL / RL (sin regresión).
- Validar que tolerancias V independientes se aplican.
- Bundle `practica-vert` end-to-end.

---

## Diferido (post-issue #13)

### F0.5 — HeadLiveView vertical + pose objetivo

- Pose objetivo `(yaw, pitch)` por canal (LARP / RALP estándar a ±45°).
- Marca y zona verde relativas a pose objetivo, no a cero.
- Componente nuevo o modo del existente para representar plano 2D (yaw × pitch).
- Trayectoria de impulso visible como segmento diagonal.
- Bloquea UX completa de práctica vertical.

### Mejoras posteriores

- Captura mixta yaw+pitch simultánea (impulsos oblicuos fuera de eje canónico).
- Calibración de ángulo de plano por sujeto (¿siempre 45° o ajustable?).
- Roll completo (canales RP / LA dependen también de roll en algunos protocolos).

---

## Riesgos

- **Ruido cruzado entre planos:** sin proyección sobre eje del canal, vibraciones de yaw pueden disparar falsos impulsos verticales y viceversa. Mitigación: proyección + umbral sobre magnitud combinada.
- **Convención de signos pitch:** firmware puede entregar pitch positivo hacia arriba o abajo. Verificar antes de fijar `CHANNEL_AXES`.
- **Pose target asumida ±45°:** sujetos reales varían. Para issue #13 fijamos 45°; calibración en F0.5+.

---

## Orden de PRs sugerido

| PR | Contenido | Depende |
|----|-----------|---------|
| 1  | F0 — schema split tolerancias H/V | — |
| 2  | F1 + F2 + F3 — detección y evaluación combinada | PR1 |
| 3  | F4 — bundle + editor docente | PR2 |
| 4  | F5 — HUD básico práctica vertical | PR3 |
| 5  | F0.5 — HeadLiveView vertical (cierra issue #13) | PR4 |
