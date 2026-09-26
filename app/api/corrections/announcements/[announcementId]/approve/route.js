import { correctionsRequestContext } from "@/lib/corrections-access";
import { correctionsError, correctionsResponse } from "@/lib/corrections-http";
import { approveCorrectionsAnnouncement } from "@/lib/corrections-announcements-service";

export async function POST(_request, { params }) {
  const access = await correctionsRequestContext();
  if (!access.ok) return correctionsResponse(access);
  try { return correctionsResponse({ ok: true, announcement: await approveCorrectionsAnnouncement(access, (await params).announcementId) }); }
  catch (error) { return correctionsError(error); }
}
