import { Request, Response } from '@google-cloud/functions-framework';
import { Firestore, FieldValue } from '@google-cloud/firestore';
import { Storage } from '@google-cloud/storage';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';

// ============================================================================
// Types
// ============================================================================

interface GenerateUploadUrlRequest {
  sessionId: string;
}

interface GenerateUploadUrlResponse {
  url: string;
  sessionId: string;
  gcsPath: string;
}

// ============================================================================
// Config from environment
// ============================================================================

const PROJECT_ID = process.env.GCP_PROJECT || process.env.PROJECT_ID;
const GCS_BUCKET = process.env.GCS_BUCKET || 'graph-fil-a-audio';
const SECRET_ID = process.env.SECRET_ID || 'sa-upload-fn-key';
const SIGNED_URL_TTL_MINUTES = parseInt(process.env.SIGNED_URL_TTL_MINUTES || '15');

// ============================================================================
// Initialize clients
// ============================================================================

const secretClient = new SecretManagerServiceClient();
let storageClient: Storage | null = null;
let firestoreClient: Firestore | null = null;

/**
 * Fetch the service account key from Secret Manager
 * Returns a parsed JSON object with the key data
 */
async function getServiceAccountKey(): Promise<Record<string, unknown>> {
  const secretName = `projects/${PROJECT_ID}/secrets/${SECRET_ID}/versions/latest`;

  try {
    const [version] = await secretClient.accessSecretVersion({
      name: secretName,
    });

    const payload = version.payload?.data;
    if (!payload) {
      throw new Error('Secret payload is empty');
    }

    let keyString: string;
    if (typeof payload === 'string') {
      keyString = payload;
    } else if (Buffer.isBuffer(payload)) {
      keyString = payload.toString('utf8');
    } else if (payload instanceof Uint8Array) {
      keyString = Buffer.from(payload).toString('utf8');
    } else {
      keyString = String(payload);
    }

    return JSON.parse(keyString);
  } catch (error) {
    throw new Error(
      `Failed to fetch service account key from Secret Manager: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Initialize Storage client with service account credentials
 */
async function initializeStorageClient(): Promise<Storage> {
  if (storageClient) {
    return storageClient;
  }

  // For local testing: if GOOGLE_APPLICATION_CREDENTIALS is set, use Application Default Credentials
  // Otherwise, fetch from Secret Manager
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    storageClient = new Storage({
      projectId: PROJECT_ID,
    });
  } else {
    const serviceAccountKey = await getServiceAccountKey();
    storageClient = new Storage({
      projectId: PROJECT_ID,
      credentials: serviceAccountKey,
    });
  }

  return storageClient;
}

async function initializeFirestoreClient(): Promise<Firestore> {
  if (firestoreClient) {
    return firestoreClient;
  }

  firestoreClient = new Firestore({
    projectId: PROJECT_ID,
  });

  return firestoreClient;
}

/**
 * Generate a signed URL for GCS upload
 * URL is scoped to: action=write, path=sessions/{sessionId}/audio.*, expires=15min
 */
async function generateSignedUrl(sessionId: string): Promise<string> {
  const storage = await initializeStorageClient();
  const bucket = storage.bucket(GCS_BUCKET);

  const filename = `sessions/${sessionId}/audio.webm`;
  const file = bucket.file(filename);

  const [signedUrl] = await file.getSignedUrl({
    version: 'v4',
    action: 'write',
    expires: Date.now() + SIGNED_URL_TTL_MINUTES * 60 * 1000,
    contentType: 'audio/webm',
  });

  return signedUrl;
}

async function ensureSessionDocument(sessionId: string, uid: string): Promise<void> {
  const firestore = await initializeFirestoreClient();
  const sessionRef = firestore.collection('sessions').doc(sessionId);

  await sessionRef.set(
    {
      uid,
      status: 'uploading',
      transcript: null,
      graphJson: null,
      summaryJson: null,
      chatHistory: [],
      createdAt: FieldValue.serverTimestamp(),
      audioGcsPath: `sessions/${sessionId}/audio.webm`,
    },
    { merge: true }
  );
}

/**
 * Extract user ID from the request.
 *
 * API Gateway validates the Firebase JWT, then replaces the Authorization
 * header with its own OIDC service-to-service token.  The original validated
 * user claims are forwarded in the `X-Apigateway-Api-Userinfo` header
 * (base64-encoded JSON).  We read `sub` from that payload — it contains the
 * Firebase UID.
 *
 * Falls back to decoding the Authorization header directly for environments
 * that bypass API Gateway (e.g. local testing).
 */
function extractUserId(req: Request): string | null {
  // Primary: API Gateway validated user info
  const userInfo = req.get('x-apigateway-api-userinfo');
  if (userInfo) {
    try {
      const payloadJson = Buffer.from(userInfo, 'base64').toString('utf8');
      const payload = JSON.parse(payloadJson) as { sub?: unknown };
      if (typeof payload.sub === 'string' && payload.sub) {
        return payload.sub;
      }
    } catch {
      // fall through to Authorization header
    }
  }

  // Fallback: decode Authorization header directly (local dev / direct invocation)
  const authHeader = req.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    try {
      const token = authHeader.slice('Bearer '.length);
      const parts = token.split('.');
      if (parts.length < 2) {
        return null;
      }

      const payloadJson = Buffer.from(parts[1], 'base64url').toString('utf8');
      const payload = JSON.parse(payloadJson) as { sub?: unknown };

      return typeof payload.sub === 'string' && payload.sub ? payload.sub : null;
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Set CORS headers on response
 */
function setCorsHeaders(res: Response): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
}

/**
 * Main Cloud Function: Generate a signed GCS upload URL
 *
 * Request body:
 *   { sessionId: "abc123" }
 *
 * Response:
 *   { url: "https://storage.googleapis.com/...", sessionId, gcsPath }
 */
export async function generateUploadUrl(
  req: Request,
  res: Response
): Promise<void> {
  // Set CORS headers on all responses
  setCorsHeaders(res);

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    res.status(204).send();
    return;
  }

  // Only accept POST
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed. Use POST.' });
    return;
  }

  try {
    // =====================================================================
    // 1. Validate request body
    // =====================================================================
    const body = req.body as GenerateUploadUrlRequest | undefined;

    if (!body || typeof body !== 'object') {
      res.status(400).json({ error: 'Invalid request body' });
      return;
    }

    const { sessionId } = body;

    if (!sessionId || typeof sessionId !== 'string') {
      res.status(400).json({
        error: 'Missing or invalid sessionId',
      });
      return;
    }

    // Validate sessionId format (alphanumeric, hyphens, underscores)
    if (!/^[a-zA-Z0-9_-]+$/.test(sessionId)) {
      res.status(400).json({
        error: 'Invalid sessionId format',
      });
      return;
    }

    // =====================================================================
    // 2. Extract and validate user identity from the verified JWT token
    // =====================================================================
    const userId = extractUserId(req);

    if (!userId) {
      res.status(401).json({
        error: 'Unauthorized: missing or invalid authentication',
      });
      return;
    }

    // =====================================================================
    // 3. Generate signed URL
    // =====================================================================
    await ensureSessionDocument(sessionId, userId);
    const signedUrl = await generateSignedUrl(sessionId);
    const gcsPath = `sessions/${sessionId}/audio.webm`;

    // =====================================================================
    // 4. Return response
    // =====================================================================
    const response: GenerateUploadUrlResponse = {
      url: signedUrl,
      sessionId,
      gcsPath,
    };

    res.status(200).json(response);
  } catch (error) {
    console.error('Error generating signed URL:', error);

    const message =
      error instanceof Error ? error.message : 'Unknown error occurred';

    res.status(500).json({
      error: 'Failed to generate signed URL',
      details: message,
    });
  }
}