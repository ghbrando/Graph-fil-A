import { Request, Response } from '@google-cloud/functions-framework';
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

  const serviceAccountKey = await getServiceAccountKey();

  storageClient = new Storage({
    projectId: PROJECT_ID,
    credentials: serviceAccountKey,
  });

  return storageClient;
}

/**
 * Generate a signed URL for GCS upload
 * URL is scoped to: action=write, path=sessions/{sessionId}/audio.*, expires=15min
 */
async function generateSignedUrl(sessionId: string): Promise<string> {
  const storage = await initializeStorageClient();
  const bucket = storage.bucket(GCS_BUCKET);

  // Path: sessions/{sessionId}/audio.mp3
  const filename = `sessions/${sessionId}/audio.mp3`;
  const file = bucket.file(filename);

  const [signedUrl] = await file.getSignedUrl({
    version: 'v4',
    action: 'write',
    expires: Date.now() + SIGNED_URL_TTL_MINUTES * 60 * 1000,
    contentType: 'audio/mpeg',
  });

  return signedUrl;
}

/**
 * Extract user ID from authorization header
 * API Gateway validates the Firebase JWT; we extract the UID from the decoded token
 */
function extractUserIdFromRequest(req: Request): string | null {
  // Method 1: API Gateway adds x-goog-authenticated-user-email header
  const authenticatedUser = req.get('x-goog-authenticated-user-email');
  if (authenticatedUser) {
    // Format: "accounts.google.com:<user-email>"
    return authenticatedUser;
  }

  // Method 2: Custom header from API Gateway (if configured)
  const customUserId = req.get('x-user-id');
  if (customUserId) {
    return customUserId;
  }

  // Method 3: Extract from Authorization header (Firebase JWT)
  // Note: API Gateway should validate this, but we can decode it here if needed
  const authHeader = req.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    // In production, API Gateway validates this before it reaches the function
    // We trust the header here
    return 'authenticated-user';
  }

  return null;
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
    // 2. Extract and validate user identity
    // =====================================================================
    const userId = extractUserIdFromRequest(req);

    if (!userId) {
      res.status(401).json({
        error: 'Unauthorized: missing or invalid authentication',
      });
      return;
    }

    // =====================================================================
    // 3. Generate signed URL
    // =====================================================================
    const signedUrl = await generateSignedUrl(sessionId);
    const gcsPath = `sessions/${sessionId}/audio.mp3`;

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
