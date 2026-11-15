/**
 * MEDIA PROBE (core 0.18.0): what a video, an animated GIF or a still image REALLY is, read from its bytes without decoding a single frame and without any
 * outside program (the core image has no ffmpeg). Pure: no file system, no database. Used by assistant uploads (services/assistantUploads.ts), so that a file an
 * AI made is checked as strictly as possible before it reaches a stream:
 *
 *   - the container is walked from the first byte to the LAST one: a byte left over after the end of the container (a zip, a script or a page glued behind a
 *     video: a "polyglot" file) is refused, and so is a structure that points outside the file;
 *   - WebM (EBML, DocType "webm"): VP8, VP9 or AV1 video, Opus or Vorbis sound; duration from the Info block, or from the clusters when a recorder left it out;
 *   - MP4 (ISO boxes): H.264 (avc1/avc3), VP9 (vp09) or AV1 (av01) video, AAC (mp4a) or Opus sound; not fragmented, not encrypted, one "moov";
 *   - GIF: every block walked to the trailer; frames, size and the real playing time (a delay of 0 or 1 hundredth plays as 0.1 s in browsers);
 *   - PNG must end with IEND, JPEG with its end marker, WebP must have the size its RIFF header announces.
 * The limits (duration, sides, frames) are decided by the caller; this file only reads.
 */

export type ProbeResult =
  | { ok: true; container: "webm" | "mp4" | "gif" | "png" | "jpg" | "webp"; width: number; height: number; durationSeconds: number | null; frames?: number; video?: string; audio?: string | null; /** WebM: AlphaMode = 1 (a transparent video); mp4: false. Not read for GIF: encoders mark a transparent colour to save bytes between frames, so it says nothing. */ alpha?: boolean }
  | { ok: false; problem: "format" | "trailing" | "truncated" | "codec" | "structure"; detail: string };

const bad = (problem: Extract<ProbeResult, { ok: false }>["problem"], detail: string): ProbeResult => ({ ok: false, problem, detail });

/* ───────────── WebM (EBML) ───────────── */

const ID = { EBML: 0x1a45dfa3, DocType: 0x4282, Segment: 0x18538067, Info: 0x1549a966, TimecodeScale: 0x2ad7b1, Duration: 0x4489, Tracks: 0x1654ae6b, TrackEntry: 0xae, TrackType: 0x83, CodecID: 0x86, Video: 0xe0, PixelWidth: 0xb0, PixelHeight: 0xba, AlphaMode: 0x53c0, Cluster: 0x1f43b675, Timecode: 0xe7, SimpleBlock: 0xa3, BlockGroup: 0xa0, Block: 0xa1, BlockDuration: 0x9b, Attachments: 0x1941a469 };
/** Children of a Segment: an unknown-size Cluster ends where one of these starts. */
const SEGMENT_CHILDREN = new Set([0x114d9b74, ID.Info, ID.Tracks, ID.Cluster, 0x1c53bb6b, 0x1254c367, 0x1043a770, ID.Attachments, 0xec, 0xbf]);
const UNKNOWN = -1;

/** An element id (its length marker kept, 1 to 4 bytes) at `at`, or null. */
function readId(b: Buffer, at: number): { id: number; len: number } | null {
  if (at >= b.length) return null;
  const first = b[at]!;
  const len = first & 0x80 ? 1 : first & 0x40 ? 2 : first & 0x20 ? 3 : first & 0x10 ? 4 : 0;
  if (!len || at + len > b.length) return null;
  let id = 0;
  for (let i = 0; i < len; i++) id = id * 256 + b[at + i]!;
  return { id, len };
}
/** An element size (1 to 8 bytes, marker removed). All ones = unknown size. */
function readSize(b: Buffer, at: number): { size: number; len: number } | null {
  if (at >= b.length) return null;
  const first = b[at]!;
  let len = 1;
  while (len <= 8 && !(first & (0x80 >> (len - 1)))) len++;
  if (len > 8 || at + len > b.length) return null;
  let size = first & (0xff >> len);
  let allOnes = size === 0xff >> len;
  for (let i = 1; i < len; i++) { size = size * 256 + b[at + i]!; if (b[at + i] !== 0xff) allOnes = false; }
  if (allOnes) return { size: UNKNOWN, len };
  if (!Number.isSafeInteger(size)) return null;
  return { size, len };
}
type El = { id: number; start: number; data: number; end: number; unknown: boolean };
/** The element at `at`, inside `limit`. An unknown size runs to `limit` (the caller narrows it for clusters). */
function element(b: Buffer, at: number, limit: number): El | null {
  const id = readId(b, at);
  if (!id) return null;
  const size = readSize(b, at + id.len);
  if (!size) return null;
  const data = at + id.len + size.len;
  const end = size.size === UNKNOWN ? limit : data + size.size;
  if (end > limit || data > limit) return null;
  return { id: id.id, start: at, data, end, unknown: size.size === UNKNOWN };
}
const uint = (b: Buffer, from: number, to: number) => { let v = 0; for (let i = from; i < to; i++) v = v * 256 + b[i]!; return v; };
const float = (b: Buffer, from: number, to: number) => (to - from === 4 ? b.readFloatBE(from) : to - from === 8 ? b.readDoubleBE(from) : NaN);

