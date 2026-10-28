import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

function vars(block: string): Record<string, string> {
  return Object.fromEntries([...block.matchAll(/--([a-z-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]]));
}
const light = vars(css.slice(css.indexOf(":root {"), css.indexOf("@media (prefers-color-scheme: dark)")));
const darkStart = css.indexOf("@media (prefers-color-scheme: dark)");
const dark = { ...light, ...vars(css.slice(darkStart, css.indexOf("*, *::before", darkStart))) };

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const ratio = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// Text on background pairs used in the UI. Body and secondary text must clear 7:1 (WCAG AAA); small, tertiary text and colours 4.5:1 (AA).
const STRONG: [string, string][] = [["ink", "paper"], ["ink", "surface"], ["ink-soft", "paper"], ["ink-soft", "surface"]];
const AA: [string, string][] = [
  ["ink-faint", "paper"], ["ink-faint", "surface"], ["accent", "paper"], ["accent", "surface"], ["accent-ink", "accent"],
  ["accent", "accent-wash"], ["warn", "warn-wash"], ["ok", "surface"], ["bad", "surface"], ["ink", "chip"],
];

describe.each([["light", light], ["dark", dark]] as const)("%s theme contrast", (_name, theme) => {
  test.each(STRONG)("%s on %s is at least 7:1", (fg, bg) => {
    expect(theme[fg], `missing --${fg}`).toBeDefined();
    expect(ratio(theme[fg], theme[bg])).toBeGreaterThanOrEqual(7);
  });
  test.each(AA)("%s on %s is at least 4.5:1", (fg, bg) => {
    expect(theme[fg], `missing --${fg}`).toBeDefined();
    expect(theme[bg], `missing --${bg}`).toBeDefined();
    expect(ratio(theme[fg], theme[bg])).toBeGreaterThanOrEqual(4.5);
  });
});
