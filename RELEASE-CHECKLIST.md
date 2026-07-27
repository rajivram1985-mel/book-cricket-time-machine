# Release checklist — Google Play closed test

The step-by-step sequence for getting Book Cricket Time Machine into a Google
Play closed test and, eventually, production. This is the *procedure*; the
*why* behind each file lives in [README.md](README.md)'s "Google Play (TWA)"
section and [CLAUDE.md](CLAUDE.md) — read those first if a step here doesn't
make sense on its own.

## 1. Play Console setup

- [ ] Create (or confirm) a Google Play developer account. New personal
      accounts have historically required a **closed test with a minimum
      tester count for 14 consecutive days** before production access — see
      "Tester-count discrepancy" below before assuming a specific number.
- [ ] Decide the store listing category (Game → Sports, or Casual — either is
      defensible; see `store-assets/listing.md`'s Console-questionnaire notes
      for the rest of the Data Safety / content-rating / trader-status
      answers).

## 2. Build the Android package (TWA via Bubblewrap)

- [ ] `npx @bubblewrap/cli init --manifest https://bookcrickettimemachine.com/manifest.webmanifest`
- [ ] Package name: `com.bookcricket.timemachine` — **permanent once
      published, even if the domain ever changes.** Triple-check this before
      the first upload; there's no fixing it after.
- [ ] Target API level: **36** (or whatever the current Play minimum is at
      build time — Google bumps this periodically; check Play Console's
      target-API requirements page before building, don't trust this number
      blindly).
- [ ] Bubblewrap generates an **upload keystore** during this step — see
      "Keystore backup" below before doing anything else with it.
- [ ] Build the AAB (`gradlew bundleRelease` or Bubblewrap's own build
      command — follow its prompts).

## 3. Upload and wire up Digital Asset Links

- [ ] Upload the AAB to a Play Console **internal testing** track first (fast
      iteration, no review wait) before moving to closed testing.
- [ ] Play Console → **Test and release → App integrity → App signing key
      certificate** → copy the **SHA-256** fingerprint. This is the *Play App
      Signing* key, not your local upload key's fingerprint — they're
      different, and only the Play App Signing one works here.
- [ ] Paste that SHA-256 into `public/.well-known/assetlinks.json`'s
      `sha256_cert_fingerprints`, replacing the placeholder.
- [ ] Redeploy the site (push to `master` — Netlify picks it up
      automatically; see README's Deployment section for the branch gotcha).
- [ ] Bump `appVersionCode` in `twa-manifest.json` on every subsequent
      upload — Play rejects a re-upload with an unchanged version code.

## 4. On-device verification matrix

Install the app from Play Console (internal testing link) on **at least one
real Android device**, not just an emulator, and confirm:

- [ ] App opens **fullscreen with no browser URL bar** — if the URL bar
      shows, the `assetlinks.json` fingerprint from step 3 doesn't match yet
      (wrong key, or the redeploy hasn't landed — `curl -I` the live
      `assetlinks.json` to confirm the file itself updated).
- [ ] App icon and splash match the maskable icons (`icon-*-maskable.png`) —
      not the framed tile, which clips at Android's adaptive-icon mask.
- [ ] Hardware/gesture **back button** behaves correctly from every screen:
      home closes the app; setup and a live match ask to confirm before
      discarding; a finished verdict or innings-break-with-confirm-declined
      steps back one level per press (see CLAUDE.md's back-trap bullet for
      the exact expected behavior per screen).
- [ ] Works **offline** after first load (toggle airplane mode, relaunch).
- [ ] Commentary voice, sound effects, and the reduce-motion toggle all work
      identically to the browser version.
- [ ] Portrait orientation (the only one this app supports) doesn't look
      broken on at least one small phone and one larger/tablet-class device.
- [ ] The service-worker update toast appears after a redeploy and updating
      actually lands the new build (see CLAUDE.md's `stamp-sw-cache.ts`
      bullet — verify this on a real deploy, not just locally).

## 5. Keystore backup

- [ ] Back up the Bubblewrap-generated **upload keystore** file to **two
      separate locations** (e.g., a password manager's file storage *and* a
      separate cloud drive or encrypted archive — not two copies in the same
      place). Play App Signing makes a lost upload key recoverable via
      Google support, but that's a support ticket and a delay, not instant —
      don't rely on it as your only safety net.
- [ ] Record the keystore password and key alias somewhere durable and
      separate from the keystore file itself.

## 6. Tester-count discrepancy — confirm before recruiting

Google's own published closed-test requirement has been reported differently
in different places (12 testers vs. 20 have both shown up in Google's
guidance at various times, and Play Console's own UI has changed this
number more than once). **Don't trust either number from memory or from this
file** — check the actual current requirement shown in *your* Play Console
project before recruiting, and recruit a buffer above whatever it says
(roughly **15 testers** as a starting target covers either number with some
margin for people who never actually opt in after being invited).

## 7. Closed-test cohorts and what to watch for

Recruit **three small, distinct cohorts** rather than one uniform group —
each one stress-tests a different assumption the app makes:

1. **Nostalgia cohort** — people who actually played book cricket as kids
   (the target audience the whole game is built around). Watch for: does the
   Classic mode's "flip and read the last digit" ritual feel authentic? Does
   anything about the digital version feel like it lost the schoolyard
   original's texture?
2. **Cricket-agnostic cohort** — people with little or no cricket knowledge.
   Watch for: does the how-to-play panel and the in-game copy (batting vs.
   bowling banners, stance/plan hints) actually onboard someone with zero
   assumed knowledge, or does it quietly assume familiarity anywhere?
3. **Device-diversity cohort** — a range of Android versions/screen sizes,
   ideally including at least one older/lower-end device. Watch for:
   performance (flip animation, voice playback), layout at unusual screen
   sizes, and anything that only breaks on real hardware vs. desktop Chrome
   dev tools' device emulation.

For all three: ask what almost made them quit, whether they understood what
would happen before tapping Start, and whether the Time Machine "what if"
premise (the actual differentiator) landed or confused them.

## 8. Smoke-test before each upload

Run the smoke suite described in `tests/smoke/README.md` before every new
build upload — it's a manual/lightly-scripted check, not a CI gate (see that
file for exactly what's automated vs. what you click through yourself).

## 9. Open question — Time Machine odds spread (owner's call)

Verified fact, not yet a decision: across all 206 legal Time Machine
matchups, first-ball normal-stance wicket odds range from **3.0%** (Bradman
v Sobers) to **30.0%** (Kapil v Steyn), median **16.0%** — noticeably wider
than Classic's flat **9.9%**. This is presumably intentional (real careers
really do vary that much), but it hasn't been explicitly validated against
what actually *feels* fun across a range of matchups. Flagging for Rajiv to
decide after cohort feedback, not something to silently retune — if it comes
up, the knob is `computeProbabilities` in `src/engine.ts` and it's fully
covered by `tests/engine.test.ts`, so a deliberate change is safe to make and
verify, just don't drift into it without a specific reason.
