#!/usr/bin/env bash
set -euo pipefail

# Load root .env, skip EXPO_PUBLIC_ vars (frontend only) and comments
export $(grep -v '^#\|^EXPO_PUBLIC' .env | grep '=' | xargs)

# CDK expects GOOGLE_CLIENT_ID; .env stores it as GOOGLE_WEB_CLIENT_ID
export GOOGLE_CLIENT_ID="${GOOGLE_WEB_CLIENT_ID}"

cd cdk && npx cdk deploy --profile rubens "$@"
