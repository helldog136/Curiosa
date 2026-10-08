import { NextResponse } from "next/server";
import { currentUser } from "@/core/permissions";
import { MAX_UPLOAD_BYTES, saveUpload } from "@/core/services/uploads";

export async function POST(request: Request) {
  if (!(await currentUser())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File) || file.size > MAX_UPLOAD_BYTES) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const url = await saveUpload(Buffer.from(await file.arrayBuffer()));
  if (!url) return NextResponse.json({ error: "format" }, { status: 400 });
  return NextResponse.json({ url });
}
