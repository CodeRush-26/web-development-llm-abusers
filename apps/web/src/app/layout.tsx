import type { Metadata } from "next";
import type { ReactNode } from "react";
import { DM_Sans, JetBrains_Mono } from "next/font/google";
import { Providers } from "@/components/Providers";
import "./globals.css";

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
  weight: ["400", "500", "600", "700"],
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Strait Command — Maritime Crisis Ops",
  description:
    "Real-time Hormuz fleet coordination with tactical routing, weather-aware fuel, AI distress parsing, and synchronized operations.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`dark ${dmSans.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
    >
      <body className="min-h-[100dvh] overflow-x-hidden bg-slate-50 font-sans text-[15px] leading-relaxed text-slate-900 antialiased dark:bg-tactical-bg dark:text-slate-100">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
