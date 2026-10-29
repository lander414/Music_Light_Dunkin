/*
 * ============================================================================
 * DUNKIN' LIGHTS x MusicLightSync_ESP32 - 10x ESP32 16-Channel Master Firmware
 * ============================================================================
 * Synchronized with Mobile App Audio:
 *   "MP3 file - 2026 Christmas Lighting Songs.mp3" (STEP_MS = 180ms)
 *
 * Relay Channel Layout (from MusicLightSync_ESP32.ino):
 *   - Relay Board A (CH1 - CH8):  LED Strip Sets
 *   - Relay Board B (CH9 - CH16): Christmas Light Sets
 *   - Total per ESP32: 16 Relay Channels (160 Channels across 10 ESP32s)
 * ============================================================================
 */

#include <Arduino.h>
#include <WiFi.h>
#include <WebServer.h>
#include <ESPmDNS.h>
#include <string.h>

// ============================================================================
// 1. SET THIS BOARD'S UNIT NUMBER (1 to 10) BEFORE UPLOADING!
// ============================================================================
#define UNIT_ID 1   // <-- Change to 1, 2, 3, 4, 5, 6, 7, 8, 9, or 10

// ============================================================================
// 2. MOBILE PHONE HOTSPOT CREDENTIALS
// ============================================================================
const char* WIFI_SSID = "DunkinNetwork";
const char* WIFI_PASS = "dunkin123456";

// ============================================================================
// 3. DUAL 8-CHANNEL RELAY MODULES (16 CHANNELS: CH1-8 LED STRIPS, CH9-16 XMAS)
// ============================================================================
#define RELAY_ACTIVE_LOW true

// Set to true ONLY if you wired your relays to the raw example array in
// MusicLightSync_ESP32.ino ({13,14,16,17,21,22,25,26,27,32,33,2,4,12,15,0}).
// Leave false (default) for safe ESP32 DevKit 16-relay pins that avoid boot pins 0/12/15.
#define USE_RAW_SIMULATOR_EXAMPLE_PINS false

const int NUM_RELAYS = 16;

#if USE_RAW_SIMULATOR_EXAMPLE_PINS
const uint8_t RELAY_PINS[NUM_RELAYS] = {
  13, 14, 16, 17, 21, 22, 25, 26, // CH1-CH8 (LED strip sets)
  27, 32, 33, 2,  4,  12, 15, 0   // CH9-CH16 (Christmas sets)
};
#else
const uint8_t RELAY_PINS[NUM_RELAYS] = {
  // --- Relay Module #1 (CH1 - CH8: LED Strip Sets) ---
  13, // CH1
  14, // CH2
  27, // CH3
  26, // CH4
  25, // CH5
  33, // CH6
  32, // CH7
  16, // CH8

  // --- Relay Module #2 (CH9 - CH16: Christmas Sets) ---
  17, // CH9
  18, // CH10
  19, // CH11
  21, // CH12
  22, // CH13
  23, // CH14
  4,  // CH15
  5   // CH16
};
#endif

const int ONBOARD_LED_PIN = 2;

// Exact step timing from MusicLightSync_ESP32.ino
static const uint32_t STEP_MS = 180;

// Exact EFFECTS array from MusicLightSync_ESP32.ino
static const char* EFFECTS[16] = {
  "Party Alternating + Music Reactive", "Party Alternating + Music Reactive",
  "Party Alternating + Music Reactive", "Party Alternating + Music Reactive",
  "Party Alternating + Music Reactive", "Party Alternating + Music Reactive",
  "Party Alternating + Music Reactive", "Party Alternating + Music Reactive",
  "Party Alternating + Music Reactive", "Party Alternating + Music Reactive",
  "Party Alternating + Music Reactive", "Party Alternating + Music Reactive",
  "Party Alternating + Music Reactive", "Party Alternating + Music Reactive",
  "Party Alternating + Music Reactive", "Party Alternating + Music Reactive"
};

// ============================================================================
// 4. STATE VARIABLES
// ============================================================================
WebServer server(80);

bool isPlaying = false;
int activeUnitId = UNIT_ID;          // 1..10 (can also be assigned by Master App)
int activeTrack = 1;                 // 1 = Exact MusicLightSync_ESP32.ino, 2 = 10-Unit Multi-Effect, 3 = Soundwave+Twinkle, 4 = 10-Unit Cascade
unsigned long showStartTimeMs = 0;
uint16_t currentRelayMask = 0x0000;

bool isBlinking = false;
unsigned long blinkStartMs = 0;
bool isIdentifying = false;
unsigned long identifyStartMs = 0;
unsigned long lastReconnectAttemptMs = 0;

