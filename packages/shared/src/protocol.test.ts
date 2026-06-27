import { describe, it, expect } from 'vitest';
import {
  encodeJoin,
  decodeJoin,
  encodeConfig,
  decodeConfig,
  encodeInput,
  decodeInput,
  encodeSnapshot,
  decodeSnapshot,
} from './protocol';
import { type PlayerState, type PassengerState, type PedestrianState, type TrafficLightState } from './types';

describe('Binary Wire Protocol Encoder/Decoder', () => {
  it('should serialize and deserialize Join payload correctly', () => {
    const username = 'AnXeOm99';
    const buffer = encodeJoin(username);
    const decoded = decodeJoin(buffer);
    expect(decoded).toBe(username);
  });

  it('should serialize and deserialize Config payload correctly', () => {
    const myId = 'player-456';
    const mapSize = 4000;
    const chunkSize = 500;

    const buffer = encodeConfig(myId, mapSize, chunkSize);
    const decoded = decodeConfig(buffer);

    expect(decoded.myId).toBe(myId);
    expect(decoded.mapSize).toBe(mapSize);
    expect(decoded.chunkSize).toBe(chunkSize);
  });

  it('should serialize and deserialize Input payload correctly', () => {
    const seq = 12345;
    const dx = -0.707;
    const dy = 0.707;
    const angle = 2.35;

    const buffer = encodeInput(seq, dx, dy, angle);
    const decoded = decodeInput(buffer);

    expect(decoded.seq).toBe(seq);
    // Float values may have slight rounding differences, check closeTo
    expect(decoded.dx).toBeCloseTo(dx, 3);
    expect(decoded.dy).toBeCloseTo(dy, 3);
    expect(decoded.angle).toBeCloseTo(angle, 3);
  });

  it('should serialize and deserialize World Snapshot payload correctly', () => {
    const tick = 999;

    const players: PlayerState[] = [
      {
        id: 'p1',
        username: 'GrabDriver',
        x: 1520.5,
        y: 2450.2,
        angle: 1.57,
        score: 55000,
        lastProcessedSeq: 42,
        passengerId: 'pass-8',
        connected: true,
        lastViolation: {
          type: 'red-light',
          amount: 2000,
          tick: 998,
        },
      },
      {
        id: 'p2',
        username: 'XeOmTruyenThong',
        x: 2000,
        y: 2000,
        angle: 0,
        score: 0,
        lastProcessedSeq: 0,
        passengerId: null,
        connected: true,
      },
    ];

    const passengers: PassengerState[] = [
      {
        id: 'pass-8',
        x: 1500,
        y: 2400,
        destX: 3500,
        destY: 3800,
        reward: 25000,
        spawnedAt: Date.now(),
        isCarried: true,
      },
      {
        id: 'pass-9',
        x: 1000,
        y: 1000,
        destX: 2000,
        destY: 2000,
        reward: 12000,
        spawnedAt: Date.now(),
        isCarried: false,
      },
    ];

    const buffer = encodeSnapshot(tick, players, passengers, [], []);
    const decoded = decodeSnapshot(buffer);

    expect(decoded.tick).toBe(tick);
    expect(decoded.players.length).toBe(players.length);
    expect(decoded.passengers.length).toBe(passengers.length);

    // Verify Player 1
    const decodedP1 = decoded.players[0];
    expect(decodedP1.id).toBe(players[0].id);
    expect(decodedP1.username).toBe(players[0].username);
    expect(decodedP1.x).toBeCloseTo(players[0].x, 1);
    expect(decodedP1.y).toBeCloseTo(players[0].y, 1);
    expect(decodedP1.angle).toBeCloseTo(players[0].angle, 2);
    expect(decodedP1.score).toBe(players[0].score);
    expect(decodedP1.lastProcessedSeq).toBe(players[0].lastProcessedSeq);
    expect(decodedP1.passengerId).toBe(players[0].passengerId);
    expect(decodedP1.lastViolation).toEqual(players[0].lastViolation);

    // Verify Player 2 (passengerId should be null)
    const decodedP2 = decoded.players[1];
    expect(decodedP2.passengerId).toBeNull();
    expect(decodedP2.lastViolation).toBeUndefined();

    // Verify Passenger 2 (not carried)
    const decodedPass2 = decoded.passengers[1];
    expect(decodedPass2.id).toBe(passengers[1].id);
    expect(decodedPass2.x).toBeCloseTo(passengers[1].x, 1);
    expect(decodedPass2.y).toBeCloseTo(passengers[1].y, 1);
    expect(decodedPass2.destX).toBeCloseTo(passengers[1].destX, 1);
    expect(decodedPass2.destY).toBeCloseTo(passengers[1].destY, 1);
    expect(decodedPass2.reward).toBe(passengers[1].reward);
    expect(decodedPass2.isCarried).toBe(passengers[1].isCarried);

    // Verify new fields are present and empty
    expect(decoded.trafficLights).toEqual([]);
    expect(decoded.pedestrians).toEqual([]);
  });

  it('should serialize and deserialize traffic lights and pedestrians in snapshots', () => {
    const players: PlayerState[] = [];
    const passengers: PassengerState[] = [];
    const trafficLights: TrafficLightState[] = [
      { id: 'tl-2-3', x: 850, y: 1250, isRedNS: true, isYellow: false },
      { id: 'tl-3-4', x: 1250, y: 1650, isRedNS: false, isYellow: true },
    ];
    const pedestrians: PedestrianState[] = [
      { id: 'ped-1', x: 900, y: 1200, angle: Math.PI / 2 },
      { id: 'ped-2', x: 1300, y: 1600, angle: Math.PI },
    ];

    const buffer = encodeSnapshot(1001, players, passengers, trafficLights, pedestrians);
    const decoded = decodeSnapshot(buffer);

    expect(decoded.trafficLights).toHaveLength(trafficLights.length);
    expect(decoded.trafficLights[0]).toEqual(trafficLights[0]);
    expect(decoded.trafficLights[1]).toEqual(trafficLights[1]);
    expect(decoded.pedestrians).toHaveLength(pedestrians.length);
    expect(decoded.pedestrians[0].id).toBe(pedestrians[0].id);
    expect(decoded.pedestrians[0].x).toBeCloseTo(pedestrians[0].x, 1);
    expect(decoded.pedestrians[0].y).toBeCloseTo(pedestrians[0].y, 1);
    expect(decoded.pedestrians[0].angle).toBeCloseTo(pedestrians[0].angle, 3);
  });
});
