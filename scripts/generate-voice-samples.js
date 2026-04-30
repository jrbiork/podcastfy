#!/usr/bin/env node
/**
 * One-time setup: generates a short MP3 preview for each OpenAI TTS voice
 * and uploads them to S3 as public objects under voice-previews/{voice}.mp3.
 *
 * Usage:
 *   node scripts/generate-voice-samples.js
 *
 * Prerequisites:
 *   - OPENAI_API_KEY in .env (or in environment)
 *   - AWS credentials configured (aws configure or AWS_* env vars)
 *   - S3_BUCKET env var, or set BUCKET below manually
 *   - Bucket must allow public-read ACLs (disable "Block all public access" in S3 console first)
 */

const path = require('path');
const root = path.resolve(__dirname, '..');

require(path.join(root, 'node_modules/dotenv')).config({ path: path.join(root, '.env') });

const { OpenAI }           = require(path.join(root, 'lambdas/node_modules/openai'));
const { S3Client, PutObjectCommand, PutBucketPolicyCommand, PutPublicAccessBlockCommand } = require(path.join(root, 'lambdas/node_modules/@aws-sdk/client-s3'));

const SAMPLE_TEXT = "Hi there! I'm your personal audio assistant, ready to turn any content into audio for you.";
const VOICES      = ['alloy', 'echo', 'fable', 'nova', 'onyx', 'shimmer'];
const BUCKET      = process.env.S3_BUCKET || (() => { throw new Error('Set S3_BUCKET env var (e.g. podcastify-jobs-123456789)'); })();
const REGION      = process.env.AWS_REGION || 'us-east-1';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const s3     = new S3Client({ region: REGION });

async function main() {
  console.log(`Bucket : ${BUCKET}`);
  console.log(`Region : ${REGION}\n`);

  // Allow public bucket policies (only BlockPublicPolicy needs to be lifted;
  // ACLs stay disabled since Object Ownership is Bucket owner enforced).
  process.stdout.write('Allowing public bucket policy… ');
  await s3.send(new PutPublicAccessBlockCommand({
    Bucket: BUCKET,
    PublicAccessBlockConfiguration: {
      BlockPublicAcls:      true,   // keep ACLs blocked
      IgnorePublicAcls:     true,
      BlockPublicPolicy:    false,  // allow the policy below
      RestrictPublicBuckets: false,
    },
  }));
  console.log('✓');

  // Apply a bucket policy that makes voice-previews/* publicly readable.
  const policy = JSON.stringify({
    Version: '2012-10-17',
    Statement: [
      {
        Sid: 'PublicReadVoicePreviews',
        Effect: 'Allow',
        Principal: '*',
        Action: 's3:GetObject',
        Resource: `arn:aws:s3:::${BUCKET}/voice-previews/*`,
      },
    ],
  });

  process.stdout.write('Setting bucket policy for voice-previews/*… ');
  await s3.send(new PutBucketPolicyCommand({ Bucket: BUCKET, Policy: policy }));
  console.log('✓');
  console.log();

  for (const voice of VOICES) {
    process.stdout.write(`Generating ${voice}… `);

    const response = await openai.audio.speech.create({
      model: 'tts-1',
      voice,
      input: SAMPLE_TEXT,
      response_format: 'mp3',
    });
    const buffer = Buffer.from(await response.arrayBuffer());

    const key = `voice-previews/${voice}.mp3`;
    await s3.send(new PutObjectCommand({
      Bucket:       BUCKET,
      Key:          key,
      Body:         buffer,
      ContentType:  'audio/mpeg',
      CacheControl: 'public, max-age=31536000, immutable',
    }));

    const url = `https://${BUCKET}.s3.${REGION}.amazonaws.com/${key}`;
    console.log(`✓  ${url}`);
  }

  console.log('\nAll done!');
  console.log(`Set VOICE_PREVIEWS_BASE = https://${BUCKET}.s3.${REGION}.amazonaws.com/voice-previews`);
  console.log('then update that constant in src/components/VoicePickerModal.tsx');
}

main().catch((e) => { console.error(e.message); process.exit(1); });
