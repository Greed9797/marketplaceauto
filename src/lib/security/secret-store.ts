import { randomUUID } from "node:crypto";

import { Prisma, type PrismaClient } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";

export type SecretRefMap = Record<string, string>;

export type SecretStoreCreateInput = {
  name: string;
  value: string;
  description?: string;
};

export interface SecretStore {
  createSecret(input: SecretStoreCreateInput): Promise<string>;
  updateSecret(id: string, input: SecretStoreCreateInput): Promise<void>;
  getSecret(id: string): Promise<string>;
  deleteSecret(id: string): Promise<void>;
}

export function serializeSecretRefs(
  refs: Record<string, string | null | undefined>,
): SecretRefMap {
  return Object.fromEntries(
    Object.entries(refs).filter((entry): entry is [string, string] =>
      Boolean(entry[1]),
    ),
  );
}

export function secretHandleForPublicPayload(id: string | null | undefined) {
  return { configured: Boolean(id) };
}

export class MemorySecretStore implements SecretStore {
  private readonly secrets = new Map<string, string>();

  async createSecret(input: SecretStoreCreateInput) {
    const id = `mem_${randomUUID()}`;
    this.secrets.set(id, input.value);

    return id;
  }

  async updateSecret(id: string, input: SecretStoreCreateInput) {
    if (!this.secrets.has(id)) {
      throw new Error("Secret not found");
    }
    this.secrets.set(id, input.value);
  }

  async getSecret(id: string) {
    const secret = this.secrets.get(id);
    if (secret === undefined) {
      throw new Error("Secret not found");
    }

    return secret;
  }

  async deleteSecret(id: string) {
    this.secrets.delete(id);
  }
}

export class SupabaseVaultSecretStore implements SecretStore {
  constructor(private readonly client: PrismaClient = prisma) {}

  async createSecret(input: SecretStoreCreateInput) {
    const description = input.description ?? input.name;

    const existing = await this.client.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`
        SELECT id::text AS id FROM vault.secrets WHERE name = ${input.name} LIMIT 1
      `,
    );
    if (existing[0]?.id) {
      await this.client.$executeRaw(Prisma.sql`
        SELECT vault.update_secret(${existing[0].id}::uuid, ${input.value}, ${input.name}, ${description})
      `);
      return existing[0].id;
    }

    const rows = await this.client.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT vault.create_secret(${input.value}, ${input.name}, ${description})::text AS id
    `);
    const id = rows[0]?.id;
    if (!id) {
      throw new Error("Supabase Vault did not return a secret id");
    }

    return id;
  }

  async updateSecret(id: string, input: SecretStoreCreateInput) {
    const description = input.description ?? input.name;
    // vault.update_secret returns void; $queryRaw rejects void columns so we
    // use $executeRaw instead.
    await this.client.$executeRaw(Prisma.sql`
      SELECT vault.update_secret(${id}::uuid, ${input.value}, ${input.name}, ${description})
    `);
  }

  async getSecret(id: string) {
    const rows = await this.client.$queryRaw<
      Array<{ decrypted_secret: string }>
    >(Prisma.sql`
      SELECT decrypted_secret
      FROM vault.decrypted_secrets
      WHERE id = ${id}::uuid
      LIMIT 1
    `);
    const secret = rows[0]?.decrypted_secret;
    if (secret === undefined) {
      throw new Error("Secret not found");
    }

    return secret;
  }

  async deleteSecret(id: string) {
    await this.client.$executeRaw(Prisma.sql`
      DELETE FROM vault.secrets
      WHERE id = ${id}::uuid
    `);
  }
}

export function getSecretStore() {
  if (process.env.NODE_ENV === "test") {
    return new MemorySecretStore();
  }

  return new SupabaseVaultSecretStore();
}
