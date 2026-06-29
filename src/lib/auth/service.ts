import { addMinutes } from "date-fns";

import { logAudit } from "@/lib/audit/log";
import { prisma } from "@/lib/db/prisma";
import { sendTransactionalEmail } from "@/lib/email/resend";
import { createSecureToken, hashToken } from "@/lib/utils/tokens";

import { hashPassword, verifyPassword } from "./password";
import type {
  ForgotPasswordInput,
  ResetPasswordInput,
  SignUpInput,
  WorkspaceCreateInput,
  WorkspaceInviteInput,
} from "./schemas";
import { createWorkspaceSlug } from "./workspace";

export class AuthServiceError extends Error {
  constructor(
    message: string,
    public readonly code: "EMAIL_IN_USE" | "INVALID_TOKEN" | "USER_NOT_FOUND",
  ) {
    super(message);
  }
}

/**
 * Resolves an invite from the plaintext token the user pasted in the URL.
 * Prefers the hashed lookup (new invites) and falls back to the legacy
 * plaintext column (invites issued before tokenHash existed).
 */
async function findInviteByToken(plainToken: string) {
  const tokenHash = hashToken(plainToken);
  const select = {
    id: true,
    workspaceId: true,
    role: true,
    email: true,
    acceptedAt: true,
    expiresAt: true,
  } as const;

  const byHash = await prisma.workspaceInvite.findUnique({
    where: { tokenHash },
    select,
  });
  if (byHash) return byHash;

  return prisma.workspaceInvite.findUnique({
    where: { token: plainToken },
    select,
  });
}

export async function createDatabaseSessionForUser(userId: string) {
  const sessionToken = createSecureToken();
  const now = new Date();
  const expires = addMinutes(now, 60 * 24 * 30);

  await prisma.session.create({
    data: {
      userId,
      sessionToken,
      expires,
      lastSeenAt: now,
    },
  });

  await logAudit({
    action: "auth.login",
    userId,
    resourceType: "user",
    resourceId: userId,
  });

  return {
    sessionToken,
    expires,
  };
}

async function createUniqueWorkspaceSlug(workspaceName: string) {
  const baseSlug = createWorkspaceSlug(workspaceName);
  let candidate = baseSlug;
  let suffix = 2;

  while (await prisma.workspace.findUnique({ where: { slug: candidate } })) {
    candidate = `${baseSlug}-${suffix}`;
    suffix += 1;
  }

  return candidate;
}

function defaultDashboardCreateInput(ownerId: string) {
  return {
    ownerId,
    name: "Performance Geral",
    isDefault: true,
    layout: { columns: 12, rows: [] },
    widgets: {
      items: ["revenue", "ad_spend", "blended_roas", "orders"],
    },
  };
}

export async function createWorkspaceForUser(input: {
  userId: string;
  values: WorkspaceCreateInput;
}) {
  const slug = await createUniqueWorkspaceSlug(input.values.name);

  return prisma.$transaction(async (tx) => {
    const workspace = await tx.workspace.create({
      data: {
        name: input.values.name,
        slug,
        dashboards: {
          create: defaultDashboardCreateInput(input.userId),
        },
        memberships: {
          create: {
            userId: input.userId,
            role: "OWNER",
          },
        },
      },
      include: {
        memberships: true,
      },
    });

    await tx.auditLog.create({
      data: {
        action: "workspace.create",
        userId: input.userId,
        workspaceId: workspace.id,
        resourceType: "workspace",
        resourceId: workspace.id,
        metadata: {
          workspaceSlug: slug,
        },
      },
    });

    return workspace;
  });
}

export async function registerUserWithWorkspace(input: SignUpInput) {
  const existingUser = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true },
  });

  if (existingUser) {
    throw new AuthServiceError("Email ja cadastrado.", "EMAIL_IN_USE");
  }

  const passwordHash = await hashPassword(input.password);
  const invite = input.inviteToken
    ? await findInviteByToken(input.inviteToken)
    : null;

  if (
    input.inviteToken &&
    (!invite || invite.acceptedAt || invite.expiresAt < new Date())
  ) {
    throw new AuthServiceError(
      "Convite invalido ou expirado.",
      "INVALID_TOKEN",
    );
  }

  // Bind the invite to its intended recipient: a leaked/forwarded invite URL
  // must NOT let someone register under a different email and inherit the
  // invite's role (workspace takeover). Same opaque error as above.
  if (invite && invite.email.toLowerCase() !== input.email.toLowerCase()) {
    throw new AuthServiceError(
      "Convite invalido ou expirado.",
      "INVALID_TOKEN",
    );
  }

  const workspaceSlug = invite
    ? null
    : await createUniqueWorkspaceSlug(input.workspaceName);

  return prisma.$transaction(async (tx) => {
    if (invite) {
      const user = await tx.user.create({
        data: {
          email: input.email,
          name: input.name,
          passwordHash,
          memberships: {
            create: {
              role: invite.role,
              workspaceId: invite.workspaceId,
            },
          },
        },
        include: {
          memberships: {
            include: {
              workspace: true,
            },
          },
        },
      });

      await tx.workspaceInvite.update({
        where: { id: invite.id },
        data: { acceptedAt: new Date() },
      });

      await tx.auditLog.create({
        data: {
          action: "auth.signup",
          userId: user.id,
          workspaceId: invite.workspaceId,
          resourceType: "workspace_invite",
          resourceId: invite.id,
          metadata: {
            role: invite.role,
          },
        },
      });

      return user;
    }

    const user = await tx.user.create({
      data: {
        email: input.email,
        name: input.name,
        passwordHash,
        memberships: {
          create: {
            role: "OWNER",
            workspace: {
              create: {
                name: input.workspaceName,
                slug: workspaceSlug ?? createWorkspaceSlug(input.workspaceName),
                dashboards: {
                  create: defaultDashboardCreateInput("pending"),
                },
              },
            },
          },
        },
      },
      include: {
        memberships: {
          include: {
            workspace: true,
          },
        },
      },
    });

    const workspace = user.memberships[0]?.workspace;

    if (workspace) {
      await tx.dashboard.updateMany({
        where: {
          workspaceId: workspace.id,
          ownerId: "pending",
        },
        data: {
          ownerId: user.id,
        },
      });

      await tx.auditLog.create({
        data: {
          action: "auth.signup",
          userId: user.id,
          workspaceId: workspace.id,
          resourceType: "workspace",
          resourceId: workspace.id,
          metadata: {
            workspaceSlug,
          },
        },
      });
    }

    return user;
  });
}

