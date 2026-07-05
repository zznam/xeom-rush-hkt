import { MongoClient, Db } from 'mongodb';

export class DbManager {
  private static instance: DbManager | null = null;
  private client: MongoClient | null = null;
  private dbName: string = 'xeom_rush';

  private constructor() {}

  public static getInstance(): DbManager {
    if (!DbManager.instance) {
      DbManager.instance = new DbManager();
    }
    return DbManager.instance;
  }

  /**
   * Establishes a connection to the MongoDB server.
   */
  public async connect(uri: string): Promise<void> {
    if (this.client) {
      return;
    }

    try {
      this.client = new MongoClient(uri, {
        serverSelectionTimeoutMS: 2000, // 2s timeout for server selection
        connectTimeoutMS: 2000, // 2s timeout for initial connection
      });
      await this.client.connect();

      // Extract DB name from URI if present, otherwise default to 'xeom_rush'
      const parsedUri = new URL(uri);
      const pathname = parsedUri.pathname.replace(/^\//, '');
      if (pathname) {
        this.dbName = pathname;
      }

      console.log(`[DB] Connected to MongoDB at ${parsedUri.host}, database: ${this.dbName}`);

      // Build indexes for optimal queries
      await this.ensureIndexes();
    } catch (error) {
      console.error('[DB] Failed to connect to MongoDB:', error);
      this.client = null;
      throw error;
    }
  }

  /**
   * Returns the database instance.
   */
  public getDb(): Db {
    if (!this.client) {
      throw new Error('[DB] Database is not connected. Call connect() first.');
    }
    return this.client.db(this.dbName);
  }

  /**
   * Closes the database connection.
   */
  public async close(): Promise<void> {
    if (this.client) {
      await this.client.close();
      console.log('[DB] Connection closed.');
      this.client = null;
    }
  }

  /**
   * Ensures essential indexes exist.
   */
  private async ensureIndexes(): Promise<void> {
    const db = this.getDb();

    // 1. Players collection index for leaderboard and username lookup
    const playersCol = db.collection('players');
    await playersCol.createIndex({ username: 1 }, { unique: true });
    await playersCol.createIndex({ careerScore: -1 });

    // 2. Matches collection index for recent match logs and user query
    const matchesCol = db.collection('matches');
    await matchesCol.createIndex({ startTime: -1 });
    await matchesCol.createIndex({ 'players.username': 1 });

    console.log('[DB] Database indexes verified.');
  }
}

export const dbManager = DbManager.getInstance();
