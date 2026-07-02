import fs from "node:fs";

const inputPath = ".local-data/tspdt-gf1000-table.html";
const outputPath = "apps/web/src/cinema/tspdt.ts";

const html = fs.readFileSync(inputPath, "utf8");

function textFromCell(value) {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&frac12;/g, "1/2")
    .replace(/\s+/g, " ")
    .trim();
}

const entries = [...html.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)]
  .map((row) => [...row[0].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((cell) => textFromCell(cell[1])))
  .filter((cells) => cells.length === 7 && /^\d+$/.test(cells[0]))
  .map(([rank, previousRank, title, director, year, country]) => ({
    rank: Number(rank),
    previousRank,
    title,
    director,
    year,
    country
  }));

if (entries.length !== 1000) {
  throw new Error(`Expected 1000 TSPDT entries, got ${entries.length}.`);
}

const source = `export interface TspdtEntry {
  rank: number;
  previousRank: string;
  title: string;
  director: string;
  year: string;
  country: string;
}

export const tspdtEdition = "2026";
export const tspdtSourceUrl = "https://theyshootpictures.com/gf1000_all1000films_table.php";

export const tspdtTop1000: TspdtEntry[] = ${JSON.stringify(entries, null, 2)};
`;

fs.writeFileSync(outputPath, source);
console.log(`Wrote ${entries.length} TSPDT entries to ${outputPath}`);
