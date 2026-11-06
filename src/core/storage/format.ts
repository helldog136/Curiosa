/** Sizes in the reader's language ("3,2 Go" / "3.2 GB"). Binary steps (1 GB = 1024 MB), like the disk tools of the system. */
const STEPS = ["byte", "kilobyte", "megabyte", "gigabyte", "terabyte"] as const;

export function formatBytes(bytes: number, locale: string): string {
  let value = Math.max(0, Number.isFinite(bytes) ? bytes : 0);
  let step = 0;
  while (value >= 1024 && step < STEPS.length - 1) { value /= 1024; step++; }
  // Bytes and KB are whole numbers; from MB up, one decimal below 10 and none above.
  const digits = step <= 1 ? 0 : value < 10 ? 1 : 0;
  return new Intl.NumberFormat(locale, { style: "unit", unit: STEPS[step], unitDisplay: step === 0 ? "narrow" : "short", maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(value);
}
