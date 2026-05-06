# serial_connection.py
import serial
import serial.tools.list_ports
from PySide6.QtCore import QThread, Signal
import sys
import time

class SerialConnection(QThread):
    data_received = Signal(str)
    connection_failed = Signal()

    def __init__(self, baudrate=115200, parent=None):
        super(SerialConnection, self).__init__(parent)
        self.baudrate = baudrate
        self.serial_ports = []
        self.serial_port = None
        self.running = False

    def find_ports(self):
        available_ports = list(serial.tools.list_ports.comports())
        for port in available_ports:
            port_name = port.device
            if self._is_valid_port(port_name):
                try:
                    with serial.Serial(port_name, self.baudrate, timeout=1) as ser:
                        ser.write(b'HELLO\n')
                        response = ser.readline().decode().strip()
                        if response == 'HELLO':
                            self.serial_ports.append(port_name)
                            self.data_received.emit(f"{port_name}-{response}")
                except serial.SerialException:
                    pass
        return self.serial_ports

    def _is_valid_port(self, port_name):
        if sys.platform.startswith('win'):
            return port_name.startswith('COM')
        elif sys.platform.startswith('linux'):
            return 'ttyUSB' in port_name or 'ttyACM' in port_name
        else:
            return False

    def run(self):
        self.running = True
        if not self.serial_ports:
            self.find_ports()

        if not self.serial_ports:
            self.connection_failed.emit()
            return

        for port_name in self.serial_ports:
            try:
                self.serial_port = serial.Serial(port_name, self.baudrate, timeout=1)
                while self.running:
                    if self.serial_port.in_waiting > 0:
                        data = self.serial_port.readline().decode().strip()
                        self.data_received.emit(data)
            except serial.SerialException as e:
                print(f"Error connecting to serial port: {e}")
                self.connection_failed.emit()

    def stop(self):
        self.running = False
        if self.serial_port and self.serial_port.is_open:
            self.serial_port.close()

    def send_data(self, data):
        #print(data)
        if self.serial_port and self.serial_port.is_open:
            data = data + '\n'
            self.serial_port.write(data.encode())
            self.serial_port.flush()
        else:
            print("Serial port not open")
