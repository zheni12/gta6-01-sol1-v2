// ── config.js — the game's shared foundation: grid, palettes, districts.
// Exports: layout constants, TIMES_OF_DAY, PALETTE, DISTRICTS, CAR_MODELS,
// RANKS, SAVE_KEY, and helpers (clamp, lerp, rand, pick, dist2D,
// wrapAngle, mulberry32, districtAt, standingLabel, rankFor). Imported by
// every other module; imports nothing itself, so it can never cycle.
// SOLMAR HEAT — shared constants and tiny helpers used by every system:
// the city grid, the three times of day, the five districts of Solmar Bay,
// the car model names, the rank ladder, and a deterministic RNG.

export const PITCH = 64;                 // distance between block centres
export const BLOCK = 40;                 // building block size
export const ROAD = 24;                  // road width between blocks
export const BLOCK_CENTERS = [-160, -96, -32, 32, 96, 160];
export const ROAD_LINES = [-192, -128, -64, 0, 64, 128, 192];
export const CITY_EDGE = 214;            // cars stay inside this square
export const SAVE_KEY = 'solmar-heat-save-v1';

// One palette per time of day. Day is the default: bright, saturated,
// sun-soaked — the look the screenshots are staged in.
export const TIMES_OF_DAY = {
  day: {
    sky: 0x59b7e8, fog: 0xc9e9f6, fogNear: 210, fogFar: 980,
    sunColor: 0xffeec4, sunIntensity: 1.24, sunPos: [-140, 260, -160],
    hemiSky: 0xd8f0ff, hemiGround: 0x9a8560, hemiIntensity: 1.0,
    ambient: 0x8899bb, ambientIntensity: 0.26, sunDisc: 0xfff6c9,
  },
  dusk: {
    sky: 0x53355e, fog: 0x9c5a68, fogNear: 130, fogFar: 640,
    sunColor: 0xffa860, sunIntensity: 0.95, sunPos: [-180, 190, -90],
    hemiSky: 0xffd9b0, hemiGround: 0x2c3550, hemiIntensity: 0.85,
    ambient: 0x604a70, ambientIntensity: 0.5, sunDisc: 0xffc98a,
  },
  night: {
    sky: 0x0d1526, fog: 0x1b2742, fogNear: 110, fogFar: 560,
    sunColor: 0x8fb4ff, sunIntensity: 0.35, sunPos: [120, 220, 80],
    hemiSky: 0x33507a, hemiGround: 0x0c1018, hemiIntensity: 0.5,
    ambient: 0x2a3a5f, ambientIntensity: 0.55, sunDisc: 0xdfe9ff,
  },
};

export const PALETTE = {
  sky: 0x59b7e8,
  fog: 0xaadcf2,
  sun: 0xfff6c9,
  ground: 0xd9b77c,
  slab: 0x596066,
  road: 0x272b33,
  walk: 0x828a91,
  water: 0x1b6f8e,
  sand: 0xe6c88a,
  // One tight tropical grade for every car in the bay — coral, marigold,
  // turquoise, sea-blue, warm white, deep navy, pastel pink, sage. No
  // lime, no purple: the fleet reads as one sunlit place, not a toy box.
  carColors: [0xe85447, 0xff8c42, 0xffc53d, 0x2ec4b6, 0xe58e26, 0x277da1, 0xf5f0e6, 0x2b2d42, 0x7fb069, 0xf48498, 0xff6b35, 0x00b8a9],
};

// The five districts of Solmar Bay. Standing is earned per district by
// finishing job stages inside its bounds.
export const DISTRICTS = [
  { id: 'strand', name: 'THE STRAND', test: (x, z) => z >= 158 },
  { id: 'market', name: 'OLD MARKET', test: (x, z) => x <= -62 && z <= -30 },
  { id: 'bankrow', name: 'BANK ROW', test: (x, z) => x >= 62 && z <= 30 },
  { id: 'palm', name: 'PALM HEIGHTS', test: (x, z) => x <= -62 && z >= 30 },
  { id: 'midtown', name: 'MIDTOWN', test: () => true },
];

export function districtAt(x, z) {
  for (const d of DISTRICTS) if (d.test(x, z)) return d;
  return DISTRICTS[DISTRICTS.length - 1];
}

export function standingLabel(points) {
  if (points >= 120) return 'FAMILY';
  if (points >= 60) return 'TRUSTED';
  if (points >= 20) return 'KNOWN FACE';
  return 'UNKNOWN';
}

// Original Solmar Bay car models, cycled onto every car that spawns.
export const CAR_MODELS = [
  'Vireo Coupe', 'Sundae Hatch', 'Marlin Sedan', 'Kestrel GT', 'Bantam Van',
  'Corvina Roadster', 'Tern Pickup', 'Alto Cruiser', 'Pico City', 'Regent Luxe',
  'Darter Compact', 'Sirocco Sport',
];

// The rank ladder: RP thresholds and the title each one earns.
export const RANKS = [
  { rp: 0, name: 'CURB RUNNER' },
  { rp: 150, name: 'WHEELMAN' },
  { rp: 350, name: 'GETAWAY DRIVER' },
  { rp: 650, name: 'FIXER' },
  { rp: 1000, name: 'CREW LEADER' },
  { rp: 1500, name: 'BAY LEGEND' },
];

export function rankFor(rp) {
  let idx = 0;
  for (let i = 0; i < RANKS.length; i++) if (rp >= RANKS[i].rp) idx = i;
  const cur = RANKS[idx];
  const next = RANKS[idx + 1] || null;
  return { idx, name: cur.name, next, floor: cur.rp, ceil: next ? next.rp : cur.rp };
}

// Deterministic RNG so ?seed= screenshots always stage the same city.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const rand = (rng, a, b) => a + rng() * (b - a);
export const pick = (rng, arr) => arr[Math.floor(rng() * arr.length) % arr.length];
export function dist2D(ax, az, bx, bz) { return Math.hypot(ax - bx, az - bz); }

// Wrap an angle to [-PI, PI] so heading lerps take the short way round.
export function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
