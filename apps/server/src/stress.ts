import WebSocket from 'ws';
import { encodeJoin, encodeInput, EMessageType, decodeSnapshot, decodeConfig } from '@xeom-rush/shared';

// Parse CLI arguments
const args = process.argv.slice(2);
let clientCount = 100; // Default 100 bots
let durationSec = 15;  // Default 15 seconds
let serverUrl = 'ws://localhost:3002';

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--clients' || args[i] === '-c') {
    clientCount = parseInt(args[i + 1], 10);
    i++;
  } else if (args[i] === '--duration' || args[i] === '-d') {
    durationSec = parseInt(args[i + 1], 10);
    i++;
  } else if (args[i] === '--url' || args[i] === '-u') {
    serverUrl = args[i + 1];
    i++;
  }
}

console.log('====================================================');
console.log('🚀 XE ÔM RUSH - LOAD & STRESS TESTING ORCHESTRATOR');
console.log('====================================================');
console.log(`Target URL:       ${serverUrl}`);
console.log(`Client Count:     ${clientCount} headless bots`);
console.log(`Duration:         ${durationSec} seconds`);
console.log('====================================================\n');

interface ClientStats {
  id: string;
  connected: boolean;
  packetsReceived: number;
  packetsSent: number;
  rttList: number[];
}

const stats: Map<number, ClientStats> = new Map();
const activeSockets: WebSocket[] = [];
let connectionsEstablished = 0;
let connectionsFailed = 0;

// Initialize stats
for (let i = 0; i < clientCount; i++) {
  stats.set(i, {
    id: `bot-${i}`,
    connected: false,
    packetsReceived: 0,
    packetsSent: 0,
    rttList: [],
  });
}

const startTime = Date.now();

// Function to spin up a single bot client
function spawnBot(index: number) {
  const clientStat = stats.get(index)!;
  const ws = new WebSocket(serverUrl);
  activeSockets.push(ws);

  ws.binaryType = 'arraybuffer';
  let seq = 0;
  let intervalId: NodeJS.Timeout | null = null;
  let pingSentTime = 0;

  ws.on('open', () => {
    clientStat.connected = true;
    connectionsEstablished++;

    // 1. Send Join Payload
    const joinBuffer = encodeJoin(`Bot-${index}`);
    ws.send(joinBuffer);

    // 2. Setup 20Hz Input loop (matches server tick rate)
    intervalId = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        seq++;
        // Walk randomly
        const angle = Math.random() * Math.PI * 2;
        const dx = Math.cos(angle);
        const dy = Math.sin(angle);

        const inputBuffer = encodeInput(seq, dx, dy, angle);
        ws.send(inputBuffer);
        clientStat.packetsSent++;

        // Periodically measure RTT (approx)
        if (seq % 20 === 0) {
          pingSentTime = Date.now();
        }
      }
    }, 50); // 50ms = 20 ticks/sec
  });

  ws.on('message', (data: ArrayBuffer) => {
    try {
      const view = new DataView(data);
      const msgType = view.getUint8(0);

      if (msgType === EMessageType.SNAPSHOT) {
        clientStat.packetsReceived++;
        
        // Measure RTT response
        if (pingSentTime > 0) {
          const rtt = Date.now() - pingSentTime;
          clientStat.rttList.push(rtt);
          if (clientStat.rttList.length > 50) {
            clientStat.rttList.shift();
          }
          pingSentTime = 0;
        }
      }
    } catch (e) {
      // Ignore parsing errors under high load simulation
    }
  });

  ws.on('error', () => {
    connectionsFailed++;
  });

  ws.on('close', () => {
    clientStat.connected = false;
    if (intervalId) {
      clearInterval(intervalId);
    }
  });
}

// Spawn all bots in a staggered window to simulate concurrent connection floods
console.log(`[Status] Spawning ${clientCount} bots staggered...`);
for (let i = 0; i < clientCount; i++) {
  setTimeout(() => {
    spawnBot(i);
  }, i * 15); // 15ms stagger avoids local buffer socket limits
}

// Print moving telemetry table
const printInterval = setInterval(() => {
  const elapsed = Math.floor((Date.now() - startTime) / 1000);
  
  // Calculate average latency
  const allRtts: number[] = [];
  let totalReceived = 0;
  let totalSent = 0;
  let activeCount = 0;

  for (const s of stats.values()) {
    if (s.connected) activeCount++;
    totalReceived += s.packetsReceived;
    totalSent += s.packetsSent;
    allRtts.push(...s.rttList);
  }

  const avgRtt = allRtts.length > 0 ? (allRtts.reduce((a, b) => a + b, 0) / allRtts.length).toFixed(1) : 'N/A';

  console.log(
    `[Time: ${elapsed}s/${durationSec}s] ` +
    `Connected: ${activeCount}/${clientCount} | ` +
    `Sent: ${totalSent} pkts | ` +
    `Recv: ${totalReceived} pkts | ` +
    `Avg Latency (RTT): ${avgRtt} ms`
  );
}, 2000);

// Close and compile diagnostics
setTimeout(() => {
  clearInterval(printInterval);
  console.log('\n====================================================');
  console.log('🏁 STRESS TEST COMPLETED — DIAGNOSTIC REPORT');
  console.log('====================================================');

  // Close all sockets
  activeSockets.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close();
    }
  });

  const finalElapsed = (Date.now() - startTime) / 1000;
  let totalReceived = 0;
  let totalSent = 0;
  const finalRtts: number[] = [];

  for (const s of stats.values()) {
    totalReceived += s.packetsReceived;
    totalSent += s.packetsSent;
    finalRtts.push(...s.rttList);
  }

  // Sort latencies to compute percentiles
  finalRtts.sort((a, b) => a - b);
  const p50 = finalRtts.length > 0 ? finalRtts[Math.floor(finalRtts.length * 0.50)] : 0;
  const p95 = finalRtts.length > 0 ? finalRtts[Math.floor(finalRtts.length * 0.95)] : 0;
  const p99 = finalRtts.length > 0 ? finalRtts[Math.floor(finalRtts.length * 0.99)] : 0;

  console.log(`Success Rate:      ${((connectionsEstablished / clientCount) * 100).toFixed(1)}%`);
  console.log(`Lost Connections:  ${clientCount - connectionsEstablished} sockets`);
  console.log(`Total Packets Up:  ${totalSent} (Inputs)`);
  console.log(`Total Packets Down: ${totalReceived} (Snapshots)`);
  console.log(`Throughput Rate:   ${((totalSent + totalReceived) / finalElapsed).toFixed(1)} packets/sec`);
  console.log('----------------------------------------------------');
  console.log(`Average Latency:   ${finalRtts.length > 0 ? (finalRtts.reduce((a, b) => a + b, 0) / finalRtts.length).toFixed(1) : 'N/A'} ms`);
  console.log(`50th Percentile:   ${p50} ms`);
  console.log(`95th Percentile:   ${p95} ms`);
  console.log(`99th Percentile:   ${p99} ms`);
  console.log('====================================================\n');
  process.exit(0);
}, durationSec * 1000 + 1000); // Allow brief buffer time for final print
