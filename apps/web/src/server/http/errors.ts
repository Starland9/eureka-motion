import type { Language } from "scene";
import { pipelineMessage } from "../pipeline/messages";

export type ErrorCode =
  | "invalid_request"
  | "mode_not_supported"
  | "not_found"
  | "expired"
  | "rate_limited"
  | "generation_unavailable"
  | "internal_error";

const STATUS: Readonly<Record<ErrorCode, number>> = {
  invalid_request: 400,
  mode_not_supported: 400,
  not_found: 404,
  expired: 410,
  rate_limited: 429,
  generation_unavailable: 503,
  internal_error: 500,
};

const MESSAGES: Readonly<Record<Language, Readonly<Record<ErrorCode, string>>>> = {
  fr: {
    invalid_request:
      "Ta demande est incomplète. Vérifie ta question, la langue et le niveau, puis réessaie.",
    mode_not_supported: "Ce type de demande n'est pas encore disponible.",
    not_found: "Cette explication est introuvable.",
    expired: "Ce lien a expiré : l'explication n'est plus conservée.",
    rate_limited: "Tu as posé beaucoup de questions en peu de temps. Réessaie un peu plus tard.",
    generation_unavailable: pipelineMessage("fr", "unavailable"),
    internal_error: "Un problème est survenu de notre côté. Réessaie dans un instant.",
  },
  en: {
    invalid_request:
      "Your request is incomplete. Check your question, the language and the level, then try again.",
    mode_not_supported: "This kind of request is not available yet.",
    not_found: "This explanation could not be found.",
    expired: "This link has expired: the explanation is no longer kept.",
    rate_limited: "You have asked a lot of questions in a short time. Try again a little later.",
    generation_unavailable: pipelineMessage("en", "unavailable"),
    internal_error: "Something went wrong on our side. Try again in a moment.",
  },
};

export function errorMessage(language: Language, code: ErrorCode): string {
  return MESSAGES[language][code];
}

function fromAcceptLanguage(header: string | null): Language {
  const ranked = (header ?? "")
    .split(",")
    .map((entry, position) => {
      const [tag = "", ...parameters] = entry.split(";");
      const weight = parameters.map((item) => /^\s*q=([\d.]+)\s*$/i.exec(item)?.[1]).find(Boolean);
      return {
        primary: tag.trim().toLowerCase().split("-")[0],
        weight: weight === undefined ? 1 : Number(weight),
        position,
      };
    })
    .filter(
      (entry): entry is typeof entry & { primary: Language } =>
        (entry.primary === "fr" || entry.primary === "en") && entry.weight > 0,
    )
    .sort((a, b) => b.weight - a.weight || a.position - b.position);
  return ranked[0]?.primary ?? "fr";
}

export function requestLanguage(request: Request, body?: unknown): Language {
  const asked = typeof body === "object" && body !== null && "language" in body && body.language;
  if (asked === "fr" || asked === "en") return asked;
  return fromAcceptLanguage(request.headers.get("accept-language"));
}

export interface ErrorOptions {
  headers?: Record<string, string>;
  extra?: Record<string, unknown>;
}

export function errorResponse(
  code: ErrorCode,
  language: Language,
  { headers, extra }: ErrorOptions = {},
): Response {
  return Response.json(
    { error: { code, message: errorMessage(language, code) }, ...extra },
    { status: STATUS[code], headers: { "Cache-Control": "no-store", ...headers } },
  );
}

export function internalError(error: unknown, language: Language): Response {
  console.error("Unexpected error in an explanation route.", error);
  return errorResponse("internal_error", language);
}
