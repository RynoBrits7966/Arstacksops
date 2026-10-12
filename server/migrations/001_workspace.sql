-- Additive. Safe to run more than once. Does not change or delete existing rows.
CREATE TABLE IF NOT EXISTS workspace (
  id text PRIMARY KEY,
  version integer NOT NULL,
  snapshot jsonb NOT NULL
);

INSERT INTO workspace (id, version, snapshot)
VALUES ('company', 1, '{"version":1,"nextSeq":1,"users":[],"projects":[],"tasks":[],"comments":[],"attachments":[]}'::jsonb)
ON CONFLICT (id) DO NOTHING;
