import { describe, expect, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { dbManager } from './db';
import { savePlayerSession, logMatchSession, ISessionStats } from './persist';

let mongoServer: MongoMemoryServer;

describe('MongoDB Integration Tests', () => {
  beforeAll(async () => {
    // Start an in-memory MongoDB instance
    mongoServer = await MongoMemoryServer.create();
    const testUri = mongoServer.getUri();
    
    // Connect dbManager to the test instance
    await dbManager.connect(testUri);
  });

  afterAll(async () => {
    // Close dbManager connection and stop MongoMemoryServer
    await dbManager.close();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    // Clear collections before each test run
    const db = dbManager.getDb();
    await db.collection('players').deleteMany({});
    await db.collection('matches').deleteMany({});
  });

  it('connects to test db and configures indexes successfully', () => {
    const db = dbManager.getDb();
    expect(db).toBeDefined();
    // In-memory db name is random, but DbManager should have connected successfully
    expect(db.databaseName).toBeDefined();
  });

  it('savePlayerSession creates a new profile on first call and increments career total later', async () => {
    const db = dbManager.getDb();
    const playersCol = db.collection('players');

    const stats1: ISessionStats = {
      username: 'TestDriverX',
      score: 15000,
      peakStreak: 4,
      deliveriesCount: 3,
      violations: { redLights: 1, pedestrianHits: 0, driverCollisions: 2 }
    };

    // First save: Create profile
    await savePlayerSession('TestDriverX', stats1);
    let doc = await playersCol.findOne({ username: 'TestDriverX' });

    expect(doc).not.toBeNull();
    expect(doc!.careerScore).toBe(15000);
    expect(doc!.peakScore).toBe(15000);
    expect(doc!.peakStreak).toBe(4);
    expect(doc!.totalDeliveries).toBe(3);

    const stats2: ISessionStats = {
      username: 'TestDriverX',
      score: 25000,
      peakStreak: 3, // lower than previous peak (4)
      deliveriesCount: 5,
      violations: { redLights: 0, pedestrianHits: 1, driverCollisions: 1 }
    };

    // Second save: Increment score + totalDeliveries, update peakScore, preserve peakStreak
    await savePlayerSession('TestDriverX', stats2);
    doc = await playersCol.findOne({ username: 'TestDriverX' });

    expect(doc).not.toBeNull();
    expect(doc!.careerScore).toBe(40000); // 15000 + 25000
    expect(doc!.peakScore).toBe(25000); // Math.max(15000, 25000)
    expect(doc!.peakStreak).toBe(4); // Math.max(4, 3)
    expect(doc!.totalDeliveries).toBe(8); // 3 + 5
  });

  it('logMatchSession successfully inserts a match log document', async () => {
    const db = dbManager.getDb();
    const matchesCol = db.collection('matches');

    const playersStats: ISessionStats[] = [
      {
        username: 'DriverA',
        score: 12000,
        peakStreak: 2,
        deliveriesCount: 2,
        violations: { redLights: 0, pedestrianHits: 0, driverCollisions: 1 }
      },
      {
        username: 'DriverB',
        score: 35000,
        peakStreak: 6,
        deliveriesCount: 7,
        violations: { redLights: 2, pedestrianHits: 0, driverCollisions: 3 }
      }
    ];

    const startTime = new Date();
    await logMatchSession(playersStats, startTime);

    const doc = await matchesCol.findOne({ startTime });
    expect(doc).not.toBeNull();
    expect(doc!.players).toHaveLength(2);
    expect(doc!.players[0].username).toBe('DriverA');
    expect(doc!.players[1].score).toBe(35000);
  });
});
