import { z } from "zod";

const optionalFormCuid = z.preprocess(
  (value) => typeof value === "string" && value.trim() === "" ? null : value,
  z.string().cuid().nullish()
);

export const createMultitrackProjectSchema = z.object({
  title: z.string().trim().min(2).max(160),
  programmeId: optionalFormCuid,
  episodeId: optionalFormCuid,
  studentGroupId: optionalFormCuid
});
