/**
 * Static checks that keep the client within the spec's rules: themed dialogs
 * only, no HTML injection, and colour only from daisyUI's semantic tokens.
 */
import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const CLIENT = join(import.meta.dir, "..", "src", "client");
const files = readdirSync(CLIENT)
  .filter((f) => /\.(ts|html|css|js)$/.test(f))
  .map((f) => ({ name: f, text: readFileSync(join(CLIENT, f), "utf8") }));

const offenders = (pattern: RegExp) => files.filter((f) => pattern.test(f.text)).map((f) => f.name);

test("never uses the browser's own dialogs", () => {
  expect(offenders(/\b(window\.)?(confirm|alert|prompt)\s*\(/)).toEqual([]);
});

test("never parses data as HTML", () => {
  expect(offenders(/\.(innerHTML|outerHTML)\s*=|insertAdjacentHTML|document\.write/)).toEqual([]);
});

test("no Tailwind palette shades, hand-written dark variants or literal colours", () => {
  const palette =
    /\b(bg|text|border|ring|outline|fill|stroke|from|via|to|shadow|divide|accent|caret|decoration)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|black|white)(-\d{2,3})?\b/;
  expect(offenders(palette)).toEqual([]);
  expect(offenders(/\bdark:[a-z!\[]/)).toEqual([]); // Tailwind variant, e.g. dark:bg-…
  expect(offenders(/#[0-9a-fA-F]{3,8}\b(?![\w-])|\brgba?\(|\bhsla?\(|\boklch\(/)).toEqual([]);
});

test("the stock winter and night themes are the only ones configured", () => {
  const css = files.find((f) => f.name === "styles.css")!.text;
  expect(css).toMatch(/themes:\s*winter --default,\s*night --prefersdark;/);
});
