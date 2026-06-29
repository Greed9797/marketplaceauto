import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import * as Sentry from "@sentry/nextjs";
import { ConnectorStatus } from "@prisma/client";
import type { MemberRole, PlatformRole, WorkspacePlan } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";

import { auth } from "./auth";
import { getDevBypassEmail } from "./mode";
import {
  isAdminLimited,
  isAdminMaster,
  isTrafficManager,
} from "./platform-permissions";

type CurrentWorkspace = {
  id: string;
  name: string;
  slug: string;
  plan: WorkspacePlan;
  createdAt: Date;
  updatedAt: Date;
};

type CurrentMembership = {
  id: string;
  userId: string;
  workspaceId: string;
  role: MemberRole;
  createdAt: Date;
  workspace: CurrentWorkspace;
};

export type CurrentUserContext = {
  user: {
    id: string;
    email: string;
    name: string | null;
    image?: string | null;
    platformRole: PlatformRole;
  };
  memberships: CurrentMembership[];
  currentMembership: CurrentMembership;
  currentWorkspace: CurrentWorkspace;
};

async function resolveUserId(): Promise<string> {
  const bypassEmail = getDevBypassEmail();
  if (bypassEmail) {
    const user = await prisma.user.findUnique({
      where: { email: bypassEmail },
      select: { id: true },
    });

    if (!user) {
      throw new Error(
        `DEV_AUTH_BYPASS_EMAIL='${bypassEmail}' configured but no user with that email exists. Run \`npm run db:seed\` first.`,
      );
    }

    return user.id;
  }

  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  return session.user.id;
}

export type ConnectorWorkspaceAccess = {
  user: { id: string; platformRole: PlatformRole };
  workspace: CurrentWorkspace;
  role: MemberRole;
};

/**
 * Resolves which workspace an OAuth connector flow must attach to — using the
 * workspaceId carried in the HMAC-signed OAuth state, NOT the request cookie.
 *
 * The workspace selection cookie is dropped by browsers on the cross-site
 * redirect back from Google/Shopify/Nuvemshop, so `getCurrentUserContext`
 * falls back to the user's first workspace. Connector callbacks must instead
 * trust the signed state and re-validate access here against the DB.
 *
 * Returns null when the workspace does not exist or the user has no
 * connector-operate rights on it.
 */
export async function resolveConnectorWorkspaceAccess(input: {
  userId: string;
  workspaceId: string;
}): Promise<ConnectorWorkspaceAccess | null> {
  const [user, workspace, membership] = await Promise.all([
    prisma.user.findUnique({
      where: { id: input.userId },
      select: { id: true, platformRole: true },
    }),
    prisma.workspace.findUnique({ where: { id: input.workspaceId } }),
    prisma.membership.findFirst({
      where: { userId: input.userId, workspaceId: input.workspaceId },
      select: { role: true },
    }),
  ]);

  if (!user || !workspace) {
    return null;
  }

  const platformUser = { platformRole: user.platformRole };
  const isInternal =
    isAdminMaster(platformUser) ||
    isAdminLimited(platformUser) ||
    isTrafficManager(platformUser);

  // Internal/admin users may not hold an explicit membership row but still
  // operate connectors. Synthesize OWNER for them; otherwise require a real
  // membership with operate rights.
  const role: MemberRole | null =
    membership?.role ?? (isInternal ? "OWNER" : null);
  if (role === null) {
    return null;
  }

  return {
    user: { id: user.id, platformRole: user.platformRole },
    workspace,
    role,
  };
}

/**
 * Picks which workspace membership becomes the active one for a request.
 *
 * Priority:
 * 1. The workspace named by the `adstart_workspace_id` cookie, when the user
 *    is a member of it (explicit user choice — always wins).
 * 2. Otherwise, when the user has multiple workspaces and connector counts are
 *    provided, the workspace with the most ACTIVE connectors. This stops a
 *    fresh browser/session (no cookie) from landing on an empty leftover
 *    workspace while the real data lives in another.
 * 3. Fallback: `memberships[0]` (oldest, since the query orders by createdAt
 *    asc), which also breaks ties — the oldest populated workspace wins.
 *
 * Pure and synchronous so it can be unit-tested without mocking prisma/cookies.
 */
export function pickDefaultMembership<T extends { workspaceId: string }>(args: {
  memberships: T[];
  selectedWorkspaceId?: string;
  connectorCountByWorkspace?: ReadonlyMap<string, number>;
}): T {
  const { memberships, selectedWorkspaceId, connectorCountByWorkspace } = args;

  const cookieMembership = selectedWorkspaceId
    ? memberships.find((m) => m.workspaceId === selectedWorkspaceId)
    : undefined;
  if (cookieMembership) {
    return cookieMembership;
  }

  if (memberships.length <= 1 || !connectorCountByWorkspace) {
    return memberships[0];
  }

  return memberships.reduce(
    (best, membership) =>
      (connectorCountByWorkspace.get(membership.workspaceId) ?? 0) >
      (connectorCountByWorkspace.get(best.workspaceId) ?? 0)
        ? membership
        : best,
    memberships[0],
  );
}

