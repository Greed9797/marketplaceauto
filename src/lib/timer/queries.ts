import "server-only";

import { prisma } from "@/lib/db/prisma";

export type ActiveTimerSession = {
  id: string;
  workspaceId: string;
  workspaceName: string;
  startedAt: Date;
};

export type TimerLogRow = {
  id: string;
  startedAt: Date;
  endedAt: Date | null;
  durationSeconds: number | null;
  note: string | null;
  user: { id: string; name: string | null; email: string };
};

/**
 * The user's currently-running session (endedAt IS NULL), if any. At most one
 * exists thanks to the partial unique index `AccountReviewSession_one_active_per_user`.
 */
export async function getActiveSession(
  userId: string,
): Promise<ActiveTimerSession | null> {
  const session = await prisma.accountReviewSession.findFirst({
    where: { userId, endedAt: null },
    select: {
      id: true,
      workspaceId: true,
      startedAt: true,
      workspace: { select: { name: true } },
    },
  });
  if (!session) return null;
  return {
    id: session.id,
    workspaceId: session.workspaceId,
    workspaceName: session.workspace.name,
    startedAt: session.startedAt,
  };
}

/** All review sessions for a brand, newest first, with the manager's identity. */
export async function listSessions(
  workspaceId: string,
): Promise<TimerLogRow[]> {
  return prisma.accountReviewSession.findMany({
    where: { workspaceId },
    orderBy: { startedAt: "desc" },
    select: {
      id: true,
      startedAt: true,
      endedAt: true,
      durationSeconds: true,
      note: true,
      user: { select: { id: true, name: true, email: true } },
    },
  });
}