const char* getUnitRoleName(int unitId) {
  switch (unitId) {
    case 1:  return "Party Alternating + Music Reactive (MusicLightSync)";
    case 2:  return "Music Reactive + Soundwave Pulse";
    case 3:  return "Twinkle + Sparkle Playful";
    case 4:  return "Wave + Comet Flow Chase";
    case 5:  return "Outer-to-Middle Christmas Sweep";
    case 6:  return "LED Strip Chase (1-8) + Xmas Twinkle (9-16)";
    case 7:  return "LED Strip Party (1-8) + Xmas Soundwave (9-16)";
    case 8:  return "LED Strip Soundwave (1-8) + Xmas Sweep (9-16)";
    case 9:  return "Bass Flash + Beat Strobe Shuffle";
    case 10: return "Grand Finale Auto-DJ Mix (All Effects)";
    default: return "Party Alternating + Music Reactive";
  }
}

// ============================================================================
// 5. LOW-LEVEL 16-CHANNEL RELAY DRIVER (Matches MusicLightSync_ESP32.ino)
// ============================================================================
void relayWrite(uint8_t i, bool on) {
  if (i >= NUM_RELAYS) return;
  digitalWrite(RELAY_PINS[i], (on == RELAY_ACTIVE_LOW) ? LOW : HIGH);
}

void applyRelayMask(uint16_t mask) {
  currentRelayMask = mask;
  for (uint8_t i = 0; i < NUM_RELAYS; i++) {
    bool on = ((mask >> i) & 0x0001) != 0;
    relayWrite(i, on);
  }
}

void allRelaysOff() {
  applyRelayMask(0x0000);
}

// ============================================================================
// 6. EXACT MusicLightSync_ESP32.ino EFFECT GENERATOR
// ============================================================================
// Evaluates a single effect name string `e` for channel `i` (0..15) at `step`
bool evalEffectString(const char* e, uint8_t i, uint32_t step) {
  uint8_t local = i % 8;
  uint8_t side = i / 8;
  if (strstr(e, "Steady On")) return true;
  if (strstr(e, "Strobe") || strstr(e, "Bass Flash") || strstr(e, "Beat On/Off")) return (step % 2) == 0;
  if (strstr(e, "Alternating") || strstr(e, "Party") || strstr(e, "Beat Shuffle") || strstr(e, "DJ Mix"))
    return ((local % 2) == (step % 2)) || (step % 8 == 0);
  if (strstr(e, "Chase") || strstr(e, "Wave") || strstr(e, "Comet") || strstr(e, "Sweep") || strstr(e, "Flow"))
    return local == (step % 8);
  if (strstr(e, "Twinkle") || strstr(e, "Sparkle") || strstr(e, "Playful")) return ((step * 7 + i * 3) % 5) < 2;
  if (strstr(e, "Bass") || strstr(e, "Music Reactive") || strstr(e, "Fusion") || strstr(e, "Soundwave") || strstr(e, "Pulse"))
    return ((step + local + side) % 4) != 0;
  // Default sweep: left-to-right, then from both outer edges toward the middle.
  uint8_t pos = (step % 16 < 8) ? (step % 8) : (7 - (step % 8));
  return local == pos;
}

// Exact function from MusicLightSync_ESP32.ino:
bool effectWantsOn(uint8_t i, uint32_t step) {
  const char* e = EFFECTS[i];
  return evalEffectString(e, i, step);
}

// Returns the effect string for channel `i` (0..15) when running multi-unit mode
const char* getUnitEffectForChannel(int unitId, uint8_t i, uint32_t step) {
  uint8_t side = i / 8; // 0 = LED strip sets (CH1-8), 1 = Christmas sets (CH9-16)
  switch (unitId) {
    case 1:  return "Party Alternating + Music Reactive";
    case 2:  return "Music Reactive Soundwave Pulse";
    case 3:  return "Twinkle Sparkle Playful";
    case 4:  return "Wave Comet Chase Flow";
    case 5:  return "Default Outer-Middle";
    case 6:  return (side == 0) ? "Wave Chase" : "Twinkle Sparkle";
    case 7:  return (side == 0) ? "Party Alternating" : "Music Reactive Soundwave";
    case 8:  return (side == 0) ? "Music Reactive Pulse" : "Default Outer-Middle";
    case 9:  return ((step % 16) < 12) ? "Party Alternating" : "Bass Flash Strobe";
    case 10:
    default: {
      uint32_t phase = (step / 16) % 5;
      if (phase == 0) return "Party Alternating";
      if (phase == 1) return "Music Reactive Soundwave";
      if (phase == 2) return "Twinkle Sparkle";
      if (phase == 3) return "Wave Chase";
      return "Default Outer-Middle";
    }
  }
}

