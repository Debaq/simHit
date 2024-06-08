#include <Wire.h>
#include <Adafruit_SSD1306.h>
#include <Adafruit_BNO055.h>
#include <Adafruit_Sensor.h>

// Serial communication baud rate
#define SERIAL_BAUD_RATE 115200

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

void setup() {
  Serial.begin(SERIAL_BAUD_RATE);
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
    }
  } else if (command.startsWith("O")) {
    String text = command.substring(1);
    displayText(text);
  }
}

void IMU() {
  sensors_event_t event;
  imuSensor.getEvent(&event);
  Serial.print(event.orientation.x);
  Serial.print(";");
  Serial.print(event.orientation.y);
  Serial.print(";");
  Serial.println(event.orientation.z);
}

void displayText(String text) {
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(0, 0);
  display.println(text);
  display.display();
}
