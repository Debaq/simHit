# SimHIT — Simulador para enseñar el Head Impulse Test (vHIT)

**Plataforma educativa abierta · v2026.05**

SimHIT es un simulador completo para enseñar y entrenar el Head Impulse Test asistido por video (vHIT). Las **gafas SimHIT replican el equipo clínico real**: mismo peso, misma forma, mismo sistema de ajuste y los mismos sensores de movimiento. La única pieza que falta respecto a un vHIT comercial es la cámara que filma el ojo del paciente — y esa ausencia es deliberada, porque el ojo lo aporta el paciente virtual del software.

SimHIT tiene **dos componentes pedagógicos** que conviven en la misma aplicación:

1. **Modo simulación / examen clínico**. Sobre un compañero que lleva puestas las gafas, el alumno ejecuta el examen completo igual que en consulta: estimula los canales, los impulsos se miden con la misma técnica que mediría un vHIT real (amplitud, velocidad pico, aceleración, dirección, ventana temporal), y la aplicación responde con la **fisiología ocular del caso clínico cargado**: ganancia VOR, sacadas correctivas covert u overt, artefactos típicos. El alumno obtiene un informe clínico estructurado, indistinguible en estructura del informe que entregaría un equipo comercial.

2. **Modo práctica**. Antes del examen real, el alumno entrena el gesto motor: amplitud justa, velocidad pico suficiente, dirección dentro del plano del canal, ritmo no predecible. La aplicación valida cada impulso uno a uno y dice por qué fue aceptado o rechazado, sin meter aún la complejidad de la interpretación clínica.

Lo que cambia respecto al equipo clínico no es la técnica ni el flujo: es que la patología es **programable**. El docente decide si el paciente virtual del día tiene una hipofunción derecha, una bilateral, sacadas covert puras o un cuadro normal, y todos los alumnos se enfrentan al mismo cuadro reproducible.

---

## 1. ¿Qué problema resuelve?

El vHIT es una prueba breve pero **dependiente del examinador**: si el impulso es lento, demasiado amplio o predecible, el resultado pierde valor. En la formación tradicional el alumno aprende sobre el paciente: pocas oportunidades, mucha presión, retroalimentación tardía.

SimHIT invierte esa lógica sin sacar al "paciente" de la escena:

- El **gesto** se practica sobre un compañero que lleva las gafas SimHIT — mismo peso, misma forma, mismo ajuste que el equipo real. La sensación motora y postural es la de un examen verdadero.
- La **respuesta del paciente** (movimiento ocular, ganancia, sacadas) la genera el software según el caso clínico cargado, no la fisiología del compañero. Así un mismo voluntario puede "ser" un paciente normal, una hipofunción derecha o una neuritis aguda en la misma sesión.
- El **error es visible al instante**: cada impulso se acepta o rechaza con su motivo, y los resultados se acumulan en un informe.

El estudiante puede equivocarse cien veces sin daño y llegar a la práctica clínica con la técnica ya incorporada.

---

## 2. Capacidades del equipo

### Las gafas SimHIT

Réplica funcional de unas gafas vHIT clínicas: **mismo peso, misma forma, mismo sistema de ajuste a la cabeza, mismos sensores de movimiento**. El compañero que hace de paciente las lleva como en una consulta real, y el alumno apoya las manos sobre ellas para ejecutar el impulso con la misma biomecánica.

Lo que registran las gafas no es una aproximación: es el mismo dato que captura un equipo comercial. Giroscopio, acelerómetro y magnetómetro a **200 muestras por segundo** entregan orientación angular (yaw, pitch, roll) y velocidad angular por eje en tiempo real. Con eso la aplicación mide:

- **Amplitud** del giro cefálico en grados.
- **Velocidad pico** del impulso (°/s).
- **Duración** y forma del impulso.
- **Dirección 3D**: si la cabeza se mantuvo en el plano del canal evaluado o se desvió a otro plano.
- **Calidad del gesto**: doble pico, anticipación, rebote.

Aspectos prácticos:

