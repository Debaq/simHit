# SimHIT — Simulador para enseñar el Head Impulse Test (vHIT)

**Plataforma educativa abierta · v2026.05**

SimHIT es una herramienta pensada para **aprender, practicar y evaluar** el Head Impulse Test asistido por video (vHIT) sin necesidad de un paciente real. Combina un **cabezal sensor**, una **aplicación de escritorio** y un conjunto de **casos clínicos editables**, de modo que el estudiante repita el gesto del impulso cefálico cuantas veces necesite, en un entorno seguro, reproducible y con retroalimentación inmediata.

No reemplaza al paciente: lo complementa. Antes de tocar a una persona, el estudiante ya entrenó la técnica, vio cómo se ve un VOR normal y uno hipofuncionante, y aprendió a leer un informe.

---

## 1. ¿Qué problema resuelve?

El vHIT es una prueba breve pero **dependiente del examinador**: si el impulso es lento, demasiado amplio o predecible, el resultado pierde valor. En la formación tradicional el alumno aprende sobre el paciente: pocas oportunidades, mucha presión, retroalimentación tardía.

SimHIT invierte esa lógica:

- El **gesto** se practica sobre un cabezal instrumentado, no sobre una persona.
- La **respuesta del paciente** (movimiento ocular, ganancia, sacadas) la genera el software a partir de un caso clínico configurable.
- El **error es visible al instante**: cada impulso se acepta o rechaza con su motivo, y los resultados se acumulan en un informe.

El estudiante puede equivocarse cien veces sin daño y llegar a la práctica clínica con la técnica ya incorporada.

---

## 2. Capacidades del equipo

### El cabezal

Un dispositivo pequeño que se sujeta a la frente del estudiante con una banda elástica. Por dentro tiene un microcontrolador y sensores de movimiento (giroscopio, acelerómetro y magnetómetro) que detectan hacia dónde, cuán rápido y con qué amplitud se mueve la cabeza, 200 veces por segundo.

Características útiles para el aula:

- **Plug & play por USB-C**: se conecta y la aplicación lo reconoce sola.
- **Calibración guiada**: dos botones, dos pasos, dura menos de un minuto.
- **Robusto y económico**: pensado para ser fabricado por la propia institución a bajo costo.
- **Reemplazable**: si el sensor cambia o se rompe, la aplicación sigue funcionando con cualquier sensor equivalente.

### La aplicación

Aplicación de escritorio (Linux, Windows, macOS) que el docente y el estudiante usan juntos o por separado:

- **Pantalla en vivo de la cabeza**: tres vistas (desde arriba, de frente, de lado) con conos verdes que marcan la dirección correcta del impulso. El alumno ve si su mano va por el plano del canal o se desvía.
- **Paciente virtual**: una animación del ojo en una segunda ventana (que se puede mover a otra pantalla) reproduce el movimiento ocular esperado para el caso clínico cargado, incluyendo sacadas correctivas cuando corresponda.
- **Veredicto por impulso**: tras cada movimiento la app dice si el impulso fue válido y por qué (amplitud, velocidad pico, dirección).
- **Metrónomo**: marca el ritmo de los impulsos para que el alumno no caiga en la cadencia predecible que el paciente "adivina".
- **Informe clínico**: tabla de ganancias por canal, gráficos, hallazgos, interpretación y diagnóstico. Se exporta a PDF para entrega o archivo.
- **Editor de casos**: el docente puede crear pacientes virtuales con la patología que quiera enseñar esa semana.

---

## 3. Flujo pedagógico de práctica

La idea es **avanzar por etapas**, no entrar directo al examen completo.

### Etapa 1 · Conocer el gesto

Objetivo: que la mano aprenda qué es un impulso cefálico.

- Cabezal puesto, pantalla en vivo abierta.
- El alumno hace giros suaves de lado a lado mirando los conos verdes.
- No hay paciente todavía, no hay informe. Solo se busca **entrar al cono** y **salir del cono** rápido.

Indicadores que el docente puede mirar: simetría izquierda/derecha, mantención del plano horizontal (el cono superior debe quedar quieto), uso de la muñeca y no del codo.

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

## 4. Flujo clínico que se entrena

Aunque SimHIT no examina pacientes reales, **reproduce el mismo orden de pasos** que el alumno encontrará en la clínica. Esto es deliberado: lo que se automatiza en el laboratorio se ejecuta sin pensar en la consulta.

1. **Preparación**: revisar el cabezal/equipo, calibrar, comprobar que el paciente fija la mirada en un punto.
2. **Explicación al paciente**: en simulador esto se practica como rol-play; el alumno verbaliza qué va a hacer antes de tocar al "paciente".
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

## 5. Ideas de actividades para el docente

- **Caso de la semana**: cada lunes el docente publica un caso nuevo (editado en la app) y los alumnos deben entregar el informe el viernes.
- **Competencia ciega**: dos alumnos examinan el mismo paciente virtual sin saber cuál es; gana quien acierta con menos impulsos válidos.
- **Cazar sacadas**: caso con sacadas covert puras; el alumno debe describir qué vio en la animación antes de mirar la curva.
- **Defender un informe**: el alumno entrega su PDF y el docente lo "interroga" como si fuera una junta clínica.
- **Calibrar con un compañero**: un alumno hace el impulso al cabezal puesto sobre la frente del otro, así se entrena también el lado del paciente (incomodidad, anticipación, miedo).
- **Aula invertida**: en casa el alumno repasa los casos normales; en clase solo se ven los difíciles.

---

## 6. Lo que SimHIT no es

- **No es un dispositivo médico**. No diagnostica ni reemplaza el vHIT real.
- **No mide el ojo del usuario**: el "ojo" siempre es la animación del paciente virtual.
- **No certifica competencia clínica** por sí solo. Es una herramienta dentro de un plan de formación; la evaluación final sigue siendo responsabilidad del programa académico.

---

## 7. ¿Quién está detrás?

Proyecto académico de la **Universidad Austral de Chile**, abierto a uso e implementación por otras instituciones bajo Licencia MIT.

> Ávila D., Baier N. *SimHIT: simulador open source para entrenamiento del Head Impulse Test.* Universidad Austral de Chile, 2026.

Contacto: `david.avila@uach.cl`

Para detalles técnicos (PCB, firmware, protocolo serial, fabricación), ver `docs/` y los directorios `hardware/`, `firmware/` y `app/` del repositorio.
