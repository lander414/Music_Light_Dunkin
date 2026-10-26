import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  Platform,
  ScrollView,
  Animated,
  ActivityIndicator,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';

// Default ESP32 SoftAP WebSocket endpoint (update if using local LAN IP)
const ESP32_WS_URL = 'ws://192.168.4.1:81';
const HEARTBEAT_INTERVAL_MS = 2000;
const HEARTBEAT_TIMEOUT_MS = 3500;

export type SimMode = 'sim-connected' | 'sim-disconnected' | 'live';

interface PacketLog {
  id: string;
  timestamp: string;
  direction: 'TX' | 'RX' | 'SYS';
  text: string;
}

export default function App() {
  // Mode selection: default to 'sim-connected' so the user can test the app immediately
  const [simMode, setSimMode] = useState<SimMode>('sim-connected');
  const [liveConnected, setLiveConnected] = useState<boolean>(false);
  const [retryTrigger, setRetryTrigger] = useState<number>(0);
  const [isRetrying, setIsRetrying] = useState<boolean>(false);
  const [retryNotice, setRetryNotice] = useState<string | null>(null);
  const [isLightShowRunning, setIsLightShowRunning] = useState<boolean>(false);
  const [packetLogs, setPacketLogs] = useState<PacketLog[]>(() => [
    {
      id: '1',
      timestamp: new Date().toLocaleTimeString(),
      direction: 'SYS',
      text: 'ESP32 Simulator ready • Link simulated as Connected',
    },
  ]);

  // Derived connection state: never set synchronously in effects
  const isConnected =
    simMode === 'sim-connected'
      ? true
      : simMode === 'sim-disconnected'
      ? false
      : liveConnected;

  const wsRef = useRef<WebSocket | null>(null);
  const lastSeenRef = useRef<number>(0);

  // Animated values using useState for React 19 compiler compatibility
  const [pulseAnim] = useState(() => new Animated.Value(1));
  const [barAnims] = useState(() => [
    new Animated.Value(0.3),
    new Animated.Value(0.7),
    new Animated.Value(0.4),
    new Animated.Value(0.9),
    new Animated.Value(0.5),
    new Animated.Value(0.8),
    new Animated.Value(0.35),
    new Animated.Value(0.65),
  ]);

  const addLog = useCallback(
    (direction: 'TX' | 'RX' | 'SYS', text: string) => {
      const newEntry: PacketLog = {
        id: `${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        timestamp: new Date().toLocaleTimeString(),
        direction,
        text,
      };
      setPacketLogs((prev) => [newEntry, ...prev.slice(0, 14)]);
    },
    []
  );

  // Animate the status beacon
  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.35,
          duration: 900,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 900,
          useNativeDriver: true,
        }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [pulseAnim]);

  // Animate the music light visualizer bars when running
  useEffect(() => {
    if (!isLightShowRunning) {
      barAnims.forEach((anim) => {
        Animated.timing(anim, {
          toValue: 0.25,
          duration: 300,
          useNativeDriver: true,
        }).start();
      });
      return;
    }

    const anims = barAnims.map((anim, i) => {
      return Animated.loop(
        Animated.sequence([
          Animated.timing(anim, {
            toValue: 0.35 + ((i * 17) % 65) / 100,
            duration: 220 + (i % 4) * 75,
            useNativeDriver: true,
          }),
          Animated.timing(anim, {
            toValue: 1.0,
            duration: 180 + ((i + 2) % 3) * 60,
            useNativeDriver: true,
          }),
          Animated.timing(anim, {
            toValue: 0.2 + (i % 3) * 0.1,
            duration: 250 + (i % 5) * 50,
            useNativeDriver: true,
          }),
        ])
      );
    });

    anims.forEach((a) => a.start());

    return () => {
      anims.forEach((a) => a.stop());
    };
  }, [isLightShowRunning, barAnims]);

  // Live WebSocket connection and heartbeat watchdog (active ONLY in 'live' mode)
  useEffect(() => {
    if (simMode !== 'live') {
      return;
    }

    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    let ws: WebSocket | null = null;

    const cleanup = () => {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
      if (ws) {
        ws.onopen = null;
        ws.onmessage = null;
        ws.onerror = null;
        ws.onclose = null;
        ws.close();
        ws = null;
      }
      wsRef.current = null;
    };

    try {
      ws = new WebSocket(ESP32_WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        lastSeenRef.current = Date.now();
        setLiveConnected(true);
        addLog('SYS', 'WebSocket connection established with ESP32');

        heartbeatTimer = setInterval(() => {
          const timeSinceLastAck = Date.now() - lastSeenRef.current;
          if (timeSinceLastAck > HEARTBEAT_TIMEOUT_MS) {
            setLiveConnected(false);
            addLog('SYS', 'Heartbeat timeout: ESP32 missed keep-alive');
            cleanup();
            return;
          }

          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'PING' }));
          }
        }, HEARTBEAT_INTERVAL_MS);
      };

      ws.onmessage = (event) => {
        lastSeenRef.current = Date.now();
        addLog('RX', typeof event.data === 'string' ? event.data : 'Data packet received');
      };

      ws.onerror = () => {
        setLiveConnected(false);
        addLog('SYS', 'WebSocket connection error');
      };

      ws.onclose = () => {
        setLiveConnected(false);
        setIsLightShowRunning(false);
        addLog('SYS', 'WebSocket closed');
        cleanup();
      };
    } catch {
      // Failed to initialize WebSocket
    }

    return cleanup;
  }, [simMode, retryTrigger, addLog]);

  // Switch simulation mode
  const handleSelectMode = (mode: SimMode) => {
    setSimMode(mode);
    setRetryNotice(null);
    if (mode === 'sim-connected') {
      addLog('SYS', 'Mode changed: Simulated ESP32 CONNECTED');
    } else if (mode === 'sim-disconnected') {
      setIsLightShowRunning(false);
      addLog('SYS', 'Mode changed: Simulated ESP32 DISCONNECTED');
    } else {
      setIsLightShowRunning(false);
      addLog('SYS', 'Mode changed: LIVE HARDWARE (ESP32)');
    }
  };

  // Retry connection logic
  const handleRetryConnection = () => {
    setIsRetrying(true);
    setRetryNotice(null);

    if (simMode === 'sim-disconnected') {
      addLog('TX', 'Probe ping sent to 192.168.4.1...');
      setTimeout(() => {
        setIsRetrying(false);
        setRetryNotice('ESP32 unreachable at 192.168.4.1 (Simulated Offline)');
        addLog('SYS', 'Probe failed: Destination host unreachable');
      }, 1000);
      return;
    }

    if (simMode === 'sim-connected') {
      setTimeout(() => {
        setIsRetrying(false);
        addLog('SYS', 'Simulated connection re-verified: OK');
      }, 500);
      return;
    }

    // Live mode retry
    setLiveConnected(false);
    setRetryTrigger((prev) => prev + 1);
    setTimeout(() => {
      setIsRetrying(false);
    }, 1500);
  };

  // Trigger command for the light show (Strictly guarded by isConnected)
  const handleToggleLightShow = () => {
    if (!isConnected) {
      return;
    }

    const nextState = !isLightShowRunning;
    const command = nextState ? 'START' : 'STOP';
    setIsLightShowRunning(nextState);

    // Send via real WebSocket if in live mode
    if (
      simMode === 'live' &&
      wsRef.current &&
      wsRef.current.readyState === WebSocket.OPEN
    ) {
      wsRef.current.send(JSON.stringify({ command }));
    }

    addLog('TX', JSON.stringify({ command }));

    // In simulation mode, simulate an immediate confirmation response from the ESP32
    if (simMode !== 'live' && nextState) {
      setTimeout(() => {
        addLog('RX', JSON.stringify({ status: 'ACK', pattern: 'MUSIC_PULSE_RGB' }));
      }, 160);
    }
  };

  return (
    <View style={styles.safeArea}>
      <StatusBar style="light" />

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* APP HEADER */}
        <View style={styles.header}>
          <View style={styles.headerTitleRow}>
            <Text style={styles.brandTag}>{"DUNKIN' LIGHTS"}</Text>
            <View style={styles.hardwareBadge}>
              <Text style={styles.hardwareBadgeText}>ESP32-WROOM</Text>
            </View>
          </View>
          <Text style={styles.headerSubtitle}>
            Music Reactive Lighting Controller
          </Text>
        </View>

        {/* SIMULATION CONTROLS PANEL */}
        <View style={styles.simulationCard}>
          <View style={styles.simCardHeader}>
            <View style={styles.simTitleGroup}>
              <Text style={styles.simIcon}>🧪</Text>
              <Text style={styles.simCardTitle}>ESP32 Device Simulator</Text>
            </View>
            <View style={styles.simActivePill}>
              <Text style={styles.simActivePillText}>
                {simMode === 'live' ? 'HARDWARE' : 'SIMULATION'}
              </Text>
            </View>
          </View>

          <Text style={styles.simInstructionText}>
            Toggle simulated states to test connected & disconnected behaviors:
          </Text>

          {/* SIMULATION MODE BUTTONS */}
          <View style={styles.modeButtonGroup}>
            {/* 1. SIMULATE CONNECTED */}
            <TouchableOpacity
              activeOpacity={0.8}
              style={[
                styles.modeButton,
                simMode === 'sim-connected' && styles.modeButtonConnectedActive,
              ]}
              onPress={() => handleSelectMode('sim-connected')}
            >
              <View style={[styles.miniDot, styles.dotConnected]} />
              <Text
                style={[
                  styles.modeButtonText,
                  simMode === 'sim-connected' && styles.modeButtonTextActive,
                ]}
              >
                Connected
              </Text>
            </TouchableOpacity>

            {/* 2. SIMULATE DISCONNECTED */}
            <TouchableOpacity
              activeOpacity={0.8}
              style={[
                styles.modeButton,
                simMode === 'sim-disconnected' &&
                  styles.modeButtonDisconnectedActive,
              ]}
              onPress={() => handleSelectMode('sim-disconnected')}
            >
              <View style={[styles.miniDot, styles.dotDisconnected]} />
              <Text
                style={[
                  styles.modeButtonText,
                  simMode === 'sim-disconnected' && styles.modeButtonTextActive,
                ]}
              >
                Disconnected
              </Text>
            </TouchableOpacity>

            {/* 3. LIVE HARDWARE */}
            <TouchableOpacity
              activeOpacity={0.8}
              style={[
                styles.modeButton,
                simMode === 'live' && styles.modeButtonLiveActive,
              ]}
              onPress={() => handleSelectMode('live')}
            >
              <Text style={styles.modeIcon}>📡</Text>
              <Text
                style={[
                  styles.modeButtonText,
                  simMode === 'live' && styles.modeButtonTextActive,
                ]}
              >
                Live ESP32
              </Text>
            </TouchableOpacity>
          </View>

          {/* SIMULATION DETAILS BANNER */}
          <View style={styles.simInfoBanner}>
            <Text style={styles.simInfoText}>
              {simMode === 'sim-connected' &&
                '✓ Simulating active ESP32 link • IP 192.168.4.1 • Ready for commands'}
              {simMode === 'sim-disconnected' &&
                '✕ Simulating disconnected ESP32 • Device unreachable / powered off'}
              {simMode === 'live' &&
                `Attempting real socket connection to ${ESP32_WS_URL}`}
            </Text>
          </View>
        </View>

        {/* 1. CONNECTION STATUS INDICATOR BADGE */}
        <View style={styles.statusSection}>
          <View
            style={[
              styles.statusBadge,
              isConnected
                ? styles.statusBadgeConnected
                : styles.statusBadgeDisconnected,
            ]}
          >
            <Animated.View
              style={[
                styles.statusDot,
                isConnected ? styles.dotConnected : styles.dotDisconnected,
                { transform: [{ scale: pulseAnim }] },
              ]}
            />
            <Text
              style={[
                styles.statusText,
                isConnected ? styles.textConnected : styles.textDisconnected,
              ]}
            >
              {isConnected ? 'Connected' : 'Not Connected'}
            </Text>
            {simMode !== 'live' && (
              <View style={styles.simTag}>
                <Text style={styles.simTagText}>SIMULATED</Text>
              </View>
            )}
          </View>
          <Text style={styles.statusSubtext}>
            {isConnected
              ? 'ESP32 is online and ready for light show'
              : 'Waiting for device connection • Start disabled'}
          </Text>
        </View>

        {/* 2. CONDITIONAL TROUBLESHOOTING UI (Shown ONLY when Not Connected) */}
        {!isConnected && (
          <View style={styles.troubleshootingCard}>
            <View style={styles.troubleshootingHeader}>
              <Text style={styles.troubleshootingWarningIcon}>⚠️</Text>
              <Text style={styles.troubleshootingTitle}>Troubleshooting</Text>
            </View>

            <Text style={styles.tipText}>
              • Ensure the ESP32 device is plugged in and powered on.
            </Text>
            <Text style={styles.tipText}>
              • Check that your phone is connected to the correct Wi-Fi network
              (or paired via Bluetooth).
            </Text>
            <Text style={styles.tipText}>• Restart the ESP32 device.</Text>

            {retryNotice && (
              <View style={styles.retryNoticeBox}>
                <Text style={styles.retryNoticeText}>{retryNotice}</Text>
              </View>
            )}

            <TouchableOpacity
              style={[
                styles.retryButton,
                isRetrying && styles.retryButtonDisabled,
              ]}
              activeOpacity={0.75}
              disabled={isRetrying}
              onPress={handleRetryConnection}
            >
              {isRetrying ? (
                <View style={styles.retryLoadingRow}>
                  <ActivityIndicator size="small" color="#E2E8F0" />
                  <Text style={styles.retryButtonText}>
                    Searching for ESP32...
                  </Text>
                </View>
              ) : (
                <Text style={styles.retryButtonText}>Retry Connection</Text>
              )}
            </TouchableOpacity>

            {/* Quick helper when testing in disconnected simulation */}
            {simMode === 'sim-disconnected' && (
              <TouchableOpacity
                style={styles.quickConnectPrompt}
                activeOpacity={0.8}
                onPress={() => handleSelectMode('sim-connected')}
              >
                <Text style={styles.quickConnectPromptText}>
                  💡 Tap to simulate device powering ON
                </Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* CONNECTED STATE: INTERACTIVE VISUALIZER & TELEMETRY */}
        {isConnected && (
          <View style={styles.connectedCard}>
            <View style={styles.connectedHeaderRow}>
              <Text style={styles.connectedCardTitle}>
                {isLightShowRunning ? '🎵 Light Show Active' : '✨ Device Ready'}
              </Text>
              <View
                style={[
                  styles.runStatusPill,
                  isLightShowRunning
                    ? styles.runStatusPillActive
                    : styles.runStatusPillIdle,
                ]}
              >
                <Text
                  style={[
                    styles.runStatusPillText,
                    isLightShowRunning
                      ? styles.runStatusPillTextActive
                      : styles.runStatusPillTextIdle,
                  ]}
                >
                  {isLightShowRunning ? 'PLAYING' : 'STANDBY'}
                </Text>
              </View>
            </View>

            {/* Animated Equalizer / LED Strip Simulation */}
            <View style={styles.visualizerContainer}>
              {barAnims.map((anim, idx) => {
                // Vibrant Dunkin / Music palette
                const colors = [
                  '#FF671F', // Dunkin Orange
                  '#DA1884', // Dunkin Pink
                  '#FDB913', // Warm Yellow
                  '#10B981', // Mint Green
                  '#06B6D4', // Cyan
                  '#8B5CF6', // Purple
                  '#FF671F',
                  '#DA1884',
                ];
                return (
                  <View key={idx} style={styles.visualizerBarTrack}>
                    <Animated.View
                      style={[
                        styles.visualizerBar,
                        {
                          backgroundColor: colors[idx % colors.length],
                          transform: [{ scaleY: anim }],
                        },
                      ]}
                    />
                  </View>
                );
              })}
            </View>

            <Text style={styles.visualizerCaption}>
              {isLightShowRunning
                ? 'Simulated addressable LEDs reacting to music rhythms'
                : 'Press START below to launch the music synchronized light show'}
            </Text>

            {/* Simulated Packet / Telemetry Stream */}
            <View style={styles.packetStream}>
              <Text style={styles.packetStreamTitle}>ESP32 WebSocket Log:</Text>
              {packetLogs.slice(0, 3).map((log) => (
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
        )}

        {/* 3. STRICTLY CONTROLLED START/STOP BUTTON */}
        <View style={styles.startButtonContainer}>
          <TouchableOpacity
            disabled={!isConnected}
            activeOpacity={isConnected ? 0.8 : 1}
            onPress={handleToggleLightShow}
            style={[
              styles.startButton,
              !isConnected && styles.startButtonDisabled,
              isConnected && !isLightShowRunning && styles.startButtonEnabled,
              isConnected && isLightShowRunning && styles.startButtonRunning,
            ]}
          >
            <Text
              style={[
                styles.startButtonText,
                !isConnected && styles.startButtonTextDisabled,
                isConnected && !isLightShowRunning && styles.startButtonTextEnabled,
                isConnected && isLightShowRunning && styles.startButtonTextRunning,
              ]}
            >
              {isConnected && isLightShowRunning
                ? 'Stop Light Show'
                : 'Start'}
            </Text>
          </TouchableOpacity>
          {!isConnected && (
            <Text style={styles.startDisabledHint}>
              Connect ESP32 or select &quot;Connected&quot; in simulator to enable
            </Text>
          )}
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
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'android' ? 44 : 52,
    paddingBottom: 40,
    alignItems: 'center',
  },

  // --- Header Styles ---
  header: {
    width: '100%',
    marginBottom: 20,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  brandTag: {
    color: '#FF671F',
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: 1.5,
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
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  headerSubtitle: {
    color: '#64748B',
    fontSize: 14,
    fontWeight: '500',
  },

  // --- Simulator Controls Card ---
  simulationCard: {
    width: '100%',
    backgroundColor: '#111827',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1F2937',
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 4,
  },
  simCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  simTitleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  simIcon: {
    fontSize: 16,
    marginRight: 8,
  },
  simCardTitle: {
    color: '#F9FAFB',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  simActivePill: {
    backgroundColor: 'rgba(99, 102, 241, 0.15)',
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(99, 102, 241, 0.4)',
  },
  simActivePillText: {
    color: '#818CF8',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  simInstructionText: {
    color: '#9CA3AF',
    fontSize: 12,
    marginBottom: 12,
    lineHeight: 16,
  },
  modeButtonGroup: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  modeButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 6,
    borderRadius: 10,
    backgroundColor: '#1F2937',
    borderWidth: 1,
    borderColor: '#374151',
  },
  modeButtonConnectedActive: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderColor: '#10B981',
  },
  modeButtonDisconnectedActive: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderColor: '#EF4444',
  },
  modeButtonLiveActive: {
    backgroundColor: 'rgba(56, 189, 248, 0.15)',
    borderColor: '#38BDF8',
  },
  miniDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  modeIcon: {
    fontSize: 12,
    marginRight: 4,
  },
  modeButtonText: {
    color: '#9CA3AF',
    fontSize: 12,
    fontWeight: '600',
  },
  modeButtonTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  simInfoBanner: {
    backgroundColor: '#0F172A',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderLeftWidth: 3,
    borderLeftColor: '#6366F1',
  },
  simInfoText: {
    color: '#CBD5E1',
    fontSize: 12,
    fontWeight: '500',
  },

  // --- Status Indicator Styles ---
  statusSection: {
    width: '100%',
    alignItems: 'center',
    marginVertical: 14,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 24,
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
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 10,
  },
  dotConnected: {
    backgroundColor: '#10B981',
    shadowColor: '#10B981',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.95,
    shadowRadius: 7,
  },
  dotDisconnected: {
    backgroundColor: '#EF4444',
    shadowColor: '#EF4444',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.95,
    shadowRadius: 7,
  },
  statusText: {
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  textConnected: {
    color: '#10B981',
  },
  textDisconnected: {
    color: '#EF4444',
  },
  simTag: {
    marginLeft: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 4,
  },
  simTagText: {
    color: '#94A3B8',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  statusSubtext: {
    color: '#64748B',
    fontSize: 13,
    marginTop: 8,
    textAlign: 'center',
  },

  // --- Troubleshooting Card Styles ---
  troubleshootingCard: {
    width: '100%',
    backgroundColor: '#131B2E',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#1E293B',
    marginVertical: 12,
  },
  troubleshootingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  troubleshootingWarningIcon: {
    fontSize: 16,
    marginRight: 8,
  },
  troubleshootingTitle: {
    color: '#F8FAFC',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  tipText: {
    color: '#94A3B8',
    fontSize: 14,
    lineHeight: 22,
    marginBottom: 8,
  },
  retryNoticeBox: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderRadius: 8,
    padding: 10,
    marginTop: 6,
    marginBottom: 4,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  retryNoticeText: {
    color: '#FCA5A5',
    fontSize: 12,
    fontWeight: '500',
  },
  retryButton: {
    marginTop: 14,
    backgroundColor: '#1E293B',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155',
  },
  retryButtonDisabled: {
    opacity: 0.65,
  },
  retryLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  retryButtonText: {
    color: '#E2E8F0',
    fontSize: 15,
    fontWeight: '600',
  },
  quickConnectPrompt: {
    marginTop: 12,
    paddingVertical: 8,
    alignItems: 'center',
  },
  quickConnectPromptText: {
    color: '#38BDF8',
    fontSize: 13,
    fontWeight: '600',
  },

  // --- Connected Visualizer Card Styles ---
  connectedCard: {
    width: '100%',
    backgroundColor: '#0F172A',
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: '#1E293B',
    marginVertical: 12,
  },
  connectedHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  connectedCardTitle: {
    color: '#F1F5F9',
    fontSize: 16,
    fontWeight: '700',
  },
  runStatusPill: {
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 6,
  },
  runStatusPillActive: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.4)',
  },
  runStatusPillIdle: {
    backgroundColor: 'rgba(148, 163, 184, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.2)',
  },
  runStatusPillText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  runStatusPillTextActive: {
    color: '#10B981',
  },
  runStatusPillTextIdle: {
    color: '#94A3B8',
  },
  visualizerContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    height: 64,
    backgroundColor: '#090D16',
    borderRadius: 12,
    paddingHorizontal: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  visualizerBarTrack: {
    flex: 1,
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
    marginHorizontal: 3,
  },
  visualizerBar: {
    width: 8,
    height: '100%',
    borderRadius: 4,
  },
  visualizerCaption: {
    color: '#64748B',
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 14,
  },
  packetStream: {
    backgroundColor: '#090D16',
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  packetStreamTitle: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginBottom: 6,
    textTransform: 'uppercase',
  },
  logRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 2,
  },
  logTime: {
    color: '#475569',
    fontSize: 10,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
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
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    flex: 1,
  },

  // --- Start Button Styles ---
  startButtonContainer: {
    width: '100%',
    alignItems: 'center',
    marginTop: 16,
  },
  startButton: {
    width: '100%',
    height: 68,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  startButtonEnabled: {
    backgroundColor: '#10B981',
    shadowColor: '#10B981',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 8,
  },
  startButtonRunning: {
    backgroundColor: '#EF4444',
    shadowColor: '#EF4444',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 8,
  },
  startButtonDisabled: {
    backgroundColor: '#161F30',
    borderWidth: 1,
    borderColor: '#263248',
  },
  startButtonText: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  startButtonTextEnabled: {
    color: '#06281E',
  },
  startButtonTextRunning: {
    color: '#FFFFFF',
  },
  startButtonTextDisabled: {
    color: '#475569',
  },
  startDisabledHint: {
    color: '#64748B',
    fontSize: 12,
    marginTop: 8,
    textAlign: 'center',
  },
});
