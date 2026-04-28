#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { PodcastifyStack } from '../lib/podcastify-stack';

const app = new cdk.App();

new PodcastifyStack(app, 'PodcastifyStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
  },

  // Pass secrets via environment variables — never hardcode these
  googleClientId: requireEnv('GOOGLE_CLIENT_ID'),
  appleClientId: requireEnv('APPLE_CLIENT_ID'),
  openAiApiKey: requireEnv('OPENAI_API_KEY'),
});

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required environment variable: ${name}`);
  return val;
}
