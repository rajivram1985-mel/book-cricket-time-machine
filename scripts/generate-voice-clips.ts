/**
 * Renders every commentary line + player name callout to a static MP3 via
 * the ElevenLabs API and writes them under public/audio/voice/. Run with:
 *
 *   npm run voice:generate
 *
 * Needs ELEVENLABS_API_KEY in BookCricket/.env.local (gitignored via the
 * *.local pattern — never committed, never pasted in chat). Optional:
 * ELEVENLABS_VOICE_ID (default: "Adam", a stock energetic voice available
 * on every account) and ELEVENLABS_MODEL_ID (default: eleven_flash_v2_5,
 * the cheapest/fastest model — fine for two-second game lines).
 *
 * Idempotent: skips any file that already exists. Pass --force to redo all.
 * The game itself never calls this API — clips are static assets checked
 * into public/, and missing ones simply mean silence (see src/voice.ts).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MOMENT_LINES } from '../src/voiceLines';
import { ROSTER } from '../src/roster';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT_DIR = join(ROOT, 'public', 'audio', 'voice');

function loadDotEnvLocal(): void {
  const path = join(ROOT, '.env.local');
  if (!existsSync(path)) return;
  for (const rawLine of readFileSync(path, 'utf8').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, '');
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadDotEnvLocal();

const API_KEY = process.env.ELEVENLABS_API_KEY;
const VOICE_ID = process.env.ELEVENLABS_VOICE_ID || 'pNInz6obpgDQGcFmaJgB'; // "Adam" — energetic stock voice
const MODEL_ID = process.env.ELEVENLABS_MODEL_ID || 'eleven_flash_v2_5';
const FORCE = process.argv.includes('--force');

if (!API_KEY) {
  console.error(
    [
      'ELEVENLABS_API_KEY is not set.',
      '',
      'Create BookCricket/.env.local (already gitignored) with:',
      '  ELEVENLABS_API_KEY=your-key-here',
      '',
      'Optional overrides:',
      '  ELEVENLABS_VOICE_ID=...   (default: Adam, pNInz6obpgDQGcFmaJgB)',
      '  ELEVENLABS_MODEL_ID=...   (default: eleven_flash_v2_5)',
      '',
      'Then run: npm run voice:generate',
    ].join('\n'),
  );
  process.exit(1);
}

interface Job {
  text: string;
  outPath: string;
}

function buildJobs(): Job[] {
  const jobs: Job[] = [];
  for (const [category, lines] of Object.entries(MOMENT_LINES)) {
    lines.forEach((text, i) => {
      jobs.push({ text, outPath: join(OUT_DIR, category, `${i}.mp3`) });
    });
  }
  for (const p of ROSTER) {
    jobs.push({ text: `${p.shortName}!`, outPath: join(OUT_DIR, 'name', `${p.id}.mp3`) });
  }
  return jobs;
}

async function synth(text: string): Promise<ArrayBuffer> {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`, {
    method: 'POST',
    headers: {
      'xi-api-key': API_KEY!,
      'Content-Type': 'application/json',
      accept: 'audio/mpeg',
    },
    body: JSON.stringify({
      text,
      model_id: MODEL_ID,
      // Lower stability + higher style = more dramatic, less flat — right
      // for a two-second commentary shout, wrong for a calm narrator.
      voice_settings: { stability: 0.35, similarity_boost: 0.8, style: 0.65, use_speaker_boost: true },
    }),
  });
  if (!res.ok) {
    throw new Error(`ElevenLabs ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  return res.arrayBuffer();
}

async function main(): Promise<void> {
  const jobs = buildJobs();
  let written = 0;
  let skipped = 0;
  let failed = 0;
  let chars = 0;

  for (const job of jobs) {
    if (!FORCE && existsSync(job.outPath)) {
      skipped++;
      continue;
    }
    mkdirSync(dirname(job.outPath), { recursive: true });
    process.stdout.write(`${job.outPath.replace(ROOT, '.')} ... `);
    try {
      const buf = await synth(job.text);
      writeFileSync(job.outPath, Buffer.from(buf));
      chars += job.text.length;
      written++;
      console.log('ok');
    } catch (e) {
      failed++;
      console.log('FAILED');
      console.error(`  ${e instanceof Error ? e.message : e}`);
    }
  }

  console.log(
    `\n${written} written, ${skipped} skipped (already existed), ${failed} failed. ` +
      `~${chars} characters synthesized this run.`,
  );
  if (failed > 0) process.exitCode = 1;
}

void main();
