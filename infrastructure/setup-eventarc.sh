#!/bin/bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-$(gcloud config get-value project 2>/dev/null || true)}"
PROJECT_ID="${PROJECT_ID//[[:space:]]/}"
if [[ -z "$PROJECT_ID" ]]; then
    echo "ERROR: Set PROJECT_ID or run 'gcloud config set project <project-id>' first" >&2
    exit 1
fi

EVENTARC_LOCATION="${EVENTARC_LOCATION:-us}"
RUN_REGION="${RUN_REGION:-us-central1}"
AUDIO_BUCKET="graph-fil-a-audio"

# Grant the Eventarc Service Agent the necessary permissions to invoke the Cloud Run service
gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:sa-transcription-svc@$PROJECT_ID.iam.gserviceaccount.com" \
    --role="roles/run.invoker"

#Grant the GCS service agent permission to publish to Pub/Sub
#Eventarc uses Pub/Sub to trigger the Cloud Run service when a new file is uploaded to the GCS bucket
GCS_SA=$(gsutil kms serviceaccount -p $PROJECT_ID)
gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:$GCS_SA" \
    --role="roles/pubsub.publisher"

#Create the Eventarc trigger
gcloud eventarc triggers create transcription-gcs-trigger \
    --location="$EVENTARC_LOCATION" \
    --destination-run-service=transcription-service \
    --destination-run-region="$RUN_REGION" \
    --event-filters="type=google.cloud.storage.object.v1.finalized" \
    --event-filters="bucket=$AUDIO_BUCKET" \
    --service-account="sa-transcription-svc@$PROJECT_ID.iam.gserviceaccount.com"