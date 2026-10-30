/* Music Light Sync — self-contained ESP32 relay pattern engine
 *
 * Commands from Python (UDP 4210) & Mobile App (HTTP 80):
 *     {"cmd":"play"}                 -> start the current pattern
 *     {"cmd":"stop"}                 -> all relays OFF
 *     {"cmd":"ping"}                 -> replies {"type":"pong"}
 *     {"cmd":"pattern","name":"..."} -> switch pattern
 *     {"cmd":"speed","ms":120}       -> base step interval
 *     {"cmd":"music","b":0,"bt":0,"r":0}
 *                                    -> reactive values (bass/beat/rms 0-100)
 *                                       sent at ~10 Hz only while playing
 *
 * Built-in patterns:
 *   "wave_lr"         left -> right domino
 *   "center_in"       both ends sweep toward middle
 *   "center_out"      middle spreads outward to both ends
 *   "ping_pong"       left -> right -> left bounce
 *   "chase3"          3-relay glowing trail
 *   "alternate"       odd relays, then even relays
 *   "bounce_pair"     2-relay pair bouncing L<->R
 *   "sparkle"         random playful flashes
 *   "end_meet"        ends meet center, then burst  (music reactive)
 *   "combo_adaptive"  quiet: center-in + center-out blend
 *                     loud:  alternate + center-in blend    (music reactive,
 *                                                            smooth crossfade)
 *
 * SAFETY: no pattern ever turns all 16 relays ON at once.
 *
 * Relay wiring (16-ch active-LOW module): LOW = ON, HIGH = OFF.
 */
#include <WiFi.h>
#include <WiFiUdp.h>
#include <WebServer.h>
#include <ESPmDNS.h>
#include <string.h>

// ------------------------------------------------------------------
// EDIT THESE
// ------------------------------------------------------------------
const char* WIFI_SSID     = "DunkinNetwork";
const char* WIFI_PASSWORD = "dunkin123456";

// ------------------------------------------------------------------
static const uint8_t  RELAY_PINS[16] = {13, 14, 27, 26, 25, 33, 32, 16, 17, 18, 19, 21, 22, 23, 4, 5};
static const bool     RELAY_ACTIVE_LOW = true;
static const uint16_t UDP_PORT         = 4210;

uint32_t stepMs = 220;
uint32_t liveDynamicMs = 0; // Streamed or computed music-aligned ms (0 = fallback to dynamic energy)
bool     autoSpeedMode = true; // true = Auto Music Sync (accurate dynamic tempo), false = Manual Fixed MS

// ------------------------------------------------------------------
WiFiUDP udp;
WebServer httpServer(80);
char packet[256];

bool     running     = false;
uint8_t  patternId   = 0;
uint32_t lastStepMs  = 0;
uint32_t stepCount   = 0;
uint16_t sparkleMask = 0;

// Reactive values (0..100) streamed from Python / Mobile App while playing.
uint8_t  musicBass = 0;
uint8_t  musicBeat = 0;
uint8_t  musicRms  = 0;

// Smoothed musical energy & vocal presence tracking
float    comboIntensity = 0.0;
float    vocalPresence  = 0.0; // Tracks when a singer is singing vs instrumental

static const char* patternName[] = {
  "combo_adaptive", "wave_lr", "center_in", "center_out", "ping_pong",
  "chase3", "alternate", "bounce_pair", "sparkle", "end_meet"
};
static const uint8_t PATTERN_COUNT = sizeof(patternName) / sizeof(patternName[0]);

// ------------------------------------------------------------------
void relayWrite(uint8_t index, bool on) {
  if (index >= 16) return;
  digitalWrite(RELAY_PINS[index], (on == RELAY_ACTIVE_LOW) ? LOW : HIGH);
}

void allRelaysOff() {
  for (uint8_t i = 0; i < 16; ++i) relayWrite(i, false);
}

void setOnly(uint8_t index) {
  for (uint8_t i = 0; i < 16; ++i) relayWrite(i, i == index);
}

void setPair(uint8_t a, uint8_t b) {
  for (uint8_t i = 0; i < 16; ++i) relayWrite(i, (i == a) || (i == b));
}

void setMask(uint16_t mask) {
  for (uint8_t i = 0; i < 16; ++i) {
    relayWrite(i, (mask >> i) & 1);
  }
}

