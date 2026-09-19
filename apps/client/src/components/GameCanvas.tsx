import React, { useEffect, useRef, useState } from 'react';
import { network, type ConnectionState } from '../game/network';
import { loadPreferences, readStored, writeStored } from '../game/preferences';
import { inputHandler } from '../game/input';
import { prediction } from '../game/prediction';
import { interpolation } from '../game/interpolation';
import { GameRenderer } from '../game/renderer';
import { soundEngine } from '../game/sound-engine';
import {
  type WorldSnapshot,
  type PlayerState,
  type PassengerState,
  type TrafficLightState,
  type PedestrianState,
  type ConfigPayload,
  type SnapshotPacketKind,
  EPassengerTier,
  MOTORBIKE_SPEED,
} from '@xeom-rush/shared';
import { HUD } from './HUD';
import { DebugOverlay } from './DebugOverlay';

interface GameCanvasProps {
  username: string;
  serverUrl: string;
  onDisconnect: (reason?: string) => void;
}

export const GameCanvas: React.FC<GameCanvasProps> = ({ username, serverUrl, onDisconnect }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<GameRenderer | null>(null);

  // States for HUD / Debug dashboard
  const [localPlayer, setLocalPlayer] = useState<PlayerState | null>(null);
  const [players, setPlayers] = useState<PlayerState[]>([]);
  const [passengers, setPassengers] = useState<PassengerState[]>([]);
  const passengersRef = useRef<PassengerState[]>([]);
  const trafficLightsRef = useRef<TrafficLightState[]>([]);
  const pedestriansRef = useRef<PedestrianState[]>([]);
  const [rtt, setRtt] = useState(0);
  const [tickRate, setTickRate] = useState(0);
  const [lastBytes, setLastBytes] = useState(0);
  const [lastPacketKind, setLastPacketKind] = useState<SnapshotPacketKind>('full');
  const [showDebug, setShowDebug] = useState(false);
  const showDebugRef = useRef(false);
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');
  const [preferences, setPreferences] = useState(loadPreferences);
  const preferencesRef = useRef(preferences);
  const [deliveries, setDeliveries] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const [showResults, setShowResults] = useState(false);
  const [tutorialDone, setTutorialDone] = useState(() => readStored('tutorial') === 'done');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const violationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    preferencesRef.current = preferences;
    soundEngine.setEnabled(preferences.sound);
    rendererRef.current?.setReducedMotion(preferences.reducedMotion);
    writeStored('sound', String(preferences.sound));
    writeStored('reducedMotion', String(preferences.reducedMotion));
  }, [preferences]);
  useEffect(() => {
    showDebugRef.current = showDebug;
  }, [showDebug]);
  const [violationAlert, setViolationAlert] = useState<string | null>(null);
  const previousViolationTickRef = useRef<number>(0);

  // Rush Hour state
  const [rushHour, setRushHour] = useState(false);
  const [rushHourTicksRemaining, setRushHourTicksRemaining] = useState(0);
  const previousRushHourRef = useRef(false);
  const rushHourStartedAtRef = useRef<number | null>(null); // ms timestamp when rush hour began client-side

  // Streak state
  const [myStreak, setMyStreak] = useState(0);

  // Client-side prediction sequence counter
  const clientSeqRef = useRef(0);
  // Latency metrics tracking
  const snapshotTimesRef = useRef<number[]>([]);

  // Maintain local player position in mutable ref for requestAnimationFrame speed
  const localPlayerStateRef = useRef<PlayerState | null>(null);

  // Track previous passengerId to detect pickup/dropoff
  const previousPassengerIdRef = useRef<string | null>(null);
  // Track VIP passenger IDs we've already announced
  const announcedVIPsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!canvasRef.current || !containerRef.current) return;

    const canvas = canvasRef.current;
    const container = containerRef.current;

    // Create renderer
    const renderer = new GameRenderer(canvas);
    rendererRef.current = renderer;
    renderer.setReducedMotion(preferencesRef.current.reducedMotion);
    soundEngine.setEnabled(preferencesRef.current.sound);

    const handleResize = () => {
      renderer.resize(container.clientWidth, container.clientHeight);
    };
    handleResize();
    window.addEventListener('resize', handleResize);

    // H key → honk
    const handleHonk = (e: KeyboardEvent) => {
      if (e.key === 'h' || e.key === 'H') {
        soundEngine.playHonk();
      }
    };
    window.addEventListener('keydown', handleHonk);

    // Track config variables from server
    let myPlayerId = '';

    // Register networking callbacks
    const unsubscribeConfig = network.registerConfigCallback((config: ConfigPayload) => {
      prediction.clear();
      interpolation.clear();
      if (myPlayerId && myPlayerId !== config.myId) {
        localPlayerStateRef.current = null;
        previousPassengerIdRef.current = null;
        setDeliveries(0);
        setToast('Thành phố đã mở lại. Bắt đầu chuyến xe mới nhé!');
        if (toastTimer.current) clearTimeout(toastTimer.current);
        toastTimer.current = setTimeout(() => setToast(null), 3500);
      }
      myPlayerId = config.myId;
      console.log('Received config from server, my player ID is:', myPlayerId);
    });

    const unsubscribeSnapshot = network.registerSnapshotCallback((snapshot: WorldSnapshot, meta) => {
      // 1. Calculate received package size
      setLastBytes(meta.bytes);
      setLastPacketKind(meta.kind);

      // 2. Track snapshot times for tick rate measurement
      const now = Date.now();
      snapshotTimesRef.current.push(now);
      if (snapshotTimesRef.current.length > 20) {
        snapshotTimesRef.current.shift();
      }

      // 3. Rush Hour state — play sting on transition
      const wasRushHour = previousRushHourRef.current;
      if (snapshot.rushHour && !wasRushHour) {
        soundEngine.playRushHourSting();
        rushHourStartedAtRef.current = Date.now();
      }
      if (!snapshot.rushHour) {
        rushHourStartedAtRef.current = null;
      }
      previousRushHourRef.current = snapshot.rushHour;
      setRushHour(snapshot.rushHour);

      // Estimate rush hour ticks remaining from elapsed time
      const RUSH_HOUR_DURATION_MS = 60_000; // 60 seconds
      if (snapshot.rushHour && rushHourStartedAtRef.current !== null) {
        const elapsed = Date.now() - rushHourStartedAtRef.current;
        const remainingMs = Math.max(0, RUSH_HOUR_DURATION_MS - elapsed);
        setRushHourTicksRemaining(Math.ceil(remainingMs / 50)); // 50ms per tick
      } else {
        setRushHourTicksRemaining(0);
      }

      // 4. Detect new VIP passengers and announce
      for (const passenger of snapshot.passengers) {
        if (passenger.tier === EPassengerTier.VIP && !announcedVIPsRef.current.has(passenger.id)) {
          announcedVIPsRef.current.add(passenger.id);
          soundEngine.playVIPAnnounce();
          break; // Only one VIP announcement per tick
        }
      }

      // 5. Separate local player from other players
      let localStateFromServer: PlayerState | null = null;

      for (const p of snapshot.players) {
        if (p.id === myPlayerId) {
          localStateFromServer = p;
        }
      }

      // 6. Feed other players to interpolation buffer
      interpolation.addSnapshot(snapshot.players);

      // 7. Update passengers list
      passengersRef.current = snapshot.passengers;
      trafficLightsRef.current = snapshot.trafficLights;
      pedestriansRef.current = snapshot.pedestrians;
      setPassengers(snapshot.passengers);

      // 8. Perform server reconciliation on local player state
      if (localStateFromServer) {
        // Detect pickup / dropoff for sound effects
        const prevPassengerId = previousPassengerIdRef.current;
        const currPassengerId = localStateFromServer.passengerId;

        if (!prevPassengerId && currPassengerId) {
          soundEngine.playPickup();
          renderer.celebrate(localStateFromServer.x, localStateFromServer.y, 'pickup');
          setToast('🙋 À, có khách rồi!');
          if (toastTimer.current) clearTimeout(toastTimer.current);
          toastTimer.current = setTimeout(() => setToast(null), 1800);
        } else if (prevPassengerId && !currPassengerId) {
          soundEngine.playDropoff();
          renderer.celebrate(localStateFromServer.x, localStateFromServer.y, 'delivery');
          const earned = Math.max(0, localStateFromServer.score - (localPlayerStateRef.current?.score ?? 0));
          setToast(`✦ Chuyến tốt! +${earned.toLocaleString('vi-VN')}đ`);
          setDeliveries((count) => count + 1);
          setTutorialDone(true);
          writeStored('tutorial', 'done');
          if (toastTimer.current) clearTimeout(toastTimer.current);
          toastTimer.current = setTimeout(() => setToast(null), 2400);
        }
        previousPassengerIdRef.current = currPassengerId;

        // Update streak from snapshot
        setMyStreak(snapshot.streaks[myPlayerId] ?? 0);

        // Run prediction engine reconciliation
        const reconciled = prediction.reconcile(
          localStateFromServer.x,
          localStateFromServer.y,
          localStateFromServer.lastProcessedSeq,
        );

        const currX = localPlayerStateRef.current?.x ?? reconciled.x;
        const currY = localPlayerStateRef.current?.y ?? reconciled.y;
        const currAngle = localPlayerStateRef.current?.angle ?? localStateFromServer.angle;

        const errX = reconciled.x - currX;
        const errY = reconciled.y - currY;
        const errDist = Math.hypot(errX, errY);

        let newX = currX;
        let newY = currY;
        if (errDist > 60) {
          // Large desync or collision stun/teleport: snap immediately
          newX = reconciled.x;
          newY = reconciled.y;
        } else if (errDist > 0.5) {
          // Smooth blend towards reconciled position to eliminate micro-jitter
          newX = currX + errX * 0.35;
          newY = currY + errY * 0.35;
        }

        const updatedLocalState: PlayerState = {
          ...localStateFromServer,
          x: newX,
          y: newY,
          angle: currAngle,
        };

        if (
          updatedLocalState.lastViolation &&
          updatedLocalState.lastViolation.tick !== previousViolationTickRef.current
        ) {
          previousViolationTickRef.current = updatedLocalState.lastViolation.tick;
          rendererRef.current?.triggerShake(15);
          setViolationAlert(getViolationMessage(updatedLocalState.lastViolation));
          if (violationTimer.current) clearTimeout(violationTimer.current);
          violationTimer.current = setTimeout(() => setViolationAlert(null), 1600);
        }

        localPlayerStateRef.current = updatedLocalState;
        setLocalPlayer(updatedLocalState);
      }

      // Track all players for state listings
      setPlayers(snapshot.players);
    });

    // Connect WebSocket
    network.connect(
      serverUrl,
      username,
      () => {
        console.log('Connected to game server.');
      },
      () => {
        console.log('Disconnected from game server.');
        soundEngine.stopEngine();
        onDisconnect('Chưa kết nối được với thành phố. Thử lại sau một chút nhé!');
      },
      setConnectionState,
    );

    // Game loop requestAnimationFrame
    let animationFrameId = 0;
    let lastFrameTime = performance.now();
    let lastInputTime = lastFrameTime;

    const gameTick = (timestamp: number) => {
      const dt = Math.min((timestamp - lastFrameTime) / 1000, 0.05); // time in seconds
      lastFrameTime = timestamp;

      // 1. Capture inputs and update local client prediction
      const input = inputHandler.getInputVector(dt);

      if (
        localPlayerStateRef.current &&
        network.connected &&
        !document.hidden &&
        timestamp - lastInputTime >= 1000 / 60
      ) {
        const inputDt = Math.min((timestamp - lastInputTime) / 1000, 0.05);
        lastInputTime = timestamp;
        clientSeqRef.current++;

        // Save to pending buffer for later reconciliation
        prediction.addInput({
          seq: clientSeqRef.current,
          dx: input.dx,
          dy: input.dy,
          angle: input.angle,
          dt: inputDt,
        });

        // Run local prediction movement immediately (gives instant local reaction at 60fps)
        const predictedPos = prediction.predict(localPlayerStateRef.current.x, localPlayerStateRef.current.y, {
          seq: clientSeqRef.current,
          dx: input.dx,
          dy: input.dy,
          angle: input.angle,
          dt: inputDt,
        });

        localPlayerStateRef.current = {
          ...localPlayerStateRef.current,
          x: predictedPos.x,
          y: predictedPos.y,
          angle: input.dx !== 0 || input.dy !== 0 ? input.angle : localPlayerStateRef.current.angle,
        };

        // Send input payload to server
        network.sendInput(clientSeqRef.current, input.dx, input.dy, input.angle);

        // Engine hum — pitch scales with movement speed
        const isMoving = input.dx !== 0 || input.dy !== 0;
        soundEngine.engineHum(isMoving ? MOTORBIKE_SPEED : MOTORBIKE_SPEED * 0.15, MOTORBIKE_SPEED);

        // Sync React HUD state periodically
        if (clientSeqRef.current % 5 === 0) {
          setLocalPlayer({ ...localPlayerStateRef.current });
        }
      }

      // 2. Perform entity interpolation on other players
      const otherPlayersInterpolated = interpolation.getInterpolatedPlayers(myPlayerId);

      // 3. Draw scene
      if (rendererRef.current && localPlayerStateRef.current) {
        rendererRef.current.draw(
          localPlayerStateRef.current,
          otherPlayersInterpolated,
          passengersRef.current,
          trafficLightsRef.current,
          pedestriansRef.current,
          showDebugRef.current,
        );
      }

      // 4. Update telemetry metrics
      setRtt(network.rtt);

      // Measure ticks/sec
      if (snapshotTimesRef.current.length >= 2) {
        const times = snapshotTimesRef.current;
        const totalDuration = (times[times.length - 1] - times[0]) / 1000;
        const measuredTickRate = totalDuration > 0 ? (times.length - 1) / totalDuration : 0;
        setTickRate(measuredTickRate);
      }

      animationFrameId = requestAnimationFrame(gameTick);
    };

    animationFrameId = requestAnimationFrame(gameTick);

    // Cleanup on unmount
    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('keydown', handleHonk);
      cancelAnimationFrame(animationFrameId);
      unsubscribeConfig();
      unsubscribeSnapshot();
      if (toastTimer.current) clearTimeout(toastTimer.current);
      if (violationTimer.current) clearTimeout(violationTimer.current);
      network.disconnect();
      prediction.clear();
      interpolation.clear();
      inputHandler.clear();
      soundEngine.stopEngine();
    };
  }, [username, serverUrl, onDisconnect]);

  const handleSpawnBots = async () => {
    // Spawn server-side AI bots that navigate, pick up passengers, and compete with players
    const httpUrl = serverUrl.replace('ws://', 'http://').replace('wss://', 'https://');
    try {
      const res = await fetch(`${httpUrl}/api/spawn-bots`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count: 25 }),
      });
      const data = await res.json();
      console.log(`Spawned ${data.spawned} AI bots (total: ${data.totalBots})`);
    } catch (err) {
      console.error('Failed to spawn bots:', err);
    }
  };

  return (
    <div ref={containerRef} className='game-shell'>
      <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '100%' }} />

      {toast && (
        <div className='trip-toast' role='status'>
          {toast}
        </div>
      )}
      {localPlayer && !showResults && (
        <aside className='trip-guide'>
          <small>{!tutorialDone ? 'CHUYẾN ĐẦU TIÊN CỦA BẠN' : 'NHẬT KÝ CHUYẾN XE'}</small>
          <h3>{localPlayer.passengerId ? '🏁 Đưa khách đến đích' : '🙋 Có người đang đợi!'}</h3>
          <p>
            {localPlayer.passengerId
              ? 'Theo dấu đỏ đến điểm trả. Lái lại gần để hoàn tất chuyến xe.'
              : 'Lái đến vị khách đang vẫy tay để đón. WASD / phím mũi tên hoặc cần điều khiển.'}
          </p>
          {deliveries > 0 && (
            <p>
              ✦ Đã hoàn thành {deliveries} chuyến · Combo {myStreak}
            </p>
          )}
        </aside>
      )}
      <nav className='game-toolbar' aria-label='Điều khiển trò chơi'>
        <button
          aria-label='Âm thanh'
          aria-pressed={preferences.sound}
          onClick={() => {
            soundEngine.unlock();
            setPreferences((p) => ({ ...p, sound: !p.sound }));
          }}
        >
          {preferences.sound ? '♫ Bật' : '♫ Tắt'}
        </button>
        <button
          aria-label='Giảm chuyển động'
          aria-pressed={preferences.reducedMotion}
          onClick={() => setPreferences((p) => ({ ...p, reducedMotion: !p.reducedMotion }))}
        >
          Chuyển động
        </button>
        <button
          onClick={() => {
            network.disconnect();
            soundEngine.stopEngine();
            inputHandler.clear();
            setShowResults(true);
          }}
        >
          Kết thúc
        </button>
      </nav>
      {connectionState !== 'connected' && !showResults && (
        <div className='connection-cover'>
          <div className='connection-card' role='status'>
            <span style={{ fontSize: 40 }}>🛵</span>
            <h2>{connectionState === 'connecting' ? 'Đang lên xe…' : 'Chờ chút nha…'}</h2>
            <p>
              {connectionState === 'connecting'
                ? 'Đang tìm đường vào thành phố.'
                : 'Mạng hơi chậm. Đang kết nối lại chuyến xe của bạn.'}
            </p>
            <button className='toon-button' onClick={() => onDisconnect()}>
              Về trang chủ
            </button>
          </div>
        </div>
      )}
      {showResults && (
        <div className='results-cover'>
          <div className='results-card'>
            <span style={{ fontSize: 44 }}>✦</span>
            <h2>Một chuyến thật vui!</h2>
            <strong>{(localPlayer?.score ?? 0).toLocaleString('vi-VN')}đ</strong>
            <p>
              {deliveries} chuyến hoàn thành · Combo hiện tại {myStreak}
              <br />
              Thành phố vẫn còn nhiều điều để khám phá.
            </p>
            <button className='toon-button' onClick={() => onDisconnect()}>
              Chơi tiếp ↗
            </button>
          </div>
        </div>
      )}
      {/* Collision Alert Banner */}
      {violationAlert && (
        <div
          style={{
            position: 'absolute',
            top: '25%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            backgroundColor: 'rgba(239, 68, 68, 0.95)',
            border: '2.5px solid #ffffff',
            borderRadius: '12px',
            padding: '14px 28px',
            color: '#ffffff',
            fontFamily: "'Outfit', 'Inter', sans-serif",
            fontWeight: 900,
            fontSize: '24px',
            boxShadow: '0 0 25px rgba(239, 68, 68, 0.7)',
            pointerEvents: 'none',
            zIndex: 999,
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            animation: preferences.reducedMotion ? 'none' : 'bounceIn 0.2s ease-out',
          }}
        >
          {violationAlert}
        </div>
      )}

      {/* Embedded Animation Styles */}
      <style>{`
        @keyframes bounceIn {
          0% { transform: translate(-50%, -50%) scale(0.3); opacity: 0; }
          50% { transform: translate(-50%, -50%) scale(1.1); }
          70% { transform: translate(-50%, -50%) scale(0.9); }
          100% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
        }
      `}</style>

      {/* HUD Layer */}
      <HUD
        localPlayer={localPlayer}
        players={players}
        passengers={passengers}
        rushHour={rushHour}
        rushHourTicksRemaining={rushHourTicksRemaining}
        myStreak={myStreak}
      />

      {/* Debug Telemetry Panel */}
      {import.meta.env.DEV && (
        <DebugOverlay
          rtt={rtt}
          tickRate={tickRate}
          lastSnapshotBytes={lastBytes}
          lastPacketKind={lastPacketKind}
          players={players}
          passengers={passengers}
          showDebug={showDebug}
          onToggleDebug={setShowDebug}
          onSpawnBots={handleSpawnBots}
          serverUrl={serverUrl}
        />
      )}
    </div>
  );
};

function getViolationMessage(violation: NonNullable<PlayerState['lastViolation']>): string {
  switch (violation.type) {
    case 'red-light':
      return '🚦 VƯỢT ĐÈN ĐỎ! PHẠT -2.000đ';
    case 'pedestrian':
      return `🚶 Chú ý người đi bộ! -${violation.amount.toLocaleString('vi-VN')}đ`;
    case 'driver-collision':
      return '💥 VA CHẠM! PHẠT -1.000đ';
    default:
      return '⚠️ VI PHẠM!';
  }
}
