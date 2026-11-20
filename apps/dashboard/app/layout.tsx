import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans_Arabic, Inter } from "next/font/google";
import { RootFrame } from "@/components/root-frame";
import { creativeLocale } from "@/lib/creative-locale";
import "./globals.css";
import "./workspace.css";
import "./creative.css";
import "./public.css";

const inter = Inter({ subsets: ["latin"], display: "swap", variable: "--font-inter" });
const arabic = IBM_Plex_Sans_Arabic({
  subsets: ["arabic"],
  weight: ["400", "500", "700"],
  display: "swap",
  variable: "--font-arabic",
});

export const metadata: Metadata = {
  title: { default: "E3lani", template: "%s · E3lani" },
  description: "Human control for coordinated business agents.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#ffffff",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  let locale: "en" | "ar" = "en";
  let dir: "ltr" | "rtl" = "ltr";
  try {
    ({ locale, dir } = await creativeLocale());
  } catch {
    // A missing cookie store must never break rendering; default to English.
  }
  return (
    <html lang={locale} dir={dir}>
      <body className={`${inter.variable} ${arabic.variable}`}>
        <RootFrame initialLocale={locale}>{children}</RootFrame>
      </body>
    </html>
  );
}