export function probeWebm(b: Buffer): ProbeResult {
  const head = element(b, 0, b.length);
  if (!head || head.id !== ID.EBML || head.unknown) return bad("format", "not an EBML file");
  let doc = "";
  for (let at = head.data; at < head.end; ) {
    const e = element(b, at, head.end);
    if (!e) return bad("structure", "EBML header");
    if (e.id === ID.DocType) doc = b.subarray(e.data, e.end).toString("latin1");
    at = e.end;
  }
  if (doc !== "webm") return bad("format", `DocType "${doc.slice(0, 20)}" (only webm is played everywhere)`);
  const seg = element(b, head.end, b.length);
  if (!seg || seg.id !== ID.Segment) return bad("structure", "no Segment after the header");
  if (seg.end !== b.length) return bad("trailing", `${b.length - seg.end} bytes after the end of the video`);
  let scale = 1_000_000, duration: number | null = null, width = 0, height = 0, alpha = false, video: string | null = null, audio: string | null = null, lastTc = 0, blocks = 0;
  for (let at = seg.data; at < seg.end; ) {
    const e = element(b, at, seg.end);
    if (!e) return bad("truncated", "an element of the Segment is cut");
    if (e.id === ID.Attachments) return bad("structure", "the file carries attachments");
    if (e.id === ID.Info) {
      for (let p = e.data; p < e.end; ) {
        const c = element(b, p, e.end);
        if (!c) return bad("structure", "Info");
        if (c.id === ID.TimecodeScale) scale = uint(b, c.data, c.end) || scale;
        if (c.id === ID.Duration) { const d = float(b, c.data, c.end); if (Number.isFinite(d) && d > 0) duration = d; }
        p = c.end;
      }
    } else if (e.id === ID.Tracks) {
      for (let p = e.data; p < e.end; ) {
        const t = element(b, p, e.end);
        if (!t) return bad("structure", "Tracks");
        if (t.id === ID.TrackEntry) {
          let type = 0, codec = "", w = 0, h = 0, a = false;
          for (let q = t.data; q < t.end; ) {
            const c = element(b, q, t.end);
            if (!c) return bad("structure", "TrackEntry");
            if (c.id === ID.TrackType) type = uint(b, c.data, c.end);
            if (c.id === ID.CodecID) codec = b.subarray(c.data, c.end).toString("latin1").replace(/\0+$/, "");
            if (c.id === ID.Video) for (let r = c.data; r < c.end; ) { const v = element(b, r, c.end); if (!v) return bad("structure", "Video"); if (v.id === ID.PixelWidth) w = uint(b, v.data, v.end); if (v.id === ID.PixelHeight) h = uint(b, v.data, v.end); if (v.id === ID.AlphaMode) a = uint(b, v.data, v.end) === 1; r = v.end; }
            q = c.end;
          }
          if (type === 1) {
            if (video) return bad("structure", "more than one video track");
            if (!["V_VP8", "V_VP9", "V_AV1"].includes(codec)) return bad("codec", `video codec ${codec || "unknown"}`);
            video = codec; width = w; height = h; alpha = a;
          } else if (type === 2) {
            if (!["A_OPUS", "A_VORBIS"].includes(codec)) return bad("codec", `sound codec ${codec || "unknown"}`);
            audio = codec;
          } else return bad("structure", `track of type ${type} (only video and sound)`);
        }
        p = t.end;
      }
    } else if (e.id === ID.Cluster) {
      // An unknown-size cluster (written by a browser recorder) ends where the next Segment child starts.
      let end = e.end, tc = 0;
      for (let p = e.data; p < end; ) {
        if (e.unknown) { const nid = readId(b, p); if (nid && SEGMENT_CHILDREN.has(nid.id)) { end = p; break; } }
        const c = element(b, p, e.unknown ? seg.end : e.end);
        if (!c || c.unknown) return bad("truncated", "a cluster is cut");
        if (c.id === ID.Timecode) tc = uint(b, c.data, c.end);
        const blockAt = c.id === ID.SimpleBlock ? c.data : c.id === ID.BlockGroup ? (() => { for (let q = c.data; q < c.end; ) { const x = element(b, q, c.end); if (!x) return -1; if (x.id === ID.Block) return x.data; q = x.end; } return -1; })() : -1;
        if (blockAt >= 0) {
          const track = readSize(b, blockAt);
          if (!track || blockAt + track.len + 2 > c.end) return bad("structure", "a block is cut");
          lastTc = Math.max(lastTc, tc + b.readInt16BE(blockAt + track.len));
          blocks++;
        }
        p = c.end;
      }
      at = end;
      continue;
    }
    at = e.end;
  }
  if (!video) return bad("structure", "no video track");
  if (!width || !height) return bad("structure", "the video has no size");
  if (!blocks) return bad("truncated", "no picture in the file");
  const seconds = ((duration ?? lastTc) * scale) / 1e9;
  return { ok: true, container: "webm", width, height, durationSeconds: Math.round(seconds * 1000) / 1000, video, audio, alpha };
}

