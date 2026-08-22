"use client";
import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";
import { fetchClients, type DbClient } from "@/lib/data/clients";

// Общий контекст со списком клиентов психолога, разделяемый между всеми
// компонентами (Sidebar, /clients, /clients/[id], /sessions, /dashboard,
// Header). Раньше это был независимый hook (useClients) — каждый вызов
// делал свой изолированный fetch, поэтому созданный на /clients клиент
// не был виден в Sidebar до перезагрузки страницы. Теперь один источник
// правды на весь layout: refresh() в одном месте обновляет всех.
interface ClientsContextType {
  clients: DbClient[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const ClientsContext = createContext<ClientsContextType | undefined>(undefined);

export function ClientsProvider({ children }: { children: ReactNode }) {
  const [clients, setClients] = useState<DbClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const data = await fetchClients();
      setClients(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить клиентов");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <ClientsContext.Provider value={{ clients, loading, error, refresh }}>
      {children}
    </ClientsContext.Provider>
  );
}

export function useClients() {
  const context = useContext(ClientsContext);
  if (context === undefined) {
    throw new Error("useClients must be used within ClientsProvider");
  }
  return context;
}
