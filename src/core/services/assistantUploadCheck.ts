import { readImageSize } from "@/core/imageDerive";
import { imageTail, probeGif, probeMp4, probeWebm, type ProbeResult } from "@/core/mediaProbe";
import { MAX_AUDIO_BYTES, MAX_UPLOAD_BYTES, sniffAudio, sniffImage, sniffVideo } from "@/core/services/uploads";

/**
 * THE RULES of a file an AI assistant sends (core 0.18.0), in one place: the core service (assistantUploads.ts) and the test kit (testsupport/fakeCtx.mjs)
 * both call `checkAssistantFile`, so a module's tests meet exactly what a site does (no optimistic fake).
 *
 * The kind is read from the BYTES (never the name nor a declared type), then the container is probed (mediaProbe.ts): nothing after its end, a codec every
 * browser and OBS plays, a duration and a size that fit an alert. Messages are written for the assistant: what is wrong, and what to do instead.
 */
export type AssistantKind = "image" | "video" | "audio";
export const ASSISTANT_KINDS: readonly AssistantKind[] = ["image", "video", "audio"];
/** Per kind: images 5 MB and sounds 10 MB (the admin's limits), videos 25 MB (half the admin's: an alert is short). */
export const ASSISTANT_MAX_BYTES: Record<AssistantKind, number> = { image: MAX_UPLOAD_BYTES, audio: MAX_AUDIO_BYTES, video: 25 * 1024 * 1024 };
export const MAX_SECONDS = 30;
/** A staging slot lives 30 minutes. */
export const STAGING_TTL_MS = 30 * 60_000;
/** One base64 piece through the tool: 700 000 bytes = 933 336 characters, under the 1 MB limit of an MCP request. */
export const CHUNK_BYTES = 700_000;
/** One PUT on the one-time address: under the 10 MB body buffer of the site's proxy. */
export const HTTP_PART_BYTES = 8 * 1024 * 1024;
export const MAX_LONG_SIDE = 1920;
export const MAX_SHORT_SIDE = 1080;
export const MAX_GIF_FRAMES = 1500;

export type CheckedFile = { ok: true; kind: AssistantKind; ext: "png" | "jpg" | "webp" | "gif" | "mp4" | "webm" | "mp3" | "ogg" | "wav" | "m4a" | "aac"; width: number | null; height: number | null; durationSeconds: number | null; codec: string | null; /** Transparent video (WebM AlphaMode 1); false for other videos; null when not read (pictures, GIFs, sounds). */ alpha: boolean | null };
export type CheckProblem = { ok: false; reason: "type" | "size" | "probe"; message: string };

const MB = (n: number) => `${Math.round(n / 1024 / 1024)} MB`;
const fail = (reason: CheckProblem["reason"], message: string): CheckProblem => ({ ok: false, reason, message });
const WHAT: Record<AssistantKind, string> = { image: "a picture (png, jpeg, webp or gif)", video: "a video (webm with VP8/VP9/AV1, or mp4 with H.264)", audio: "a sound (mp3, ogg, wav, m4a or aac)" };

function probeProblem(p: Extract<ProbeResult, { ok: false }>, kind: string): CheckProblem {
  if (p.problem === "trailing") return fail("probe", `The ${kind} has extra data after its end (${p.detail}). Export it again as a plain file, with nothing appended, and send it again.`);
  if (p.problem === "truncated") return fail("probe", `The ${kind} is incomplete (${p.detail}). Check that the whole file was sent, then start a new upload.`);
  if (p.problem === "codec") return fail("probe", `The ${kind} uses a format that does not play everywhere (${p.detail}). For example: ffmpeg -i in.mov -c:v libvpx-vp9 -an out.webm, or -c:v libx264 -pix_fmt yuv420p -movflags +faststart out.mp4.`);
  return fail("probe", `The ${kind} could not be read safely (${p.detail}). Export it again, for example with ffmpeg to webm (VP9) or mp4 (H.264, +faststart).`);
}

