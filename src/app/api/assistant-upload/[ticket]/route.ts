import { NextResponse } from "next/server";
import { receivePart } from "@/core/services/assistantUploads";

export const dynamic = "force-dynamic";

// One-time address of an assistant upload (core 0.18.0, see core/services/assistantUploads.ts): raw bytes in the body, 8 MB per request, `?offset=` for the
// next part. It only fills a staging slot opened by an MCP tool; the file is checked and stored by that tool's finish step. Never cached, never referred.
const HEADERS = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" };

async function put(request: Request, { params }: { params: Promise<{ ticket: string }> }) {
  const { ticket } = await params;
  const raw = request.headers.get("content-length");
  const length = raw !== null && /^\d{1,12}$/.test(raw) ? Number(raw) : null;
  const r = await receivePart(ticket, new URL(request.url).searchParams.get("offset"), request.body, length);
  return NextResponse.json(r.body, { status: r.status, headers: HEADERS });
}

export const PUT = put;
export const POST = put;
