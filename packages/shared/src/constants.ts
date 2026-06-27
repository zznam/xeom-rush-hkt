export const TICK_RATE = 20;              // 20 ticks per second
export const TICK_INTERVAL_MS = 1000 / TICK_RATE; // 50ms per tick

export const MAP_SIZE = 4000;             // 4000x4000 units
export const CHUNK_SIZE = 500;            // 500x500 units per spatial grid chunk

export const MOTORBIKE_SPEED = 200;       // Units per second
export const COLLISION_RADIUS = 25;       // Interaction radius for players/passengers

export const MAX_PASSENGERS = 80;         // Maximum passive passengers spawned in map
export const RUSH_HOUR_MULTIPLIER = 1.5;  // Passenger spawn speed multiplier during rush hour
export const TICK_METRIC_WINDOW = 100;    // Number of ticks for moving average analytics
