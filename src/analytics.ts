/**
 * Anonymous, cookie-free product analytics (Umami) — a real opt-out, not
 * just "silently no-ops if blocked". The script itself is only injected
 * when the player's saved `analyticsOn` preference is true; turning it off
 * removes the script and it will not be injected again on a later visit
 * (see setAnalyticsEnabled). Every event call in this module is wrapped
 * defensively — an ad-blocker, DNT, offline, or simply not having loaded
 * yet must never throw or slow down gameplay.
 *
 * Umami is cookie-free and doesn't persist any cross-visit identifier — a
 * "visit" is a same-day, unlinkable hash, not a tracked person. The
 * on-device scorebook (career stats, streaks, luckiest ball — anything that
 * could read as "this specific person's data") is NEVER included in an
 * event. Only coarse, non-identifying categories — which mode, which
 * result, which feature — cross this boundary. See CLAUDE.md for the full
 * event list and why each one exists.
 *
 * See README "Analytics" for where UMAMI_WEBSITE_ID comes from and how to
 * read the resulting data on cloud.umami.is.
 */

const UMAMI_SCRIPT_SRC = 'https://cloud.umami.is/script.js';
const UMAMI_WEBSITE_ID = '4a7d5a45-1724-4404-942f-00b3fa9076b6';
const SCRIPT_ID = 'umami-script';

export type AnalyticsEvent =
  | 'match_started'
  | 'match_finished'
  | 'daily_share_tapped'
  | 'howto_opened'
  | 'gauntlet_started';

interface UmamiGlobal {
  track: (event: string, data?: Record<string, string | number | boolean>) => void;
}

declare global {
  interface Window {
    umami?: UmamiGlobal;
  }
}

/** Injects or removes the Umami script to match the player's saved preference — call once at startup and again on every toggle. */
export function setAnalyticsEnabled(enabled: boolean): void {
  const existing = document.getElementById(SCRIPT_ID);
  if (enabled) {
    if (existing) return;
    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.src = UMAMI_SCRIPT_SRC;
    script.dataset.websiteId = UMAMI_WEBSITE_ID;
    document.head.appendChild(script);
  } else {
    existing?.remove();
    // Umami doesn't leave anything else behind to clean up — no cookies, no
    // localStorage keys of its own.
  }
}

export function track(event: AnalyticsEvent, data?: Record<string, string | number | boolean>): void {
  try {
    window.umami?.track(event, data);
  } catch {
    // analytics must never break the game
  }
}
