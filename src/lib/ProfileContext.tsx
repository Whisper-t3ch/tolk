"use client";
import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";

// Общий контекст с профилем текущего психолога (имя, специальность,
// тариф, статус интеграций) — раньше Sidebar/Header/settings/profile/help
// импортировали захардкоженный mock currentPsychologist ("Мария Соколова")
// напрямую из lib/mock-data.ts, поэтому каждый залогиненный психолог видел
// чужие данные. Теперь один источник правды (GET /api/profile), общий для
// всего layout — как ClientsContext/SessionContext.
export interface Profile {
  name: string;
  email: string | null;
  specialty: string;
  avatarInitials: string;
  memberSince: string;
  handle: string;
  roomUrl: string;
  plan: {
    name: string;
    assistantRequests: { used: number; total: number };
  };
  telegram: { connected: boolean; username: string | null };
  vk: { connected: boolean };
  allPlans: Record<string, number>;
}

interface ProfileContextType {
  profile: Profile | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  updateProfile: (patch: { name?: string; specialty?: string }) => Promise<void>;
}

const ProfileContext = createContext<ProfileContextType | undefined>(undefined);

export function ProfileProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch("/api/profile");
      if (!res.ok) throw new Error("Не удалось загрузить профиль");
      const data = await res.json();
      setProfile(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить профиль");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const updateProfile = useCallback(async (patch: { name?: string; specialty?: string }) => {
    const res = await fetch("/api/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error ?? "Не удалось сохранить профиль");
    }
    await refresh();
  }, [refresh]);

  return (
    <ProfileContext.Provider value={{ profile, loading, error, refresh, updateProfile }}>
      {children}
    </ProfileContext.Provider>
  );
}

export function useProfile() {
  const context = useContext(ProfileContext);
  if (context === undefined) {
    throw new Error("useProfile must be used within ProfileProvider");
  }
  return context;
}
