import { NextResponse } from "next/server";

export function correctionsResponse(result, status = result?.status || 200) {
  return NextResponse.json(result, { status });
}

export function correctionsError(error, fallback = "This Corrections action could not be completed.") {
  if (error?.code === "P2002") return correctionsResponse({ error: "This record already exists or was reviewed by another request." }, 409);
  if (error?.constructor === Error && typeof error.message === "string" && error.message.length <= 220) {
    const status = /permission|not active|not available/i.test(error.message) ? 403 : /already|current|before|Wait|review|changed/i.test(error.message) ? 409 : 400;
    return correctionsResponse({ error: error.message }, status);
  }
  console.error("Corrections request failed:", error);
  return correctionsResponse({ error: fallback }, 500);
}
