#!/usr/bin/env node
/**
 * Deployed-behavior smoke suite. NOT wired into `npm run build` or
 * `npm test`, and puppeteer-core is NOT a persisted dependency — install it
 * throwaway first (`npm install --no-save puppeteer-core`, same pattern as
 * the sharp/puppeteer-core installs used elsewhere in this project's
 * history). See tests/smoke/README.md for setup, what this does and
 * doesn't cover, and the honest automated-vs-manual split across the
 * release checklist's 7 journeys.
 *
 * Connects to an ALREADY-RUNNING server — it does not start one. Default
 * assumes `npm run serve:pwa` on :4300 (a real production build + service
 * worker, not the raw dev server). Override with SMOKE_BASE_URL.
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const BASE_URL = (process.env.SMOKE_BASE_URL || 'http://localhost:4300').replace(/\/$/, '');
const CHROME_PATH = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const SKIP_SW_UPDATE = process.argv.includes('--skip-sw-update');
const IS_LOCAL = BASE_URL.includes('localhost') || BASE_URL.includes('127.0.0.1');

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} — ${name}${detail ? ` (${detail})` : ''}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function tapFlip(page) {
  return page.evaluate(() => {
    const btn = document.querySelector('#flip-btn');
    if (!btn) return false;
    btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }));
    btn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));
    return true;
  });
}

/**
 * A quick synthetic tap leaves the flip "armed" (see main.ts's
 * FLIP_AUTOSTOP_MS) — it lands on its own after ~1.1s, then a 3-step decel
 * animation (~500ms) runs before the result is actually revealed and a new
 * tap can start the next ball. That's ~1.6s per ball, not instant, and it's
 * not worth hardcoding — poll for an actual state change instead of
 * sleeping a fixed guess.
 */
async function waitForBallOrOverlay(page, prevBallsText, timeoutMs = 4000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const state = await page.evaluate(() => ({
      verdict: !!document.querySelector('#verdict-heading'),
      brk: !!document.querySelector('#break-heading'),
      balls: document.querySelector('#balls-line')?.textContent ?? null,
    }));
    if (state.verdict || state.brk || state.balls !== prevBallsText) return state;
    await sleep(120);
  }
  return null; // timed out — caller decides how to treat that
}

/**
 * Flips through a match one ball at a time, waiting for each ball to
 * actually land (see waitForBallOrOverlay) rather than a fixed delay, and
 * dismissing the innings break automatically. RNG-driven, so the number of
 * balls varies run to run; maxBalls is a generous cap, not a fixed count.
 */
async function playThroughToVerdict(page, maxBalls = 30) {
  for (let i = 0; i < maxBalls; i++) {
    if (await page.evaluate(() => !!document.querySelector('#verdict-heading'))) return true;
    if (await page.evaluate(() => !!document.querySelector('#break-heading'))) {
      await page.evaluate(() => document.querySelector('.overlay .verdict button')?.click());
      await sleep(200);
      continue;
    }
    const prevBalls = await page.evaluate(() => document.querySelector('#balls-line')?.textContent ?? null);
    if (!(await tapFlip(page))) return false;
    const outcome = await waitForBallOrOverlay(page, prevBalls);
    if (!outcome) return false; // stuck — flip never landed within the timeout
  }
  return page.evaluate(() => !!document.querySelector('#verdict-heading'));
}

// ---------- journeys ----------

async function journeyClassicMatch(browser) {
  const page = await browser.newPage();
  try {
    await page.goto(BASE_URL, { waitUntil: 'networkidle0' });
    await page.evaluate(() => document.querySelector('[data-action="nav-classic"]')?.click());
    await sleep(150);
    await page.evaluate(() => document.querySelector('[data-action="start"]')?.click());
    await sleep(150);
    const finished = await playThroughToVerdict(page);
    const heading = await page.evaluate(() => document.querySelector('#verdict-heading')?.textContent);
    record('Journey 1 — Classic: full match reaches a verdict', finished && heading === 'Stumps!', `heading="${heading}"`);
  } finally {
    await page.close();
  }
}