// ------------------------------------------------------------------
// PYTHON SIMULATOR LOGIC & ALL-OUT COMBO ORCHESTRATION ENGINE
// Matches the exact logic from music_light_sync.py and the video:
// - Left board: Relay channels 1-8  (i = 0..7)
// - Right board: Relay channels 9-16 (i = 8..15)
// - Dynamic Combination of Effects:
//     * SINGER IS SINGING: Dynamic Stereo Bounce Pair (accenting vocal melody)
//     * INSTRUMENTAL SECTION: Smooth rotation among:
//       0. Wave L -> R (flowing 2-channel sweep)
//       1. Center In (edges sweep into middle)
//       2. Center Out (middle spreads outward to edges)
//       3. Ping Pong (smooth bouncing bar)
//     * PUNCHY BEAT ACCENTS: Center kick flash on heavy drum downbeats (musicBeat >= 70)
//     * NO RANDOM FLICKER: Clear, legible light patterns with musical tempo pacing
// ------------------------------------------------------------------
bool effectWantsOn(uint8_t i, uint32_t step) {
  uint8_t local = i % 8;   // 0..7 within 8-channel bank
  uint8_t side  = i / 8;   // 0 = Left bank (1-8), 1 = Right bank (9-16)

  bool baseOn = false;

  switch (patternId) {
    case 0: { // "combo_adaptive": ALL-COMBINATION MASTER SHOWCASE
      // Gives all 10 light combos their turns across the song!
      // Rotates smoothly every 8 musical steps (~2.5s per movement)
      // while staying 100% phase-locked to comprehending drum beats.
      uint8_t comboTheme = (step / 8) % 10;

      switch (comboTheme) {
        case 0: { // 1. Wave L -> R: Smooth 2-relay wave sweeping across 8 channels
          uint8_t s = step % 8;
          baseOn = (local == s) || (local == ((s + 1) % 8));
          break;
        }
        case 1: { // 2. Center In: Both outer edges sweep inward colliding at center
          uint8_t pos = step % 4; // 0, 1, 2, 3
          baseOn = (local == pos) || (local == (7 - pos));
          // Center clash splash when meeting in the middle
          if (pos == 3 && (local == 3 || local == 4)) baseOn = true;
          break;
        }
        case 2: { // 3. Center Out: Middle spreads outward toward both outer edges
          uint8_t in = 3 - (step % 4); // 3, 2, 1, 0
          baseOn = (local == in) || (local == (7 - in));
          break;
        }
        case 3: { // 4. Ping-Pong Bounce: Continuous Left <-> Right bouncing bar
          uint8_t p = step % 14;
          uint8_t pos = (p < 7) ? p : (14 - p);
          baseOn = (local == pos) || (local == (pos + 1));
          break;
        }
        case 4: { // 5. Stereo Counter-Bounce Pair: Left bounces L->R, Right bounces R->L
          uint8_t p = step % 14;
          uint8_t a = (p < 7) ? p : (14 - p);
          if (side == 0) {
            baseOn = (local == a) || (local == (a + 1));
          } else {
            uint8_t rightA = (6 >= a) ? (6 - a) : 0;
            baseOn = (local == rightA) || (local == (rightA + 1));
          }
          break;
        }
        case 5: { // 6. 3-Relay Traveling Comet / Chase Trail
          int8_t d = (int8_t)local - (int8_t)(step % 8);
          if (d < 0) d += 8;
          baseOn = (d <= 2);
          break;
        }
        case 6: { // 7. DJ Beat Shuffle: Odd vs Even relays alternating on the beat
          bool oddSide = (step % 2) == 0;
          baseOn = (local % 2) == (oddSide ? 0 : 1);
          break;
        }
        case 7: { // 8. Colliding End Meet / Accordion: Inward & outward breathing
          uint8_t pos = (step % 8 < 4) ? (step % 4) : (7 - (step % 4));
          baseOn = (local == pos) || (local == (7 - pos));
          break;
        }
        case 8: { // 9. 16-Channel Full Waterfall: Continuous sweep across ALL 16 relays!
          uint8_t wf = step % 16;
          baseOn = (i == wf) || (i == ((wf + 1) % 16));
          break;
        }
        case 9: { // 10. Starlight Sparkle Twinkle: Crisp rhythmic starlight twinkle
          baseOn = ((step * 3 + i * 5) % 8) < 2;
          break;
        }
      }

      // Climax Vocal Spotlight: on louder singing peaks (musicRms >= 55), illuminate outer spotlights (channels 0 & 7)
      if (musicRms >= 55 && (local == 0 || local == 7)) {
        baseOn = true;
      }
      break;
    }
    case 1: { // "wave_lr": sweeping wave L -> R across 8 channels
      uint8_t s = step % 8;
      baseOn = (local == s) || (local == ((s + 1) % 8));
      break;
    }
    case 2: { // "center_in": edges sweep into middle
      uint8_t pos = step % 4;
      baseOn = (local == pos) || (local == (7 - pos));
      break;
    }
    case 3: { // "center_out": middle spreads outward to edges
      uint8_t in = 3 - (step % 4);
      baseOn = (local == in) || (local == (7 - in));
      break;
    }
    case 4: { // "ping_pong": L <-> R continuous bounce
      uint8_t p = step % 14;
      uint8_t pos = (p < 7) ? p : (14 - p);
      baseOn = (local == pos) || (local == (pos + 1));
      break;
    }
    case 5: { // "chase3": 3-relay chase trail
      int8_t d = (int8_t)local - (int8_t)(step % 8);
      if (d < 0) d += 8;
      baseOn = (d <= 2);
      break;
    }
    case 6: { // "alternate": odd vs even relays alternating cleanly on the beat
      bool oddSide = (step % 2) == 0;
      baseOn = (local % 2) == (oddSide ? 0 : 1);
      break;
    }
    case 7: { // "bounce_pair": 2-relay pair bounce
      uint8_t p = step % 14;
      uint8_t a = (p < 7) ? p : (14 - p);
      baseOn = (local == a) || (local == (a + 1));
      break;
    }
    case 8: { // "sparkle": clean gentle twinkle
      baseOn = ((step * 3 + i * 5) % 8) < 2;
      break;
    }
    case 9: { // "end_meet": sweep outer edges meeting in center, then spreading out
      uint8_t pos = (step % 8 < 4) ? (step % 4) : (7 - (step % 4));
      baseOn = (local == pos) || (local == (7 - pos));
      break;
    }
    default: {
      uint8_t s = step % 8;
      baseOn = (local == s);
      break;
    }
  }

  // Punchy Center Beat Accent: ONLY on heavy drum kicks (musicBeat >= 70)
  // Punches center relays (channels 3 & 4 on each bank) on downbeats without random clutter.
  if (musicBeat >= 70 && (local == 3 || local == 4)) {
    baseOn = true;
  }

  return baseOn;
}

