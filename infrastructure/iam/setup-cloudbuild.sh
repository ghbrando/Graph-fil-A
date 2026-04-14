#!/usr/bin/env bash
# setup-cloudbuild.sh
# Grants Cloud Build service account the necessary permissions to deploy Cloud Functions and Cloud Run services.
#
# Prerequisites:
#   - gcloud CLI installed and authenticated
#   - PROJECT_ID set
#
# Usage:
#   export PROJECT_ID=your-gcp-project-id
#   bash infrastructure/iam/setup-cloudbuild.sh

set -euo pipefail

PROJECT_ID="${PROJECT_ID:?ERROR: Set PROJECT_ID before running this script}"

echo "==> Using project: $PROJECT_ID"
gcloud config set project "$PROJECT_ID"

# Get the Cloud Build service account
CLOUDBUILD_SA="$(gcloud projects describe ${PROJECT_ID} --format='value(projectNumber)')@cloudbuild.gserviceaccount.com"

echo "==> Granting permissions to Cloud Build service account: $CLOUDBUILD_SA"

# Permission to deploy Cloud Functions
echo "    - Granting cloudfunctions.admin..."
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${CLOUDBUILD_SA}" \
  --role="roles/cloudfunctions.admin" \
  --condition=None \
  --quiet

# Permission to manage Cloud Run services
echo "    - Granting run.admin..."
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${CLOUDBUILD_SA}" \
  --role="roles/run.admin" \
  --condition=None \
  --quiet

# Permission to act as service accounts (required for passing SA to functions)
echo "    - Granting iam.serviceAccountUser..."
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${CLOUDBUILD_SA}" \
  --role="roles/iam.serviceAccountUser" \
  --condition=None \
  --quiet

# Permission to access Cloud Build artifacts
echo "    - Granting artifactregistry.writer..."
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${CLOUDBUILD_SA}" \
  --role="roles/artifactregistry.writer" \
  --condition=None \
  --quiet

echo ""
echo "==> Done. Cloud Build service account now has deployment permissions."
