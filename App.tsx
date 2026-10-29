import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  Platform,
  ScrollView,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { requireNativeViewManager } from 'expo-modules-core';

// Native Android WebView compiled inside the APK for playing the bundled 35-min Christmas MP3
let NativeAudioWebView: React.ComponentType<any> | null = null;
try {
  NativeAudioWebView = requireNativeViewManager('ExpoDomWebViewModule');
} catch {
  NativeAudioWebView = null;
}

export interface Esp32Unit {
  unitId: number;
  name: string;
  role: string;
  ip: string;
  online: boolean;
  playing: boolean;
  relayMask: number; // 16-bit bitmask: bit 0..7 = LED Strip Sets (CH1-8), bit 8..15 = Christmas Sets (CH9-16)
}

export interface ChoreographyTrack {
  id: number;
  title: string;
  subtitle: string;
  stepMs: number;
  badge: string;
}

export interface TelemetryLog {
  id: string;
  timestamp: string;
  direction: 'TX' | 'RX' | 'SYS';
  text: string;
}

const STEP_MS = 180; // Exact STEP_MS from MusicLightSync_ESP32.ino

const CHOREOGRAPHY_TRACKS: ChoreographyTrack[] = [
  {
    id: 1,
    title: 'MusicLightSync: Party Alternating + Music Reactive',
    subtitle:
      'Exact MusicLightSync_ESP32.ino (STEP_MS=180ms • Strips CH1–8 & Xmas CH9–16)',
    stepMs: 180,
    badge: 'EXACT .INO',
  },
  {
    id: 2,
    title: '10-Unit MusicLightSync Multi-Effect Show',
    subtitle:
      'Each ESP32 plays a distinct MusicLightSync_ESP32 effect (Party, Soundwave, Twinkle, Chase)',
    stepMs: 180,
    badge: '10 EFFECTS',
  },
  {
    id: 3,
    title: 'LED Strips Reactive (1–8) + Xmas Twinkle (9–16)',
    subtitle:
      'Board A runs Music Reactive Pulse while Board B runs Christmas Twinkle Sparkle',
    stepMs: 180,
    badge: 'DUAL BANK',
  },
  {
    id: 4,
    title: '10-Unit Christmas Stadium Wave Cascade',
    subtitle:
      'Phase-shifted MusicLightSync_ESP32 wave cascading from UNIT-01 to UNIT-10',
    stepMs: 180,
    badge: 'CASCADE',
  },
];

const INITIAL_UNITS: Esp32Unit[] = [
  {
    unitId: 1,
    name: 'UNIT-01',
    role: 'Party Alternating + Music Reactive (MusicLightSync)',
    ip: '10.241.48.101',
    online: false,
    playing: false,
    relayMask: 0,
  },
  {
    unitId: 2,
    name: 'UNIT-02',
    role: 'Music Reactive + Soundwave Pulse',
    ip: '10.241.48.102',
    online: false,
    playing: false,
    relayMask: 0,
  },
  {
    unitId: 3,
    name: 'UNIT-03',
    role: 'Twinkle + Sparkle Playful',
    ip: '10.241.48.103',
    online: false,
    playing: false,
    relayMask: 0,
  },
  {
    unitId: 4,
    name: 'UNIT-04',
    role: 'Wave + Comet Flow Chase',
    ip: '10.241.48.104',
    online: false,
    playing: false,
    relayMask: 0,
  },
  {
    unitId: 5,
    name: 'UNIT-05',
    role: 'Outer-to-Middle Christmas Sweep',
    ip: '10.241.48.105',
    online: false,
    playing: false,
    relayMask: 0,
  },
  {
    unitId: 6,
    name: 'UNIT-06',
    role: 'LED Strip Chase (1–8) + Xmas Twinkle (9–16)',
    ip: '10.241.48.106',
    online: false,
    playing: false,
    relayMask: 0,
  },
  {
    unitId: 7,
    name: 'UNIT-07',
    role: 'LED Strip Party (1–8) + Xmas Soundwave (9–16)',
    ip: '10.241.48.107',
    online: false,
    playing: false,
    relayMask: 0,
  },
  {
    unitId: 8,
    name: 'UNIT-08',
    role: 'LED Strip Soundwave (1–8) + Xmas Sweep (9–16)',
    ip: '10.241.48.108',
    online: false,
    playing: false,
    relayMask: 0,
  },
  {
    unitId: 9,
    name: 'UNIT-09',
    role: 'Bass Flash + Beat Strobe Shuffle',
    ip: '10.241.48.109',
    online: false,
    playing: false,
    relayMask: 0,
  },
  {
    unitId: 10,
    name: 'UNIT-10',
    role: 'Grand Finale Auto-DJ Mix (All Effects)',
    ip: '10.241.48.110',
    online: false,
    playing: false,
    relayMask: 0,
  },
];

// Exact port of effectWantsOn() from MusicLightSync_ESP32.ino
function evalEffectString(effectName: string, i: number, step: number): boolean {
  const local = i % 8;
  const side = Math.floor(i / 8);
  if (effectName.includes('Steady On')) return true;
  if (
    effectName.includes('Strobe') ||
    effectName.includes('Bass Flash') ||
    effectName.includes('Beat On/Off')
  ) {
    return step % 2 === 0;
  }
  if (
    effectName.includes('Alternating') ||
    effectName.includes('Party') ||
    effectName.includes('Beat Shuffle') ||
    effectName.includes('DJ Mix')
  ) {
    return local % 2 === step % 2 || step % 8 === 0;
  }
  if (
    effectName.includes('Chase') ||
    effectName.includes('Wave') ||
    effectName.includes('Comet') ||
    effectName.includes('Sweep') ||
    effectName.includes('Flow')
  ) {
    return local === step % 8;
  }
  if (
    effectName.includes('Twinkle') ||
    effectName.includes('Sparkle') ||
    effectName.includes('Playful')
  ) {
    return (step * 7 + i * 3) % 5 < 2;
  }
  if (
    effectName.includes('Bass') ||
    effectName.includes('Music Reactive') ||
    effectName.includes('Fusion') ||
    effectName.includes('Soundwave') ||
    effectName.includes('Pulse')
  ) {
    return (step + local + side) % 4 !== 0;
  }
  const pos = step % 16 < 8 ? step % 8 : 7 - (step % 8);
  return local === pos;
}