export async function getUserByCredentials(email: string, password: string) {
  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      name: true,
      image: true,
      passwordHash: true,
      deletedAt: true,
    },
  });

  if (!user?.passwordHash || user.deletedAt) {
    return null;
  }

  const isValidPassword = await verifyPassword(password, user.passwordHash);

  if (!isValidPassword) {
    return null;
  }

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    image: user.image,
  };
}

export async function requestPasswordReset(input: ForgotPasswordInput) {
  const user = await prisma.user.findFirst({
    // Ignore soft-deleted accounts: a tombstoned account must not be
    // resurrectable via a fresh reset token.
    where: { email: input.email, deletedAt: null },
    select: { id: true, email: true, name: true },
  });

  if (!user) {
    return;
  }

  const token = createSecureToken();
  const tokenHash = hashToken(token);
  const expiresAt = addMinutes(new Date(), 30);

  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash,
      expiresAt,
    },
  });

  const appUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  const resetUrl = `${appUrl}/reset-password?token=${token}`;

  await sendTransactionalEmail({
    to: user.email,
    subject: "Redefinir senha do Adstart W3",
    html: `<p>Recebemos uma solicitacao para redefinir sua senha.</p><p><a href="${resetUrl}">Redefinir senha</a></p><p>O link expira em 30 minutos.</p>`,
  });

  await logAudit({
    action: "auth.password_reset.request",
    userId: user.id,
    resourceType: "user",
    resourceId: user.id,
  });
}

export async function resetPassword(input: ResetPasswordInput) {
  const tokenHash = hashToken(input.token);
  const resetToken = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (!resetToken || resetToken.usedAt || resetToken.expiresAt < new Date()) {
    throw new AuthServiceError("Token invalido ou expirado.", "INVALID_TOKEN");
  }

  const passwordHash = await hashPassword(input.password);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: resetToken.userId },
      data: { passwordHash },
    }),
    prisma.passwordResetToken.update({
      where: { id: resetToken.id },
      data: { usedAt: new Date() },
    }),
    // Revoke every existing session on password reset: if an attacker holds a
    // stolen cookie, the victim's reset must lock them out (credential-rotation
    // hygiene). The user re-logs in with the new password.
    prisma.session.deleteMany({
      where: { userId: resetToken.userId },
    }),
    prisma.auditLog.create({
      data: {
        action: "auth.password_reset.complete",
        userId: resetToken.userId,
        resourceType: "user",
        resourceId: resetToken.userId,
      },
    }),
  ]);
}

export async function createWorkspaceInvite(input: {
  workspaceId: string;
  invitedById: string;
  values: WorkspaceInviteInput;
}) {
  const token = createSecureToken();
  const tokenHash = hashToken(token);
  const expiresAt = addMinutes(new Date(), 60 * 24 * 7);

  const invite = await prisma.workspaceInvite.create({
    data: {
      workspaceId: input.workspaceId,
      invitedById: input.invitedById,
      email: input.values.email,
      role: input.values.role,
      // `token` (plaintext) stays null for new invites. Hash only.
      token: null,
      tokenHash,
      expiresAt,
    },
    include: {
      workspace: {
        select: { name: true },
      },
    },
  });

  const appUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  // Email the plaintext token; only the hash lives in the database.
  const inviteUrl = `${appUrl}/sign-up?invite=${token}`;

  await sendTransactionalEmail({
    to: invite.email,
    subject: `Convite para ${invite.workspace.name} no Adstart W3`,
    html: `<p>Voce foi convidado para acessar o workspace ${invite.workspace.name}.</p><p><a href="${inviteUrl}">Aceitar convite</a></p>`,
  });

  await logAudit({
    action: "workspace.member.invite",
    userId: input.invitedById,
    workspaceId: input.workspaceId,
    resourceType: "workspace_invite",
    resourceId: invite.id,
    metadata: {
      email: invite.email,
      role: invite.role,
    },
  });

  return invite;
}
