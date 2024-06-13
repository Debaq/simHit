#include <Wire.h>
#include <Adafruit_SSD1306.h>
#include <Adafruit_BNO055.h>
#include <Adafruit_Sensor.h>

// Serial communication baud rate
#define SERIAL_BAUD_RATE 460800  // Configurar a una tasa de baudios más alta

// Pins for LEDs and laser
#define RED_LED_PIN 16
#define BLUE_LED_PIN 14
#define GREEN_LED_PIN 12
#define LASER_PIN 13

// Pins array for easier iteration
const int ledPins[] = {RED_LED_PIN, GREEN_LED_PIN, BLUE_LED_PIN, LASER_PIN};

// I2C Addresses
#define BNO055_ADDRESS 0x29
#define SSD1306_ADDRESS 0x3C

// OLED display settings
#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 32
#define OLED_RESET -1

// IMU Instance
Adafruit_BNO055 imuSensor = Adafruit_BNO055(55, BNO055_ADDRESS);

// OLED Display Instance
Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);

bool start_imu = false;
float x_offset = 0.0, y_offset = 0.0, z_offset = 0.0;

const int threshold = 180;
int prevAngleX = 0, prevAngleY = 0, prevAngleZ = 0;
int offsetX = 0, offsetY = 0, offsetZ = 0;

void setup() {
  Serial.begin(SERIAL_BAUD_RATE);  // Configurar a una tasa de baudios más alta
  delay(100);

  Serial.println("SimHit configure");

  // Initialize LED pins
  for (int i = 0; i < 4; i++) {
    pinMode(ledPins[i], OUTPUT);
    digitalWrite(ledPins[i], HIGH);
  }

  // Initialize IMU
  Serial.println("Initializing BNO055...");
  if (!imuSensor.begin()) {
    Serial.println("No BNO055 detected");
    while (1);
  }

  // Configurar el modo de fusión de sensores
  imuSensor.setMode(Adafruit_BNO055::OPERATION_MODE_NDOF);  // Modo de fusión de sensores con 9 grados de libertad

  // Configurar el rango y la precisión del giroscopio
  imuSensor.setExtCrystalUse(true);  // Usar cristal externo para mayor precisión

  // Initialize OLED display
  Serial.println("Initializing OLED display...");
  if (!display.begin(SSD1306_SWITCHCAPVCC, SSD1306_ADDRESS)) {
    Serial.println(F("SSD1306 allocation failed"));
    for (;;);
  }
  display.display();
  delay(2000);
  display.clearDisplay();

  Serial.println("SimHit start");
}

void loop() {
  // Read and print IMU data
  if (start_imu == true) {
    IMU();
  }

  // Check for and handle incoming serial commands
  if (Serial.available()) {
    String command = Serial.readStringUntil('\n');
    handleCommand(command);
  }
}

void handleCommand(String command) {
  if (command.startsWith("L")) {
    int pin = command.substring(1, 3).toInt();
    String state = command.substring(3);
    if (state == "OFF") {
      digitalWrite(pin, HIGH);
    } else if (state == "ON") {
      digitalWrite(pin, LOW);
    }
  } else if (command.startsWith("IMU")) {
    if (command.endsWith("OFF")) {
      start_imu = false;
    } else if (command.endsWith("ON")) {
      start_imu = true;
    } else if (command.endsWith("CAL")) {
      calibrateIMU();
    }
  } else if (command.startsWith("O")) {
    String text = command.substring(1);
    displayText(text);
  } else if (command.startsWith("BAR")) {
    int percentage = command.substring(3).toInt();
    drawProgressBar(percentage);
  } else if (command == "HELLO") {
    Serial.println("HELLO");
  } else if (command == "RESET") {
    Serial.println("Reiniciando...");
    delay(10);
    ESP.restart();  // Reiniciar el ESP12
  }
}

void IMU() {
  sensors_event_t event;
  imuSensor.getEvent(&event);

  // Leer datos del giroscopio
  imu::Vector<3> gyro = imuSensor.getVector(Adafruit_BNO055::VECTOR_GYROSCOPE);

  int currentAngleX = (int)event.orientation.x - x_offset;
  int currentAngleY = (int)event.orientation.y - y_offset;
  int currentAngleZ = (int)event.orientation.z - z_offset;

  int adjustedAngleX = adjustDiscontinuity(currentAngleX, prevAngleX, offsetX);
  int adjustedAngleY = adjustDiscontinuity(currentAngleY, prevAngleY, offsetY);
  int adjustedAngleZ = adjustDiscontinuity(currentAngleZ, prevAngleZ, offsetZ);

  prevAngleX = currentAngleX;
  prevAngleY = currentAngleY;
  prevAngleZ = currentAngleZ;

  Serial.print(adjustedAngleX);
  Serial.print(";");
  Serial.print(adjustedAngleY);
  Serial.print(";");
  Serial.print(adjustedAngleZ);
  Serial.print(";");
  Serial.print(gyro.x());
  Serial.print(";");
  Serial.print(gyro.y());
  Serial.print(";");
  Serial.println(gyro.z());
}

int adjustDiscontinuity(int currentAngle, int prevAngle, int &offset) {
  int adjustedAngle = currentAngle + offset;
  int diff = currentAngle - prevAngle;
  if (abs(diff) > threshold) {
    if (diff > 0) {
      offset -= 360;
    } else {
      offset += 360;
    }
    adjustedAngle = currentAngle + offset;
  }
  return adjustedAngle;
}

void displayText(String text) {
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(0, 0);
  display.println(text);
  display.display();
}

void drawProgressBar(int percentage) {
  if (percentage < 0) percentage = 0;
  if (percentage > 100) percentage = 100;

  int barWidth = (SCREEN_WIDTH * percentage) / 100;

  display.clearDisplay();

  // Dibujar la barra de progreso
  display.fillRect(0, 0, barWidth, SCREEN_HEIGHT, SSD1306_WHITE);

  // Dibujar las líneas de 50% y 75%
  int line50 = SCREEN_WIDTH / 2;
  int line75 = (SCREEN_WIDTH * 75) / 100;

  // Cambiar el color de las líneas cuando la barra las cruce
  if (barWidth > line50) {
    display.drawLine(line50, 0, line50, SCREEN_HEIGHT, SSD1306_BLACK);  // Línea apagada
  } else {
    display.drawLine(line50, 0, line50, SCREEN_HEIGHT, SSD1306_WHITE);  // Línea encendida
  }

  if (barWidth > line75) {
    display.drawLine(line75, 0, line75, SCREEN_HEIGHT, SSD1306_BLACK);  // Línea apagada
  } else {
    display.drawLine(line75, 0, line75, SCREEN_HEIGHT, SSD1306_WHITE);  // Línea encendida
  }

  display.display();
}


void calibrateIMU() {
  const int numSamples = 20;
  float x_sum = 0.0, y_sum = 0.0, z_sum = 0.0;

  Serial.println("Calibrating IMU...");

  for (int i = 0; i < numSamples; i++) {
    sensors_event_t event;
    imuSensor.getEvent(&event);
    x_sum += event.orientation.x;
    y_sum += event.orientation.y;
    z_sum += event.orientation.z;
    delay(100);  // Pequeña espera entre lecturas
  }

  x_offset = x_sum / numSamples;
  y_offset = y_sum / numSamples;
  z_offset = z_sum / numSamples;

  Serial.println("Calibration complete.");
}
