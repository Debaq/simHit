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
from PySide6.QtWidgets import QApplication, QLabel, QMainWindow, QVBoxLayout, QDialog, QLineEdit, QPushButton, QMessageBox
from SerialHit import SerialConnection
from TestNumber import TestNumber
from ui import Ui_SimHit  # Importamos la UI generada
from Hit import Stabilizer, smooth_curve, map_value
from Transform import transform_scale
from PySide6.QtGui import QIcon
import requests
import random


__VERSION__ = 0.1
WINDOW_SIZE = 8000  # Tamaño de la ventana deslizante
DATA_FILE = 'data.csv'  # Archivo para almacenar los datos

gain = 0.8

class RutDialog(QDialog):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("Ingresar RUT")
        self.layout = QVBoxLayout(self)

        self.label = QLabel("Ingrese su RUT:")
        self.layout.addWidget(self.label)

        self.rut_input = QLineEdit(self)
        self.layout.addWidget(self.rut_input)

        self.ok_button = QPushButton("OK", self)
        self.ok_button.clicked.connect(self.accept)
        self.layout.addWidget(self.ok_button)

        self.rut = None

    def accept(self):
        self.rut = self.rut_input.text()
        super().accept()

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
        self.serial_connection.connection_failed.connect(self.retry_connection)
        self.serial_ports = self.serial_connection.find_ports()

        if self.serial_ports:
            self.serial_connection.start()
            self.show_rut_dialog()
        else:
            self.retry_connection()

        self.timer_data_graph = QTimer()
        self.timer_data_graph.timeout.connect(self.update_graph)
        self.timer_data_graph.start(5)  # Actualizar cada 50 ms

        # Temporizador para medir el tiempo transcurrido
        self.elapsed_timer = QElapsedTimer()
        self.elapsed_timer.start()

        # Almacenar datos para el gráfico
        self.time_data = []
        self.eyeH_data = []
        self.eyeV_data = []
        self.headtime_data = []
        self.head_data = []
        
        # Almacenar datos de perturbaciones para graficar
        self.rl_data_head = []
        self.ll_data_head = []
        self.rl_data_eye = []
        self.ll_data_eye = []

        # Iniciar archivo de datos
        #self.init_data_file()
        self.configure_btn()
        self.cal = 0

        self.image_current = 0

        # Creamos el detector de Hit
        self.detector_hit = Stabilizer(0.1, 5)
    
    def retry_connection(self):
        msg = QMessageBox()
        msg.setIcon(QMessageBox.Critical)
        msg.setText("No se pudo conectar al puerto serial.")
        msg.setInformativeText("¿Quieres reintentar?")
        msg.setStandardButtons(QMessageBox.Retry | QMessageBox.Cancel)
        ret = msg.exec()

        if ret == QMessageBox.Retry:
            self.serial_ports = self.serial_connection.find_ports()
            if self.serial_ports:
                self.serial_connection.start()
                self.show_rut_dialog()
            else:
                self.retry_connection()
        else:
            sys.exit()

    def request_user_name(self, rut):
        url = "https://tmeduca.org/simhit/api.php"  # Asegúrate de usar la URL correcta
        payload = {'rut': rut}
        response = requests.post(url, data=payload)
        if response.status_code == 200:
            return response.json().get('name')
        else:
            return None

    def show_rut_dialog(self):
        dialog = RutDialog()
        if dialog.exec() == QDialog.Accepted:
            user_name = self.request_user_name(dialog.rut)
            if user_name:
                QMessageBox.information(self, "Usuario Conectado", f"Bienvenido, {user_name}")
            else:
                QMessageBox.critical(self, "Error", "No se pudo obtener el nombre del usuario")

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
    

    def update_memory_graph(self):
        for x, y in self.rl_data_head[:-1]:
            self.rlgraph.plot(x, y, pen=pg.mkPen('w', width=1, style=Qt.DashLine))
        for x, y in self.ll_data_head[:-1]:
            self.llgraph.plot(x, y, pen=pg.mkPen('w', width=1, style=Qt.DashLine))
       
           
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
            #print(data_list)
            #graficar posicion de la cabeza y del ojo
            self.head_data.append(data_list[0])
            elapsed_time = self.elapsed_timer.elapsed() / 1000.0  # tiempo en segundos
            self.headtime_data.append(elapsed_time)
            ganancia_variable = self.valor_con_error(gain, 10)            
            eye_H_compensate = self.head_data[-1] * ganancia_variable

            self.eyeH_data.append(-eye_H_compensate)
            self.image_current = transform_scale(data_list[0])
            
            #detector de hits
            self.detector_hit.update(data_list, elapsed_time)
            process = self.detector_hit.get_perturbation_data()
            if process:
                x, y, dir_ = self.detector_hit.get_perturbation_data()
                s_x, s_y = smooth_curve(x,y,200)
                #pulse = max(process[1]) if dir_ == "izquierda" else min(process[1])
                valores_absolutos = [abs(valor) for valor in process[1]]

                pulse = max(valores_absolutos)

                if pulse < 0:
                    pulse = pulse*-1
                if pulse < 150 and pulse > 0:
                    self.send_data("L14OFF")
                    self.send_data("L16ON")
                elif pulse > 150:
                    self.send_data("L16OFF")
                    self.send_data("L14ON")
                self.send_data(map_value(pulse))#envia el valor a hit

                self.ui.lbl_last_impulse.setText(str(pulse))
                if x and y:
                    if dir_== "derecha":
                        self.rl_plot_data.setData(s_x, s_y)
                        self.rl_data_head.append((s_x,s_y))
                        s_x_inv = [-s_x for x in s_x]
                        s_y_inv = [-s_x for y in s_y]
                        self.rl_data_eye.append((s_x_inv, s_y_inv))

                        self.detector_hit.clear()

                    elif dir_ == "izquierda":
                        self.ll_plot_data.setData(s_x, s_y)
                        self.ll_data_head.append((s_x,s_y))
                        s_x_inv = [-s_x for x in s_x]
                        s_y_inv = [-s_x for y in s_y]
                        self.ll_data_eye.append((s_x_inv, s_y_inv))
                        self.detector_hit.clear()
          

                    self.update_memory_graph()
                
                self.rlgraph.setXRange(0, 0.6)
                self.llgraph.setXRange(0, 0.6)
                self.rlgraph.setYRange(400, -400)
                self.llgraph.setYRange(400, -400)


    def verificar_y_convertir(self, data_string):
        pattern = re.compile(r'^-?\d+(\.\d+)?(;|-?\d+(\.\d+)?)*$')
        if not pattern.match(data_string):
            return None
        try:
            data_list = data_string.split(';')
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
        self.ui.frame_btn_tools.setMaximumHeight(40)
        screen_height = QApplication.primaryScreen().size().height()
        self.ui.frame_results.setMinimumHeight(screen_height * 0.30)

    def valor_con_error(self, x, porcentaje):
        # Calcular el porcentaje de error aleatorio
        porcentaje_error = random.uniform(-porcentaje, porcentaje)
        # Calcular el valor del error
        error = x * porcentaje_error / 100
        # Devolver el valor original más el error
        return x + error

if __name__ == "__main__":
    app = QApplication(sys.argv)
    window = MainWindow()

    window.show()
    sys.exit(app.exec())
