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
  ip: string;
  online: boolean;
  playing: boolean;
}

export interface EspPattern {
  id: string;
  label: string;
  description: string;
  reactive: boolean;
}

export interface TelemetryLog {
  id: string;
  timestamp: string;
  direction: 'TX' | 'RX' | 'SYS';
  text: string;
}

const INITIAL_UNITS: Esp32Unit[] = [
  { unitId: 1, name: 'UNIT-01', ip: '10.241.48.101', online: false, playing: false },
  { unitId: 2, name: 'UNIT-02', ip: '10.241.48.102', online: false, playing: false },
  { unitId: 3, name: 'UNIT-03', ip: '10.241.48.103', online: false, playing: false },
  { unitId: 4, name: 'UNIT-04', ip: '10.241.48.104', online: false, playing: false },
  { unitId: 5, name: 'UNIT-05', ip: '10.241.48.105', online: false, playing: false },
  { unitId: 6, name: 'UNIT-06', ip: '10.241.48.106', online: false, playing: false },
  { unitId: 7, name: 'UNIT-07', ip: '10.241.48.107', online: false, playing: false },
  { unitId: 8, name: 'UNIT-08', ip: '10.241.48.108', online: false, playing: false },
  { unitId: 9, name: 'UNIT-09', ip: '10.241.48.109', online: false, playing: false },
  { unitId: 10, name: 'UNIT-10', ip: '10.241.48.110', online: false, playing: false },
];

// Exact 10 built-in patterns from the ESP32 relay pattern engine
const ESP32_PATTERNS: EspPattern[] = [
  {
    id: 'combo_adaptive',
    label: 'Combo Master (All Combos Showcase)',
    description:
      'Showcases all 10 light combos (Wave L→R, Center In/Out, Ping-Pong, Bounce Pair, Comet, DJ Shuffle, Accordion, 16ch Waterfall, Sparkle) locked in sync with the beat',
    reactive: true,
  },
  {
    id: 'wave_lr',
    label: 'Wave L→R (Sweeping Bar)',
    description: 'Progressive wave sweeping across the 8-channel relay banks',
    reactive: false,
  },
  {
    id: 'center_in',
    label: 'Center In (Edges to Middle)',
    description: 'Both outer edges sweep inward toward the middle',
    reactive: false,
  },
  {
    id: 'center_out',
    label: 'Center Out (Middle to Edges)',
    description: 'Middle spreads outward toward both outer edges',
    reactive: false,
  },
  {
    id: 'ping_pong',
    label: 'Ping Pong (Bouncing Bar)',
    description: 'Left ↔ Right continuous bouncing sweep across channels',
    reactive: false,
  },
  {
    id: 'bounce_pair',
    label: 'Bounce Pair (2-Relay Pair)',
    description: '2-relay pair bouncing Left ↔ Right across channels',
    reactive: false,
  },
  {
    id: 'end_meet',
    label: 'End Meet (Inward Sweep & Center Burst)',
    description:
      'Sweeps left-to-right, then both outer ends meet at center and burst outward with music bloom',
    reactive: true,
  },
  {
    id: 'sparkle',
    label: 'Sparkle / Playful (Random Flashes)',
    description: 'Twinkle and playful random multi-relay flashes across 16 channels',
    reactive: false,
  },
  {
    id: 'chase3',
    label: 'Chase 3 (Running Trail)',
    description: '3-relay continuous chasing trail across channels',
    reactive: false,
  },
  {
    id: 'alternate',
    label: 'Alternate (Odd / Even & Party Beat)',
    description:
      'Odd vs Even relays alternating on step, with an all-strip hit every 8th step',
    reactive: false,
  },
];

