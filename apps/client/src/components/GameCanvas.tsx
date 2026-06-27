import React, { useEffect, useRef, useState } from 'react';
import { network } from '../game/network';
import { inputHandler } from '../game/input';
import { prediction } from '../game/prediction';
import { interpolation } from '../game/interpolation';
import { GameRenderer } from '../game/renderer';
import { type WorldSnapshot, type PlayerState, type PassengerState, type ConfigPayload, encodeJoin, encodeInput } from '@xeom-rush/shared';
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
  const [rtt, setRtt] = useState(0);
  const [tickRate, setTickRate] = useState(0);
  const [lastBytes, setLastBytes] = useState(0);
  const [showDebug, setShowDebug] = useState(true);

  // Client-side prediction sequence counter
  const clientSeqRef = useRef(0);
  // Latency metrics tracking
  const snapshotTimesRef = useRef<number[]>([]);
  const lastSnapSizeRef = useRef(0);

  // Maintain local player position in mutable ref for requestAnimationFrame speed
  const localPlayerStateRef = useRef<PlayerState | null>(null);

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

    // Track config variables from server
    let myPlayerId = '';

    // Register networking callbacks
    network.registerConfigCallback((config: ConfigPayload) => {
      myPlayerId = config.myId;
      console.log('Received config from server, my player ID is:', myPlayerId);
    });

    network.registerSnapshotCallback((snapshot: WorldSnapshot) => {
      // 1. Calculate received package size
      // We can approximate snapshot bytes size
      const snapshotSize = 9 + snapshot.players.length * 40 + snapshot.passengers.length * 35; // approx
      lastSnapSizeRef.current = snapshotSize;
      setLastBytes(snapshotSize);

      // 2. Track snapshot times for tick rate measurement
      const now = Date.now();
      snapshotTimesRef.current.push(now);
      if (snapshotTimesRef.current.length > 20) {
        snapshotTimesRef.current.shift();
      }

      // 3. Separate local player from other players
      const otherPlayersList: PlayerState[] = [];
      let localStateFromServer: PlayerState | null = null;

      for (const p of snapshot.players) {
        if (p.id === myPlayerId) {
          localStateFromServer = p;
        } else {
          otherPlayersList.push(p);
        }
      }

      // 4. Feed other players to interpolation buffer
      interpolation.addSnapshot(snapshot.players);

      // 5. Update passengers list
      passengersRef.current = snapshot.passengers;
      setPassengers(snapshot.passengers);

      // 6. Perform server reconciliation on local player state
      if (localStateFromServer) {
        // Run prediction engine reconciliation
        const reconciled = prediction.reconcile(
          localStateFromServer.x,
          localStateFromServer.y,
          localStateFromServer.lastProcessedSeq
        );

        // Keep rest of states (score, passengerId) from server, update position from reconciliation
        const updatedLocalState: PlayerState = {
          ...localStateFromServer,
          x: reconciled.x,
          y: reconciled.y,
        };

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
      cancelAnimationFrame(animationFrameId);
      network.disconnect();
      prediction.clear();
      interpolation.clear();
      inputHandler.clear();
    };
  }, [username, serverUrl, onDisconnect, showDebug]);

  const handleSpawnBots = () => {
    // We will spawn the bots by opening bot-connections locally right from this client.
    // This is incredibly robust, easy, and runs natively on the client browser showing actual network throughput load!
    // Let's write the virtual bot connection spawner right in this component to easily demo concurrency.
    console.log('Spawning 25 virtual WebSocket bots from browser...');
    for (let i = 0; i < 25; i++) {
      setTimeout(() => {
        const ws = new WebSocket(serverUrl);
        ws.binaryType = 'arraybuffer';
        let seq = 0;

        ws.onopen = () => {
          // Join message
          const joinBuffer = encodeJoin(`🤖 Bot-${Math.floor(Math.random() * 1000)}`);
          ws.send(joinBuffer);

          // Pick a direction and hold it for 2-5 seconds before changing
          let currentAngle = Math.random() * Math.PI * 2;
          let ticksUntilDirectionChange = Math.floor(20 + Math.random() * 60); // 1-4 seconds at 20Hz

          // Start movement tick loop at 20Hz
          const interval = setInterval(() => {
            if (ws.readyState !== WebSocket.OPEN) {
              clearInterval(interval);
              return;
            }
            seq++;

            // Change direction periodically, not every tick
            ticksUntilDirectionChange--;
            if (ticksUntilDirectionChange <= 0) {
              // Turn by a moderate amount (not fully random) for natural-looking movement
              currentAngle += (Math.random() - 0.5) * Math.PI * 0.8;
              ticksUntilDirectionChange = Math.floor(40 + Math.random() * 80); // 2-6 seconds
            }

            const dx = Math.cos(currentAngle);
            const dy = Math.sin(currentAngle);
            const inputBuffer = encodeInput(seq, dx, dy, currentAngle);
            ws.send(inputBuffer);
          }, 50); // 50ms = 20Hz to match server tick rate
        };
      }, i * 200); // Stagger joins to show neat connection updates
    }
  };

  return (
    <div ref={containerRef} style={{ width: '100vw', height: '100vh', position: 'relative' }}>
      <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '100%' }} />
      
      {/* HUD Layer */}
      <HUD localPlayer={localPlayer} players={players} passengers={passengers} />

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
      />
    </div>
  );
};
