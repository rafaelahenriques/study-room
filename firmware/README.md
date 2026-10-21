# Study Room sensor (ESP32)

Optional hardware. The website works without it: the control panel's *Sensors* tab can simulate motion and send test noises.

## Parts and wiring

| Part | Pin | ESP32 |
|---|---|---|
| PIR motion sensor (AM312 or HC-SR501) | VCC | 3V3 (AM312) or 5V (HC-SR501) |
| | GND | GND |
| | OUT | GPIO 27 |
| Microphone, optional (MAX9814) | VCC / GND | 3V3 / GND |
| | OUT | GPIO 34 (ADC1) |

Set `USE_MIC` to `1` in `studyroom_sensor/studyroom_sensor.ino` when the microphone is connected.

## Broker

A visitor's browser can't reach a device on your home Wi-Fi, so an MQTT broker relays the readings (a free HiveMQ Cloud or EMQX Serverless tier works).

- **ESP32:** publishes over TLS, port 8883, with a **publish-only** user.
- **Website:** subscribes over secure WebSocket (`wss://…:8884/mqtt`) with a **subscribe-only** user. Its credentials end up in the browser, where anyone can read them, so that user must not be able to publish.

| Topic | Payload |
|---|---|
| `studyroom/motion` | `1` / `0` (retained) |
| `studyroom/sound` | loudness `0.00`–`1.00`, about 5 times a second. Only the level is sent, never audio. |
| `studyroom/heartbeat` | every 10 s, so the website knows the sensor is online |

## Setup

1. Copy `studyroom_sensor/secrets.example.h` to `secrets.h` (git-ignored) and fill in the Wi-Fi and broker details.
2. In the Arduino IDE, install **PubSubClient** (Nick O'Leary) and flash the sketch to the ESP32 (Arduino-ESP32 core 3.x).
3. For the website, copy `web/.env.example` to `web/.env.local` and set `VITE_MQTT_URL`, `VITE_MQTT_USER` and `VITE_MQTT_PASS` (the subscribe-only user). On Netlify, set the same values under *Site configuration → Environment variables* and redeploy.

Status: written but not yet tested with real hardware.
