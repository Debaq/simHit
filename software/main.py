# main.py
import re
import sys
import time
import numpy as np
import pandas as pd
import pyqtgraph as pg
import serial.tools.list_ports
from EyeAnimation import ImageSequence
from pyqtgraph import PlotWidget, plot
from PySide6.QtCore import QElapsedTimer, Qt, QTimer
from PySide6.QtWidgets import QApplication, QLabel, QMainWindow, QVBoxLayout
from SerialHit import SerialConnection
from TestNumber import TestNumber
from ui import Ui_SimHit  # Importamos la UI generada
from Hit import Stabilizer, smooth_curve, map_value
from Transform import transform_scale
from PySide6.QtGui import QIcon

__VERSION__ = 0.1
WINDOW_SIZE = 8000  # Tamaño de la ventana deslizante
DATA_FILE = 'data.csv'  # Archivo para almacenar los datos

gain = 0.9

class MainWindow(QMainWindow):
    def __init__(self):
        super(MainWindow, self).__init__()
        self.ui = Ui_SimHit()
        self.ui.setupUi(self)
        self.setWindowTitle(f"SimHit v{__VERSION__}")
        self.setWindowIcon(QIcon("images/128.ico"))  # Asegúrate de que la ruta al ícono sea correcta
        self.adjust_layouts()
        # Inicializar gráficos de PyQtGraph
        self.image_array = ImageSequence('images/c_i', 'images/c_d')

        self.init_graphs()

        # Inicializar la conexión serial
        self.serial_connection = SerialConnection(baudrate=460800)
        self.serial_connection.data_received.connect(self.read_serial_data)
        self.serial_ports = self.serial_connection.find_ports()

        if self.serial_ports:
            self.serial_connection.start()

        self.timer_data_graph = QTimer()
        self.timer_data_graph.timeout.connect(self.update_graph)
        self.timer_data_graph.start(50)  # Actualizar cada 50 ms

        # Temporizador para medir el tiempo transcurrido
        self.elapsed_timer = QElapsedTimer()
        self.elapsed_timer.start()

        # Almacenar datos para el gráfico
        self.time_data = []
        self.eyeH_data = []
        self.eyeV_data = []
        self.headtime_data = []
        self.head_data = []

        # Iniciar archivo de datos
        #self.init_data_file()
        self.configure_btn()
        self.cal = 0

        self.image_current = 0

        # Creamos el detector de Hit
        self.detector_hit = Stabilizer(0.1, 5)
    
  

    def configure_btn(self):
        self.ui.btn_calibrate.clicked.connect(self.calibrate_init)
        self.ui.btn_laser.clicked.connect(self.btn_action)
        self.ui.btn_led_blue.clicked.connect(self.btn_action)
        self.ui.btn_led_green.clicked.connect(self.btn_action)
        self.ui.btn_led_red.clicked.connect(self.btn_action)

    def btn_action(self):
        led_pin = {"RED": 16, "LASER": 13, "GREEN": 12, "BLUE": 14}
        btn, state = self.sender().text().split(":")
        btn = btn.strip()
        state = state.strip()
        new_state = "ON" if state == "OFF" else "OFF"
        self.sender().setText(f"{btn} : {new_state}")
        sender = f"L{led_pin[btn]}{state}"
        self.send_data(sender)

    def init_graphs(self):
        # Crear widgets de gráficos
        self.timeHorizontal = PlotWidget()
        self.timeVertical = PlotWidget()
        self.timeHead = PlotWidget()
        self.rlgraph = PlotWidget()
        self.llgraph = PlotWidget()

        # Añadir gráficos a layout_grahph_time
        self.ui.layout_grahph_time.addWidget(self.timeHorizontal)
        self.ui.layout_grahph_time.addWidget(self.timeVertical)
        self.ui.layout_grahph_time.addWidget(self.timeHead)
        self.ui.layout_rl.addWidget(self.rlgraph)
        self.ui.layout_ll.addWidget(self.llgraph)
        self.configure_eye()

        # Configuración de los gráficos (ejemplo)
        self.timeHorizontal.setTitle("movimientos horizontales")
        self.timeVertical.setTitle("movimientos verticales")
        self.timeHead.setTitle("movimientos de cabeza")

        # Configurar los ejes
        for graph in [self.timeHorizontal, self.timeVertical, self.timeHead]:
            graph.setLabel('left', 'Value')
            graph.setLabel('bottom', 'Time')
            graph.showGrid(x=True, y=True)
            graph.setXRange(0, 10)
            graph.setYRange(-55, 55)

        # Línea de gráfico
        self.eyeH_plot_data = self.timeHorizontal.plot(pen='w')
        self.head_plot_data = self.timeHead.plot(pen='g')
        self.rl_plot_data = self.rlgraph.plot(pen='r')
        self.ll_plot_data = self.llgraph.plot(pen='b')


    def configure_eye(self):
        graphics_layout = pg.GraphicsLayoutWidget()
        self.ui.layout_eye.addWidget(graphics_layout)
        view = graphics_layout.addViewBox()
        view.setAspectLocked(True)
        image = self.image_array.get(0)
        self.image_item = pg.ImageItem(image)
        view.addItem(self.image_item)

    def init_data_file(self):
        # Inicializa el archivo CSV
        df = pd.DataFrame(columns=['time', 'value'])
        df.to_csv(DATA_FILE, index=False)

    def update_image(self):
        image_n = self.image_current
        self.image_item.setImage(self.image_array.get(image_n))

    def update_graph(self):

        # Mantén solo los últimos WINDOW_SIZE puntos en memoria para la visualización
        if len(self.headtime_data) > WINDOW_SIZE:
            self.eyeH_data = self.eyeH_data[-WINDOW_SIZE:]
            self.headtime_data = self.headtime_data[-WINDOW_SIZE:]
            self.head_data = self.head_data[-WINDOW_SIZE:]

        # Actualiza el gráfico con los nuevos datos
        self.eyeH_plot_data.setData(self.headtime_data, self.eyeH_data)
        self.head_plot_data.setData(self.headtime_data, self.head_data)

        # Ajusta el rango de visualización para mostrar solo los últimos WINDOW_SIZE puntos
        if len(self.headtime_data) > 1:
            self.timeHorizontal.setXRange(self.headtime_data[0], self.headtime_data[-1])
        else:
            self.timeHorizontal.setXRange(0, 10)

        if len(self.headtime_data) > 1:
            self.timeHead.setXRange(self.headtime_data[0], self.headtime_data[-1])
        else:
            self.timeHead.setXRange(0, 10)
        
        self.update_image()

    def calibrate_init(self):
        if self.sender().text() == "Calibrar":
            self.send_data("L13ON")

            self.send_data("IMUCAL")
            self.ui.btn_calibrate.setText("Detener medida")
        else:
            self.send_data("IMUOFF")
            self.ui.btn_calibrate.setText("Calibrar")

    def read_serial_data(self, data):
        if data == "Calibration complete.":
            self.send_data("L13OFF")
            self.send_data("IMUON")
            self.send_data("BAR000")
        data_list = self.verificar_y_convertir(data)
        if isinstance(data_list, list):
            self.head_data.append(data_list[0])
            elapsed_time = self.elapsed_timer.elapsed() / 1000.0  # tiempo en segundos
            self.headtime_data.append(elapsed_time)
            eye_H_compensate = self.head_data[-1] * gain
            self.eyeH_data.append(-eye_H_compensate)
            self.image_current = transform_scale(data_list[0])
            self.detector_hit.update(data_list, elapsed_time)
            process = self.detector_hit.get_perturbation_data()
            if process is not None and len(process[0]) > 10:
              

                
                #optima >150 <300 :: 
                #inferior <150
                #superior >300

                #print(len(process[0]))
                x, y, dir_ = self.detector_hit.get_perturbation_data()
                s_x, s_y = smooth_curve(x,y,100)
           
                
                pulse = max(process[1]) if dir_ == "izquierda" else min(process[1])

                self.send_data(map_value(pulse))
                if pulse < 150:
                    self.send_data("L14OFF")
                    
                    self.send_data("L16ON")
                else:
                    self.send_data("L16OFF")

                    self.send_data("L14ON")

                self.ui.lbl_last_impulse.setText(pulse)
                    


                # Solo actualizar los datos si hay perturbación
                if x and y:
                    if dir_== "derecha":
                        self.rl_plot_data.setData(s_x, s_y)
                    else:
                        self.ll_plot_data.setData(s_x, s_y)
                    #self.rl_plot_data.setData(s_x, s_y)
                    #self.ll_plot_data.setData(x, y)

                
                if self.detector_hit.is_recording_finished():
                    self.detector_hit.clear()

    def verificar_y_convertir(self, data_string):
        # Verificar si el string tiene el formato correcto usando una expresión regular
        pattern = re.compile(r'^-?\d+(\.\d+)?(;|-?\d+(\.\d+)?)*$')
        if not pattern.match(data_string):
            return None
        try:
            # Dividir la cadena en una lista usando el delimitador ';'
            data_list = data_string.split(';')
            # Convertir los elementos de la lista a números flotantes
            data_list = [float(i) for i in data_list]
            return data_list
        except ValueError:
            return None

    def send_data(self, data):
        if self.serial_connection:
            self.serial_connection.send_data(data)

    def closeEvent(self, event):
        if self.serial_connection:
            self.send_data("RESET")
            time.sleep(1)  # Espera para asegurarse de que el comando se procese
            self.serial_connection.stop()
        event.accept()

    def adjust_layouts(self):
        # Ajustar altura del frame_btn_tools
        self.ui.frame_btn_tools.setMaximumHeight(40)

        # Ajustar altura mínima del frame_results al 50% de la altura de la ventana
        screen_height = QApplication.primaryScreen().size().height()
        self.ui.frame_results.setMinimumHeight(screen_height * 0.30)


if __name__ == "__main__":
    app = QApplication(sys.argv)
    window = MainWindow()

    window.show()
    sys.exit(app.exec())
