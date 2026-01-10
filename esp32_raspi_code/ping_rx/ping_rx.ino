#include <Arduino.h>
#include <ELECHOUSE_CC1101_SRC_DRV.h>

static constexpr int PIN_SCK  = 18;
static constexpr int PIN_MISO = 19;
static constexpr int PIN_MOSI = 23;
static constexpr int PIN_CSN  = 5;

byte buf[64];

void setup() {
  Serial.begin(115200);
  delay(200);

  ELECHOUSE_cc1101.setSpiPin(PIN_SCK, PIN_MISO, PIN_MOSI, PIN_CSN);
  ELECHOUSE_cc1101.Init();

  ELECHOUSE_cc1101.setCCMode(1);
  ELECHOUSE_cc1101.setModulation(0);
  ELECHOUSE_cc1101.setMHZ(433.92);
  ELECHOUSE_cc1101.setCrc(0);
  ELECHOUSE_cc1101.setPA(0);

  ELECHOUSE_cc1101.SetRx();
  Serial.println("RX ready");
}

void loop() {
  if (ELECHOUSE_cc1101.CheckRxFifo(100)) {
    int len = ELECHOUSE_cc1101.ReceiveData(buf);
    if (len > 0 && len < (int)sizeof(buf)) {
      buf[len] = '\0';
      Serial.print("rx: ");
      Serial.println((char*)buf);
      Serial.print("rssi: ");
      Serial.println(ELECHOUSE_cc1101.getRssi());
      Serial.print("lqi: ");
      Serial.println(ELECHOUSE_cc1101.getLqi());
    }
  }
}
