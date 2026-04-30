import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const LANG_NAMES: Record<string, string> = {
  es:    'Spanish',
  fr:    'French',
  de:    'German',
  'pt-BR': 'Brazilian Portuguese',
};

export async function translateText(text: string, language: string): Promise<string> {
  const targetLang = LANG_NAMES[language];
  if (!targetLang) return text;

  const res = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: `Translate the following text to ${targetLang}. Preserve the tone, meaning, and formatting. Return only the translated text with no preamble or explanation.`,
      },
      { role: 'user', content: text },
    ],
    max_tokens: 4096,
  });

  return res.choices[0].message.content?.trim() ?? text;
}