function getUnitEffectForChannel(
  unitId: number,
  i: number,
  step: number
): string {
  const side = Math.floor(i / 8);
  switch (unitId) {
    case 1:
      return 'Party Alternating + Music Reactive';
    case 2:
      return 'Music Reactive Soundwave Pulse';
    case 3:
      return 'Twinkle Sparkle Playful';
    case 4:
      return 'Wave Comet Chase Flow';
    case 5:
      return 'Default Outer-Middle';
    case 6:
      return side === 0 ? 'Wave Chase' : 'Twinkle Sparkle';
    case 7:
      return side === 0 ? 'Party Alternating' : 'Music Reactive Soundwave';
    case 8:
      return side === 0 ? 'Music Reactive Pulse' : 'Default Outer-Middle';
    case 9:
      return step % 16 < 12 ? 'Party Alternating' : 'Bass Flash Strobe';
    case 10:
    default: {
      const phase = Math.floor(step / 16) % 5;
      if (phase === 0) return 'Party Alternating';
      if (phase === 1) return 'Music Reactive Soundwave';
      if (phase === 2) return 'Twinkle Sparkle';
      if (phase === 3) return 'Wave Chase';
      return 'Default Outer-Middle';
    }
  }
}

function computeUnitRelayMask16(
  unitId: number,
  elapsedMs: number,
  trackId: number
): number {
  let stepNumber = Math.floor(elapsedMs / STEP_MS) + 1;
  if (trackId === 4) {
    stepNumber += unitId - 1;
  }

  let mask = 0;
  for (let i = 0; i < 16; i++) {
    let on = false;
    if (trackId === 1) {
      if (Math.floor(stepNumber / 16) % 2 === 0) {
        on = evalEffectString(
          'Party Alternating + Music Reactive',
          i,
          stepNumber
        );
      } else {
        on = evalEffectString('Music Reactive', i, stepNumber);
      }
    } else if (trackId === 2) {
      const eff = getUnitEffectForChannel(unitId, i, stepNumber);
      on = evalEffectString(eff, i, stepNumber);
    } else if (trackId === 3) {
      const eff = i < 8 ? 'Music Reactive' : 'Twinkle Sparkle';
      on = evalEffectString(eff, i, stepNumber);
    } else {
      on = evalEffectString(
        'Party Alternating + Music Reactive',
        i,
        stepNumber
      );
    }
    if (on) {
      mask |= 1 << i;
    }
  }
  return mask;
}

