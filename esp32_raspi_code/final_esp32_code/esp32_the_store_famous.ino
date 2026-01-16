// THE STORE FAMOUS (TRANSMITTER) 

#include <Arduino.h>
#include "driver/i2s.h"
#include <math.h>
#include <Wire.h>
#include "RTClib.h"

#include <WiFi.h>
#include <esp_now.h>
#include <esp_wifi.h>

#include "driver/adc.h"
#include "esp_adc_cal.h"

static constexpr uint8_t WIFI_CHANNEL = 6;
static uint8_t RECEIVER_MAC[6] = { 0x4C, 0xC3, 0x82, 0xCC, 0xB1, 0xC8 };

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

RTC_DS3231 rtc;
static const bool FORCE_SET_RTC = false;
static const int  RTC_SET_OFFSET_SECONDS = 23;

static const adc1_channel_t ADC_CH = ADC1_CHANNEL_6;

static const float VCC       = 3.300f;
static const float R_FIXED   = 12000.0f;

static const float BETA      = 3950.0f;
static const float T0_C      = 22.2f;
static const float R0_OHMS   = 12000.0f;

static const int   ADC_SAMPLES = 32;

static esp_adc_cal_characteristics_t adc_chars;
static uint32_t lastTempMs = 0;
static const uint32_t TEMP_SAMPLE_PERIOD_MS = 250;

static bool minuteAligned = false;
static int bucketYear = -1, bucketMonth = -1, bucketDay = -1, bucketHour = -1, bucketMinute = -1;

static double splSum = 0.0;
static double dbfsSum = 0.0;
static uint32_t splCount = 0;
static float splMax = -999.0f;

static double tempSumC = 0.0;
static uint32_t tempCount = 0;

static uint32_t node_id = 0;
static uint32_t seqno = 0;

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

  float temp_c;
} MinuteMsg;

static void onSent(const wifi_tx_info_t* info, esp_now_send_status_t status) {
  const uint8_t* mac = info ? info->des_addr : nullptr;
  if (mac) {
    Serial.printf("ESP-NOW send_cb to %02X:%02X:%02X:%02X:%02X:%02X => %s\n",
                  mac[0], mac[1], mac[2], mac[3], mac[4], mac[5],
                  (status == ESP_NOW_SEND_SUCCESS) ? "SUCCESS" : "FAIL");
  } else {
    Serial.printf("ESP-NOW send_cb => %s\n",
                  (status == ESP_NOW_SEND_SUCCESS) ? "SUCCESS" : "FAIL");
  }
}

static float readNodeVolts_Legacy() {
  uint32_t sum = 0;
  for (int i = 0; i < ADC_SAMPLES; i++) {
    int raw = adc1_get_raw(ADC_CH);
    if (raw < 0) return NAN;
    sum += (uint32_t)raw;
    delay(2);
  }
  uint32_t rawAvg = sum / (uint32_t)ADC_SAMPLES;

  uint32_t mv = esp_adc_cal_raw_to_voltage(rawAvg, &adc_chars);
  return (float)mv / 1000.0f;
}

static float voltsToRtherm(float v) {
  if (v <= 0.001f || v >= (VCC - 0.001f)) return NAN;
  return R_FIXED * (v / (VCC - v));
}

static float rToCelsius_Beta(float r) {
  const float T0_K = T0_C + 273.15f;
  float invT = (1.0f / T0_K) + (1.0f / BETA) * logf(r / R0_OHMS);
  float T_K = 1.0f / invT;
  return T_K - 273.15f;
}

static float readThermistorC() {
  float v = readNodeVolts_Legacy();
  float r = voltsToRtherm(v);
  if (isnan(r)) return NAN;
  float tc = rToCelsius_Beta(r);
  if (tc < -40.0f || tc > 125.0f) return NAN;
  return tc;
}

void setupEspNowSender() {
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  WiFi.disconnect(false, false);
  delay(100);

  esp_err_t s = esp_wifi_start();
  Serial.printf("esp_wifi_start => %d\n", (int)s);

  esp_wifi_set_promiscuous(true);
  esp_wifi_set_channel(WIFI_CHANNEL, WIFI_SECOND_CHAN_NONE);
  esp_wifi_set_promiscuous(false);

  esp_err_t e = esp_wifi_set_protocol(
    WIFI_IF_STA,
    WIFI_PROTOCOL_11B | WIFI_PROTOCOL_11G | WIFI_PROTOCOL_11N
  );
  Serial.printf("esp_wifi_set_protocol(11bgn) => %d\n", (int)e);

  if (esp_now_init() != ESP_OK) {
    Serial.println("ESP-NOW init failed");
    while (true) delay(1000);
  }

  esp_now_register_send_cb(onSent);

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

  Serial.printf("TX ready. MY MAC=%02X:%02X:%02X:%02X:%02X:%02X  node_id=%lu  channel=%u\n",
                mymac[0], mymac[1], mymac[2], mymac[3], mymac[4], mymac[5],
                (unsigned long)node_id, WIFI_CHANNEL);

  Serial.printf("TX sending to RECEIVER MAC=%02X:%02X:%02X:%02X:%02X:%02X\n",
                RECEIVER_MAC[0], RECEIVER_MAC[1], RECEIVER_MAC[2],
                RECEIVER_MAC[3], RECEIVER_MAC[4], RECEIVER_MAC[5]);

  randomSeed((uint32_t)ESP.getEfuseMac());
}

