import type { Metadata } from "next";
import { Fraunces, Geist, JetBrains_Mono } from "next/font/google";
import { headers } from "next/headers";

import { CookieBanner } from "@/components/compliance/cookie-banner";
import { ThemeScript } from "@/components/theme/theme-script";

import "./globals.css";

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const jetBrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "W3 Relatórios",
  description: "Dashboard unificado de marketing analytics para e-commerce.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const nonce = (await headers()).get("x-nonce");

  return (
    <html lang="pt-BR" data-theme="dark" suppressHydrationWarning>
      <head>
        <ThemeScript nonce={nonce} />
      </head>
      <body className={`${fraunces.variable} ${geist.variable} ${jetBrainsMono.variable}`}>
        {children}
        <CookieBanner />
      </body>
    </html>
  );
}
