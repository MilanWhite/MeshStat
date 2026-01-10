// sender_lr_espnow.ino
#include <WiFi.h>
#include <esp_now.h>
#include <esp_wifi.h>

static constexpr uint8_t WIFI_CHANNEL = 1;

// Paste RECEIVER MAC here (from receiver serial output)
static uint8_t RECEIVER_MAC[6] = { 0x4C, 0xC3, 0x82, 0xCC, 0xB1, 0xC8 };

typedef struct __attribute__((packed)) {
  uint32_t node_id;
  uint32_t seq;
  uint32_t uptime_ms;
} PingMsg;

static uint32_t node_id = 0;
static uint32_t seqno = 0;

static uint32_t macToId(const uint8_t mac[6]) {
  return ((uint32_t)mac[3] << 16) | ((uint32_t)mac[4] << 8) | (uint32_t)mac[5];
}

static void onSent(const uint8_t *mac_addr, esp_now_send_status_t status) {
  Serial.printf("send -> %02X:%02X:%02X:%02X:%02X:%02X  %s\n",
                mac_addr[0], mac_addr[1], mac_addr[2], mac_addr[3], mac_addr[4], mac_addr[5],
                status == ESP_NOW_SEND_SUCCESS ? "OK" : "FAIL");
}

void setup() {
  Serial.begin(115200);
  delay(200);

  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);          // same as WIFI_PS_NONE, but Arduino-safe
  WiFi.disconnect(false, false);
  delay(100);

  esp_err_t s = esp_wifi_start();   // <-- ensures WiFi driver is started
  Serial.printf("esp_wifi_start => %d\n", (int)s);

  // Set channel
  esp_wifi_set_promiscuous(true);
  esp_wifi_set_channel(WIFI_CHANNEL, WIFI_SECOND_CHAN_NONE);
  esp_wifi_set_promiscuous(false);

  // Set protocol: 11b/g/n + LR
  esp_err_t e = esp_wifi_set_protocol(
    WIFI_IF_STA,
    WIFI_PROTOCOL_11B | WIFI_PROTOCOL_11G | WIFI_PROTOCOL_11N | WIFI_PROTOCOL_LR
  );
  Serial.printf("esp_wifi_set_protocol(11bgn+LR) => %d\n", (int)e);

  if (esp_now_init() != ESP_OK) {
    Serial.println("ESP-NOW init failed");
    while (true) delay(1000);
  }

  esp_now_register_send_cb(onSent);

  // Register receiver as peer
  esp_now_peer_info_t peerInfo{};
  memcpy(peerInfo.peer_addr, RECEIVER_MAC, 6);
  peerInfo.channel = WIFI_CHANNEL;
  peerInfo.encrypt = false;

  if (esp_now_add_peer(&peerInfo) != ESP_OK) {
    Serial.println("Failed to add peer");
    while (true) delay(1000);
  }

  uint8_t mymac[6];
  WiFi.macAddress(mymac);
  node_id = macToId(mymac);

  Serial.printf("Sender ready. MAC=%02X:%02X:%02X:%02X:%02X:%02X  node_id=%lu  channel=%u\n",
                mymac[0], mymac[1], mymac[2], mymac[3], mymac[4], mymac[5],
                (unsigned long)node_id, WIFI_CHANNEL);

  // Deterministic jitter per node to reduce collisions (0..900ms)
  randomSeed((uint32_t)ESP.getEfuseMac());
}

void loop() {
  PingMsg msg;
  msg.node_id = node_id;
  msg.seq = ++seqno;
  msg.uptime_ms = millis();

  esp_err_t r = esp_now_send(RECEIVER_MAC, (uint8_t*)&msg, sizeof(msg));
  Serial.printf("PING seq=%lu send_ret=%d\n", (unsigned long)msg.seq, (int)r);

  // 60s period + small per-node jitter to avoid simultaneous transmit collisions
  uint32_t jitter_ms = (node_id % 10) * 100;  // 0..900ms
  delay(1000 + jitter_ms);
}
