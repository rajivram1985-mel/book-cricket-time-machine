# Deployed-behavior smoke suite

A real, working automated check for the parts of the release checklist's 7
journeys that are cheap and reliable to automate — **not a full end-to-end
suite**, and not wired into `npm run build` or `npm test`. Run it before
uploading a new build (see [RELEASE-CHECKLIST.md](../../RELEASE-CHECKLIST.md)
step 8), or any time after touching the service worker, the challenge flow,
or the back-button trap.

## Setup

```bash
npm install --no-save puppeteer-core
```

`--no-save` is deliberate — this is a throwaway install, same pattern as the
`sharp`/`puppeteer-core` installs used elsewhere in this project's history
(see CLAUDE.md). It does **not** touch `package.json`/`package-lock.json`;
`dependencies: {}` stays true. Reinstall it fresh whenever you want to run
this — don't commit `node_modules`.

Needs a real Chrome install. Defaults to
`C:\Program Files\Google\Chrome\Application\chrome.exe`; override with the
`CHROME_PATH` env var if yours lives elsewhere.

## Running it

Start a server first — the script connects to one, it doesn't launch one:

```bash
npm run serve:pwa   # builds + serves dist/ on :4300 with a real service worker
node tests/smoke/smoke.mjs
```

Options:

- `SMOKE_BASE_URL=<url>` — point at a different server, e.g. the deployed
  site (`SMOKE_BASE_URL=https://bookcrickettimemachine.com`). **Do this for
  the CSP check specifically** — see below.
- `--skip-sw-update` — skip the sub-step that rebuilds the project mid-run to
  verify the service-worker update toast (see Journey 7 below). Useful for a
  faster iteration loop; the release checklist wants the full run before an
  actual upload.

Exit code is non-zero if anything failed; a summary prints at the end either
way.

## What's actually automated vs. what's still manual

This section exists so nobody — including a future session picking this back
up — mistakes a passing run for full coverage.

| # | Journey | Automated here | Manual supplement needed |
|---|---|---|---|
| 1 | Classic full match | Start → flip both innings → verdict heading | — fully covered |
| 2 | Time Machine + bowling controls | Start → flip to bowling innings → plan/review/call-strip render, one plan tap → finish to verdict | Review button's actual overturn effect, call-the-page correct/incorrect resolution, power play, era-adjust toggle — none of these are exercised, only that the controls exist and one plan tap changes state |
| 3 | Daily reload/resume | Flip a few balls → reload → resume shows the same ball count | The "walked off mid-chase" no-progress fallback path, and the once-per-day lock itself (this script doesn't verify a second attempt is blocked) |
| 4 | Challenge accept/counter | Full match → share captured → fresh tab opens the link → accept → chase to verdict → counter button present | Doesn't actually fire the counter-challenge and verify *that* link also works — one hop deep only |
| 5 | Back button | Setup-screen back (no confirm), mid-match back (confirm + accept → home) | Innings-break back (confirm), verdict/finished-match back (no confirm), a *cancelled* confirm leaving the match in place, and the Escape-key path (routes through the same `logicalBack()`, exercised manually when it shipped — see CLAUDE.md) |
| 6 | Analytics opt-out + CSP | Script-tag removal on toggle-off; zero `securitypolicyviolation` events / console CSP errors across `/` and `/privacy.html` | **The CSP check is close to meaningless run locally** — `vite preview` never serves `netlify.toml`'s headers (a documented project gotcha), so a local run only catches violations that would occur even with *no* CSP at all. Re-run with `SMOKE_BASE_URL=https://bookcrickettimemachine.com` for a check that means anything, and even then `curl -I` against the live deploy (per CLAUDE.md) is the actual source of truth for the headers themselves |
| 7 | SW offline + update flow | Reload while offline still renders; a source-only edit + rebuild changes `CACHE_NAME` and the update toast fires without any hand-edit to `sw.js` | Doesn't verify the toast is *withheld* during a live match and only appears at a safe stopping point (`hasLiveMatchInProgress()` gating) — that's the harder-to-automate part and was verified manually when it shipped (session 13) |

Journeys 1, 3, and 7's offline check are the most solid — they complete a
real flow start-to-finish. Journeys 2, 4, 5, and 6 verify the *shape* of the
behavior (right elements, right state transitions at the checkpoints tested)
without exhaustively exercising every branch. If a future change touches any
of the "manual supplement" cells above, verify that specific behavior
in-browser rather than trusting a green run here to have caught it.

## Why not a heavier framework

A full Playwright/Cypress test suite with fixtures, retries, and CI wiring
would give better coverage, but that's a real ongoing maintenance
commitment for a solo project with `dependencies: {}` and no CI configured
yet — and this app's core logic is already covered where it matters most
(`tests/*.test.ts`, 175 unit tests on the pure engine/daily/storage/voice
layers). This script is deliberately a single file, a throwaway dependency,
and a documented gap list instead — cheap to delete or replace later if a
real test framework gets adopted, and honest about what it does and doesn't
catch in the meantime.

## Gotchas hit while building this

- **Flip timing isn't a fixed delay.** A synthetic tap needs ~1.1s
  (`FLIP_AUTOSTOP_MS`) to auto-land plus a further ~0.5s decel animation
  before the next tap can start a new ball — sleeping a guessed constant
  between taps silently wasted every other tap. The script polls
  `#balls-line` for an actual change instead (`waitForBallOrOverlay`).
- **Headless Chrome reports `navigator.share` as callable**, so the app's
  `CAN_SHARE` check (real desktop browsers without a share target just don't
  define the function at all) takes the share-sheet branch — but a
  synthetic click has no real user-activation, so the share sheet never
  actually opens or resolves. The script stubs `navigator.share` to reject
  immediately, exercising the same `copyToClipboard` fallback path a real
  desktop user without share support would hit.
