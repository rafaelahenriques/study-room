/*
  Study Room sensor node (ESP32)
  - PIR motion sensor  -> studyroom/motion     "1" / "0"   (retained)
  - optional analog mic -> studyroom/sound      "0.00".."1.00" (loudness only, never audio)
  - heartbeat           -> studyroom/heartbeat  every 10 s, so the website knows the sensor is live

  Libraries (Arduino Library Manager): PubSubClient by Nick O'Leary.
  Board: any ESP32 dev board (Arduino-ESP32 core 3.x).

  Wiring
    PIR (AM312 / HC-SR501): VCC -> 3V3 (AM312) or 5V (HC-SR501), GND -> GND, OUT -> GPIO 27
    Mic (MAX9814, optional): VCC -> 3V3, GND -> GND, OUT -> GPIO 34 (ADC1)

  Copy secrets.example.h to secrets.h and fill it in (secrets.h is git-ignored).
*/
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include "secrets.h"

#define USE_MIC 0            // set to 1 when the MAX9814 is connected

const int PIR_PIN = 27;
const int MIC_PIN = 34;
const char* TOPIC_MOTION = "studyroom/motion";
const char* TOPIC_SOUND = "studyroom/sound";
const char* TOPIC_HEARTBEAT = "studyroom/heartbeat";

WiFiClientSecure net;
PubSubClient mqtt(net);

bool lastMotion = false;
unsigned long lastBeat = 0;
unsigned long lastSound = 0;
float soundSmoothed = 0;

void connectWifi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(300);
    Serial.print(".");
  }
  Serial.printf(" connected, IP %s\n", WiFi.localIP().toString().c_str());
}

void connectMqtt() {
  while (!mqtt.connected()) {
    Serial.print("MQTT...");
    String id = "studyroom-" + String((uint32_t)ESP.getEfuseMac(), HEX);
    if (mqtt.connect(id.c_str(), MQTT_USER, MQTT_PASS)) {
      Serial.println(" connected");
      mqtt.publish(TOPIC_MOTION, lastMotion ? "1" : "0", true);
    } else {
      Serial.printf(" failed (%d), retrying\n", mqtt.state());
      delay(3000);
    }
  }
}

#if USE_MIC
// RMS of ~50 ms of samples around the ADC midpoint, normalised to 0..1
float readLoudness() {
  const int N = 400;
  long sum = 0;
  int samples[N];
  for (int i = 0; i < N; i++) { samples[i] = analogRead(MIC_PIN); sum += samples[i]; delayMicroseconds(125); }
  float mean = (float)sum / N, acc = 0;
  for (int i = 0; i < N; i++) { float d = samples[i] - mean; acc += d * d; }
  float rms = sqrtf(acc / N);            // 0..~2048
  return constrain(rms / 600.0f, 0.0f, 1.0f);  // tune 600 for your mic gain / room
}
#endif

void setup() {
  Serial.begin(115200);
  pinMode(PIR_PIN, INPUT);
  connectWifi();
#ifdef MQTT_CA_CERT
  net.setCACert(MQTT_CA_CERT);
#else
  net.setInsecure();                      // fine for a first test; set MQTT_CA_CERT for real use
#endif
  mqtt.setServer(MQTT_HOST, MQTT_PORT);
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) connectWifi();
  if (!mqtt.connected()) connectMqtt();
  mqtt.loop();

  bool motion = digitalRead(PIR_PIN) == HIGH;
  if (motion != lastMotion) {
    lastMotion = motion;
    mqtt.publish(TOPIC_MOTION, motion ? "1" : "0", true);
    Serial.printf("motion %d\n", motion);
  }

#if USE_MIC
  if (millis() - lastSound > 200) {      // ~5 messages per second
    lastSound = millis();
    soundSmoothed = 0.6f * soundSmoothed + 0.4f * readLoudness();
    char buf[8];
    snprintf(buf, sizeof(buf), "%.2f", soundSmoothed);
    mqtt.publish(TOPIC_SOUND, buf);
  }
#endif

  if (millis() - lastBeat > 10000) {
    lastBeat = millis();
    mqtt.publish(TOPIC_HEARTBEAT, "1");
  }
}