export async function getCurrentUserContext(): Promise<CurrentUserContext> {
  const userId = await resolveUserId();

  const cookieStore = await cookies();
  const selectedWorkspaceId = cookieStore.get("adstart_workspace_id")?.value;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      memberships: {
        orderBy: { createdAt: "asc" },
        include: {
          // Select only the CurrentWorkspace fields (not `true`/star) so the
          // potentially-large `metadata` JSON column is never loaded — this
          // query runs on EVERY authenticated request via AppLayout.
          workspace: {
            select: {
              id: true,
              name: true,
              slug: true,
              plan: true,
              createdAt: true,
              updatedAt: true,
            },
          },
        },
      },
    },
  });

  if (!user) {
    redirect("/login");
  }

  const cookieMembership = selectedWorkspaceId
    ? user.memberships.find(
        (membership) => membership.workspaceId === selectedWorkspaceId,
      )
    : undefined;

  // No valid workspace cookie + multiple workspaces: the oldest workspace
  // (memberships[0], ordered createdAt asc) may be an empty leftover while the
  // real data lives in another. Fetch ACTIVE connector counts so the picker can
  // prefer the populated workspace. Only runs when there's no cookie hit, so the
  // common path pays nothing.
  let connectorCountByWorkspace: Map<string, number> | undefined;
  if (!cookieMembership && user.memberships.length > 1) {
    // A transient DB/pool failure here must NOT take down the whole app via the
    // root error boundary. On failure, fall through with no counts so
    // pickDefaultMembership uses memberships[0] (oldest) instead of throwing.
    try {
      const connectorCounts = await prisma.connectorAccount.groupBy({
        by: ["workspaceId"],
        where: {
          workspaceId: { in: user.memberships.map((m) => m.workspaceId) },
          status: ConnectorStatus.ACTIVE,
        },
        _count: { _all: true },
      });
      connectorCountByWorkspace = new Map(
        connectorCounts.map((row) => [row.workspaceId, row._count._all]),
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "unknown";
      console.error(
        `[getCurrentUserContext] connector-count fallback failed: ${message}`,
      );
    }
  }

  let currentMembership = pickDefaultMembership({
    memberships: user.memberships,
    selectedWorkspaceId,
    connectorCountByWorkspace,
  });

  const platformUser = { platformRole: user.platformRole };
  const syntheticRole: MemberRole = isTrafficManager(platformUser)
    ? "VIEWER"
    : "OWNER";
  const canUseSyntheticWorkspace =
    isAdminMaster(platformUser) ||
    isAdminLimited(platformUser) ||
    isTrafficManager(platformUser);

  if (!currentMembership && canUseSyntheticWorkspace && selectedWorkspaceId) {
    const workspace = await prisma.workspace.findUnique({
      where: { id: selectedWorkspaceId },
    });

    if (workspace) {
      currentMembership = {
        id: `platform-admin:${workspace.id}`,
        userId: user.id,
        workspaceId: workspace.id,
        role: syntheticRole,
        createdAt: new Date(0),
        workspace,
      };
    }
  }

  if (
    canUseSyntheticWorkspace &&
    selectedWorkspaceId &&
    currentMembership?.workspaceId !== selectedWorkspaceId
  ) {
    const workspace = await prisma.workspace.findUnique({
      where: { id: selectedWorkspaceId },
    });

    if (workspace) {
      currentMembership = {
        id: `platform-admin:${workspace.id}`,
        userId: user.id,
        workspaceId: workspace.id,
        role: syntheticRole,
        createdAt: new Date(0),
        workspace,
      };
    }
  }

  if (!currentMembership && canUseSyntheticWorkspace) {
    const workspace = await prisma.workspace.findFirst({
      orderBy: { createdAt: "asc" },
    });

    if (workspace) {
      currentMembership = {
        id: `platform-admin:${workspace.id}`,
        userId: user.id,
        workspaceId: workspace.id,
        role: syntheticRole,
        createdAt: new Date(0),
        workspace,
      };
    }
  }

  if (!currentMembership) {
    redirect("/sign-up");
  }

  // Tag server-side errors with the tenant dimension so Sentry issues are
  // triageable per user/workspace. No-op when Sentry isn't initialized.
  Sentry.setUser({ id: user.id });
  Sentry.setTag("workspace_id", currentMembership.workspaceId);

  const memberships =
    canUseSyntheticWorkspace &&
    !user.memberships.some(
      (membership) => membership.workspaceId === currentMembership.workspaceId,
    )
      ? [currentMembership, ...user.memberships]
      : user.memberships;

  return {
    user,
    memberships,
    currentMembership,
    currentWorkspace: currentMembership.workspace,
  };
}
