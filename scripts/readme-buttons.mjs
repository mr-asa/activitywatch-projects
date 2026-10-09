// Generates the header buttons of the READMEs (docs/images/btn-*.svg) so the
// blog link and the language switch share one style (rounded, same height and
// font). GitHub strips CSS from READMEs, so the buttons are small SVG images.
// Run: node scripts/readme-buttons.mjs
import { readFileSync, writeFileSync } from "node:fs";
const dir = new URL("../docs/images/", import.meta.url);
const favicon = readFileSync(new URL("blog-favicon.png", dir)).toString(
  "base64",
);
const FONT = "Verdana,Geneva,DejaVu Sans,sans-serif";
const CHAR = 7.6; // width of one capital letter at 10px bold plus spacing
function button({ label, fill, icon }) {
  const text = label.toUpperCase();
  const textWidth = Math.round(text.length * CHAR);
  const left = icon ? 36 : 14;
  const width = left + textWidth + 14;
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="28" role="img" aria-label="${label}">
  <title>${label}</title>
  <rect width="${width}" height="28" rx="6" fill="${fill}"/>${
    icon
      ? `\n  <image x="12" y="6" width="16" height="16" xlink:href="data:image/png;base64,${favicon}"/>`
      : ""
  }
  <text x="${left}" y="18" fill="#fff" font-family="${FONT}" font-size="10" font-weight="bold" textLength="${textWidth}" lengthAdjust="spacing">${text}</text>
</svg>
`;
}
const GREY = "#4b5563";
const GREEN = "#2f9e7f";
const files = {
  "btn-blog.svg": { label: "Описание в блоге", fill: "#2563eb", icon: true },
  "btn-english.svg": { label: "English", fill: GREY },
  "btn-english-active.svg": { label: "English", fill: GREEN },
  "btn-russian.svg": { label: "Русский", fill: GREY },
  "btn-russian-active.svg": { label: "Русский", fill: GREEN },
};
for (const [name, spec] of Object.entries(files))
  writeFileSync(new URL(name, dir), button(spec));
writeFileSync(
  new URL("btn-separator.svg", dir),
  `<svg xmlns="http://www.w3.org/2000/svg" width="17" height="28" role="presentation"><rect x="8" y="3" width="1.5" height="22" rx="0.75" fill="#6b7280"/></svg>\n`,
);
