import { HttpsError, type FunctionsErrorCode } from 'firebase-functions/v2/https';
import { PostingError } from '../../../src/shared/index.js';

/** Fail with a message the app can show the user as-is (Danish). */
export function fail(code: FunctionsErrorCode, message: string): never {
  throw new HttpsError(code, message);
}

/** Map domain errors onto callable errors; anything else passes through. */
export function toHttpsError(err: unknown): unknown {
  if (err instanceof PostingError) return new HttpsError('failed-precondition', err.message, { code: err.code });
  return err;
}
