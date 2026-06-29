/**
 * One-off: clone OWNER access from an existing account to a new one.
 *
 * Creates `gustavo@w3trafegopago.com.br` (password master123) if missing, then
 * grants it an OWNER Membership on EVERY workspace where `gustavo@w3ads.local`
 * is OWNER. Data stays in the workspaces and is now shared with the new owner.
 *
 * Non-destructive + idempotent: only upserts the user and memberships. Never
 * deletes, never touches the old owner, never overwrites an existing password.
 *
 * Run: node scripts/_grant-owner-access.mjs
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const OLD_OWNER_EMAIL = "gustavo@w3ads.local";
const NEW_OWNER_EMAIL = "gustavo@w3trafegopago.com.br";
const NEW_OWNER_PASSWORD = "master123";
const NEW_OWNER_NAME = "Gustavo";
const SALT_ROUNDS = 12; // matches src/lib/auth/password.ts

async function main() {
  const oldOwner = await prisma.user.findUnique({
    where: { email: OLD_OWNER_EMAIL },
    include: {
      memberships: {
        where: { role: "OWNER" },
        select: { workspaceId: true, workspace: { select: { name: true } } },
      },
    },
  });

  if (!oldOwner) {
    throw new Error(`Old owner ${OLD_OWNER_EMAIL} not found — aborting.`);
  }

  const ownerWorkspaces = oldOwner.memberships;
  console.log(
    `Old owner ${OLD_OWNER_EMAIL} is OWNER of ${ownerWorkspaces.length} workspace(s).`,
  );

  const existing = await prisma.user.findUnique({
    where: { email: NEW_OWNER_EMAIL },
    select: { id: true },
  });

  let newUserId;
  if (existing) {
    newUserId = existing.id;
    console.log(
      `User ${NEW_OWNER_EMAIL} already existed (id=${newUserId}) — password left as-is.`,
    );
  } else {
    const passwordHash = await bcrypt.hash(NEW_OWNER_PASSWORD, SALT_ROUNDS);
    const created = await prisma.user.create({
      data: {
        email: NEW_OWNER_EMAIL,
        name: NEW_OWNER_NAME,
        passwordHash,
        platformRole: "USER",
      },
      select: { id: true },
    });
    newUserId = created.id;
    console.log(
      `Created user ${NEW_OWNER_EMAIL} (id=${newUserId}) with password master123.`,
    );
  }

  let added = 0;
  let alreadyHad = 0;
  for (const membership of ownerWorkspaces) {
    const before = await prisma.membership.findUnique({
      where: {
        userId_workspaceId: {
          userId: newUserId,
          workspaceId: membership.workspaceId,
        },
      },
      select: { id: true },
    });
    await prisma.membership.upsert({
      where: {
        userId_workspaceId: {
          userId: newUserId,
          workspaceId: membership.workspaceId,
        },
      },
      update: { role: "OWNER" },
      create: {
        userId: newUserId,
        workspaceId: membership.workspaceId,
        role: "OWNER",
      },
    });
    if (before) {
      alreadyHad += 1;
    } else {
      added += 1;
      console.log(`  + OWNER on "${membership.workspace.name}"`);
    }
  }

  console.log(
    `\nDone. ${added} new OWNER membership(s) added, ${alreadyHad} already present. Nothing deleted.`,
  );
}

main()
  .catch((err) => {
    console.error("FAILED:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
