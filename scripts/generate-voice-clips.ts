/**
 * Renders every commentary line + player name callout, once per commentator
 * persona, to static MP3s via the ElevenLabs API and writes them under
 * public/audio/voice/<personaId>/. Run with:
 *
 *   npm run voice:generate
 *
 * Needs ELEVENLABS_API_KEY in BookCricket/.env.local (gitignored via the
 * *.local pattern — never committed, never pasted in chat). Optional:
 * ELEVENLABS_MODEL_ID (default: eleven_flash_v2_5, the cheapest/fastest
 * model — fine for two-second game lines). Each persona's voice ID and
 * delivery tuning live in src/commentators.ts, not here — this script just
 * fans the same script out across all of them.
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
import { COMMENTATORS, type Commentator } from '../src/commentators';

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
      'Optional override:',
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
  persona: Commentator;
}

function buildJobs(): Job[] {
  const jobs: Job[] = [];
  for (const persona of COMMENTATORS) {
    for (const [category, lines] of Object.entries(MOMENT_LINES)) {
      lines.forEach((text, i) => {
        jobs.push({ text, outPath: join(OUT_DIR, persona.id, category, `${i}.mp3`), persona });
      });
    }
    for (const p of ROSTER) {
      jobs.push({
        text: `${p.shortName}!`,
        outPath: join(OUT_DIR, persona.id, 'name', `${p.id}.mp3`),
        persona,
      });
    }
  }
  return jobs;
}

async function synth(text: string, persona: Commentator): Promise<ArrayBuffer> {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${persona.voiceId}`, {
    method: 'POST',
    headers: {
      'xi-api-key': API_KEY!,
      'Content-Type': 'application/json',
      accept: 'audio/mpeg',
    },
    body: JSON.stringify({
      text,
      model_id: MODEL_ID,
      voice_settings: persona.voiceSettings,
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
    process.stdout.write(`[${job.persona.label}] ${job.outPath.replace(ROOT, '.')} ... `);
    try {
      const buf = await synth(job.text, job.persona);
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
      `~${chars} characters synthesized this run across ${COMMENTATORS.length} personas.`,
  );
  if (failed > 0) process.exitCode = 1;
}

void main();