- **Plug & play por USB-C**: la app detecta el cabezal automáticamente apenas se conecta.
- **Calibración guiada**: del giroscopio (cabezal quieto, 2 s) y del magnetómetro (rotación en figura-8, ~20 s). Se hace una vez por equipo y queda persistida en la memoria del dispositivo.
- **Mapeo de ejes configurable**: si el sensor queda montado en otra orientación, se ajusta en software sin tocar firmware.
- **Económico y replicable**: pensado para ser fabricado por la propia institución. Los planos (PCB, carcasa) y el firmware son abiertos.
- **Sensor intercambiable**: el protocolo es genérico; cualquier IMU equivalente reemplaza el original sin modificar la app.

### La aplicación

Aplicación de escritorio (Linux, Windows, macOS). El núcleo son dos motores: el de **medición del gesto** (idéntico en lógica al de un vHIT clínico) y el de **simulación del paciente virtual**.

**Visualización en vivo**

- Tres vistas anatómicas simultáneas de la cabeza del paciente: **superior** (yaw), **coronal** (roll) y **lateral** (pitch). En cada vista una silueta sigue la orientación real del compañero en tiempo real.
- **Conos de zona objetivo** verdes superpuestos a la silueta indican la dirección correcta para el canal que se está evaluando. El alumno ve, mientras hace el impulso, si su gesto va al plano correcto o se está desviando.
- Indicadores de **velocidad y amplitud** instantáneas.

**Animación del paciente virtual**

- Una ventana independiente (puede arrastrarse a una segunda pantalla, frente al alumno, como si fuera la pantalla del propio equipo clínico) muestra los ojos del paciente.
- La animación responde al impulso con la **fisiología del caso cargado**: si el canal tiene ganancia normal, el ojo sigue al estímulo; si tiene hipofunción, aparece la sacada correctiva, **covert** (durante el impulso, sutil) u **overt** (después del impulso, visible a ojo desnudo).
- El docente puede **editar los frames del ojo** (layout estrella: centro más 8 direcciones, secuencia de parpadeo, marcado de pupila) para producir su propio set visual.

**Detección y validación del impulso**

- Cada impulso se detecta y se mide automáticamente, igual que en el examen real.
- **Veredicto inmediato**: tras cada movimiento la app marca el impulso como aceptado (✓) o rechazado (✗) y muestra el motivo (amplitud baja, velocidad pico insuficiente, dirección fuera de plano, duración fuera de rango).
- **Feedback sonoro** opcional para reforzar el aprendizaje sin necesidad de mirar la pantalla.
- **Niveles de exigencia configurables** (inicial, básico, estándar, avanzado): el docente elige qué criterios se aplican según la etapa del alumno. Los rangos siguen literatura vHIT estándar y se pueden editar y restaurar.

**Simulación de patologías**

- **Editor de casos clínicos**: el docente define para cada uno de los seis canales semicirculares (laterales LL/RL, anteriores LA/RA, posteriores LP/RP) la respuesta esperada: ganancia, velocidad pico ocular, presencia y tipo de sacada (ninguna, covert, overt, ambas), artefactos.
- Trae **10 casos predefinidos** de referencia: normal, hipofunción derecha, hipofunción izquierda, bilateral, presbivestibulopatía, neuritis vestibular aguda y otros. Todos editables y restaurables al valor original.
- Casos exportables como archivos JSON, para compartir entre instituciones o publicar baterías docentes.

**Entrenamiento del ritmo**

- **Metrónomo configurable** (BPM y acento) para entrenar al alumno a romper la cadencia predecible — uno de los errores técnicos más comunes en el vHIT real, porque el paciente anticipa la dirección y el VOR se "adelanta", falseando la prueba.

**Informe clínico**

- Al cerrar el examen se genera un informe vHIT estructurado equivalente al de un equipo comercial: **tabla de ganancias por canal**, **gráficos** de velocidad cabeza vs. ojo, **casillas de hallazgos** (sacadas covert/overt por canal), **interpretación clínica** y **diagnóstico**.
- Los impulsos rechazados o artefactuales se pueden marcar como excluidos desde el análisis.
- **Exportación a PDF** por diálogo nativo "Guardar como", para entrega al docente o archivo en la carpeta del alumno.

