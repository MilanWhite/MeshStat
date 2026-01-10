  #include <Arduino.h>
#include "driver/i2s.h"
#include <math.h>

// -------- INMP441 -> ESP32 pins (change if you wired differently) --------
static const int I2S_BCLK = 32;  // SCK
static const int I2S_LRCK = 25;  // WS
static const int I2S_DIN  = 33;  // SD (mic data out -> ESP32 data in)

// -------- I2S config --------
static const i2s_port_t I2S_PORT = I2S_NUM_0;
static const int SAMPLE_RATE = 16000;     // 16 kHz is fine for level-metering
static const int DMA_BUF_LEN = 512;       // samples per DMA buffer
static const int DMA_BUF_CNT = 4;

// INMP441 outputs 24-bit 2's complement in an I2S frame. :contentReference[oaicite:6]{index=6}
// We'll read 32-bit samples and shift down to 24-bit.
static const double FULL_SCALE_24 = (double)(1 << 23); // signed 24-bit peak

// simple smoothing for plot stability
static double dbfs_smooth = -90.0;
static const double ALPHA = 0.15; // higher = less smoothing

static double CAL_OFFSET_DB = -5.7;

void setupI2S() {
  i2s_config_t i2s_config = {};
  i2s_config.mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_RX);
  i2s_config.sample_rate = SAMPLE_RATE;
  i2s_config.bits_per_sample = I2S_BITS_PER_SAMPLE_32BIT;
  i2s_config.channel_format = I2S_CHANNEL_FMT_ONLY_RIGHT; // L/R pin tied to GND
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

  // Install and start I2S
  esp_err_t err = i2s_driver_install(I2S_PORT, &i2s_config, 0, NULL);
  if (err != ESP_OK) {
    Serial.printf("i2s_driver_install failed: %d\n", err);
    while (true) delay(1000);
  }

  err = i2s_set_pin(I2S_PORT, &pin_config);
  if (err != ESP_OK) {
    Serial.printf("i2s_set_pin failed: %d\n", err);
    while (true) delay(1000);
  }

  // Clear DMA buffers
  i2s_zero_dma_buffer(I2S_PORT);
}

void setup() {
  Serial.begin(115200);
  delay(200);
  setupI2S();
}

void loop() {
  static int32_t samples[DMA_BUF_LEN];
  size_t bytes_read = 0;

  // Read one DMA buffer worth of audio
  esp_err_t err = i2s_read(I2S_PORT, (void*)samples, sizeof(samples), &bytes_read, portMAX_DELAY);
  if (err != ESP_OK || bytes_read == 0) return;

  int n = bytes_read / sizeof(int32_t);
  double sum_sq = 0.0;

  for (int i = 0; i < n; i++) {
    // Convert 32-bit frame to signed 24-bit sample
    int32_t s = samples[i] >> 8; // keep top 24 bits
    // RMS accumulator
    sum_sq += (double)s * (double)s;
  }

  double rms = sqrt(sum_sq / (double)n);

  // dBFS: 20*log10(rms / full_scale). Clamp to avoid -inf.
  double dbfs = -120.0;
  if (rms > 1.0) {
    dbfs = 20.0 * log10(rms / FULL_SCALE_24);
  }

  // Smooth for plot readability
  dbfs_smooth = (1.0 - ALPHA) * dbfs_smooth + ALPHA * dbfs;

  // Optional rough SPL estimate using datasheet sensitivity:
  // 94 dB SPL -> -26 dBFS @ 1kHz  => SPL ~= dBFS + 120 (very approximate). :contentReference[oaicite:7]{index=7}
  double estSPL = dbfs_smooth + 120.0 + CAL_OFFSET_DB;

  // Serial Plotter format: "name:value, name:value\n" :contentReference[oaicite:8]{index=8}
  Serial.print("dBFS:");
  Serial.print(dbfs_smooth, 2);
  Serial.print(",estSPL:");
  Serial.println(estSPL, 2);

  delay(20); // ~50 updates/sec
}
