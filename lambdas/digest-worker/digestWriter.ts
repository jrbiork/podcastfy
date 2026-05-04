import OpenAI from 'openai';
import type { FeedArticle } from './feedFetcher';
import type { DigestStory } from '../shared/s3';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const TTS_WORDS_PER_MINUTE = 150;

export interface ArticleSummary {
  feedName: string;
  feedId: string;
  title: string;
  link: string;
  summary: string;
  topicId?: string;
}

const TOPIC_LABELS: Record<string, string> = {
  'news':               'World News',
  'technology':         'Technology',
  'business-finance':   'Business & Finance',
  'politics':           'Politics',
  'health-wellness':    'Health & Wellness',
  'science':            'Science',
  'productivity':       'Productivity',
  'fitness':            'Fitness',
  'mental-health':      'Mental Health',
  'food':               'Food',
  'travel':             'Travel',
  'parenting':          'Parenting',
  'entertainment-news': 'Entertainment',
  'movies-tv':          'Movies & TV',
  'music':              'Music',
  'gaming':             'Gaming',
  'books':              'Books',
  'startups':           'Startups',
  'crypto-web3':        'Crypto & Web3',
  'environment':        'Environment',
  'ai-tech':            'AI & Tech',
};

export interface ScriptSegment {
  text: string;
  voice: 'primary' | 'secondary';
}

export async function summarizeArticle(
  article: FeedArticle,
  fullText: string
): Promise<ArticleSummary> {
  const content = fullText.trim() || article.description;
  const truncated = content.slice(0, 4000);

  try {
    const res = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 200,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'You extract key facts from news articles for a podcast script. Return JSON: { "summary": "..." }. Include: the core event, specific numbers/names/places, and the main implication. 2-3 sentences max. No fluff, no calls to action, no "read more".',
        },
        {
          role: 'user',
          content: `Title: ${article.title}\n\n${truncated}`,
        },
      ],
    });

    const parsed = JSON.parse(res.choices[0]?.message?.content ?? '{}') as { summary?: string };
    if (typeof parsed.summary === 'string' && parsed.summary.trim()) {
      return {
        feedName: article.feedName,
        feedId: article.feedId,
        title: article.title,
        link: article.link,
        summary: parsed.summary.trim(),
        topicId: article.topicId,
      };
    }
  } catch (err) {
    console.warn('[digestWriter] summarizeArticle error', { title: article.title, err: String(err) });
  }

  const fallback = article.description.slice(0, 300).trim();
  return {
    feedName: article.feedName,
    feedId: article.feedId,
    title: article.title,
    link: article.link,
    summary: fallback || article.title,
    topicId: article.topicId,
  };
}

function estimateWordDuration(text: string): number {
  const words = text.trim().split(/\s+/).length;
  return Math.round((words / TTS_WORDS_PER_MINUTE) * 60);
}

function topNToTargetMinutes(topN: number): number {
  if (topN <= 5) return 3;
  if (topN <= 9) return 5;
  return 10;
}

// ── Spoken-name helpers ───────────────────────────────────────────────────────

const FEED_DISPLAY_NAMES: Record<string, string> = {
  bbc: 'BBC',
  npr: 'NPR',
  wsj: 'WSJ',
  nytimes: 'The New York Times',
  cnn: 'CNN',
  espn: 'ESPN',
  ign: 'IGN',
  hbr: 'Harvard Business Review',
  techcrunch: 'TechCrunch',
  theverge: 'The Verge',
  theguardian: 'The Guardian',
  wired: 'Wired',
  bloomberg: 'Bloomberg',
  venturebeat: 'VentureBeat',
  coindesk: 'CoinDesk',
  cointelegraph: 'CoinTelegraph',
  cntraveler: 'Condé Nast Traveler',
  travelandleisure: 'Travel and Leisure',
  bonappetit: 'Bon Appétit',
  smittenkitchen: 'Smitten Kitchen',
  healthline: 'Healthline',
  sciencedaily: 'Science Daily',
  medlineplus: 'MedlinePlus',
  pitchfork: 'Pitchfork',
  vulture: 'Vulture',
  polygon: 'Polygon',
  kotaku: 'Kotaku',
  hnrss: 'Hacker News',
  fastcompany: 'Fast Company',
  lifehacker: 'Lifehacker',
  menshealth: "Men's Health",
  runnersworld: "Runner's World",
  politico: 'Politico',
  indiewire: 'IndieWire',
  skift: 'Skift',
  nme: 'NME',
  statnews: 'STAT News',
  eater: 'Eater',
  epicurious: 'Epicurious',
  food52: 'Food52',
  variety: 'Variety',
  deadline: 'Deadline',
  avclub: 'The A.V. Club',
  slashfilm: 'SlashFilm',
  collider: 'Collider',
  gamespot: 'GameSpot',
  pcgamer: 'PC Gamer',
  climatecentral: 'Climate Central',
};

