import { readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const articlesRoot = join(repositoryRoot, "articles");

function isWhitespace(character) {
  return character == null || /\s/u.test(character);
}

function isPunctuation(character) {
  return character != null && /[\p{P}\p{S}]/u.test(character);
}

function maskInlineCode(line) {
  return line.replace(/`+[^`]*`+/g, (value) => "x".repeat(value.length));
}

function unescapedDollarPositions(line) {
  const positions = [];
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] !== "$") continue;

    let backslashes = 0;
    for (let cursor = index - 1; cursor >= 0 && line[cursor] === "\\"; cursor -= 1) {
      backslashes += 1;
    }
    if (backslashes % 2 === 0) positions.push(index);
  }
  return positions;
}

function isNumericInlineMath(line, openingPosition, dollarPositions) {
  const closingPosition = dollarPositions.find((position) => position > openingPosition);
  if (closingPosition == null || /[0-9]/.test(line[closingPosition + 1] ?? "")) return false;

  const expression = line.slice(openingPosition + 1, closingPosition);
  return (
    /^[0-9]+(?:\.[0-9]+)?$/.test(expression) ||
    /\\(?:to|times|frac|approx|le|ge|sum|sqrt|cdot)\b/.test(expression)
  );
}

function inspectArticle(fileName, source) {
  const findings = [];
  const lines = source.split("\n");
  let codeFence = null;
  let mathFence = false;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const originalLine = lines[lineIndex];
    const codeFenceMatch = originalLine.match(/^\s*(`{3,}|~{3,})/);
    if (codeFenceMatch) {
      const marker = codeFenceMatch[1][0];
      if (codeFence == null) codeFence = marker;
      else if (codeFence === marker) codeFence = null;
      continue;
    }
    if (codeFence != null) continue;

    if (/^\s*\$\$\s*$/.test(originalLine)) {
      mathFence = !mathFence;
      continue;
    }
    if (mathFence) continue;

    const line = maskInlineCode(originalLine);

    for (const match of line.matchAll(/\*\*([^*\n]+?)\*\*/g)) {
      const start = match.index;
      const end = start + match[0].length;
      const content = match[1];
      const previous = start > 0 ? line[start - 1] : null;
      const next = end < line.length ? line[end] : null;
      const first = content[0] ?? null;
      const last = content[content.length - 1] ?? null;
      const canOpen =
        !isWhitespace(first) &&
        (!isPunctuation(first) || isWhitespace(previous) || isPunctuation(previous));
      const canClose =
        !isWhitespace(last) &&
        (!isPunctuation(last) || isWhitespace(next) || isPunctuation(next));

      if (!canOpen || !canClose) {
        findings.push({
          column: start + 1,
          line: lineIndex + 1,
          message: "太字の前後に空白が必要です",
          sample: match[0],
        });
      }
    }

    const dollarPositions = unescapedDollarPositions(line);
    for (const position of dollarPositions) {
      if (!/[0-9]/.test(line[position + 1] ?? "")) continue;
      if (isNumericInlineMath(line, position, dollarPositions)) continue;

      findings.push({
        column: position + 1,
        line: lineIndex + 1,
        message: "通貨記号の$を\\$へエスケープしてください",
        sample: line.slice(position, position + 24),
      });
    }
  }

  return findings.map((finding) => ({ fileName, ...finding }));
}

function normalizeLine(originalLine) {
  let line = originalLine;
  const maskedLine = maskInlineCode(line);
  const dollarPositions = unescapedDollarPositions(maskedLine);

  for (const position of [...dollarPositions].reverse()) {
    if (!/[0-9]/.test(maskedLine[position + 1] ?? "")) continue;
    if (isNumericInlineMath(maskedLine, position, dollarPositions)) continue;
    line = `${line.slice(0, position)}\\${line.slice(position)}`;
  }

  line = line.replace(
    /\*\*(\s*)([^*\n]*?\S)(\s*)\*\*/g,
    (_match, leadingWhitespace, content, trailingWhitespace) =>
      `${leadingWhitespace}**${content}**${trailingWhitespace}`,
  );

  const strongMatches = [...line.matchAll(/\*\*([^*\n]+?)\*\*/g)];
  for (const match of strongMatches.reverse()) {
    const start = match.index;
    const end = start + match[0].length;
    const content = match[1];
    const previous = start > 0 ? line[start - 1] : null;
    const next = end < line.length ? line[end] : null;
    const first = content[0] ?? null;
    const last = content[content.length - 1] ?? null;
    const canOpen =
      !isWhitespace(first) &&
      (!isPunctuation(first) || isWhitespace(previous) || isPunctuation(previous));
    const canClose =
      !isWhitespace(last) &&
      (!isPunctuation(last) || isWhitespace(next) || isPunctuation(next));

    if (!canClose) line = `${line.slice(0, end)} ${line.slice(end)}`;
    if (!canOpen) line = `${line.slice(0, start)} ${line.slice(start)}`;
  }

  return line;
}

function normalizeArticle(source) {
  const lines = source.split("\n");
  let codeFence = null;
  let mathFence = false;

  return lines
    .map((line) => {
      const codeFenceMatch = line.match(/^\s*(`{3,}|~{3,})/);
      if (codeFenceMatch) {
        const marker = codeFenceMatch[1][0];
        if (codeFence == null) codeFence = marker;
        else if (codeFence === marker) codeFence = null;
        return line;
      }
      if (codeFence != null) return line;

      if (/^\s*\$\$\s*$/.test(line)) {
        mathFence = !mathFence;
        return line;
      }
      if (mathFence) return line;

      return normalizeLine(line);
    })
    .join("\n");
}

const articleFiles = (await readdir(articlesRoot))
  .filter((fileName) => fileName.endsWith(".md"))
  .sort();
const findings = [];
const shouldFix = process.argv.includes("--fix");

for (const fileName of articleFiles) {
  const articlePath = join(articlesRoot, fileName);
  const source = await readFile(articlePath, "utf8");
  if (!/^published:\s*true$/m.test(source)) continue;
  const normalizedSource = shouldFix ? normalizeArticle(source) : source;
  if (shouldFix && normalizedSource !== source) {
    await writeFile(articlePath, normalizedSource, "utf8");
  }
  findings.push(...inspectArticle(fileName, normalizedSource));
}

if (findings.length === 0) {
  console.log("Zenn Markdown check: OK");
  process.exit(0);
}

for (const finding of findings) {
  console.error(
    `${finding.fileName}:${finding.line}:${finding.column} ${finding.message}: ${finding.sample}`,
  );
}
console.error(`Zenn Markdown check: ${findings.length}件の問題を検出しました。`);
process.exit(1);
