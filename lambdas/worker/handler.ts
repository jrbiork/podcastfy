import { SQSHandler, SQSRecord } from 'aws-lambda';
import { extractArticle, ScraperError } from './scraper';
import {
  extractCoreContentForSpeech,
  generatePodcastScript,
  buildTtsScript,
  generateContextTitle,
} from './scriptWriter';
import { generateAudio, estimateDurationSeconds } from './tts';
import { translateText } from './translator';
import { writeStatus, uploadAudio, downloadBuffer } from '../shared/s3';

// pdfjs-dist (bundled inside pdf-parse) calls `new DOMMatrix()` at module-load
// time, which doesn't exist in Node.js — crashing the Lambda cold start.
// Stub it out before the lazy import below runs.
if (typeof (globalThis as any).DOMMatrix === 'undefined') {
  (globalThis as any).DOMMatrix = class DOMMatrix {
    constructor(_init?: string | number[]) {}
    multiply() { return this; }
    translate() { return this; }
    scale() { return this; }
    rotate() { return this; }
    inverse() { return this; }
    transformPoint(p: { x: number; y: number }) { return p; }
    toString() { return 'matrix(1,0,0,1,0,0)'; }
  };
}

interface JobMessage {
  jobId: string;
  mode: 'podcast' | 'tts';
  url?: string;
  text?: string;
  title?: string;
  pdfKey?: string;
  voice?: string;
  language?: string;
}

