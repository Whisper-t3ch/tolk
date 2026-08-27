// ------------------------------------------------------------
// Общая логика поиска свободного времени в календаре (используется
// на /calendar и в мини-календаре дашборда). Правило: в одном дне не
// может быть двух событий (сессия или личное дело) на одно и то же
// время — если слот занят, ищем ближайший свободный, сдвигаясь на
// STEP_MINUTES вперёд, пока не найдём пустое время в пределах суток.
// ------------------------------------------------------------
export const SLOT_STEP_MINUTES = 15;

function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function minutesToTime(total: number): string {
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Возвращает ближайшее свободное время начиная с desiredTime (включительно),
 * сдвигаясь вперёд с шагом SLOT_STEP_MINUTES, пропуская занятые times.
 * excludeId — id события, которое само двигаем (не должно конфликтовать само с собой).
 */
export function findNearestFreeSlot(
  desiredTime: string,
  occupied: Array<{ time: string; id?: string }>,
  excludeId?: string
): string {
  const occupiedTimes = new Set(
    occupied.filter(o => o.id === undefined || o.id !== excludeId).map(o => o.time)
  );

  if (!occupiedTimes.has(desiredTime)) return desiredTime;

  let candidate = timeToMinutes(desiredTime) + SLOT_STEP_MINUTES;
  const maxMinutes = 23 * 60 + 45; // не уезжаем за пределы суток
  while (candidate <= maxMinutes) {
    const candidateStr = minutesToTime(candidate);
    if (!occupiedTimes.has(candidateStr)) return candidateStr;
    candidate += SLOT_STEP_MINUTES;
  }
  // Сутки заняты целиком (гипотетически) — возвращаем исходное время как fallback.
  return desiredTime;
}
