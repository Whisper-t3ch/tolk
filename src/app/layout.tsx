import type { Metadata } from "next";
import "./globals.css";
import { SessionProvider } from "@/lib/SessionContext";
import { ClientsProvider } from "@/lib/ClientsContext";
import { PersonalEventsProvider } from "@/lib/PersonalEventsContext";
import { ProfileProvider } from "@/lib/ProfileContext";

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
    <html lang="ru">
      <body>
        <ProfileProvider>
          <ClientsProvider>
            <SessionProvider>
              <PersonalEventsProvider>{children}</PersonalEventsProvider>
            </SessionProvider>
          </ClientsProvider>
        </ProfileProvider>
      </body>
    </html>
  );
}