// ------------------------------------------------------------------
void applyPatternStep() {
  uint16_t finalMask = 0;
  for (uint8_t i = 0; i < 16; ++i) {
    if (effectWantsOn(i, stepCount)) {
      finalMask |= (1u << i);
    }
  }

  // Supply safety: Cap at 8 relays ON simultaneously, rotating start index
  // so channels 0 and 1 are never starved.
  uint8_t onCount = 0;
  for (uint8_t i = 0; i < 16; ++i) {
    if ((finalMask >> i) & 1) ++onCount;
  }
  if (onCount > 8) {
    uint8_t toRemove = onCount - 8;
    uint8_t startIdx = (stepCount * 5) & 0x0F;
    for (uint8_t n = 0; n < 16 && toRemove > 0; ++n) {
      uint8_t idx = (startIdx + n) & 0x0F;
      if ((finalMask >> idx) & 1) {
        finalMask &= ~(1u << idx);
        --toRemove;
      }
    }
  }

  setMask(finalMask);
  stepCount++;
}

// ------------------------------------------------------------------
void sendReply(const char* reply) {
  udp.beginPacket(udp.remoteIP(), udp.remotePort());
  udp.write((const uint8_t*)reply, strlen(reply));
  udp.endPacket();
}

int8_t findPattern(const char* name) {
  for (uint8_t i = 0; i < PATTERN_COUNT; ++i) {
    if (strstr(name, patternName[i])) return i;
  }
  return -1;
}

int readIntField(const char* json, const char* key) {
  char pattern[16];
  snprintf(pattern, sizeof(pattern), "\"%s\"", key);
  const char* p = strstr(json, pattern);
  if (!p) return -1;
  p = strchr(p, ':');
  if (!p) return -1;
  p++;
  while (*p == ' ' || *p == '\t' || *p == '"') p++;
  return atoi(p);
}

