# API Gateway Configuration

This directory contains API Gateway infrastructure and configuration files for the Graph-fil-a project.

## openapi2-run.yaml

An OpenAPI 2.0 (Swagger) specification that defines a Firebase-authenticated API Gateway endpoint.

### Overview

This configuration sets up a Google Cloud API Gateway with JWT validation using Firebase authentication. It exposes a single test endpoint that validates incoming requests have a valid Firebase ID token before allowing access.

### Security

The API uses **Firebase ID Token validation** through OAuth2 implicit flow:

- **Issuer**: `https://securetoken.google.com/graph-fil-a`
- **JWKS URI**: `https://www.googleapis.com/service_accounts/v1/metadata/x509/securetoken@system.gserviceaccount.com`
- **Audience**: `graph-fil-a`

All endpoints require a valid Firebase ID token passed as a Bearer token in the `Authorization` header.

### Endpoints

#### `GET /test`

A test endpoint that validates JWT authentication.

**Authentication**: Required (Firebase)

**Responses**:
- `200 OK` - JWT is valid: "If you see this, your JWT is valid!"
- `401 Unauthorized` - Missing or invalid token: "Missing or invalid token."

**Example Request**:
```bash
curl -H "Authorization: Bearer <FIREBASE_ID_TOKEN>" https://your-api-gateway/test
```

### Backend Configuration

The endpoint routes to:
- **Address**: `https://www.google.com`
- **Deadline**: 10 seconds

### Deployment

This OpenAPI spec is designed to be deployed to Google Cloud API Gateway. The `x-google-backend` extension configures how the gateway handles requests.

To deploy this configuration:

1. Ensure your GCP project is set up with the correct Firebase app ID (`graph-fil-a`)
2. Deploy the API Gateway with this OpenAPI spec
3. Configure your client applications to include Firebase ID tokens in the `Authorization: Bearer` header

### Related Files

- `test-gateway.sh` - Script for testing the API Gateway endpoints
- GCP setup scripts in the parent directories

### References

- [Google Cloud API Gateway Documentation](https://cloud.google.com/api-gateway/docs)
- [Firebase Authentication Documentation](https://firebase.google.com/docs/auth)
- [OpenAPI 2.0 Specification](https://swagger.io/specification/v2/)
