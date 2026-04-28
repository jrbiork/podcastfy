import OpenAI from 'openai';
import type { ScriptTurn } from './scriptWriter';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const VOICES: Record<string, 'nova' | 'onyx' | 'alloy'> = {
  host: 'nova',
  guest: 'onyx',
  narrator: 'alloy',
};

export async function generateAudio(script: ScriptTurn[]): Promise<Buffer> {
  const chunks: Buffer[] = [];

  for (const turn of script) {
    const voice = VOICES[turn.speaker] ?? VOICES.narrator;
    const response = await openai.audio.speech.create({
      model: 'tts-1',
      voice,
      input: turn.text,
      response_format: 'mp3',
    });
    const audio = Buffer.from(await response.arrayBuffer());

    chunks.push(audio);
  }

  return Buffer.concat(chunks);
}

// Rough estimate: 150 words per minute of speech
export function estimateDurationSeconds(script: ScriptTurn[]): number {
  const totalWords = script.reduce(
    (acc, turn) => acc + turn.text.split(/\s+/).length,
    0
  );
  return Math.ceil(totalWords / 150) * 60;
}
