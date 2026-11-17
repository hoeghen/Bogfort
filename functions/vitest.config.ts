import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Set before any module loads, so the Admin SDK talks to the emulators
    // instead of looking for credentials.
    env: {
      GOOGLE_CLOUD_PROJECT: 'bogfort-local',
      GCLOUD_PROJECT: 'bogfort-local',
      FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
      FIREBASE_STORAGE_EMULATOR_HOST: '127.0.0.1:9199',
      STORAGE_BUCKET: 'bogfort-local.appspot.com',
    },
    // The numbering tests contend on the same counter by design.
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
