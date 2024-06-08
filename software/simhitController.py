import serial
import time

class simhitController:
    def __init__(self, port, baud_rate=115200):
        self.ser = serial.Serial(port, baud_rate)
        time.sleep(2)  # Wait for the connection to establish

    def send_command(self, command):
        self.ser.write(command.encode())
        time.sleep(0.1)  # Wait for Arduino to process the command

    def led_control(self, pin, state):
        if state not in ['ON', 'OFF']:
            raise ValueError("State must be 'ON' or 'OFF'")
        command = f"L{pin:02d}{state[0]}"
        self.send_command(command)

    def get_imu_data(self):
        self.send_command("IMU")
        imu_data = self.ser.readline().decode().strip()
        return imu_data

    def write_oled(self, text):
        command = f"O{text}"
        self.send_command(command)

    def close(self):
        self.ser.close()

# Example usage
if __name__ == "__main__":
    arduino = simhitController('/dev/ttyUSB0')  # Replace with your actual port
    try:
        # Control LEDs
        arduino.led_control(16, 'ON')
        time.sleep(1)
        arduino.led_control(16, 'OFF')

        # Get IMU data
        imu_data = arduino.get_imu_data()
        print("IMU Data:", imu_data)

        # Write to OLED
        arduino.write_oled("Hello World!")
    finally:
        arduino.close()
