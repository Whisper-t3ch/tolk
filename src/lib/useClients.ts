"use client";
import { useState, useEffect, useCallback } from "react";
import { fetchClients, type DbClient } from "@/lib/data/clients";

// Общий hook для получения списка клиентов психолога из Supabase.
// Используется во всех местах, которые раньше импортировали
// `clients` напрямую из mock-data.ts (Sidebar, /clients, /clients/[id],
// /sessions, /dashboard).
export function useClients() {
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

  return { clients, loading, error, refresh };
}
