[![Make the best flight game](https://make.fun/badge/best-flight-game-20261126-0057.svg)](https://make.fun/bounty/best-flight-game-20261126-0057)
[![Rank](https://make.fun/badge/best-flight-game-20261126-0057/aint965/best-flight-game-20261126-0057/rank.svg)](https://make.fun/bounty/best-flight-game-20261126-0057)
[![Reward](https://make.fun/badge/best-flight-game-20261126-0057/aint965/best-flight-game-20261126-0057/reward.svg)](https://make.fun/bounty/best-flight-game-20261126-0057)

# Langit Nusantara: Island Hopper

An original 3D flight game set over a procedurally built Indonesian archipelago at
late afternoon. You fly a small coral-red bush plane between green islands in a blue
sea, through glowing rings and onto short island runways — with fuel, damage, wind
and a clock turning every sortie into decisions.

## The game

- **3D chase view** (Three.js, vendored under `game/vendor/`): low-poly islands with
  sandy beaches and palm trees, a lit home runway, drifting clouds, a low sun and a
  warm gradient sky. The plane banks into turns, its propeller spins and its
  navigation lights blink.
- **Flight model**: pitch, roll and yaw with lift tied to speed, a stall below flying
  speed, gentle auto-coordination in turns, crosswind on the storm sortie, and
  terrain/water collision. Hard landings damage the airframe; soft landings on a
  runway refuel the plane and score.
- **Three sorties, three different goals**: *Ring Run* (8 rings in order),
  *Island Hop* (land on two island runways) and *Storm Courier* (6 rings plus a
  landing against a 4-minute clock and a crosswind).
- **Lit instruments**: altitude, airspeed, heading compass strip, vertical speed,
  throttle, fuel and damage gauges, artificial horizon, score, mission objective,
  timer and a minimap with a direction arrow to the next ring or runway.
- **Sound, all synthesised** (WebAudio, no audio files): engine hum tied to throttle,
  wind, ring chimes, touchdown thud and crash.
- **Deterministic screenshot modes**: `?shot=start|cruise|hop|rings|landing&seed=1`
  stages a fixed mid-sortie scene with no input needed (live timer, real score).

## Controls

| Input | Action |
| --- | --- |
| W/S or ↑/↓ | Pitch down/up |
| A/D or ←/→ | Roll left/right |
| Q / E | Yaw |
| Shift / Ctrl (or Cmd) | Throttle up / down |
| Space | Airbrake / flaps |
| 1 / 2 / 3 | Pick a sortie on the title screen |
| R | Restart sortie |
| P | Pause |
| M | Mute |
| C | Camera (chase / near / cockpit) |
| Mouse | Drag the on-screen throttle slider; click Pause, Sound, Camera, Restart and the mission cards |

## How to play

1. Pick a sortie on the title screen and click **FLY THIS SORTIE** (or press Enter).
2. Hold **Shift** to spool the throttle up, then pull back gently on **W** once the
   speed passes 55 kt — below that the wing stalls.
3. Follow the gold arrow and the minimap to the next ring or runway. Fly through a
   ring's centre to score; chained rings pay a combo bonus.
4. To land: cut the throttle, descend on the runway heading, keep the wings level
   and touch down softly. A landing refuels the plane and scores.
5. Watch the fuel gauge — an empty tank means a glide to the nearest strip, and a
   hard touchdown or a swim in the sea ends the sortie.

## Run it

```sh
node serve.ts        # serves game/ on http://localhost:8080
```

## Hand in

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

`main.ts` (Node 22, standard library only) copies `game/` and `screenshots/` to the
output directory and writes `dossier.json` with the vendored `makefun-game.ts` library.

## Source layout

- `game/index.html` — page, import map, HUD and overlays
- `game/style.css` — dusk-glass HUD styling
- `game/src/config.js` — tuning, missions, seeded RNG
- `game/src/terrain.js` — islands, sea, sky, clouds, runways, rings
- `game/src/aircraft.js` — the bush plane, built from primitives
- `game/src/physics.js` — arcade flight model and landing verdicts
- `game/src/input.js` — keyboard + on-screen mouse controls
- `game/src/audio.js` — synthesised WebAudio sounds
- `game/src/hud.js` — instruments, horizon, compass, minimap
- `game/src/missions.js` — sorties, rings and scoring
- `game/src/main.js` — scene, camera, game loop, screenshot staging
- `game/vendor/three.module.min.js` — Three.js r160 (vendored)
