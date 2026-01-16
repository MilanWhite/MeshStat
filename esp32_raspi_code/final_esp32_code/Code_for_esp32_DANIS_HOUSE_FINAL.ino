// DANIS HOUSE FINAL 

#include <Arduino.h>
#include "driver/i2s.h"
#include "driver/adc.h"
#include <esp_adc_cal.h>
#include <math.h>
#include <Wire.h>
#include "RTClib.h"

#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>

#include <esp_now.h>
#include <esp_wifi.h>
#include <stdarg.h>

static const char* WIFI_SSID = "ssid";
static const char* WIFI_PASS = "password";

static const char* SUPABASE_URL = "https://tfjbwqcbzbkrzlwfjous.supabase.co";

static const char* SUPABASE_ANON_KEY = "placeholder";

static const char* SUPABASE_TABLE = "sensor_data";

static const int   SENSOR_ID_327 = 3;
static const float LAT_327 = 44.233195;
static const float LON_327 = -76.490623;
static const char* LOCATION_327 = " 327 Barrie St, Kingston, ON K7L 1B7";

static const int   SENSOR_ID_REMOTE = 4;
static const float LAT_REMOTE = 44.234198;
static const float LON_REMOTE = -76.490498;
static const char* LOCATION_REMOTE = "368 Barrie St, Kingston, ON K7K 3T3";

static uint8_t WIFI_CHANNEL = 1;

static const int I2S_BCLK = 32;  // SCK
static const int I2S_LRCK = 25;  // WS
static const int I2S_DIN  = 33;  // SD

static const i2s_port_t I2S_PORT = I2S_NUM_0;
static const int SAMPLE_RATE = 16000;
static const int DMA_BUF_LEN = 512;
static const int DMA_BUF_CNT = 4;

static const double FULL_SCALE_24 = (double)(1 << 23);

static double dbfs_smooth = -90.0;
static const double ALPHA = 0.15;

static double CAL_OFFSET_DB = -5.7;

RTC_DS3231 rtc;
static const bool FORCE_SET_RTC = false;
static const int RTC_SET_OFFSET_SECONDS = 23; // your offset

static bool minuteAligned = false;
static int bucketYear = -1, bucketMonth = -1, bucketDay = -1, bucketHour = -1, bucketMinute = -1;
static double splSum = 0.0;
static double dbfsSum = 0.0;
static uint32_t splCount = 0;
static float splMax = -999.0f;   // max estSPL in the minute

static const adc1_channel_t THERM_ADC_CH = ADC1_CHANNEL_6;
static const float VCC = 3.3f;
static const float R_FIXED = 10000.0f;
static const float R0 = 10000.0f;
static const float T0_C = 25.0f;
static const float BETA = 3950.0f;

static const bool  THERMISTOR_TO_3V3 = false;

static double tempSumC = 0.0;
static uint32_t tempCount = 0;
static float tempMinC = 999.0f;
static float tempMaxC = -999.0f;

static uint32_t lastTempMs = 0;
static const uint32_t TEMP_SAMPLE_PERIOD_MS = 250;

static uint32_t local_node_id = 0;


static esp_adc_cal_characteristics_t therm_adc_chars;


static const float TEMP_CAL_OFFSET_C = 0.0f;
static const float R_FIXED_OHMS = R_FIXED;

static uint32_t macToId(const uint8_t mac[6]) {
  return ((uint32_t)mac[3] << 16) | ((uint32_t)mac[4] << 8) | (uint32_t)mac[5];
}
typedef struct __attribute__((packed)) {
  uint32_t node_id;
  uint32_t seq;
  uint32_t uptime_ms;

  uint16_t year;
  uint8_t  month, day, hour, minute;

  float avg_estSPL;
  float max_estSPL;
  float avg_dBFS;
  uint32_t n_samples;
} MinuteMsg_V1;

typedef struct __attribute__((packed)) {
  uint32_t node_id;
  uint32_t seq;
  uint32_t uptime_ms;

  uint16_t year;
  uint8_t  month, day, hour, minute;

  float avg_estSPL;
  float max_estSPL;
  float avg_dBFS;
  uint32_t n_samples;

  float temp_c;  // <-- NEW
} MinuteMsg;

static portMUX_TYPE remoteMux = portMUX_INITIALIZER_UNLOCKED;
static volatile bool remotePending = false;
static MinuteMsg remoteLast;

static void logf(const char* fmt, ...) {
  char buf[420];
  va_list args;
  va_start(args, fmt);
  vsnprintf(buf, sizeof(buf), fmt, args);
  va_end(args);
  Serial.print(buf);
}

static void onRecv(const esp_now_recv_info_t *info, const uint8_t *incomingData, int len) {
  (void)info;

  MinuteMsg msg{};
  bool ok = false;

  if (len == (int)sizeof(MinuteMsg)) {
    memcpy(&msg, incomingData, sizeof(MinuteMsg));
    ok = true;
  } else if (len == (int)sizeof(MinuteMsg_V1)) {
    memcpy(&msg, incomingData, sizeof(MinuteMsg_V1));
    msg.temp_c = NAN;
    ok = true;
  }

  if (ok) {
    portENTER_CRITICAL_ISR(&remoteMux);
    remoteLast = msg;
    remotePending = true;
    portEXIT_CRITICAL_ISR(&remoteMux);
  }
}