async function fetchWithTimeout(
  url: string,
  timeoutMs = 1200
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

export default function App() {
  const [units, setUnits] = useState<Esp32Unit[]>(INITIAL_UNITS);
  const [selectedTrackId, setSelectedTrackId] = useState<number>(1);
  const [isMasterPlaying, setIsMasterPlaying] = useState<boolean>(false);
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [subnetPrefix, setSubnetPrefix] = useState<string>('10.241.48');
  const [editingUnitId, setEditingUnitId] = useState<number | null>(null);
  const [editingIpText, setEditingIpText] = useState<string>('');
  const [logs, setLogs] = useState<TelemetryLog[]>(() => [
    {
      id: 'init-1',
      timestamp: new Date().toLocaleTimeString(),
      direction: 'SYS',
      text: 'Loaded 2026 Christmas Lighting Songs.mp3 + MusicLightSync (180ms)',
    },
  ]);

  const showStartRef = useRef<number>(0);
  const audioOffsetMsRef = useRef<number>(0);
  const webViewRef = useRef<any>(null);

  const addLog = useCallback(
    (direction: 'TX' | 'RX' | 'SYS', text: string) => {
      const entry: TelemetryLog = {
        id: `${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        timestamp: new Date().toLocaleTimeString(),
        direction,
        text,
      };
      setLogs((prev) => [entry, ...prev.slice(0, 19)]);
    },
    []
  );

  const onlineCount = units.filter((u) => u.online).length;

  // Ping a single ESP32 unit via GET http://<ip>/status
  const pingSingleUnit = useCallback(
    async (unit: Esp32Unit): Promise<boolean> => {
      try {
        const res = await fetchWithTimeout(`http://${unit.ip}/status`, 1000);
        if (!res.ok) return false;
        const data = await res.json();
        setUnits((prev) =>
          prev.map((u) =>
            u.unitId === unit.unitId
              ? {
                  ...u,
                  online: true,
                  playing: Boolean(data.playing),
                  relayMask:
                    typeof data.relayMask === 'number' ? data.relayMask : 0,
                }
              : u
          )
        );
        return true;
      } catch {
        setUnits((prev) =>
          prev.map((u) =>
            u.unitId === unit.unitId
              ? { ...u, online: false, playing: false }
              : u
          )
        );
        return false;
      }
    },
    []
  );

  // Quick ping of all 10 configured ESP32 unit IPs on mount
  useEffect(() => {
    let mounted = true;
    (async () => {
      const results = await Promise.all(
        INITIAL_UNITS.map((u) => pingSingleUnit(u))
      );
      if (mounted) {
        const count = results.filter(Boolean).length;
        if (count > 0) {
          addLog('RX', `Connected to ${count}/10 ESP32 units on hotspot`);
        }
      }
    })();
    return () => {
      mounted = false;
    };
  }, [pingSingleUnit, addLog]);

  // Real-time 16-channel relay visualizer synced to song playback time
  useEffect(() => {
    if (!isMasterPlaying) {
      return;
    }

    showStartRef.current = Date.now() - audioOffsetMsRef.current;
    const interval = setInterval(() => {
      const elapsed = Date.now() - showStartRef.current;
      setUnits((prev) =>
        prev.map((u) => {
          if (!u.online) {
            return { ...u, playing: false, relayMask: 0 };
          }
          return {
            ...u,
            playing: true,
            relayMask: computeUnitRelayMask16(
              u.unitId,
              elapsed,
              selectedTrackId
            ),
          };
        })
      );
    }, 65);

    return () => clearInterval(interval);
  }, [isMasterPlaying, selectedTrackId]);

  // Broadcast play with current audio offsetMs to all ESP32s
  const broadcastPlayToEsp32s = useCallback(
    async (trackId: number, offsetMs: number) => {
      const results = await Promise.all(
        units.map(async (u) => {
          try {
            const res = await fetchWithTimeout(
              `http://${u.ip}/play?track=${trackId}&unit=${u.unitId}&offsetMs=${offsetMs}`,
              1200
            );
            if (res.ok) {
              setUnits((prev) =>
                prev.map((item) =>
                  item.unitId === u.unitId
                    ? { ...item, online: true, playing: true }
                    : item
                )
              );
              return true;
            }
            return false;
          } catch {
            return false;
          }
        })
      );
      const syncedCount = results.filter(Boolean).length;
      addLog(
        'SYS',
        `Music + Light Show synced on ${syncedCount}/10 ESP32 unit(s) (STEP_MS=180ms)`
      );
    },
    [units, addLog]
  );

  // Broadcast stop to all ESP32s
  const broadcastStopToEsp32s = useCallback(async () => {
    setUnits((prev) =>
      prev.map((u) => ({ ...u, playing: false, relayMask: 0 }))
    );
    await Promise.all(
      units.map(async (u) => {
        try {
          const res = await fetchWithTimeout(`http://${u.ip}/stop`, 1200);
          if (res.ok) {
            setUnits((prev) =>
              prev.map((item) =>
                item.unitId === u.unitId
                  ? { ...item, online: true, playing: false, relayMask: 0 }
                  : item
              )
            );
          }
        } catch {
          // ignore offline unit timeout
        }
      })
    );
  }, [units]);

  // Handle events from the embedded HTML5 Christmas Song Audio Player
  const handleAudioWebViewMessage = useCallback(
    (event: any) => {
      try {
        const raw = event?.nativeEvent?.data;
        if (!raw) return;
        const msg = JSON.parse(raw);

        if (typeof msg.currentTimeMs === 'number') {
          audioOffsetMsRef.current = msg.currentTimeMs;
          showStartRef.current = Date.now() - msg.currentTimeMs;
        }

        if (msg.type === 'UI_TOGGLE_PLAY') {
          if (msg.playing) {
            setIsMasterPlaying(true);
            addLog(
              'TX',
              `Music Player >> Started song & syncing ESP32 lights...`
            );
            broadcastPlayToEsp32s(selectedTrackId, msg.currentTimeMs || 0);
          } else {
            setIsMasterPlaying(false);
            addLog('TX', 'Music Player >> Paused song & stopping ESP32 lights');
            broadcastStopToEsp32s();
          }
        } else if (msg.type === 'AUDIO_SEEK' && isMasterPlaying) {
          addLog(
            'TX',
            `Music Seek >> Resyncing ESP32 lights to ${Math.floor(
              (msg.currentTimeMs || 0) / 1000
            )}s`
          );
          broadcastPlayToEsp32s(selectedTrackId, msg.currentTimeMs || 0);
        }
      } catch {
        // Ignore non-JSON messages
      }
    },
    [selectedTrackId, isMasterPlaying, addLog, broadcastPlayToEsp32s, broadcastStopToEsp32s]
  );

  // Quick Ping & Blink of all 10 ESP32 unit IPs
  const handlePingConfiguredUnits = async () => {
    setIsScanning(true);
    setIsMasterPlaying(false);
    webViewRef.current?.injectJavaScript?.(
      'window.stopShowMusic && window.stopShowMusic();'
    );
    addLog('TX', 'Pinging & blinking all ESP32 units (/blink)...');

    const results = await Promise.all(
      units.map(async (u) => {
        try {
          const res = await fetchWithTimeout(`http://${u.ip}/blink`, 1400);
          if (res.ok) {
            setUnits((prev) =>
              prev.map((item) =>
                item.unitId === u.unitId
                  ? { ...item, online: true, playing: false }
                  : item
              )
            );
            return true;
          }
          return await pingSingleUnit(u);
        } catch {
          return await pingSingleUnit(u);
        }
      })
    );
    const foundCount = results.filter(Boolean).length;
    setIsScanning(false);
    addLog(
      'SYS',
      `Ping & Blink complete: ${foundCount}/10 ESP32 units blinked online`
    );
  };

  // Full Subnet Scan: sweeps ENTIRE .2 - .254 subnet gently (batchSize 14)
  const handleScanNetwork = async () => {
    setIsScanning(true);
    setIsMasterPlaying(false);
    webViewRef.current?.injectJavaScript?.(
      'window.stopShowMusic && window.stopShowMusic();'
    );
    const cleanPrefix = subnetPrefix.trim().replace(/\.$/, '');
    addLog(
      'SYS',
      `Scanning hotspot ${cleanPrefix}.2 - 254 for all ESP32 units...`
    );

    const claimedSlots = new Map<number, string>();
    const discoveredIps = new Set<string>();

    const assignDiscoveredDevice = (
      ip: string,
      reportedUnitId: number,
      playing: boolean,
      relayMask: number
    ) => {
      if (discoveredIps.has(ip)) return;
      discoveredIps.add(ip);

      let targetSlot =
        reportedUnitId >= 1 && reportedUnitId <= 10 ? reportedUnitId : 1;

      if (claimedSlots.has(targetSlot) && claimedSlots.get(targetSlot) !== ip) {
        for (let slot = 1; slot <= 10; slot++) {
          if (!claimedSlots.has(slot)) {
            targetSlot = slot;
            break;
          }
        }
      }

      claimedSlots.set(targetSlot, ip);

      setUnits((prev) =>
        prev.map((u) =>
          u.unitId === targetSlot
            ? {
                ...u,
                ip,
                online: true,
                playing,
                relayMask,
              }
            : u
        )
      );

      const slotName = `UNIT-${targetSlot < 10 ? '0' : ''}${targetSlot}`;
      if (targetSlot !== reportedUnitId) {
        addLog(
          'RX',
          `✓ Found ${ip} (shared ID=${reportedUnitId}) -> Auto-assigned to ${slotName}`
        );
        fetchWithTimeout(`http://${ip}/status?unit=${targetSlot}`, 800).catch(
          () => {}
        );
      } else {
        addLog('RX', `✓ Found ${slotName} online at ${ip}`);
      }

      fetchWithTimeout(`http://${ip}/blink`, 900).catch(() => {});
    };

    const knownIps = Array.from(
      new Set(units.map((u) => u.ip).filter(Boolean))
    );
    await Promise.all(
      knownIps.map(async (ip) => {
        try {
          const res = await fetchWithTimeout(`http://${ip}/status`, 1300);
          if (res.ok) {
            const data = await res.json();
            const detectedId = Number(data.unitId) || 1;
            assignDiscoveredDevice(
              ip,
              detectedId,
              Boolean(data.playing),
              typeof data.relayMask === 'number' ? data.relayMask : 0
            );
          }
        } catch {
          // Will be checked in subnet sweep
        }
      })
    );

    const remainingIps: string[] = [];
    for (let host = 2; host <= 254; host++) {
      const ip = `${cleanPrefix}.${host}`;
      if (!discoveredIps.has(ip)) {
        remainingIps.push(ip);
      }
    }

    const batchSize = 14;
    for (let i = 0; i < remainingIps.length; i += batchSize) {
      const batch = remainingIps.slice(i, i + batchSize);
      await Promise.all(
        batch.map(async (ip) => {
          try {
            const res = await fetchWithTimeout(`http://${ip}/status`, 850);
            if (res.ok) {
              const data = await res.json();
              const detectedId = Number(data.unitId) || 1;
              assignDiscoveredDevice(
                ip,
                detectedId,
                Boolean(data.playing),
                typeof data.relayMask === 'number' ? data.relayMask : 0
              );
            }
          } catch {
            // Host did not respond
          }
        })
      );
    }

    setUnits((prev) =>
      prev.map((u) =>
        claimedSlots.has(u.unitId) ? u : { ...u, online: false, playing: false }
      )
    );

    setIsScanning(false);
    addLog(
      'SYS',
      `Scan finished: Found ${discoveredIps.size} active ESP32 unit(s) on ${cleanPrefix}.x`
    );
  };

  // Master START / STOP: simultaneously plays/stops "2026 Christmas Lighting Songs.mp3" AND all 10 ESP32s!
  const handleMasterToggleShow = async () => {
    const nextPlaying = !isMasterPlaying;

    if (!nextPlaying) {
      setIsMasterPlaying(false);
      webViewRef.current?.injectJavaScript?.(
        'window.stopShowMusic && window.stopShowMusic();'
      );
      addLog(
        'TX',
        'Phone Master >> Stopping Christmas Music & all 10 ESP32 light shows...'
      );
      await broadcastStopToEsp32s();
      addLog('SYS', 'Music paused & all 160 relay channels turned OFF');
      return;
    }

    const track =
      CHOREOGRAPHY_TRACKS.find((t) => t.id === selectedTrackId) ||
      CHOREOGRAPHY_TRACKS[0];
    setIsMasterPlaying(true);

    // Start the bundled MP3 in the WebView immediately
    webViewRef.current?.injectJavaScript?.(
      'window.startShowMusic && window.startShowMusic(false);'
    );

    addLog(
      'TX',
      `Playing "2026 Christmas Lighting Songs" + Track ${track.id} (180ms step)...`
    );

    await broadcastPlayToEsp32s(track.id, audioOffsetMsRef.current);
  };

  // Blink / Test an individual ESP32 unit's dual 8-channel relay boards
  const handleBlinkUnit = async (unit: Esp32Unit) => {
    addLog(
      'TX',
      `Testing 16 relays (Strips 1–8 & Xmas 9–16) on ${unit.name} (${unit.ip})...`
    );
    try {
      const res = await fetchWithTimeout(`http://${unit.ip}/blink`, 1200);
      if (res.ok) {
        addLog('RX', `✓ ${unit.name} 16-ch relay test confirmed`);
        setUnits((prev) =>
          prev.map((u) =>
            u.unitId === unit.unitId ? { ...u, online: true } : u
          )
        );
      } else {
        addLog('SYS', `✗ ${unit.name} (${unit.ip}) did not respond`);
      }
    } catch {
      addLog('SYS', `✗ ${unit.name} (${unit.ip}) did not respond`);
    }
  };

  // Hardware Self-ID for a single ESP32 unit
  const handleIdentifyUnit = async (unit: Esp32Unit) => {
    const idMask = 1 << (unit.unitId - 1);
    setUnits((prev) =>
      prev.map((u) =>
        u.unitId === unit.unitId ? { ...u, relayMask: idMask } : u
      )
    );
    setTimeout(() => {
      setUnits((prev) =>
        prev.map((u) =>
          u.unitId === unit.unitId && u.relayMask === idMask
            ? { ...u, relayMask: 0 }
            : u
        )
      );
    }, 3000);

    addLog(
      'TX',
      `Self-ID ${unit.name} >> Lighting Relay CH${unit.unitId} for 3s...`
    );
    try {
      const res = await fetchWithTimeout(
        `http://${unit.ip}/identify?unit=${unit.unitId}`,
        1200
      );
      if (res.ok) {
        addLog(
          'RX',
          `✓ ${unit.name} Self-ID active (Relay CH${unit.unitId} ON for 3s)`
        );
        setUnits((prev) =>
          prev.map((u) =>
            u.unitId === unit.unitId ? { ...u, online: true } : u
          )
        );
      } else {
        addLog('SYS', `✗ ${unit.name} (${unit.ip}) did not respond`);
      }
    } catch {
      addLog('SYS', `✗ ${unit.name} (${unit.ip}) did not respond`);
    }
  };

  // Hardware Self-ID for ALL 10 ESP32 units at once
  const handleIdentifyAllUnits = async () => {
    setIsMasterPlaying(false);
    webViewRef.current?.injectJavaScript?.(
      'window.stopShowMusic && window.stopShowMusic();'
    );
    addLog(
      'TX',
      'Self-ID All 10 >> Unit 1=CH1, Unit 2=CH2 ... Unit 10=CH10 for 3s!'
    );

    setUnits((prev) =>
      prev.map((u) => ({
        ...u,
        playing: false,
        relayMask: u.online ? 1 << (u.unitId - 1) : 0,
      }))
    );

    const results = await Promise.all(
      units.map(async (u) => {
        try {
          const res = await fetchWithTimeout(
            `http://${u.ip}/identify?unit=${u.unitId}`,
            1200
          );
          if (res.ok) {
            setUnits((prev) =>
              prev.map((item) =>
                item.unitId === u.unitId
                  ? {
                      ...item,
                      online: true,
                      relayMask: 1 << (u.unitId - 1),
                    }
                  : item
              )
            );
            return true;
          }
          return false;
        } catch {
          return false;
        }
      })
    );

    setTimeout(() => {
      setUnits((prev) => prev.map((u) => ({ ...u, relayMask: 0 })));
    }, 3000);

    const count = results.filter(Boolean).length;
    addLog(
      'SYS',
      `Hardware Self-ID triggered on ${count}/10 ESP32 units (check CH1–CH10)`
    );
  };

  // Toggle a single relay channel (CH1..CH16) on a specific ESP32 unit
  const handleToggleSingleRelay = async (
    unit: Esp32Unit,
    channelIndex: number
  ) => {
    const bit = 1 << channelIndex;
    const nextState = (unit.relayMask & bit) === 0 ? 1 : 0;
    const nextMask = nextState ? unit.relayMask | bit : unit.relayMask & ~bit;

    setUnits((prev) =>
      prev.map((u) =>
        u.unitId === unit.unitId ? { ...u, relayMask: nextMask } : u
      )
    );

    const chNum = channelIndex + 1;
    addLog(
      'TX',
      `${unit.name} >> Relay CH${chNum} -> ${nextState ? 'ON' : 'OFF'}`
    );

    try {
      const res = await fetchWithTimeout(
        `http://${unit.ip}/relay?ch=${chNum}&state=${nextState}`,
        1000
      );
      if (res.ok) {
        setUnits((prev) =>
          prev.map((u) =>
            u.unitId === unit.unitId ? { ...u, online: true } : u
          )
        );
      }
    } catch {
      addLog('SYS', `✗ ${unit.name} (${unit.ip}) unreachable for CH${chNum}`);
    }
  };

  // Save edited IP for a unit
  const handleSaveUnitIp = (unitId: number) => {
    const trimmed = editingIpText.trim();
    if (trimmed) {
      setUnits((prev) =>
        prev.map((u) => (u.unitId === unitId ? { ...u, ip: trimmed } : u))
      );
      const parts = trimmed.split('.');
      if (parts.length === 4) {
        setSubnetPrefix(`${parts[0]}.${parts[1]}.${parts[2]}`);
      }
      addLog(
        'SYS',
        `Updated UNIT-${unitId < 10 ? '0' : ''}${unitId} IP to ${trimmed}`
      );
    }
    setEditingUnitId(null);
    setEditingIpText('');
  };

  return (
    <View style={styles.safeArea}>
      <StatusBar style="light" />

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* HEADER */}
        <View style={styles.header}>
          <View style={styles.headerTitleRow}>
            <Text style={styles.brandTag}>{"DUNKIN' LIGHTS"}</Text>
            <View style={styles.hardwareBadge}>
              <Text style={styles.hardwareBadgeText}>
                MUSIC + 10x ESP32 (16-CH)
              </Text>
            </View>
          </View>
          <Text style={styles.headerSubtitle}>
            2026 Christmas Lighting Songs • MusicLightSync_ESP32 (180ms Step)
          </Text>
        </View>

        {/* BUILT-IN CHRISTMAS LIGHTING SONG PLAYER CARD */}
        <View style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <Text style={styles.cardTitle}>
              🎵 Built-in Song: 2026 Christmas Lighting
            </Text>
            <View style={styles.pillBadge}>
              <Text style={styles.pillBadgeText}>35:38 MP3 BUNDLED</Text>
            </View>
          </View>

          {NativeAudioWebView ? (
            <View style={styles.audioWebViewContainer}>
              <NativeAudioWebView
                ref={webViewRef}
                source={{ uri: 'file:///android_asset/player.html' }}
                mediaPlaybackRequiresUserAction={false}
                injectedJavaScriptObject="{}"
                nestedScrollEnabled={false}
                showsVerticalScrollIndicator={false}
                showsHorizontalScrollIndicator={false}
                onMessage={handleAudioWebViewMessage}
                style={styles.audioWebView}
              />
            </View>
          ) : (
            <View style={styles.hotspotGuideBox}>
              <Text style={styles.hotspotGuideText}>
                Audio engine ready (MP3 file - 2026 Christmas Lighting Songs.mp3)
              </Text>
            </View>
          )}
        </View>

        {/* MASTER START / STOP BUTTON (STARTS MUSIC + ALL 10 ESP32s TOGETHER) */}
        <View style={styles.masterActionContainer}>
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={handleMasterToggleShow}
            style={[
              styles.masterButton,
              !isMasterPlaying ? styles.masterButtonReady : styles.masterButtonStop,
            ]}
          >
            <Text
              style={[
                styles.masterButtonTitle,
                isMasterPlaying && styles.masterButtonTitleStop,
              ]}
            >
              {isMasterPlaying
                ? '⏹ STOP MUSIC & ALL 10 ESP32 LIGHTS'
                : '▶ START CHRISTMAS MUSIC + ALL 10 ESP32s'}
            </Text>
            <Text
              style={[
                styles.masterButtonSub,
                isMasterPlaying && styles.masterButtonSubStop,
              ]}
            >
              {isMasterPlaying
                ? 'Tap to pause song & turn OFF all 160 relay channels immediately'
                : 'Plays 2026 Christmas Lighting Songs.mp3 & syncs all 10 ESP32s (180ms beat)'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* HOTSPOT & NETWORK SCANNER CARD */}
        <View style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <Text style={styles.cardTitle}>📡 Master Hotspot Controller</Text>
            <View style={styles.pillBadge}>
              <Text style={styles.pillBadgeText}>LIVE HARDWARE</Text>
            </View>
          </View>

          <View style={styles.hotspotGuideBox}>
            <Text style={styles.hotspotGuideText}>
              1. Turn on Mobile Hotspot{' '}
              <Text style={styles.highlightText}>DunkinNetwork</Text> (Password:{' '}
              <Text style={styles.highlightText}>dunkin123456</Text>).
            </Text>
            <Text style={styles.hotspotGuideText}>
              2. CH1–CH8 = <Text style={styles.highlightText}>LED Strip Sets</Text>{' '}
              • CH9–CH16 ={' '}
              <Text style={styles.highlightText}>Christmas Light Sets</Text>.
            </Text>
          </View>

          <View style={styles.scanRow}>
            <View style={styles.subnetInputBox}>
              <Text style={styles.subnetLabel}>Subnet:</Text>
              <TextInput
                style={styles.subnetInput}
                value={subnetPrefix}
                onChangeText={setSubnetPrefix}
                placeholder="10.241.48"
                placeholderTextColor="#64748B"
                autoCapitalize="none"
              />
            </View>

            <TouchableOpacity
              style={[styles.pingButton, isScanning && styles.scanButtonDisabled]}
              disabled={isScanning}
              activeOpacity={0.8}
              onPress={handlePingConfiguredUnits}
            >
              <Text style={styles.scanButtonText}>🔄 Ping 10</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.scanButton, isScanning && styles.scanButtonDisabled]}
              disabled={isScanning}
              activeOpacity={0.8}
              onPress={handleScanNetwork}
            >
              {isScanning ? (
                <View style={styles.scanLoadingRow}>
                  <ActivityIndicator size="small" color="#FFFFFF" />
                  <Text style={styles.scanButtonText}>Scanning</Text>
                </View>
              ) : (
                <Text style={styles.scanButtonText}>🔍 Scan Hotspot</Text>
              )}
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={styles.identifyAllButton}
            activeOpacity={0.8}
            onPress={handleIdentifyAllUnits}
          >
            <Text style={styles.identifyAllButtonText}>
              🆔 Hardware Self-ID All 10 Units (Unit 1→CH1 … Unit 10→CH10)
            </Text>
          </TouchableOpacity>
        </View>

        {/* CONNECTION STATUS BADGE */}
        <View style={styles.statusSection}>
          <View
            style={[
              styles.statusBadge,
              onlineCount > 0
                ? styles.statusBadgeConnected
                : styles.statusBadgeDisconnected,
            ]}
          >
            <View
              style={[
                styles.statusDot,
                onlineCount > 0 ? styles.dotConnected : styles.dotDisconnected,
              ]}
            />
            <Text
              style={[
                styles.statusText,
                onlineCount > 0
                  ? styles.textConnected
                  : styles.textDisconnected,
              ]}
            >
              {`${onlineCount}/10 ESP32 UNITS ONLINE (${onlineCount * 16}/160 RELAYS)`}
            </Text>
          </View>
        </View>

        {/* CHOREOGRAPHY TRACK / EFFECT SELECTOR */}
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>
            SELECT MUSICLIGHTSYNC_ESP32.INO MODE:
          </Text>
          {CHOREOGRAPHY_TRACKS.map((track) => {
            const selected = track.id === selectedTrackId;
            return (
              <TouchableOpacity
                key={track.id}
                activeOpacity={0.8}
                onPress={() => {
                  setSelectedTrackId(track.id);
                  if (isMasterPlaying) {
                    broadcastPlayToEsp32s(track.id, audioOffsetMsRef.current);
                  }
                }}
                style={[
                  styles.trackCard,
                  selected && styles.trackCardSelected,
                ]}
              >
                <View style={styles.trackInfo}>
                  <Text
                    style={[
                      styles.trackTitle,
                      selected && styles.trackTitleSelected,
                    ]}
                  >
                    {track.id}. {track.title}
                  </Text>
                  <Text style={styles.trackSubtitle}>{track.subtitle}</Text>
                </View>
                <View
                  style={[
                    styles.trackBadge,
                    selected && styles.trackBadgeSelected,
                  ]}
                >
                  <Text
                    style={[
                      styles.trackBadgeText,
                      selected && styles.trackBadgeTextSelected,
                    ]}
                  >
                    {track.badge}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* 10 ESP32 UNITS × DUAL 8-CHANNEL RELAY MATRIX (16 CHANNELS PER UNIT) */}
        <View style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <Text style={styles.cardTitle}>
              💡 10x ESP32 Units (CH1–8 Strips • CH9–16 Xmas)
            </Text>
            <Text style={styles.relayHintText}>Tap CH1–16 to toggle</Text>
          </View>

          {units.map((unit) => (
            <View
              key={unit.unitId}
              style={[
                styles.unitCard,
                unit.online ? styles.unitCardOnline : styles.unitCardOffline,
              ]}
            >
              {/* Unit Top Row */}
              <View style={styles.unitHeaderRow}>
                <View style={styles.unitTitleRow}>
                  <View
                    style={[
                      styles.miniDot,
                      unit.online
                        ? styles.dotConnected
                        : styles.dotDisconnected,
                    ]}
                  />
                  <Text style={styles.unitNameText}>{unit.name}</Text>
                  <TouchableOpacity
                    onPress={() => {
                      setEditingUnitId(unit.unitId);
                      setEditingIpText(unit.ip);
                    }}
                    style={styles.ipPill}
                  >
                    <Text style={styles.ipPillText}>{unit.ip} ✎</Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.unitActionGroup}>
                  <TouchableOpacity
                    style={styles.idUnitButton}
                    activeOpacity={0.75}
                    onPress={() => handleIdentifyUnit(unit)}
                  >
                    <Text style={styles.idUnitButtonText}>
                      🆔 CH{unit.unitId}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.blinkButton}
                    activeOpacity={0.75}
                    onPress={() => handleBlinkUnit(unit)}
                  >
                    <Text style={styles.blinkButtonText}>⚡ Test 16-Ch</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Unique Light Play Description + Self-ID Info */}
              <Text style={styles.unitRoleText}>
                Effect:{' '}
                <Text style={styles.unitRoleHighlight}>{unit.role}</Text>
                {'  •  '}
                <Text style={styles.selfIdHighlight}>
                  Self-ID: CH{unit.unitId}
                </Text>
              </Text>

              {/* Optional IP Editor */}
              {editingUnitId === unit.unitId && (
                <View style={styles.editIpRow}>
                  <TextInput
                    style={styles.editIpInput}
                    value={editingIpText}
                    onChangeText={setEditingIpText}
                    placeholder="e.g. 10.241.48.101"
                    placeholderTextColor="#64748B"
                    autoCapitalize="none"
                  />
                  <TouchableOpacity
                    style={styles.saveIpButton}
                    onPress={() => handleSaveUnitIp(unit.unitId)}
                  >
                    <Text style={styles.saveIpButtonText}>Save IP</Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* RELAY MODULE #1: CH1 .. CH8 (LED STRIP SETS) */}
              <Text style={styles.boardBankLabel}>
                Relay Board A — LED Strip Sets (CH1–CH8 • GPIOs 13,14,27,26,25,33,32,16)
              </Text>
              <View style={styles.relayRow}>
                {[0, 1, 2, 3, 4, 5, 6, 7].map((chIdx) => {
                  const isOn = ((unit.relayMask >> chIdx) & 1) === 1;
                  return (
                    <TouchableOpacity
                      key={chIdx}
                      activeOpacity={0.75}
                      onPress={() => handleToggleSingleRelay(unit, chIdx)}
                      style={[
                        styles.relayChannelBox,
                        isOn ? styles.relayChannelOn : styles.relayChannelOff,
                      ]}
                    >
                      <View
                        style={[
                          styles.relayLed,
                          isOn ? styles.relayLedOn : styles.relayLedOff,
                        ]}
                      />
                      <Text
                        style={[
                          styles.relayChannelLabel,
                          isOn && styles.relayChannelLabelOn,
                        ]}
                      >
                        CH{chIdx + 1}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* RELAY MODULE #2: CH9 .. CH16 (CHRISTMAS SETS) */}
              <Text style={[styles.boardBankLabel, styles.boardBankLabelSecond]}>
                Relay Board B — Christmas Sets (CH9–CH16 • GPIOs 17,18,19,21,22,23,4,5)
              </Text>
              <View style={styles.relayRow}>
                {[8, 9, 10, 11, 12, 13, 14, 15].map((chIdx) => {
                  const isOn = ((unit.relayMask >> chIdx) & 1) === 1;
                  return (
                    <TouchableOpacity
                      key={chIdx}
                      activeOpacity={0.75}
                      onPress={() => handleToggleSingleRelay(unit, chIdx)}
                      style={[
                        styles.relayChannelBox,
                        isOn
                          ? styles.relayChannelOnBankB
                          : styles.relayChannelOff,
                      ]}
                    >
                      <View
                        style={[
                          styles.relayLed,
                          isOn ? styles.relayLedOnBankB : styles.relayLedOff,
                        ]}
                      />
                      <Text
                        style={[
                          styles.relayChannelLabel,
                          isOn && styles.relayChannelLabelOn,
                        ]}
                      >
                        CH{chIdx + 1}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          ))}
        </View>

        {/* TELEMETRY LOG STREAM */}
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>
            MASTER CONTROLLER TELEMETRY LOG:
          </Text>
          <View style={styles.logContainer}>
            {logs.slice(0, 6).map((log) => (
              <View key={log.id} style={styles.logRow}>
                <Text style={styles.logTime}>{log.timestamp}</Text>
                <Text
                  style={[
                    styles.logTag,
                    log.direction === 'TX'
                      ? styles.logTx
                      : log.direction === 'RX'
                      ? styles.logRx
                      : styles.logSys,
                  ]}
                >
                  {log.direction}
                </Text>
                <Text style={styles.logText} numberOfLines={1}>
                  {log.text}
                </Text>
              </View>
            ))}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#090D16',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'android' ? 42 : 50,
    paddingBottom: 40,
  },
  header: {
    width: '100%',
    marginBottom: 14,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  brandTag: {
    color: '#FF671F',
    fontSize: 21,
    fontWeight: '900',
    letterSpacing: 1.2,
  },
  hardwareBadge: {
    backgroundColor: '#1E293B',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
  },
  hardwareBadgeText: {
    color: '#FDB913',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  headerSubtitle: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '600',
  },
  card: {
    width: '100%',
    backgroundColor: '#111827',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#1F2937',
    marginBottom: 14,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  cardTitle: {
    color: '#F9FAFB',
    fontSize: 14,
    fontWeight: '700',
  },
  pillBadge: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.45)',
  },
  pillBadgeText: {
    color: '#10B981',
    fontSize: 10,
    fontWeight: '800',
  },
  audioWebViewContainer: {
    width: '100%',
    height: 92,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#1E293B',
    backgroundColor: '#0B1120',
  },
  audioWebView: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  miniDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  hotspotGuideBox: {
    backgroundColor: '#0B1120',
    borderRadius: 10,
    padding: 10,
    borderLeftWidth: 3,
    borderLeftColor: '#FF671F',
    marginBottom: 10,
  },
  hotspotGuideText: {
    color: '#CBD5E1',
    fontSize: 12,
    lineHeight: 18,
  },
  highlightText: {
    color: '#FDB913',
    fontWeight: '700',
  },
  scanRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  subnetInputBox: {
    flex: 1.25,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0B1120',
    borderRadius: 10,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: '#1E293B',
    height: 40,
  },
  subnetLabel: {
    color: '#64748B',
    fontSize: 11,
    marginRight: 4,
    fontWeight: '600',
  },
  subnetInput: {
    flex: 1,
    color: '#F8FAFC',
    fontSize: 12,
    fontWeight: '700',
    paddingVertical: 0,
    paddingHorizontal: 2,
  },
  pingButton: {
    backgroundColor: '#1E293B',
    height: 40,
    paddingHorizontal: 11,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155',
  },
  scanButton: {
    backgroundColor: '#2563EB',
    height: 40,
    paddingHorizontal: 12,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scanButtonDisabled: {
    opacity: 0.6,
  },
  scanLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  scanButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  identifyAllButton: {
    marginTop: 10,
    backgroundColor: 'rgba(253, 185, 19, 0.14)',
    borderWidth: 1,
    borderColor: '#FDB913',
    borderRadius: 10,
    paddingVertical: 9,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  identifyAllButtonText: {
    color: '#FDB913',
    fontSize: 12,
    fontWeight: '800',
  },
  statusSection: {
    width: '100%',
    alignItems: 'center',
    marginBottom: 12,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 18,
    borderRadius: 999,
    borderWidth: 1.5,
  },
  statusBadgeConnected: {
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
    borderColor: 'rgba(16, 185, 129, 0.45)',
  },
  statusBadgeDisconnected: {
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    borderColor: 'rgba(239, 68, 68, 0.45)',
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 8,
  },
  dotConnected: {
    backgroundColor: '#10B981',
  },
  dotDisconnected: {
    backgroundColor: '#EF4444',
  },
  statusText: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  textConnected: {
    color: '#10B981',
  },
  textDisconnected: {
    color: '#EF4444',
  },
  masterActionContainer: {
    width: '100%',
    marginBottom: 14,
  },
  masterButton: {
    width: '100%',
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  masterButtonReady: {
    backgroundColor: '#10B981',
  },
  masterButtonStop: {
    backgroundColor: '#EF4444',
  },
  masterButtonTitle: {
    color: '#042F2E',
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 0.6,
  },
  masterButtonTitleStop: {
    color: '#FFFFFF',
  },
  masterButtonSub: {
    color: '#064E3B',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 4,
    textAlign: 'center',
  },
  masterButtonSubStop: {
    color: '#FEE2E2',
  },
  sectionLabel: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
    marginBottom: 10,
  },
  trackCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#0B1120',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  trackCardSelected: {
    borderColor: '#FF671F',
    backgroundColor: 'rgba(255, 103, 31, 0.1)',
  },
  trackInfo: {
    flex: 1,
    paddingRight: 10,
  },
  trackTitle: {
    color: '#F1F5F9',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 2,
  },
  trackTitleSelected: {
    color: '#FF671F',
  },
  trackSubtitle: {
    color: '#94A3B8',
    fontSize: 11,
  },
  trackBadge: {
    backgroundColor: '#1E293B',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 6,
  },
  trackBadgeSelected: {
    backgroundColor: '#FF671F',
  },
  trackBadgeText: {
    color: '#94A3B8',
    fontSize: 10,
    fontWeight: '800',
  },
  trackBadgeTextSelected: {
    color: '#FFFFFF',
  },
  relayHintText: {
    color: '#64748B',
    fontSize: 11,
    fontWeight: '600',
  },
  unitCard: {
    backgroundColor: '#0B1120',
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
  },
  unitCardOnline: {
    borderColor: '#10B981',
  },
  unitCardOffline: {
    borderColor: '#1E293B',
  },
  unitHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  unitTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  unitNameText: {
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: '800',
    marginRight: 8,
  },
  ipPill: {
    backgroundColor: '#1E293B',
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: 6,
  },
  ipPillText: {
    color: '#38BDF8',
    fontSize: 11,
    fontWeight: '600',
  },
  unitActionGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  idUnitButton: {
    backgroundColor: 'rgba(56, 189, 248, 0.14)',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#38BDF8',
  },
  idUnitButtonText: {
    color: '#38BDF8',
    fontSize: 11,
    fontWeight: '700',
  },
  blinkButton: {
    backgroundColor: '#1E293B',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#334155',
  },
  blinkButtonText: {
    color: '#FDB913',
    fontSize: 11,
    fontWeight: '700',
  },
  unitRoleText: {
    color: '#64748B',
    fontSize: 11,
    marginBottom: 8,
  },
  unitRoleHighlight: {
    color: '#CBD5E1',
    fontWeight: '600',
  },
  selfIdHighlight: {
    color: '#FDB913',
    fontWeight: '700',
  },
  editIpRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  editIpInput: {
    flex: 1,
    backgroundColor: '#111827',
    color: '#FFFFFF',
    borderRadius: 8,
    paddingHorizontal: 10,
    height: 34,
    fontSize: 12,
    borderWidth: 1,
    borderColor: '#38BDF8',
  },
  saveIpButton: {
    backgroundColor: '#10B981',
    paddingHorizontal: 12,
    height: 34,
    borderRadius: 8,
    justifyContent: 'center',
  },
  saveIpButtonText: {
    color: '#042F2E',
    fontSize: 12,
    fontWeight: '800',
  },
  boardBankLabel: {
    color: '#64748B',
    fontSize: 10,
    fontWeight: '700',
    marginBottom: 4,
  },
  boardBankLabelSecond: {
    marginTop: 6,
  },
  relayRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 4,
  },
  relayChannelBox: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  relayChannelOn: {
    backgroundColor: 'rgba(255, 103, 31, 0.22)',
    borderColor: '#FF671F',
  },
  relayChannelOnBankB: {
    backgroundColor: 'rgba(56, 189, 248, 0.22)',
    borderColor: '#38BDF8',
  },
  relayChannelOff: {
    backgroundColor: '#111827',
    borderColor: '#1F2937',
  },
  relayLed: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginBottom: 4,
  },
  relayLedOn: {
    backgroundColor: '#FDB913',
  },
  relayLedOnBankB: {
    backgroundColor: '#38BDF8',
  },
  relayLedOff: {
    backgroundColor: '#334155',
  },
  relayChannelLabel: {
    color: '#64748B',
    fontSize: 9,
    fontWeight: '800',
  },
  relayChannelLabelOn: {
    color: '#FFFFFF',
  },
  logContainer: {
    backgroundColor: '#0B1120',
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  logRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 2,
  },
  logTime: {
    color: '#475569',
    fontSize: 10,
    marginRight: 6,
  },
  logTag: {
    fontSize: 9,
    fontWeight: '800',
    paddingVertical: 1,
    paddingHorizontal: 4,
    borderRadius: 3,
    marginRight: 6,
  },
  logTx: {
    backgroundColor: 'rgba(56, 189, 248, 0.15)',
    color: '#38BDF8',
  },
  logRx: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    color: '#10B981',
  },
  logSys: {
    backgroundColor: 'rgba(148, 163, 184, 0.15)',
    color: '#94A3B8',
  },
  logText: {
    color: '#CBD5E1',
    fontSize: 11,
    flex: 1,
  },
});
