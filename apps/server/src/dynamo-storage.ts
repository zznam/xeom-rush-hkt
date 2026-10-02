import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import type { ISessionStats } from './persist';

export interface Career {
  username: string;
  careerScore: number;
  totalDeliveries: number;
  peakScore: number;
  peakStreak: number;
}

export function accumulate(old: Career | undefined, previous: ISessionStats | undefined, stats: ISessionStats): Career {
  return {
    username: stats.username,
    careerScore: (old?.careerScore ?? 0) + stats.score - (previous?.score ?? 0),
    totalDeliveries: (old?.totalDeliveries ?? 0) + stats.deliveriesCount - (previous?.deliveriesCount ?? 0),
    peakScore: Math.max(old?.peakScore ?? 0, stats.score),
    peakStreak: Math.max(old?.peakStreak ?? 0, stats.peakStreak),
  };
}

export class DynamoPersistence {
  constructor(
    private table: string,
    private client = DynamoDBDocumentClient.from(new DynamoDBClient({ maxAttempts: 3 })),
  ) {}

  async health(): Promise<void> {
    await this.client.send(new GetCommand({ TableName: this.table, Key: { pk: 'health' } }), {
      abortSignal: AbortSignal.timeout(2000),
    });
  }

  async save(session: string, stats: ISessionStats): Promise<void> {
    if (!stats.profileId) throw new Error('AWS careers require an authenticated guest identity');
    for (let attempt = 0; attempt < 8; attempt++) {
      const [profile, contribution] = await Promise.all([
        this.client.send(
          new GetCommand({ TableName: this.table, Key: { pk: `player:${stats.profileId}` }, ConsistentRead: true }),
        ),
        this.client.send(
          new GetCommand({ TableName: this.table, Key: { pk: `session:${session}` }, ConsistentRead: true }),
        ),
      ]);
      const previous = contribution.Item?.stats as ISessionStats | undefined;
      if (previous && previous.profileId !== stats.profileId) throw new Error('Session owner mismatch');
      if (previous && JSON.stringify(previous) === JSON.stringify(stats)) return;
      const next = accumulate(profile.Item as Career | undefined, previous, stats);
      const conditionalPut = (pk: string, old: Record<string, any> | undefined, values: Record<string, unknown>) => ({
        Put: {
          TableName: this.table,
          Item: { pk, ...values, revision: (old?.revision ?? 0) + 1 },
          ConditionExpression: old ? 'revision = :revision' : 'attribute_not_exists(pk)',
          ...(old ? { ExpressionAttributeValues: { ':revision': old.revision } } : {}),
        },
      });
      try {
        await this.client.send(
          new TransactWriteCommand({
            TransactItems: [
              conditionalPut(`player:${stats.profileId}`, profile.Item, { ...next, board: 'regional' }),
              // Retain contributions: expiring them would make an old retry count twice.
              conditionalPut(`session:${session}`, contribution.Item, { stats }),
            ],
          }),
        );
        return;
      } catch (error) {
        if ((error as Error).name !== 'TransactionCanceledException' || attempt === 7) throw error;
        await new Promise((resolve) => setTimeout(resolve, 20 * 2 ** attempt + Math.random() * 30));
      }
    }
  }

  async leaderboard(): Promise<Career[]> {
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.table,
        IndexName: 'leaderboard',
        KeyConditionExpression: 'board = :board',
        ExpressionAttributeValues: { ':board': 'regional' },
        ScanIndexForward: false,
        Limit: 10,
      }),
    );
    return (result.Items ?? []).map((row) => ({
      username: row.username,
      careerScore: row.careerScore,
      totalDeliveries: row.totalDeliveries,
      peakScore: row.peakScore,
      peakStreak: row.peakStreak,
    }));
  }
  close(): void {
    this.client.destroy();
  }
}
