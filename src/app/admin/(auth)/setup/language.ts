/**
 * The language the setup wizard starts in: the first language of the browser (`Accept-Language`) that the site can name, else English.
 * Never French by default: a person whose browser asks for nothing known reads English, and can switch in the first step.
 */
export function initialSetupLanguage(acceptLanguage: string | null | undefined, known: string[]): string {
  const wanted = (acceptLanguage ?? "")
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const q = Number(/q=([0-9.]+)/.exec(params.join(";"))?.[1] ?? 1);
      return { code: (tag ?? "").trim().toLowerCase().split("-")[0] ?? "", q: Number.isFinite(q) ? q : 0 };
    })
    .filter((x) => x.code && x.q > 0)
    .sort((a, b) => b.q - a.q);
  return wanted.find((x) => known.includes(x.code))?.code ?? "en";
}
