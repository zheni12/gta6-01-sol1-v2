// ── stats.js — career counters, mission medals and bay completion.
// Exports: ACT_NAMES, actNameFor, gradeMission, CareerStats. Counters are
// incremented at the real events in main.js / missions.js / combat.js /
// collectibles.js; hud.js renders them on the pause dossier screen, and
// main.js persists them through the save payload.
// Career statistics: the numbers the pause screen's checklist, career
// panel, medal row and completion ring are computed from. Every counter
// is fed by a real event in the game — a car entered that was not yours,
// a pursuit that cooled to zero stars, a shot that dropped a pedestrian,
// a ramp launch that landed, a star pickup walked or driven over — so
// the percentages on the stats screen are earned, never typed in.

import { clamp, DISTRICTS } from './config.js';
import { MISSION_NAMES } from './missions.js';
import { COLLECTIBLE_SPOTS } from './collectibles.js';

// Par times (seconds) per story mission: beating 85% of par with a clean
// car earns the S. Damage taken during the job knocks the grade down.
const MISSION_PAR = [80, 95, 130, 105, 90, 75, 140];
const GRADE_LETTERS = ['D', 'C', 'B', 'A', 'S'];

// The story, told in acts — a save slot is named by the act it sits in.
export const ACT_NAMES = [
  'Act I — First Wheels',
  'Act II — Cross-Town Package',
  'Act II — Hot Delivery',
  'Act III — Wreck the Regent',
  'Act III — Harbor Sprint',
  'Act IV — The Clock Is Ticking',
  'Act V — The Marina Job',
];

export function actNameFor(missionIdx, storyDone) {
  if (storyDone || missionIdx >= ACT_NAMES.length) return 'Epilogue — The Bay Is Yours';
  return ACT_NAMES[missionIdx];
}

export function gradeMission(idx, elapsedSecs, damageTaken) {
  const par = MISSION_PAR[idx] || 100;
  let g = 1;
  if (elapsedSecs <= par * 0.85) g = 4;
  else if (elapsedSecs <= par * 1.1) g = 3;
  else if (elapsedSecs <= par * 1.45) g = 2;
  if (damageTaken > 60) g -= 2;
  else if (damageTaken > 30) g -= 1;
  return GRADE_LETTERS[clamp(g, 0, GRADE_LETTERS.length - 1)];
}

export class CareerStats {
  constructor() {
    this.carsStolen = 0;
    this.copsEscaped = 0;
    this.distanceDriven = 0;   // metres behind a wheel
    this.longestJump = 0;      // metres of one airborne leap
    this.takedowns = 0;        // pedestrians dropped by gunfire
    this.racesWon = 0;
    this.stuntJumps = 0;
    this.collectiblesFound = 0;
    this.districtJobs = 0;     // courier jobs finished in free roam
    this.crewAbilitiesUsed = 0;
    this.medals = {};          // mission index -> grade letter
  }

  recordMission(idx, elapsedSecs, damageTaken) {
    this.medals[idx] = gradeMission(idx, elapsedSecs, damageTaken);
  }

  goldRatings() {
    return Object.values(this.medals).filter((m) => m === 'S' || m === 'A').length;
  }

  districtsFriendly(G) {
    return DISTRICTS.filter((d) => (G.standing[d.id] || 0) >= 20).length;
  }

  missionsDone(G) {
    if (G.storyDone) return MISSION_NAMES.length;
    return Math.min(MISSION_NAMES.length, G.missions ? G.missions.idx : G.missionIdx);
  }

  // The checklist the pause screen prints, each row a real counter.
  checklist(G) {
    return [
      { label: 'STORY MISSIONS', have: this.missionsDone(G), total: MISSION_NAMES.length },
      { label: 'STREET RACES WON', have: Math.min(this.racesWon, 1), total: 1 },
      { label: 'STUNT JUMPS', have: Math.min(this.stuntJumps, 8), total: 8 },
      { label: 'COLLECTIBLES', have: this.collectiblesFound, total: COLLECTIBLE_SPOTS.length },
      { label: 'COURIER JOBS', have: Math.min(this.districtJobs, 10), total: 10 },
      { label: 'DISTRICTS FRIENDLY', have: this.districtsFriendly(G), total: DISTRICTS.length },
      { label: 'CREW RECRUITED', have: 3, total: 3 },
      { label: 'GOLD MISSION RATINGS', have: this.goldRatings(), total: MISSION_NAMES.length },
    ];
  }

  // Bay completion: a weighted blend of the checklist, 0…100.
  completion(G) {
    const parts = [
      [this.missionsDone(G) / MISSION_NAMES.length, 34],
      [this.collectiblesFound / COLLECTIBLE_SPOTS.length, 20],
      [Math.min(this.stuntJumps, 8) / 8, 12],
      [Math.min(this.racesWon, 1), 8],
      [Math.min(this.districtJobs, 10) / 10, 10],
      [this.districtsFriendly(G) / DISTRICTS.length, 8],
      [this.goldRatings() / MISSION_NAMES.length, 5],
      [1, 3], // the crew is together from the first job
    ];
    let pct = 0;
    for (const [frac, weight] of parts) pct += clamp(frac, 0, 1) * weight;
    return Math.round(pct * 10) / 10;
  }

  // Career rows for the pause screen.
  careerRows() {
    return [
      ['CARS STOLEN', String(this.carsStolen)],
      ['COPS ESCAPED', String(this.copsEscaped)],
      ['DISTANCE DRIVEN', `${(this.distanceDriven / 1000).toFixed(1)} KM`],
      ['LONGEST JUMP', `${Math.round(this.longestJump)} M`],
      ['PEOPLE TAKEN OUT', String(this.takedowns)],
      ['CREW ABILITIES USED', String(this.crewAbilitiesUsed || 0)],
    ];
  }

  toJSON() {
    return {
      carsStolen: this.carsStolen, copsEscaped: this.copsEscaped,
      distanceDriven: Math.round(this.distanceDriven), longestJump: this.longestJump,
      takedowns: this.takedowns, racesWon: this.racesWon,
      stuntJumps: this.stuntJumps, collectiblesFound: this.collectiblesFound,
      districtJobs: this.districtJobs, medals: this.medals,
      crewAbilitiesUsed: this.crewAbilitiesUsed || 0,
    };
  }

  fromJSON(s) {
    if (!s || typeof s !== 'object') return;
    for (const k of ['carsStolen', 'copsEscaped', 'distanceDriven', 'longestJump',
      'takedowns', 'racesWon', 'stuntJumps', 'collectiblesFound', 'districtJobs',
      'crewAbilitiesUsed']) {
      if (typeof s[k] === 'number') this[k] = s[k];
    }
    if (s.medals && typeof s.medals === 'object') this.medals = s.medals;
  }
}
