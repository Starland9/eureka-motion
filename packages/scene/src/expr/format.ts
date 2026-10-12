export type Language = "fr" | "en";

export type NumberFormat =
  | { kind: "int" }
  | { kind: "fixed"; digits: number }
  | { kind: "sig"; digits: number }
  | { kind: "sci"; digits: number }
  | { kind: "percent"; digits: number };

export const DEFAULT_FORMAT: NumberFormat = { kind: "sig", digits: 3 };

const FORMAT = /^(int|fixed|sig|sci|percent)(?::(\d{1,2}))?$/;
const LOCALES: Record<Language, string> = { fr: "fr-FR", en: "en-US" };
const SUPERSCRIPTS = "⁰¹²³⁴⁵⁶⁷⁸⁹";
const MINUS = "−";

export class FormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FormatError";
  }
}

export function parseFormat(spec: string): NumberFormat {
  const match = FORMAT.exec(spec.trim());
  if (!match) {
    throw new FormatError(`Unknown number format "${spec}"`);
  }
  const kind = match[1] as NumberFormat["kind"];
  const digits = match[2] === undefined ? undefined : Number(match[2]);
  if (kind === "int") {
    if (digits !== undefined) throw new FormatError(`"int" takes no digit count`);
    return { kind };
  }
  if (digits === undefined) {
    throw new FormatError(`Format "${kind}" needs a digit count, for example "${kind}:2"`);
  }
  if (kind === "sig" && digits < 1) {
    throw new FormatError(`"sig" needs at least 1 significant digit`);
  }
  if (digits > 12) {
    throw new FormatError(`Format "${spec}" asks for too many digits`);
  }
  return { kind, digits };
}

function superscript(n: number): string {
  const digits = String(Math.abs(n))
    .split("")
    .map((d) => SUPERSCRIPTS[Number(d)] as string)
    .join("");
  return n < 0 ? `⁻${digits}` : digits;
}

function plain(value: number, language: Language, min: number, max: number): string {
  return new Intl.NumberFormat(LOCALES[language], {
    minimumFractionDigits: min,
    maximumFractionDigits: max,
  })
    .format(value)
    .replace(/^-/, MINUS);
}

interface SciParts {
  mantissa: string;
  exponent: number | null;
}

function scientificParts(value: number, digits: number, language: Language): SciParts {
  if (value === 0) return { mantissa: plain(0, language, digits, digits), exponent: null };
  let exponent = Math.floor(Math.log10(Math.abs(value)));
  let mantissa = value / 10 ** exponent;
  if (Math.abs(Number(mantissa.toFixed(digits))) >= 10) {
    mantissa /= 10;
    exponent += 1;
  }
  return {
    mantissa: plain(mantissa, language, digits, digits),
    exponent: exponent === 0 ? null : exponent,
  };
}

function joinParts(parts: SciParts): string {
  return parts.exponent === null
    ? parts.mantissa
    : `${parts.mantissa} × 10${superscript(parts.exponent)}`;
}

function significantParts(value: number, digits: number, language: Language): SciParts {
  if (value === 0) return { mantissa: "0", exponent: null };
  const magnitude = Math.floor(Math.log10(Math.abs(value)));
  if (magnitude >= 6 || magnitude < -4) {
    return scientificParts(value, Math.max(0, digits - 1), language);
  }
  const rounded = Number(value.toPrecision(digits));
  const decimals = Math.max(0, digits - 1 - Math.floor(Math.log10(Math.abs(rounded))));
  return { mantissa: plain(rounded, language, 0, Math.min(decimals, 12)), exponent: null };
}

export interface NumberParts {
  mantissa: string;
  exponent: number | null;
  suffix: string;
}

export function formatNumberParts(
  value: number,
  format: NumberFormat = DEFAULT_FORMAT,
  language: Language = "fr",
): NumberParts {
  if (!Number.isFinite(value)) return { mantissa: "—", exponent: null, suffix: "" };
  switch (format.kind) {
    case "int":
      return { mantissa: plain(Math.round(value), language, 0, 0), exponent: null, suffix: "" };
    case "fixed":
      return {
        mantissa: plain(value, language, format.digits, format.digits),
        exponent: null,
        suffix: "",
      };
    case "sig":
      return { ...significantParts(value, format.digits, language), suffix: "" };
    case "sci":
      return { ...scientificParts(value, format.digits, language), suffix: "" };
    case "percent":
      return {
        mantissa: plain(value * 100, language, format.digits, format.digits),
        exponent: null,
        suffix: language === "fr" ? "\u202F%" : "%",
      };
  }
}

export function formatNumber(
  value: number,
  format: NumberFormat = DEFAULT_FORMAT,
  language: Language = "fr",
): string {
  const parts = formatNumberParts(value, format, language);
  return `${joinParts(parts)}${parts.suffix}`;
}
