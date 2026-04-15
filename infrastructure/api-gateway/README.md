# API Gateway Configuration

This directory contains API Gateway infrastructure and configuration files for the Graph-fil-a project.

## openapi2-run.yaml

An OpenAPI 2.0 (Swagger) specification that defines a Firebase-authenticated API Gateway for the Graph-fil-A project.

### Overview

This configuration sets up a Google Cloud API Gateway with JWT validation using Firebase authentication. It exposes two endpoints:
- **`/sessions/upload-url`** - Generates signed GCS upload URLs for browser-direct audio uploads
- **`/test`** - Test endpoint to validate Firebase JWT tokens

### Security

The API uses **Firebase ID Token validation** through OAuth2 implicit flow:

- **Issuer**: `https://securetoken.google.com/graph-fil-a`
- **JWKS URI**: `https://www.googleapis.com/service_accounts/v1/metadata/x509/securetoken@system.gserviceaccount.com`
- **Audience**: `graph-fil-a`

All endpoints require a valid Firebase ID token passed as a Bearer token in the `Authorization` header.

### Endpoints

#### `POST /sessions/upload-url`

Generates a time-limited (15-minute) signed GCS upload URL for browser-direct audio uploads.

**Authentication**: Required (Firebase)

**Request Body**:
```json
{
  "sessionId": "abc123def456"
}
```

**Responses**:
- `200 OK` - Returns signed URL and GCS path
- `400 Bad Request` - Missing or malformed `sessionId`
- `401 Unauthorized` - Missing or invalid Firebase JWT
- `500 Internal Server Error` - Secret Manager, GCS, or other failure

**Backend**: Cloud Function `sa-upload-fn` in `us-central1`

#### `GET /test`

Test endpoint to validate Firebase JWT authentication.

**Authentication**: Required (Firebase)

**Responses**:
- `200 OK` - JWT is valid: "If you see this, your JWT is valid!"
- `401 Unauthorized` - Missing or invalid token: "Missing or invalid token."

**Example Request**:
```bash
curl -H "Authorization: Bearer <FIREBASE_ID_TOKEN>" https://gsc-signed-url-gateway-1s5q7jw9.uc.gateway.dev/test
```

### Deployed Gateway

**Base URL**: `https://gsc-signed-url-gateway-1s5q7jw9.uc.gateway.dev`

All endpoints require a valid Firebase ID token passed as a Bearer token in the `Authorization` header.

### Deployment

The API Gateway is deployed to Google Cloud API Gateway using this OpenAPI 2.0 spec. The `x-google-backend` extension configures how the gateway routes requests to backend services.

**Deployed Configuration**:
- API Name: `api-gateway`
- API Config: `v1`
- Gateway: `api-gateway` (location: `uc`)
- Service Account: `sa-api-gateway@graph-fil-a.iam.gserviceaccount.com`

**To update the deployed config**:
```bash
gcloud api-gateway api-configs create v1 \
  --api=api-gateway \
  --openapi-spec=infrastructure/api-gateway/openapi2-run.yaml \
  --project=graph-fil-a \
  --backend-auth-service-account=sa-api-gateway@graph-fil-a.iam.gserviceaccount.com
```

**Client Setup**:
1. Authenticate via Firebase Auth to get an ID token
2. Include the token in the `Authorization: Bearer` header for all requests
3. Call endpoints on `https://gsc-signed-url-gateway-1s5q7jw9.uc.gateway.dev`

### Related Files

- `test-gateway.sh` - Script for testing the API Gateway endpoints
- GCP setup scripts in the parent directories

### References

- [Google Cloud API Gateway Documentation](https://cloud.google.com/api-gateway/docs)
- [Firebase Authentication Documentation](https://firebase.google.com/docs/auth)
- [OpenAPI 2.0 Specification](https://swagger.io/specification/v2/)
