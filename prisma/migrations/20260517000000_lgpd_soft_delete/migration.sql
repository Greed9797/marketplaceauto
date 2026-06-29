-- Add soft-delete marker used by the LGPD account deletion request flow.
ALTER TABLE "User" ADD COLUMN "deletedAt" TIMESTAMP(3);
