import { SQSHandler, SQSRecord } from 'aws-lambda';
import { extractArticle, ScraperError } from './scraper';
import { generatePodcastScript, buildTtsScript } from './scriptWriter';
import { generateAudio, estimateDurationSeconds } from './tts';
import { writeStatus, uploadAudio, downloadBuffer } from '../shared/s3';
import pdfParse from 'pdf-parse';

interface JobMessage {
  jobId: string;
  mode: 'podcast' | 'tts';
  url?: string;
  text?: string;
  title?: string;
  pdfKey?: string;
}

async function processJob(msg: JobMessage): Promise<void> {
  const { jobId, mode, url, text, title, pdfKey } = msg;
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
      const parsed = await pdfParse(pdfBuffer);
      articleText = parsed.text.replace(/\s+/g, ' ').trim().slice(0, 12_000);
      articleTitle = title || 'PDF Episode';
      console.log('[worker] pdf parsed', { jobId, title: articleTitle, textLength: articleText.length });
    } catch (e) {
      console.error('[worker] pdf parse failed', { jobId, error: (e as Error).message });
      throw new Error('scrape_failed');
    }
  } else if (text) {
    articleText = text;
    articleTitle = title ?? 'Untitled';
    console.log('[worker] using provided text', { jobId, title: articleTitle, textLength: articleText.length });
  } else {
    throw new Error('no_input');
  }

  await writeStatus(jobId, { status: 'scripting' });
  console.log('[worker] status -> scripting', { jobId });

  // Step 2: generate script
  const script =
    mode === 'podcast'
      ? await generatePodcastScript({ title: articleTitle, text: articleText })
      : buildTtsScript(articleText);
  console.log('[worker] script ready', { jobId, scriptLength: script.length, mode });

  await writeStatus(jobId, { status: 'generating_audio' });
  console.log('[worker] status -> generating_audio', { jobId });

  // Step 3: generate audio
  const audioBuffer = await generateAudio(script);
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
