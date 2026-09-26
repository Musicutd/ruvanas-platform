import { correctionsRequestContext } from "@/lib/corrections-access";
import { correctionsError, correctionsResponse } from "@/lib/corrections-http";
import { scheduleCorrectionsAnnouncement } from "@/lib/corrections-announcements-service";

export async function POST(request, { params }) {
  const access = await correctionsRequestContext();
  if (!access.ok) return correctionsResponse(access);
  try { return correctionsResponse({ ok: true, delivery: await scheduleCorrectionsAnnouncement(access, (await params).announcementId, await request.json()) }); }
  catch (error) { return correctionsError(error); }
}
