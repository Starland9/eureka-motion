import type { ReactNode } from "react";
import { useTranslations } from "next-intl";

const MODEL_URL = "https://huggingface.co/kyutai/pocket-tts-without-voice-cloning";
const LICENCE_URL = "https://creativecommons.org/licenses/by/4.0/";
const VOICES_URL = "https://huggingface.co/kyutai/tts-voices";

const LINK_CLASS = "text-ink underline decoration-1 underline-offset-3 hover:decoration-2";

function external(href: string) {
  return function ExternalLink(chunks: ReactNode) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={LINK_CLASS}>
        {chunks}
      </a>
    );
  };
}

const model = external(MODEL_URL);
const licence = external(LICENCE_URL);
const voices = external(VOICES_URL);

export function VoiceCredit({ configured }: { configured: boolean }) {
  const t = useTranslations("Ask");
  if (!configured) return null;

  return (
    <div className="mt-4 grid gap-x-6 gap-y-2 lg:grid-cols-12">
      <p className="text-caption text-ink-faint lg:col-span-2">{t("voiceCreditLabel")}</p>
      <p className="text-body max-w-prose text-ink-soft italic lg:col-span-10">
        {t.rich("voiceCredit", { model, licence, voices })}
      </p>
    </div>
  );
}
