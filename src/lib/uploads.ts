/**
 * Offline queue for bilag. Firestore queues draft writes by itself, but
 * Storage uploads need a connection — so the file is kept in IndexedDB, the
 * draft is saved with `attachmentPending: true`, and the queue uploads and
 * clears the flag whenever the device is online. A receipt photographed in a
 * basement is not lost and does not block the next entry.
 */
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { deleteObject, ref, uploadBytes } from 'firebase/storage';
import { db, storage } from './firebase';

interface QueuedUpload {
  path: string;
  companyId: string;
  draftId: string;
  blob: Blob;
  contentType: string;
}

const DB_NAME = 'bogfort-uploads';
const STORE = 'uploads';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'path' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const idb = await open();
  return new Promise<T>((resolve, reject) => {
    const tx = idb.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
  });
}

const listeners = new Set<() => void>();
let pendingPaths = new Set<string>();

async function refreshPending() {
  try {
    const all = await withStore<QueuedUpload[]>('readonly', (s) => s.getAll() as IDBRequest<QueuedUpload[]>);
    pendingPaths = new Set(all.map((u) => u.path));
  } catch {
    pendingPaths = new Set();
  }
  listeners.forEach((l) => l());
}

export function subscribePending(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function getPendingPaths(): Set<string> {
  return pendingPaths;
}

export async function enqueueUpload(u: QueuedUpload): Promise<void> {
  await withStore('readwrite', (s) => s.put(u));
  await refreshPending();
  void flushUploads();
}

export async function dropQueued(path: string): Promise<void> {
  await withStore('readwrite', (s) => s.delete(path)).catch(() => undefined);
  await refreshPending();
}

let flushing: Promise<void> | null = null;

export function flushUploads(): Promise<void> {
  if (!navigator.onLine) return Promise.resolve();
  flushing ??= (async () => {
    try {
      const all = await withStore<QueuedUpload[]>('readonly', (s) => s.getAll() as IDBRequest<QueuedUpload[]>);
      for (const u of all) {
        try {
          await uploadOne(u);
          await withStore('readwrite', (s) => s.delete(u.path));
        } catch {
          // Leave it queued; the next 'online' event or app start retries.
        }
      }
    } finally {
      flushing = null;
      await refreshPending();
    }
  })();
  return flushing;
}

async function uploadOne(u: QueuedUpload) {
  const draftRef = doc(db, `companies/${u.companyId}/drafts/${u.draftId}`);
  await uploadBytes(ref(storage, u.path), u.blob, { contentType: u.contentType });
  const snap = await getDoc(draftRef);
  const draft = snap.data();
  if (!snap.exists() || draft?.['attachment']?.path !== u.path) {
    // The line was deleted or got a different bilag while we waited.
    await deleteObject(ref(storage, u.path)).catch(() => undefined);
    return;
  }
  await updateDoc(draftRef, { attachmentPending: false, updatedAt: Date.now() });
}

export function removeUploaded(path: string): Promise<void> {
  return deleteObject(ref(storage, path)).catch(() => undefined);
}

export function startUploadQueue(): void {
  window.addEventListener('online', () => void flushUploads());
  void refreshPending().then(flushUploads);
}
