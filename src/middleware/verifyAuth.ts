import type { Request } from '@google-cloud/functions-framework';
import { auth } from '../config/firebaseAdmin.js';

export interface VerifiedFirebaseUser {
  uid: string;
  email?: string;
  emailVerified?: boolean;
  signInProvider?: string;
}

export class FirebaseAuthError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 401) {
    super(message);
    this.name = 'FirebaseAuthError';
    this.statusCode = statusCode;
  }
}

/**
 * Verifies a Firebase Auth ID token from the `Authorization: Bearer <token>` header.
 * Supports users authenticated via Google (`google.com`) and Email/Password (`password`).
 *
 * Returns `null` if no Authorization header is provided (allowing backward-compatible
 * local testing), or throws `FirebaseAuthError` if an Authorization header is present
 * but invalid/expired.
 */
export async function verifyOptionalFirebaseAuth(
  req: Request
): Promise<VerifiedFirebaseUser | null> {
  const authHeader = req.headers.authorization || req.headers.Authorization;
  if (!authHeader || typeof authHeader !== 'string') {
    return null;
  }

  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match || !match[1]) {
    throw new FirebaseAuthError('Invalid Authorization header format. Expected Bearer <token>.');
  }

  const idToken = match[1].trim();
  try {
    const decoded = await auth.verifyIdToken(idToken);
    return {
      uid: decoded.uid,
      email: decoded.email,
      emailVerified: decoded.email_verified,
      signInProvider: decoded.firebase?.sign_in_provider,
    };
  } catch (err) {
    console.warn('[verifyAuth] Failed to verify Firebase ID token:', err);
    throw new FirebaseAuthError('Invalid or expired Firebase authentication token.');
  }
}