static void makeLocalIso8601(char* out, size_t outsz,
                             int year, int month, int day, int hour, int minute, int second) {
  snprintf(out, outsz, "%04d-%02d-%02dT%02d:%02d:%02d",
           year, month, day, hour, minute, second);
}

static float readThermistorC_legacyADC1() {
  int raw = adc1_get_raw(THERM_ADC_CH);
  if (raw <= 0 || raw >= 4095) return NAN;

  uint32_t mv = esp_adc_cal_raw_to_voltage(raw, &therm_adc_chars);
  if (mv == 0) return NAN;

  float v = (float)mv / 1000.0f;

  if (v <= 0.001f || v >= (VCC - 0.001f)) return NAN;

  float rTherm = 0.0f;

  if (THERMISTOR_TO_3V3) {
    rTherm = R_FIXED_OHMS * (VCC / v - 1.0f);
  } else {
    rTherm = R_FIXED_OHMS * (v / (VCC - v));
  }

  if (rTherm <= 0.0f) return NAN;

  float T0_K = T0_C + 273.15f;
  float invT = (1.0f / T0_K) + (1.0f / BETA) * ::logf(rTherm / R0);
  float T_K = 1.0f / invT;

  float tC = (T_K - 273.15f) + TEMP_CAL_OFFSET_C;
  return tC;
}


static bool uploadToSupabase(int sensor_id,
                             float lat, float lon,
                             const char* location_name,
                             int year, int month, int day, int hour, int minute, int second,
                             float average_db,
                             float max_db,
                             float celsius) {
  if (WiFi.status() != WL_CONNECTED) return false;

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

  if (!isnan(celsius)) {
    body += ",\"celsius\":" + String(celsius, 2);
  }

  body += "}";

  WiFiClientSecure client;
  client.setInsecure();

  HTTPClient http;
  if (!http.begin(client, url)) return false;

  http.addHeader("Content-Type", "application/json");
  http.addHeader("apikey", SUPABASE_ANON_KEY);
  http.addHeader("Authorization", String("Bearer ") + SUPABASE_ANON_KEY);
  http.addHeader("Prefer", "return=minimal");

  int code = http.POST(body);
  String resp = http.getString();
  http.end();

  bool ok = (code == 201 || code == 204);
  if (!ok) {
    logf("Supabase POST failed code=%d resp=%s\n", code, resp.c_str());
  }
  return ok;
}

void setupRTC() {
  Wire.begin(21, 22);

  if (!rtc.begin()) {
    Serial.println("RTC not found on I2C. Check wiring: SDA=21, SCL=22, VCC=3V3, GND=GND");
    while (true) delay(1000);
  }

  if (FORCE_SET_RTC || rtc.lostPower()) {
    rtc.adjust(DateTime(F(__DATE__), F(__TIME__)) + TimeSpan(RTC_SET_OFFSET_SECONDS));
    Serial.println("RTC set to compile/upload time (+offset).");
  } else {
    Serial.println("RTC already has time (not setting).");
  }

  DateTime now = rtc.now();
  logf("RTC NOW (LOCAL): %04d-%02d-%02d %02d:%02d:%02d\n",
       now.year(), now.month(), now.day(),
       now.hour(), now.minute(), now.second());
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
    logf("SET YOUR TRANSMITTER WIFI_CHANNEL TO: %u\n", WIFI_CHANNEL);
  }
}

void setupEspNowReceiver() {
  esp_wifi_set_promiscuous(true);
  esp_wifi_set_channel(WIFI_CHANNEL, WIFI_SECOND_CHAN_NONE);
  esp_wifi_set_promiscuous(false);

  esp_err_t e = esp_wifi_set_protocol(
    WIFI_IF_STA,
    WIFI_PROTOCOL_11B | WIFI_PROTOCOL_11G | WIFI_PROTOCOL_11N | WIFI_PROTOCOL_LR
  );
  logf("esp_wifi_set_protocol(11bgn+LR) => %d\n", (int)e);

  if (esp_now_init() != ESP_OK) {
    Serial.println("ESP-NOW init failed");
    while (true) delay(1000);
  }

  esp_now_register_recv_cb(onRecv);

  uint8_t macAddr[6];
  WiFi.macAddress(macAddr);
  local_node_id = macToId(macAddr);

  logf("Receiver ready. MAC=%02X:%02X:%02X:%02X:%02X:%02X  channel=%u  local_node_id=%lu\n",
       macAddr[0], macAddr[1], macAddr[2], macAddr[3], macAddr[4], macAddr[5],
       WIFI_CHANNEL, (unsigned long)local_node_id);
}

