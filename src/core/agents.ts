/**
 * AGENTS QUI NE SONT PAS DES PERSONNES : une seule liste pour tout le cœur (statistiques de pages, passages des liens courts).
 *
 * Le texte « agent » envoyé par le navigateur sert UNIQUEMENT à classer le passage, tout de suite ; il n'est jamais gardé ni compté.
 * Catégories : `person` (pas de robot reconnu), `search` (moteurs de recherche), `ai` (robots d'intelligence artificielle), `preview` (aperçus de liens
 * des messageries et réseaux), `tool` (outils de référencement, scripts, surveillance, navigateurs sans écran, robots génériques).
 * Les catégories sont essayées dans l'ordre ci-dessous : « Google-Extended » est de l'IA avant d'être « google- » (moteur).
 * La liste est volontairement large : mieux vaut ne pas compter une vraie visite que gonfler les chiffres.
 */
export const ROBOT_CATEGORIES = ["search", "ai", "preview", "tool"] as const;
export type RobotCategory = (typeof ROBOT_CATEGORIES)[number];
export type AgentKind = "person" | RobotCategory;

const re = (parts: string[]) => new RegExp(parts.join("|"), "i");

const AI = re(["gptbot", "chatgpt", "oai-searchbot", "claude", "anthropic", "perplexity", "bytespider", "ccbot", "amazonbot", "google-extended", "meta-externalagent", "applebot-extended", "cohere", "mistralai", "diffbot", "youbot", "duckassistbot", "timpibot", "omgili", "imagesiftbot"]);
const PREVIEW = re([
  "preview", "unfurl", "facebookexternalhit", "facebot", "whatsapp/", "telegrambot", "slackbot", "slack-imgproxy", "discordbot", "skypeuripreview", "linkedinbot", "twitterbot", "pinterest/", "pinterestbot", "tumblr/", "redditbot", "mastodon", "cardyb", "embedly", "quora link", "vkshare", "viber/", "kakaotalk-scrap", "line-poker", "snapchat/", "imessage",
]);
const SEARCH = re(["googlebot", "google-", "adsbot", "mediapartners", "apis-google", "bingbot", "duckduck", "yandex", "baidu", "sogou", "exabot", "ia_archiver", "applebot", "petalbot", "yahoo! slurp", "slurp"]);
const TOOL = re([
  "bot\\b", "bot/", "bots?[ ;)_-]", "crawl", "spider", "scrap", "fetch", "headless", "lighthouse", "pagespeed", "monitor", "uptime", "pingdom", "check_http", "validator",
  "semrush", "ahrefs", "mj12", "dotbot",
  "curl/", "wget/", "python", "go-http", "java/", "okhttp", "httpclient", "libwww", "node-fetch", "axios", "undici", "postman", "insomnia", "php/", "ruby", "perl", "scrapy", "http_request",
]);
const ORDER: [RobotCategory, RegExp][] = [["ai", AI], ["preview", PREVIEW], ["search", SEARCH], ["tool", TOOL]];

/** Classe un texte d'agent. Un texte vide ou trop court (script) ou démesuré est un outil ; sans robot reconnu, c'est une personne. */
export function classifyAgent(userAgent: string | null | undefined): AgentKind {
  const ua = (userAgent ?? "").trim();
  if (ua.length < 8 || ua.length > 1000) return "tool";
  for (const [kind, pattern] of ORDER) if (pattern.test(ua)) return kind;
  return "person";
}
