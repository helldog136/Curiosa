// PLACE PAGES 0.45.2: the core namespaces the links and GET forms a module writes inside `html` blocks and the `](?…)` links of `markdown` blocks,
// like it already does for the `href` keys of a block. Pure logic (scopeBlocks, scopeHtml, scopeMarkdown, sectionQuery, soleOnTab).
import test from "node:test";
import assert from "node:assert/strict";

const S = await import("@/core/modules/placeScope");
const html = (h) => ({ type: "html", html: h });
const scoped = (h, key = "contacts") => S.scopeBlocks([html(h)], key)[0].html;

test("html href: double and single quotes, several links, fragment", () => {
  assert.equal(scoped('<a href="?new=person">Add</a>'), '<a href="?contacts.new=person">Add</a>');
  assert.equal(scoped("<a href='?new=person'>Add</a>"), "<a href='?contacts.new=person'>Add</a>");
  assert.equal(scoped('<a href="?a=1">1</a> text <a class="x" href="?b=2&c=3#top">2</a>'), '<a href="?contacts.a=1">1</a> text <a class="x" href="?contacts.b=2&contacts.c=3#top">2</a>');
  assert.equal(scoped('<a href="?x=1#frag">x</a>'), '<a href="?contacts.x=1#frag">x</a>');
});

test("html href: &amp; and & separators, bare ?, {tokens}", () => {
  assert.equal(scoped('<a href="?a=1&amp;b=2">x</a>'), '<a href="?contacts.a=1&amp;contacts.b=2">x</a>');
  assert.equal(scoped('<a href="?a=1&b=2">x</a>'), '<a href="?contacts.a=1&contacts.b=2">x</a>');
  assert.equal(scoped('<a href="?">all</a>'), '<a href="?">all</a>');
  assert.equal(scoped('<a href="?edit={id}">x</a>'), '<a href="?contacts.edit={id}">x</a>');
  assert.equal(scoped('<a href="?#top">x</a>'), '<a href="?#top">x</a>');
});

test("html href: already prefixed, absolute, path and mailto links are untouched; scoping twice is scoping once", () => {
  const same = [
    '<a href="?contacts.new=person">x</a>',
    '<a href="?other.new=person&amp;contacts.q=1">x</a>',
    '<a href="https://example.org/?a=1">x</a>',
    '<a href="/admin/users?a=1">x</a>',
    '<a href="mailto:a@example.org?subject=1">x</a>',
    '<a href="#top">x</a>',
    "<a href=?a=1>unquoted is not handled</a>",
  ];
  for (const h of same) assert.equal(scoped(h), h, h);
  const once = scoped('<a href="?a=1&amp;b=2">x</a><form method="get"><input name="q"><input type="hidden" name="tab" value="x"></form>');
  assert.equal(scoped(once), once);
  assert.deepEqual(S.scopeBlocks(S.scopeBlocks([html('<a href="?a=1">x</a>')], "contacts"), "contacts"), S.scopeBlocks([html('<a href="?a=1">x</a>')], "contacts"));
});

test("html: only attribute context is rewritten (text, comments, script, style, code are left alone)", () => {
  const same = [
    'Type href="?a=1" to add',
    '<p>href="?a=1"</p>',
    '<!-- <a href="?a=1">x</a> -->',
    '<script>var s = \'<a href="?a=1">\';</script>',
    '<style>a[href="?a=1"]{color:red}</style>',
    '<a title=\'href="?a=1"\' data-x="1">x</a>',
    '<a href="?a=1',
    "<",
    "",
  ];
  for (const h of same) assert.equal(scoped(h), h, h);
  assert.equal(scoped('<script>x</script><a href="?a=1">x</a>'), '<script>x</script><a href="?contacts.a=1">x</a>');
  assert.equal(scoped('<A HREF="?a=1">x</A>'), '<A HREF="?contacts.a=1">x</A>');
  assert.equal(scoped('<a\n  class="b"\n  href = "?a=1">x</a>'), '<a\n  class="b"\n  href = "?contacts.a=1">x</a>');
  assert.equal(scoped('<a data-x=">" href="?a=1">x</a>'), '<a data-x=">" href="?contacts.a=1">x</a>');
});

test("html: nested blocks are walked, other keys and block types are untouched", () => {
  const blocks = [
    { type: "panel", title: "t", blocks: [html('<a href="?a=1">x</a>'), { type: "tabs", items: [{ blocks: [html("<a href='?b=2'>y</a>")] }] }] },
    { type: "text", html: '<a href="?a=1">not an html block</a>' },
    { type: "button", href: "?c=3", label: "b" },
  ];
  const out = S.scopeBlocks(blocks, "contacts");
  assert.equal(out[0].blocks[0].html, '<a href="?contacts.a=1">x</a>');
  assert.equal(out[0].blocks[1].items[0].blocks[0].html, "<a href='?contacts.b=2'>y</a>");
  assert.equal(out[1].html, blocks[1].html);
  assert.equal(out[2].href, "?contacts.c=3");
  assert.equal(blocks[0].blocks[0].html, '<a href="?a=1">x</a>', "the input is not changed");
});

