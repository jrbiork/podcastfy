import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export type ScriptTurn = { speaker: 'host' | 'guest' | 'narrator'; text: string };

const SCRIPT_PROMPT = (title: string, text: string) => `
Convert the article below into an engaging 5–7 minute podcast using a two-speaker format.

Speakers:
- Host: introduces topics, asks sharp questions, keeps energy up
- Guest: explains content with insight, personality, and concrete examples

Rules:
- Natural conversational language — no bullet points, no jargon dumps
- Open with a hook in the first 10 seconds
- Structure: Hook → Context → 3 main insights → Key takeaway → Outro
- Each turn: 2–4 sentences max
- Synthesize and entertain — do NOT just recite the article
- NEVER reference photos, images, captions, charts, graphs, or any visual media — this is audio only

Article title: ${title}
Article: ${text}

Output ONLY valid JSON: { "script": [{ "speaker": "host", "text": "..." }, ...] }
`.trim();

export async function generatePodcastScript(article: {
  title: string;
  text: string;
}): Promise<ScriptTurn[]> {
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content:
          'You are a professional podcast producer. Output only valid JSON with a "script" array.',
      },
      { role: 'user', content: SCRIPT_PROMPT(article.title, article.text) },
    ],
    max_tokens: 3000,
  });

  const raw = JSON.parse(completion.choices[0].message.content ?? '{"script":[]}');
  const script = raw.script as ScriptTurn[] | undefined;
  if (!Array.isArray(script) || script.length === 0) {
    throw new Error('script_failed');
  }
  return script;
}

const TITLE_PROMPT = (text: string) => `
Generate a short, clear episode title for this spoken audio.

Rules:
- 3 to 8 words
- Plain title case
- No quotes
- No punctuation at the end
- Focus on the core topic

Content:
${text.slice(0, 4000)}

Output ONLY valid JSON: { "title": "..." }
`.trim();

export async function generateContextTitle(
  text: string,
  fallback = 'Untitled Episode'
): Promise<string> {
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content:
          'You write concise episode titles. Output only valid JSON with a "title" string.',
      },
      { role: 'user', content: TITLE_PROMPT(text) },
    ],
    max_tokens: 40,
  });

  const raw = JSON.parse(completion.choices[0].message.content ?? '{"title":""}') as {
    title?: string;
  };
  const title = (raw.title ?? '').replace(/\s+/g, ' ').trim();
  return title || fallback;
}

export function buildTtsScript(text: string): ScriptTurn[] {
  // Split into ~300-word chunks for ElevenLabs
  const words = text.split(/\s+/);
  const chunks: ScriptTurn[] = [];
  for (let i = 0; i < words.length; i += 300) {
    chunks.push({
      speaker: 'narrator',
      text: words.slice(i, i + 300).join(' '),
    });
  }
  return chunks;
}
