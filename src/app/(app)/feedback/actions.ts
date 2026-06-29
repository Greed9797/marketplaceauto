"use server";

import { redirect } from "next/navigation";

import { logAudit } from "@/lib/audit/log";
import { getCurrentUserContext } from "@/lib/auth/current";
import { prisma } from "@/lib/db/prisma";
import { parseFeedbackFormData } from "@/lib/feedback/schema";

export async function submitFeedbackAction(formData: FormData) {
  const context = await getCurrentUserContext();
  const parsed = parseFeedbackFormData(formData);

  if (!parsed.success) {
    redirect("/feedback?error=invalid");
  }

  const feedback = await prisma.betaFeedback.create({
    data: {
      workspaceId: context.currentWorkspace.id,
      userId: context.user.id,
      type: parsed.data.type,
      message: parsed.data.message,
      pagePath: parsed.data.pagePath,
    },
  });

  await logAudit({
    action: "feedback.submit",
    userId: context.user.id,
    workspaceId: context.currentWorkspace.id,
    resourceType: "betaFeedback",
    resourceId: feedback.id,
    metadata: {
      type: parsed.data.type,
      pagePath: parsed.data.pagePath,
    },
  });

  redirect("/feedback?sent=1");
}
