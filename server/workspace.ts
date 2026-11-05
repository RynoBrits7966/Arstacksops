import {
  buildSnapshot,
  collectMedia,
  embedsMedia,
  emptySnapshot,
  hydrateSnapshot,
  planMediaSync,
  rehydrateUpload,
  snapshotWithoutMedia,
  type Snapshot,
} from "../src/storage/snapshot";
import type { ProjectSignOff, User } from "../src/types";
import type { Pool, PoolClient } from "pg";
import type { MemoryDB } from "better-auth/adapters/memory";
import { guardProjectWrite, removeProject, reopenProject, signOffProject, type SnapshotChange } from "./projects";

export interface Member {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
}

export interface WorkspaceRecord {
  version: number;
  snapshot: Snapshot;
}

interface AuthUserRow {
  id?: string;
  name?: string;
  email?: string;
  emailVerified?: boolean;
}

export type ProjectMutation =
  | { ok: true; record: WorkspaceRecord }
  | { ok: false; reason: "conflict" | "missing" | "already-signed-off" | "already-active" };

export interface WorkspaceStore {
  read(): Promise<WorkspaceRecord>;
  write(expectedVersion: number, snapshot: unknown, members: User[]): Promise<WorkspaceRecord | "conflict">;
  members(): Promise<Member[]>;
  deleteProject(expectedVersion: number, projectId: string): Promise<ProjectMutation>;
  signOff(expectedVersion: number, projectId: string, signOff: ProjectSignOff): Promise<ProjectMutation>;
  reopen(expectedVersion: number, projectId: string): Promise<ProjectMutation>;
}

export function memoryWorkspace(db: MemoryDB): WorkspaceStore {
  let record: WorkspaceRecord = { version: 1, snapshot: emptySnapshot() };
  return {
    async read() {
      return { version: record.version, snapshot: withMembers(record.snapshot, verifiedMembers(db)) };
    },
    async write(expectedVersion, snapshot, members) {
      if (expectedVersion !== record.version) return "conflict";
      const built = buildSnapshot(rehydrateUpload(record.snapshot, snapshot));
      if (!built.ok) throw new Error(built.message);
      const guarded = guardProjectWrite(record.snapshot, built.snapshot);
      record = { version: record.version + 1, snapshot: withMembers(guarded, members) };
      return record;
    },
    async members() {
      return verifiedMembers(db);
    },
    async deleteProject(expectedVersion, projectId) {
      return applyMemory(db, () => record, (next) => {
        record = next;
      }, expectedVersion, (snapshot) => removeProject(snapshot, projectId));
    },
    async signOff(expectedVersion, projectId, signOff) {
      return applyMemory(db, () => record, (next) => {
        record = next;
      }, expectedVersion, (snapshot) => signOffProject(snapshot, projectId, signOff));
    },
    async reopen(expectedVersion, projectId) {
      return applyMemory(db, () => record, (next) => {
        record = next;
      }, expectedVersion, (snapshot) => reopenProject(snapshot, projectId));
    },
  };
}

export function postgresWorkspace(pool: Pool): WorkspaceStore {
  return {
    async read() {
      const row = await loadBoard(pool);
      const members = await postgresMembers(pool);
      return { version: row.version, snapshot: withMembers(row.snapshot, members) };
    },
    async write(expectedVersion, snapshot, members) {
      const current = await loadBoard(pool);
      if (current.version !== expectedVersion) return "conflict";
      const built = buildSnapshot(rehydrateUpload(current.snapshot, snapshot));
      if (!built.ok) throw new Error(built.message);
      const guarded = guardProjectWrite(current.snapshot, built.snapshot);
      const next = withMembers(guarded, members);
      return persistBoard(pool, expectedVersion, next, current.storedMedia);
    },
    async members() {
      return postgresMembers(pool);
    },
    deleteProject(expectedVersion, projectId) {
      return savePostgres(pool, expectedVersion, (snapshot) => removeProject(snapshot, projectId));
    },
    signOff(expectedVersion, projectId, signOff) {
      return savePostgres(pool, expectedVersion, (snapshot) => signOffProject(snapshot, projectId, signOff));
    },
    reopen(expectedVersion, projectId) {
      return savePostgres(pool, expectedVersion, (snapshot) => reopenProject(snapshot, projectId));
    },
  };
}

function applyMemory(
  db: MemoryDB,
  read: () => WorkspaceRecord,
  write: (record: WorkspaceRecord) => void,
  expectedVersion: number,
  change: (snapshot: Snapshot) => SnapshotChange,
): ProjectMutation {
  const current = read();
  if (current.version !== expectedVersion) return { ok: false, reason: "conflict" };
  const changed = change(current.snapshot);
  if (!changed.ok) return changed;
  const record = { version: current.version + 1, snapshot: withMembers(changed.snapshot, verifiedMembers(db)) };
  write(record);
  return { ok: true, record };
}

async function savePostgres(
  pool: Pool,
  expectedVersion: number,
  change: (snapshot: Snapshot) => SnapshotChange,
): Promise<ProjectMutation> {
  const current = await loadBoard(pool);
  if (current.version !== expectedVersion) return { ok: false, reason: "conflict" };
  const changed = change(current.snapshot);
  if (!changed.ok) return changed;
  const next = withMembers(changed.snapshot, await postgresMembers(pool));
  const saved = await persistBoard(pool, expectedVersion, next, current.storedMedia);
  if (saved === "conflict") return { ok: false, reason: "conflict" };
  return { ok: true, record: saved };
}

