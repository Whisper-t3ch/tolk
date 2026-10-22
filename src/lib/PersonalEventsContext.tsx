"use client";
import React, { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";

// ------------------------------------------------------------
// Личные дела в календаре (не сессии с клиентами) — «Зал», «Обед», «Врач».
// Хранятся в таблице personal_events (миграция 051), поэтому их видит и создаёт
// ассистент. Если таблицы ещё нет или запрос не удался, работаем как раньше —
// через localStorage браузера (ключ привязан к id психолога), чтобы календарь
// не ломался. События из localStorage один раз переносятся в базу.
// ------------------------------------------------------------
export interface PersonalEvent {
  id: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  title: string;
  /** Длительность в минутах (по умолчанию 60). */
  durationMinutes?: number;
}

interface PersonalEventsContextType {
  events: PersonalEvent[];
  addEvent: (event: Omit<PersonalEvent, "id">) => void;
  removeEvent: (id: string) => void;
  updateEventTime: (id: string, time: string) => void;
}

const STORAGE_PREFIX = "tolk_personal_events_v5";
const LEGACY_KEYS = ["tolk_personal_events_v4", "tolk_personal_events_seeded_v4"];

function storageKeyFor(psychologistId: string | null): string {
  return psychologistId ? `${STORAGE_PREFIX}:${psychologistId}` : STORAGE_PREFIX;
}

const PersonalEventsContext = createContext<PersonalEventsContextType | undefined>(undefined);

function newId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  } catch {
    // ниже запасной вариант
  }
  const hex = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, "0");
  return `${hex()}${hex()}-${hex()}-4${hex().slice(1)}-a${hex().slice(1)}-${hex()}${hex()}${hex()}`;
}

