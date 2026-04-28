import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as eventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import { Construct } from 'constructs';
import * as path from 'path';

export interface PodcastifyStackProps extends cdk.StackProps {
  googleClientId: string;
  appleClientId: string;
  openAiApiKey: string;
}

export class PodcastifyStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: PodcastifyStackProps) {
    super(scope, id, props);

    const { googleClientId, appleClientId, openAiApiKey } = props;

    // ── S3: job storage ──────────────────────────────────────────────────────
    const jobsBucket = new s3.Bucket(this, 'JobsBucket', {
      bucketName: `podcastify-jobs-${this.account}`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      lifecycleRules: [
        {
          prefix: 'jobs/',
          expiration: cdk.Duration.days(1),
        },
      ],
      cors: [
        {
          allowedOrigins: ['*'],
          allowedMethods: [s3.HttpMethods.GET],
          allowedHeaders: ['*'],
          maxAge: 3600,
        },
      ],
    });

    // ── SQS: job queue ───────────────────────────────────────────────────────
    const jobQueue = new sqs.Queue(this, 'JobQueue', {
      queueName: 'podcastify-jobs',
      // Visibility timeout must exceed worker Lambda timeout
      visibilityTimeout: cdk.Duration.minutes(6),
      retentionPeriod: cdk.Duration.hours(1),
    });

    // Shared Lambda environment for all functions
    const sharedEnv = {
      S3_BUCKET: jobsBucket.bucketName,
      GOOGLE_CLIENT_ID: googleClientId,
      APPLE_CLIENT_ID: appleClientId,
    };

    const lambdaRoot = path.join(__dirname, '../../lambdas');
    const projectRoot = lambdaRoot;
    const depsLockFilePath = path.join(projectRoot, 'package-lock.json');

    // Shared bundling for dispatcher + status (small, no native deps)
    const bundling: lambdaNode.BundlingOptions = {
      sourceMap: false,
      minify: false,
      target: 'node20',
    };

    // Worker bundling: jsdom and readability use require.resolve / native paths that
    // esbuild can't inline safely. Mark them as nodeModules so CDK installs them as
    // real packages in the Lambda zip rather than bundling them. Keeps the worker
    // bundle small (~1 MB) and avoids the xhr-sync-worker.js warning.
    const workerBundling: lambdaNode.BundlingOptions = {
      ...bundling,
      nodeModules: ['jsdom', '@mozilla/readability'],
    };

    // ── Lambda: Dispatcher ────────────────────────────────────────────────────
    const dispatcher = new lambdaNode.NodejsFunction(this, 'Dispatcher', {
      functionName: 'podcastify-dispatcher',
      entry: path.join(lambdaRoot, 'dispatcher/handler.ts'),
      projectRoot,
      depsLockFilePath,
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 128,
      timeout: cdk.Duration.seconds(10),
      bundling,
      environment: {
        ...sharedEnv,
        SQS_QUEUE_URL: jobQueue.queueUrl,
      },
    });

    jobsBucket.grantWrite(dispatcher);
    jobQueue.grantSendMessages(dispatcher);

    // ── Lambda: Status ────────────────────────────────────────────────────────
    const statusFn = new lambdaNode.NodejsFunction(this, 'Status', {
      functionName: 'podcastify-status',
      entry: path.join(lambdaRoot, 'status/handler.ts'),
      projectRoot,
      depsLockFilePath,
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 128,
      timeout: cdk.Duration.seconds(10),
      bundling,
      environment: sharedEnv,
    });

    jobsBucket.grantRead(statusFn);
    // Also needs presigned URL generation (grantRead includes s3:GetObject which is enough)

    // ── Lambda: Worker ────────────────────────────────────────────────────────
    const worker = new lambdaNode.NodejsFunction(this, 'Worker', {
      functionName: 'podcastify-worker',
      entry: path.join(lambdaRoot, 'worker/handler.ts'),
      projectRoot,
      depsLockFilePath,
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 1024,
      timeout: cdk.Duration.minutes(5),
      bundling: workerBundling,
      environment: {
        ...sharedEnv,
        OPENAI_API_KEY: openAiApiKey,
      },
    });

    jobsBucket.grantReadWrite(worker);

    // SQS → Worker trigger (batch size 1 so each job gets its own invocation)
    worker.addEventSource(
      new eventSources.SqsEventSource(jobQueue, {
        batchSize: 1,
        reportBatchItemFailures: true,
      }),
    );

    // ── API Gateway HTTP API ──────────────────────────────────────────────────
    const api = new apigwv2.HttpApi(this, 'Api', {
      apiName: 'podcastify-api',
      corsPreflight: {
        allowOrigins: ['*'],
        allowMethods: [apigwv2.CorsHttpMethod.GET, apigwv2.CorsHttpMethod.POST, apigwv2.CorsHttpMethod.OPTIONS],
        allowHeaders: ['Authorization', 'Content-Type'],
      },
    });

    api.addRoutes({
      path: '/jobs',
      methods: [apigwv2.HttpMethod.POST],
      integration: new integrations.HttpLambdaIntegration('DispatcherIntegration', dispatcher),
    });

    api.addRoutes({
      path: '/jobs/{jobId}',
      methods: [apigwv2.HttpMethod.GET],
      integration: new integrations.HttpLambdaIntegration('StatusIntegration', statusFn),
    });

    // ── Outputs ───────────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'ApiBaseUrl', {
      description: 'Set as EXPO_PUBLIC_API_BASE in .env',
      value: api.apiEndpoint,
    });

    new cdk.CfnOutput(this, 'JobsBucketName', {
      value: jobsBucket.bucketName,
    });

    new cdk.CfnOutput(this, 'JobQueueUrl', {
      value: jobQueue.queueUrl,
    });
  }
}
