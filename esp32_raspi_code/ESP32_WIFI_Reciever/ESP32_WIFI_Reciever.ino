// receiver_lr_espnow_to_pi_uart.ino
#include <WiFi.h>
#include <esp_now.h>
#include <esp_wifi.h>

static constexpr uint8_t WIFI_CHANNEL = 1;

// UART to Raspberry Pi (Serial1)
static constexpr int PIN_UART_RX = 16; // ESP32 RX  (connect to Pi TXD0 pin 8)
static constexpr int PIN_UART_TX = 17; // ESP32 TX  (connect to Pi RXD0 pin 10)
HardwareSerial PiSerial(1);

typedef struct __attribute__((packed)) {
  uint32_t node_id;      // derived from sender MAC
  uint32_t seq;          // incrementing counter
  uint32_t uptime_ms;    // sender millis()
} PingMsg;

static uint32_t macToId(const uint8_t mac[6]) {
  return ((uint32_t)mac[3] << 16) | ((uint32_t)mac[4] << 8) | (uint32_t)mac[5];
}

static void logBoth(const char* fmt, ...) {
  char buf[256];
  va_list args;
  va_start(args, fmt);
  vsnprintf(buf, sizeof(buf), fmt, args);
  va_end(args);

  // To Raspberry Pi
  PiSerial.print(buf);

  // Optional: also to USB serial (only visible when plugged into a PC)
  Serial.print(buf);
}

static void onRecv(const uint8_t *mac, const uint8_t *incomingData, int len) {
  if (len != (int)sizeof(PingMsg)) {
    logBoth("RX unknown len=%d from %02X:%02X:%02X:%02X:%02X:%02X\n",
            len, mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
    return;
  }

  PingMsg msg;
  memcpy(&msg, incomingData, sizeof(msg));

  logBoth("PING from %02X:%02X:%02X:%02X:%02X:%02X  node_id=%lu  seq=%lu  sender_uptime=%lums  rcv_uptime=%lums\n",
          mac[0], mac[1], mac[2], mac[3], mac[4], mac[5],
          (unsigned long)msg.node_id,
          (unsigned long)msg.seq,
          (unsigned long)msg.uptime_ms,
          (unsigned long)millis());
}

void setup() {
  // USB serial (debug; optional)
  Serial.begin(115200);
  delay(200);

  // UART to Pi
  PiSerial.begin(115200, SERIAL_8N1, PIN_UART_RX, PIN_UART_TX);
  delay(50);

  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  WiFi.disconnect(false, false);
  delay(100);

  esp_err_t s = esp_wifi_start();
  logBoth("esp_wifi_start => %d\n", (int)s);

  // Set channel
  esp_wifi_set_promiscuous(true);
  esp_wifi_set_channel(WIFI_CHANNEL, WIFI_SECOND_CHAN_NONE);
  esp_wifi_set_promiscuous(false);

  // Set protocol: 11b/g/n + LR
  esp_err_t e = esp_wifi_set_protocol(
    WIFI_IF_STA,
    WIFI_PROTOCOL_11B | WIFI_PROTOCOL_11G | WIFI_PROTOCOL_11N | WIFI_PROTOCOL_LR
  );
  logBoth("esp_wifi_set_protocol(11bgn+LR) => %d\n", (int)e);

  if (esp_now_init() != ESP_OK) {
    logBoth("ESP-NOW init failed\n");
    while (true) delay(1000);
  }

  esp_now_register_recv_cb(onRecv);

  uint8_t macAddr[6];
  WiFi.macAddress(macAddr);
  logBoth("Receiver ready. MAC=%02X:%02X:%02X:%02X:%02X:%02X  channel=%u\n",
          macAddr[0], macAddr[1], macAddr[2], macAddr[3], macAddr[4], macAddr[5], WIFI_CHANNEL);
}

void loop() {
  delay(1000);
}
