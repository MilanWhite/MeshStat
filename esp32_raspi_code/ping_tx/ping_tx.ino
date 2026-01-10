#include <Arduino.h>
#include <ELECHOUSE_CC1101_SRC_DRV.h>

static constexpr int PIN_SCK  = 18;
static constexpr int PIN_MISO = 19;
static constexpr int PIN_MOSI = 23;
static constexpr int PIN_CSN  = 5;

void setup() {
  Serial.begin(115200);
  delay(200);

  ELECHOUSE_cc1101.setSpiPin(PIN_SCK, PIN_MISO, PIN_MOSI, PIN_CSN);  // must be before Init()
  ELECHOUSE_cc1101.Init();

  ELECHOUSE_cc1101.setCCMode(1);        // internal packet mode
  ELECHOUSE_cc1101.setModulation(0);    // 0=2-FSK
  ELECHOUSE_cc1101.setMHZ(433.92);
  ELECHOUSE_cc1101.setCrc(0);           // disable CRC initially (easier bring-up)
  ELECHOUSE_cc1101.setPA(0);            // start low power (avoid close-range saturation)

  Serial.println("TX ready");
}

void loop() {
  byte msg[] = "PING";
  ELECHOUSE_cc1101.SendData(msg, sizeof(msg) - 1, 100);
  Serial.println("sent");
  delay(1000);
}
