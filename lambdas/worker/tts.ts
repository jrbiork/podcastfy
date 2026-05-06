import OpenAI from 'openai';
import getMp3Duration from 'get-mp3-duration';
import type { ScriptTurn } from './scriptWriter';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

type OAIVoice = 'alloy' | 'echo' | 'fable' | 'nova' | 'onyx' | 'shimmer';

const VOICES: Record<string, OAIVoice> = {
  host: 'nova',
  guest: 'onyx',
  narrator: 'alloy',
};

const VALID_VOICES = new Set<OAIVoice>(['alloy', 'echo', 'fable', 'nova', 'onyx', 'shimmer']);

// Default digest voices: Fable = Narrator A, Nova = Narrator B
const DIGEST_VOICE_A: OAIVoice = 'fable';
const DIGEST_VOICE_B: OAIVoice = 'nova';

// Complementary contrast pairs — used when the user overrides the presenter voice
const VOICE_PAIRS: Record<OAIVoice, OAIVoice> = {
  alloy: 'nova',
  echo: 'nova',
  fable: 'nova',
  nova: 'fable',
  onyx: 'nova',
  shimmer: 'fable',
};

export function getPairedVoice(voice: string): OAIVoice {
  const v = voice as OAIVoice;
  return VALID_VOICES.has(v) ? VOICE_PAIRS[v] : DIGEST_VOICE_B;
}

async function ttsChunk(text: string, voice: OAIVoice): Promise<Buffer> {
  const response = await openai.audio.speech.create({
    model: 'tts-1',
    voice,
    input: text,
    response_format: 'mp3',
  });
  return Buffer.from(await response.arrayBuffer());
}

export async function generateAudio(script: ScriptTurn[], ttsVoice?: string): Promise<Buffer> {
  const chunks: Buffer[] = [];

  for (const turn of script) {
    const voice: OAIVoice =
      turn.speaker === 'narrator' && ttsVoice && VALID_VOICES.has(ttsVoice as OAIVoice)
        ? (ttsVoice as OAIVoice)
        : (VOICES[turn.speaker] ?? VOICES.narrator);
    chunks.push(await ttsChunk(turn.text, voice));
  }

  return Buffer.concat(chunks);
}

/** Returns measured MP3 duration in seconds from frame data. */
export function mp3ChunkDurationSeconds(chunk: Buffer): number {
  if (!chunk.byteLength) return 0;
  return getMp3Duration(chunk) / 1000;
}

/**
 * Generates audio for a digest script. Each segment carries an explicit voice tag:
 * 'primary' → voiceA (narrator A), 'secondary' → voiceB (narrator B).
 */
export async function generateAlternatingAudio(
  segments: Array<{ text: string; voice: 'primary' | 'secondary' }>,
  voiceA: string,
  voiceB: string,
): Promise<{
  buffer: Buffer;
  chunkDurationSeconds: number[];
  timeline: Array<{ start: number; end: number }>;
  totalDurationSeconds: number;
}> {
  const a: OAIVoice = VALID_VOICES.has(voiceA as OAIVoice) ? (voiceA as OAIVoice) : VOICES.narrator;
  const b: OAIVoice = VALID_VOICES.has(voiceB as OAIVoice) ? (voiceB as OAIVoice) : VOICES.guest;
  const chunks: Buffer[] = [];
  const chunkDurationSeconds: number[] = [];
  const timeline: Array<{ start: number; end: number }> = [];
  let currentTime = 0;

  for (const seg of segments) {
    const buf = await ttsChunk(seg.text, seg.voice === 'secondary' ? b : a);
    const duration = mp3ChunkDurationSeconds(buf);
    chunks.push(buf);
    chunkDurationSeconds.push(duration);
    timeline.push({
      start: currentTime,
      end: currentTime + duration,
    });
    currentTime += duration;
  }

  const buffer = Buffer.concat(chunks);
  // Source of truth for final digest duration.
  const totalDurationSeconds = mp3ChunkDurationSeconds(buffer);

  return { buffer, chunkDurationSeconds, timeline, totalDurationSeconds };
}

// Prefer measured MP3 duration when audio is available.
export function estimateDurationSeconds(_script: ScriptTurn[], audioBuffer?: Buffer): number {
  if (audioBuffer && audioBuffer.byteLength > 0) {
    return Math.round(getMp3Duration(audioBuffer) / 1000);
  }
  // Fallback before audio is available: 150 wpm estimate
  const totalWords = _script.reduce((acc, turn) => acc + turn.text.split(/\s+/).length, 0);
  return Math.round(totalWords / 2.5);
}
