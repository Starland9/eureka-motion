const MONO_ADVANCE = 0.6;
const MEASURE_MARGIN = 1.04;

const ADVANCE: readonly [string, number][] = [
  ["mw", 0.86],
  ["MW", 1],
  ["ijlîï", 0.31],
  ["ft", 0.34],
  ["rs", 0.42],
  [" '’,.:;", 0.26],
  ["()-", 0.35],
  ["0123456789", 0.5],
  ["IJ", 0.42],
];

function advance(char: string): number {
  for (const [chars, width] of ADVANCE) if (chars.includes(char)) return width;
  return char !== char.toLowerCase() ? 0.72 : 0.54;
}

export function textWidth(text: string, size: number): number {
  let total = 0;
  for (const char of text) total += advance(char);
  return total * size * MEASURE_MARGIN;
}

export function monoWidth(text: string, size: number): number {
  return [...text].length * MONO_ADVANCE * size;
}

export function longestWord(texts: readonly string[], size: number): number {
  return Math.max(
    0,
    ...texts.flatMap((text) => text.split(/\s+/).map((word) => textWidth(word, size))),
  );
}

export function wrapText(text: string, maxWidth: number, size: number): string[] {
  const lines: string[] = [];
  let current = "";
  const flush = (): void => {
    if (current) lines.push(current);
    current = "";
  };
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (textWidth(word, size) > maxWidth) {
      flush();
      for (const char of word) {
        if (current && textWidth(current + char, size) > maxWidth) flush();
        current += char;
      }
      continue;
    }
    const joined = current ? `${current} ${word}` : word;
    if (textWidth(joined, size) <= maxWidth) current = joined;
    else {
      flush();
      current = word;
    }
  }
  flush();
  return lines;
}
