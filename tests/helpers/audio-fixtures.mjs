// Minimal but structurally valid audio files for the signature tests. None of them is playable audio: they only carry what the core checks.

/** One Ogg page whose first packet is `packet` (beginning of stream). */
function oggPage(packet, { bos = true } = {}) {
  const segs = [];
  let left = packet.length;
  while (left >= 255) { segs.push(255); left -= 255; }
  segs.push(left);
  const head = Buffer.alloc(27);
  head.write("OggS", 0, "latin1");
  head[5] = bos ? 0x02 : 0;
  head[26] = segs.length;
  return Buffer.concat([head, Buffer.from(segs), packet]);
}
export const oggVorbis = () => oggPage(Buffer.concat([Buffer.from("\x01vorbis", "latin1"), Buffer.alloc(23, 1)]));
export const oggOpus = () => oggPage(Buffer.concat([Buffer.from("OpusHead", "latin1"), Buffer.alloc(11, 1)]));
export const oggTheora = () => oggPage(Buffer.concat([Buffer.from("\x80theora", "latin1"), Buffer.alloc(30, 1)]));

/** MPEG-1 Layer III, 128 kbit/s, 44.1 kHz: frames are 417 bytes (418 with padding). */
export function mp3Frame(pad = 0) {
  const len = 417 + pad;
  const f = Buffer.alloc(len, 0x55);
  f[0] = 0xff; f[1] = 0xfb; f[2] = 0x90 | (pad << 1); f[3] = 0x00;
  return f;
}
export const mp3Raw = (frames = 3) => Buffer.concat(Array.from({ length: frames }, () => mp3Frame()));
export function id3(size = 40) {
  const h = Buffer.alloc(10 + size);
  h.write("ID3", 0, "latin1"); h[3] = 3; h[4] = 0;
  h[6] = (size >> 21) & 0x7f; h[7] = (size >> 14) & 0x7f; h[8] = (size >> 7) & 0x7f; h[9] = size & 0x7f;
  return h;
}
export const mp3WithId3 = (frames = 3) => Buffer.concat([id3(), mp3Raw(frames)]);

export function wav({ data = 64, format = 1, channels = 1, rate = 8000, bits = 16 } = {}) {
  const fmt = Buffer.alloc(24);
  fmt.write("fmt ", 0, "latin1"); fmt.writeUInt32LE(16, 4);
  fmt.writeUInt16LE(format, 8); fmt.writeUInt16LE(channels, 10); fmt.writeUInt32LE(rate, 12);
  fmt.writeUInt32LE((rate * channels * bits) / 8, 16); fmt.writeUInt16LE((channels * bits) / 8, 20); fmt.writeUInt16LE(bits, 22);
  const d = Buffer.alloc(8 + data);
  d.write("data", 0, "latin1"); d.writeUInt32LE(data, 4);
  const body = Buffer.concat([Buffer.from("WAVE", "latin1"), fmt, d]);
  const head = Buffer.alloc(8);
  head.write("RIFF", 0, "latin1"); head.writeUInt32LE(body.length, 4);
  return Buffer.concat([head, body]);
}

const box = (type, payload) => { const b = Buffer.alloc(8 + payload.length); b.writeUInt32BE(8 + payload.length, 0); b.write(type, 4, "latin1"); payload.copy(b, 8); return b; };
export const m4a = ({ brand = "M4A ", moovFirst = true } = {}) => {
  const ftyp = box("ftyp", Buffer.concat([Buffer.from(brand, "latin1"), Buffer.alloc(4), Buffer.from("M4A isom", "latin1")]));
  const moov = box("moov", Buffer.alloc(40, 3));
  const mdat = box("mdat", Buffer.alloc(60, 4));
  return Buffer.concat(moovFirst ? [ftyp, moov, mdat] : [ftyp, mdat, moov]);
};

/** ADTS (raw AAC): LC profile, 44.1 kHz, stereo, frames of `len` bytes. */
export function adtsFrame(len = 100) {
  const f = Buffer.alloc(len, 0x11);
  f[0] = 0xff; f[1] = 0xf1; f[2] = 0x50; f[3] = 0x80 | ((len >> 11) & 3); f[4] = (len >> 3) & 0xff; f[5] = ((len & 7) << 5) | 0x1f; f[6] = 0xfc;
  return f;
}
export const aacAdts = (frames = 3) => Buffer.concat(Array.from({ length: frames }, () => adtsFrame()));

export const MP4_VIDEO = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypisom"), Buffer.alloc(40, 7)]);
export const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(40, 9)]);
export const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40)]);