function loadFromStorage(psychologistId: string | null): PersonalEvent[] {
  if (typeof window === "undefined") return [];
  try {
    for (const legacy of LEGACY_KEYS) window.localStorage.removeItem(legacy);
    const raw = window.localStorage.getItem(storageKeyFor(psychologistId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(e => e && typeof e.date === "string" && typeof e.time === "string" && typeof e.title === "string") : [];
  } catch {
    return [];
  }
}

interface Row {
  id: string;
  event_date: string;
  start_time: string;
  duration_minutes?: number | null;
  title: string;
}

const fromRow = (r: Row): PersonalEvent => ({
  id: r.id, date: r.event_date, time: String(r.start_time).slice(0, 5), title: r.title,
  durationMinutes: r.duration_minutes ?? 60,
});

export function PersonalEventsProvider({ children }: { children: ReactNode }) {
  const [events, setEvents] = useState<PersonalEvent[]>([]);
  const [psychologistId, setPsychologistId] = useState<string | null>(null);
  // db — работаем с таблицей; local — таблицы нет, храним в localStorage.
  const [mode, setMode] = useState<"loading" | "db" | "local">("loading");
  const modeRef = useRef(mode);
  modeRef.current = mode;

  const loadFromDb = useCallback(async (uid: string): Promise<PersonalEvent[] | null> => {
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("personal_events")
        .select("id, event_date, start_time, duration_minutes, title")
        .eq("psychologist_id", uid)
        .order("event_date", { ascending: true })
        .limit(5000);
      if (error || !data) return null;
      return (data as Row[]).map(fromRow);
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let uid: string | null = null;
      try {
        const supabase = createClient();
        const { data } = await supabase.auth.getUser();
        uid = data.user?.id ?? null;
      } catch {
        uid = null;
      }
      if (cancelled) return;
      setPsychologistId(uid);
      if (!uid) {
        setEvents(loadFromStorage(null));
        setMode("local");
        return;
      }
      let loaded = await loadFromDb(uid);
      if (cancelled) return;
      if (loaded === null) {
        setEvents(loadFromStorage(uid));
        setMode("local");
        return;
      }
      // Однократный перенос событий из localStorage в базу.
      const legacy = loadFromStorage(uid);
      if (legacy.length > 0) {
        const have = new Set(loaded.map(e => `${e.date}|${e.time}|${e.title.toLowerCase()}`));
        const rows = legacy
          .filter(e => /^\d{4}-\d{2}-\d{2}$/.test(e.date) && /^([01]\d|2[0-3]):[0-5]\d$/.test(e.time) && e.title.trim() && !have.has(`${e.date}|${e.time}|${e.title.toLowerCase()}`))
          .map(e => ({ id: newId(), psychologist_id: uid, event_date: e.date, start_time: e.time, title: e.title.trim().slice(0, 200) }));
        try {
          const supabase = createClient();
          let ok = true;
          for (let i = 0; i < rows.length && ok; i += 200) {
            const { error } = await supabase.from("personal_events").insert(rows.slice(i, i + 200));
            if (error) ok = false;
          }
          if (ok) {
            window.localStorage.removeItem(storageKeyFor(uid));
            const again = await loadFromDb(uid);
            if (again) loaded = again;
          }
        } catch {
          // перенесём при следующем заходе
        }
      }
      if (cancelled) return;
      setEvents(loaded);
      setMode("db");
    })();
    return () => { cancelled = true; };
  }, [loadFromDb]);

  // Ассистент создал событие — перечитываем из базы.
  useEffect(() => {
    const onChanged = () => {
      if (modeRef.current !== "db" || !psychologistId) return;
      loadFromDb(psychologistId).then(list => { if (list) setEvents(list); });
    };
    window.addEventListener("tolk:data-changed", onChanged);
    return () => window.removeEventListener("tolk:data-changed", onChanged);
  }, [psychologistId, loadFromDb]);

  // Запасной режим: сохраняем в localStorage.
  useEffect(() => {
    if (mode !== "local") return;
    try {
      window.localStorage.setItem(storageKeyFor(psychologistId), JSON.stringify(events));
    } catch {
      // localStorage может быть недоступен (приватный режим и т.п.) — не критично.
    }
  }, [events, mode, psychologistId]);

  const addEvent = useCallback((event: Omit<PersonalEvent, "id">) => {
    const id = newId();
    setEvents(prev => [...prev, { ...event, id }]);
    if (modeRef.current === "db" && psychologistId) {
      createClient()
        .from("personal_events")
        .insert({ id, psychologist_id: psychologistId, event_date: event.date, start_time: event.time, duration_minutes: event.durationMinutes ?? 60, title: event.title.trim().slice(0, 200) })
        .then(({ error }) => { if (error) setEvents(prev => prev.filter(e => e.id !== id)); });
    }
  }, [psychologistId]);

  const removeEvent = useCallback((id: string) => {
    let removed: PersonalEvent | undefined;
    setEvents(prev => { removed = prev.find(e => e.id === id); return prev.filter(e => e.id !== id); });
    if (modeRef.current === "db") {
      createClient()
        .from("personal_events")
        .delete()
        .eq("id", id)
        .then(({ error }) => { if (error && removed) setEvents(prev => [...prev, removed as PersonalEvent]); });
    }
  }, []);

  const updateEventTime = useCallback((id: string, time: string) => {
    let previous: string | undefined;
    setEvents(prev => prev.map(e => { if (e.id === id) previous = e.time; return e.id === id ? { ...e, time } : e; }));
    if (modeRef.current === "db" && /^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
      createClient()
        .from("personal_events")
        .update({ start_time: time })
        .eq("id", id)
        .then(({ error }) => { if (error && previous) setEvents(prev => prev.map(e => (e.id === id ? { ...e, time: previous as string } : e))); });
    }
  }, []);

  return (
    <PersonalEventsContext.Provider value={{ events, addEvent, removeEvent, updateEventTime }}>
      {children}
    </PersonalEventsContext.Provider>
  );
}

export function usePersonalEvents() {
  const context = useContext(PersonalEventsContext);
  if (context === undefined) {
    throw new Error("usePersonalEvents must be used within PersonalEventsProvider");
  }
  return context;
}
