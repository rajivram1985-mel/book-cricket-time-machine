/**
 * Original commentator personas — distinct delivery styles built from
 * ElevenLabs' stock/library voices, each pushed toward a character through
 * `voiceSettings`. Deliberately NOT clones or impersonations of any real
 * commentator: no named individual's voice is used or referenced. All four
 * personas read the exact same script (`src/voiceLines.ts`) — the character
 * comes entirely from the voice actor and the stability/style tuning, not
 * from separate scripts, to keep clip generation to one script × 4 voices
 * rather than four full scripts.
 */
export interface Commentator {
  id: string;
  label: string;
  emoji: string;
  tagline: string;
  voiceId: string;
  voiceSettings: {
    stability: number;
    similarity_boost: number;
    style: number;
    use_speaker_boost: boolean;
  };
}

export const COMMENTATORS: Commentator[] = [
  {
    id: 'enthusiast',
    label: 'The Enthusiast',
    emoji: '🎙️',
    tagline: 'Never met an exclamation mark he didn’t like.',
    voiceId: 'VR6AewLTigWG4xSOukaG', // stock library voice ("Arnold"-style: crisp, energetic)
    voiceSettings: { stability: 0.25, similarity_boost: 0.8, style: 0.8, use_speaker_boost: true },
  },
  {
    id: 'deadpan',
    label: 'The Deadpan',
    emoji: '🧊',
    tagline: 'Bone dry. One eyebrow, permanently raised.',
    voiceId: 'yoZ06aMxZJJ28mfd3POQ', // stock library voice (raspy, understated)
    voiceSettings: { stability: 0.75, similarity_boost: 0.8, style: 0.1, use_speaker_boost: true },
  },
  {
    id: 'analyst',
    label: 'The Analyst',
    emoji: '📻',
    tagline: 'Measured and technical — but watch him crack on a good one.',
    voiceId: 'ErXwobaYiN019PkySvjV', // stock library voice (warm, well-rounded)
    voiceSettings: { stability: 0.5, similarity_boost: 0.8, style: 0.35, use_speaker_boost: true },
  },
  {
    id: 'showman',
    label: 'The Showman',
    emoji: '⚡',
    tagline: 'Builds to the big pause, every single time.',
    voiceId: 'pNInz6obpgDQGcFmaJgB', // stock library voice (deep, theatrical)
    voiceSettings: { stability: 0.3, similarity_boost: 0.8, style: 0.75, use_speaker_boost: true },
  },
];

export const DEFAULT_COMMENTATOR_ID = 'enthusiast';

export function commentatorById(id: string): Commentator {
  return COMMENTATORS.find((c) => c.id === id) ?? COMMENTATORS[0];
}

export function isKnownCommentator(id: string): boolean {
  return COMMENTATORS.some((c) => c.id === id);
}
