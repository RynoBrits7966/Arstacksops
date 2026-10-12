import { buildSnapshot, emptySnapshot, type Snapshot } from "../src/storage/snapshot";
import type { User } from "../src/types";
import type { Pool } from "pg";
import type { MemoryDB } from "better-auth/adapters/memory";

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

export interface WorkspaceStore {
  read(): Promise<WorkspaceRecord>;
  write(expectedVersion: number, snapshot: unknown, members: User[]): Promise<WorkspaceRecord | "conflict">;
  members(): Promise<Member[]>;
}

export function memoryWorkspace(db: MemoryDB): WorkspaceStore {
  let record: WorkspaceRecord = { version: 1, snapshot: emptySnapshot() };
  return {
    async read() {
      return { version: record.version, snapshot: withMembers(record.snapshot, verifiedMembers(db)) };
    },
    async write(expectedVersion, snapshot, members) {
      if (expectedVersion !== record.version) return "conflict";
      const built = buildSnapshot(snapshot);
      if (!built.ok) throw new Error(built.message);
      record = { version: record.version + 1, snapshot: withMembers(built.snapshot, members) };
      return record;
    },
    async members() {
      return verifiedMembers(db);
    },
  };
}

export function postgresWorkspace(pool: Pool): WorkspaceStore {
  return {
    async read() {
      await ensureWorkspaceTable(pool);
      const row = await loadRow(pool);
      const members = await postgresMembers(pool);
      return { version: row.version, snapshot: withMembers(row.snapshot, members) };
    },
    async write(expectedVersion, snapshot, members) {
      await ensureWorkspaceTable(pool);
      const built = buildSnapshot(snapshot);
      if (!built.ok) throw new Error(built.message);
      const next = withMembers(built.snapshot, members);
      const updated = await pool.query(
        `UPDATE workspace
         SET version = version + 1, snapshot = $2::jsonb
         WHERE id = 'company' AND version = $1
         RETURNING version, snapshot`,
        [expectedVersion, JSON.stringify(next)],
      );
      if (updated.rowCount === 0) return "conflict";
      const row = updated.rows[0] as { version: number; snapshot: Snapshot };
      return { version: row.version, snapshot: row.snapshot };
    },
    async members() {
      return postgresMembers(pool);
    },
  };
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

async function ensureWorkspaceTable(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS workspace (
      id text PRIMARY KEY,
      version integer NOT NULL,
      snapshot jsonb NOT NULL
    )
  `);
  await pool.query(
    `INSERT INTO workspace (id, version, snapshot)
     VALUES ('company', 1, $1::jsonb)
     ON CONFLICT (id) DO NOTHING`,
    [JSON.stringify(emptySnapshot())],
  );
}

async function loadRow(pool: Pool): Promise<WorkspaceRecord> {
  const result = await pool.query(`SELECT version, snapshot FROM workspace WHERE id = 'company'`);
  const row = result.rows[0] as { version: number; snapshot: Snapshot } | undefined;
  if (!row) return { version: 1, snapshot: emptySnapshot() };
  const built = buildSnapshot(row.snapshot);
  if (!built.ok) throw new Error(built.message);
  return { version: row.version, snapshot: built.snapshot };
}