function normalizeInputTitle(value?: string): string {
  return (value ?? '')
    .replace(/\.[a-z0-9]{1,5}$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function shouldGenerateAiTitle(mode: JobMessage['mode'], title: string, hasPdf: boolean): boolean {
  if (mode !== 'tts') return false;
  const t = title.trim();
  if (!t) return true;
  if (/^untitled$/i.test(t)) return true;
  if (/^pdf episode$/i.test(t)) return true;
  // Typical uploaded filenames (uuid/random tokens) are not useful as episode titles.
  if (hasPdf && /^[a-f0-9-]{16,}$/i.test(t.replace(/\s+/g, ''))) return true;
  return false;
}

async function processJob(msg: JobMessage): Promise<void> {
  const { jobId, mode, url, text, title, pdfKey, voice, language } = msg;
  console.log('[worker] job start', { jobId, mode, hasUrl: Boolean(url), textLength: text?.length ?? 0, hasPdf: Boolean(pdfKey), title: title ?? null });

  await writeStatus(jobId, { status: 'processing' });
  console.log('[worker] status -> processing', { jobId });

  // Step 1: get article content
  let articleTitle = title ?? 'Untitled';
  let articleText = '';
  let thumbnailUrl: string | null = null;

  if (url) {
    console.log('[worker] extracting article from url', { jobId, url });
    const article = await extractArticle(url);
    articleTitle = article.title;
    articleText = article.text;
    thumbnailUrl = article.thumbnailUrl;
    console.log('[worker] article extracted', { jobId, title: articleTitle, textLength: articleText.length, hasThumbnail: Boolean(thumbnailUrl) });
  } else if (pdfKey) {
    console.log('[worker] parsing pdf from s3', { jobId, pdfKey });
    try {
      const pdfBuffer = await downloadBuffer(pdfKey);
      // pdf-parse v2 uses a class-based API: new PDFParse({ data }).getText()
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { PDFParse } = require('pdf-parse') as {
        PDFParse: new (opts: { data: Buffer | Uint8Array }) => {
          getText(): Promise<{ text: string }>;
          destroy(): Promise<void>;
        };
      };
      const parser = new PDFParse({ data: pdfBuffer });
      const parsed = await parser.getText().finally(() => parser.destroy());
      articleText = parsed.text.replace(/\s+/g, ' ').trim().slice(0, 12_000);
      articleTitle = normalizeInputTitle(title) || 'PDF Episode';
      console.log('[worker] pdf parsed', { jobId, title: articleTitle, textLength: articleText.length });
    } catch (e) {
      console.error('[worker] pdf parse failed', { jobId, error: (e as Error).message });
      throw new Error('scrape_failed');
    }
  } else if (text) {
    articleText = text;
    articleTitle = normalizeInputTitle(title) || 'Untitled';
    console.log('[worker] using provided text', { jobId, title: articleTitle, textLength: articleText.length });
  } else {
    throw new Error('no_input');
  }

  if (shouldGenerateAiTitle(mode, articleTitle, Boolean(pdfKey))) {
    try {
      const fallbackTitle = pdfKey ? 'PDF Episode' : 'Untitled Episode';
      articleTitle = await generateContextTitle(articleText, fallbackTitle);
      console.log('[worker] ai title generated', { jobId, title: articleTitle });
    } catch (e) {
      console.warn('[worker] ai title generation failed, using fallback', {
        jobId,
        error: (e as Error).message,
      });
      if (!articleTitle.trim()) {
        articleTitle = pdfKey ? 'PDF Episode' : 'Untitled Episode';
      }
    }
  }

  await writeStatus(jobId, { status: 'scripting' });
  console.log('[worker] status -> scripting', { jobId });

  const textBeforeExtract = articleText.length;
  articleText = await extractCoreContentForSpeech(articleTitle, articleText);
  console.log('[worker] core content extracted', {
    jobId,
    beforeChars: textBeforeExtract,
    afterChars: articleText.length,
  });

  // Translate content if a non-English language was requested for TTS
  if (mode === 'tts' && language && language !== 'en') {
    try {
      articleText = await translateText(articleText, language);
      console.log('[worker] text translated', { jobId, language, textLength: articleText.length });
    } catch (e) {
      console.warn('[worker] translation failed, using original', { jobId, error: (e as Error).message });
    }
  }

  // Step 2: generate script
  const script =
    mode === 'podcast'
      ? await generatePodcastScript({ title: articleTitle, text: articleText })
      : buildTtsScript(articleText);
  console.log('[worker] script ready', { jobId, scriptLength: script.length, mode });

  await writeStatus(jobId, { status: 'generating_audio' });
  console.log('[worker] status -> generating_audio', { jobId });

  // Step 3: generate audio
  const audioBuffer = await generateAudio(script, mode === 'tts' ? voice : undefined);
  const durationSeconds = estimateDurationSeconds(script);
  console.log('[worker] audio generated', { jobId, bytes: audioBuffer.byteLength, durationSeconds });

  // Step 4: upload to S3
  await uploadAudio(jobId, audioBuffer);
  console.log('[worker] audio uploaded', { jobId });

  await writeStatus(jobId, {
    status: 'done',
    title: articleTitle,
    thumbnailUrl,
    durationSeconds,
    mode,
  });
  console.log('[worker] status -> done', { jobId, mode, durationSeconds });
}

export const handler: SQSHandler = async (event) => {
  console.log('[worker] batch received', { records: event.Records.length });
  for (const record of event.Records) {
    await processRecord(record);
  }
};

async function processRecord(record: SQSRecord): Promise<void> {
  let msg: JobMessage;
  try {
    msg = JSON.parse(record.body) as JobMessage;
  } catch {
    console.error('[worker] Failed to parse SQS message:', record.body);
    return;
  }

  const { jobId } = msg;

  try {
    await processJob(msg);
  } catch (e: unknown) {
    let errorCode = 'unknown_error';

    if (e instanceof ScraperError) {
      errorCode = e.code;
    } else if (e instanceof Error) {
      errorCode = e.message;
    }

    console.error(`[worker] Job ${jobId} failed:`, errorCode, e);

    try {
      await writeStatus(jobId, { status: 'error', error: errorCode });
    } catch {
      console.error(`[worker] Failed to write error status for job ${jobId}`);
    }
  }
}
