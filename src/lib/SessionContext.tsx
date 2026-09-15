"use client";
import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";
import { fetchSessions, createSessionRecord, confirmSessionPayment, type NewSessionInput } from "@/lib/data/sessions";
import { useProfile } from "@/lib/ProfileContext";
import { DEFAULT_TIMEZONE } from "@/lib/timezone";

export interface PlannedSession {
  id: string;
  clientId: string;
  clientName: string;
  date: string;
  time: string;
  status: "scheduled" | "in_progress" | "completed" | "cancelled" | "pending_payment";
  bookedVia: "psychologist" | "public_link";
  /** Пустая строка, если NEXT_PUBLIC_JITSI_DOMAIN ещё не настроен (ВМ не подключена). */
  videoRoomUrl: string;
}

interface SessionContextType {
  sessions: PlannedSession[];
  loading: boolean;
  error: string | null;
  addSession: (session: Omit<PlannedSession, "id" | "status" | "bookedVia" | "videoRoomUrl">) => Promise<PlannedSession>;
  confirmPayment: (sessionId: string) => Promise<void>;
  refresh: () => Promise<void>;
}

const SessionContext = createContext<SessionContextType | undefined>(undefined);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [sessions, setSessions] = useState<PlannedSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Пояс психолога — из общего ProfileContext (в дереве layout.tsx он
  // монтируется снаружи SessionProvider). Пока профиль ещё не загрузился,
  // используем DEFAULT_TIMEZONE только как временное значение для первого
  // рендера — как только профиль придёт, эффект ниже перечитает сессии
  // с настоящим поясом психолога.
  const { profile } = useProfile();
  const timeZone = profile?.timezone ?? DEFAULT_TIMEZONE;

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const data = await fetchSessions(timeZone);
      setSessions(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить сессии");
    } finally {
      setLoading(false);
    }
  }, [timeZone]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const addSession = useCallback(async (session: Omit<PlannedSession, "id" | "status" | "bookedVia" | "videoRoomUrl">) => {
    const input: NewSessionInput = {
      clientId: session.clientId,
      clientName: session.clientName,
      date: session.date,
      time: session.time,
    };
    const created = await createSessionRecord(input, timeZone);
    setSessions(prev => [...prev, created]);
    return created;
  }, [timeZone]);

  const confirmPayment = useCallback(async (sessionId: string) => {
    const updated = await confirmSessionPayment(sessionId, timeZone);
    setSessions(prev => prev.map(s => (s.id === sessionId ? updated : s)));
  }, [timeZone]);

  return (
    <SessionContext.Provider value={{ sessions, loading, error, addSession, confirmPayment, refresh }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  const context = useContext(SessionContext);
  if (context === undefined) {
    throw new Error("useSession must be used within SessionProvider");
  }
  return context;
}
