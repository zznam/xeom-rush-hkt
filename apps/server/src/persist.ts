import { dbManager } from './db';

export interface ISessionStats {
  username: string;
  score: number;
  peakStreak: number;
  deliveriesCount: number;
  violations: {
    redLights: number;
    pedestrianHits: number;
    driverCollisions: number;
  };
}

/**
 * Saves a player's session statistics to the database.
 * Updates career totals and updates peak scores/streaks if exceeded.
 */
export async function savePlayerSession(username: string, stats: ISessionStats): Promise<void> {
  try {
    const db = dbManager.getDb();
    const playersCol = db.collection('players');

    // Fetch existing profile
    const profile = await playersCol.findOne({ username });

    if (!profile) {
      // First time player profile creation
      await playersCol.insertOne({
        username,
        careerScore: stats.score,
        peakScore: stats.score,
        peakStreak: stats.peakStreak,
        totalDeliveries: stats.deliveriesCount,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      console.log(`[Persist] Created new career profile for user: ${username}`);
    } else {
      // Update existing stats
      const peakScore = Math.max(profile.peakScore || 0, stats.score);
      const peakStreak = Math.max(profile.peakStreak || 0, stats.peakStreak);

      await playersCol.updateOne(
        { username },
        {
          $inc: {
            careerScore: stats.score,
            totalDeliveries: stats.deliveriesCount,
          },
          $set: {
            peakScore,
            peakStreak,
            updatedAt: new Date(),
          },
        }
      );
      console.log(`[Persist] Updated career profile for user: ${username} (+${stats.score}đ, +${stats.deliveriesCount} deliveries)`);
    }
  } catch (error) {
    console.error(`[Persist] Failed to save player session for user: ${username}`, error);
  }
}

/**
 * Logs a complete match session log into database history.
 */
export async function logMatchSession(players: ISessionStats[], startTime: Date = new Date(Date.now() - 60000)): Promise<void> {
  try {
    const db = dbManager.getDb();
    const matchesCol = db.collection('matches');

    await matchesCol.insertOne({
      startTime,
      endTime: new Date(),
      players: players.map(p => ({
        username: p.username,
        score: p.score,
        deliveriesCount: p.deliveriesCount,
        peakStreak: p.peakStreak,
        violations: p.violations
      }))
    });
    console.log(`[Persist] Logged match session with ${players.length} participants.`);
  } catch (error) {
    console.error('[Persist] Failed to log match session:', error);
  }
}