async function journeyTimeMachineBowling(browser) {
  const page = await browser.newPage();
  try {
    await page.goto(BASE_URL, { waitUntil: 'networkidle0' });
    await page.evaluate(() => document.querySelector('[data-action="nav-stats"]')?.click());
    await sleep(150);
    await page.evaluate(() => document.querySelector('[data-action="start"]')?.click());
    await sleep(150);
    // Flip through innings 1 (batting) until the bowling innings' controls appear.
    for (let i = 0; i < 15; i++) {
      if (await page.evaluate(() => !!document.querySelector('.call-strip'))) break;
      if (await page.evaluate(() => !!document.querySelector('#break-heading'))) {
        await page.evaluate(() => document.querySelector('.overlay .verdict button')?.click());
        await sleep(200);
        continue;
      }
      const prevBalls = await page.evaluate(() => document.querySelector('#balls-line')?.textContent ?? null);
      await tapFlip(page);
      await waitForBallOrOverlay(page, prevBalls);
    }
    const hasPlans = await page.evaluate(() => document.querySelectorAll('.plan-btn').length === 3);
    const hasReview = await page.evaluate(() => !!document.querySelector('.btn.review'));
    const hasCallStrip = await page.evaluate(() => !!document.querySelector('.call-strip'));
    await page.evaluate(() => document.querySelector('[data-action="bowl-plan-attack"]')?.click());
    await sleep(100);
    const planActive = await page.evaluate(
      () => document.querySelector('[data-action="bowl-plan-attack"]')?.classList.contains('active'),
    );
    record(
      'Journey 2 — Time Machine: bowling controls (plans/review/call-strip) render and a plan tap registers',
      hasPlans && hasReview && hasCallStrip && !!planActive,
      `plans=${hasPlans} review=${hasReview} callStrip=${hasCallStrip} planActive=${planActive}`,
    );
    const finished = await playThroughToVerdict(page);
    const heading = await page.evaluate(() => document.querySelector('#verdict-heading')?.textContent);
    record(
      'Journey 2 — Time Machine: match reaches a verdict with the Time Machine heading',
      finished && heading === '⏳ The Time Machine has spoken',
      `heading="${heading}"`,
    );
  } finally {
    await page.close();
  }
}

async function journeyDaily(browser) {
  const page = await browser.newPage();
  try {
    await page.goto(BASE_URL, { waitUntil: 'networkidle0' });
    await page.evaluate(() => document.querySelector('[data-action="nav-daily"]')?.click());
    await sleep(150);
    // If today's already fully played out from a prior run, this journey
    // can't re-test the resume path meaningfully — flag that rather than
    // silently reporting a false pass.
    const inPlay = await page.evaluate(() => !!document.querySelector('#balls-line'));
    if (!inPlay) {
      record('Journey 3 — Daily: reload/resume', false, "today's Daily wasn't in a fresh playable state — run this against a clean profile/day");
      return;
    }
    for (let i = 0; i < 3; i++) {
      const prevBalls = await page.evaluate(() => document.querySelector('#balls-line')?.textContent ?? null);
      await tapFlip(page);
      await waitForBallOrOverlay(page, prevBalls);
    }
    const ballsBefore = await page.evaluate(() => document.querySelector('#balls-line')?.textContent);
    await page.reload({ waitUntil: 'networkidle0' });
    const resumeCta = await page.evaluate(() => document.querySelector('.book-daily .book-cta')?.textContent);
    await page.evaluate(() => document.querySelector('[data-action="nav-daily"]')?.click());
    await sleep(150);
    const ballsAfter = await page.evaluate(() => document.querySelector('#balls-line')?.textContent);
    record(
      "Journey 3 — Daily: progress survives a reload; resume shows the same ball count (never redraws)",
      typeof resumeCta === 'string' && resumeCta.includes('Continue') && ballsAfter === ballsBefore,
      `before="${ballsBefore}" resumeCta="${resumeCta}" after="${ballsAfter}"`,
    );
  } finally {
    await page.close();
  }
}

