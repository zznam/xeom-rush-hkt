import React, { useEffect, useRef, useState } from 'react';
import { network } from '../game/network';
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
  EPassengerTier,
  MOTORBIKE_SPEED,
} from '@xeom-rush/shared';
import { HUD } from './HUD';
import { DebugOverlay } from './DebugOverlay';

interface GameCanvasProps {
  username: string;
  serverUrl: string;
  onDisconnect: () => void;
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
  const [showDebug, setShowDebug] = useState(true);
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
  const lastSnapSizeRef = useRef(0);

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
    network.registerConfigCallback((config: ConfigPayload) => {
      myPlayerId = config.myId;
      console.log('Received config from server, my player ID is:', myPlayerId);
    });

    network.registerSnapshotCallback((snapshot: WorldSnapshot) => {
      // 1. Calculate received package size
      const snapshotSize = 16 + snapshot.players.length * 55 + snapshot.passengers.length * 40; // approx
      lastSnapSizeRef.current = snapshotSize;
      setLastBytes(snapshotSize);

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
        } else if (prevPassengerId && !currPassengerId) {
          soundEngine.playDropoff();
        }
        previousPassengerIdRef.current = currPassengerId;

        // Update streak from snapshot
        setMyStreak(snapshot.streaks[myPlayerId] ?? 0);

        // Run prediction engine reconciliation
        const reconciled = prediction.reconcile(
          localStateFromServer.x,
          localStateFromServer.y,
          localStateFromServer.lastProcessedSeq
        );

        const updatedLocalState: PlayerState = {
          ...localStateFromServer,
          x: reconciled.x,
          y: reconciled.y,
        };

        if (
          updatedLocalState.lastViolation &&
          updatedLocalState.lastViolation.tick !== previousViolationTickRef.current
        ) {
          previousViolationTickRef.current = updatedLocalState.lastViolation.tick;
          rendererRef.current?.triggerShake(15);
          setViolationAlert(getViolationMessage(updatedLocalState.lastViolation));
          setTimeout(() => setViolationAlert(null), 1200);
        }

        localPlayerStateRef.current = updatedLocalState;
        setLocalPlayer(updatedLocalState);
      }

      // Track all players for state listings
      setPlayers(snapshot.players);
    });

    // Connect WebSocket
    network.connect(serverUrl, username, () => {
      console.log('Connected to game server.');
    }, () => {
      console.log('Disconnected from game server.');
      soundEngine.stopEngine();
      onDisconnect();
    });

    // Game loop requestAnimationFrame
    let animationFrameId = 0;
    let lastFrameTime = performance.now();

    const gameTick = (timestamp: number) => {
      const dt = (timestamp - lastFrameTime) / 1000; // time in seconds
      lastFrameTime = timestamp;

      // 1. Capture inputs and update local client prediction
      const input = inputHandler.getInputVector();

      if (localPlayerStateRef.current) {
        clientSeqRef.current++;

        // Save to pending buffer for later reconciliation
        prediction.addInput({
          seq: clientSeqRef.current,
          dx: input.dx,
          dy: input.dy,
          angle: input.angle,
          dt,
        });

        // Run local prediction movement immediately (gives instant local reaction at 60fps)
        const predictedPos = prediction.predict(
          localPlayerStateRef.current.x,
          localPlayerStateRef.current.y,
          { seq: clientSeqRef.current, dx: input.dx, dy: input.dy, angle: input.angle, dt }
        );

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
          showDebug
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
      network.disconnect();
      prediction.clear();
      interpolation.clear();
      inputHandler.clear();
      soundEngine.stopEngine();
    };
  }, [username, serverUrl, onDisconnect, showDebug]);

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
    <div ref={containerRef} style={{ width: '100vw', height: '100vh', position: 'relative' }}>
      <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '100%' }} />

      {/* Collision Alert Banner */}
      {violationAlert && (
        <div style={{
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
          animation: 'bounceIn 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275)'
        }}>
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
      <DebugOverlay
        rtt={rtt}
        tickRate={tickRate}
        lastSnapshotBytes={lastBytes}
        players={players}
        passengers={passengers}
        showDebug={showDebug}
        onToggleDebug={setShowDebug}
        onSpawnBots={handleSpawnBots}
        serverUrl={serverUrl}
      />
    </div>
  );
};

function getViolationMessage(violation: NonNullable<PlayerState['lastViolation']>): string {
  switch (violation.type) {
    case 'red-light':
      return '🚦 VƯỢT ĐÈN ĐỎ! PHẠT -2.000đ';
    case 'pedestrian':
      return '🚶 TÔNG NGƯỜI ĐI BỘ! MẤT HẾT TIỀN';
    case 'driver-collision':
      return '💥 VA CHẠM! PHẠT -1.000đ';
    default:
      return '⚠️ VI PHẠM!';
  }
}
