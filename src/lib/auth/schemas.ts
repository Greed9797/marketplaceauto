import { z } from "zod";

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email("Informe um email valido.");

const passwordSchema = z
  .string()
  .min(10, "A senha precisa ter pelo menos 10 caracteres.")
  .max(128, "A senha precisa ter no maximo 128 caracteres.");

const acceptedTermsSchema = z.preprocess(
  (value) => value === true || value === "on" || value === "true",
  z.boolean().refine((value) => value, "Aceite os termos para criar a conta."),
);

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Informe sua senha."),
});

export const signUpSchema = z.object({
  name: z.string().trim().min(2, "Informe seu nome.").max(120),
  email: emailSchema,
  password: passwordSchema,
  workspaceName: z.string().trim().min(2, "Informe o nome da empresa.").max(120),
  acceptedTerms: acceptedTermsSchema,
  inviteToken: z.string().optional(),
});

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

export const resetPasswordSchema = z.object({
  token: z.string().min(32),
  password: passwordSchema,
});

export const workspaceInviteSchema = z.object({
  email: emailSchema,
  role: z.enum(["ADMIN", "VIEWER", "CLIENT"]),
});

export const workspaceCreateSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome do workspace.").max(120),
});

export const workspaceSettingsSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome do workspace.").max(120),
});

export const workspaceMemberRoleSchema = z.object({
  membershipId: z.string().min(1),
  role: z.enum(["ADMIN", "VIEWER", "CLIENT"]),
});

export const platformUserCreateSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome.").max(120),
  email: emailSchema,
  password: passwordSchema,
  platformRole: z.enum(["ADMIN_MASTER", "ADMIN_LIMITED", "TRAFFIC_MANAGER", "USER"]),
  workspaceId: z.string().optional(),
  membershipRole: z.enum(["CLIENT"]).optional(),
});

export const workspaceMemberRemoveSchema = z.object({
  membershipId: z.string().min(1),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type SignUpInput = z.infer<typeof signUpSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type WorkspaceInviteInput = z.infer<typeof workspaceInviteSchema>;
export type WorkspaceCreateInput = z.infer<typeof workspaceCreateSchema>;
export type WorkspaceSettingsInput = z.infer<typeof workspaceSettingsSchema>;
export type WorkspaceMemberRoleInput = z.infer<typeof workspaceMemberRoleSchema>;
export type WorkspaceMemberRemoveInput = z.infer<typeof workspaceMemberRemoveSchema>;
export type PlatformUserCreateInput = z.infer<typeof platformUserCreateSchema>;
