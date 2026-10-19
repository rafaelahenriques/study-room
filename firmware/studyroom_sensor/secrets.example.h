// Copy to secrets.h (git-ignored) and fill in.
#pragma once

#define WIFI_SSID     "your-wifi"
#define WIFI_PASSWORD "your-wifi-password"

// MQTT broker (TLS). Use a PUBLISH-ONLY user for the device.
#define MQTT_HOST "your-broker-host"
#define MQTT_PORT 8883
#define MQTT_USER "esp32-publisher"
#define MQTT_PASS "change-me"

// Optional: paste the broker's root CA to verify TLS instead of setInsecure().
// #define MQTT_CA_CERT "-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----\n"
