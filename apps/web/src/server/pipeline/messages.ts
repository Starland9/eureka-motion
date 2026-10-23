import type { Language } from "scene";

interface Messages {
  validated: string;
  corrected: string;
  dropped: string;
  planDropped: string;
  unavailable: string;
  failed: string;
  versionFailed: string;
}

const MESSAGES: Readonly<Record<Language, Messages>> = {
  fr: {
    validated: "Validée dès la première écriture.",
    corrected: "Corrigée après une relecture automatique.",
    dropped: "Écartée : elle n'a pas pu être validée.",
    planDropped: "Le plan n'a pas pu être vérifié.",
    unavailable:
      "La génération est momentanément indisponible. Essaie un des exemples en attendant.",
    failed:
      "Cette explication n'a pas pu être préparée correctement. Reformule ta question ou essaie un exemple voisin.",
    versionFailed:
      "Cette nouvelle version n'a pas pu être préparée correctement. Réessaie, ou choisis une autre façon de réexpliquer.",
  },
  en: {
    validated: "Validated as first written.",
    corrected: "Corrected after an automatic review.",
    dropped: "Dropped: it could not be validated.",
    planDropped: "The plan could not be verified.",
    unavailable: "Generation is unavailable for the moment. Try one of the examples meanwhile.",
    failed:
      "This explanation could not be prepared properly. Rephrase your question or try a related example.",
    versionFailed:
      "This new version could not be prepared properly. Try again, or choose another way to explain it again.",
  },
};

export function pipelineMessage(language: Language, key: keyof Messages): string {
  return MESSAGES[language][key];
}
