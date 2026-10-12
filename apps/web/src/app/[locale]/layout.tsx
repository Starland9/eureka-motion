import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getTranslations } from "next-intl/server";
import { fontFaceCss, PRELOAD_FONT_FILES } from "scene";
import { Toaster } from "@/components/ui/sonner";
import { localeFromParams } from "@/i18n/params";
import { routing } from "@/i18n/routing";
import { themeInitScript } from "@/lib/theme";
import "katex/dist/katex.min.css";
import "../globals.css";

const FONT_BASE_URL = "/fonts";

type Props = { children: React.ReactNode; params: Promise<{ locale: string }> };

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: Pick<Props, "params">): Promise<Metadata> {
  const locale = await localeFromParams(params);
  const t = await getTranslations({ locale, namespace: "Common" });
  return { title: t("productName") };
}

export default async function LocaleLayout({ children, params }: Props) {
  const locale = await localeFromParams(params);
  const t = await getTranslations({ locale, namespace: "Common" });

  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <style dangerouslySetInnerHTML={{ __html: fontFaceCss(FONT_BASE_URL) }} />
        {PRELOAD_FONT_FILES.map((file) => (
          <link
            key={file}
            rel="preload"
            href={`${FONT_BASE_URL}/${file}`}
            as="font"
            type="font/woff2"
            crossOrigin="anonymous"
          />
        ))}
      </head>
      <body>
        <a className="skip-link" href="#content">
          {t("skipToContent")}
        </a>
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
        <Toaster containerAriaLabel={t("notifications")} />
      </body>
    </html>
  );
}
