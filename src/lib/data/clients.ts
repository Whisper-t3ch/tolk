"use client";
import { createClient } from "@/lib/supabase/client";

// ------------------------------------------------------------
// Клиент психолога — реальная запись из Supabase (таблица clients).
// Поля age/gender/joinedDate/needsAttention/hwCompleted/hwTotal были
// добавлены миграцией 002. triggers/lastTest/progress пока остаются
// в mock-data.ts — это отдельная предметная область (тесты/прогресс),
// не входит в Этап 2.
// ------------------------------------------------------------
export interface DbClient {
  id: string;
  name: string;
  initials: string;
  request: string;
  approach: string;
  status: "active" | "pause" | "completed";
  age: number | null;
  gender: "male" | "female" | null;
  joinedDate: string; // ISO date
  needsAttention: boolean;
  hwCompleted: number;
  hwTotal: number;
  createdAt: string;
  updatedAt: string;
  // Не хранятся в Supabase — отдельная предметная область (тесты/прогресс),
  // не мигрирована в Этапе 2. Всегда undefined для реальных клиентов;
  // UI показывает заглушки вместо этих полей.
  triggers?: string[];
  lastTest?: { name: string; score: number; maxScore: number; date: string };
  progress?: {
    aiScore: number;
    psychologistScore: number | null;
    clientScore: number | null;
    history: Array<{ date: string; aiScore: number; psychologistScore?: number; clientScore?: number }>;
  };
}

function computeInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

// Форма строки в таблице clients (snake_case, как в Postgres)
interface ClientRow {
  id: string;
  name: string;
  request: string | null;
  approach: string | null;
  status: "active" | "pause" | "completed";
  age: number | null;
  gender: "male" | "female" | null;
  joined_date: string;
  needs_attention: boolean;
  hw_completed: number;
  hw_total: number;
  created_at: string;
  updated_at: string;
}

function mapRow(row: ClientRow): DbClient {
  return {
    id: row.id,
    name: row.name,
    initials: computeInitials(row.name),
    request: row.request ?? "",
    approach: row.approach ?? "",
    status: row.status,
    age: row.age,
    gender: row.gender,
    joinedDate: row.joined_date,
    needsAttention: row.needs_attention,
    hwCompleted: row.hw_completed,
    hwTotal: row.hw_total,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const CLIENT_COLUMNS =
  "id, name, request, approach, status, age, gender, joined_date, needs_attention, hw_completed, hw_total, created_at, updated_at";

export async function fetchClients(): Promise<DbClient[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("clients")
    .select(CLIENT_COLUMNS)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data as ClientRow[]).map(mapRow);
}

export async function fetchClient(id: string): Promise<DbClient | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("clients")
    .select(CLIENT_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  return data ? mapRow(data as ClientRow) : null;
}

export interface NewClientInput {
  name: string;
  request?: string;
  approach?: string;
  status?: "active" | "pause" | "completed";
  age?: number;
  gender?: "male" | "female";
}

export async function createClientRecord(input: NewClientInput): Promise<DbClient> {
  const supabase = createClient();
  const { data: userData } = await supabase.auth.getUser();
  const psychologistId = userData.user?.id;
  if (!psychologistId) throw new Error("Не авторизован");

  const { data, error } = await supabase
    .from("clients")
    .insert({
      psychologist_id: psychologistId,
      name: input.name,
      request: input.request ?? null,
      approach: input.approach ?? null,
      status: input.status ?? "active",
      age: input.age ?? null,
      gender: input.gender ?? null,
    })
    .select(CLIENT_COLUMNS)
    .single();

  if (error) throw error;
  return mapRow(data as ClientRow);
}

export interface UpdateClientInput {
  name?: string;
  request?: string;
  approach?: string;
  status?: "active" | "pause" | "completed";
  age?: number | null;
  gender?: "male" | "female" | null;
  needsAttention?: boolean;
  hwCompleted?: number;
  hwTotal?: number;
}

export async function updateClientRecord(id: string, input: UpdateClientInput): Promise<DbClient> {
  const supabase = createClient();
  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.request !== undefined) patch.request = input.request;
  if (input.approach !== undefined) patch.approach = input.approach;
  if (input.status !== undefined) patch.status = input.status;
  if (input.age !== undefined) patch.age = input.age;
  if (input.gender !== undefined) patch.gender = input.gender;
  if (input.needsAttention !== undefined) patch.needs_attention = input.needsAttention;
  if (input.hwCompleted !== undefined) patch.hw_completed = input.hwCompleted;
  if (input.hwTotal !== undefined) patch.hw_total = input.hwTotal;

  const { data, error } = await supabase
    .from("clients")
    .update(patch)
    .eq("id", id)
    .select(CLIENT_COLUMNS)
    .single();

  if (error) throw error;
  return mapRow(data as ClientRow);
}

// Мягкое удаление — соответствует soft-delete паттерну схемы (deleted_at)
export async function softDeleteClient(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from("clients")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}
