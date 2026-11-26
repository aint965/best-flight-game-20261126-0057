// Langit Nusantara: Island Hopper — a make.fun entry hand-in (Node 22, stdlib only).
// The game is this directory's game/ folder: plain static files a desktop browser
// loads offline (game/index.html, its ES modules and a vendored three.js build,
// no network request). This program copies game/ and screenshots/ from beside
// this file to /output and writes /output/dossier.json, the summary the judge
// reads, with the vendored make.fun library.
//
// Round 5 (2026-11-26): both runways now sit on flat grass plateaus in the
// middle of their islands — land on every side, never on the sea — with
// procedural asphalt/grass/sand textures, painted runway numbers, a natural
// blue-to-gold sky and a soft contact shadow under the plane.
//
// Round 6 (2026-11-26): framing only, no world changes — the hop shot flies
// a parallel offset pass 200 m west of the Karang strip so the whole runway
// reads beside the fuselage; the landing shot stages 450 m out so the home
// strip is the big subject; the rings shot holds wings level for 2 s after
// a pass so the capture catches a level aeroplane with score + toast.
// Round 7 (2026-11-26, polish): runway numbers rebuilt big and bold
// (20 m wide, Arial Black 900, white with a dark outline) and both runway
// shots re-staged closer, so the numbers read at capture distance; the home
// hill moved east and lowered so it no longer dominates the landing frame;
// hills got jittered multi-segment silhouettes with slope trees, and clouds
// became layered sphere stacks instead of flat icosahedron blobs.
// Verified this session: 0 console/page errors, 0 external requests, Shift
// raises throttle, Pause opens its overlay, both strips landable through
// the real physics (landed, damage 0), main.ts 2x byte-identical.
//
// Round 8 (2026-11-26, reference-quality polish): the backdrop grows four
// layers — sea, green islands, a tall volcanic hero island with a
// lighthouse on its shoulder far east (it rises directly behind the cover
// shot's gold ring), and three misty islands hazed by the fog — plus taller
// layered clouds with low cloud bellies over the islands, soft cloud
// shadows drifting over the ground, a winding river + patchwork fields +
// dense pine clusters on the home plateau, and a Storm Courier story: a
// dark storm-front wall closing in from the east with a HUD panel showing
// front distance and ETA. Nothing about the runways, the shot staging, or
// the isOnRunway fix (round 7) changed.
// Verified this session: 0 console/page errors in all four shots, Shift
// raises throttle, Pause opens its overlay, throttle slider sets ~75%,
// both strips landable through the real physics (home landed at (-3, 23),
// Karang at (1556, -804), both landed=true, damage 0, +750 pts), the
// storm panel reads "16.9 KM / ETA 04:00" and counts down, the volcano
// stands dead behind the cover ring, main.ts 2x byte-identical.
//
// Serve it locally with `node serve.ts`, then open http://localhost:8080.
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// Fail fast with a readable message when the entry is incomplete, so a bad
// hand-in never silently produces a partial /output.
if (!existsSync(join(here, 'game', 'index.html'))) {
  throw new Error('main.ts: game/index.html is missing — nothing to hand in');
}
if (!existsSync(join(here, 'screenshots'))) {
  throw new Error('main.ts: screenshots/ is missing — take the screenshots first');
}
// Round 5: refuse an entry whose screenshots would trip the scorer's cap
// (4 max, 256 KiB each) instead of handing in a doomed /output.
// Round 7: also refuse an entry whose screenshot set is not exactly the
// four staged shots (a missing or misnamed shot means the dossier shows
// the wrong moment, and the scorer only ever sees these four).
const EXPECTED_SHOTS = ['1-cover.jpg', '2-cruise.jpg', '3-rings.jpg', '4-landing.jpg'];
const shotFiles = readdirSync(join(here, 'screenshots'));
for (const name of EXPECTED_SHOTS) {
  if (!shotFiles.includes(name)) {
    throw new Error(`main.ts: screenshots/${name} is missing — retake the four shots first`);
  }
}
for (const f of shotFiles) {
  const size = statSync(join(here, 'screenshots', f)).size;
  if (size > 262144) {
    throw new Error(`main.ts: screenshots/${f} is ${size} bytes — over the 256 KiB cap`);
  }
}

mkdirSync(out, { recursive: true });
cpSync(join(here, 'game'), join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
if (existsSync(join(here, 'screenshots'))) cpSync(join(here, 'screenshots'), join(out, 'screenshots'), { recursive: true });

// The scorer's own caps (reference/gate.json): only text_max_bytes shapes the bytes; the others refuse an entry the
// scorer would refuse (more than 4 screenshots or one over 256 KiB; more than 993 files in game/ or 48 MiB of game
// files, in all, or a path under game/ over 1000 bytes: game/ counts beside /output's own 1000-entry cap, its
// screenshots/ and dossier.json).
// Langit Nusantara note: the vendored three.js build (~671 KiB) is the only large
// file in game/; the game's own source stays small and readable, well under the caps.
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
    game_path_max_bytes: 1000,
  }),
);
