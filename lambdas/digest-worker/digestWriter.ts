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
  'economy':            'Economy',
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
  'crypto':             'Crypto',
  'environment':        'Environment',
  'ai-tech':            'AI & Tech',
};

export interface ScriptSegment {
  text: string;
  voice: 'primary' | 'secondary';
}

/** Parallel to each TTS segment — used to fold chunk durations into per-story audio bounds. */
export type DigestSegmentLabel =
  | { phase: 'intro' }
  | { phase: 'story'; storyIndex: number }
  | { phase: 'outro' };

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

const DIALOGUE_SYSTEM_PROMPT = `You write the spoken body for a two-host daily news podcast.

HOSTS:
[A] = Narrator A — direct factual delivery.
[B] = Narrator B — direct factual delivery.

The story title and source have already been announced. Jump straight into the story facts.

FORMAT — one tag per line, exactly 2 exchanges:
[A] Main development in one tight sentence.
[B] Follow-up facts in one tight sentence (numbers, timeline, place, impact).

RULES:
- Always use [A] then [B]
- Spoken language only — no markdown, no bullet points, no stage directions
- Keep both lines fast and direct; no analysis banter or opinion
- NO filler words: never write "absolutely", "totally", "great point", "exactly", "wow", "fascinating", "that's interesting"
- Do NOT mention apps, newsletters, "read more", or subscriptions
- Do NOT repeat the title or source (already spoken)
- 2 lines total, tight and punchy`;

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

