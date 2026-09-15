import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/access-control";
import { accessDenied } from "@/lib/api-response";
import { syncMusicDistributorConnection } from "@/lib/music-distributor-service";

const schema = z.object({ kind: z.enum(["FULL", "DELTA", "TAKEDOWN", "RECONCILIATION"]).default("DELTA") }).strict();

export async function POST(request, { params }) {
  const access = await requirePlatformAdmin();
  if (!access.ok) return accessDenied(access);
  if (access.user.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Only a Ruvanas Super Admin can synchronise music distributors." }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Choose a valid synchronisation mode." }, { status: 400 });
  try {
    const result = await syncMusicDistributorConnection(prisma, params.connectionId, { kind: parsed.data.kind });
    return NextResponse.json({ result, notice: "Distributor catalogue synchronisation completed." });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Distributor synchronisation failed safely.", code: error?.code || "DISTRIBUTOR_SYNC_FAILED" }, { status: 502 });
  }
}
