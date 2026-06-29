import { z } from "zod";

export const feedbackTypes = ["BUG", "SUGGESTION", "QUESTION"] as const;

export type FeedbackType = (typeof feedbackTypes)[number];

export const feedbackFormSchema = z.object({
  type: z.enum(feedbackTypes).default("SUGGESTION"),
  message: z.string().trim().min(10).max(2000),
  pagePath: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((value) =>
      value && value.startsWith("/") && !value.startsWith("//") ? value : undefined,
    ),
});

export type FeedbackFormInput = z.infer<typeof feedbackFormSchema>;

type FeedbackParseResult =
  | {
      success: true;
      data: FeedbackFormInput;
    }
  | {
      success: false;
      error: z.ZodError;
    };

function getString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

export function normalizeFeedbackPagePath(value: string | undefined) {
  const trimmed = value?.trim();

  return trimmed && trimmed.length <= 200 && trimmed.startsWith("/") && !trimmed.startsWith("//")
    ? trimmed
    : undefined;
}

export function parseFeedbackFormData(formData: FormData): FeedbackParseResult {
  const parsed = feedbackFormSchema.safeParse({
    type: getString(formData, "type") || "SUGGESTION",
    message: getString(formData, "message"),
    pagePath: normalizeFeedbackPagePath(getString(formData, "pagePath")),
  });

  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error,
    };
  }

  return {
    success: true,
    data: parsed.data,
  };
}
