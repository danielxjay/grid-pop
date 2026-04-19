import QRCode from "qrcode";
import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const URL = "https://gridpop.app";
const CELL = 10;        // px per module
const PADDING = 4;      // modules of quiet zone
const RADIUS = 2;       // cell corner radius
const BG = "#f0e8ff";
const TONES = ["#ff3ca0", "#ffb347", "#52d9b0", "#38c8e8", "#b89af0"];

// Finder pattern positions (top-left of each 7×7 block)
function isFinderPattern(row, col, size) {
  return (
    (row < 7 && col < 7) ||
    (row < 7 && col >= size - 7) ||
    (row >= size - 7 && col < 7)
  );
}

const qr = QRCode.create(URL, { errorCorrectionLevel: "M" });
const { data, size } = qr.modules;

const total = (size + PADDING * 2) * CELL;
const cells = [];

for (let r = 0; r < size; r++) {
  for (let c = 0; c < size; c++) {
    if (!data[r * size + c]) continue;

    const x = (c + PADDING) * CELL;
    const y = (r + PADDING) * CELL;

    // Finder patterns get the accent pink, data modules cycle through tones
    const color = isFinderPattern(r, c, size)
      ? "#ff3ca0"
      : TONES[(r * 3 + c * 7) % TONES.length];

    cells.push(
      `<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="${RADIUS}" ry="${RADIUS}" fill="${color}"/>`
    );
  }
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${total}" height="${total}">
  <rect width="${total}" height="${total}" rx="16" fill="${BG}"/>
  ${cells.join("\n  ")}
</svg>`;

mkdirSync(join(__dirname, "../public"), { recursive: true });
const out = join(__dirname, "../public/qr.svg");
writeFileSync(out, svg);
console.log(`QR code written to ${out}`);
