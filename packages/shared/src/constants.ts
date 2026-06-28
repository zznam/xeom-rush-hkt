export const TICK_RATE = 20;              // 20 ticks per second
export const TICK_INTERVAL_MS = 1000 / TICK_RATE; // 50ms per tick

export const MAP_SIZE = 4000;             // 4000x4000 units
export const CHUNK_SIZE = 500;            // 500x500 units per spatial grid chunk

export const MOTORBIKE_SPEED = 200;       // Units per second
export const COLLISION_RADIUS = 25;       // Interaction radius for players/passengers

export const MAX_PASSENGERS = 80;         // Maximum passive passengers spawned in map
export const RUSH_HOUR_MULTIPLIER = 1.5;  // Reward multiplier during rush hour
export const TICK_METRIC_WINDOW = 100;    // Number of ticks for moving average analytics

// Rush Hour event timing
export const RUSH_HOUR_INTERVAL_TICKS = 6000; // 5 minutes at 20Hz between events
export const RUSH_HOUR_DURATION_TICKS = 1200; // 60 seconds at 20Hz per event
export const RUSH_HOUR_SPAWN_MULTIPLIER = 2;  // Double spawn rate during rush hour

// Combo/Streak system
export const STREAK_RESET_TICKS = 600;    // 30 seconds at 20Hz of idle resets streak

// Passenger tier spawn weights (must sum to 1.0)
export const TIER_WEIGHT_REGULAR = 0.70;
export const TIER_WEIGHT_BUSINESS = 0.20;
export const TIER_WEIGHT_VIP = 0.10;

// Passenger tier reward multipliers
export const TIER_MULTIPLIER_BUSINESS = 2;
export const TIER_MULTIPLIER_VIP = 5;

// Streak multiplier thresholds and values
export const STREAK_MULTIPLIERS: { minStreak: number; multiplier: number }[] = [
  { minStreak: 10, multiplier: 3.0 },
  { minStreak: 5, multiplier: 2.0 },
  { minStreak: 3, multiplier: 1.5 },
  { minStreak: 1, multiplier: 1.0 },
];