**Persistencia**

- Casos clínicos, sets de animación ocular, mapeo de ejes, presets de aceptación e informes se guardan localmente. El equipo y la app conservan su estado entre sesiones sin servidor externo.

---

## 3. Los dos componentes pedagógicos en detalle

### 3.1 Modo práctica — entrenar el gesto

Apunta a la **técnica motora** del impulso, aislada de la interpretación. La aplicación funciona como un coach: cada movimiento se evalúa contra un objetivo geométrico y temporal, y el alumno recibe un veredicto por impulso.

Qué entrena este modo:

- Tomar la cabeza del compañero con apoyo firme pero seguro.
- Imprimir un giro **breve, pasivo, de alta aceleración y baja amplitud**.
- Mantener el plano del canal evaluado (los conos verdes hacen explícito el "fuera de plano").
- Romper la cadencia con el metrónomo, para que el paciente no anticipe.
- Manejar la asimetría: tantos impulsos a un lado como al otro, sin sesgar la mano dominante.

En este modo no hay paciente con patología: la respuesta ocular del paciente virtual puede mostrarse normal o desactivarse. El foco está en la curva de la cabeza, no en la del ojo.

### 3.2 Modo simulación — examen clínico completo

Apunta a la **lectura clínica**: ejecutar el examen igual que en consulta, reconocer el patrón del caso, redactar el informe.

Qué entrena este modo:

- Flujo completo de la prueba: preparación del paciente, calibración, recorrido por canales, validación de impulsos, interpretación, informe.
- Identificación de **ganancia VOR** en cada canal: normal (≥0.80), reducida (0.60–0.80), severamente reducida (<0.60).
- Detección visual y por curva de **sacadas correctivas**, distinguiendo covert de overt.
- Reconocimiento de **patrones diagnósticos** completos: hipofunción unilateral, bilateral, selectiva por canal.
- Manejo de **artefactos**: parpadeo, doble pico, anticipación, y decisión de exclusión.
- Redacción y firma de informe vHIT, exportado a PDF.

El alumno no sabe qué patología tiene el paciente virtual a menos que el docente se la revele. El examen es ciego, igual que el primer contacto con un paciente real.

---

## 4. Flujo pedagógico sugerido

La idea es **avanzar por etapas**, alternando modo práctica y modo simulación, no entrar directo al examen completo.

### Etapa 1 · Conocer el gesto

Objetivo: que la mano aprenda qué es un impulso cefálico.

- Gafas SimHIT puestas al compañero, pantalla en vivo abierta.
- El alumno toma la cabeza del compañero como lo haría en clínica y hace giros suaves de lado a lado mirando los conos verdes.
- No hay caso clínico todavía, no hay informe. Solo se busca **entrar al cono** y **salir del cono** rápido.

Indicadores que el docente puede mirar: simetría izquierda/derecha, mantención del plano horizontal (el cono superior debe quedar quieto), uso de la muñeca y no del codo, manejo cuidadoso del cuello del compañero.

### Etapa 2 · Calibrar amplitud y velocidad

Objetivo: lograr impulsos válidos consistentemente.

- Se carga un caso "**normal**" (paciente sano).
- El alumno hace 20 impulsos a cada lado.
- La app marca cuáles fueron rechazados y por qué motivo (lento, amplio, fuera de plano).
- Meta: tasa de aceptación ≥ 80 %, sin orientar al paciente virtual (sin avisar de qué lado va el próximo impulso).

Aquí entra el **metrónomo**: si el alumno cae en ritmo fijo, lo aleatoriza.

### Etapa 3 · Reconocer patrones

Objetivo: que el alumno **vea** la diferencia entre una respuesta normal y una alterada.

Se proponen tres casos en secuencia y el alumno debe identificarlos sin mirar la etiqueta:

1. Hipofunción unilateral derecha.
2. Hipofunción bilateral leve.
3. Sacadas covert puras.

Después se discuten las animaciones oculares: ¿cuándo apareció la sacada? ¿durante o después del impulso? ¿se vería a ojo desnudo o no?

### Etapa 4 · Examen completo

