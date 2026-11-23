# SOLMAR HEAT

Solmar Heat is an original open-world crime game set on Solmar Bay, a sun-soaked island city that exists nowhere but here. You are Ren Kadir, the fastest courier on the island, until fixer Madame Okafor starts paying real money for work the law frowns on: steal the coupe, run the packages, wreck a rival's car, win the Harbor Sprint, beat the clock — and when the Marina Job goes loud at five stars, outrun every unit in the bay to the boat. Everything is procedural — the city, the cars, the crowds, the sound — and everything on the stats screen is earned by playing, never typed in.

## Features

- **Seven story missions** — staged jobs (steal, deliver, vanish, wreck, race, timed run, heist) with dialogue, stage tracking, cash and RP payouts, and per-district standing, followed by endless courier work in free roam.
- **A crew of three** — Mira Solano (driver, *Ghost Plates*), Theo Lindqvist (mechanic, *Quick Fix*) and Kiki Amara (lookout, *Eyes Out*), each with a keyboard ability on a cooldown.
- **Police & wanted system** — a 1–5 star heat level with patrolling cruisers, named pursuit units with roles (rammers, flankers, pursuit drivers), a helicopter with a live spotlight at 4 stars, roadblocks at 5, and a BUSTED meter when they pin you down.
- **On-foot combat** — fists, the Kestrel-9 pistol and the Brute scattergun, with ammo, hitscan tracers and muzzle flash; gunfire is a crime the bay answers.
- **Collectibles** — twenty golden Solmar stars hidden across the pier, the beach and the far corners of the grid.
- **Stunt jumps** — four ramps that launch your car; hang time and leap distance are judged on landing.
- **Stats & medals** — a pause-screen dossier with a full city map, bay-completion ring, checklist, career counters (cars stolen, cops escaped, distance driven, longest jump…) and a medal grade (D–S) for every story mission.
- **Three save slots** in localStorage, each summarised by story act, completion and cash on the title and pause screens.
- **A living city** — traffic that circulates and brakes, pedestrians who stroll, flee, sit on benches and browse the boardwalk stalls, a day/dusk/night cycle, and a synthesized radio with three stations.

## Controls

| Input | Action |
| --- | --- |
| W A S D / arrow keys | Walk and drive |
| Shift | Run (on foot) |
| E | Enter / exit a car |
| Space | Handbrake |
| F or mouse click | Punch / shoot |
| 1 / 2 / 3 | Weapon slots: fists, Kestrel-9, Brute SG |
| Q / R / C | Crew abilities: ghost plates, quick fix, eyes out |
| M | Radio (while driving) |
| T | Cycle time of day |
| Esc / P | Pause — the dossier screen |

Stars bring police. Break their line of sight, lay low in a vanish zone, and the heat cools.

## How to run

There is no build step and nothing to install. The game is the `game/` folder: plain static files plus a vendored copy of three.js.

- **Quickest:** open `game/index.html` in a desktop browser.
- **Served (recommended):** from this repo root run

  ```
  node serve.ts
  ```

  then open http://localhost:8080.

Progress saves to the browser's localStorage automatically.

## Tech notes

- **three.js** (vendored at `game/vendor/three.min.js`) renders a fully procedural low-poly city — no model files, no textures on disk, no network requests; the game runs completely offline.
- **Plain ES modules**, no bundler and no build step: `game/index.html` loads `game/src/main.js` as a module and it imports the rest.
- **All audio is synthesized** with WebAudio — radio stations are step-sequenced oscillator patterns, the engine and sirens are live nodes, and every blip is generated. There are no audio files.
- **Deterministic staging:** `?seed=` fixes the city RNG, and `?shot=<name>` boots a composed scene — that is how the four screenshots in `screenshots/` are produced by `scripts/shoot.mjs`.

## File map — `game/src/`

| File | What it does |
| --- | --- |
| `main.js` | Entry point: boot, the shared game-state object `G`, the frame loop, camera, progression (cash/RP/standing), save/load, bust/wasted/story-complete transitions. |
| `config.js` | Shared constants and helpers: city grid, times of day, palette, districts, car models, rank ladder, RNG, math helpers. |
| `world.js` | Solmar Bay itself: island, roads, buildings with lit-window facades, palms, beach, marina, stunt ramps, the lighting rig, and the shared collision solver `pushOutOfBoxes`. |
| `vehicles.js` | Car meshes and silhouettes, the player's arcade driving physics, block-looping traffic cars, parked cars. |
| `police.js` | The wanted system: stars, patrol/pursuit spawning, unit roles, roadblocks, the helicopter, the BUSTED meter. |
| `pedestrians.js` | The crowd: wandering, fleeing, seated and browsing figures, scooter riders, hit reactions, screenshot staging helpers. |
| `player.js` | Ren Kadir on foot: the figure, camera-relative movement, walk/run animation. |
| `missions.js` | The seven story jobs as stage chains (goto/steal/vanish/wreck/race), the wreck target's route, race gates, and endless courier jobs. |
| `crew.js` | The three crew members, their abilities and cooldowns. |
| `combat.js` | Weapons, ammo, hitscan resolution, tracers and muzzle flash. |
| `hud.js` | All 2D overlay: cash/stars/bars, mission and police panels, crew and weapon panels, dialogue, the live minimap, the pause dossier and its full city map, title slot summaries. |
| `stats.js` | Career counters, mission medal grading, the checklist and bay-completion maths. |
| `save.js` | The three localStorage save slots and their summaries. |
| `collectibles.js` | The twenty Solmar stars: placement, spin/bob animation, pickup detection. |
| `audio.js` | Synthesized radio, engine, sirens and event blips. |
| `input.js` | Keyboard state with per-press edge detection. |
| `shots.js` | Screenshot staging: composes the four portfolio scenes from the game's real systems. |
