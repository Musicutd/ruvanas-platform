import { z } from "zod";

export const complimentaryAccessCreateSchema = z.object({
  mode: z.enum(["DIRECT", "CODE"]).default("DIRECT"),
  organisationId: z.string().cuid().optional(),
  recipientEmail: z.string().trim().toLowerCase().email().max(320).optional(),
  // Public plans use stable IDs such as "public-plan-retail-enterprise", not CUIDs.
  planId: z.string().trim().min(1).max(120),
  note: z.string().trim().max(160).optional().nullable()
}).strict().superRefine((value, context) => {
  if (value.mode === "DIRECT" && !value.organisationId) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["organisationId"], message: "Choose a client organisation." });
  }
  if (value.mode === "CODE" && !value.recipientEmail) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["recipientEmail"], message: "Enter the eligible recipient's email." });
  }
});
