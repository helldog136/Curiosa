import { Callout } from "./Page";
import { CopyBlock } from "./CopyBlock";

/** Clés de traduction dont le guide a besoin : la page les résout côté serveur et les passe en `texts`. */
export const GUIDE_KEYS = [
  "mcp.guide.marker", "mcp.guide.copy", "mcp.guide.copied", "mcp.guide.placeholderNote", "mcp.guide.filled",
  "mcp.guide.claude.title", "mcp.guide.claude.text", "mcp.guide.claude.need", "mcp.guide.secretWarn",
  "mcp.guide.code.title", "mcp.guide.code.text",
  "mcp.guide.other.title", "mcp.guide.other.text", "mcp.guide.other.generic", "mcp.guide.other.vscode", "mcp.guide.other.windsurf",
  "mcp.guide.test.title", "mcp.guide.test.text", "mcp.guide.test.expected",
  "mcp.guide.how.title", "mcp.guide.how.token", "mcp.guide.how.header", "mcp.guide.how.browser", "mcp.guide.how.rights", "mcp.guide.how.transport",
] as const;

export type GuideTexts = Record<(typeof GUIDE_KEYS)[number], string>;

const INIT = '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"test","version":"1"}}}';
const LIST = '{"jsonrpc":"2.0","id":2,"method":"tools/list"}';

/**
 * Les consignes de branchement, une par assistant, prêtes à copier. Sans `token`, elles contiennent le marqueur « <votre-jeton> » :
 * le vrai jeton n'existe en clair qu'à la création (seule son empreinte est conservée), c'est donc le seul écran qui le passe ici.
 */
export function McpConnectGuide({ texts, baseUrl, token, byUrl, advanced }: { texts: GuideTexts; baseUrl: string; token?: string; byUrl?: boolean; advanced?: boolean }) {
  const secret = token ?? texts["mcp.guide.marker"];
  const endpoint = `${baseUrl}/api/mcp`;
  const secretUrl = `${endpoint}/${secret}`;
  const copy = { copyLabel: texts["mcp.guide.copy"], copiedLabel: texts["mcp.guide.copied"] };
  const headers = { Authorization: `Bearer ${secret}` };
  const json = (value: unknown) => JSON.stringify(value, null, 2);
  const generic = json({ mcpServers: { curiosa: { type: "http", url: endpoint, headers } } });
  const vscode = json({ servers: { curiosa: { type: "http", url: endpoint, headers } } });
  const windsurf = json({ mcpServers: { curiosa: { serverUrl: endpoint, headers } } });
  const curlBase = `curl -s ${endpoint} \\\n  -H "Authorization: Bearer ${secret}" \\\n  -H "Content-Type: application/json" \\\n  -H "Accept: application/json, text/event-stream"`;
  const card = "rounded-xl border border-line bg-surface/60 p-4";
  const summary = "cursor-pointer text-[15px] font-semibold";

  return (
    <div className="space-y-3" data-testid="mcp-guide">
      {!token && <p className="text-sm text-muted">{texts["mcp.guide.placeholderNote"].replace("{marker}", texts["mcp.guide.marker"])}</p>}
      {token && <Callout tone="ok">{texts["mcp.guide.filled"]}</Callout>}

      <details className={card} open data-testid="mcp-guide-claude">
        <summary className={summary}>{texts["mcp.guide.claude.title"]}</summary>
        <div className="mt-3 space-y-3">
          <p className="text-sm leading-6">{texts["mcp.guide.claude.text"]}</p>
          {byUrl === false ? (
            <Callout tone="warn">{texts["mcp.guide.claude.need"]}</Callout>
          ) : (
            <>
              <CopyBlock text={secretUrl} {...copy} />
              {byUrl === undefined && <p className="text-[13px] leading-5 text-muted">{texts["mcp.guide.claude.need"]}</p>}
              <Callout tone="warn">{texts["mcp.guide.secretWarn"]}</Callout>
            </>
          )}
        </div>
      </details>

      <details className={card} open data-testid="mcp-guide-code">
        <summary className={summary}>{texts["mcp.guide.code.title"]}</summary>
        <div className="mt-3 space-y-3">
          <p className="text-sm leading-6">{texts["mcp.guide.code.text"]}</p>
          <CopyBlock text={`claude mcp add --transport http curiosa ${endpoint} --header "Authorization: Bearer ${secret}"`} {...copy} />
        </div>
      </details>

      <details className={card} open={!!advanced} data-testid="mcp-guide-other">
        <summary className={summary}>{texts["mcp.guide.other.title"]}</summary>
        <div className="mt-3 space-y-3">
          <p className="text-sm leading-6">{texts["mcp.guide.other.text"]}</p>
          <CopyBlock text={generic} label={texts["mcp.guide.other.generic"]} {...copy} />
          <CopyBlock text={vscode} label={texts["mcp.guide.other.vscode"]} {...copy} />
          <CopyBlock text={windsurf} label={texts["mcp.guide.other.windsurf"]} {...copy} />
        </div>
      </details>

      <details className={card} data-testid="mcp-guide-test">
        <summary className={summary}>{texts["mcp.guide.test.title"]}</summary>
        <div className="mt-3 space-y-3">
          <p className="text-sm leading-6">{texts["mcp.guide.test.text"]}</p>
          <CopyBlock text={`${curlBase} \\\n  -d '${INIT}'`} label="initialize" {...copy} />
          <CopyBlock text={`${curlBase} \\\n  -d '${LIST}'`} label="tools/list" {...copy} />
          <p className="text-[13px] leading-5 text-muted">{texts["mcp.guide.test.expected"]}</p>
        </div>
      </details>

      <details className={card} open={!!advanced} data-testid="mcp-guide-how">
        <summary className={summary}>{texts["mcp.guide.how.title"]}</summary>
        <div className="mt-3 space-y-3">
          <ul className="list-disc space-y-1.5 pl-5 text-sm leading-6">
            <li>{texts["mcp.guide.how.token"]}</li>
            <li>{texts["mcp.guide.how.header"]}</li>
            <li>{texts["mcp.guide.how.browser"]}</li>
            <li>{texts["mcp.guide.how.rights"]}</li>
            {advanced && <li>{texts["mcp.guide.how.transport"]}</li>}
          </ul>
        </div>
      </details>
    </div>
  );
}
