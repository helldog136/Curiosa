// Why a git command failed, from realistic stderr samples (core 0.46.2): one kind per cause, never a text from git in the answer.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const { classifyGitFailure, parseGitVersion, supportsEnvConfig, isAccessKind } = await import("@/core/gitFailure");
const kind = (stderr, opts) => classifyGitFailure(stderr, opts).kind;

test("the host refused the code itself: rejected", () => {
  for (const s of [
    "remote: Invalid username or password.\nfatal: Authentication failed for 'https://github.com/o/r/'",
    "fatal: Authentication failed for 'https://github.com/o/r/'",
    "remote: Bad credentials\nfatal: unable to access 'https://github.com/o/r/': The requested URL returned error: 401",
    "remote: HTTP Basic: Access denied",
    "remote: Support for password authentication was removed on August 13, 2021.",
  ]) assert.equal(kind(s, { credentialsSent: true }), "rejected", s);
});

test("no such repository, or no right to read it: notFound (GitHub says the same for both)", () => {
  for (const s of [
    "remote: Repository not found.\nfatal: repository 'https://github.com/o/r/' not found",
    "fatal: repository 'https://github.com/o/r/' not found",
    "fatal: unable to access 'https://github.com/o/r/': The requested URL returned error: 404",
    "fatal: unable to access 'https://github.com/o/r/': The requested URL returned error: 403",
    "remote: Permission to o/r.git denied to someone.",
  ]) assert.equal(kind(s, { credentialsSent: true }), "notFound", s);
});

test("a redirect (renamed or moved): redirect, with the new address only when git printed a plain one", () => {
  assert.deepEqual(classifyGitFailure("fatal: unable to access 'https://github.com/o/r/': The requested URL returned error: 301"), { kind: "redirect" });
  assert.deepEqual(classifyGitFailure("fatal: unable to access 'x': The requested URL returned error: 302", {}), { kind: "redirect" });
  assert.deepEqual(
    classifyGitFailure("warning: redirecting to https://github.com/new/name.git/\nfatal: unable to update url base from redirection:\n  asked for: https://github.com/o/r/info/refs?service=git-upload-pack\n   redirect: https://github.com/new/name.git/info/refs?service=git-upload-pack"),
    { kind: "redirect", location: "https://github.com/new/name" });
  assert.equal(classifyGitFailure("returned error: 301\nredirect: https://user:secret@evil.example/x").location, undefined, "an address with credentials is never offered");
});

test("git did not use the code, is missing or too old: tooOld", () => {
  // The code was attached but git asked for a user name: it never read the configuration the code travels in.
  assert.equal(kind("fatal: could not read Username for 'https://github.com': terminal prompts disabled", { credentialsSent: true }), "tooOld");
  assert.equal(kind("error: unknown option `foo'\nusage: git ls-remote [<options>]"), "tooOld");
  assert.equal(kind("git: 'remote-https' is not a git command. See 'git --help'."), "tooOld");
  assert.equal(kind("fatal: bad config line 1 in file .git/config"), "tooOld");
  assert.equal(kind("", { missing: true }), "tooOld");
  // With no code attached the same message only means the repository wants one.
  assert.equal(kind("fatal: could not read Username for 'https://github.com': terminal prompts disabled", { credentialsSent: false }), "rejected");
});

test("network, name resolution, certificate, time: unreachable", () => {
  for (const s of [
    "fatal: unable to access 'https://github.com/o/r/': Could not resolve host: github.com",
    "fatal: unable to access 'https://github.com/o/r/': Failed to connect to github.com port 443 after 21034 ms: Couldn't connect to server",
    "fatal: unable to access 'https://github.com/o/r/': Connection timed out after 30001 milliseconds",
    "fatal: unable to access 'https://github.com/o/r/': Operation timed out after 30000 milliseconds with 0 out of 0 bytes received",
    "fatal: unable to access 'https://github.com/o/r/': SSL certificate problem: unable to get local issuer certificate",
    "fatal: unable to access 'https://github.com/o/r/': Recv failure: Connection reset by peer",
  ]) assert.equal(kind(s, { credentialsSent: true }), "unreachable", s);
  assert.equal(kind("", { timedOut: true }), "unreachable");
});

test("an address git does not understand: address; anything else: unknown", () => {
  assert.equal(kind("fatal: 'foo' does not appear to be a git repository\nfatal: Could not read from remote repository."), "address");
  assert.equal(kind("fatal: transport 'file' not allowed"), "address");
  assert.equal(kind("something nobody has ever seen"), "unknown");
  assert.equal(kind(""), "unknown");
  assert.equal(kind(undefined), "unknown");
});

test("only the rejection of the code and 'not found' ask for the code again", () => {
  assert.deepEqual(["rejected", "notFound", "redirect", "tooOld", "unreachable", "address", "unknown"].map(isAccessKind), [true, true, false, false, false, false, false]);
});

test("git versions: 2.31 is the first to read the configuration given in the environment; an unreadable answer counts as recent", () => {
  assert.deepEqual(parseGitVersion("git version 2.43.0\n"), [2, 43]);
  assert.deepEqual(parseGitVersion("git version 2.39.5 (Apple Git-154)"), [2, 39]);
  assert.equal(parseGitVersion("bonjour"), null);
  assert.deepEqual([[2, 20], [2, 25], [2, 30], [1, 9]].map((v) => supportsEnvConfig(v)), [false, false, false, false]);
  assert.deepEqual([[2, 31], [2, 43], [3, 0]].map((v) => supportsEnvConfig(v)), [true, true, true]);
  assert.equal(supportsEnvConfig(null), true);
});

test("the answers are keys with a message in both languages, and a message never names the code or the jargon of the rules", () => {
  const en = JSON.parse(fs.readFileSync("src/locales/en.json", "utf8")), fr = JSON.parse(fs.readFileSync("src/locales/fr.json", "utf8"));
  const keys = ["notFound", "rejected", "tooOld", "unreachable", "redirect", "redirectTo", "unknown", "address", "empty", "broad", "format"].map((k) => `access.error.${k}`);
  for (const k of keys) {
    assert.ok(en[k] && fr[k], k);
    for (const text of [en[k], fr[k]]) {
      assert.ok(text.split(/(?<=[.:?])\s+/).every((p) => p.split(/\s+/).length <= 20), `${k}: sentences of 20 words at most`);
      assert.ok(!/!|veuillez|\b(token|jeton|webhook|API|JSON|slug)\b/i.test(text), `${k}: tone and words`);
    }
  }
  assert.equal(en["access.error.refused"], undefined, "the single 'refused' message is gone");
  assert.equal(/\{address\}/.test(en["access.error.redirectTo"]) && /\{address\}/.test(fr["access.error.redirectTo"]), true);
  assert.ok(en["audit.action.git.access.failed"] && fr["audit.action.git.access.failed"]);
});
