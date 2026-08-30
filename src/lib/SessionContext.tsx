"use client";
import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";
import { fetchSessions, createSessionRecord, confirmSessionPayment, type NewSessionInput } from "@/lib/data/sessions";

export interface PlannedSession {
  id: string;
  clientId: string;
  clientName: string;
  date: string;
  time: string;
  status: "scheduled" | "in_progress" | "completed" | "cancelled" | "pending_payment";
  bookedVia: "psychologist" | "public_link";
}

interface SessionContextType {
  sessions: PlannedSession[];
  loading: boolean;
  error: string | null;
  addSession: (session: Omit<PlannedSession, "id" | "status" | "bookedVia">) => Promise<void>;
  confirmPayment: (sessionId: string) => Promise<void>;
  refresh: () => Promise<void>;
}

const SessionContext = createContext<SessionContextType | undefined>(undefined);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [sessions, setSessions] = useState<PlannedSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const data = await fetchSessions();
      setSessions(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить сессии");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const addSession = useCallback(async (session: Omit<PlannedSession, "id" | "status" | "bookedVia">) => {
    const input: NewSessionInput = {
      clientId: session.clientId,
      clientName: session.clientName,
      date: session.date,
      time: session.time,
    };
    const created = await createSessionRecord(input);
    setSessions(prev => [...prev, created]);
  }, []);

  const confirmPayment = useCallback(async (sessionId: string) => {
    const updated = await confirmSessionPayment(sessionId);
    setSessions(prev => prev.map(s => (s.id === sessionId ? updated : s)));
  }, []);

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
