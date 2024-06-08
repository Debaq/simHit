import sys
import platform
import serial
import serial.tools.list_ports
from PySide6.QtWidgets import QApplication, QMainWindow, QVBoxLayout, QWidget, QDialog, QFormLayout, QComboBox, QPushButton, QMessageBox, QMenuBar
from PySide6.QtGui import QAction
import pyqtgraph as pg
from pyqtgraph.Qt import QtCore
import threading
import numpy as np

class SerialReader(QtCore.QObject):
    data_ready = QtCore.Signal(list)

    def __init__(self, port, baudrate=115200):
        super().__init__()
        self.serial = serial.Serial(port, baudrate)
        self.running = True
        self.thread = threading.Thread(target=self.read_data)
        self.thread.start()

    def read_data(self):
        while self.running:
            if self.serial.in_waiting > 0:
                line = self.serial.readline().decode('utf-8').strip()
                try:
                    values = list(map(float, line.split(',')))
                    self.data_ready.emit(values[:3])
                except ValueError:
                    pass

    def stop(self):
        self.running = False
        self.thread.join()
        self.serial.close()

class PreferencesDialog(QDialog):
    def __init__(self):
        super().__init__()
        self.setWindowTitle('Preferences')

        layout = QFormLayout()

        self.port_combo = QComboBox()
        self.baudrate_combo = QComboBox()
        self.os_label = QComboBox()
        self.os_label.addItem(platform.system())
        self.os_label.setEditable(False)

        ports = self.get_available_ports()
        for port in ports:
            self.port_combo.addItem(port)

        baudrates = ["9600", "19200", "38400", "57600", "115200"]
        for baudrate in baudrates:
            self.baudrate_combo.addItem(baudrate)

        layout.addRow('Port:', self.port_combo)
        layout.addRow('Baudrate:', self.baudrate_combo)
        layout.addRow('OS:', self.os_label)

        self.save_button = QPushButton('Save')
        self.save_button.clicked.connect(self.accept)

        self.test_button = QPushButton('Versión de prueba')
        self.test_button.clicked.connect(self.start_test_version)

        layout.addWidget(self.save_button)
        layout.addWidget(self.test_button)
        self.setLayout(layout)

    def get_available_ports(self):
        ports = serial.tools.list_ports.comports()
        return [port.device for port in ports]

    def get_preferences(self):
        return self.port_combo.currentText(), int(self.baudrate_combo.currentText())

    def start_test_version(self):
        self.done(2)

class SineWaveGenerator(QtCore.QObject):
    data_ready = QtCore.Signal(list)

    def __init__(self, interval=100):
        super().__init__()
        self.timer = QtCore.QTimer()
        self.timer.timeout.connect(self.generate_data)
        self.t = 0
        self.interval = interval

    def start(self):
        self.timer.start(self.interval)

    def stop(self):
        self.timer.stop()

    def generate_data(self):
        sine_value = np.sin(self.t)
        cosine_value = np.cos(self.t)
        tangent_value = np.tan(self.t)
        self.data_ready.emit([sine_value, cosine_value, tangent_value])
        self.t += 0.1  # Increment time step

class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle('SimHIT')

        self.central_widget = QWidget()
        self.setCentralWidget(self.central_widget)
        self.layout = QVBoxLayout(self.central_widget)

        self.graph_widget_1 = pg.PlotWidget()
        self.graph_widget_2 = pg.PlotWidget()
        self.graph_widget_3 = pg.PlotWidget()
        
        self.layout.addWidget(self.graph_widget_1)
        self.layout.addWidget(self.graph_widget_2)
        self.layout.addWidget(self.graph_widget_3)

        self.data_1 = []
        self.data_2 = []
        self.data_3 = []

        self.preferences_dialog = PreferencesDialog()
        self.show_preferences()

        self.create_menu()

    def create_menu(self):
        menubar = QMenuBar(self)
        self.setMenuBar(menubar)
        settings_menu = menubar.addMenu("Settings")
        change_prefs_action = QAction("Change Preferences", self)
        change_prefs_action.triggered.connect(self.show_preferences)
        settings_menu.addAction(change_prefs_action)

    def show_preferences(self):
        result = self.preferences_dialog.exec()
        if result == QDialog.Accepted:
            port, baudrate = self.preferences_dialog.get_preferences()
            try:
                if hasattr(self, 'serial_reader'):
                    self.serial_reader.stop()
                self.serial_reader = SerialReader(port, baudrate)
                self.serial_reader.data_ready.connect(self.update_plot)
            except serial.SerialException:
                self.show_error_message("No device connected. Generating example data.")
                self.generate_example_data()
        elif result == 2:
            self.generate_example_data()

    def update_plot(self, values):
        self.data_1.append(values[0])
        self.data_2.append(values[1])
        self.data_3.append(values[2])
        if len(self.data_1) > 100:  # limit the number of data points displayed
            self.data_1.pop(0)
            self.data_2.pop(0)
            self.data_3.pop(0)
        self.graph_widget_1.plot(self.data_1, clear=True)
        self.graph_widget_2.plot(self.data_2, clear=True)
        self.graph_widget_3.plot(self.data_3, clear=True)

    def generate_example_data(self):
        self.sine_wave_generator = SineWaveGenerator()
        self.sine_wave_generator.data_ready.connect(self.update_plot)
        self.sine_wave_generator.start()

    def show_error_message(self, message):
        error_dialog = QMessageBox()
        error_dialog.setText(message)
        error_dialog.exec()

    def closeEvent(self, event):
        try:
            self.serial_reader.stop()
        except AttributeError:
            pass
        try:
            self.sine_wave_generator.stop()
        except AttributeError:
            pass
        event.accept()

if __name__ == '__main__':
    app = QApplication(sys.argv)
    window = MainWindow()
    window.show()
    sys.exit(app.exec())
