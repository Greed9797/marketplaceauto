-- Central de otimização de anúncios: galeria de imagens, score de qualidade e
-- origem no Produto; config de IA BYOK por workspace.
ALTER TABLE "Produto"
  ADD COLUMN IF NOT EXISTS "imagens" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "score" INTEGER,
  ADD COLUMN IF NOT EXISTS "scoreBreakdown" JSONB,
  ADD COLUMN IF NOT EXISTS "origem" TEXT NOT NULL DEFAULT 'manual';

CREATE TABLE IF NOT EXISTS "WorkspaceAiConfig" (
  "id"          TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "provider"    TEXT NOT NULL DEFAULT 'gemini',
  "model"       TEXT,
  "keySecretId" TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WorkspaceAiConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "WorkspaceAiConfig_workspaceId_key"
  ON "WorkspaceAiConfig" ("workspaceId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'WorkspaceAiConfig_workspaceId_fkey'
  ) THEN
    ALTER TABLE "WorkspaceAiConfig"
      ADD CONSTRAINT "WorkspaceAiConfig_workspaceId_fkey"
      FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