/* ───────────── MP4 (ISO boxes) ───────────── */

type Box = { type: string; data: number; end: number };
function boxes(b: Buffer, from: number, to: number): Box[] | string {
  const out: Box[] = [];
  for (let at = from; at < to; ) {
    if (at + 8 > to) return "a box is cut";
    let size = b.readUInt32BE(at);
    const type = b.subarray(at + 4, at + 8).toString("latin1");
    if (!/^[\x20-\x7e\xa9]{4}$/.test(type)) return "an unreadable box";
    let head = 8;
    if (size === 1) { if (at + 16 > to) return "a box is cut"; const big = b.readBigUInt64BE(at + 8); if (big > BigInt(Number.MAX_SAFE_INTEGER)) return "a box is too large"; size = Number(big); head = 16; }
    else if (size === 0) size = to - at;
    if (size < head || at + size > to) return `the box "${type}" points outside the file`;
    out.push({ type, data: at + head, end: at + size });
    at += size;
  }
  return out;
}
const child = (b: Buffer, box: Box | undefined, type: string, skip = 0): Box | undefined => { if (!box) return undefined; const l = boxes(b, box.data + skip, box.end); return typeof l === "string" ? undefined : l.find((x) => x.type === type); };

export function probeMp4(b: Buffer): ProbeResult {
  const top = boxes(b, 0, b.length);
  if (typeof top === "string") return bad(top.includes("cut") ? "truncated" : "trailing", top);
  if (top[0]?.type !== "ftyp") return bad("format", "no ftyp box first");
  const allowed = new Set(["ftyp", "moov", "mdat", "free", "skip", "wide", "uuid"]);
  for (const x of top) {
    if (x.type === "moof" || x.type === "mfra" || x.type === "sidx") return bad("structure", "a fragmented MP4");
    if (!allowed.has(x.type)) return bad("trailing", `an unexpected "${x.type}" block`);
  }
  const moovs = top.filter((x) => x.type === "moov");
  if (moovs.length !== 1) return bad("structure", moovs.length ? "more than one moov" : "no moov box (file cut?)");
  if (!top.some((x) => x.type === "mdat")) return bad("truncated", "no picture data");
  const moov = moovs[0]!;
  const mvhd = child(b, moov, "mvhd");
  if (!mvhd || mvhd.end - mvhd.data < 24) return bad("structure", "no mvhd");
  const v1 = b[mvhd.data] === 1;
  const timescale = b.readUInt32BE(mvhd.data + (v1 ? 20 : 12));
  const dur = v1 ? Number(b.readBigUInt64BE(mvhd.data + 24)) : b.readUInt32BE(mvhd.data + 16);
  if (!timescale) return bad("structure", "no time scale");
  const list = boxes(b, moov.data, moov.end);
  if (typeof list === "string") return bad("structure", list);
  let width = 0, height = 0, video: string | null = null, audio: string | null = null;
  for (const trak of list.filter((x) => x.type === "trak")) {
    const tkhd = child(b, trak, "tkhd");
    const mdia = child(b, trak, "mdia");
    const hdlr = child(b, mdia, "hdlr");
    const stsd = child(b, child(b, child(b, mdia, "minf"), "stbl"), "stsd");
    if (!tkhd || !hdlr || !stsd || stsd.end - stsd.data < 16) return bad("structure", "an incomplete track");
    const handler = b.subarray(hdlr.data + 8, hdlr.data + 12).toString("latin1");
    const codec = b.subarray(stsd.data + 12, stsd.data + 16).toString("latin1");
    if (handler === "vide") {
      if (video) return bad("structure", "more than one video track");
      if (!["avc1", "avc3", "vp09", "av01"].includes(codec)) return bad("codec", `video codec ${codec}`);
      video = codec;
      width = Math.round(b.readUInt32BE(tkhd.end - 8) / 65536); height = Math.round(b.readUInt32BE(tkhd.end - 4) / 65536);
    } else if (handler === "soun") {
      if (!["mp4a", "Opus"].includes(codec)) return bad("codec", `sound codec ${codec}`);
      audio = codec;
    } else if (!["meta", "hint", "text", "sbtl", "subt"].includes(handler)) return bad("structure", `track of type ${handler}`);
  }
  if (!video) return bad("structure", "no video track");
  if (!width || !height) return bad("structure", "the video has no size");
  return { ok: true, container: "mp4", width, height, durationSeconds: Math.round((dur / timescale) * 1000) / 1000, video, audio, alpha: false };
}

