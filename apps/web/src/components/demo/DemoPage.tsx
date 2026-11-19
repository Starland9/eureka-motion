import { useTranslations } from "next-intl";
import { ExplanationHeader } from "@/components/explanation/ExplanationHeader";
import { buttonVariants } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

const VIDEO_SRC = "/demo/eureka-motion-demo.mp4";
const POSTER_SRC = "/demo/eureka-motion-demo.jpg";

const DOWNLOAD_LINK = "text-ink underline decoration-1 underline-offset-3 hover:decoration-2";

export function DemoPage() {
  const t = useTranslations("Demo");

  return (
    <div className="flex min-h-dvh flex-col">
      <ExplanationHeader />
      <main id="content" className="page-width flex-1 pt-8 pb-16 lg:pt-12">
        <div className="grid gap-x-6 lg:grid-cols-12">
          <div className="flex min-w-0 flex-col gap-6 lg:col-span-10">
            <h1 className="text-title text-balance break-words sm:text-display-m">{t("title")}</h1>
            <p className="text-lead max-w-prose text-pretty">{t("intro")}</p>
            <figure className="flex flex-col gap-3">
              <video
                controls
                preload="metadata"
                playsInline
                poster={POSTER_SRC}
                aria-label={t("videoLabel")}
                className="block aspect-video w-full border-2 border-ink bg-surface-raised object-contain"
              >
                <source src={VIDEO_SRC} type="video/mp4" />
                {t.rich("fallback", {
                  download: (chunks) => (
                    <a href={VIDEO_SRC} download className={DOWNLOAD_LINK}>
                      {chunks}
                    </a>
                  ),
                })}
              </video>
              <figcaption className="text-caption text-ink-soft">{t("caption")}</figcaption>
            </figure>
            <Link href="/" className={cn(buttonVariants({ variant: "link" }), "self-start")}>
              {t("back")}
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
