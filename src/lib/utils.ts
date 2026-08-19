import { clsx, type ClassValue } from "clsx";

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

// Цвет по баллу теста
export function getScoreColor(score: number, maxScore: number): string {
  const pct = (score / maxScore) * 100;
  if (pct >= 60) return "var(--brand-red)";
  if (pct >= 35) return "var(--brand-yellow)";
  return "var(--brand-green)";
}

export function getScoreBg(score: number, maxScore: number): string {
  const pct = (score / maxScore) * 100;
  if (pct >= 60) return "var(--brand-red-soft)";
  if (pct >= 35) return "var(--brand-yellow-soft)";
  return "var(--brand-green-soft)";
}

// Инициалы из имени
export function getInitials(name: string): string {
  return name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);
}
