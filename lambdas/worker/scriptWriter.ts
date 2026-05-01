import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export type ScriptTurn = { speaker: 'host' | 'guest' | 'narrator'; text: string };

const EXTRACTION_PROMPT = (title: string, text: string) => `
You prepare source text for text-to-speech and podcast generation. The listener will ONLY hear spoken audio — never URLs read aloud, never ads, never image descriptions.

Input is raw text from an article, PDF, or web page (may include junk).

Task — output ONE narrative-friendly prose block:

1. Extract ONLY the core editorial substance: thesis, reasoning, facts, narrative, and conclusions that belong to this piece.

2. REMOVE entirely (do not summarize unless the idea matters without the fluff):
   - Image-related material: descriptions of photos/figures/charts, captions, subtitles under images, "Photo:", "Figure N:", credits, alt-text-style lines
   - Publication boilerplate: standalone publication/update timestamps, datelines whose only job is to say when something was posted ("Published …", "Updated …"), timezone stamps
   - Advertising & sponsorship: product pitches, affiliate blocks, "sponsored by", shopping widgets, unrelated brand promos
   - Links & peripheral web chrome: bare URLs, "click here", "read more at …", link-roundups to unrelated sites, social/share prompts, comment prompts, newsletter signup blurbs that are not part of the argument
   - Navigation/UI remnants obvious from scraping

3. Preserve the LANGUAGE of the substantive content (do not translate unless the source mixes languages unnecessarily — then unify to the dominant article language).

4. When a citation is important but was only given as a URL, keep the IDEA (e.g. "a 2024 study found …") without speaking any URL or domain.

5. Output fluent paragraphs (plain text). No markdown, no bullet lists unless they encode essential structure — prefer prose.

Title context (may help disambiguate): ${title}

SOURCE TEXT:
${text}

Output ONLY valid JSON: { "text": "..." }
`.trim();

/** Strip non-spoken junk before scripting/TTS; falls back to original text on failure. */
export async function extractCoreContentForSpeech(title: string, text: string): Promise<string> {
  const trimmed = text.trim();
  if (trimmed.length < 80) return trimmed;

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'You extract core editorial prose for spoken audio. Never include URLs, ads, image captions, or publication timestamps as filler. Output only valid JSON with a single string field "text".',
        },
        { role: 'user', content: EXTRACTION_PROMPT(title, trimmed) },
      ],
      max_tokens: 12000,
    });

    const raw = JSON.parse(completion.choices[0].message.content ?? '{"text":""}') as {
      text?: string;
    };
    const out = (raw.text ?? '').replace(/\s+/g, ' ').trim();
    if (out.length < Math.min(200, trimmed.length * 0.15)) {
      return trimmed;
    }
    return out.slice(0, 14_000);
  } catch {
    return trimmed;
  }
}

const SCRIPT_PROMPT = (title: string, text: string) => `
The prose below was already cleaned for audio (no URLs to read, no ads, no image blurbs). Convert it into an engaging 5–7 minute podcast using a two-speaker format.

Speakers:
- Host: introduces topics, asks sharp questions, keeps energy up
- Guest: explains content with insight, personality, and concrete examples

Rules:
- Natural conversational language — no bullet points, no jargon dumps
- Open with a hook in the first 10 seconds
- Structure: Hook → Context → 3 main insights → Key takeaway → Outro
- Each turn: 2–4 sentences max
- Synthesize and entertain — do NOT just recite the source
- Spoken audio only: NEVER read URLs, domains, "dot com", social handles, email addresses, or link-outs; omit advertisements and sponsored product pitches entirely
- Do NOT describe or mention photos, illustrations, diagrams, charts, graphs, maps, infographics, screenshots, or any visual — omit figure captions, legends, image subtitles, credits ("Photo:", "Source:"), alt-text-style descriptions
- Never use phrases like "the image shows", "in this chart", "as you can see", "the picture depicts", or "according to the graphic"

Article title: ${title}
Core content: ${text}

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
          'You are a professional podcast producer. The audience hears audio only: never read URLs or ads; never describe images, captions, charts, or figures. Output only valid JSON with a "script" array.',
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
