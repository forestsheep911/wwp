// Substitute only styles used for CJK text whose requested font cannot supply
// CJK glyphs. Keep timing, colors, position, sizing and dialogue text intact.
export function repairAssFonts(text, cjkFamilies, fallback = "STHeiti") {
  const substitutions = [];
  const families = new Set([...cjkFamilies, fallback].map(name => name.toLowerCase()));
  const lines = text.split(/\r?\n/u);
  const cjkStyles = new Set();
  for (const line of lines) {
    if (/^Dialogue:/iu.test(line) && /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(line)) {
      cjkStyles.add(line.slice(line.indexOf(":") + 1).split(",")[3]?.trim());
    }
  }
  let fontIndex = 1, nameIndex = 0;
  const replaceFont = family => {
    if (families.has(family.trim().toLowerCase())) return family;
    substitutions.push({ from: family, to: fallback });
    return fallback;
  };
  let inStyles = false;
  const repaired = lines.map(line => {
    if (/^\[/u.test(line)) inStyles = /^\[V4\+? Styles\]/iu.test(line);
    if (inStyles && /^Format:/iu.test(line)) {
      const fields = line.slice(line.indexOf(":") + 1).split(",").map(field => field.trim().toLowerCase());
      fontIndex = fields.indexOf("fontname"); nameIndex = fields.indexOf("name");
    }
    if (inStyles && /^Style:/iu.test(line)) {
      const prefix = line.slice(0, line.indexOf(":") + 1);
      const fields = line.slice(prefix.length).split(",");
      if (fontIndex >= 0 && cjkStyles.has(fields[nameIndex]?.trim())) fields[fontIndex] = replaceFont(fields[fontIndex]);
      return prefix + fields.join(",");
    }
    if (/^Dialogue:/iu.test(line) && /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(line)) {
      return line.replace(/\\fn([^\\}]+)/gu, (_, family) => `\\fn${replaceFont(family)}`);
    }
    return line;
  }).join("\n");
  return { text: repaired, substitutions };
}
