// Jasons house

#include <Arduino.h>
#include "driver/i2s.h"
#include <math.h>

#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>

#include <esp_wifi.h>
#include <stdarg.h>
#include <time.h>

static const char* WIFI_SSID = "ssid";
static const char* WIFI_PASS = "password";

static const char* SUPABASE_URL      = "https://tfjbwqcbzbkrzlwfjous.supabase.co";
static const char* SUPABASE_ANON_KEY = "placeholder";
static const char* SUPABASE_TABLE    = "sensor_data";

static const int   SENSOR_ID_REMOTE = 4;
static const float LAT_REMOTE = 44.234198;
static const float LON_REMOTE = -76.490498;
static const char* LOCATION_REMOTE = "368 Barrie St, Kingston, ON K7K 3T3";

static uint8_t WIFI_CHANNEL = 1;

static const int I2S_BCLK = 32;
static const int I2S_LRCK = 25;
static const int I2S_DIN  = 33;

static const i2s_port_t I2S_PORT = I2S_NUM_0;
static const int SAMPLE_RATE = 16000;
static const int DMA_BUF_LEN = 512;
static const int DMA_BUF_CNT = 4;

static const double FULL_SCALE_24 = (double)(1 << 23);

static double dbfs_smooth = -90.0;
static const double ALPHA = 0.15;

static double CAL_OFFSET_DB = -5.7;

static bool minuteAligned = false;
static int bucketYear = -1, bucketMonth = -1, bucketDay = -1, bucketHour = -1, bucketMinute = -1;
static double splSum = 0.0;
static double dbfsSum = 0.0;
static uint32_t splCount = 0;
static float splMax = -999.0f;

static void logf(const char* fmt, ...) {
  char buf[420];
  va_list args;
  va_start(args, fmt);
  vsnprintf(buf, sizeof(buf), fmt, args);
  va_end(args);
  Serial.print(buf);
}

static void makeLocalIso8601(char* out, size_t outsz,
                             int year, int month, int day, int hour, int minute, int second) {
  snprintf(out, outsz, "%04d-%02d-%02dT%02d:%02d:%02d",
           year, month, day, hour, minute, second);
}

static bool syncTimeLocal_EST() {
  configTzTime("EST5EDT,M3.2.0/2,M11.1.0/2", "pool.ntp.org", "time.nist.gov");

  logf("Waiting for NTP time sync (EST/EDT)...\n");
  for (int i = 0; i < 40; i++) {
    struct tm t;
    if (getLocalTime(&t, 250)) {
      int year = t.tm_year + 1900;
      if (year >= 2024) {
        logf("NTP TIME (LOCAL EST/EDT): %04d-%02d-%02d %02d:%02d:%02d\n",
             year, t.tm_mon + 1, t.tm_mday, t.tm_hour, t.tm_min, t.tm_sec);
        return true;
      }
    }
  }
  logf("NTP sync failed (continuing).\n");
  return false;
}

static bool getLocalYMDHMS(int &Y, int &Mo, int &D, int &H, int &Mi, int &S) {
  struct tm t;
  if (!getLocalTime(&t, 0)) return false;
  Y  = t.tm_year + 1900;
  Mo = t.tm_mon + 1;
  D  = t.tm_mday;
  H  = t.tm_hour;
  Mi = t.tm_min;
  S  = t.tm_sec;
  return true;
}

static bool ensureWiFiConnected(uint32_t wait_ms = 8000) {
  if (WiFi.status() == WL_CONNECTED) return true;

  logf("WiFi down (status=%d). Reconnecting...\n", (int)WiFi.status());

  WiFi.disconnect(false);
  delay(100);
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  uint32_t t0 = millis();
  while (WiFi.status() != WL_CONNECTED && (millis() - t0) < wait_ms) {
    delay(250);
    Serial.print("~");
  }

  if (WiFi.status() == WL_CONNECTED) {
    WIFI_CHANNEL = WiFi.channel();
    logf("\nWiFi reconnected. IP=%s  channel=%u\n",
         WiFi.localIP().toString().c_str(), WIFI_CHANNEL);
    return true;
  }

  logf("\nWiFi reconnect FAILED (status=%d)\n", (int)WiFi.status());
  return false;
}

