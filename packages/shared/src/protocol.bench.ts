import { bench, describe } from 'vitest';
import { encodeSnapshot, decodeSnapshot } from './protocol';
import { type PlayerState, type PassengerState } from './types';

// Seed mock data for benchmark representing a chunk snapshot
const mockPlayers: PlayerState[] = [];
for (let i = 0; i < 15; i++) {
  mockPlayers.push({
    id: `player-${i}`,
    username: `Xế-Ôm-${i}`,
    x: 2000 + i * 50,
    y: 2000 + i * 50,
    angle: Math.random() * Math.PI,
    score: i * 5000,
    lastProcessedSeq: i * 10,
    passengerId: i % 3 === 0 ? `pass-${i}` : null,
    connected: true,
  });
}

const mockPassengers: PassengerState[] = [];
for (let i = 0; i < 20; i++) {
  mockPassengers.push({
    id: `pass-${i}`,
    x: 1000 + i * 100,
    y: 1000 + i * 100,
    destX: 3000 - i * 100,
    destY: 3000 - i * 100,
    reward: 15000 + i * 1000,
    spawnedAt: Date.now(),
    isCarried: i % 3 === 0,
    tier: 0, // REGULAR
    deadline: 0,
  });
}

const tick = 12345;

describe('Serialization / Encoding Throughput', () => {
  // 1. Binary Encoding
  bench('Binary Encode (Custom Buffer)', () => {
    encodeSnapshot(tick, mockPlayers, mockPassengers);
  });

  // 2. JSON.stringify
  bench('JSON stringify', () => {
    JSON.stringify({
      tick,
      players: mockPlayers,
      passengers: mockPassengers,
    });
  });
});

describe('Deserialization / Decoding Throughput', () => {
  // Pre-encoded snap buffers
  const binaryBuffer = encodeSnapshot(tick, mockPlayers, mockPassengers);

  const rawDataObj = {
    tick,
    players: mockPlayers,
    passengers: mockPassengers,
  };
  const jsonString = JSON.stringify(rawDataObj);

  // 1. Binary Decoding
  bench('Binary Decode (Custom Buffer)', () => {
    decodeSnapshot(binaryBuffer);
  });

  // 2. JSON.parse
  bench('JSON parse', () => {
    JSON.parse(jsonString);
  });
});