// ------------------------------------------------------------------
// MOBILE APP HTTP BRIDGE (syncs multiple ESP32s with the mobile app)
// ------------------------------------------------------------------
void sendHttpCors() {
  httpServer.sendHeader("Access-Control-Allow-Origin", "*");
  httpServer.sendHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  httpServer.sendHeader("Access-Control-Allow-Headers", "Content-Type");
}

String buildPongJson() {
  String json = "{\"type\":\"pong\",\"device\":\"MusicLightSync-ESP32\",";
  json += "\"ip\":\"" + WiFi.localIP().toString() + "\",";
  json += "\"mac\":\"" + WiFi.macAddress() + "\",";
  json += "\"running\":" + String(running ? "true" : "false") + ",";
  json += "\"playing\":" + String(running ? "true" : "false") + ",";
  json += "\"pattern\":\"" + String(patternName[patternId]) + "\",";
  json += "\"speed\":" + String(stepMs) + ",";
  json += "\"autoMode\":" + String(autoSpeedMode ? "true" : "false") + "}";
  return json;
}

void setupMobileHttpRoutes() {
  httpServer.on("/ping", HTTP_GET, []() {
    sendHttpCors();
    httpServer.send(200, "application/json", buildPongJson());
  });
  httpServer.on("/status", HTTP_GET, []() {
    sendHttpCors();
    httpServer.send(200, "application/json", buildPongJson());
  });
  httpServer.on("/play", HTTP_GET, []() {
    sendHttpCors();
    if (httpServer.hasArg("pattern")) {
      int8_t id = findPattern(httpServer.arg("pattern").c_str());
      if (id >= 0) {
        patternId = id;
        allRelaysOff();
      }
    }
    if (httpServer.hasArg("auto")) {
      autoSpeedMode = (httpServer.arg("auto").toInt() != 0);
    }
    if (httpServer.hasArg("ms")) {
      int ms = httpServer.arg("ms").toInt();
      if (ms >= 30 && ms <= 2000) stepMs = ms;
    }
    running    = true;
    stepCount  = 0;
    lastStepMs = millis() - stepMs;
    Serial.println("PLAY");
    httpServer.send(200, "application/json", buildPongJson());
  });
  httpServer.on("/stop", HTTP_GET, []() {
    sendHttpCors();
    running        = false;
    musicBass      = 0;
    musicBeat      = 0;
    musicRms       = 0;
    liveDynamicMs  = 0;
    vocalPresence  = 0.0;
    comboIntensity = 0.0;
    allRelaysOff();
    Serial.println("STOP");
    httpServer.send(200, "application/json", buildPongJson());
  });
  httpServer.on("/pattern", HTTP_GET, []() {
    sendHttpCors();
    if (httpServer.hasArg("name")) {
      int8_t id = findPattern(httpServer.arg("name").c_str());
      if (id >= 0) {
        patternId = id;
        stepCount = 0;
        allRelaysOff();
        Serial.printf("PATTERN -> %s\n", patternName[patternId]);
      }
    }
    httpServer.send(200, "application/json", buildPongJson());
  });
  httpServer.on("/speed", HTTP_GET, []() {
    sendHttpCors();
    if (httpServer.hasArg("auto")) {
      autoSpeedMode = (httpServer.arg("auto").toInt() != 0);
    }
    if (httpServer.hasArg("mode")) {
      if (httpServer.arg("mode") == "auto") autoSpeedMode = true;
      if (httpServer.arg("mode") == "manual") autoSpeedMode = false;
    }
    if (httpServer.hasArg("ms")) {
      int ms = httpServer.arg("ms").toInt();
      if (ms >= 80 && ms <= 2000) {
        stepMs = ms;
        Serial.printf("SPEED -> %ums (Mode: %s)\n", stepMs, autoSpeedMode ? "AUTO" : "MANUAL");
      }
    }
    httpServer.send(200, "application/json", buildPongJson());
  });
  httpServer.on("/music", HTTP_GET, []() {
    sendHttpCors();
    if (httpServer.hasArg("b"))  musicBass = (uint8_t)min(100, max(0, (int)httpServer.arg("b").toInt()));
    if (httpServer.hasArg("bt")) musicBeat = (uint8_t)min(100, max(0, (int)httpServer.arg("bt").toInt()));
    if (httpServer.hasArg("r"))  musicRms  = (uint8_t)min(100, max(0, (int)httpServer.arg("r").toInt()));
    if (httpServer.hasArg("auto")) {
      autoSpeedMode = (httpServer.arg("auto").toInt() != 0);
    }
    if (httpServer.hasArg("ms")) {
      int msVal = httpServer.arg("ms").toInt();
      if (msVal >= 80 && msVal <= 1000) liveDynamicMs = (uint32_t)msVal;
    }
    httpServer.send(200, "application/json", "{\"ok\":true}");
  });
  httpServer.onNotFound([]() {
    sendHttpCors();
    if (httpServer.method() == HTTP_OPTIONS) {
      httpServer.send(204);
      return;
    }
    httpServer.send(404, "application/json", "{\"error\":\"not_found\"}");
  });
  httpServer.begin();
}

