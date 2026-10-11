const DB_NAME = "arstacksops";

export interface IndexedDump {
  users: unknown[];
  projects: unknown[];
  tasks: unknown[];
  comments: unknown[];
  attachments: unknown[];
}

function getAll(db: IDBDatabase, storeName: string): Promise<unknown[]> {
  if (!db.objectStoreNames.contains(storeName)) return Promise.resolve([]);
  return new Promise((resolve, reject) => {
    const request = db.transaction(storeName, "readonly").objectStore(storeName).getAll();
    request.onsuccess = () => resolve(request.result as unknown[]);
    request.onerror = () => reject(request.error ?? new Error("Could not read existing browser data"));
  });
}

/** Read the previous IndexedDB database without deleting it. Returns null when it is not there. */
export async function readIndexedDb(): Promise<IndexedDump | null> {
  if (typeof indexedDB === "undefined" || typeof indexedDB.databases !== "function") return null;
  const existing = await indexedDB.databases();
  if (!existing.some((entry) => entry.name === DB_NAME)) return null;
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not read existing browser data"));
    request.onblocked = () => reject(new Error("Reload the page to finish opening browser storage"));
  });
  try {
    const [users, projects, tasks, comments, attachments] = await Promise.all([
      getAll(db, "users"),
      getAll(db, "projects"),
      getAll(db, "tasks"),
      getAll(db, "comments"),
      getAll(db, "attachments"),
    ]);
    return { users, projects, tasks, comments, attachments };
  } finally {
    db.close();
  }
}
