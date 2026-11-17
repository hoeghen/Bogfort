import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

/**
 * Deployed functions get the default bucket from FIREBASE_CONFIG. The
 * Functions emulator leaves it out, so fall back to STORAGE_BUCKET and then to
 * the emulator's own default name — without one, every bilag operation fails.
 */
function storageBucket(): string | undefined {
  try {
    const cfg = JSON.parse(process.env['FIREBASE_CONFIG'] ?? '{}') as { storageBucket?: string };
    if (cfg.storageBucket) return cfg.storageBucket;
  } catch {
    // Not JSON (it can be a file path); fall through.
  }
  if (process.env['STORAGE_BUCKET']) return process.env['STORAGE_BUCKET'];
  const project = process.env['GCLOUD_PROJECT'] ?? process.env['GOOGLE_CLOUD_PROJECT'];
  return project ? `${project}.appspot.com` : undefined;
}

if (getApps().length === 0) {
  const bucketName = storageBucket();
  initializeApp(bucketName ? { storageBucket: bucketName } : {});
}

export const db = getFirestore();

export function bucket() {
  return getStorage().bucket();
}
