#!/usr/bin/env node
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

const ga4 = await prisma.connectorProviderConfig.findFirst({
  where: { provider: "GA4" },
  select: {
    id: true, workspaceId: true, status: true,
    redirectUri: true, scopes: true,
    publicCredentials: true, secretRefs: true,
    lastValidationError: true,
  },
});
console.log(JSON.stringify(ga4, null, 2));

await prisma.$disconnect();
