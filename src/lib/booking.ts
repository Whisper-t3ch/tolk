// ------------------------------------------------------------
// Общая логика генерации слотов для публичной страницы бронирования.
// Используется и в GET /api/public/booking/[slug]/slots (показ
// доступных слотов), и в POST /api/public/booking/[slug]/create
// (повторная проверка "слот всё ещё свободен" перед созданием сессии —
// защита от race condition, см. комментарий в create/route.ts).
// ------------------------------------------------------------

export interface WorkingHours {
  mon?: [string, string] | null;
  tue?: [string, string] | null;
  wed?: [string, string] | null;
  thu?: [string, string] | null;
  fri?: [string, string] | null;
  sat?: [string, string] | null;
  sun?: [string, string] | null;
}

const DAY_INDEX_TO_KEY: Record<number, keyof WorkingHours> = {
  0: "sun",
  1: "mon",
  2: "tue",
  3: "wed",
  4: "thu",
  5: "fri",
  6: "sat",
};

export interface BookingSlot {
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  durationMinutes: number;
}

export interface ExistingSessionWindow {
  /** Начало занятого окна, ISO datetime. */
  start: string;
  /** Конец занятого окна, ISO datetime. */
  end: string;
}

function parseTimeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60)
    .toString()
    .padStart(2, "0");
  const m = (minutes % 60).toString().padStart(2, "0");
  return `${h}:${m}`;
}

/**
 * Генерирует список доступных слотов на диапазон дат [fromDate, toDate]
 * (включительно, формат YYYY-MM-DD), исключая занятые окна и слоты
 * раньше minNoticeHours от текущего момента (now).
 */
export function generateAvailableSlots(params: {
  fromDate: string;
  toDate: string;
  workingHours: WorkingHours;
  sessionDurationMinutes: number;
  bufferMinutes: number;
  minNoticeHours: number;
  occupied: ExistingSessionWindow[];
  now?: Date;
}): BookingSlot[] {
  const {
    fromDate,
    toDate,
    workingHours,
    sessionDurationMinutes,
    bufferMinutes,
    minNoticeHours,
    occupied,
    now = new Date(),
  } = params;

  const step = sessionDurationMinutes + bufferMinutes;
  const minStart = new Date(now.getTime() + minNoticeHours * 60 * 60 * 1000);

  const slots: BookingSlot[] = [];
  const cursor = new Date(fromDate + "T00:00:00Z");
  const end = new Date(toDate + "T00:00:00Z");

  while (cursor.getTime() <= end.getTime()) {
    const dateStr = cursor.toISOString().slice(0, 10);
    const dayKey = DAY_INDEX_TO_KEY[cursor.getUTCDay()];
    const window = workingHours[dayKey];

    if (window) {
      const [startTime, endTime] = window;
      const startMin = parseTimeToMinutes(startTime);
      const endMin = parseTimeToMinutes(endTime);

      for (let slotStart = startMin; slotStart + sessionDurationMinutes <= endMin; slotStart += step) {
        const slotStartDate = new Date(`${dateStr}T${minutesToTime(slotStart)}:00Z`);
        const slotEndDate = new Date(slotStartDate.getTime() + sessionDurationMinutes * 60 * 1000);

        if (slotStartDate.getTime() < minStart.getTime()) continue;

        const overlaps = occupied.some(w => {
          const wStart = new Date(w.start).getTime();
          const wEnd = new Date(w.end).getTime();
          return slotStartDate.getTime() < wEnd && slotEndDate.getTime() > wStart;
        });
        if (overlaps) continue;

        slots.push({ date: dateStr, time: minutesToTime(slotStart), durationMinutes: sessionDurationMinutes });
      }
    }

    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return slots;
}

/** Проверяет, свободен ли конкретный слот (date+time) — используется при создании брони. */
export function isSlotAvailable(params: {
  date: string;
  time: string;
  workingHours: WorkingHours;
  sessionDurationMinutes: number;
  bufferMinutes: number;
  minNoticeHours: number;
  maxAdvanceDays: number;
  occupied: ExistingSessionWindow[];
  now?: Date;
}): boolean {
  const { date, time, ...rest } = params;
  const now = params.now ?? new Date();
  const maxDate = new Date(now.getTime() + params.maxAdvanceDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  if (date > maxDate) return false;

  const slots = generateAvailableSlots({
    fromDate: date,
    toDate: date,
    workingHours: rest.workingHours,
    sessionDurationMinutes: rest.sessionDurationMinutes,
    bufferMinutes: rest.bufferMinutes,
    minNoticeHours: rest.minNoticeHours,
    occupied: rest.occupied,
    now,
  });
  return slots.some(s => s.date === date && s.time === time);
}