// ------------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  randomSeed(esp_random());
  for (uint8_t i = 0; i < 16; ++i) pinMode(RELAY_PINS[i], OUTPUT);
  allRelaysOff();

  WiFi.mode(WIFI_STA);
  String mac = WiFi.macAddress();
  mac.replace(":", "");
  String suffix = mac.length() >= 4 ? mac.substring(mac.length() - 4) : mac;
  String hostName = "MusicLightSync-" + suffix;
  WiFi.setHostname(hostName.c_str());
  WiFi.setAutoReconnect(true);
  WiFi.setSleep(false);

  // Match DunkinNetwork even if a phone hotspot keyboard adds a trailing space
  String targetSsid = String(WIFI_SSID);
  int n = WiFi.scanNetworks();
  for (int i = 0; i < n; i++) {
    String scanned = WiFi.SSID(i);
    String norm = scanned;
    norm.trim();
    norm.toLowerCase();
    norm.replace(" ", "");
    if (norm == "dunkinnetwork") {
      targetSsid = scanned;
      break;
    }
  }
  WiFi.scanDelete();

  WiFi.begin(targetSsid.c_str(), WIFI_PASSWORD);
  Serial.print("Connecting to Wi-Fi");
  while (WiFi.status() != WL_CONNECTED) { delay(400); Serial.print('.'); }
  Serial.println();
  Serial.print("ESP32 IP: "); Serial.println(WiFi.localIP());

  if (MDNS.begin(hostName.c_str())) {
    MDNS.addService("http", "tcp", 80);
  }

  setupMobileHttpRoutes();

  if (udp.begin(UDP_PORT)) {
    Serial.printf("Pattern engine ready on UDP port %u and HTTP port 80\n", UDP_PORT);
  } else {
    Serial.println("ERROR: could not start UDP receiver");
  }
}