test("GET form: field names get the prefix, hidden inputs keep working, other forms are left alone", () => {
  const form = '<form class="s" method="get" role="search"><label for="q">Search</label><input id="q" type="search" name="q" value="a"><input type="hidden" name="tab" value="people"><select name="sort"><option value="1">1</option></select><textarea name="note">x</textarea><button type="submit" name="go" value="1">Go</button></form>';
  const out = scoped(form);
  assert.ok(out.includes('name="contacts.q"') && out.includes('name="contacts.tab"') && out.includes('name="contacts.sort"') && out.includes('name="contacts.note"') && out.includes('name="contacts.go"'), out);
  assert.ok(out.includes('type="hidden" name="contacts.tab" value="people"'), "value untouched");
  assert.ok(out.includes('id="q"') && out.includes('for="q"'), "ids and labels untouched");
  // a form without a method is a GET form too
  assert.equal(scoped('<form><input name="q"></form>'), '<form><input name="contacts.q"></form>');
  assert.equal(scoped('<form method="GET" action=""><input name="q"></form>'), '<form method="GET" action=""><input name="contacts.q"></form>');
  // leaving the page, or not a GET: untouched
  for (const f of ['<form method="post"><input name="q"></form>', '<form method="get" action="/m/x/go"><input name="q"></form>', '<form method="get" action="https://example.org/"><input name="q"></form>']) assert.equal(scoped(f), f);
  // names outside the form, and names already prefixed, are untouched
  assert.equal(scoped('<input name="q"><form method="get"><input name="contacts.q"><input name="a b"><input name="q"></form><input name="r">'), '<input name="q"><form method="get"><input name="contacts.q"><input name="a b"><input name="contacts.q"></form><input name="r">');
  // two forms: the second (post) is not rewritten after the first (get) closed
  assert.equal(scoped('<form method="get"><input name="a"></form><form method="post"><input name="a"></form>'), '<form method="get"><input name="contacts.a"></form><form method="post"><input name="a"></form>');
});

test("GET form: the module reads its own names again once the prefix is stripped (replay of sectionQuery)", () => {
  const submitted = { "contacts.q": "ann", "contacts.tab": "people" };
  assert.deepEqual(S.sectionQuery(submitted, "contacts", false), { q: "ann", tab: "people" });
  assert.deepEqual(S.sectionQuery({ ...submitted, "other.q": "zz" }, "contacts", false), { q: "ann", tab: "people" });
});

test("markdown links: inline `](?…)` links move, code and other links stay", () => {
  const md = (text) => S.scopeBlocks([{ type: "markdown", text }], "legal-pages")[0].text;
  assert.equal(md("[Edit](?step=id)"), "[Edit](?legal-pages.step=id)");
  assert.equal(md("a [x](?view=preview&lang=fr) · [y](?view=preview&amp;lang=en) · [back](?)"), "a [x](?legal-pages.view=preview&legal-pages.lang=fr) · [y](?legal-pages.view=preview&amp;legal-pages.lang=en) · [back](?)");
  assert.equal(md('[x](?step=a "title")'), '[x](?legal-pages.step=a "title")');
  assert.equal(md("[x](?step=a#top) and [z](https://example.org/?a=1) and [w](/admin/x?a=1)"), "[x](?legal-pages.step=a#top) and [z](https://example.org/?a=1) and [w](/admin/x?a=1)");
  assert.equal(md("[x](?legal-pages.step=a)"), "[x](?legal-pages.step=a)");
  assert.equal(md("`[x](?a=1)` and [y](?a=1)"), "`[x](?a=1)` and [y](?legal-pages.a=1)");
  assert.equal(md("```\n[x](?a=1)\n```\n[y](?a=1)"), "```\n[x](?a=1)\n```\n[y](?legal-pages.a=1)");
  assert.equal(md("[x](?a=1"), "[x](?legal-pages.a=1");
  const once = md("[x](?a=1&b=2)");
  assert.equal(md(once), once);
  // only `markdown` blocks: the `text` of other blocks is not markdown
  assert.equal(S.scopeBlocks([{ type: "heading", text: "[x](?a=1)" }], "legal-pages")[0].text, "[x](?a=1)");
});

test("sole contributor: nothing to rewrite for reading, both forms are read; namespaced links keep working", () => {
  const out = S.scopeBlocks([html('<a href="?new=person">Add</a>')], "contacts")[0].html;
  assert.equal(out, '<a href="?contacts.new=person">Add</a>');
  const clicked = { "contacts.new": "person" };
  assert.deepEqual(S.sectionQuery(clicked, "contacts", true), { new: "person" });
  assert.deepEqual(S.sectionQuery(clicked, "contacts", false), { new: "person" });
  assert.deepEqual(S.sectionQuery({ new: "person" }, "contacts", true), { new: "person" }, "old bookmark");
  assert.deepEqual(S.sectionQuery({ new: "person" }, "contacts", false), {}, "belongs to nobody on a shared tab");
});

test("an instance key that is not a namespace leaves everything as it is", () => {
  const blocks = [html('<a href="?a=1">x</a><form><input name="q"></form>'), { type: "markdown", text: "[x](?a=1)" }];
  assert.deepEqual(S.scopeBlocks(blocks, "Bad Key"), blocks);
});

test("soleOnTab counts the modules of the tab, not of the page", () => {
  const tab = (...ids) => ({ sections: ids.map((moduleId) => ({ moduleId })) });
  assert.equal(S.soleOnTab(tab("contacts")), true);
  assert.equal(S.soleOnTab(tab("contacts", "contacts")), true);
  assert.equal(S.soleOnTab(tab("contacts", "twitch-bot")), false);
  assert.equal(S.soleOnTab(tab()), false);
});

test("pathological input stays fast (no backtracking)", () => {
  const t0 = Date.now();
  const big = [
    "<a " + 'x="'.repeat(20000), "<".repeat(50000), '<a href="?' + "a&".repeat(100000) + '">', "<form>" + '<input name="a">'.repeat(20000) + "</form>",
    "<a " + " ".repeat(200000) + 'href="?a=1">', "[x](?" + "a".repeat(200000) + ")", "<!--".repeat(50000),
  ];
  for (const s of big) { S.scopeBlocks([html(s), { type: "markdown", text: s }], "contacts"); }
  assert.ok(Date.now() - t0 < 3000, `${Date.now() - t0} ms`);
});