void setup() {
  Serial.begin(115200);
  delay(200);

  adc1_config_width(ADC_WIDTH_BIT_12);
  adc1_config_channel_atten(THERM_ADC_CH, ADC_ATTEN_DB_11);
  esp_adc_cal_characterize(ADC_UNIT_1, ADC_ATTEN_DB_11, ADC_WIDTH_BIT_12, 1100, &therm_adc_chars);


  setupRTC();
  setupI2S();

  connectWiFi();
  setupEspNowReceiver();
}

void loop() {

  if (remotePending) {
    MinuteMsg msgCopy;
    portENTER_CRITICAL(&remoteMux);
    msgCopy = remoteLast;
    remotePending = false;
    portEXIT_CRITICAL(&remoteMux);

    logf("The Store Famous: AVG_1MIN %04u-%02u-%02u %02u:%02u:00  avg=%.2f dB  max=%.2f dB  dBFS=%.2f  n=%lu  temp=%.2f C  node_id=%lu  seq=%lu  | sensor_id=%d lat=%.6f lon=%.6f location_name=\"%s\"\n",
         msgCopy.year, msgCopy.month, msgCopy.day, msgCopy.hour, msgCopy.minute,
         msgCopy.avg_estSPL, msgCopy.max_estSPL, msgCopy.avg_dBFS,
         (unsigned long)msgCopy.n_samples,
         isnan(msgCopy.temp_c) ? -999.0f : msgCopy.temp_c,
         (unsigned long)msgCopy.node_id,
         (unsigned long)msgCopy.seq,
         SENSOR_ID_REMOTE, LAT_REMOTE, LON_REMOTE, LOCATION_REMOTE);

    uploadToSupabase(SENSOR_ID_REMOTE,
                     LAT_REMOTE, LON_REMOTE, LOCATION_REMOTE,
                     msgCopy.year, msgCopy.month, msgCopy.day, msgCopy.hour, msgCopy.minute, 0,
                     msgCopy.avg_estSPL,
                     msgCopy.max_estSPL,
                     msgCopy.temp_c);
  }

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

  DateTime now = rtc.now();

  if (!minuteAligned) {
    if (now.second() == 0) {
      minuteAligned = true;
      bucketYear = now.year();
      bucketMonth = now.month();
      bucketDay = now.day();
      bucketHour = now.hour();
      bucketMinute = now.minute();

      splSum = 0.0;
      dbfsSum = 0.0;
      splCount = 0;
      splMax = -999.0f;

      tempSumC = 0.0;
      tempCount = 0;
      tempMinC = 999.0f;
      tempMaxC = -999.0f;
    } else {
      delay(20);
      return;
    }
  }

  uint32_t ms = millis();
  if (ms - lastTempMs >= TEMP_SAMPLE_PERIOD_MS) {
    lastTempMs = ms;
    float tC = readThermistorC_legacyADC1();
    if (!isnan(tC) && tC > -40.0f && tC < 125.0f) {
      tempSumC += tC;
      tempCount++;
      if (tC < tempMinC) tempMinC = tC;
      if (tC > tempMaxC) tempMaxC = tC;
    }
  }

  if (now.minute() != bucketMinute || now.hour() != bucketHour || now.day() != bucketDay ||
      now.month() != bucketMonth || now.year() != bucketYear) {

    float avgSPL_1min  = (splCount > 0) ? (float)(splSum / (double)splCount) : 0.0f;
    float avgDBFS_1min = (splCount > 0) ? (float)(dbfsSum / (double)splCount) : -120.0f;
    float maxSPL_1min  = (splMax < -900.0f) ? avgSPL_1min : splMax;

    float avgTempC_1min = (tempCount > 0) ? (float)(tempSumC / (double)tempCount) : NAN;

    logf("409: AVG_1MIN %04d-%02d-%02d %02d:%02d:00  avg=%.2f dB  max=%.2f dB  dBFS=%.2f  temp=%.2f C\n",
         bucketYear, bucketMonth, bucketDay, bucketHour, bucketMinute,
         avgSPL_1min, maxSPL_1min, avgDBFS_1min,
         isnan(avgTempC_1min) ? -999.0f : avgTempC_1min);

    uploadToSupabase(SENSOR_ID_327,
                     LAT_327, LON_327, LOCATION_327,
                     bucketYear, bucketMonth, bucketDay, bucketHour, bucketMinute, 0,
                     avgSPL_1min,
                     maxSPL_1min,
                     avgTempC_1min);

    bucketYear = now.year();
    bucketMonth = now.month();
    bucketDay = now.day();
    bucketHour = now.hour();
    bucketMinute = now.minute();

    splSum = 0.0;
    dbfsSum = 0.0;
    splCount = 0;
    splMax = -999.0f;

    tempSumC = 0.0;
    tempCount = 0;
    tempMinC = 999.0f;
    tempMaxC = -999.0f;
  }

  splSum += estSPL;
  dbfsSum += dbfs_smooth;
  splCount++;

  delay(20);
}
