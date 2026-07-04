# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Book Cricket Time Machine — a browser game reviving Indian schoolyard book cricket (flip to a random page; last digit `0` = out, `1–6` = that many runs, `7/8/9` = 1 run), with "what if" duels between real cricket legends. Entirely client-side: vanilla TypeScript + Vite, no framework, no backend, nothing stored. A spell is 12 balls or 2 wickets (`SPELL` in `src/engine.ts`).

## Commands

```bash
npm run dev        # Vite dev server
npm test           # vitest run (all tests)
npx vitest run tests/engine.test.ts -t "sums to 1"   # single test by name
npm run build      # tsc type-check + vite build
npm run preview    # serve the production build
```

There is no linter configured; `tsc` (strict mode, noUnusedLocals/Parameters) is the only static check and only runs via `npm run build`.

## Architecture

Two-layer split — pure logic vs. DOM — is the core invariant:

- **`src/engine.ts`** — all game logic as pure functions. Every random draw takes an injectable `Rng` (defaults to `Math.random`) so tests are deterministic. Two ball-drawing paths:
  - *Classic mode*: `drawClassic` picks a real page number; outcome follows from its last digit.
  - *Stats mode*: `drawOutcome` samples from `computeProbabilities(bat, bowl, eraAdjusted)`, then `pageForOutcome` reverse-engineers a page whose last digit would have produced that outcome — the book metaphor is kept honest by construction, so don't break that pairing.
- **`src/main.ts`** — the only file that touches the DOM. Single mutable `State` object; setup screen is re-rendered via full `innerHTML` replacement (`render()`), while play-screen ball updates and text inputs are patched by targeted DOM mutation to preserve animations and input focus (see `handleInput`'s "no re-render: don't steal focus" pattern). Events are delegated through `data-action` attributes on one root listener.
- **`src/roster.ts`** — data-only player list. Adding a player requires no simulation changes: bowlers get a `bowling` block, batsmen a `batting` block; all-rounders get both and appear in both pickers. Stats are deliberately approximate format blends tuned for fun.
- **`src/commentary.ts`** — phrase pools with a module-level `lastPhrase` guard so no phrase repeats on consecutive balls (tests rely on `resetCommentary()`).
- **`src/avatar.ts`** — generated inline-SVG avatars (initials + emoji + country gradient); no photo assets.

Tests (`tests/engine.test.ts`, vitest) cover only the pure layer — engine math and commentary non-repetition. Keep new game logic in `engine.ts` so it stays testable; `main.ts` is untested by design.

`design-system/` holds standalone HTML preview cards (tokens, components) for the claude.ai/design pane, each tagged with a `@dsCard` marker — they are reference artifacts, not part of the build.

## Product constraints

- Stats mode is a playful simulation, never a prediction — the UI states this disclaimer in multiple places (setup panel, play screen, verdict, footer). Preserve it when touching those surfaces.
- `computeProbabilities` is surfaced verbatim in the in-game "How the odds work" panel; if you change its math, the explanation text in `main.ts`'s `oddsPanel()` must stay accurate.
- Respect the `reduceMotion` state flag: animations gate on it and durations drop to 0.