/** Returns a clean spoken name for a feed hostname/id. */
function feedDisplayName(rawName: string): string {
  const stripped = rawName
    .replace(/^(feeds?|rss|www)\./i, '')
    .replace(/\.(com|org|net|io|co|uk|gov|edu)(\.\w+)?$/i, '');
  const lower = stripped.toLowerCase();
  return FEED_DISPLAY_NAMES[lower] ?? (stripped.charAt(0).toUpperCase() + stripped.slice(1));
}

// ── Programmatic structural phrases ──────────────────────────────────────────

const TOPIC_TRANSITIONS = [
  'Moving on to',
  "Now let's talk",
  'Switching to',
  "Let's get into some",
  'Next up, some',
  'Time for some',
  'Now for some',
  "Here's some",
];

const SOURCE_PHRASES = ['From', 'Over at', 'Coming from', 'Out of'];
const ALSO_SOURCE_PHRASES = ['Also from', 'And from', 'Another one from'];

function topicTransitionText(topicLabel: string, idx: number): string {
  return `${TOPIC_TRANSITIONS[idx % TOPIC_TRANSITIONS.length]} ${topicLabel}.`;
}

function sourceIntroText(feedName: string, sameSource: boolean, idx: number): string {
  const display = feedDisplayName(feedName);
  const phrase = sameSource
    ? ALSO_SOURCE_PHRASES[idx % ALSO_SOURCE_PHRASES.length]
    : SOURCE_PHRASES[idx % SOURCE_PHRASES.length];
  return `${phrase} ${display}:`;
}

// ── GPT dialogue prompt (body only — structure is handled in code) ─────────────

const DIALOGUE_SYSTEM_PROMPT = `You write the conversational body for a two-host daily news podcast.

HOSTS:
[A] = Host A — delivers key facts, numbers, names, what happened.
[B] = Host B — adds context, the backstory, or the "why it matters" angle.

The story title and source have already been announced. Jump straight into [B]'s reaction.

FORMAT — one tag per line, 3–4 exchanges total:
[B] Reaction or backstory — what's the angle?
[A] The key facts — specific numbers, names, what actually happened.
[B] The implication — why does this matter?
[A] or [B] One closing sentence to move on.

RULES:
- Always start with [B]
- Spoken language only — no markdown, no bullet points, no stage directions
- NO filler words: never write "absolutely", "totally", "great point", "exactly", "wow", "fascinating", "that's interesting"
- [B] must add real insight — not just agreement or repetition
- Do NOT mention apps, newsletters, "read more", or subscriptions
- 4–5 lines total, tight and punchy`;

/** Parses [A]/[B] tagged lines into ScriptSegments. */
function parseDialogue(raw: string): ScriptSegment[] {
  const segments: ScriptSegment[] = [];
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (t.startsWith('[A]')) {
      const text = t.slice(3).trim();
      if (text) segments.push({ text, voice: 'primary' });
    } else if (t.startsWith('[B]')) {
      const text = t.slice(3).trim();
      if (text) segments.push({ text, voice: 'secondary' });
    }
  }
  return segments;
}

/** Generates only the conversational body for one story — no structural duties. */
async function generateStoryDialogue(summary: ArticleSummary): Promise<ScriptSegment[]> {
  const res = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 350,
    messages: [
      { role: 'system', content: DIALOGUE_SYSTEM_PROMPT },
      { role: 'user', content: `"${summary.title}"\n${summary.summary}` },
    ],
  });

  const raw = res.choices[0]?.message?.content?.trim() ?? '';
  const segments = parseDialogue(raw);

  if (segments.length === 0) {
    console.warn('[digestWriter] empty dialogue for story', { title: summary.title });
  }
  return segments;
}

/**
 * Assembles all story segments.
 * Topic transitions and source+title lines are injected in code (guaranteed),
 * then GPT body dialogue is appended for each story.
 */
