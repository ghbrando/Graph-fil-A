#!/usr/bin/env bash
# setup-apis.sh
# Enables all GCP APIs required by Graph-fil-A.
# Run this first, before any other setup script.
#
# Usage:
#   export PROJECT_ID=your-gcp-project-id
#   bash infrastructure/iam/setup-apis.sh

set -euo pipefail

PROJECT_ID="${PROJECT_ID:?ERROR: Set PROJECT_ID before running this script}"

echo "==> Setting active project to $PROJECT_ID"
gcloud config set project "$PROJECT_ID"

echo "==> Enabling required APIs"
gcloud services enable \
  iam.googleapis.com \
  iamcredentials.googleapis.com \
  cloudresourcemanager.googleapis.com \
  run.googleapis.com \
  cloudfunctions.googleapis.com \
  storage.googleapis.com \
  pubsub.googleapis.com \
  firestore.googleapis.com \
  speech.googleapis.com \
  aiplatform.googleapis.com \
  apigateway.googleapis.com \
  cloudscheduler.googleapis.com \
  secretmanager.googleapis.com \
  --project="$PROJECT_ID"

echo "==> All APIs enabled."