const MIN_SPEED_MS = 100;
const MAX_SPEED_MS = 600;
const SPEED_PRESETS_MS = [120, 160, 200, 240, 300, 400];

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
  const [subnetPrefix, setSubnetPrefix] = useState<string>('10.241.48');
  const [editingUnitId, setEditingUnitId] = useState<number | null>(null);
  const [editingIpText, setEditingIpText] = useState<string>('');
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [selectedPattern, setSelectedPattern] =
    useState<string>('combo_adaptive');
  const [speedMode, setSpeedMode] = useState<'auto' | 'manual'>('auto');
  const [stepMs, setStepMs] = useState<number>(220);
  const [liveStepMs, setLiveStepMs] = useState<number>(220);
  const [isDraggingSpeed, setIsDraggingSpeed] = useState<boolean>(false);
  const [musicMetrics, setMusicMetrics] = useState<{
    b: number;
    bt: number;
    r: number;
  }>({ b: 0, bt: 0, r: 0 });
  const [logs, setLogs] = useState<TelemetryLog[]>(() => [
    {
      id: 'init-1',
      timestamp: new Date().toLocaleTimeString(),
      direction: 'SYS',
      text: 'Ready — Scan DunkinNetwork hotspot to sync all ESP32s with music',
    },
  ]);

  const webViewRef = useRef<any>(null);
  const unitsRef = useRef<Esp32Unit[]>(units);
  const selectedPatternRef = useRef<string>(selectedPattern);
  const speedModeRef = useRef<'auto' | 'manual'>('auto');
  const stepMsRef = useRef<number>(stepMs);
  const sliderWidthRef = useRef<number>(260);
  const lastSpeedBroadcastRef = useRef<number>(0);
  const detectedSubnetsRef = useRef<Set<string>>(new Set());
  const musicStreamBusyRef = useRef<boolean>(false);

  useEffect(() => {
    unitsRef.current = units;
  }, [units]);

  useEffect(() => {
    selectedPatternRef.current = selectedPattern;
  }, [selectedPattern]);

  useEffect(() => {
    speedModeRef.current = speedMode;
  }, [speedMode]);

  useEffect(() => {
    stepMsRef.current = stepMs;
    if (!isPlaying) {
      setLiveStepMs(stepMs);
    }
  }, [stepMs, isPlaying]);

  const addLog = useCallback(
    (direction: 'TX' | 'RX' | 'SYS', text: string) => {
      const entry: TelemetryLog = {
        id: `${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        timestamp: new Date().toLocaleTimeString(),
        direction,
        text,
      };
      setLogs((prev) => [entry, ...prev.slice(0, 14)]);
    },
    []
  );

  const onlineUnits = units.filter((u) => u.online);
  const onlineCount = onlineUnits.length;

  // Ping a single ESP32 unit (/ping or /status) without toggling any relays
  const pingSingleUnit = useCallback(async (unit: Esp32Unit): Promise<boolean> => {
    try {
      const res = await fetchWithTimeout(`http://${unit.ip}/ping`, 1000);
      if (!res.ok) return false;
      const data = await res.json();
      setUnits((prev) =>
        prev.map((u) =>
          u.unitId === unit.unitId
            ? {
                ...u,
                online: true,
                playing: Boolean(data.running ?? data.playing),
              }
            : u
        )
      );
      return true;
    } catch {
      setUnits((prev) =>
        prev.map((u) =>
          u.unitId === unit.unitId ? { ...u, online: false, playing: false } : u
        )
      );
      return false;
    }
  }, []);

  // Broadcast PLAY + pattern + speed to ALL ESP32 units simultaneously
  const broadcastPlayAll = useCallback(
    async (pat?: string, ms?: number) => {
      const patternToUse = pat || selectedPatternRef.current;
      const speedToUse = ms || stepMsRef.current;
      const currentUnits = unitsRef.current;

      const results = await Promise.all(
        currentUnits.map(async (u) => {
          try {
            const res = await fetchWithTimeout(
              `http://${u.ip}/play?pattern=${encodeURIComponent(
                patternToUse
              )}&ms=${speedToUse}&auto=${speedModeRef.current === 'auto' ? 1 : 0}`,
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
          } catch {
            // offline
          }
          return false;
        })
      );

      const synced = results.filter(Boolean).length;
      addLog(
        'TX',
        `PLAY synced on ${synced}/${currentUnits.length} ESP32s (${patternToUse}, ${speedToUse}ms)`
      );
    },
    [addLog]
  );

  // Broadcast STOP to ALL ESP32 units simultaneously (all relays OFF)
  const broadcastStopAll = useCallback(async () => {
    const currentUnits = unitsRef.current;
    setUnits((prev) => prev.map((u) => ({ ...u, playing: false })));
    await Promise.all(
      currentUnits.map(async (u) => {
        try {
          const res = await fetchWithTimeout(`http://${u.ip}/stop`, 1200);
          if (res.ok) {
            setUnits((prev) =>
              prev.map((item) =>
                item.unitId === u.unitId
                  ? { ...item, online: true, playing: false }
                  : item
              )
            );
          }
        } catch {
          // ignore offline
        }
      })
    );
    addLog('TX', 'STOP broadcast >> All ESP32 relays OFF');
  }, [addLog]);

  // Ping all configured ESP32 unit IPs (no relay testing)
  const handlePingAllUnits = async () => {
    setIsScanning(true);
    addLog('TX', 'Pinging all 10 ESP32 units (/ping)...');
    const results = await Promise.all(units.map((u) => pingSingleUnit(u)));
    const count = results.filter(Boolean).length;
    setIsScanning(false);
    addLog('RX', `Ping complete: ${count}/10 ESP32 units online`);
  };

  // Multi-ESP32 Hotspot Scanner: discovers all ESP32s on any phone hotspot subnet
  const handleScanHotspot = async () => {
    setIsScanning(true);
    webViewRef.current?.injectJavaScript?.(
      'window.detectPhoneHotspotSubnets && window.detectPhoneHotspotSubnets();'
    );

    const rawInput = subnetPrefix.trim().replace(/\.$/, '');
    const inputParts = rawInput.split('.');
    const cleanPrefix =
      inputParts.length >= 4
        ? `${inputParts[0]}.${inputParts[1]}.${inputParts[2]}`
        : rawInput;
    const explicitFullIp = inputParts.length === 4 ? rawInput : null;
    if (cleanPrefix !== subnetPrefix) {
      setSubnetPrefix(cleanPrefix);
    }

    addLog('SYS', `Scanning hotspot subnet ${cleanPrefix}.x for ESP32 units...`);

    const discoveredIps = new Set<string>();
    const claimedSlots = new Map<number, string>();
    const learnedSubnets = new Set<string>();

    const assignDiscoveredUnit = (
      ip: string,
      reportedUnitId: number | null,
      playing: boolean
    ) => {
      if (discoveredIps.has(ip)) return;
      discoveredIps.add(ip);

      const p = ip.trim().split('.');
      if (p.length === 4) {
        const sub = `${p[0]}.${p[1]}.${p[2]}`;
        learnedSubnets.add(sub);
        setSubnetPrefix(sub);
      }

      let targetSlot =
        reportedUnitId && reportedUnitId >= 1 && reportedUnitId <= 10
          ? reportedUnitId
          : 1;

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
            ? { ...u, ip, online: true, playing }
            : u
        )
      );

      const slotName = `UNIT-${targetSlot < 10 ? '0' : ''}${targetSlot}`;
      addLog('RX', `✓ Connected ${slotName} at ${ip}`);

      // Push current pattern & speed to newly discovered unit
      fetchWithTimeout(
        `http://${ip}/pattern?name=${encodeURIComponent(
          selectedPatternRef.current
        )}`,
        800
      ).catch(() => {});
      fetchWithTimeout(`http://${ip}/speed?ms=${stepMsRef.current}`, 800).catch(
        () => {}
      );
    };

    const probeHost = async (hostOrIp: string, timeout = 800) => {
      try {
        const res = await fetchWithTimeout(`http://${hostOrIp}/ping`, timeout);
        if (res.ok) {
          const data = await res.json();
          const realIp =
            typeof data.ip === 'string' && data.ip.split('.').length === 4
              ? data.ip
              : hostOrIp;
          const uid = typeof data.unitId === 'number' ? data.unitId : null;
          assignDiscoveredUnit(
            realIp,
            uid,
            Boolean(data.running ?? data.playing)
          );
        }
      } catch {
        // ignore
      }
    };

    // Phase 1: Probe mDNS & configured unit IPs
    const mdnsHosts: string[] = ['dunkin-esp32.local'];
    for (let u = 1; u <= 10; u++) {
      const pad = u < 10 ? `0${u}` : `${u}`;
      mdnsHosts.push(`dunkin-u${pad}.local`);
    }
    const fastTargets = Array.from(
      new Set([
        ...(explicitFullIp ? [explicitFullIp] : []),
        ...units.map((u) => u.ip).filter(Boolean),
        ...mdnsHosts,
      ])
    );

    await Promise.all(fastTargets.map((t) => probeHost(t, 1000)));

    // Phase 2: Sweep hotspot subnets for all ESP32s (.2 .. .254)
    const candidateSubnets = Array.from(
      new Set([
        ...Array.from(learnedSubnets),
        ...Array.from(detectedSubnetsRef.current),
        cleanPrefix,
        '192.168.43',
        '192.168.137',
        '192.168.50',
        '192.168.4',
        '192.168.8',
        '192.168.1',
        '172.20.10',
      ])
    ).filter((s) => s.split('.').length === 3);

    const sweepSubnet = async (sub: string) => {
      const ips: string[] = [];
      for (let h = 2; h <= 254; h++) {
        const ip = `${sub}.${h}`;
        if (!discoveredIps.has(ip)) {
          ips.push(ip);
        }
      }
      const batchSize = 20;
      for (let i = 0; i < ips.length; i += batchSize) {
        const batch = ips.slice(i, i + batchSize);
        await Promise.all(batch.map((ip) => probeHost(ip, 700)));
      }
    };

    const primarySub = candidateSubnets[0] || cleanPrefix;
    await sweepSubnet(primarySub);

    if (discoveredIps.size === 0) {
      for (let idx = 1; idx < candidateSubnets.length; idx++) {
        await sweepSubnet(candidateSubnets[idx]);
        if (discoveredIps.size > 0) break;
      }
    }

    setUnits((prev) =>
      prev.map((u) =>
        claimedSlots.has(u.unitId) ? u : { ...u, online: false, playing: false }
      )
    );
    setIsScanning(false);
    addLog(
      'SYS',
      `Scan complete: ${discoveredIps.size} ESP32 unit(s) connected`
    );
  };

  // Ping configured units on mount
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

  // Select pattern and broadcast to all connected ESP32s
  const handleSelectPattern = async (patternId: string) => {
    setSelectedPattern(patternId);
    selectedPatternRef.current = patternId;
    const targets = unitsRef.current.filter((u) => u.online);
    const list = targets.length > 0 ? targets : unitsRef.current;

    if (isPlaying) {
      await broadcastPlayAll(patternId, stepMsRef.current);
      return;
    }

    await Promise.all(
      list.map((u) =>
        fetchWithTimeout(
          `http://${u.ip}/pattern?name=${encodeURIComponent(patternId)}`,
          900
        ).catch(() => {})
      )
    );
    addLog('TX', `Broadcast pattern "${patternId}" to all ESP32s`);
  };

  // Toggle between ⚡ AUTO (Music Beat Sync) and 🎛️ MANUAL (Slider / Preset)
  const handleSetSpeedMode = useCallback(
    async (mode: 'auto' | 'manual') => {
      setSpeedMode(mode);
      speedModeRef.current = mode;
      const isAuto = mode === 'auto';
      const targets = unitsRef.current.filter((u) => u.online);
      const list = targets.length > 0 ? targets : unitsRef.current;

      await Promise.all(
        list.map((u) =>
          fetchWithTimeout(
            `http://${u.ip}/speed?auto=${isAuto ? 1 : 0}&ms=${stepMsRef.current}`,
            800
          ).catch(() => {})
        )
      );
      addLog(
        'TX',
        isAuto
          ? 'Switched to ⚡ AUTO (Music Beat Sync) mode'
          : `Switched to 🎛️ MANUAL (${stepMsRef.current}ms fixed) mode`
      );
    },
    [addLog]
  );

  // Select step speed (ms) and broadcast to all connected ESP32s
  const handleSelectSpeed = useCallback(
    async (ms: number, logChange = true, switchToManual = false) => {
      const clamped = Math.max(MIN_SPEED_MS, Math.min(MAX_SPEED_MS, Math.round(ms)));
      setStepMs(clamped);
      stepMsRef.current = clamped;

      if (switchToManual && speedModeRef.current !== 'manual') {
        setSpeedMode('manual');
        speedModeRef.current = 'manual';
      }

      const isAuto = speedModeRef.current === 'auto';
      const targets = unitsRef.current.filter((u) => u.online);
      const list = targets.length > 0 ? targets : unitsRef.current;

      await Promise.all(
        list.map((u) =>
          fetchWithTimeout(
            `http://${u.ip}/speed?ms=${clamped}&auto=${isAuto ? 1 : 0}`,
            800
          ).catch(() => {})
        )
      );
      if (logChange) {
        addLog(
          'TX',
          isAuto
            ? `Updated Base Speed ${clamped}ms (Auto Mode)`
            : `Set Manual Speed ${clamped}ms (Fixed)`
        );
      }
    },
    [addLog]
  );

  const computeMsFromTouchX = (locationX: number): number => {
    const width = Math.max(1, sliderWidthRef.current);
    const ratio = Math.max(0, Math.min(1, locationX / width));
    return Math.round(
      MIN_SPEED_MS + ratio * (MAX_SPEED_MS - MIN_SPEED_MS)
    );
  };

  const handleSpeedDragMove = (locationX: number) => {
    const nextMs = computeMsFromTouchX(locationX);
    setStepMs(nextMs);
    stepMsRef.current = nextMs;
    if (speedModeRef.current !== 'manual') {
      setSpeedMode('manual');
      speedModeRef.current = 'manual';
    }
    const now = Date.now();
    if (now - lastSpeedBroadcastRef.current >= 120) {
      lastSpeedBroadcastRef.current = now;
      handleSelectSpeed(nextMs, false, true);
    }
  };

  const handleSpeedDragEnd = (locationX: number) => {
    setIsDraggingSpeed(false);
    const finalMs = computeMsFromTouchX(locationX);
    handleSelectSpeed(finalMs, true, true);
  };

  // Master START / STOP: starts/stops music AND all ESP32s simultaneously in sync
  const handleToggleMasterShow = async () => {
    const nextState = !isPlaying;
    if (!nextState) {
      setIsPlaying(false);
      setMusicMetrics({ b: 0, bt: 0, r: 0 });
      setLiveStepMs(stepMsRef.current);
      webViewRef.current?.injectJavaScript?.(
        'window.stopShowMusic && window.stopShowMusic();'
      );
      await broadcastStopAll();
      return;
    }

    setIsPlaying(true);
    setLiveStepMs(stepMsRef.current);
    webViewRef.current?.injectJavaScript?.(
      'window.startShowMusic && window.startShowMusic(false);'
    );
    await broadcastPlayAll();
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

  // Handle ~10 Hz reactive music packets from player.html and broadcast to all online ESP32s
  const handleAudioWebViewMessage = useCallback(
    (event: any) => {
      try {
        const raw = event?.nativeEvent?.data;
        if (!raw) return;
        const msg = JSON.parse(raw);

        if (msg.type === 'LOCAL_SUBNET' && typeof msg.subnet === 'string') {
          const sub = msg.subnet.trim();
          if (sub && !detectedSubnetsRef.current.has(sub)) {
            detectedSubnetsRef.current.add(sub);
            setSubnetPrefix(sub);
          }
          return;
        }

        if (msg.type === 'UI_TOGGLE_PLAY') {
          if (msg.playing) {
            setIsPlaying(true);
            setLiveStepMs(stepMsRef.current);
            broadcastPlayAll();
          } else {
            setIsPlaying(false);
            setMusicMetrics({ b: 0, bt: 0, r: 0 });
            setLiveStepMs(stepMsRef.current);
            broadcastStopAll();
          }
          return;
        }

        if (msg.type === 'MUSIC_STREAM' && msg.playing) {
          const b = Number(msg.b) || 0;
          const bt = Number(msg.bt) || 0;
          const r = Number(msg.r) || 0;
          setMusicMetrics({ b, bt, r });

          const isAuto = speedModeRef.current === 'auto';

          // When in Auto Mode: dynamically calculate accurate musical tempo ms (on beat, no flicker)
          const energy = Math.min(100, Math.max(0, b * 0.45 + bt * 0.35 + r * 0.20));
          let factor = 1.0;
          if (energy >= 50) {
            factor = 1.0 - ((energy - 50) / 50) * 0.25; // Speed up on energetic drops (up to 25% faster -> ~165ms)
          } else {
            factor = 1.0 + ((50 - energy) / 50) * 0.35; // Slow down on calm breakdowns (up to 35% slower -> ~295ms)
          }
          const dynamicMs = Math.max(140, Math.min(600, Math.round(stepMsRef.current * factor)));
          if (isAuto) {
            setLiveStepMs(dynamicMs);
          } else {
            setLiveStepMs(stepMsRef.current);
          }

          if (!musicStreamBusyRef.current) {
            const activeTargets = unitsRef.current.filter((u) => u.online);
            if (activeTargets.length > 0) {
              musicStreamBusyRef.current = true;
              Promise.all(
                activeTargets.map((u) =>
                  fetchWithTimeout(
                    `http://${u.ip}/music?b=${b}&bt=${bt}&r=${r}&ms=${isAuto ? dynamicMs : stepMsRef.current}&auto=${isAuto ? 1 : 0}`,
                    400
                  ).catch(() => {})
                )
              ).finally(() => {
                musicStreamBusyRef.current = false;
              });
            }
          }
        }
      } catch {
        // ignore malformed message
      }
    },
    [broadcastPlayAll, broadcastStopAll]
  );

  return (
    <View style={styles.safeArea}>
      <StatusBar style="light" />

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        scrollEnabled={!isDraggingSpeed}
      >
        {/* HEADER */}
        <View style={styles.header}>
          <View style={styles.headerTitleRow}>
            <Text style={styles.brandTag}>MUSIC LIGHT SYNC</Text>
            <View
              style={[
                styles.statusBadge,
                onlineCount > 0
                  ? styles.statusBadgeOnline
                  : styles.statusBadgeOffline,
              ]}
            >
              <View
                style={[
                  styles.statusDot,
                  onlineCount > 0 ? styles.dotOnline : styles.dotOffline,
                ]}
              />
              <Text
                style={[
                  styles.statusBadgeText,
                  onlineCount > 0 ? styles.textOnline : styles.textOffline,
                ]}
              >
                {`${onlineCount}/10 ESP32 ONLINE`}
              </Text>
            </View>
          </View>
          <Text style={styles.headerSubtitle}>
            Multi-ESP32 Sync • 16-Channel Relay Pattern Engine
          </Text>
        </View>

        {/* 1. MUSIC PLAYER CARD */}
        <View style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <Text style={styles.cardTitle}>
              🎵 Music Player (2026 Christmas Lighting)
            </Text>
            <View style={styles.pillBadge}>
              <Text style={styles.pillBadgeText}>10 Hz AUDIO SYNC</Text>
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
            <View style={styles.infoBox}>
              <Text style={styles.infoBoxText}>
                Loaded: 2026 Christmas Lighting Songs.mp3
              </Text>
            </View>
          )}

          {/* LIVE REACTIVE METERS (BASS / BEAT / RMS STREAMED TO ALL ESP32s) */}
          <View style={styles.metersRow}>
            <View style={styles.meterCol}>
              <View style={styles.meterLabelRow}>
                <Text style={styles.meterLabel}>BASS</Text>
                <Text style={styles.meterValue}>{musicMetrics.b}%</Text>
              </View>
              <View style={styles.meterTrack}>
                <View
                  style={[
                    styles.meterFill,
                    {
                      width: `${Math.min(100, musicMetrics.b)}%`,
                      backgroundColor: '#FF5263',
                    },
                  ]}
                />
              </View>
            </View>

            <View style={styles.meterCol}>
              <View style={styles.meterLabelRow}>
                <Text style={styles.meterLabel}>BEAT</Text>
                <Text style={styles.meterValue}>{musicMetrics.bt}%</Text>
              </View>
              <View style={styles.meterTrack}>
                <View
                  style={[
                    styles.meterFill,
                    {
                      width: `${Math.min(100, musicMetrics.bt)}%`,
                      backgroundColor: '#FDB913',
                    },
                  ]}
                />
              </View>
            </View>

            <View style={styles.meterCol}>
              <View style={styles.meterLabelRow}>
                <Text style={styles.meterLabel}>LEVEL</Text>
                <Text style={styles.meterValue}>{musicMetrics.r}%</Text>
              </View>
              <View style={styles.meterTrack}>
                <View
                  style={[
                    styles.meterFill,
                    {
                      width: `${Math.min(100, musicMetrics.r)}%`,
                      backgroundColor: '#38BDF8',
                    },
                  ]}
                />
              </View>
            </View>
          </View>
        </View>

        {/* 2. START / STOP LIGHT SHOW SYNC IN MUSIC (ALL ESP32s) */}
        <View style={styles.masterActionContainer}>
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={handleToggleMasterShow}
            style={[
              styles.masterButton,
              !isPlaying ? styles.masterButtonReady : styles.masterButtonStop,
            ]}
          >
            <Text
              style={[
                styles.masterButtonTitle,
                isPlaying && styles.masterButtonTitleStop,
              ]}
            >
              {isPlaying
                ? '⏹ STOP MUSIC & ALL ESP32 LIGHTS'
                : '▶ START LIGHT SHOW SYNC IN MUSIC'}
            </Text>
            <Text
              style={[
                styles.masterButtonSub,
                isPlaying && styles.masterButtonSubStop,
              ]}
            >
              {isPlaying
                ? `Playing • ${speedMode === 'auto' ? `Auto Sync: ${liveStepMs} ms (Beat Phase-Locked)` : `Manual Fixed: ${stepMs} ms`}`
                : `Plays music & syncs all connected ESP32s ("${selectedPattern}", ${speedMode === 'auto' ? 'Auto Beat Sync' : `${stepMs}ms`})`}
            </Text>
          </TouchableOpacity>
        </View>

        {/* 3. MULTI-ESP32 HOTSPOT SCANNER & CONNECTION LIST (NO RELAY TESTING) */}
        <View style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <Text style={styles.cardTitle}>
              📡 Connect Multiple ESP32s (DunkinNetwork)
            </Text>
            <Text style={styles.portHintText}>{onlineCount}/10 Connected</Text>
          </View>

          <View style={styles.scanRow}>
            <View style={styles.subnetFieldBox}>
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
              style={[styles.pingButton, isScanning && styles.buttonDisabled]}
              disabled={isScanning}
              activeOpacity={0.8}
              onPress={handlePingAllUnits}
            >
              <Text style={styles.buttonText}>📡 Ping 10</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.scanButton, isScanning && styles.buttonDisabled]}
              disabled={isScanning}
              activeOpacity={0.8}
              onPress={handleScanHotspot}
            >
              {isScanning ? (
                <View style={styles.scanLoadingRow}>
                  <ActivityIndicator size="small" color="#FFFFFF" />
                  <Text style={styles.buttonText}>Scanning</Text>
                </View>
              ) : (
                <Text style={styles.buttonText}>🔍 Scan Hotspot</Text>
              )}
            </TouchableOpacity>
          </View>

          {/* COMPACT MULTI-ESP32 CONNECTION STATUS LIST */}
          <View style={styles.unitsGrid}>
            {units.map((unit) => (
              <View
                key={unit.unitId}
                style={[
                  styles.unitRowCard,
                  unit.online ? styles.unitRowOnline : styles.unitRowOffline,
                ]}
              >
                <View style={styles.unitRowHeader}>
                  <View style={styles.unitLeftInfo}>
                    <View
                      style={[
                        styles.statusDot,
                        unit.online ? styles.dotOnline : styles.dotOffline,
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

                  <Text
                    style={[
                      styles.unitStateText,
                      unit.online ? styles.textOnline : styles.textOffline,
                    ]}
                  >
                    {unit.online
                      ? unit.playing
                        ? 'SYNCING'
                        : 'CONNECTED'
                      : 'OFFLINE'}
                  </Text>
                </View>

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
              </View>
            ))}
          </View>
        </View>

        {/* 4. ESP32 BUILT-IN RELAY PATTERN & SPEED ORCHESTRATION */}
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>
            ESP32 PATTERN ENGINE (MAX 8 RELAYS ON FOR POWER SAFETY):
          </Text>

          <View style={styles.speedRow}>
            {/* SPEED MODE SELECTOR: ⚡ AUTO vs 🎛️ MANUAL */}
            <View style={styles.speedModeToggleRow}>
              <TouchableOpacity
                style={[
                  styles.speedModeBtn,
                  speedMode === 'auto' && styles.speedModeBtnActiveAuto,
                ]}
                onPress={() => handleSetSpeedMode('auto')}
                activeOpacity={0.8}
              >
                <Text
                  style={[
                    styles.speedModeBtnText,
                    speedMode === 'auto' && styles.speedModeBtnTextActiveAuto,
                  ]}
                >
                  ⚡ AUTO (Music Beat Sync)
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.speedModeBtn,
                  speedMode === 'manual' && styles.speedModeBtnActiveManual,
                ]}
                onPress={() => handleSetSpeedMode('manual')}
                activeOpacity={0.8}
              >
                <Text
                  style={[
                    styles.speedModeBtnText,
                    speedMode === 'manual' && styles.speedModeBtnTextActiveManual,
                  ]}
                >
                  🎛️ MANUAL (Slider / Preset)
                </Text>
              </TouchableOpacity>
            </View>

            <View style={styles.speedHeaderRow}>
              <Text style={styles.speedLabel}>
                {speedMode === 'auto'
                  ? 'Base Tempo (Auto-Scales with Energy):'
                  : 'Manual Fixed Speed (Exact Metronome):'}
              </Text>
              <View style={styles.speedFineRow}>
                <TouchableOpacity
                  style={styles.speedStepBtn}
                  activeOpacity={0.75}
                  onPress={() => handleSelectSpeed(stepMs - 5, true, true)}
                >
                  <Text style={styles.speedStepBtnText}>−5</Text>
                </TouchableOpacity>
                <View
                  style={[
                    styles.speedValueBadge,
                    speedMode === 'auto'
                      ? styles.speedValueBadgeAuto
                      : styles.speedValueBadgeManual,
                  ]}
                >
                  <Text
                    style={[
                      styles.speedValueBadgeText,
                      speedMode === 'auto'
                        ? styles.speedValueBadgeTextAuto
                        : styles.speedValueBadgeTextManual,
                    ]}
                  >
                    {speedMode === 'auto'
                      ? isPlaying
                        ? `⚡ Auto: ${liveStepMs} ms (On Beat)`
                        : `⚡ Auto: ${stepMs} ms (Ready)`
                      : `🎛️ Manual: ${stepMs} ms`}
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.speedStepBtn}
                  activeOpacity={0.75}
                  onPress={() => handleSelectSpeed(stepMs + 5, true, true)}
                >
                  <Text style={styles.speedStepBtnText}>+5</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* DRAGGABLE SPEED SLIDER TRACK (30ms .. 500ms) */}
            <View
              style={styles.sliderTouchArea}
              onLayout={(e) => {
                if (e.nativeEvent.layout.width > 0) {
                  sliderWidthRef.current = e.nativeEvent.layout.width;
                }
              }}
              onStartShouldSetResponder={() => true}
              onMoveShouldSetResponder={() => true}
              onResponderTerminationRequest={() => false}
              onResponderGrant={(e) => {
                setIsDraggingSpeed(true);
                handleSpeedDragMove(e.nativeEvent.locationX);
              }}
              onResponderMove={(e) => {
                handleSpeedDragMove(e.nativeEvent.locationX);
              }}
              onResponderRelease={(e) => {
                handleSpeedDragEnd(e.nativeEvent.locationX);
              }}
              onResponderTerminate={() => {
                setIsDraggingSpeed(false);
              }}
            >
              <View pointerEvents="none" style={styles.sliderTrack}>
                <View
                  pointerEvents="none"
                  style={[
                    styles.sliderFill,
                    {
                      width: `${Math.max(
                        0,
                        Math.min(
                          100,
                          ((stepMs - MIN_SPEED_MS) /
                            (MAX_SPEED_MS - MIN_SPEED_MS)) *
                            100
                        )
                      )}%`,
                    },
                  ]}
                />
              </View>
              <View
                pointerEvents="none"
                style={[
                  styles.sliderThumb,
                  {
                    left: `${Math.max(
                      0,
                      Math.min(
                        100,
                        ((stepMs - MIN_SPEED_MS) /
                          (MAX_SPEED_MS - MIN_SPEED_MS)) *
                          100
                      )
                    )}%`,
                  },
                ]}
              />
            </View>

            <View style={styles.sliderScaleRow}>
              <Text style={styles.sliderScaleText}>100ms (Fast)</Text>
              <Text style={styles.sliderScaleText}>220ms (Groove)</Text>
              <Text style={styles.sliderScaleText}>600ms (Slow)</Text>
            </View>

            <View style={styles.speedPillsWrap}>
              {SPEED_PRESETS_MS.map((ms) => {
                const active = speedMode === 'manual' && stepMs === ms;
                return (
                  <TouchableOpacity
                    key={ms}
                    activeOpacity={0.8}
                    onPress={() => handleSelectSpeed(ms, true, true)}
                    style={[
                      styles.speedPill,
                      active && styles.speedPillActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.speedPillText,
                        active && styles.speedPillTextActive,
                      ]}
                    >
                      {ms}ms
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {ESP32_PATTERNS.map((pat) => {
            const selected = pat.id === selectedPattern;
            return (
              <TouchableOpacity
                key={pat.id}
                activeOpacity={0.8}
                onPress={() => handleSelectPattern(pat.id)}
                style={[
                  styles.patternCard,
                  selected && styles.patternCardSelected,
                ]}
              >
                <View style={styles.patternInfo}>
                  <Text
                    style={[
                      styles.patternTitle,
                      selected && styles.patternTitleSelected,
                    ]}
                  >
                    {pat.label}
                  </Text>
                  <Text style={styles.patternDesc}>{pat.description}</Text>
                </View>
                <View
                  style={[
                    styles.patternBadge,
                    pat.reactive
                      ? styles.patternBadgeReactive
                      : styles.patternBadgeStandard,
                    selected && styles.patternBadgeSelected,
                  ]}
                >
                  <Text
                    style={[
                      styles.patternBadgeText,
                      selected && styles.patternBadgeTextSelected,
                    ]}
                  >
                    {pat.reactive ? 'MUSIC REACTIVE' : pat.id}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* TELEMETRY LOG */}
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>CONNECTION & SYNC LOG:</Text>
          <View style={styles.logContainer}>
            {logs.slice(0, 5).map((log) => (
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
    paddingBottom: 36,
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
    fontSize: 20,
    fontWeight: '900',
    letterSpacing: 1,
  },
  headerSubtitle: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '600',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
  },
  statusBadgeOnline: {
    backgroundColor: 'rgba(16, 185, 129, 0.14)',
    borderColor: 'rgba(16, 185, 129, 0.45)',
  },
  statusBadgeOffline: {
    backgroundColor: 'rgba(239, 68, 68, 0.14)',
    borderColor: 'rgba(239, 68, 68, 0.45)',
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  dotOnline: {
    backgroundColor: '#10B981',
  },
  dotOffline: {
    backgroundColor: '#EF4444',
  },
  statusBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  textOnline: {
    color: '#10B981',
  },
  textOffline: {
    color: '#EF4444',
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
  portHintText: {
    color: '#FDB913',
    fontSize: 11,
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
  infoBox: {
    backgroundColor: '#0B1120',
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  infoBoxText: {
    color: '#CBD5E1',
    fontSize: 12,
  },
  metersRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
  },
  meterCol: {
    flex: 1,
  },
  meterLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  meterLabel: {
    color: '#94A3B8',
    fontSize: 10,
    fontWeight: '800',
  },
  meterValue: {
    color: '#E2E8F0',
    fontSize: 10,
    fontWeight: '700',
  },
  meterTrack: {
    height: 7,
    backgroundColor: '#1E293B',
    borderRadius: 4,
    overflow: 'hidden',
  },
  meterFill: {
    height: '100%',
    borderRadius: 4,
  },
  masterActionContainer: {
    width: '100%',
    marginBottom: 14,
  },
  masterButton: {
    width: '100%',
    paddingVertical: 18,
    paddingHorizontal: 16,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
  },
  masterButtonReady: {
    backgroundColor: '#10B981',
    borderColor: '#34D399',
  },
  masterButtonStop: {
    backgroundColor: '#EF4444',
    borderColor: '#F87171',
  },
  masterButtonTitle: {
    color: '#042F2E',
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 0.6,
    marginBottom: 3,
  },
  masterButtonTitleStop: {
    color: '#FFFFFF',
  },
  masterButtonSub: {
    color: '#064E3B',
    fontSize: 11,
    fontWeight: '700',
  },
  masterButtonSubStop: {
    color: '#FEE2E2',
  },
  scanRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  subnetFieldBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0B1120',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#334155',
  },
  subnetLabel: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '700',
    marginRight: 6,
  },
  subnetInput: {
    flex: 1,
    color: '#F8FAFC',
    fontSize: 13,
    fontWeight: '700',
    padding: 0,
  },
  pingButton: {
    backgroundColor: '#0284C7',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanButton: {
    backgroundColor: '#FF671F',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  scanLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
  },
  unitsGrid: {
    gap: 6,
  },
  unitRowCard: {
    backgroundColor: '#0B1120',
    borderRadius: 10,
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderWidth: 1,
  },
  unitRowOnline: {
    borderColor: 'rgba(16, 185, 129, 0.45)',
  },
  unitRowOffline: {
    borderColor: '#1E293B',
  },
  unitRowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  unitLeftInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  unitNameText: {
    color: '#F8FAFC',
    fontSize: 13,
    fontWeight: '800',
    marginRight: 8,
  },
  ipPill: {
    backgroundColor: '#1E293B',
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#334155',
  },
  ipPillText: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '600',
  },
  unitStateText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  editIpRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
  editIpInput: {
    flex: 1,
    backgroundColor: '#111827',
    color: '#F8FAFC',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 12,
    borderWidth: 1,
    borderColor: '#334155',
  },
  saveIpButton: {
    backgroundColor: '#10B981',
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  saveIpButtonText: {
    color: '#042F2E',
    fontSize: 11,
    fontWeight: '800',
  },
  sectionLabel: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
    marginBottom: 10,
  },
  speedRow: {
    marginBottom: 14,
    backgroundColor: '#0B1120',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  speedModeToggleRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  speedModeBtn: {
    flex: 1,
    paddingVertical: 9,
    paddingHorizontal: 8,
    borderRadius: 8,
    backgroundColor: '#0F172A',
    borderWidth: 1.5,
    borderColor: '#334155',
    alignItems: 'center',
    justifyContent: 'center',
  },
  speedModeBtnActiveAuto: {
    backgroundColor: 'rgba(0, 229, 255, 0.15)',
    borderColor: '#00E5FF',
  },
  speedModeBtnActiveManual: {
    backgroundColor: 'rgba(255, 103, 31, 0.2)',
    borderColor: '#FF671F',
  },
  speedModeBtnText: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '800',
  },
  speedModeBtnTextActiveAuto: {
    color: '#00E5FF',
    fontWeight: '900',
  },
  speedModeBtnTextActiveManual: {
    color: '#FDB913',
    fontWeight: '900',
  },
  speedHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  speedLabel: {
    color: '#CBD5E1',
    fontSize: 12,
    fontWeight: '700',
  },
  speedFineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  speedStepBtn: {
    backgroundColor: '#1E293B',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#334155',
  },
  speedStepBtnText: {
    color: '#E2E8F0',
    fontSize: 11,
    fontWeight: '800',
  },
  speedValueBadge: {
    backgroundColor: 'rgba(255, 103, 31, 0.2)',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#FF671F',
  },
  speedValueBadgeAuto: {
    backgroundColor: 'rgba(0, 229, 255, 0.2)',
    borderColor: '#00E5FF',
  },
  speedValueBadgeManual: {
    backgroundColor: 'rgba(255, 103, 31, 0.2)',
    borderColor: '#FF671F',
  },
  speedValueBadgeText: {
    color: '#FDB913',
    fontSize: 12,
    fontWeight: '900',
  },
  speedValueBadgeTextAuto: {
    color: '#00E5FF',
  },
  speedValueBadgeTextManual: {
    color: '#FDB913',
  },
  sliderTouchArea: {
    width: '100%',
    height: 34,
    justifyContent: 'center',
    position: 'relative',
  },
  sliderTrack: {
    width: '100%',
    height: 10,
    backgroundColor: '#1E293B',
    borderRadius: 5,
    overflow: 'hidden',
  },
  sliderFill: {
    height: '100%',
    backgroundColor: '#FF671F',
    borderRadius: 5,
  },
  sliderThumb: {
    position: 'absolute',
    width: 22,
    height: 22,
    marginLeft: -11,
    borderRadius: 11,
    backgroundColor: '#FDB913',
    borderWidth: 2.5,
    borderColor: '#FFFFFF',
  },
  sliderScaleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 2,
    marginBottom: 10,
  },
  sliderScaleText: {
    color: '#64748B',
    fontSize: 10,
    fontWeight: '600',
  },
  speedPillsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  speedPill: {
    backgroundColor: '#1E293B',
    paddingVertical: 6,
    paddingHorizontal: 11,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
  },
  speedPillActive: {
    backgroundColor: 'rgba(255, 103, 31, 0.2)',
    borderColor: '#FF671F',
  },
  speedPillText: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '700',
  },
  speedPillTextActive: {
    color: '#FDB913',
    fontWeight: '900',
  },
  patternCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#1E293B',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    marginBottom: 8,
    borderWidth: 1.5,
    borderColor: '#334155',
  },
  patternCardSelected: {
    backgroundColor: 'rgba(255, 103, 31, 0.14)',
    borderColor: '#FF671F',
  },
  patternInfo: {
    flex: 1,
    paddingRight: 8,
  },
  patternTitle: {
    color: '#F8FAFC',
    fontSize: 13,
    fontWeight: '800',
    marginBottom: 2,
  },
  patternTitleSelected: {
    color: '#FF671F',
  },
  patternDesc: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '500',
  },
  patternBadge: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 6,
  },
  patternBadgeReactive: {
    backgroundColor: 'rgba(16, 185, 129, 0.16)',
  },
  patternBadgeStandard: {
    backgroundColor: '#0F172A',
  },
  patternBadgeSelected: {
    backgroundColor: '#FF671F',
  },
  patternBadgeText: {
    color: '#CBD5E1',
    fontSize: 9,
    fontWeight: '800',
  },
  patternBadgeTextSelected: {
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
    marginBottom: 5,
  },
  logTime: {
    color: '#64748B',
    fontSize: 10,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    marginRight: 6,
  },
  logTag: {
    fontSize: 9,
    fontWeight: '800',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
    marginRight: 6,
    overflow: 'hidden',
  },
  logTx: {
    backgroundColor: 'rgba(255, 103, 31, 0.2)',
    color: '#FF671F',
  },
  logRx: {
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    color: '#10B981',
  },
  logSys: {
    backgroundColor: 'rgba(56, 189, 248, 0.2)',
    color: '#38BDF8',
  },
  logText: {
    color: '#CBD5E1',
    fontSize: 11,
    flex: 1,
  },
});
