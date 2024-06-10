
# SimHit

SimHit es una aplicación para la simulación y análisis de movimientos oculares y de cabeza utilizando PySide6 y gráficos interactivos con PyQtGraph. Este proyecto incluye funcionalidades para la comunicación serial con dispositivos de hardware, visualización de datos en tiempo real y procesamiento de señales.

## Estructura del Proyecto

```
SimHit/
├── main.py
├── simhitController.py
├── EyeAnimation.py
├── Transform.py
├── SerialHit.py
├── Hit.py
├── images/
│   ├── 128.ico
│   ├── c_i/
│   │   ├── 01.png
│   │   ├── 02.png
│   │   └── ...
│   └── c_d/
│       ├── 01.png
│       ├── 02.png
│       └── ...
├── ui/
│   ├── Ui_SimHit.py
│   └── ...
├── setup.py
└── requirements.txt
```

### Descripción de Archivos

- **main.py**: Punto de entrada principal de la aplicación. Configura la interfaz gráfica y gestiona la lógica principal.
- **simhitController.py**: Controlador para la comunicación serial con dispositivos de hardware.
- **EyeAnimation.py**: Gestión y procesamiento de secuencias de imágenes para animaciones oculares.
- **Transform.py**: Funciones de transformación de datos.
- **SerialHit.py**: Gestión de la conexión serial.
- **Hit.py**: Procesamiento de señales y detección de perturbaciones.
- **images/**: Directorio que contiene íconos y secuencias de imágenes utilizadas en la aplicación.
- **ui/**: Directorio que contiene los archivos de interfaz de usuario generados.
- **setup.py**: Archivo de configuración para la compilación del proyecto utilizando Nuitka.
- **requirements.txt**: Archivo que especifica las dependencias del proyecto.

## Requisitos

Asegúrate de tener instalado Python 3.8 o superior. Instala las dependencias utilizando `pip`:

```bash
pip install -r requirements.txt
```

## Compilación

Para compilar el proyecto utilizando Nuitka, asegúrate de tener instalada la herramienta:

```bash
pip install nuitka
```

Luego, ejecuta el siguiente comando para compilar el proyecto en un único archivo ejecutable:

```bash
python setup.py bdist_nuitka
```

El ejecutable se generará en el directorio `output`.

## Uso

1. **Inicializa la Aplicación**: Ejecuta el archivo `main.py` o el ejecutable generado para iniciar la aplicación.
   
2. **Interfaz Gráfica**: La aplicación tiene una interfaz gráfica interactiva que muestra gráficos en tiempo real de los movimientos oculares y de cabeza.

3. **Control Serial**: La aplicación se comunica con dispositivos de hardware a través de una conexión serial. Asegúrate de configurar correctamente el puerto y la tasa de baudios.

4. **Botones de Control**: Utiliza los botones en la interfaz para calibrar sensores, controlar LEDs y otras acciones.

## Funcionalidades Clave

- **Visualización en Tiempo Real**: Muestra gráficos de movimientos oculares y de cabeza en tiempo real.
- **Comunicación Serial**: Interactúa con dispositivos de hardware a través de una conexión serial.
- **Detección de Perturbaciones**: Procesa señales para detectar y analizar perturbaciones en los movimientos.

## Ejemplo de Uso

```python
# Inicializar la conexión serial
arduino = simhitController('/dev/ttyUSB0')  # Reemplaza con tu puerto

try:
    # Control de LEDs
    arduino.led_control(16, 'ON')
    time.sleep(1)
    arduino.led_control(16, 'OFF')

    # Obtener datos del IMU
    imu_data = arduino.get_imu_data()
    print("IMU Data:", imu_data)

    # Escribir en la pantalla OLED
    arduino.write_oled("Hello World!")
finally:
    arduino.close()
```

## Contribuciones

Las contribuciones son bienvenidas. Por favor, sigue las siguientes directrices:

1. Haz un fork del repositorio.
2. Crea una nueva rama (`git checkout -b feature/nueva-funcionalidad`).
3. Haz commit de tus cambios (`git commit -am 'Añadir nueva funcionalidad'`).
4. Haz push a la rama (`git push origin feature/nueva-funcionalidad`).
5. Abre un Pull Request.

## Licencia

Este proyecto está licenciado bajo la Licencia MIT. Consulta el archivo `LICENSE` para obtener más información.