void setupRTC() {
  Wire.begin(21, 22);

  if (!rtc.begin()) {
    Serial.println("RTC not found on I2C. Check wiring SDA=21 SCL=22 VCC=3V3 GND=GND");
    while (true) delay(1000);
  }

  if (FORCE_SET_RTC || rtc.lostPower()) {
    rtc.adjust(DateTime(F(__DATE__), F(__TIME__)) + TimeSpan(RTC_SET_OFFSET_SECONDS));
    Serial.println("RTC set to compile/upload time (+offset).");
  } else {
    Serial.println("RTC already has time (not setting).");
  }

  DateTime now = rtc.now();
  Serial.printf("RTC NOW: %04d-%02d-%02d %02d:%02d:%02d\n",
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
  if (err != ESP_OK) { Serial.printf("i2s_driver_install failed: %d\n", err); while (true) delay(1000); }

  err = i2s_set_pin(I2S_PORT, &pin_config);
  if (err != ESP_OK) { Serial.printf("i2s_set_pin failed: %d\n", err); while (true) delay(1000); }

  i2s_zero_dma_buffer(I2S_PORT);
}

void setupThermistorADC_Legacy() {
  adc1_config_width(ADC_WIDTH_BIT_12);
  adc1_config_channel_atten(ADC_CH, ADC_ATTEN_DB_11);

  esp_adc_cal_characterize(ADC_UNIT_1, ADC_ATTEN_DB_11, ADC_WIDTH_BIT_12, 1100, &adc_chars);

  float v = readNodeVolts_Legacy();
  Serial.printf("Thermistor ADC legacy init ok. Vnode=%.3f V\n", v);
}

void setup() {
  Serial.begin(115200);
  delay(200);

  setupEspNowSender();
  setupRTC();
  setupI2S();
  setupThermistorADC_Legacy();
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

  uint32_t ms = millis();
  if (ms - lastTempMs >= TEMP_SAMPLE_PERIOD_MS) {
    lastTempMs = ms;
    float tC = readThermistorC();
    if (!isnan(tC)) {
      tempSumC += tC;
      tempCount++;
    }
  }

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
    } else {
      delay(20);
      return;
    }
  }

  if (now.minute() != bucketMinute || now.hour() != bucketHour || now.day() != bucketDay ||
      now.month() != bucketMonth || now.year() != bucketYear) {

    float avgSPL  = (splCount > 0) ? (float)(splSum / (double)splCount) : 0.0f;
    float avgDBFS = (splCount > 0) ? (float)(dbfsSum / (double)splCount) : -120.0f;
    float maxSPL  = (splMax < -900.0f) ? avgSPL : splMax;
    float avgTempC = (tempCount > 0) ? (float)(tempSumC / (double)tempCount) : NAN;

    MinuteMsg msg{};
    msg.node_id   = node_id;
    msg.seq       = ++seqno;
    msg.uptime_ms = millis();

    msg.year   = (uint16_t)bucketYear;
    msg.month  = (uint8_t)bucketMonth;
    msg.day    = (uint8_t)bucketDay;
    msg.hour   = (uint8_t)bucketHour;
    msg.minute = (uint8_t)bucketMinute;

    msg.avg_estSPL = avgSPL;
    msg.max_estSPL = maxSPL;
    msg.avg_dBFS   = avgDBFS;
    msg.n_samples  = splCount;
    msg.temp_c     = avgTempC;

    uint32_t jitter_ms = (node_id % 10) * 25;
    delay(jitter_ms);

    esp_err_t r = esp_now_send(RECEIVER_MAC, (uint8_t*)&msg, sizeof(msg));

    Serial.printf(
      "TX AVG_1MIN %04u-%02u-%02u %02u:%02u:00  avg=%.2f dB  max=%.2f dB  dBFS=%.2f  n=%lu  temp=%.2f C  send_ret=%d\n",
      msg.year, msg.month, msg.day, msg.hour, msg.minute,
      msg.avg_estSPL, msg.max_estSPL, msg.avg_dBFS,
      (unsigned long)msg.n_samples,
      isnan(msg.temp_c) ? -999.0f : msg.temp_c,
      (int)r
    );

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
  }

  splSum += estSPL;
  dbfsSum += dbfs_smooth;
  splCount++;

  delay(20);
}