Objetivo: simular el flujo real de una consulta.

- El docente carga un caso ciego (el alumno no sabe cuál).
- El alumno ejecuta los seis canales (o los horizontales en esta versión), redacta el informe en la app y propone una interpretación.
- Se compara con la "verdad" del caso y se discute.

### Etapa 5 · Evaluación

Objetivo: cerrar el ciclo con un registro.

- N casos por alumno, todos ciegos, exportados a PDF.
- El docente corrige sobre el PDF y guarda como evidencia de desempeño.

---

## 5. Flujo clínico que se entrena

Aunque SimHIT no examina pacientes reales, **reproduce el mismo orden de pasos** que el alumno encontrará en la clínica. Esto es deliberado: lo que se automatiza en el laboratorio se ejecuta sin pensar en la consulta.

1. **Preparación**: colocar las gafas al paciente (en SimHIT, al compañero), ajustarlas firmes, calibrar, comprobar que fija la mirada en un punto.
2. **Explicación al paciente**: el alumno verbaliza qué va a hacer antes de tocar la cabeza — en SimHIT esto se entrena con el compañero real, no es rol-play imaginario.
3. **Estimulación por canal**:
   - Plano horizontal: laterales.
   - Plano anterior: anteriores.
   - Plano posterior: posteriores.
   En cada canal: 10–20 impulsos, dirección aleatoria, amplitud y velocidad dentro del rango.
4. **Validación en línea**: descartar impulsos artefactuales (cabeza no fija, anticipación, velocidad insuficiente).
5. **Interpretación**:
   - Ganancia por canal (normal, reducida, severamente reducida).
   - Presencia y tipo de sacadas (overt visibles, covert ocultas).
   - Patrón global (unilateral, bilateral, selectivo de canal).
6. **Informe**: redacción estructurada y entrega al solicitante.
7. **Decisión clínica**: qué hacer con el resultado (derivar, repetir, complementar con otras pruebas vestibulares).

En SimHIT el alumno entrena los pasos 1, 3, 4, 5 y 6 sin riesgo. Los pasos 2 y 7 se trabajan con el docente alrededor del simulador.

---

## 6. Ideas de actividades para el docente

- **Caso de la semana**: cada lunes el docente publica un caso nuevo (editado en la app) y los alumnos deben entregar el informe el viernes.
- **Competencia ciega**: dos alumnos examinan el mismo paciente virtual sin saber cuál es; gana quien acierta con menos impulsos válidos.
- **Cazar sacadas**: caso con sacadas covert puras; el alumno debe describir qué vio en la animación antes de mirar la curva.
- **Defender un informe**: el alumno entrega su PDF y el docente lo "interroga" como si fuera una junta clínica.
- **Rotar roles**: los alumnos se turnan como examinador y como paciente. Pasar por el lado del paciente entrena empatía y muestra qué se siente recibir un impulso brusco, mal apoyado o anticipado.
- **Aula invertida**: en casa el alumno repasa los casos normales; en clase solo se ven los difíciles.

---

## 7. Lo que SimHIT no es

- **No es un dispositivo médico**. No diagnostica ni reemplaza el vHIT real.
- **No mide el ojo del compañero que lleva las gafas**: el "ojo" siempre es la animación del paciente virtual definido por el caso clínico cargado.
- **No certifica competencia clínica** por sí solo. Es una herramienta dentro de un plan de formación; la evaluación final sigue siendo responsabilidad del programa académico.

---

## 8. ¿Quién está detrás?

Proyecto académico de la **Universidad Austral de Chile**, abierto a uso e implementación por otras instituciones bajo Licencia MIT.

> Baier-Quezada N., Uribe-Hernández V. S., López-Moncada F., Poza-Nauto P., Barrientos-Tolero H., Araneda-Aranda R. *SimHIT: simulador open source para entrenamiento del Head Impulse Test.* Universidad Austral de Chile, 2026.

Contacto: `david.avila@uach.cl`

Para detalles técnicos (PCB, firmware, protocolo serial, fabricación), ver `docs/` y los directorios `hardware/`, `firmware/` y `app/` del repositorio.
