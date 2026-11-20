// Safe reader of the zip of a skin (src/core/skins/zip.ts): what it accepts, and every way an untrusted archive is refused. No disk, no database.
import test from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import { randomBytes } from "node:crypto";
import { makeZip } from "../helpers/zip.mjs";

const { readSkinZip, ZIP_LIMITS, isJunk } = await import("@/core/skins/zip");
const ok = (name, data = "x") => ({ name, data, host: 3, mode: 0o100644 });
const refused = (buf, code, file) => {
  const r = readSkinZip(buf);
  assert.equal(r.ok, false, `refused: ${code}`);
  assert.equal(r.code, code);
  if (file) assert.equal(r.file, file);
};

test("a normal zip: files read, folders and junk ignored, backslashes read as separators", () => {
  const r = readSkinZip(makeZip([{ name: "my-skin/", data: "" }, ok("my-skin/skin.json", "{}"), ok("my-skin/images\\a.svg", "<svg/>"), ok("__MACOSX/my-skin/._skin.json"), ok("my-skin/.DS_Store"), ok("my-skin/Thumbs.db"), ok("my-skin/._a")]));
  assert.equal(r.ok, true);
  assert.deepEqual(r.files.map((f) => f.path).sort(), ["my-skin/images/a.svg", "my-skin/skin.json"]);
  assert.equal(r.ignored, 5, "the folder and the four junk files");
  assert.equal(r.files.find((f) => f.path.endsWith("skin.json")).content.toString(), "{}");
  assert.equal(isJunk("a/b/Thumbs.db") && isJunk("__MACOSX/a") && isJunk("x/._y"), true);
  assert.equal(isJunk("skin.css"), false);
});

test("stored entries work like deflated ones", () => {
  const r = readSkinZip(makeZip([{ name: "skin.json", data: "{\"a\":1}", method: 0 }]));
  assert.equal(r.ok && r.files[0].content.toString(), "{\"a\":1}");
});

test("not a zip, empty, too big", () => {
  refused(Buffer.from("hello, this is not a zip file at all"), "not-zip");
  refused(Buffer.alloc(10), "not-zip");
  refused(makeZip([ok("a/", "")]), "empty");
  refused(Buffer.concat([makeZip([ok("skin.json")]), Buffer.alloc(ZIP_LIMITS.archiveBytes)]), "too-big");
});

test("path traversal, absolute paths, drive letters, backslash tricks, empty parts, control characters", () => {
  for (const name of ["../evil.css", "a/../../evil.css", "/etc/passwd", "C:/x.css", "c:\\x.css", "..\\evil.css", "a\\..\\..\\evil.css", "a//b.css", "./a.css", "a/./b.css", "a\u0000b.css", "a\nb.css"]) {
    refused(makeZip([ok("skin.json"), ok(name)]), "bad-name");
  }
  refused(makeZip([ok("x/".repeat(ZIP_LIMITS.depth + 1) + "f.css")]), "bad-name");
  refused(makeZip([ok("a".repeat(ZIP_LIMITS.pathChars + 1))]), "bad-name");
});

test("symbolic links and special files are refused (Unix mode in the entry)", () => {
  refused(makeZip([ok("skin.json"), { name: "link.css", data: "/etc/passwd", host: 3, mode: 0o120777 }]), "special");
  refused(makeZip([{ name: "dev", data: "", host: 3, mode: 0o020666 }]), "special");   // character device
  refused(makeZip([{ name: "pipe", data: "", host: 3, mode: 0o010644 }]), "special");   // FIFO
  assert.equal(readSkinZip(makeZip([{ name: "d/", data: "", host: 3, mode: 0o040755 }, ok("d/skin.json")])).ok, true);
});

test("duplicate names, and names that differ only by case or Unicode form", () => {
  refused(makeZip([ok("skin.json"), ok("skin.json", "y")]), "duplicate");
  refused(makeZip([ok("skin.json"), ok("SKIN.json")]), "duplicate");
  refused(makeZip([ok("images/é.svg"), ok("images/e\u0301.svg")]), "duplicate");
});

test("encrypted entries, zip64 and unusual compression methods", () => {
  refused(makeZip([{ ...ok("skin.json"), flags: 1 }]), "encrypted");
  refused(makeZip([{ ...ok("skin.json"), usize: 0xffffffff }]), "zip64");
  refused(makeZip([{ ...ok("skin.json"), csize: 0xffffffff }]), "zip64");
  refused(makeZip([{ ...ok("skin.json"), method: 12 }]), "method");
  const withLocator = makeZip([ok("skin.json")]);
  const locator = Buffer.alloc(20); locator.writeUInt32LE(0x07064b50, 0);
  const end = withLocator.length - 22;
  refused(Buffer.concat([withLocator.subarray(0, end), locator, withLocator.subarray(end)]), "zip64");
});

