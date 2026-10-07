const HEX = /^#[0-9a-fA-F]{6}$/;

export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX.test(value);
}

function parse(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

export function luminance(hex: string): number {
  const [r, g, b] = parse(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function mix(a: string, b: string, ratio: number): string {
  const [ar, ag, ab] = parse(a);
  const [br, bg, bb] = parse(b);
  const m = (x: number, y: number) => Math.round(x + (y - x) * ratio).toString(16).padStart(2, "0");
  return `#${m(ar, br)}${m(ag, bg)}${m(ab, bb)}`;
}

/** Palette complète dérivée de deux couleurs : le fond et l'accent. */
export function buildPalette(background: string, accent: string): Record<string, string> {
  const bg = isHexColor(background) ? background : "#121214";
  const ac = isHexColor(accent) ? accent : "#e8a23b";
  const fg = luminance(bg) > 0.4 ? "#18181b" : "#f4f4f5";
  return {
    "--v-bg": bg,
    "--v-fg": fg,
    "--v-muted": mix(bg, fg, 0.62),
    "--v-surface": mix(bg, fg, 0.06),
    "--v-line": mix(bg, fg, 0.16),
    "--v-accent": ac,
    "--v-accent-fg": luminance(ac) > 0.45 ? "#111111" : "#ffffff",
  };
}

export const FONT_STACKS = {
  sans: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  serif: 'ui-serif, Georgia, Cambria, "Times New Roman", serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
} as const;
