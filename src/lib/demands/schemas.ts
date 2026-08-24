import { z } from "zod";

const cuidSchema = z.string().trim().min(1).max(64);
const uuidSchema = z.string().uuid();

export const createDemandTaskSchema = z
  .object({
    title: z.string().trim().min(3).max(140),
    description: z.string().trim().max(1200).optional(),
    categoryId: cuidSchema,
    assigneeId: cuidSchema,
  })
  .strict();

export const createDemandCategorySchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    targetMinutes: z.coerce.number().int().min(1).max(24 * 60),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  })
  .strict();

export const demandTaskIdSchema = cuidSchema;

export const demandNotificationConfigSchema = z
  .object({
    enabled: z.boolean(),
    mcrmBaseUrl: z.string().trim().url().max(500).nullable(),
    mcrmToken: z.string().trim().min(20).max(1000).nullable(),
    generalGroupConversationId: uuidSchema.nullable(),
  })
  .strict();

export const demandMemberProfileSchema = z
  .object({
    userId: cuidSchema,
    leaderUserId: cuidSchema.nullable(),
    mcrmConversationId: uuidSchema.nullable(),
  })
  .strict();