/* ───────────── GIF ───────────── */

export function probeGif(b: Buffer): ProbeResult {
  if (b.length < 14 || !/^GIF8[79]a$/.test(b.subarray(0, 6).toString("latin1"))) return bad("format", "not a GIF");
  const width = b.readUInt16LE(6), height = b.readUInt16LE(8);
  let at = 13;
  if (b[10]! & 0x80) at += 3 * (2 << (b[10]! & 7));
  let frames = 0, centis = 0, delay = 0;
  const subBlocks = (p: number): number => { while (p < b.length) { const n = b[p]!; p += 1 + n; if (n === 0) return p; } return -1; };
  while (at < b.length) {
    const kind = b[at]!;
    if (kind === 0x3b) {
      if (at + 1 !== b.length) return bad("trailing", `${b.length - at - 1} bytes after the end of the GIF`);
      if (!frames) return bad("structure", "no picture");
      return { ok: true, container: "gif", width, height, durationSeconds: frames > 1 ? centis / 100 : null, frames };
    }
    if (kind === 0x21) {
      if (at + 2 > b.length) break;
      if (b[at + 1] === 0xf9 && b[at + 2] === 4 && at + 8 <= b.length) delay = b.readUInt16LE(at + 4);
      const next = subBlocks(at + 2);
      if (next < 0) break;
      at = next;
    } else if (kind === 0x2c) {
      if (at + 10 > b.length) break;
      const fw = b.readUInt16LE(at + 5), fh = b.readUInt16LE(at + 7), packed = b[at + 9]!;
      if (b.readUInt16LE(at + 1) + fw > width || b.readUInt16LE(at + 3) + fh > height) return bad("structure", "a frame larger than the picture");
      at += 10;
      if (packed & 0x80) at += 3 * (2 << (packed & 7));
      at += 1; // LZW minimum code size
      const next = subBlocks(at);
      if (next < 0) break;
      at = next;
      frames++;
      centis += delay <= 1 ? 10 : delay;
      delay = 0;
    } else return bad("structure", `an unknown GIF block 0x${kind.toString(16)}`);
  }
  return bad("truncated", "the GIF has no end (file cut?)");
}

/* ───────────── Still images: only the end is checked here (the size comes from the image engine, imageDerive.readImageSize) ───────────── */

export function imageTail(b: Buffer, kind: "png" | "jpg" | "webp"): ProbeResult | null {
  if (kind === "png") {
    // Chunks walked to IEND, which must be the last 12 bytes.
    for (let at = 8; at + 12 <= b.length; ) {
      const len = b.readUInt32BE(at), type = b.subarray(at + 4, at + 8).toString("latin1");
      const end = at + 12 + len;
      if (end > b.length) return bad("truncated", "a PNG chunk is cut");
      if (type === "IEND") return end === b.length ? null : bad("trailing", `${b.length - end} bytes after the end of the PNG`);
      at = end;
    }
    return bad("truncated", "the PNG has no end");
  }
  if (kind === "jpg") {
    let end = b.length;
    while (end > 2 && b[end - 1] === 0) end--; // a few padding zeros some tools add
    return b[end - 2] === 0xff && b[end - 1] === 0xd9 && b.length - end <= 16 ? null : bad("trailing", "the JPEG does not end with its end marker");
  }
  const declared = b.readUInt32LE(4) + 8;
  return declared === b.length || declared + 1 === b.length ? null : bad(declared > b.length ? "truncated" : "trailing", "the WebP size does not match its header");
}
