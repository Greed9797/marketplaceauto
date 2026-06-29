import {
  PrismaClient,
  type PlatformRole,
  type MemberRole,
} from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

type SeedUser = {
  email: string;
  name: string;
  password: string;
  platformRole: PlatformRole;
  membership: { role: MemberRole };
};

const WORKSPACE_SLUG = "w3-dev";
const WORKSPACE_NAME = "W3 Dev";

const USERS: SeedUser[] = [
  {
    email: "gustavo@w3ads.local",
    name: "Gustavo (Master)",
    password: "master123",
    platformRole: "ADMIN_MASTER",
    membership: { role: "OWNER" },
  },
  {
    email: "gestor.contas@w3ads.local",
    name: "Gestor de Contas",
    password: "contas123",
    platformRole: "ADMIN_LIMITED",
    membership: { role: "ADMIN" },
  },
  {
    email: "gestor.trafego@w3ads.local",
    name: "Gestor de Tráfego",
    password: "trafego123",
    platformRole: "TRAFFIC_MANAGER",
    membership: { role: "VIEWER" },
  },
  {
    email: "cliente@w3ads.local",
    name: "Cliente",
    password: "cliente123",
    platformRole: "USER",
    membership: { role: "CLIENT" },
  },
];

async function main() {
  const workspace = await prisma.workspace.upsert({
    where: { slug: WORKSPACE_SLUG },
    update: { name: WORKSPACE_NAME },
    create: {
      name: WORKSPACE_NAME,
      slug: WORKSPACE_SLUG,
      plan: "AGENCY",
    },
  });
  console.log(`Workspace: ${workspace.slug} (id=${workspace.id})`);

  for (const seedUser of USERS) {
    const passwordHash = await bcrypt.hash(seedUser.password, 10);

    const user = await prisma.user.upsert({
      where: { email: seedUser.email },
      update: {
        name: seedUser.name,
        passwordHash,
        platformRole: seedUser.platformRole,
        emailVerified: new Date(),
      },
      create: {
        email: seedUser.email,
        name: seedUser.name,
        passwordHash,
        platformRole: seedUser.platformRole,
        emailVerified: new Date(),
      },
    });

    await prisma.membership.upsert({
      where: {
        userId_workspaceId: {
          userId: user.id,
          workspaceId: workspace.id,
        },
      },
      update: { role: seedUser.membership.role },
      create: {
        userId: user.id,
        workspaceId: workspace.id,
        role: seedUser.membership.role,
      },
    });

    console.log(
      `  ${user.email.padEnd(32)} platformRole=${seedUser.platformRole.padEnd(16)} membership=${seedUser.membership.role}`,
    );
  }

  console.log("\nLogin credentials (dev only):");
  for (const seedUser of USERS) {
    console.log(`  ${seedUser.email}  /  ${seedUser.password}`);
  }
  console.log(
    `\nSet DEV_AUTH_BYPASS_EMAIL=<one of the emails above> in .env to auto-login.`,
  );
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
