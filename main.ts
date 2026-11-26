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
for (const f of readdirSync(join(here, 'screenshots'))) {
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
