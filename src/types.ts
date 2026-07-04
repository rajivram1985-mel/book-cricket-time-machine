export type Mode = 'classic' | 'stats';

export interface Era {
  label: string;
  startYear: number;
  /** null = still active */
  endYear: number | null;
}

export interface BattingStats {
  average: number;
  /** runs per 100 balls, blended across formats — flavor, not gospel */
  strikeRate: number;
  /** % of balls hit to the boundary for four */
  boundaryPercent: number;
  /** % of balls hit for six */
  sixPercent: number;
}

export interface BowlingStats {
  average: number;
  economy: number;
  /** balls per wicket */
  strikeRate: number;
  /** 0–1 tuning knob: how menacing this bowler feels in a short spell */
  wicketThreat: number;
}

export type Role = 'batsman' | 'bowler';

export interface Player {
  id: string;
  name: string;
  shortName: string;
  country: string;
  era: Era;
  roles: Role[];
  style: { batting: string | null; bowling: string | null };
  bio: string;
  /** Two or three short flavor chips, e.g. "Lethal bouncer" */
  strengths: string[];
  avatar: { emoji: string; color1: string; color2: string };
  batting: BattingStats | null;
  bowling: BowlingStats | null;
}

export type RunCount = 1 | 2 | 3 | 4 | 5 | 6;

export type Outcome = { kind: 'wicket' } | { kind: 'runs'; runs: RunCount };

export interface Ball {
  page: number;
  digit: number;
  outcome: Outcome;
}

export interface Probabilities {
  wicket: number;
  runs: Record<RunCount, number>;
}
