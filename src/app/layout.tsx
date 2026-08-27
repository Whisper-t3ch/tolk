import type { Metadata } from "next";
import { Manrope, Inter } from "next/font/google";
import "./globals.css";
import { SessionProvider } from "@/lib/SessionContext";
import { ClientsProvider } from "@/lib/ClientsContext";
import { PersonalEventsProvider } from "@/lib/PersonalEventsContext";

const manrope = Manrope({
  subsets: ["latin", "cyrillic"],
  variable: "--font-heading",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin", "cyrillic"],
  variable: "--font-body",
  display: "swap",
});

export const metadata: Metadata = {
  title: "ТОЛК — Ассистент психолога",
  description: "Платформа автоматизации практики психолога",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru" className={`${manrope.variable} ${inter.variable}`}>
      <body>
        <ClientsProvider>
          <SessionProvider>
            <PersonalEventsProvider>{children}</PersonalEventsProvider>
          </SessionProvider>
        </ClientsProvider>
      </body>
    </html>
  );
}
