import type { ShiftSummary } from '@xeom-rush/shared';
import { readStored } from './preferences';

export const SHIFT_LIMIT = 30;
export type ShiftMode = 'career' | 'sandbox' | 'friends';
export type GoalMetric = 'score' | 'deliveries' | 'cleanTrips' | 'distance';
export interface ShiftGoal {
  metric: GoalMetric;
  target: number;
}
export interface ShiftRecord {
  id: string;
  endedAt: number;
  mode: ShiftMode;
  score: number;
  deliveries: number;
  cleanTrips: number;
  distance: number;
  fines: number;
}
export const GOAL_LABELS: Record<GoalMetric, string> = {
  score: 'Thu nhập (đ)',
  deliveries: 'Chuyến hoàn thành',
  cleanTrips: 'Chuyến an toàn',
  distance: 'Quãng đường (m)',
};
export const MODE_LABELS: Record<ShiftMode, string> = {
  career: 'Thành phố',
  sandbox: 'Chơi thử',
  friends: 'Phòng bạn bè',
};
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;

export function loadShiftGoal(): ShiftGoal | null {
  try {
    const goal = JSON.parse(readStored('shift-goal', 'null'));
    return goal &&
      Object.hasOwn(GOAL_LABELS, goal.metric) &&
      Number.isInteger(goal.target) &&
      goal.target > 0 &&
      goal.target <= 10_000_000
      ? { metric: goal.metric, target: goal.target }
      : null;
  } catch {
    return null;
  }
}

export function loadShifts(): ShiftRecord[] {
  try {
    const data = JSON.parse(readStored('shift-history', '{}'));
    if (data?.version !== 1 || !Array.isArray(data.shifts)) return [];
    const ids = new Set<string>();
    return data.shifts
      .filter((s: ShiftRecord) => {
        if (
          !s ||
          typeof s.id !== 'string' ||
          s.id.length > 80 ||
          ids.has(s.id) ||
          !Object.hasOwn(MODE_LABELS, s.mode) ||
          !isNumber(s.endedAt) ||
          s.endedAt > 8.64e15 ||
          ![s.score, s.deliveries, s.cleanTrips, s.distance, s.fines].every(isNumber)
        )
          return false;
        ids.add(s.id);
        return true;
      })
      .sort((a: ShiftRecord, b: ShiftRecord) => b.endedAt - a.endedAt)
      .slice(0, SHIFT_LIMIT);
  } catch {
    return [];
  }
}

export function storeNotebook(key: 'shift-goal' | 'shift-history', value: unknown): boolean {
  try {
    localStorage.setItem(`xeom:${key}`, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function saveShift(record: ShiftRecord): boolean {
  const shifts = [record, ...loadShifts().filter((s) => s.id !== record.id)].slice(0, SHIFT_LIMIT);
  return storeNotebook('shift-history', { version: 1, shifts });
}

export function shiftMetrics(score: number, deliveries: number, summary: ShiftSummary | null) {
  return {
    score,
    deliveries,
    cleanTrips: summary?.cleanTrips ?? 0,
    distance: Math.round(summary?.distance ?? 0),
    fines: summary?.fines ?? 0,
  };
}
