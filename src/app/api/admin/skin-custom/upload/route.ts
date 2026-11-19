import { NextResponse } from "next/server";
import { isSameOrigin } from "@/core/backup/guard";
import { currentUser, hasRole } from "@/core/permissions";
import { definitionOf } from "@/core/skins/appearanceView";
import { SKIN_ID_RE } from "@/core/skins/allowlist";
import { PICTURE_LIMITS } from "@/core/skins/customizeImage";
import { storePicture } from "@/core/skins/customizeStore";
import { CONTROL_ID_RE } from "@/core/skins/customizeSpec";

export const dynamic = "force-dynamic";

const fraction = (v: FormDataEntryValue | null): number => { const n = Number(v); return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.5; };

/**
 * A picture for an image slot of a skin's customization (docs/SKINS.md "Customization", "Pictures"). NOT `/api/admin/upload`: that one stores a file as received, and
 * any member may call it. This one is for the Administration role only, from this site only, for a slot the skin declares, and what it stores is a file the core made
 * (re-encoded: no EXIF, GPS or hidden data; cropped to the slot's shape; capped in size, pixels, frames and time).
 */
export async function POST(request: Request) {
  if (!isSameOrigin(request.headers)) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const user = await currentUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!hasRole(user, "admin")) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  // refuse an oversized request BEFORE reading it
  const announced = Number(request.headers.get("content-length") ?? NaN);
  if (!Number.isFinite(announced)) return NextResponse.json({ ok: false, error: "invalid" }, { status: 411 });
  if (announced > PICTURE_LIMITS.inputBytes + 64 * 1024) return NextResponse.json({ ok: false, code: "toolarge", detail: { max: Math.floor(PICTURE_LIMITS.inputBytes / 1024 / 1024) } }, { status: 413 });
  let form: FormData;
  try { form = await request.formData(); } catch { return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 }); }
  const file = form.get("file");
  const skinId = String(form.get("skin") ?? ""), slot = String(form.get("slot") ?? "");
  if (!(file instanceof File) || file.size > PICTURE_LIMITS.inputBytes || !SKIN_ID_RE.test(skinId) || !CONTROL_ID_RE.test(slot)) return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });
  const def = await definitionOf(skinId);
  if (!def?.customize) return NextResponse.json({ ok: false, code: "slot" }, { status: 404 });
  const r = await storePicture({ id: def.id, version: def.version, customize: def.customize }, slot, Buffer.from(await file.arrayBuffer()), { uploaderId: user.id, focal: { x: fraction(form.get("fx")), y: fraction(form.get("fy")) } });
  if (!r.ok) return NextResponse.json({ ok: false, code: r.code, detail: r.detail ?? {} }, { status: r.code === "busy" ? 503 : 422 });
  return NextResponse.json({ ok: true, value: r.value, url: r.url, ...(r.stillUrl ? { stillUrl: r.stillUrl } : {}) }, { headers: { "Cache-Control": "no-store" } });
}
