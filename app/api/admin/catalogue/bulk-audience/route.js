import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/access-control";
import { accessDenied } from "@/lib/api-response";
import { CatalogueBulkAudienceError, updateCatalogueTiers } from "@/lib/catalogue-bulk-audience.mjs";

export const dynamic = "force-dynamic";

export async function POST(request) {
  const access = await requirePlatformAdmin();
  if (!access.ok) return accessDenied(access);
  if (access.user.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Only a Ruvanas Super Admin can change catalogue access." }, { status: 403 });
  let input;
  try { input = await request.json(); }
  catch { return NextResponse.json({ error: "Choose catalogue tracks and a tier." }, { status: 400 }); }
  try {
    return NextResponse.json(await updateCatalogueTiers(prisma, access.user, input), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof CatalogueBulkAudienceError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error?.code === "P2034" || (error?.code === "P2010" && error?.meta?.code === "40001")) return NextResponse.json({ error: "The catalogue is being updated. Refresh and try again." }, { status: 409 });
    throw error;
  }
}