function fits(width: number, height: number, seconds: number | null, kind: string): CheckProblem | null {
  const long = Math.max(width, height), short = Math.min(width, height);
  if (long > MAX_LONG_SIDE || short > MAX_SHORT_SIDE) return fail("probe", `The ${kind} is ${width}x${height} pixels; at most ${MAX_LONG_SIDE}x${MAX_SHORT_SIDE} (or ${MAX_SHORT_SIDE}x${MAX_LONG_SIDE}). Scale it down, for example ffmpeg -vf scale=1280:-2.`);
  if (seconds !== null && !(seconds > 0)) return fail("probe", `The ${kind} has no playing time. Export it again.`);
  if (seconds !== null && seconds > MAX_SECONDS) return fail("probe", `The ${kind} lasts ${Math.round(seconds)} s; an alert plays ${MAX_SECONDS} s at most. Cut it, for example ffmpeg -t ${MAX_SECONDS}.`);
  return null;
}

/** Checks a received file against the kinds the module accepts. Never throws. */
export async function checkAssistantFile(buf: Buffer, accept: readonly AssistantKind[]): Promise<CheckedFile | CheckProblem> {
  const image = sniffImage(buf);
  const audio = image ? null : sniffAudio(buf);
  const video = image || audio ? null : sniffVideo(buf);
  const kind: AssistantKind | null = image ? "image" : audio ? "audio" : video ? "video" : null;
  const wanted = accept.map((k) => WHAT[k]).join(", or ");
  if (!kind) return fail("type", `This file is not ${wanted} (its content was checked, not its name). Convert it, for example ffmpeg -i in.mov -c:v libvpx-vp9 out.webm, and start a new upload.`);
  if (!accept.includes(kind)) return fail("type", `This file is ${WHAT[kind]}, but only ${wanted} can be used here.`);
  if (buf.length > ASSISTANT_MAX_BYTES[kind]) return fail("size", `This ${kind} weighs ${(buf.length / 1024 / 1024).toFixed(1)} MB; ${MB(ASSISTANT_MAX_BYTES[kind])} at most. Compress it (for a video: a lower bitrate, for example ffmpeg -b:v 1M) and start a new upload.`);

  if (kind === "audio") return { ok: true, kind, ext: audio!, width: null, height: null, durationSeconds: null, codec: null, alpha: null };
  if (kind === "video") {
    const p = video === "webm" ? probeWebm(buf) : probeMp4(buf);
    if (!p.ok) return probeProblem(p, "video");
    const bad = fits(p.width, p.height, p.durationSeconds, "video");
    if (bad) return bad;
    return { ok: true, kind, ext: video!, width: p.width, height: p.height, durationSeconds: p.durationSeconds, codec: p.video ?? null, alpha: p.alpha === true };
  }
  if (image === "gif") {
    const p = probeGif(buf);
    if (!p.ok) return probeProblem(p, "GIF");
    if ((p.frames ?? 1) > MAX_GIF_FRAMES) return fail("probe", `The GIF has ${p.frames} frames; ${MAX_GIF_FRAMES} at most. Lower its frame rate, or make a webm video instead.`);
    const bad = fits(p.width, p.height, p.durationSeconds, "GIF");
    if (bad) return bad;
    return { ok: true, kind, ext: "gif", width: p.width, height: p.height, durationSeconds: p.durationSeconds, codec: null, alpha: null };
  }
  const tail = imageTail(buf, image!);
  if (tail && !tail.ok) return probeProblem(tail, "picture");
  const size = await readImageSize(buf);
  if (size === "unreadable") return fail("probe", "This file looks like a picture but cannot be read. Export it again as png, jpeg or webp.");
  if (size === "toolarge") return fail("probe", "The picture has too many pixels. Reduce it, for example to 1920 pixels on its long side.");
  if (size) { const bad = fits(size.width, size.height, null, "picture"); if (bad) return bad; }
  return { ok: true, kind, ext: image!, width: size?.width ?? null, height: size?.height ?? null, durationSeconds: null, codec: null, alpha: null };
}