uint16_t computeMusicLightSyncMask(int unitId, int trackId, unsigned long elapsedMs) {
  // Base step number uses STEP_MS = 180ms from MusicLightSync_ESP32.ino
  uint32_t stepNumber = (elapsedMs / STEP_MS) + 1;

  // Track 4: 10-Unit Stadium Cascade shifts step by (unitId - 1)
  if (trackId == 4) {
    stepNumber += (uint32_t)(unitId - 1);
  }

  uint16_t mask = 0x0000;
  for (uint8_t i = 0; i < 16; ++i) {
    bool on = false;
    if (trackId == 1) {
      // Track 1: Exact MusicLightSync_ESP32.ino behavior (Party Alternating + Music Reactive)
      // Alternates between Party Alternating and Music Reactive on 16-beat musical phrases
      if (((stepNumber / 16) % 2) == 0) {
        on = effectWantsOn(i, stepNumber);
      } else {
        on = evalEffectString("Music Reactive", i, stepNumber);
      }
    } else if (trackId == 2) {
      // Track 2: Every ESP32 (Unit 1..10) plays its own MusicLightSync_ESP32 effect!
      const char* unitEffect = getUnitEffectForChannel(unitId, i, stepNumber);
      on = evalEffectString(unitEffect, i, stepNumber);
    } else if (trackId == 3) {
      // Track 3: LED Strips (1-8) Music Reactive + Christmas Sets (9-16) Twinkle Sparkle
      const char* eff = (i < 8) ? "Music Reactive" : "Twinkle Sparkle";
      on = evalEffectString(eff, i, stepNumber);
    } else {
      // Track 4: Phase-cascaded MusicLightSync Party Alternating + Sweep
      on = effectWantsOn(i, stepNumber);
    }

    if (on) {
      mask |= ((uint16_t)1 << i);
    }
  }
  return mask;
}

// ============================================================================
// 7. CHOREOGRAPHY ENGINE TICK (CALLED EVERY LOOP)
// ============================================================================
void updateLightShow() {
  // Handle Hardware Self-ID (/identify): holds CH<activeUnitId> ON for 3 seconds
  if (isIdentifying) {
    unsigned long idElapsed = millis() - identifyStartMs;
    if (idElapsed < 3000) {
      uint16_t idBit = ((uint16_t)1 << (activeUnitId - 1));
      applyRelayMask(idBit);
      digitalWrite(ONBOARD_LED_PIN, ((idElapsed / 150) % 2 == 0) ? HIGH : LOW);
    } else {
      digitalWrite(ONBOARD_LED_PIN, LOW);
      applyRelayMask(0x0000);
      isIdentifying = false;
    }
    return;
  }

  // Handle quick /blink test across all 16 channels non-blockingly
  if (isBlinking) {
    unsigned long blinkElapsed = millis() - blinkStartMs;
    if (blinkElapsed < 150) {
      digitalWrite(ONBOARD_LED_PIN, HIGH);
      applyRelayMask(0x00FF); // LED Strip Sets (CH1-8) ON
    } else if (blinkElapsed < 300) {
      digitalWrite(ONBOARD_LED_PIN, LOW);
      applyRelayMask(0xFF00); // Christmas Sets (CH9-16) ON
    } else if (blinkElapsed < 450) {
      digitalWrite(ONBOARD_LED_PIN, HIGH);
      applyRelayMask(0xFFFF); // All 16 Channels ON
    } else {
      digitalWrite(ONBOARD_LED_PIN, LOW);
      applyRelayMask(0x0000);
      isBlinking = false;
    }
    return;
  }

  if (!isPlaying) {
    return;
  }

  unsigned long elapsed = millis() - showStartTimeMs;
  uint16_t nextMask = computeMusicLightSyncMask(activeUnitId, activeTrack, elapsed);
  if (nextMask != currentRelayMask) {
    applyRelayMask(nextMask);
  }
}

// ============================================================================
// 8. HTTP SERVER API HANDLERS (CORS ENABLED FOR MOBILE MASTER APP)
// ============================================================================
void sendCorsHeaders() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  server.sendHeader("Access-Control-Allow-Headers", "Content-Type");
}

