// Host helpers (src/core/host.ts): golden equivalence with the functions they replaced. tests/fixtures/host-golden.json was captured from the
// code BEFORE the refactoring (url.hostProblem, siteAddress.hostProblem / hostOfUrl / sameSiteHost, redirectDestination.destinationKey and the
// copies of "lower case, strip www." that lived inline in rank, stats, redirects, redirectMeasure, refs and probe). Nothing here may be re-recorded
// from the new code: a change of behaviour must fail this test.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const H = await import("@/core/host");
const { destinationKey } = await import("@/core/redirectDestination");
const { hostKey, parseSkipHosts } = await import("@/core/maintenance/content/refs");
const gold = JSON.parse(fs.readFileSync(new URL("../fixtures/host-golden.json", import.meta.url), "utf8"));

/** Runs f and returns the same shape the capture used: { v } or { throws }. */
const run = (f) => { try { return { v: f() }; } catch (e) { return { throws: String(e?.name ?? "Error") }; } };

test("the table covers the edge inputs that matter", () => {
  const all = [...gold.urls, ...gold.hosts].join("\n");
  for (const needle of ["Example.COM", ":443", "www.", "xn--bcher-kva", "bücher", "example.com.", "[::1]", "user:pw@", "0x7f000001"]) assert.ok(all.includes(needle), needle);
  assert.ok(gold.urls.includes("") && gold.hosts.includes(""));
});

test("fetchTargetProblem answers like the old url.hostProblem (string and URL input)", () => {
  for (const [u, want] of Object.entries(gold.fetchTargetProblem)) assert.deepEqual(run(() => H.fetchTargetProblem(u)), want, JSON.stringify(u));
  for (const [u, want] of Object.entries(gold.fetchTargetProblemUrlObject)) assert.deepEqual(run(() => H.fetchTargetProblem(new URL(u))), want, `URL ${JSON.stringify(u)}`);
});

test("publicHostProblem answers like the old siteAddress.hostProblem", () => {
  for (const [h, want] of Object.entries(gold.publicHostProblem)) assert.deepEqual(run(() => H.publicHostProblem(h)), want, JSON.stringify(h));
});

test("hostOf answers like the old siteAddress.hostOfUrl; sameSiteHost like the old sameSiteHost", () => {
  for (const [u, want] of Object.entries(gold.hostOfUrl)) assert.deepEqual(run(() => H.hostOf(u)), want, JSON.stringify(u));
  assert.ok(gold.sameSiteHost.length > 100);
  for (const [a, b, want] of gold.sameSiteHost) assert.equal(H.sameSiteHost(a, b), want, `${JSON.stringify(a)} ~ ${JSON.stringify(b)}`);
});

test("bareHost / bareHostOf / sameHost answer like the inline copies they replaced", () => {
  for (const [h, want] of Object.entries(gold.bareHost)) assert.deepEqual(run(() => H.bareHost(h)), want, JSON.stringify(h));
  for (const [u, want] of Object.entries(gold.bareHostOfUrl)) {
    assert.deepEqual(run(() => H.bareHostOf(u)), want, JSON.stringify(u));
    assert.deepEqual(run(() => hostKey(u)), want, `hostKey ${JSON.stringify(u)}`);
  }
  for (const [a, b, want] of gold.sameHost) assert.equal(H.sameHost(a, b), want, `${JSON.stringify(a)} ~ ${JSON.stringify(b)}`);
});

test("canonicalHost and destinationKey keep the behaviour of the old code", () => {
  for (const [h, want] of Object.entries(gold.canonicalHost)) assert.deepEqual(run(() => H.canonicalHost(h)), want, JSON.stringify(h));
  for (const [u, want] of Object.entries(gold.destinationKey)) assert.deepEqual(run(() => destinationKey(u)), want, JSON.stringify(u));
});

test("the two families differ on a trailing dot, on purpose: bareHost keeps it, canonicalHost drops it", () => {
  assert.equal(H.bareHost("WWW.Example.com."), "example.com.");
  assert.equal(H.canonicalHost("WWW.Example.com."), "example.com");
  assert.equal(H.sameHost("example.com.", "example.com"), false);
  assert.equal(H.sameSiteHost("example.com.", "example.com"), true);
  assert.equal(H.sameHost("", ""), true, "two empty names are equal for sameHost");
  assert.equal(H.sameSiteHost("", ""), false, "but never for sameSiteHost");
});

test("parseSkipHosts keeps its behaviour (names and addresses, www. and case ignored, bad entries dropped)", () => {
  assert.deepEqual([...parseSkipHosts("WWW.Example.com, https://Other.org/x;  bad host\nsub.site.be")].sort(), ["bad", "example.com", "host", "other.org", "sub.site.be"]);
});

test("the old names are gone: one hostProblem was ambiguous", async () => {
  const url = await import("@/core/url"), addr = await import("@/core/siteAddress");
  for (const m of [url, addr]) assert.equal("hostProblem" in m, false);
  assert.equal("hostOfUrl" in addr, false);
  assert.equal("sameSiteHost" in addr, false);
});
