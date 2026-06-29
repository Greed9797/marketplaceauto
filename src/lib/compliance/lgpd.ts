import type { MemberRole } from "@prisma/client";

export type UserDataExportInput = {
  user: {
    id: string;
    email: string;
    name: string | null;
  };
  workspaces: Array<{
    id: string;
    name: string;
    role: MemberRole;
  }>;
  generatedAt?: Date;
};

export function maskEmail(email: string) {
  const [local, domain] = email.split("@");
  if (!local || !domain) {
    return "***";
  }

  if (local.length <= 1) {
    return `${local}***@${domain}`;
  }

  return `${local[0]}***${local.at(-1)}@${domain}`;
}

export function buildUserDataExport(input: UserDataExportInput) {
  return {
    generatedAt: (input.generatedAt ?? new Date()).toISOString(),
    user: input.user,
    workspaces: input.workspaces,
  };
}

export function validateDeleteConfirmation(email: string, confirmation: string) {
  return confirmation === email;
}
