import { describe, expect, it } from 'vitest';
import {
  commentatorById,
  COMMENTATORS,
  DEFAULT_COMMENTATOR_ID,
  isKnownCommentator,
} from '../src/commentators';

describe('COMMENTATORS', () => {
  it('has unique ids, labels and voice ids', () => {
    const ids = COMMENTATORS.map((c) => c.id);
    const labels = COMMENTATORS.map((c) => c.label);
    const voiceIds = COMMENTATORS.map((c) => c.voiceId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(labels).size).toBe(labels.length);
    expect(new Set(voiceIds).size).toBe(voiceIds.length);
  });

  it('keeps every voiceSettings value within the valid 0-1 range', () => {
    for (const c of COMMENTATORS) {
      const s = c.voiceSettings;
      expect(s.stability).toBeGreaterThanOrEqual(0);
      expect(s.stability).toBeLessThanOrEqual(1);
      expect(s.similarity_boost).toBeGreaterThanOrEqual(0);
      expect(s.similarity_boost).toBeLessThanOrEqual(1);
      expect(s.style).toBeGreaterThanOrEqual(0);
      expect(s.style).toBeLessThanOrEqual(1);
    }
  });

  it('the default commentator id resolves to a real persona', () => {
    expect(isKnownCommentator(DEFAULT_COMMENTATOR_ID)).toBe(true);
    expect(commentatorById(DEFAULT_COMMENTATOR_ID).id).toBe(DEFAULT_COMMENTATOR_ID);
  });

  it('falls back to the first persona for an unknown id', () => {
    expect(commentatorById('nonexistent-persona')).toBe(COMMENTATORS[0]);
    expect(isKnownCommentator('nonexistent-persona')).toBe(false);
  });
});
