import { buildSnapshot, type Snapshot } from "./snapshot";

const DB_NAME = "arstacksops-offline";
const STORE = "workspace";
const KEY = "company";

export interface OfflineCopy {
  version: number;
  synced: Snapshot;
  draft: Snapshot;
  dirty: boolean;
}

export type RemoteLoad =
  | { ok: true; version: number; snapshot: Snapshot }
  | { ok: false; auth: boolean; network: boolean };

export type OpenPlan =
  | { action: "use-remote"; version: number; snapshot: Snapshot }
  | { action: "merge"; version: number; snapshot: Snapshot; local: OfflineCopy }
  | { action: "use-local"; copy: OfflineCopy }
  | { action: "sign-in" }
  | { action: "wait-online" }
  | { action: "fail" };

/** Decide how to open the board without dropping a local draft or a server copy. */
export function planBoardOpen(remote: RemoteLoad, local: OfflineCopy | null): OpenPlan {
  if (!remote.ok) {
    if (remote.auth) return { action: "sign-in" };
    if (local) return { action: "use-local", copy: local };
    if (remote.network) return { action: "wait-online" };
    return { action: "fail" };
  }
  if (local?.dirty) return { action: "merge", version: remote.version, snapshot: remote.snapshot, local };
  return { action: "use-remote", version: remote.version, snapshot: remote.snapshot };
}

export function isNetworkFailure(error: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  if (error instanceof TypeError) return true;
  return false;
}

export class OfflineError extends Error {
  constructor() {
    super("You are offline. This change is saved on this device and will sync when you reconnect.");
    this.name = "OfflineError";
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open device storage"));
  });
}

export async function readOfflineCopy(): Promise<OfflineCopy | null> {
  if (typeof indexedDB === "undefined") return null;
  try {
    const db = await openDb();
    try {
      const raw = await new Promise<unknown>((resolve, reject) => {
        const request = db.transaction(STORE, "readonly").objectStore(STORE).get(KEY);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("Could not read the saved board"));
      });
      const record = raw && typeof raw === "object" ? (raw as Partial<OfflineCopy>) : null;
      if (!record || typeof record.version !== "number") return null;
      const synced = buildSnapshot(record.synced);
      const draft = buildSnapshot(record.draft);
      if (!synced.ok || !draft.ok) return null;
      return { version: record.version, synced: synced.snapshot, draft: draft.snapshot, dirty: Boolean(record.dirty) };
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

export async function writeOfflineCopy(copy: OfflineCopy): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const request = db.transaction(STORE, "readwrite").objectStore(STORE).put(copy, KEY);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error ?? new Error("Could not store the board on this device"));
    });
  } finally {
    db.close();
  }
}

export async function clearOfflineCopy(): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  try {
    const db = await openDb();
    try {
      await new Promise<void>((resolve, reject) => {
        const request = db.transaction(STORE, "readwrite").objectStore(STORE).delete(KEY);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error ?? new Error("Could not clear the saved board"));
      });
    } finally {
      db.close();
    }
  } catch {
    // Sign-out still finishes. The next online load replaces this copy.
  }
}
