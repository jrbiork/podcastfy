import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as eventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import * as path from 'path';

export interface PodcastifyStackProps extends cdk.StackProps {
  googleClientId: string;        // Web client ID
  googleIosClientId?: string;    // iOS client ID (token aud on iOS)
  appleClientId: string;
  openAiApiKey: string;
}

export class PodcastifyStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: PodcastifyStackProps) {
    super(scope, id, props);

    const { googleClientId, googleIosClientId, appleClientId, openAiApiKey } = props;

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
        {
          prefix: 'digests/',
          expiration: cdk.Duration.days(7),
        },
      ],
      cors: [
        {
          allowedOrigins: ['*'],
          allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.PUT],
          allowedHeaders: ['*'],
          maxAge: 3600,
        },
      ],
    });

    // ── SQS: job queue ───────────────────────────────────────────────────────
    const jobQueue = new sqs.Queue(this, 'JobQueue', {
      queueName: 'podcastify-jobs',
      // Visibility timeout must exceed worker Lambda timeout
      visibilityTimeout: cdk.Duration.minutes(11),
      retentionPeriod: cdk.Duration.hours(1),
    });

    // ── SQS: digest queue ────────────────────────────────────────────────────
    const digestQueue = new sqs.Queue(this, 'DigestQueue', {
      queueName: 'podcastify-digests',
      visibilityTimeout: cdk.Duration.minutes(11),
      retentionPeriod: cdk.Duration.hours(2),
    });

    // Shared Lambda environment for all functions
    const sharedEnv: Record<string, string> = {
      S3_BUCKET: jobsBucket.bucketName,
      GOOGLE_CLIENT_ID: googleClientId,
      APPLE_CLIENT_ID: appleClientId,
      ...(googleIosClientId ? { GOOGLE_IOS_CLIENT_ID: googleIosClientId } : {}),
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
      nodeModules: ['jsdom', '@mozilla/readability', 'pdf-parse'],
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
      memorySize: 512,
      timeout: cdk.Duration.seconds(30),
      bundling,
      environment: {
        ...sharedEnv,
        SQS_QUEUE_URL: jobQueue.queueUrl,
      },
    });

    jobsBucket.grantReadWrite(dispatcher);
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
      memorySize: 2048,
      timeout: cdk.Duration.minutes(10),
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
      path: '/jobs/pdf/presign',
      methods: [apigwv2.HttpMethod.POST],
      integration: new integrations.HttpLambdaIntegration('DispatcherPdfPresignIntegration', dispatcher),
    });

    api.addRoutes({
      path: '/jobs/pdf/finalize',
      methods: [apigwv2.HttpMethod.POST],
      integration: new integrations.HttpLambdaIntegration('DispatcherPdfFinalizeIntegration', dispatcher),
    });

    api.addRoutes({
      path: '/jobs/{jobId}',
      methods: [apigwv2.HttpMethod.GET],
      integration: new integrations.HttpLambdaIntegration('StatusIntegration', statusFn),
    });

    // ── Lambda: Digest Dispatcher ─────────────────────────────────────────────
    const digestDispatcher = new lambdaNode.NodejsFunction(this, 'DigestDispatcher', {
      functionName: 'podcastify-digest-dispatcher',
      entry: path.join(lambdaRoot, 'digest-dispatcher/handler.ts'),
      projectRoot,
      depsLockFilePath,
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 512,
      timeout: cdk.Duration.seconds(30),
      bundling,
      environment: {
        ...sharedEnv,
        DIGEST_QUEUE_URL: digestQueue.queueUrl,
      },
    });

    jobsBucket.grantReadWrite(digestDispatcher);
    digestQueue.grantSendMessages(digestDispatcher);

    // ── Lambda: Digest Worker ─────────────────────────────────────────────────
    const digestWorker = new lambdaNode.NodejsFunction(this, 'DigestWorker', {
      functionName: 'podcastify-digest-worker',
      entry: path.join(lambdaRoot, 'digest-worker/handler.ts'),
      projectRoot,
      depsLockFilePath,
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 2048,
      timeout: cdk.Duration.minutes(10),
      bundling: workerBundling,
      environment: {
        ...sharedEnv,
        OPENAI_API_KEY: openAiApiKey,
      },
    });

    jobsBucket.grantReadWrite(digestWorker);

    digestWorker.addEventSource(
      new eventSources.SqsEventSource(digestQueue, {
        batchSize: 1,
        reportBatchItemFailures: true,
      }),
    );

    // ── API Gateway: digest routes ────────────────────────────────────────────
    const digestIntegration = new integrations.HttpLambdaIntegration(
      'DigestDispatcherIntegration',
      digestDispatcher,
    );

    api.addRoutes({
      path: '/digests',
      methods: [apigwv2.HttpMethod.POST, apigwv2.HttpMethod.DELETE],
      integration: digestIntegration,
    });

    api.addRoutes({
      path: '/digests/latest',
      methods: [apigwv2.HttpMethod.GET],
      integration: digestIntegration,
    });

    // ── DynamoDB: user preferences ────────────────────────────────────────────
    const usersTable = new dynamodb.Table(this, 'UsersTable', {
      tableName: 'podcastify-users',
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // ── IAM: role EventBridge Scheduler uses to invoke the trigger Lambda ─────
    const schedulerExecutionRole = new iam.Role(this, 'SchedulerExecutionRole', {
      roleName: 'podcastify-scheduler-execution',
      assumedBy: new iam.ServicePrincipal('scheduler.amazonaws.com'),
    });

    // ── EventBridge Scheduler group ───────────────────────────────────────────
    const scheduleGroupName = 'podcastify-digest-schedules';
    new cdk.CfnResource(this, 'DigestScheduleGroup', {
      type: 'AWS::Scheduler::ScheduleGroup',
      properties: { Name: scheduleGroupName },
    });

    // ── Lambda: Digest Scheduler Trigger ──────────────────────────────────────
    const digestSchedulerTrigger = new lambdaNode.NodejsFunction(this, 'DigestSchedulerTrigger', {
      functionName: 'podcastify-digest-scheduler-trigger',
      entry: path.join(lambdaRoot, 'digest-scheduler-trigger/handler.ts'),
      projectRoot,
      depsLockFilePath,
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      timeout: cdk.Duration.seconds(30),
      bundling,
      environment: {
        ...sharedEnv,
        USERS_TABLE: usersTable.tableName,
        DIGEST_QUEUE_URL: digestQueue.queueUrl,
      },
    });

    usersTable.grantReadData(digestSchedulerTrigger);
    digestQueue.grantSendMessages(digestSchedulerTrigger);
    jobsBucket.grantRead(digestSchedulerTrigger); // for readDigestStatus idempotency check

    // Grant the scheduler execution role permission to invoke this Lambda
    schedulerExecutionRole.addToPolicy(new iam.PolicyStatement({
      actions: ['lambda:InvokeFunction'],
      resources: [digestSchedulerTrigger.functionArn],
    }));

    // ── Lambda: User Preferences ──────────────────────────────────────────────
    const userPreferences = new lambdaNode.NodejsFunction(this, 'UserPreferences', {
      functionName: 'podcastify-user-preferences',
      entry: path.join(lambdaRoot, 'user-preferences/handler.ts'),
      projectRoot,
      depsLockFilePath,
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      timeout: cdk.Duration.seconds(30),
      bundling,
      environment: {
        ...sharedEnv,
        USERS_TABLE: usersTable.tableName,
        TRIGGER_LAMBDA_ARN: digestSchedulerTrigger.functionArn,
        SCHEDULER_ROLE_ARN: schedulerExecutionRole.roleArn,
        SCHEDULE_GROUP: scheduleGroupName,
      },
    });

    usersTable.grantReadWriteData(userPreferences);
    userPreferences.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'scheduler:CreateSchedule',
        'scheduler:UpdateSchedule',
        'scheduler:GetSchedule',
      ],
      resources: [`arn:aws:scheduler:${this.region}:${this.account}:schedule/${scheduleGroupName}/*`],
    }));
    userPreferences.addToRolePolicy(new iam.PolicyStatement({
      actions: ['iam:PassRole'],
      resources: [schedulerExecutionRole.roleArn],
    }));

    // ── API Gateway: user preferences routes ──────────────────────────────────
    const prefsIntegration = new integrations.HttpLambdaIntegration(
      'UserPreferencesIntegration',
      userPreferences,
    );
    api.addRoutes({
      path: '/users/preferences',
      methods: [apigwv2.HttpMethod.GET, apigwv2.HttpMethod.POST],
      integration: prefsIntegration,
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

    new cdk.CfnOutput(this, 'DigestQueueUrl', {
      value: digestQueue.queueUrl,
    });
  }
}
