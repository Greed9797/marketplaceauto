-- Drop NOT NULL on the legacy plaintext token column and add a hashed column.
-- New invites set only `tokenHash`; legacy invites keep `token` and continue
-- resolving via fallback lookup until they expire or are accepted.
ALTER TABLE "w3ads"."WorkspaceInvite"
  ALTER COLUMN "token" DROP NOT NULL;

ALTER TABLE "w3ads"."WorkspaceInvite"
  ADD COLUMN IF NOT EXISTS "tokenHash" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "WorkspaceInvite_tokenHash_key"
  ON "w3ads"."WorkspaceInvite" ("tokenHash");
