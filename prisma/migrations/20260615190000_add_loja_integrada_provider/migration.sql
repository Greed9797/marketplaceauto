-- Add LOJA_INTEGRADA to the ConnectorProvider enum (manual commerce connector,
-- Loja Integrada REST API at https://api.awsli.com.br/v1). Idempotent.
ALTER TYPE "ConnectorProvider" ADD VALUE IF NOT EXISTS 'LOJA_INTEGRADA';
