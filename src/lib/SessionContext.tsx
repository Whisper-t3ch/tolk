"use client";
import React, { createContext, useContext, useState, ReactNode } from "react";

export interface PlannedSession {
  id: string;
  clientId: string;
  clientName: string;
  date: string;
  time: string;
}

interface SessionContextType {
  sessions: PlannedSession[];
  addSession: (session: Omit<PlannedSession, "id">) => void;
}

const SessionContext = createContext<SessionContextType | undefined>(undefined);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [sessions, setSessions] = useState<PlannedSession[]>([
    { id: "1", clientId: "1", clientName: "Анна Иванова", date: "2026-08-12", time: "18:00" },
    { id: "2", clientId: "2", clientName: "Дмитрий Орлов", date: "2026-08-13", time: "10:00" },
    { id: "3", clientId: "3", clientName: "Светлана Морозова", date: "2026-08-13", time: "14:00" },
    { id: "4", clientId: "3", clientName: "Светлана Морозова", date: "2026-08-15", time: "15:00" },
    { id: "5", clientId: "1", clientName: "Анна Иванова", date: "2026-08-18", time: "11:00" },
    { id: "6", clientId: "2", clientName: "Дмитрий Орлов", date: "2026-08-22", time: "16:00" },
  ]);

  const addSession = (session: Omit<PlannedSession, "id">) => {
    setSessions(prev => [...prev, { ...session, id: Math.random().toString() }]);
  };

  return (
    <SessionContext.Provider value={{ sessions, addSession }}>
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
