import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/access-control";
import { accessDenied } from "@/lib/api-response";
import { deliverMusicDistributorUsage } from "@/lib/music-distributor-service";

const schema = z.object({ periodFrom: z.coerce.date(), periodUntil: z.coerce.date() }).strict().refine((value) => value.periodFrom < value.periodUntil, "The report end must be after its start.");

export async function POST(request, { params }) {
  const access = await requirePlatformAdmin();
  if (!access.ok) return accessDenied(access);
  if (access.user.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Only a Ruvanas Super Admin can deliver distributor usage reports." }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Choose a valid report period." }, { status: 400 });
  try {
    const result = await deliverMusicDistributorUsage(prisma, params.connectionId, parsed.data);
    return NextResponse.json({ result, notice: "Usage evidence was delivered without subscriber identities." });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Usage delivery failed safely.", code: error?.code || "DISTRIBUTOR_USAGE_FAILED" }, { status: 502 });
  }
}