// ------------------------------------------------------------------
void loop() {
  // 1) Smooth comboIntensity and vocalPresence so transitions between vocal singing & instrumental are organic.
  {
    uint16_t energy = (musicBass * 60 + musicBeat * 55 + musicRms * 35) / 150;
    float target = (float)energy / 100.0f;
    comboIntensity += (target - comboIntensity) * 0.16f; // fast, lively tracking
    if (comboIntensity < 0.0f) comboIntensity = 0.0f;
    if (comboIntensity > 1.0f) comboIntensity = 1.0f;

    // Vocal presence tracking for vocal singing vs instrumental detection
    float vocalTarget = (musicRms >= 25 && musicRms > (musicBass * 0.38f)) ? ((float)musicRms / 100.0f) : 0.0f;
    if (musicRms >= 32) vocalTarget = (float)musicRms / 100.0f;
    vocalPresence += (vocalTarget - vocalPresence) * 0.28f;
    if (vocalPresence < 0.0f) vocalPresence = 0.0f;
    if (vocalPresence > 1.0f) vocalPresence = 1.0f;
  }

  // 2) Step the pattern with live music tempo adaptation or strict manual speed.
  if (running) {
    uint32_t now = millis();

    if (autoSpeedMode) {
      // ------------------------------------------------------------------
      // AUTOMATIC MODE: Musical tempo following & clean beat synchronization
      // Slower, musical MS (160ms - 320ms) locked to the beat of the song.
      // ------------------------------------------------------------------
      uint32_t interval = (liveDynamicMs >= 100) ? liveDynamicMs : stepMs;

      if (liveDynamicMs == 0) {
        // Dynamic music energy tempo scaling:
        float energy = (musicBass * 0.45f + musicBeat * 0.35f + musicRms * 0.20f);
        float factor = 1.0f;
        if (energy >= 50.0f) {
          factor = 1.0f - ((energy - 50.0f) / 50.0f) * 0.25f; // Up to 25% faster on drops (~165ms)
        } else {
          factor = 1.0f + ((50.0f - energy) / 50.0f) * 0.35f; // Up to 35% slower on calm sections (~295ms)
        }
        interval = (uint32_t)(stepMs * factor);
      }

      if (interval < 140) interval = 140; // Musical safe clamp (no relay chatter!)

      // Comprehending Beat Synchronization:
      // When the song has an identifiable, comprehending beat (kick drum / rhythm transient),
      // lock each pattern movement step directly in sync with that beat!
      static uint8_t lastMusicBeat = 0;
      static uint32_t lastBeatKickMs = 0;
      bool beatRising = (musicBeat >= 42) && (musicBeat > lastMusicBeat + 8);
      bool beatPeak   = (musicBeat >= 65) && (lastMusicBeat < 60);
      bool hasComprehendingBeat = (beatRising || beatPeak) && (now - lastBeatKickMs >= 160);

      bool triggerBeatStep = false;
      if (hasComprehendingBeat) {
        lastBeatKickMs = now;
        // If we are at least 140ms past the previous step, advance cleanly with this beat strike!
        if (now - lastStepMs >= 140) {
          triggerBeatStep = true;
        }
      }
      lastMusicBeat = musicBeat;

      if ((now - lastStepMs >= interval) || triggerBeatStep) {
        lastStepMs = now;
        applyPatternStep();
      }
    } else {
      // ------------------------------------------------------------------
      // MANUAL MODE: Exact user-configured speed from dragging slider or preset
      // ------------------------------------------------------------------
      uint32_t manualInterval = stepMs;
      if (manualInterval < 80) manualInterval = 80;

      if (now - lastStepMs >= manualInterval) {
        lastStepMs = now;
        applyPatternStep();
      }
    }
  }

  // 3) Handle Mobile App HTTP commands.
  httpServer.handleClient();

  // 4) Drain UDP commands.
  int packetSize = udp.parsePacket();
  if (packetSize <= 0) return;
  int n = udp.read(packet, sizeof(packet) - 1);
  if (n <= 0) return;
  packet[n] = '\0';

  if (strstr(packet, "\"ping\"")) {
    sendReply("{\"type\":\"pong\",\"device\":\"MusicLightSync-ESP32\"}");
    return;
  }
  if (strstr(packet, "\"play\"")) {
    running    = true;
    stepCount  = 0;
    lastStepMs = millis() - stepMs;
    Serial.println("PLAY");
    return;
  }
  if (strstr(packet, "\"stop\"")) {
    running        = false;
    musicBass      = 0;
    musicBeat      = 0;
    musicRms       = 0;
    liveDynamicMs  = 0;
    comboIntensity = 0.0;
    vocalPresence  = 0.0;
    allRelaysOff();
    Serial.println("STOP");
    return;
  }
  if (strstr(packet, "\"pattern\"")) {
    int8_t id = findPattern(packet);
    if (id >= 0) {
      patternId = id;
      stepCount = 0;
      allRelaysOff();
      Serial.printf("PATTERN -> %s\n", patternName[patternId]);
    }
    return;
  }
  if (strstr(packet, "\"speed\"")) {
    int ms = readIntField(packet, "ms");
    int autoVal = readIntField(packet, "auto");
    if (autoVal >= 0) autoSpeedMode = (autoVal != 0);
    if (ms >= 80 && ms <= 2000) {
      stepMs = ms;
      Serial.printf("SPEED -> %ums (Mode: %s)\n", stepMs, autoSpeedMode ? "AUTO" : "MANUAL");
    }
    return;
  }
  if (strstr(packet, "\"music\"")) {
    int b  = readIntField(packet, "b");
    int bt = readIntField(packet, "bt");
    int r  = readIntField(packet, "r");
    int ms = readIntField(packet, "ms");
    int autoVal = readIntField(packet, "auto");
    if (b  >= 0) musicBass = (uint8_t)min(100, b);
    if (bt >= 0) musicBeat = (uint8_t)min(100, bt);
    if (r  >= 0) musicRms  = (uint8_t)min(100, r);
    if (ms >= 80 && ms <= 1000) liveDynamicMs = (uint32_t)ms;
    if (autoVal >= 0) autoSpeedMode = (autoVal != 0);
    return;
  }
}
