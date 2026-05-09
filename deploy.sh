#!/usr/bin/env bash
set -euo pipefail

# Load root .env safely.
# We avoid `export $(...)` because it breaks on long/special values.
for env_file in .env .env.local .env.development .env.production; do
  if [[ -f "${env_file}" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "${env_file}"
    set +a
  fi
done

# CDK expects GOOGLE_CLIENT_ID; .env stores it as GOOGLE_WEB_CLIENT_ID
GOOGLE_CLIENT_ID="${GOOGLE_CLIENT_ID:-${GOOGLE_WEB_CLIENT_ID:-}}"
if [[ -z "${GOOGLE_CLIENT_ID}" ]]; then
  echo "Missing required env var: GOOGLE_CLIENT_ID (or legacy GOOGLE_WEB_CLIENT_ID)"
  exit 1
fi
export GOOGLE_CLIENT_ID

APNS_TOKEN_KEY_ID="${APNS_TOKEN_KEY_ID:-${ApnsTokenKeyId:-${APNS_KEY_ID:-${APPLE_APNS_KEY_ID:-}}}}"
APNS_TOKEN_TEAM_ID="${APNS_TOKEN_TEAM_ID:-${ApnsTokenTeamId:-${APPLE_TEAM_ID:-${APNS_TEAM_ID:-}}}}"
APNS_TOKEN_BUNDLE_ID="${APNS_TOKEN_BUNDLE_ID:-${ApnsTokenBundleId:-${IOS_BUNDLE_ID:-${APPLE_CLIENT_ID:-}}}}"
APNS_TOKEN_PRIVATE_KEY="${APNS_TOKEN_PRIVATE_KEY:-${ApnsTokenPrivateKey:-${APNS_PRIVATE_KEY:-${APNS_AUTH_KEY:-}}}}"
APNS_PLATFORM="${APNS_PLATFORM:-${ApnsPlatform:-APNS_SANDBOX}}"
APNS_PLATFORM_APPLICATION_ARN="${APNS_PLATFORM_APPLICATION_ARN:-${ApnsPlatformApplicationArn:-${SNS_PLATFORM_APPLICATION_ARN:-}}}"

if [[ -z "${APNS_PLATFORM_APPLICATION_ARN}" ]]; then
  echo "Missing required env var: APNS_PLATFORM_APPLICATION_ARN (or legacy ApnsPlatformApplicationArn / SNS_PLATFORM_APPLICATION_ARN)"
  exit 1
fi

REVENUECAT_WEBHOOK_SECRET="${REVENUECAT_WEBHOOK_SECRET:-CHANGEME}"

cd cdk
# Drop cached synth/output so Lambdas are rebundled and deploy is never skipped as "unchanged"
rm -rf cdk.out
npx cdk deploy --profile rubens \
  --parameters ApnsPlatformApplicationArn="${APNS_PLATFORM_APPLICATION_ARN}" \
  --parameters RevenueCatWebhookSecret="${REVENUECAT_WEBHOOK_SECRET}" \
  "$@"