static bool uploadToSupabase(int sensor_id,
                             float lat, float lon,
                             const char* location_name,
                             int year, int month, int day, int hour, int minute, int second,
                             float average_db,
                             float max_db) {

  if (!ensureWiFiConnected()) {
    logf("Supabase SKIP: WiFi NOT connected (status=%d)\n", (int)WiFi.status());
    return false;
  }

  char ts_local[32];
  makeLocalIso8601(ts_local, sizeof(ts_local), year, month, day, hour, minute, second);

  String url = String(SUPABASE_URL) + "/rest/v1/" + SUPABASE_TABLE;

  String body = "{";
  body += "\"sensor_id\":" + String(sensor_id) + ",";
  body += "\"lat\":" + String(lat, 6) + ",";
  body += "\"lon\":" + String(lon, 6) + ",";
  body += "\"location_name\":\"" + String(location_name) + "\",";
  body += "\"ts_utc\":\"" + String(ts_local) + "\",";
  body += "\"average_db\":" + String(average_db, 2) + ",";
  body += "\"max_db\":" + String(max_db, 2);
  body += "}";

  WiFiClientSecure client;
  client.setInsecure();
  client.setTimeout(15000);

  HTTPClient http;
  http.setTimeout(15000);

  if (!http.begin(client, url)) {
    logf("Supabase FAIL: http.begin() failed (URL=%s)\n", url.c_str());
    return false;
  }

  http.addHeader("Content-Type", "application/json");
  http.addHeader("apikey", SUPABASE_ANON_KEY);
  http.addHeader("Authorization", String("Bearer ") + SUPABASE_ANON_KEY);
  http.addHeader("Prefer", "return=minimal");

  int code = http.POST(body);
  String resp = http.getString();
  http.end();

  bool ok = (code == 201 || code == 204);

  logf("Supabase POST => code=%d ok=%d ts=%s bytes=%d\n",
       code, ok ? 1 : 0, ts_local, body.length());

  if (!ok) {
    logf("Supabase RESP: %s\n", resp.c_str());
  }
  return ok;
}

void setupI2S() {
  i2s_config_t i2s_config = {};
  i2s_config.mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_RX);
  i2s_config.sample_rate = SAMPLE_RATE;
  i2s_config.bits_per_sample = I2S_BITS_PER_SAMPLE_32BIT;
  i2s_config.channel_format = I2S_CHANNEL_FMT_ONLY_LEFT;
  i2s_config.communication_format = I2S_COMM_FORMAT_I2S;
  i2s_config.intr_alloc_flags = ESP_INTR_FLAG_LEVEL1;
  i2s_config.dma_buf_count = DMA_BUF_CNT;
  i2s_config.dma_buf_len = DMA_BUF_LEN;
  i2s_config.use_apll = false;
  i2s_config.tx_desc_auto_clear = false;
  i2s_config.fixed_mclk = 0;

  i2s_pin_config_t pin_config = {};
  pin_config.bck_io_num = I2S_BCLK;
  pin_config.ws_io_num = I2S_LRCK;
  pin_config.data_out_num = I2S_PIN_NO_CHANGE;
  pin_config.data_in_num = I2S_DIN;

  esp_err_t err = i2s_driver_install(I2S_PORT, &i2s_config, 0, NULL);
  if (err != ESP_OK) { logf("i2s_driver_install failed: %d\n", err); while (true) delay(1000); }

  err = i2s_set_pin(I2S_PORT, &pin_config);
  if (err != ESP_OK) { logf("i2s_set_pin failed: %d\n", err); while (true) delay(1000); }

  i2s_zero_dma_buffer(I2S_PORT);
}

void connectWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  WiFi.setAutoReconnect(true);

  esp_wifi_set_ps(WIFI_PS_NONE);

  logf("Connecting WiFi to SSID: %s\n", WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  uint32_t t0 = millis();
  while (WiFi.status() != WL_CONNECTED) {
    delay(250);
    Serial.print(".");
    if (millis() - t0 > 20000) {
      Serial.print("\nWiFi connect timeout.\n");
      break;
    }
  }

  if (WiFi.status() == WL_CONNECTED) {
    WIFI_CHANNEL = WiFi.channel();
    logf("\nWiFi connected. IP=%s  channel=%u\n", WiFi.localIP().toString().c_str(), WIFI_CHANNEL);
  }
}

void setup() {
  Serial.begin(115200);
  delay(200);

  setupI2S();

  connectWiFi();
  syncTimeLocal_EST();
}

void loop() {
  static int32_t samples[DMA_BUF_LEN];
  size_t bytes_read = 0;

  esp_err_t err = i2s_read(I2S_PORT, (void*)samples, sizeof(samples), &bytes_read, portMAX_DELAY);
  if (err != ESP_OK || bytes_read == 0) return;

  int n = bytes_read / sizeof(int32_t);
  double sum_sq = 0.0;

  for (int i = 0; i < n; i++) {
    int32_t s = samples[i] >> 8;
    sum_sq += (double)s * (double)s;
  }

  double rms = sqrt(sum_sq / (double)n);

  double dbfs = -120.0;
  if (rms > 1.0) dbfs = 20.0 * log10(rms / FULL_SCALE_24);

  dbfs_smooth = (1.0 - ALPHA) * dbfs_smooth + ALPHA * dbfs;

  double estSPL = dbfs_smooth + 120.0 + CAL_OFFSET_DB;
  if ((float)estSPL > splMax) splMax = (float)estSPL;

  int Y, Mo, D, H, Mi, S;
  if (!getLocalYMDHMS(Y, Mo, D, H, Mi, S)) { delay(20); return; }

  if (!minuteAligned) {
    if (S == 0) {
      minuteAligned = true;
      bucketYear = Y; bucketMonth = Mo; bucketDay = D; bucketHour = H; bucketMinute = Mi;
      splSum = 0.0; dbfsSum = 0.0; splCount = 0; splMax = -999.0f;
    } else {
      delay(20);
      return;
    }
  }

  if (Mi != bucketMinute || H != bucketHour || D != bucketDay || Mo != bucketMonth || Y != bucketYear) {
    float avgSPL_1min  = (splCount > 0) ? (float)(splSum / (double)splCount) : 0.0f;
    float avgDBFS_1min = (splCount > 0) ? (float)(dbfsSum / (double)splCount) : -120.0f;
    float maxSPL_1min  = (splMax < -900.0f) ? avgSPL_1min : splMax;

    logf("368: AVG_1MIN %04d-%02d-%02d %02d:%02d:00  avg=%.2f dB  max=%.2f dB  dBFS=%.2f\n",
         bucketYear, bucketMonth, bucketDay, bucketHour, bucketMinute,
         avgSPL_1min, maxSPL_1min, avgDBFS_1min);

    uploadToSupabase(SENSOR_ID_REMOTE,
                     LAT_REMOTE, LON_REMOTE, LOCATION_REMOTE,
                     bucketYear, bucketMonth, bucketDay, bucketHour, bucketMinute, 0,
                     avgSPL_1min,
                     maxSPL_1min);

    bucketYear = Y; bucketMonth = Mo; bucketDay = D; bucketHour = H; bucketMinute = Mi;
    splSum = 0.0; dbfsSum = 0.0; splCount = 0; splMax = -999.0f;
  }

  splSum += estSPL;
  dbfsSum += dbfs_smooth;
  splCount++;

  delay(20);
}
