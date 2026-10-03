import type { ShiftSummary } from './gameplay';
export interface CareerContribution {
  username: string;
  score: number;
  peakStreak: number;
  deliveriesCount: number;
  revision?: number;
  summary?: ShiftSummary;
  progress?: Record<string, Record<string, number>>;
}
export interface CareerProfile {
  id: string;
  username: string;
  careerScore: number;
  totalDeliveries: number;
  peakScore: number;
  peakStreak: number;
  summary: ShiftSummary;
  contributions: Record<string, CareerContribution>;
  unlocked: string[];
  equipped: Record<string, string>;
  claims: string[];
  progress: Record<string, Record<string, number>>;
}
export function emptySummary(): ShiftSummary {
  return { distance: 0, cleanTrips: 0, baseFares: 0, bonuses: 0, tips: 0, fines: 0, fastestTripTicks: 0, visited: [] };
}
export function newCareer(id: string, username = ''): CareerProfile {
  return {
    id,
    username,
    careerScore: 0,
    totalDeliveries: 0,
    peakScore: 0,
    peakStreak: 0,
    summary: emptySummary(),
    contributions: {},
    unlocked: ['paint-0', 'helmet-0', 'jacket-0', 'horn-0'],
    equipped: { paint: 'paint-0', helmet: 'helmet-0', jacket: 'jacket-0', horn: 'horn-0' },
    claims: [],
    progress: {},
  };
}
export function applyContribution(
  profile: CareerProfile,
  session: string,
  next: CareerContribution,
  previous = profile.contributions[session],
): CareerProfile {
  if (previous && (next.revision ?? 0) < (previous.revision ?? 0)) return profile;
  const result: CareerProfile = structuredClone(profile);
  result.username = next.username;
  result.careerScore += next.score - (previous?.score ?? 0);
  result.totalDeliveries += next.deliveriesCount - (previous?.deliveriesCount ?? 0);
  result.peakScore = Math.max(result.peakScore, next.score);
  result.peakStreak = Math.max(result.peakStreak, next.peakStreak);
  const old = previous?.summary ?? emptySummary(),
    stats = next.summary ?? emptySummary();
  for (const key of ['distance', 'cleanTrips', 'baseFares', 'bonuses', 'tips', 'fines'] as const)
    result.summary[key] += stats[key] - old[key];
  if (stats.fastestTripTicks > 0)
    result.summary.fastestTripTicks =
      result.summary.fastestTripTicks > 0
        ? Math.min(result.summary.fastestTripTicks, stats.fastestTripTicks)
        : stats.fastestTripTicks;
  result.summary.visited = [...new Set([...result.summary.visited, ...stats.visited])];
  for (const [period, counts] of Object.entries(next.progress ?? {}))
    for (const [key, count] of Object.entries(counts)) {
      result.progress[period] ??= {};
      result.progress[period][key] =
        (result.progress[period][key] ?? 0) + count - (previous?.progress?.[period]?.[key] ?? 0);
    }
  result.contributions[session] = structuredClone(next);
  return result;
}
export function publicCareer(profile: CareerProfile) {
  const { contributions, ...view } = profile;
  return view;
}
