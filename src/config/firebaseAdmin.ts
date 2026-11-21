import fs from 'fs';
import path from 'path';
import { initializeApp, getApps, getApp, cert, applicationDefault } from 'firebase-admin/app';
import type { App } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import type { Firestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { getAuth } from 'firebase-admin/auth';
import { inMemoryDb } from './inMemoryFirestore.js';

const projectId = process.env.GCP_PROJECT || process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || 'cluetri';
const storageBucket = process.env.STORAGE_BUCKET_NAME || `${projectId}.firebasestorage.app`;

let firebaseApp: App;

if (getApps().length === 0) {
  const serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (serviceAccountKey) {
    try {
      const parsed = JSON.parse(serviceAccountKey);
      firebaseApp = initializeApp({
        credential: cert(parsed),
        projectId: parsed.project_id || projectId,
        storageBucket,
      });
    } catch {
      firebaseApp = initializeApp({
        credential: applicationDefault(),
        projectId,
        storageBucket,
      });
    }
  } else {
    firebaseApp = initializeApp({
      projectId,
      storageBucket,
    });
  }
} else {
  firebaseApp = getApp();
}

export const app: App = firebaseApp;

/**
 * Detect whether live GCP credentials or Firestore Emulator are available
 */
export function hasGcpCredentials(): boolean {
  if (process.env.USE_REAL_FIRESTORE === 'true') return true;
  if (process.env.USE_IN_MEMORY_FIRESTORE === 'true' || process.env.NODE_ENV === 'test') {
    return false;
  }
  // 1. Emulator host is set
  if (process.env.FIRESTORE_EMULATOR_HOST) return true;

  // 2. Service account key file in env
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS && fs.existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS)) {
    return true;
  }
  if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) return true;

  // 3. Running inside GCP platform (Cloud Run, GCF, App Engine, GCE)
  if (
    process.env.K_SERVICE ||
    process.env.FUNCTION_TARGET ||
    process.env.FUNCTION_SIGNATURE_TYPE ||
    process.env.GAE_ENV ||
    process.env.CLOUD_RUN_JOB
  ) {
    return true;
  }

  // 4. Well-known gcloud ADC file on developer machine
  const home = process.env.HOME || process.env.USERPROFILE || '';
  const gcloudAdc = path.join(home, '.config', 'gcloud', 'application_default_credentials.json');
  if (fs.existsSync(gcloudAdc)) return true;

  return false;
}

// Default to in-memory Firestore if no GCP credentials or emulator are configured
let forceInMemory = !hasGcpCredentials();

export function enableInMemoryFirestore(enabled = true): void {
  forceInMemory = enabled;
}

export { inMemoryDb };

let realFirestoreInstance: Firestore | null = null;
function getRealFirestore(): Firestore {
  if (!realFirestoreInstance) {
    realFirestoreInstance = getFirestore(firebaseApp);
    try {
      realFirestoreInstance.settings({ ignoreUndefinedProperties: true });
    } catch {
      // Ignore if already configured
    }
  }
  return realFirestoreInstance;
}

// Proxy db to seamlessly switch between InMemory and Real Cloud Firestore
export const db: Firestore = new Proxy({} as Firestore, {
  get(_target, prop, _receiver) {
    if (forceInMemory) {
      const memoryProp = (inMemoryDb as any)[prop];
      if (typeof memoryProp === 'function') {
        return memoryProp.bind(inMemoryDb);
      }
      return memoryProp;
    }
    const real = getRealFirestore();
    const val = (real as any)[prop];
    if (typeof val === 'function') {
      return val.bind(real);
    }
    return val;
  },
});

export const storage = getStorage(firebaseApp);
export const bucket: ReturnType<typeof storage.bucket> = storage.bucket(storageBucket);
export const auth = getAuth(firebaseApp);

export default firebaseApp;