/** Generates only the two-narrator body for one story — no structural duties. */
async function generateStoryDialogue(
  summary: ArticleSummary,
  targetSeconds: number,
): Promise<ScriptSegment[]> {
  const res = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 220,
    messages: [
      { role: 'system', content: DIALOGUE_SYSTEM_PROMPT },
      {
        role: 'user',
        content: `"${summary.title}"\n${summary.summary}\n\nLength target: ~${targetSeconds} seconds of spoken audio. Keep it tight — 2 exchanges max.`,
      },
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
): Promise<{ segments: ScriptSegment[]; labels: DigestSegmentLabel[]; spokenTextByStory: string[] }> {
  const TOTAL_TARGET_SECONDS = 6 * 60;
  const INTRO_OUTRO_BUDGET_SECONDS = 90;
  const perStory = Math.max(
    30,
    Math.min(58, Math.floor((TOTAL_TARGET_SECONDS - INTRO_OUTRO_BUDGET_SECONDS) / Math.max(1, summaries.length))),
  );

  // Fire all GPT body calls in parallel
  const bodyResults = await Promise.allSettled(
    summaries.map((s) => generateStoryDialogue(s, perStory)),
  );

  const allSegments: ScriptSegment[] = [];
  const allLabels: DigestSegmentLabel[] = [];
  const storyLabel = (index: number): DigestSegmentLabel => ({ phase: 'story', storyIndex: index });
  const spokenLinesByStory: string[][] = summaries.map(() => []);

  summaries.forEach((summary, i) => {
    const prev = summaries[i - 1];
    const isNewTopic = summary.topicId && summary.topicId !== prev?.topicId;
    const topicLabel = isNewTopic ? (TOPIC_LABELS[summary.topicId!] ?? summary.topicId!) : undefined;
    const sameSource = !isNewTopic && prev?.feedName === summary.feedName;

    // 1. Topic transition — always injected in code, never delegated to GPT
    if (topicLabel) {
      const line = topicTransitionText(topicLabel, i);
      allSegments.push({ text: line, voice: 'primary' });
      allLabels.push(storyLabel(i));
      spokenLinesByStory[i]?.push(line);
    }

    // 2. Source + title — always injected in code, never delegated to GPT
    const sourcePrefix = sourceIntroText(summary.feedName, sameSource, i);
    const sourceAndTitle = `${sourcePrefix} "${summary.title}".`;
    allSegments.push({ text: sourceAndTitle, voice: 'primary' });
    allLabels.push(storyLabel(i));
    spokenLinesByStory[i]?.push(sourceAndTitle);

    // 3. GPT conversational body
    const body = bodyResults[i];
    if (body.status === 'fulfilled' && body.value.length > 0) {
      for (const segment of body.value) {
        spokenLinesByStory[i]?.push(segment.text);
      }
      for (const _ of body.value) {
        allLabels.push(storyLabel(i));
      }
      allSegments.push(...body.value);
    } else {
      const reason = body.status === 'rejected' ? String(body.reason) : 'empty';
      console.warn('[digestWriter] story body failed, using fallback', { title: summary.title, reason });
      allSegments.push({ text: summary.summary, voice: 'secondary' as const });
      allLabels.push(storyLabel(i));
      spokenLinesByStory[i]?.push(summary.summary);
    }
  });

  return {
    segments: allSegments,
    labels: allLabels,
    spokenTextByStory: spokenLinesByStory.map((lines) => lines.join(' ').trim()),
  };
}

export interface DigestScriptResult {
  segments: ScriptSegment[];
  stories: DigestStory[];
  /** Same length as `segments` — each entry tags the matching TTS chunk for timeline merge. */
  segmentLabels: DigestSegmentLabel[];
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
): Promise<DigestScriptResult> {
  if (summaries.length === 0) {
    return {
      segments: [{ text: "No stories available for today's briefing.", voice: 'primary' }],
      stories: [],
      segmentLabels: [{ phase: 'intro' }],
    };
  }

  let storySegments: ScriptSegment[];
  let storyLabels: DigestSegmentLabel[];
  let spokenTextByStory: string[];
  try {
    const narrator = await generateNarratorScript(summaries);
    storySegments = narrator.segments;
    storyLabels = narrator.labels;
    spokenTextByStory = narrator.spokenTextByStory;
  } catch (err) {
    console.warn('[digestWriter] generateNarratorScript failed, using fallback', { err: String(err) });
    const CONNECTORS = ['First,', 'Next,', 'Also,', 'And finally,'];
    storySegments = [];
    storyLabels = [];
    spokenTextByStory = [];
    summaries.forEach((s, i) => {
      const spokenText = `${CONNECTORS[Math.min(i, CONNECTORS.length - 1)]} ${s.title}. ${s.summary}`.trim();
      storySegments.push({
        text: spokenText,
        voice: 'primary' as const,
      });
      storyLabels.push({ phase: 'story', storyIndex: i });
      spokenTextByStory.push(spokenText);
    });
  }

  const introSegs = buildIntroSegments(date, summaries);
  const introLabels: DigestSegmentLabel[] = introSegs.map(() => ({ phase: 'intro' }));
  const outroLabels: DigestSegmentLabel[] = OUTRO_SEGMENTS.map(() => ({ phase: 'outro' }));

  const segments = [...introSegs, ...storySegments, ...OUTRO_SEGMENTS];
  const segmentLabels = [...introLabels, ...storyLabels, ...outroLabels];

  const stories: DigestStory[] = summaries.map((s, i) => ({
    title: s.title,
    feedName: s.feedName,
    feedId: s.feedId,
    link: s.link,
    estimatedDurationSeconds: estimateWordDuration(`${s.title}. ${s.summary}`),
    spokenText: spokenTextByStory[i] || undefined,
    summary: s.summary,
    topicLabel: s.topicId ? (TOPIC_LABELS[s.topicId] ?? undefined) : undefined,
  }));

  return { segments, stories, segmentLabels };
}

/**
 * Folds per-chunk TTS durations into each story's `[audioStartMs, audioEndMs)` window
 * in the concatenated digest MP3 (same order as `stories`).
 */
export function mergeStoryAudioBounds(
  stories: DigestStory[],
  segmentLabels: DigestSegmentLabel[],
  chunkDurationSeconds: number[],
): DigestStory[] {
  if (
    stories.length === 0 ||
    segmentLabels.length !== chunkDurationSeconds.length ||
    segmentLabels.length === 0
  ) {
    return stories;
  }

  const starts: number[] = stories.map(() => -1);
  const ends: number[] = stories.map(() => 0);

  let cursorMsFloat = 0;
  for (let i = 0; i < segmentLabels.length; i++) {
    const durSec = chunkDurationSeconds[i] ?? 0;
    const durMs = Math.max(0, durSec * 1000);
    const label = segmentLabels[i]!;

    if (label.phase === 'story') {
      const idx = label.storyIndex;
      if (idx >= 0 && idx < stories.length) {
        if (starts[idx]! < 0) starts[idx] = Math.round(cursorMsFloat);
        ends[idx] = Math.round(cursorMsFloat + durMs);
      }
    }
    cursorMsFloat += durMs;
  }

  return stories.map((s, idx) => {
    if (starts[idx]! < 0) return { ...s };
    return {
      ...s,
      audioStartMs: starts[idx],
      audioEndMs: ends[idx],
    };
  });
}
