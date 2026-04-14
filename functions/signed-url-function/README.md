# Signed URL Cloud Function

Generates time-limited, credential-free GCS upload URLs for browser-direct audio uploads.

## Overview

This function generates signed URLs that allow browsers to upload audio files directly to Cloud Storage without routing large payloads through the API Gateway.

**Security properties:**
- URL expires after 15 minutes
- Scoped to a specific session path: `sessions/{sessionId}/audio.mp3`
- Only allows `PUT` (upload), not `GET` or `DELETE`
- Content-Type locked to `audio/mpeg`
- No GCS credentials exposed to client

## Prerequisites

1. Service account `sa-upload-fn` created with `storage.objectCreator` role on the audio bucket
2. Service account key stored in Secret Manager under `sa-upload-fn-key`
3. Audio GCS bucket created: `{PROJECT_ID}-audio`

## Environment Variables

Set these when deploying:

```bash
GCP_PROJECT=graph-fil-a           # GCP project ID
GCS_BUCKET=graph-fil-a-audio      # GCS bucket name
SECRET_ID=sa-upload-fn-key        # Secret Manager secret ID
SIGNED_URL_TTL_MINUTES=15         # URL expiration time (default: 15)
```

## API

### Request

```http
POST /sessions/upload-url
Authorization: Bearer <Firebase JWT>
Content-Type: application/json

{
  "sessionId": "abc123"
}
```

### Response

```json
{
  "url": "https://storage.googleapis.com/graph-fil-a-audio/sessions/abc123/audio.mp3?X-Goog-Algorithm=...",
  "sessionId": "abc123",
  "gcsPath": "sessions/abc123/audio.mp3"
}
```

### Error Responses

- `400` — Invalid sessionId
- `401` — Unauthorized (missing JWT)
- `405` — Wrong HTTP method
- `500` — Server error (Secret Manager, GCS, etc.)

## Deployment

### 1. Build locally

```bash
cd functions/signed-url-function
npm install
npm run build
```

### 2. Store service account key in Secret Manager

```bash
gcloud secrets create sa-upload-fn-key \
  --data-file=/path/to/sa-upload-fn-key.json \
  --project=graph-fil-a
```

Or update existing secret:

```bash
gcloud secrets versions add sa-upload-fn-key \
  --data-file=/path/to/sa-upload-fn-key.json \
  --project=graph-fil-a
```

### 3. Deploy to Cloud Functions

```bash
export PROJECT_ID=graph-fil-a
export GCS_BUCKET=graph-fil-a-audio

gcloud functions deploy sa-upload-fn \
  --gen2 \
  --runtime nodejs20 \
  --region us-central1 \
  --source ./functions/signed-url-function \
  --entry-point generateUploadUrl \
  --trigger-http \
  --allow-unauthenticated \
  --service-account sa-upload-fn@${PROJECT_ID}.iam.gserviceaccount.com \
  --set-env-vars GCP_PROJECT=${PROJECT_ID},GCS_BUCKET=${GCS_BUCKET},SECRET_ID=sa-upload-fn-key \
  --project=${PROJECT_ID}
```

### 4. Test the deployment

```bash
FUNCTION_URL=$(gcloud functions describe sa-upload-fn \
  --region us-central1 \
  --gen2 \
  --format 'value(serviceConfig.uri)' \
  --project=graph-fil-a)

curl -X POST "${FUNCTION_URL}" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <YOUR_JWT>" \
  -d '{"sessionId":"test-123"}'
```

## Local Testing

### Run locally with functions-framework

```bash
# Terminal 1: Start function
npm start

# Terminal 2: Test with curl
curl -X POST http://localhost:8080 \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer fake-jwt" \
  -d '{"sessionId":"local-test"}'
```

### Note on local testing

Local testing requires:
1. GCP credentials (via `gcloud auth application-default login`)
2. Access to Secret Manager (for service account key)
3. Access to GCS bucket

## Integration with API Gateway

Add this to `infrastructure/api-gateway/openapi2-run.yaml`:

```yaml
/sessions/upload-url:
  post:
    summary: "Generate signed GCS upload URL"
    operationId: generateUploadUrl
    x-google-backend:
      address: https://us-central1-graph-fil-a.cloudfunctions.net/sa-upload-fn
      deadline: 10.0
    security:
      - firebase: []
    parameters:
      - name: body
        in: body
        required: true
        schema:
          type: object
          required: [sessionId]
          properties:
            sessionId:
              type: string
              example: "abc123"
    responses:
      '200':
        description: "Signed URL generated successfully"
        schema:
          type: object
          properties:
            url:
              type: string
            sessionId:
              type: string
            gcsPath:
              type: string
      '400':
        description: "Invalid request"
      '401':
        description: "Unauthorized"
      '500':
        description: "Server error"
```

## Troubleshooting

### "Failed to fetch service account key from Secret Manager"

- Verify secret exists: `gcloud secrets describe sa-upload-fn-key --project=graph-fil-a`
- Check service account has `secretmanager.secretAccessor` role
- Verify secret has a version: `gcloud secrets versions list sa-upload-fn-key --project=graph-fil-a`

### "Invalid bucket name"

- Check bucket exists: `gsutil ls gs://graph-fil-a-audio`
- Verify `GCS_BUCKET` environment variable matches actual bucket name
- Check service account has `storage.objectCreator` role on bucket

### "Permission denied"

- Verify service account is assigned to the function: check Cloud Functions UI
- Check IAM bindings: `gsutil iam get gs://graph-fil-a-audio`