String buildStatusJson(const char* statusLabel) {
  String unitName = "UNIT-";
  if (activeUnitId < 10) unitName += "0";
  unitName += String(activeUnitId);

  String hostName = "Dunkin-" + unitName;

  String relaysArr = "[";
  for (int i = 0; i < NUM_RELAYS; i++) {
    relaysArr += ((currentRelayMask >> i) & 0x0001) ? "1" : "0";
    if (i < NUM_RELAYS - 1) relaysArr += ",";
  }
  relaysArr += "]";

  String json = "{";
  json += "\"ok\":true,";
  json += "\"status\":\"" + String(statusLabel) + "\",";
  json += "\"unitId\":" + String(activeUnitId) + ",";
  json += "\"selfIdRelay\":" + String(activeUnitId) + ",";
  json += "\"id\":\"" + unitName + "\",";
  json += "\"name\":\"" + unitName + "\",";
  json += "\"hostname\":\"" + hostName + "\",";
  json += "\"role\":\"" + String(getUnitRoleName(activeUnitId)) + "\",";
  json += "\"playing\":" + String(isPlaying ? "true" : "false") + ",";
  json += "\"track\":" + String(activeTrack) + ",";
  json += "\"stepMs\":" + String(STEP_MS) + ",";
  json += "\"relayCount\":" + String(NUM_RELAYS) + ",";
  json += "\"relayMask\":" + String(currentRelayMask) + ",";
  json += "\"relays\":" + relaysArr + ",";
  json += "\"mac\":\"" + WiFi.macAddress() + "\",";
  json += "\"ip\":\"" + WiFi.localIP().toString() + "\"";
  json += "}";
  return json;
}

// GET /status
void handleStatus() {
  sendCorsHeaders();
  if (server.hasArg("unit")) {
    int u = server.arg("unit").toInt();
    if (u >= 1 && u <= 10) activeUnitId = u;
  }
  if (!isPlaying && !isIdentifying) {
    isBlinking = true;
    blinkStartMs = millis();
  }
  server.send(200, "application/json", buildStatusJson(isPlaying ? "PLAYING" : "ONLINE"));
}

// GET /play?track=1&unit=1&offsetMs=0
void handlePlay() {
  sendCorsHeaders();
  if (server.hasArg("unit")) {
    int u = server.arg("unit").toInt();
    if (u >= 1 && u <= 10) activeUnitId = u;
  }
  if (server.hasArg("track")) {
    activeTrack = server.arg("track").toInt();
  } else {
    activeTrack = 1;
  }
  unsigned long offsetMs = 0;
  if (server.hasArg("offsetMs")) {
    offsetMs = (unsigned long)server.arg("offsetMs").toInt();
  }

  isBlinking = false;
  isIdentifying = false;
  isPlaying = true;
  showStartTimeMs = millis() - offsetMs;

  uint16_t initialMask = computeMusicLightSyncMask(activeUnitId, activeTrack, offsetMs);
  applyRelayMask(initialMask);
  digitalWrite(ONBOARD_LED_PIN, HIGH);

  server.send(200, "application/json", buildStatusJson("PLAYING"));
}

// GET /stop
void handleStop() {
  sendCorsHeaders();
  isPlaying = false;
  isBlinking = false;
  isIdentifying = false;
  allRelaysOff();
  digitalWrite(ONBOARD_LED_PIN, LOW);

  server.send(200, "application/json", buildStatusJson("STOPPED"));
}

// GET /blink
void handleBlink() {
  sendCorsHeaders();
  isPlaying = false;
  isIdentifying = false;
  isBlinking = true;
  blinkStartMs = millis();

  server.send(200, "application/json", buildStatusJson("BLINK"));
}

// GET /identify
void handleIdentify() {
  sendCorsHeaders();
  if (server.hasArg("unit")) {
    int u = server.arg("unit").toInt();
    if (u >= 1 && u <= 10) activeUnitId = u;
  }
  isPlaying = false;
  isBlinking = false;
  isIdentifying = true;
  identifyStartMs = millis();

  uint16_t idBit = ((uint16_t)1 << (activeUnitId - 1));
  applyRelayMask(idBit);
  digitalWrite(ONBOARD_LED_PIN, HIGH);

  server.send(200, "application/json", buildStatusJson("IDENTIFYING"));
}

// GET /relay?ch=1..16&state=0|1  OR  GET /relay?mask=0..65535
void handleRelayManual() {
  sendCorsHeaders();
  isPlaying = false;
  isBlinking = false;
  isIdentifying = false;

  if (server.hasArg("mask")) {
    uint16_t mask = (uint16_t)server.arg("mask").toInt();
    applyRelayMask(mask);
  } else if (server.hasArg("ch")) {
    int ch = server.arg("ch").toInt(); // 1..16
    int state = server.hasArg("state") ? server.arg("state").toInt() : 1;
    if (ch >= 1 && ch <= NUM_RELAYS) {
      uint16_t mask = currentRelayMask;
      uint16_t bit = ((uint16_t)1 << (ch - 1));
      if (state) {
        mask |= bit;
      } else {
        mask &= ~bit;
      }
      applyRelayMask(mask);
    }
  }

  server.send(200, "application/json", buildStatusJson("MANUAL_RELAY"));
}

