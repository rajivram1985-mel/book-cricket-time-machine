# Book Cricket Time Machine

A browser game reviving the Indian schoolyard classic of **book cricket** — flip to a random
page, read the last digit, score the ball — fused with "what if" duels between real cricket
legends. Entirely client-side: no backend, no accounts, no tracking. Your career scorebook
(matches, streaks, personal bests, the unlikeliest ball you've ever flipped) lives in
localStorage on your device and nowhere else — a "Reset data" link in the footer wipes it
back to a blank slate any time (confirmed first, since it can't be undone). Because there's
no server holding your save, the footer also has **Back up** (download your scorebook as a
JSON file) and **Restore** (load one back) — the only way to carry a career to a new phone
or survive a cache wipe. The backup file never leaves your device.

**Rules:** last digit `0` = out · `1–6` = that many runs · `7/8/9` = 1 run.
A match is two innings: your XI bats first, then the rival XI chases the total.
Each innings is 12 balls or 2 wickets, whichever comes first. Stumps brings a
**luck report**: expected runs vs actual for both sides, and the unlikeliest
moment of the match, priced from the exact per-ball odds.

The home screen is a bookshelf: the Daily Challenge, Classic, and Time Machine all sit
above the fold as three tappable "books," so every way to play is visible without
scrolling. The Daily book stays the loudest (gold outline, streak-at-stake line) until
you've played today's chase — then it recedes to a stamped, muted card and the other
two pick up the outline instead, nudging you toward a second match. First-time visitors
also see an open "New here? Start with the basics" panel explaining what book cricket is
and how to play this app — it collapses automatically once you've played a match.

## Modes

- **Daily Challenge** — one seeded chase per calendar day, identical for everyone on Earth.
  The rival's innings, the four players and the book of the day are all deterministic from
  the local date (`src/daily.ts`); only your own flips differ. One attempt a day, a 🔥
  played-streak, and a Wordle-style emoji grid to share (`🟦🟪🟥⬜ ✅ chased with 3 balls to
  spare`). The attempt is marked the moment the chase begins — refreshing mid-match doesn't
  buy a second try, but it doesn't lose your progress either: an accidental reload, tab
  switch, or OS-suspended tab picks up exactly where you left off (only replaying balls
  already flipped — never redrawing them). A dud-day floor (`MIN_DAILY_TARGET`) re-simulates a collapsed rival
  innings from the same seeded stream so no day ever asks you to chase a trivial single-digit
  target — the day key still determines one outcome, just possibly after an internal retry.
- **Classic** — pure page-flip luck. Defaults to 🎲 **Surprise me**: a random nostalgic
  book from the same pool the Daily Challenge draws from (reroll for a different one), so
  you're playing in one tap. Switch to ✍️ **My own book** to type a title and page count
  instead. Four legends are drawn at random purely for flavour (your pair vs the rival's).
  The odds are never adjusted for anyone, ever — last digit `0` is out for every player,
  every time, no hidden easy mode for beginners. Getting dismissed inside your first 3
  balls is common (it's ~19% likely by pure math) and gets its own commentary and a
  🦆 **early ducks** badge on your scorebook — a badge, not a penalty.
- **Stats** — pick your batsman and bowler from the ~25-legend roster; a rival pair is
  drawn for the other side (rerollable). Ball outcomes are drawn from a distribution
  weighted by real career numbers. Strike rate cuts both ways: an aggressive batsman
  scores faster **and** gets out more, a watchful one survives longer but scores slower —
  the "How the odds work" panel spells out every factor moving the current ball's odds
  (matchup, batter tempo, settling-in, bowler fatigue, era gap, stance, power play). An
  optional **era adjustment** raises wicket odds when two careers never overlapped —
  gaps under 15 years are penalty-free, ramping to ×1.35 at 60+ years. *All stats-mode
  results are playful simulation, never prediction — the UI says so everywhere.*
- **Stances & the power play** — before every ball you bat, pick an intent: 🛡 Defend
  (boundaries ×0.45, wicket ×0.55), 🏏 Normal, or ⚔ Attack (boundaries ×1.95, wicket
  ×1.65). Once per innings you can arm the **⚡ power play**: the next ball counts
  double — but wicket odds double in Stats mode, and in Classic the schoolyard house
  rule applies: 7, 8 and 9 are OUT instead of singles. The rival plays by the same
  rules: it attacks steep chases, shuts the gate on strolls, and gambles the power
  play when the maths demands it — its intent is announced before every flip.
- **The Gauntlet** — a best-of-3 series in Stats mode. Win and the next rival pair is
  drawn from the top half of the roster by rating; match 3 brings the bosses.
- **Commentary voice** — wickets, fours, sixes, power plays and verdicts get a
  pre-generated voice line (never singles/twos/threes — the quiet balls stay quiet).
  Sixes and wickets occasionally call the player's name instead of a generic line.
  Pick a commentator persona from the header — 🎙️ **The Enthusiast**, 🧊 **The
  Deadpan**, 📻 **The Analyst**, or ⚡ **The Showman** — four original characters
  built from stock voices, not clones of any real commentator (see below). The
  game is fully playable with zero audio: until you run `npm run voice:generate`,
  these moments are silent, nothing else changes.
- **The page riffle** — flipping is a short decelerating flurry of page-turns (five
  quick flips slowing into one settle) rather than a single instant flip, each with
  its own paper-flick sound and a soft settle cue once it stops. Honors **reduce
  animations**: with it on, the riffle skips straight to a single flip sound and an
  instant result, no animation.

## Commands

```bash
npm install
npm run dev            # dev server
npm test                # vitest unit tests (engine, daily, storage, commentary, voice)
npm run build           # type-check + production build
npm run preview         # serve the production build
npm run serve:pwa       # production build + preview on :4300 — use this to test PWA/offline behavior
npm run voice:generate  # render commentary MP3s via ElevenLabs — see below
```

## Commentary voice generation

`npm run voice:generate` calls the ElevenLabs API to render every line in
[src/voiceLines.ts](src/voiceLines.ts) plus one name callout per roster player,
**once per commentator persona** in [src/commentators.ts](src/commentators.ts), and
writes MP3s into `public/audio/voice/<personaId>/`. It needs an ElevenLabs API key:

1. Create `.env.local` in the project root (already gitignored, never commit it):
   ```
   ELEVENLABS_API_KEY=your-key-here
   ```
2. Optional override: `ELEVENLABS_MODEL_ID` (defaults to `eleven_flash_v2_5`, the
   cheap/fast model — plenty for a two-second game line). Each persona's voice ID
   and delivery tuning (stability/style) live in `src/commentators.ts`, not env vars.
3. Run `npm run voice:generate`. It's idempotent — safe to rerun after adding new
   lines or a new persona, since existing clips are skipped (pass `--force` to redo
   everything).

The script never runs inside the shipped game — clips are static assets generated
once and committed, so the API key never reaches a player's browser.

**On commentator personas:** the four voices (Enthusiast, Deadpan, Analyst, Showman)
are original characters built from ElevenLabs' stock/library voices, tuned toward a
personality via `voice_settings` — not clones of Ravi Shastri, Richie Benaud, or any
other real commentator. Cloning a real, identifiable person's voice without consent
is a right-of-publicity problem even for a hobby project, and considerably worse for
anyone who has passed away — that line is deliberate and shouldn't move.

## Installable + offline (PWA)

`public/manifest.webmanifest` + a hand-rolled `public/sw.js` (no build plugin, no
new dependency — cache-first with a background network refresh for same-origin
requests) make the game installable on a phone home screen and playable offline
after the first visit. Icons in `public/icons/` were rasterized once from a small
SVG mark — an open book with the cricket ball at the spine, on the brass/`--studio`
brand palette — via a throwaway `sharp` install (`npm install --no-save sharp` —
never a persisted dependency; regenerate the same way if the mark ever changes).
The original mark was a "BC" monogram; it was replaced (2026-07-07) because "BC"
reads as a common Hindi expletive when it shows up small in link-preview
thumbnails (e.g. sharing the link in WhatsApp) — don't reintroduce text-based
initials into the app icon. Test PWA
behavior with `npm run serve:pwa`, not plain `npm run dev` — the dev server also
registers the service worker, which can make code changes look stale mid-session.

There are two icon families: the framed tile (`icon-192/512.png`, favicon +
apple-touch + `purpose: any`) and full-bleed **maskable** variants
(`icon-*-maskable.png`, `purpose: maskable`) whose glyph sits inside Android's
circular safe zone — the framed tile's gold border corners get visibly clipped
by adaptive-icon masks, which is why the maskable variants exist. SVG sources
for both live in `store-assets/`.

## Google Play (TWA)

The Play Store build is a **Trusted Web Activity** — a thin Android wrapper
around the live site, generated with [Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap)
(`npx @bubblewrap/cli init --manifest https://bookcrickettimemachine.com/manifest.webmanifest`).
There is no forked codebase: the store app loads the deployed site, so every
Netlify deploy updates the Android app instantly with no store re-review.

The moving parts:

- **`public/.well-known/assetlinks.json`** — Digital Asset Links. The
  `sha256_cert_fingerprints` placeholder must be replaced with the **Play App
  Signing** key fingerprint (Play Console → Test and release → App integrity →
  App signing key certificate) after the first upload — *not* the local upload
  key's fingerprint; Google re-signs the app. Until this matches, the installed
  app shows a browser URL bar instead of running fullscreen.
- **`public/privacy.html`** — the privacy policy URL every Play listing
  requires (`https://bookcrickettimemachine.com/privacy.html`).
- **`store-assets/`** — feature graphic (1024×500), listing copy with the
  Console questionnaire answers (`listing.md`), and the icon/graphic SVG
  sources. Use `icon-512-maskable.png` as the Play listing icon.
- **Package name `com.bookcricket.timemachine`** is permanent once published —
  it can never change, even if the domain does. The custom domain
  (`bookcrickettimemachine.com`) is already settled as of 2026-07-09, so the
  Bubblewrap manifest URL above is the final one — no domain churn expected
  before first publish.
- Bubblewrap generates an **upload keystore** — back it up, though Play App
  Signing makes a lost upload key recoverable via support. Bump
  `appVersionCode` in `twa-manifest.json` on every upload.
- New personal Play developer accounts must run a **closed test (12+ testers,
  14 consecutive days)** before production access — verify the current numbers
  in the Console, Google has adjusted them over time.

## Deployment

**Live at <https://bookcrickettimemachine.com>.** Static site, no backend,
no server-side secrets — `vercel.json` and `netlify.toml` both point at
`npm run build` → `dist/`; the commentary clips (`public/audio/voice/`) are
committed to git, so the ElevenLabs API key is never needed as a deploy secret.

Custom domain bought on Namecheap (2026-07-09), DNS delegated to Netlify DNS
(simplest option — Netlify manages records and auto-issues the Let's Encrypt
certificate). The original `bookcricket-timemachine.netlify.app` subdomain is
still live and 301-redirects to the custom domain, since it's set as the
**primary domain** in Netlify's domain management — that redirect is what
keeps old bookmarks/shared links/installed PWAs working, don't remove the
`.netlify.app` domain from the project.

The GitHub repo's default branch is `main` — an empty stray branch from creating
the repo via GitHub's web UI — while the actual code lives on `master`. Netlify's
**production branch is explicitly set to `master`** in Site configuration → Build
& deploy; don't "fix" that by pointing it at `main`, which has nothing on it.

`SHARE_URL` in [src/daily.ts](src/daily.ts) and the `og:url`/`og:image`/
`twitter:image` tags in [index.html](index.html) already point at the Netlify
domain above. If the site ever moves to a different domain (or a custom domain
gets attached), update all of those together.

## Extending the roster

Add a player object to [src/roster.ts](src/roster.ts) — nothing in the simulation code
needs to change. Give bowlers a `bowling` block, batsmen a `batting` block (all-rounders
get both, and appear in both pickers). Stats are deliberately approximate, format-blended
numbers tuned for fun. Avatars are generated SVGs (initials + emoji + country colours);
swap in real photos later by replacing `avatarSvg` in [src/avatar.ts](src/avatar.ts).

## Tuning

- Spell length: `SPELL` in [src/engine.ts](src/engine.ts)
- Stats weighting: `computeProbabilities` in [src/engine.ts](src/engine.ts) — pure
  function, covered by tests, surfaced verbatim in the in-game odds panel
- Commentary pools: [src/commentary.ts](src/commentary.ts) (no phrase ever repeats on
  consecutive balls)
