import test from "node:test";
import assert from "node:assert/strict";

const A = await import("@/core/agents");

test("agents : chaque texte d'agent tombe dans sa catégorie", () => {
  const cases = {
    person: ["Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"],
    search: ["Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)", "Mozilla/5.0 (compatible; bingbot/2.0)", "Mozilla/5.0 (compatible; Yahoo! Slurp)", "Mozilla/5.0 (compatible; YandexBot/3.0)", "Mozilla/5.0 (Applebot/0.1)"],
    ai: ["Mozilla/5.0 AppleWebKit/537.36 (compatible; GPTBot/1.0)", "ChatGPT-User/1.0", "OAI-SearchBot/1.0", "Mozilla/5.0 (compatible; ClaudeBot/1.0)", "PerplexityBot/1.0", "Mozilla/5.0 (compatible; Bytespider; spider-feedback@bytedance.com)", "CCBot/2.0 (https://commoncrawl.org/faq/)", "Mozilla/5.0 (Amazonbot/0.1)", "Mozilla/5.0 (compatible; Google-Extended)"],
    preview: ["facebookexternalhit/1.1", "WhatsApp/2.23.20.0 A", "Slackbot-LinkExpanding 1.0", "Mozilla/5.0 (compatible; Discordbot/2.0)", "Twitterbot/1.0", "Mozilla/5.0 (compatible; Mastodon/4.2)", "Mozilla/5.0 (compatible; SkypeUriPreview Preview/0.5)"],
    tool: ["Mozilla/5.0 (compatible; AhrefsBot/7.0)", "Mozilla/5.0 (compatible; SemrushBot/7)", "curl/8.5.0", "python-requests/2.31", "Go-http-client/2.0", "Mozilla/5.0 HeadlessChrome/126.0", "Mozilla/5.0 (compatible; UptimeRobot/2.0)", "", "  ", "x", "Mozilla/5.0 (compatible; SomeNewBot/1.0)"],
  };
  for (const [kind, list] of Object.entries(cases)) for (const ua of list) assert.equal(A.classifyAgent(ua), kind, JSON.stringify(ua));
  assert.equal(A.classifyAgent(undefined), "tool");
  assert.equal(A.classifyAgent("Mozilla/5.0 " + "a".repeat(1100)), "tool");
  assert.deepEqual([...A.ROBOT_CATEGORIES].sort(), ["ai", "preview", "search", "tool"]);
});
