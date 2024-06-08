import sys
import serial
import serial.tools.list_ports
from PySide6.QtWidgets import QApplication, QMainWindow, QVBoxLayout, QLabel
from PySide6.QtCore import QTimer
from pyqtgraph import PlotWidget, plot
import pyqtgraph as pg
from ui import Ui_SimHit  # Importamos la UI generada

class MainWindow(QMainWindow):
    def __init__(self):
        super(MainWindow, self).__init__()
        self.ui = Ui_SimHit()
        self.ui.setupUi(self)

        # Configuración inicial de PySerial
        self.serial_port = None
        self.baudrate = 9600

        # Inicializar gráficos de PyQtGraph
        self.init_graphs()

        # Configurar el timer para leer datos del puerto serial
        self.timer = QTimer()
        self.timer.timeout.connect(self.read_serial_data)
        self.timer.start(100)  # Leer datos cada 100 ms

    def init_graphs(self):
        # Crear widgets de gráficos
        self.timeVorizontal = PlotWidget()
        self.timeVertical = PlotWidget()
        self.timeHead = PlotWidget()

        # Añadir gráficos a layout_grahph_time
        self.ui.layout_grahph_time.addWidget(self.timeVorizontal)
        self.ui.layout_grahph_time.addWidget(self.timeVertical)
        self.ui.layout_grahph_time.addWidget(self.timeHead)

        # Configuración de los gráficos (ejemplo)
        self.timeVorizontal.setTitle("movimientos horizontales")
        self.timeVertical.setTitle("movimientos verticales")
        self.timeHead.setTitle("movimientos de cabeza")

        # Configurar los ejes
        for graph in [self.timeVorizontal, self.timeVertical, self.timeHead]:
            graph.setLabel('left', 'Value')
            graph.setLabel('bottom', 'Time')
            graph.showGrid(x=True, y=True)

    def read_serial_data(self):
        if self.serial_port and self.serial_port.is_open:
            try:
                data = self.serial_port.readline().decode().strip()
                if data:
                    print(f"Received: {data}")
                    # Aquí puedes procesar y graficar los datos recibidos
            except serial.SerialException as e:
                print(f"Error reading serial data: {e}")

    def connect_serial(self, port_name):
        try:
            self.serial_port = serial.Serial(port_name, self.baudrate)
            print(f"Connected to {port_name} at {self.baudrate} baud.")
        except serial.SerialException as e:
            print(f"Error connecting to serial port: {e}")

def list_serial_ports():
    return [port.device for port in serial.tools.list_ports.comports()]

if __name__ == "__main__":
    app = QApplication(sys.argv)
    window = MainWindow()

    # Listar puertos seriales disponibles
    ports = list_serial_ports()
    if ports:
        window.connect_serial(ports[0])  # Conectar al primer puerto encontrado (ejemplo)
    else:
        print("No serial ports found.")

    window.show()
    sys.exit(app.exec())