async function journeyChallenge(browser) {
  const page = await browser.newPage();
  try {
    await page.goto(BASE_URL, { waitUntil: 'networkidle0' });
    await page.evaluate(() => document.querySelector('[data-action="nav-classic"]')?.click());
    await sleep(150);
    await page.evaluate(() => document.querySelector('[data-action="start"]')?.click());
    await sleep(150);
    await playThroughToVerdict(page);
    const captured = await page.evaluate(async () => {
      let text = null;
      navigator.clipboard.writeText = async (t) => {
        text = t;
      };
      // Headless Chrome reports navigator.share as callable, but a
      // synthetic (non-user-gesture) click can't satisfy its transient-
      // activation requirement — real desktop browsers without a share
      // target just don't define the API at all, hitting the same
      // copyToClipboard fallback shareOrCopy() already has. Force that
      // same rejection here instead of hanging on a share-sheet stub that
      // headless Chrome never resolves.
      navigator.share = () => Promise.reject(new DOMException('smoke-test stub', 'NotAllowedError'));
      document.querySelector('[data-action="challenge-friend"]')?.click();
      await new Promise((r) => setTimeout(r, 400));
      return text;
    });
    const urlMatch = captured && captured.match(/https:\/\/\S+#challenge=\S+/);
    if (!urlMatch) {
      record('Journey 4 — Challenge: share captured a challenge URL', false, `captured="${captured}"`);
      return;
    }
    const hash = new URL(urlMatch[0]).hash;
    const landingPage = await browser.newPage();
    await landingPage.goto(`${BASE_URL}/${hash}`, { waitUntil: 'networkidle0' });
    const landingOk = await landingPage.evaluate(
      () => !!document.querySelector('.challenge-card') && !!document.querySelector('[data-action="accept-challenge"]'),
    );
    await landingPage.evaluate(() => document.querySelector('[data-action="accept-challenge"]')?.click());
    await sleep(150);
    const finished = await playThroughToVerdict(landingPage);
    const counterBtn = await landingPage.evaluate(() => !!document.querySelector('[data-action="counter-challenge"]'));
    record(
      'Journey 4 — Challenge: accept from a fresh tab, chase to a verdict, counter button present',
      landingOk && finished && counterBtn,
      `landingOk=${landingOk} finished=${finished} counterBtn=${counterBtn}`,
    );
    await landingPage.close();
  } finally {
    await page.close();
  }
}

async function journeyBackButton(browser) {
  const page = await browser.newPage();
  const dialogs = [];
  page.on('dialog', async (d) => {
    dialogs.push(d.message());
    await d.accept();
  });
  try {
    await page.goto(BASE_URL, { waitUntil: 'networkidle0' });
    await page.evaluate(() => document.querySelector('[data-action="nav-classic"]')?.click());
    await sleep(150);
    dialogs.length = 0;
    await page.goBack();
    await sleep(250);
    const homeAfterSetupBack = await page.evaluate(() => !!document.querySelector('.shelf'));
    record(
      'Journey 5 — Back button: setup screen backs out without a confirm',
      homeAfterSetupBack && dialogs.length === 0,
      `home=${homeAfterSetupBack} dialogs=${dialogs.length}`,
    );

    await page.evaluate(() => document.querySelector('[data-action="nav-classic"]')?.click());
    await sleep(150);
    await page.evaluate(() => document.querySelector('[data-action="start"]')?.click());
    await sleep(150);
    const prevBalls = await page.evaluate(() => document.querySelector('#balls-line')?.textContent ?? null);
    await tapFlip(page);
    await waitForBallOrOverlay(page, prevBalls);
    dialogs.length = 0;
    await page.goBack();
    await sleep(250);
    const confirmedMidMatch = dialogs.some((m) => m.includes('Leave this match'));
    const homeAfterMidMatchBack = await page.evaluate(() => !!document.querySelector('.shelf'));
    record(
      'Journey 5 — Back button: mid-match back triggers "leave this match?" and (accepted) returns home',
      confirmedMidMatch && homeAfterMidMatchBack,
      `confirmed=${confirmedMidMatch} home=${homeAfterMidMatchBack}`,
    );
  } finally {
    await page.close();
  }
}

async function journeyAnalyticsAndCsp(browser) {
  const paths = ['/', '/privacy.html'];
  let allCspOk = true;
  const cspDetails = [];
  for (const path of paths) {
    const page = await browser.newPage();
    await page.evaluateOnNewDocument(() => {
      window.__cspViolations = [];
      document.addEventListener('securitypolicyviolation', (e) => {
        window.__cspViolations.push(`${e.violatedDirective}:${e.blockedURI}`);
      });
    });
    const consoleViolations = [];
    page.on('console', (msg) => {
      if (msg.text().includes('Content Security Policy')) consoleViolations.push(msg.text());
    });
    await page.goto(BASE_URL + path, { waitUntil: 'networkidle0' });
    await sleep(300);
    const domViolations = await page.evaluate(() => window.__cspViolations || []);
    const total = consoleViolations.length + domViolations.length;
    if (total > 0) allCspOk = false;
    cspDetails.push(`${path}=${total}`);
    await page.close();
  }
  record(
    `Journey 6 — CSP: zero violations across ${paths.join(', ')}${
      IS_LOCAL
        ? ' [LOCAL RUN: netlify.toml headers are not served by vite preview — this only catches violations that would fire with NO CSP at all, e.g. a stray inline style. Re-run with SMOKE_BASE_URL=https://bookcrickettimemachine.com for a real check against the deployed headers.]'
        : ''
    }`,
    allCspOk,
    cspDetails.join(' · '),
  );

  const page = await browser.newPage();
  await page.goto(BASE_URL, { waitUntil: 'networkidle0' });
  await page.evaluate(() => document.querySelector('.settings-gear summary')?.click());
  await sleep(100);
  const before = await page.evaluate(() => !!document.getElementById('umami-script'));
  await page.evaluate(() => {
    const el = document.getElementById('analytics-toggle');
    el.checked = false;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await sleep(150);
  const after = await page.evaluate(() => !!document.getElementById('umami-script'));
  record('Journey 6 — Analytics opt-out removes the tracking script tag', before === true && after === false, `before=${before} after=${after}`);
  await page.close();
}

async function journeySwOfflineAndUpdate(browser) {
  const page = await browser.newPage();
  try {
    await page.goto(BASE_URL, { waitUntil: 'networkidle0' });
    await sleep(500); // let the SW finish installing/activating
    await page.setOfflineMode(true);
    await page.reload({ waitUntil: 'networkidle0' }).catch(() => {});
    const offlineOk = await page.evaluate(() => !!document.querySelector('.shelf'));
    await page.setOfflineMode(false);
    record('Journey 7 — Service worker: app still renders after a reload while offline', offlineOk);

    if (SKIP_SW_UPDATE) {
      record('Journey 7 — Service worker: update toast on a source-only rebuild', true, 'skipped (--skip-sw-update)');
      return;
    }
    if (!IS_LOCAL) {
      record('Journey 7 — Service worker: update toast on a source-only rebuild', true, 'skipped (only meaningful against a local build server)');
      return;
    }

    // Mirrors the manual verification from the CACHE_NAME-stamping commit:
    // touch a harmless visible string, rebuild, and confirm the toast fires
    // purely from the resulting content-hash change — zero hand-edit to
    // sw.js anywhere in the process.
    const mainTsUrl = new URL('../../src/main.ts', import.meta.url);
    const original = readFileSync(mainTsUrl, 'utf8');
    const target = '<footer class="footer">';
    if (!original.includes(target)) {
      record(
        'Journey 7 — Service worker: update toast on a source-only rebuild',
        false,
        'marker string not found in main.ts — main.ts changed shape, update this script',
      );
      return;
    }
    writeFileSync(mainTsUrl, original.replace(target, `${target.slice(0, -1)} data-smoke-marker>`));
    try {
      execSync('npm run build', { stdio: 'ignore' });
      await page.evaluate(async () => {
        const reg = await navigator.serviceWorker.getRegistration();
        await reg?.update();
      });
      await sleep(2000);
      const toastVisible = await page.evaluate(() => !!document.querySelector('.update-toast'));
      record('Journey 7 — Service worker: update toast fires from a source-only rebuild', toastVisible);
    } finally {
      writeFileSync(mainTsUrl, original);
      execSync('npm run build', { stdio: 'ignore' }); // restore dist to match committed source
    }
  } finally {
    await page.close();
  }
}

async function main() {
  if (!existsSync(CHROME_PATH)) {
    console.error(`Chrome not found at "${CHROME_PATH}". Set CHROME_PATH to your Chrome executable and retry.`);
    process.exit(1);
  }
  console.log(`Smoke suite against ${BASE_URL}\n`);
  const browser = await puppeteer.launch({ executablePath: CHROME_PATH, headless: 'new' });
  try {
    await journeyClassicMatch(browser);
    await journeyTimeMachineBowling(browser);
    await journeyDaily(browser);
    await journeyChallenge(browser);
    await journeyBackButton(browser);
    await journeyAnalyticsAndCsp(browser);
    await journeySwOfflineAndUpdate(browser);
  } finally {
    await browser.close();
  }
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  if (failed.length > 0) {
    console.log('Failed:');
    failed.forEach((f) => console.log(`  - ${f.name}${f.detail ? `: ${f.detail}` : ''}`));
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
