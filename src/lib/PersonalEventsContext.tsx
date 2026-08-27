"use client";
import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";

// ------------------------------------------------------------
// Личные дела в календаре (не сессии с клиентами) — например "Зал",
// "Обед", "Врач". Пока не хранятся в Supabase (это отдельная предметная
// область, ещё не спроектирована как таблица — см. lib/data/sessions.ts
// для сравнения с тем, как устроены реальные сессии). Чтобы психолог
// не терял добавленные события при перезагрузке страницы, состояние
// сохраняется в localStorage браузера — этого достаточно для демо и
// личного использования одним пользователем с одного устройства.
// ------------------------------------------------------------
export interface PersonalEvent {
  id: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  title: string;
}

interface PersonalEventsContextType {
  events: PersonalEvent[];
  addEvent: (event: Omit<PersonalEvent, "id">) => void;
  removeEvent: (id: string) => void;
  updateEventTime: (id: string, time: string) => void;
}

const STORAGE_KEY = "tolk_personal_events_v2";
const SEEDED_FLAG_KEY = "tolk_personal_events_seeded_v2";

const PersonalEventsContext = createContext<PersonalEventsContextType | undefined>(undefined);

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Плотное демо-расписание для показа на созвоне — генерируется один раз
// при первом заходе (если в localStorage ещё ничего нет), дальше психолог
// может добавлять/удалять/двигать события сам и они не будут перезатираться.
const DAILY_TEMPLATES: Array<Array<{ time: string; title: string }>> = [
  [
    { time: "07:00", title: "Йога" },
    { time: "08:00", title: "Завтрак" },
    { time: "13:00", title: "Обед" },
    { time: "18:30", title: "Прогулка в парке" },
  ],
  [
    { time: "07:30", title: "Зал" },
    { time: "08:30", title: "Завтрак" },
    { time: "13:00", title: "Обед" },
    { time: "19:00", title: "Ужин с семьёй" },
  ],
  [
    { time: "07:00", title: "Медитация" },
    { time: "08:00", title: "Завтрак" },
    { time: "12:30", title: "Обед" },
    { time: "17:00", title: "Супервизия" },
  ],
  [
    { time: "07:30", title: "Пробежка" },
    { time: "08:30", title: "Завтрак" },
    { time: "13:00", title: "Обед" },
    { time: "18:00", title: "Прогулка с ребёнком" },
  ],
  [
    { time: "07:00", title: "Йога" },
    { time: "08:00", title: "Завтрак" },
    { time: "13:00", title: "Обед" },
    { time: "20:00", title: "Кино с женой" },
  ],
  [
    { time: "09:00", title: "Врач" },
    { time: "10:00", title: "Завтрак поздний" },
    { time: "14:00", title: "Обед" },
  ],
  [
    { time: "10:00", title: "Завтрак" },
    { time: "12:00", title: "Время с семьёй" },
    { time: "19:00", title: "Настольные игры" },
  ],
];
const SKIP_OFFSETS = new Set<number>([5, 12, 19, 26]);

function buildSeedEvents(): PersonalEvent[] {
  const today = new Date();
  const events: PersonalEvent[] = [];
  for (let offset = -3; offset <= 35; offset++) {
    if (SKIP_OFFSETS.has(((offset % 7) + 7) % 7)) continue;
    const template = DAILY_TEMPLATES[((offset % DAILY_TEMPLATES.length) + DAILY_TEMPLATES.length) % DAILY_TEMPLATES.length];
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset);
    template.forEach((evt, i) => {
      events.push({ id: `seed-${offset}-${i}`, date: toDateStr(d), time: evt.time, title: evt.title });
    });
  }
  return events;
}

function loadFromStorage(): PersonalEvent[] {
  if (typeof window === "undefined") return [];
  try {
    const alreadySeeded = window.localStorage.getItem(SEEDED_FLAG_KEY);
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw && !alreadySeeded) {
      const seeded = buildSeedEvents();
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded));
      window.localStorage.setItem(SEEDED_FLAG_KEY, "1");
      return seeded;
    }
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function PersonalEventsProvider({ children }: { children: ReactNode }) {
  const [events, setEvents] = useState<PersonalEvent[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setEvents(loadFromStorage());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return; // не перезаписываем storage пустым массивом до первой загрузки
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
    } catch {
      // localStorage может быть недоступен (приватный режим и т.п.) — не критично.
    }
  }, [events, hydrated]);

  const addEvent = useCallback((event: Omit<PersonalEvent, "id">) => {
    setEvents(prev => [...prev, { ...event, id: `pe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` }]);
  }, []);

  const removeEvent = useCallback((id: string) => {
    setEvents(prev => prev.filter(e => e.id !== id));
  }, []);

  const updateEventTime = useCallback((id: string, time: string) => {
    setEvents(prev => prev.map(e => (e.id === id ? { ...e, time } : e)));
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
