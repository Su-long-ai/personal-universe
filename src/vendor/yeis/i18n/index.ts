export function _(key: string, params?: Record<string, string | number>): string {
  let text = key;
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      text = text.split(`{${name}}`).join(String(value));
    }
  }
  return text;
}
export function localeTag(): string { return "en-US"; }
export function fmtNum(n: number, opts?: Intl.NumberFormatOptions): string {
  return n.toLocaleString(localeTag(), opts);
}
export function fixed(n: number, digits: number): string {
  if (!Number.isFinite(n)) return String(n);
  return n.toLocaleString(localeTag(), { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