test("a truncated archive and a damaged one", () => {
  const z = makeZip([ok("skin.json", "{\"id\":\"a\"}".repeat(50)), ok("skin.css", "a{}".repeat(100))]);
  refused(z.subarray(0, z.length - 10), "truncated");   // the end record is cut
  refused(z.subarray(0, 60), "truncated");
  const bad = Buffer.from(z); bad.writeUInt32LE(0xdeadbeef, 0);   // first local header spoiled: the list at the end still points to it
  refused(bad, "corrupt");
  const cut = makeZip([{ ...ok("skin.json", "{\"id\":\"a\"}".repeat(50)), csize: 5 }]);   // says 5 bytes of data: the deflate stream is cut
  assert.equal(readSkinZip(cut).ok, false);
});

test("a wrong CRC or a wrong declared size is refused", () => {
  refused(makeZip([{ ...ok("skin.json", "hello"), crc: 123 }]), "corrupt", "skin.json");
  refused(makeZip([{ ...ok("skin.json", "hello"), usize: 3 }]), "corrupt", "skin.json");
  refused(makeZip([{ ...ok("skin.json", "hello"), usize: 99 }]), "corrupt", "skin.json");
  refused(makeZip([{ ...ok("skin.json", "hello"), method: 0, usize: 4 }]), "corrupt", "skin.json");
});

test("zip bombs: the declared size, the real size and the ratio are all capped", () => {
  const zeros = (n) => Buffer.alloc(n);
  // honest declaration, absurd ratio: 400 KB of zeros packs to about 400 bytes
  refused(makeZip([ok("big.css", zeros(400 * 1024))]), "ratio", "big.css");
  // honest declaration over the per-file cap
  refused(makeZip([ok("huge.css", zeros(ZIP_LIMITS.entryBytes + 1))]), "too-large", "huge.css");
  // a lie: declares 100 bytes, really inflates to 20 MB. The inflate stops at the declared size, never builds the 20 MB.
  const lie = makeZip([{ ...ok("lie.css", zeros(20 * 1024 * 1024)), usize: 100 }]);
  assert.ok(lie.length < ZIP_LIMITS.archiveBytes, "the bomb itself is small");
  const t0 = Date.now();
  refused(lie, "corrupt", "lie.css");
  assert.ok(Date.now() - t0 < 2000);
  // many files under the per-file cap whose total passes the total cap
  const many = Array.from({ length: 12 }, (_, i) => ok(`f${i}.css`, randomBytes(300 * 1024 + i)));
  refused(makeZip(many), "too-large");
});

test("too many entries", () => {
  refused(makeZip(Array.from({ length: ZIP_LIMITS.maxFiles + 1 }, (_, i) => ok(`f${i}.css`))), "too-many");
  refused(makeZip(Array.from({ length: ZIP_LIMITS.entries + 1 }, (_, i) => ok(`__MACOSX/f${i}`))), "too-many");
  // junk does not count toward the files kept
  assert.equal(readSkinZip(makeZip([ok("skin.json"), ...Array.from({ length: 100 }, (_, i) => ok(`__MACOSX/f${i}`))])).ok, true);
});

test("overlapping entries (two entries sharing the same bytes) and two end records are refused", () => {
  const a = makeZip([ok("a.css", "aaaa".repeat(10)), ok("b.css", "bbbb".repeat(10))]);
  const first = zlib.deflateRawSync(Buffer.from("aaaa".repeat(10)));
  refused(makeZip([{ ...ok("a.css", "aaaa".repeat(10)), csize: first.length + 40 }, ok("b.css", "bbbb".repeat(10))]), "overlap");   // the first claims the bytes of the second
  refused(makeZip([ok("a.css", "aaaa".repeat(10)), { ...ok("b.css", "bbbb".repeat(10)), localOffset: 0 }]), "corrupt");   // same place, but not the same name
  assert.equal(readSkinZip(a).ok, true);
  const inner = makeZip([ok("evil.css", "x")]);
  refused(makeZip([ok("a.css")], { comment: inner }), "ambiguous");
});

test("inflate is never given more room than the declared size", () => {
  // sanity check of the mechanism the reader relies on
  const packed = zlib.deflateRawSync(Buffer.alloc(1000));
  assert.throws(() => zlib.inflateRawSync(packed, { maxOutputLength: 10 }), (e) => e.code === "ERR_BUFFER_TOO_LARGE");
});
