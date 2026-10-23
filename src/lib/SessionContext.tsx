"use client";
import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";
import { fetchSessions, createSessionRecord, confirmSessionPayment, rescheduleSessionRecord, deleteSessionRecord, type NewSessionInput } from "@/lib/data/sessions";
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
  rescheduleSession: (sessionId: string, date: string, time: string) => Promise<void>;
  removeSession: (sessionId: string) => Promise<void>;
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

  // Ассистент создал/перенёс/отменил сессию — календарь обновляется без перезагрузки страницы.
  useEffect(() => {
    const onChanged = () => { refresh(); };
    window.addEventListener("tolk:data-changed", onChanged);
    return () => window.removeEventListener("tolk:data-changed", onChanged);
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

  const rescheduleSession = useCallback(async (sessionId: string, date: string, time: string) => {
    const updated = await rescheduleSessionRecord(sessionId, date, time, timeZone);
    setSessions(prev => prev.map(s => (s.id === sessionId ? updated : s)));
  }, [timeZone]);

  const removeSession = useCallback(async (sessionId: string) => {
    await deleteSessionRecord(sessionId);
    setSessions(prev => prev.filter(s => s.id !== sessionId));
  }, []);

  return (
    <SessionContext.Provider value={{ sessions, loading, error, addSession, confirmPayment, rescheduleSession, removeSession, refresh }}>
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