async function generateNarratorScript(
  summaries: ArticleSummary[],
): Promise<ScriptSegment[]> {
  // Fire all GPT body calls in parallel
  const bodyResults = await Promise.allSettled(
    summaries.map((s) => generateStoryDialogue(s)),
  );

  const allSegments: ScriptSegment[] = [];

  summaries.forEach((summary, i) => {
    const prev = summaries[i - 1];
    const isNewTopic = summary.topicId && summary.topicId !== prev?.topicId;
    const topicLabel = isNewTopic ? (TOPIC_LABELS[summary.topicId!] ?? summary.topicId!) : undefined;
    const sameSource = !isNewTopic && prev?.feedName === summary.feedName;

    // 1. Topic transition — always injected in code, never delegated to GPT
    if (topicLabel) {
      allSegments.push({ text: topicTransitionText(topicLabel, i), voice: 'primary' });
    }

    // 2. Source + title — always injected in code, never delegated to GPT
    const sourcePrefix = sourceIntroText(summary.feedName, sameSource, i);
    allSegments.push({ text: `${sourcePrefix} "${summary.title}".`, voice: 'primary' });

    // 3. GPT conversational body
    const body = bodyResults[i];
    if (body.status === 'fulfilled' && body.value.length > 0) {
      allSegments.push(...body.value);
    } else {
      const reason = body.status === 'rejected' ? String(body.reason) : 'empty';
      console.warn('[digestWriter] story body failed, using fallback', { title: summary.title, reason });
      allSegments.push({ text: summary.summary, voice: 'secondary' as const });
    }
  });

  return allSegments;
}

export interface DigestScriptResult {
  segments: ScriptSegment[];
  stories: DigestStory[];
}

function buildIntroSegments(date: Date, summaries: ArticleSummary[]): ScriptSegment[] {
  const dayStr = date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  const uniqueTopics = [
    ...new Set(
      summaries
        .filter((s) => s.topicId)
        .map((s) => TOPIC_LABELS[s.topicId!] ?? s.topicId!),
    ),
  ];

  const count = summaries.length;
  const storyWord = count === 1 ? 'story' : 'stories';

  let topicLine: string;
  if (uniqueTopics.length === 0) {
    topicLine = `We have ${count} ${storyWord} for you today.`;
  } else if (uniqueTopics.length === 1) {
    topicLine = `We have ${count} ${storyWord} for you today, focused on ${uniqueTopics[0]}.`;
  } else {
    const listed = uniqueTopics.slice(0, 3).join(', ');
    const tail = uniqueTopics.length > 3 ? ', and more' : '';
    topicLine = `We have ${count} ${storyWord} for you today, covering ${listed}${tail}.`;
  }

  return [
    {
      text: `Good morning, and welcome to your daily briefing — it's ${dayStr}.`,
      voice: 'primary',
    },
    {
      text: `${topicLine} Let's get into it.`,
      voice: 'secondary',
    },
  ];
}

const OUTRO_SEGMENTS: ScriptSegment[] = [
  {
    text: `That's everything for today's briefing. Thanks for listening — have a great day, and we'll be back tomorrow with more stories for you.`,
    voice: 'primary',
  },
];

export async function generateDigestScript(
  summaries: ArticleSummary[],
  date: Date,
  topN = 9,
): Promise<DigestScriptResult> {
  if (summaries.length === 0) {
    return {
      segments: [{ text: "No stories available for today's briefing.", voice: 'primary' }],
      stories: [],
    };
  }

  let storySegments: ScriptSegment[];
  try {
    storySegments = await generateNarratorScript(summaries);
  } catch (err) {
    console.warn('[digestWriter] generateNarratorScript failed, using fallback', { err: String(err) });
    const CONNECTORS = ['First,', 'Next,', 'Also,', 'And finally,'];
    storySegments = summaries.map((s, i) => ({
      text: `${CONNECTORS[Math.min(i, CONNECTORS.length - 1)]} ${s.title}. ${s.summary}`,
      voice: 'primary' as const,
    }));
  }

  const segments = [
    ...buildIntroSegments(date, summaries),
    ...storySegments,
    ...OUTRO_SEGMENTS,
  ];

  const stories: DigestStory[] = summaries.map((s) => ({
    title: s.title,
    feedName: s.feedName,
    feedId: s.feedId,
    link: s.link,
    estimatedDurationSeconds: estimateWordDuration(`${s.title}. ${s.summary}`),
    summary: s.summary,
    topicLabel: s.topicId ? (TOPIC_LABELS[s.topicId] ?? undefined) : undefined,
  }));

  return { segments, stories };
}
