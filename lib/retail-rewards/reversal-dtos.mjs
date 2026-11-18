import { z } from "zod";
import { rewardIdSchema } from "./contracts.mjs";
import { checkoutReceiptSchema } from "./checkout-dtos.mjs";
import { REVERSAL_WINDOW_MS } from "./reversal-contracts.mjs";
const ok = { ok: z.literal(true) }, date = z.iso.datetime({ offset: false }).refine(value => Number.isFinite(Date.parse(value)));
const schemas = {
  locations: z.object({ ...ok, locations: z.array(z.object({ id: rewardIdSchema, name: z.string().min(1).max(191) }).strict()).max(25),
    page: z.number().int().min(1).max(1000), hasMore: z.boolean() }).strict(),
  inspect: z.object({ ...ok, receipt: checkoutReceiptSchema, canReverse: z.boolean(), deadline: date }).strict()
    .refine(value => (!value.canReverse || value.receipt.reversal === null) &&
      Date.parse(value.deadline) === Date.parse(value.receipt.redeemedAt) + REVERSAL_WINDOW_MS),
  reverse: z.object({ ...ok, receipt: checkoutReceiptSchema.refine(value => value.reversal !== null) }).strict()
};
export function safeReversalResult(operation, value) {
  const parsed = schemas[operation]?.safeParse(value); return parsed?.success ? parsed.data : null;
}