function withMembers(snapshot: Snapshot, members: User[]): Snapshot {
  const users: User[] = members
    .map((member) => ({ id: member.id, name: member.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { ...snapshot, users };
}

function verifiedMembers(db: MemoryDB): Member[] {
  const rows = (db.user ?? []) as AuthUserRow[];
  return rows.flatMap((row) => {
    if (!row.id || !row.email || !row.emailVerified) return [];
    return [{ id: row.id, name: row.name || row.email, email: row.email, emailVerified: true }];
  });
}

async function postgresMembers(pool: Pool): Promise<Member[]> {
  const result = await pool.query(
    `SELECT id, name, email, "emailVerified" AS "emailVerified" FROM "user" WHERE "emailVerified" = true`,
  );
  return (result.rows as AuthUserRow[]).flatMap((row) => {
    if (!row.id || !row.email) return [];
    return [{ id: row.id, name: row.name || row.email, email: row.email, emailVerified: true }];
  });
}

const workspaceReady = new WeakMap<Pool, Promise<void>>();

async function ensureWorkspaceTable(pool: Pool): Promise<void> {
  const pending = workspaceReady.get(pool);
  if (pending) return pending;
  const created = createWorkspaceTables(pool).catch((error: unknown) => {
    workspaceReady.delete(pool);
    throw error;
  });
  workspaceReady.set(pool, created);
  return created;
}

async function createWorkspaceTables(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS workspace (
      id text PRIMARY KEY,
      version integer NOT NULL,
      snapshot jsonb NOT NULL
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS workspace_media (
      id text PRIMARY KEY,
      data_base64 text NOT NULL
    )
  `);
  await pool.query(
    `INSERT INTO workspace (id, version, snapshot)
     VALUES ('company', 1, $1::jsonb)
     ON CONFLICT (id) DO NOTHING`,
    [JSON.stringify(emptySnapshot())],
  );
}

interface LoadedBoard extends WorkspaceRecord {
  storedMedia: Map<string, string>;
}

async function loadBoard(pool: Pool): Promise<LoadedBoard> {
  await ensureWorkspaceTable(pool);
  const result = await pool.query(`SELECT version, snapshot FROM workspace WHERE id = 'company'`);
  const row = result.rows[0] as { version: number; snapshot: unknown } | undefined;
  if (!row) return { version: 1, snapshot: emptySnapshot(), storedMedia: new Map() };
  const built = buildSnapshot(row.snapshot);
  if (!built.ok) throw new Error(built.message);
  const storedMedia = await readMedia(pool);
  const hydrated = hydrateSnapshot(built.snapshot, storedMedia);
  if (!embedsMedia(built.snapshot)) {
    return { version: row.version, snapshot: hydrated, storedMedia };
  }
  const moved = collectMedia(hydrated);
  const client = await pool.connect();
  let stored = false;
  try {
    await client.query("BEGIN");
    await writeMediaPlan(client, planMediaSync(storedMedia, moved));
    const updated = await client.query(`UPDATE workspace SET snapshot = $2::jsonb WHERE id = 'company' AND version = $1`, [
      row.version,
      JSON.stringify(snapshotWithoutMedia(hydrated)),
    ]);
    if ((updated.rowCount ?? 0) === 0) {
      await client.query("ROLLBACK");
    } else {
      await client.query("COMMIT");
      stored = true;
    }
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  return { version: row.version, snapshot: hydrated, storedMedia: stored ? moved : storedMedia };
}

async function readMedia(pool: Pool): Promise<Map<string, string>> {
  const result = await pool.query(`SELECT id, data_base64 FROM workspace_media`);
  const media = new Map<string, string>();
  for (const row of result.rows as { id: string; data_base64: string }[]) {
    media.set(row.id, row.data_base64);
  }
  return media;
}

async function writeMediaPlan(
  db: Pool | PoolClient,
  plan: { upsert: Array<[string, string]>; remove: string[] },
): Promise<void> {
  for (const [id, data] of plan.upsert) {
    await db.query(
      `INSERT INTO workspace_media (id, data_base64) VALUES ($1, $2)
       ON CONFLICT (id) DO UPDATE SET data_base64 = EXCLUDED.data_base64`,
      [id, data],
    );
  }
  if (plan.remove.length > 0) {
    await db.query(`DELETE FROM workspace_media WHERE id = ANY($1::text[])`, [plan.remove]);
  }
}

async function persistBoard(
  pool: Pool,
  expectedVersion: number,
  next: Snapshot,
  storedMedia: Map<string, string>,
): Promise<WorkspaceRecord | "conflict"> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const locked = await client.query(`SELECT version FROM workspace WHERE id = 'company' FOR UPDATE`);
    const version = (locked.rows[0] as { version: number } | undefined)?.version;
    if (version !== expectedVersion) {
      await client.query("ROLLBACK");
      return "conflict";
    }
    await writeMediaPlan(client, planMediaSync(storedMedia, collectMedia(next)));
    const updated = await client.query(
      `UPDATE workspace
       SET version = version + 1, snapshot = $2::jsonb
       WHERE id = 'company' AND version = $1
       RETURNING version`,
      [expectedVersion, JSON.stringify(snapshotWithoutMedia(next))],
    );
    if (updated.rowCount === 0) {
      await client.query("ROLLBACK");
      return "conflict";
    }
    await client.query("COMMIT");
    const row = updated.rows[0] as { version: number };
    return { version: row.version, snapshot: next };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