void handleOptions() {
  sendCorsHeaders();
  server.send(204);
}

// ============================================================================
// 9. ARDUINO SETUP & LOOP
// ============================================================================
void runBootHardwareSelfId() {
  uint16_t selfIdMask = ((uint16_t)1 << (UNIT_ID - 1));
  applyRelayMask(selfIdMask);

  for (int i = 0; i < UNIT_ID; i++) {
    digitalWrite(ONBOARD_LED_PIN, HIGH);
    delay(120);
    digitalWrite(ONBOARD_LED_PIN, LOW);
    delay(120);
  }

  delay(400);
  allRelaysOff();
}

void flashOnboardLedTwice() {
  for (int i = 0; i < 2; i++) {
    digitalWrite(ONBOARD_LED_PIN, HIGH);
    delay(180);
    digitalWrite(ONBOARD_LED_PIN, LOW);
    delay(180);
  }
}

void setup() {
  Serial.begin(115200);
  delay(200);

  pinMode(ONBOARD_LED_PIN, OUTPUT);
  digitalWrite(ONBOARD_LED_PIN, LOW);

  for (uint8_t i = 0; i < NUM_RELAYS; ++i) {
    pinMode(RELAY_PINS[i], OUTPUT);
    relayWrite(i, false);
  }
  allRelaysOff();

  Serial.println();
  Serial.println("==========================================================");
  Serial.printf(" DUNKIN' x MusicLightSync_ESP32 (16-CH) UNIT #%02d\n", UNIT_ID);
  Serial.printf(" STEP_MS: %d ms | Role: %s\n", STEP_MS, getUnitRoleName(UNIT_ID));
  Serial.println("==========================================================");

  runBootHardwareSelfId();

  WiFi.mode(WIFI_STA);
  String macStr = WiFi.macAddress();
  macStr.replace(":", "");
  String shortMac = macStr.length() >= 4 ? macStr.substring(macStr.length() - 4) : macStr;
  char hostName[32];
  snprintf(hostName, sizeof(hostName), "Dunkin-U%02d-%s", UNIT_ID, shortMac.c_str());

  WiFi.setHostname(hostName);
  WiFi.setAutoReconnect(true);
  WiFi.persistent(false);
  WiFi.setTxPower(WIFI_POWER_15dBm);
  WiFi.setSleep(false);
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  Serial.printf("Connecting to hotspot \"%s\" as \"%s\" ", WIFI_SSID, hostName);
  while (WiFi.status() != WL_CONNECTED) {
    delay(400);
    Serial.print(".");
  }
  Serial.println("\nCONNECTED!");
  Serial.print("IP Address: ");
  Serial.println(WiFi.localIP());

  char mdnsName[32];
  snprintf(mdnsName, sizeof(mdnsName), "dunkin-u%02d-%s", UNIT_ID, shortMac.c_str());
  if (MDNS.begin(mdnsName)) {
    Serial.printf("mDNS responder started: http://%s.local\n", mdnsName);
  }

  server.on("/status", HTTP_GET, handleStatus);
  server.on("/play", HTTP_GET, handlePlay);
  server.on("/stop", HTTP_GET, handleStop);
  server.on("/blink", HTTP_GET, handleBlink);
  server.on("/identify", HTTP_GET, handleIdentify);
  server.on("/relay", HTTP_GET, handleRelayManual);

  server.on("/status", HTTP_OPTIONS, handleOptions);
  server.on("/play", HTTP_OPTIONS, handleOptions);
  server.on("/stop", HTTP_OPTIONS, handleOptions);
  server.on("/blink", HTTP_OPTIONS, handleOptions);
  server.on("/identify", HTTP_OPTIONS, handleOptions);
  server.on("/relay", HTTP_OPTIONS, handleOptions);

  server.begin();
  Serial.println("Music Light Sync HTTP Server started on port 80.");

  flashOnboardLedTwice();
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    unsigned long now = millis();
    if (now - lastReconnectAttemptMs > 8000) {
      lastReconnectAttemptMs = now;
      isPlaying = false;
      allRelaysOff();
      WiFi.reconnect();
    }
    delay(50);
    return;
  }

  server.handleClient();
  updateLightShow();
}
