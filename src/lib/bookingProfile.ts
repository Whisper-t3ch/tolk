// ------------------------------------------------------------
// Профиль специалиста, услуги и отзывы для публичной страницы записи.
// Типы и проверка входных данных общие для API настроек и страницы.
// Всё хранится как jsonb в booking_settings; текст — только plain text
// (React экранирует), ссылки — только https.
// ------------------------------------------------------------

export const ACCENTS = {
  green: { label: "Зелёный", color: "#2D6A5C", soft: "#E8F2EF" },
  blue: { label: "Синий", color: "#2F5FA7", soft: "#E8EFF9" },
  violet: { label: "Фиолетовый", color: "#6B4FA3", soft: "#F0EBF8" },
  rose: { label: "Розовый", color: "#A8456B", soft: "#F8EBF0" },
  amber: { label: "Янтарный", color: "#9A6412", soft: "#FAF1E1" },
  graphite: { label: "Графит", color: "#3F4651", soft: "#EDEEF0" },
} as const;
export type AccentKey = keyof typeof ACCENTS;

export interface BookingProfile {
  headline: string;
  tags: string[];
  about: string;
  links: { telegram?: string; vk?: string; website?: string };
  qualifications: string[];
  accent: AccentKey;
  /** data:image/jpeg;base64,... (сжато на клиенте до ~480px). */
  photo?: string;
}

export type ServiceFormat = "online" | "offline" | "both";

export interface BookingService {
  id: string;
  title: string;
  description: string;
  format: ServiceFormat;
  duration_minutes: number;
  /** Цена в рублях; null — «по договорённости». */
  price: number | null;
}

export interface BookingReview {
  id: string;
  author: string;
  text: string;
}

export const EMPTY_PROFILE: BookingProfile = {
  headline: "",
  tags: [],
  about: "",
  links: {},
  qualifications: [],
  accent: "green",
};

export const MAX_PHOTO_CHARS = 220_000;

type Result<T> = { value: T; error?: undefined } | { value?: undefined; error: string };

function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.replace(/\u0000/g, "").trim().slice(0, max) : "";
}

function strList(v: unknown, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(v)) return [];
  return v.map(x => str(x, maxLen)).filter(Boolean).slice(0, maxItems);
}

/** Приводит ссылку к https-виду; пустая строка — ссылки нет; null — некорректно. */
export function normalizeLink(kind: "telegram" | "vk" | "website", raw: unknown): string | null {
  const v = str(raw, 200);
  if (!v) return "";
  if (kind === "telegram") {
    const m = v.match(/^(?:https?:\/\/)?(?:t\.me\/|telegram\.me\/)?@?([A-Za-z0-9_]{4,32})\/?$/i);
    return m ? `https://t.me/${m[1]}` : null;
  }
  if (kind === "vk") {
    const m = v.match(/^(?:https?:\/\/)?(?:www\.)?(?:m\.)?vk\.(?:com|ru)\/([A-Za-z0-9_.\-]{2,64})\/?$/i);
    return m ? `https://vk.com/${m[1]}` : null;
  }
  const withProto = /^https?:\/\//i.test(v) ? v : `https://${v}`;
  try {
    const u = new URL(withProto);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (!u.hostname.includes(".") || u.username || u.password) return null;
    return u.protocol === "http:" ? `https://${u.host}${u.pathname}${u.search}`.slice(0, 200) : u.toString().slice(0, 200);
  } catch {
    return null;
  }
}

export function sanitizeProfile(input: unknown): Result<BookingProfile> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return { error: "profile должен быть объектом" };
  const o = input as Record<string, unknown>;
  const linksIn = (typeof o.links === "object" && o.links !== null ? o.links : {}) as Record<string, unknown>;
  const links: BookingProfile["links"] = {};
  for (const k of ["telegram", "vk", "website"] as const) {
    const n = normalizeLink(k, linksIn[k]);
    if (n === null) {
      const label = k === "telegram" ? "Telegram" : k === "vk" ? "ВКонтакте" : "сайт";
      return { error: `Некорректная ссылка: ${label}` };
    }
    if (n) links[k] = n;
  }
  const accent: AccentKey = typeof o.accent === "string" && o.accent in ACCENTS ? (o.accent as AccentKey) : "green";
  const out: BookingProfile = {
    headline: str(o.headline, 120),
    tags: strList(o.tags, 8, 40),
    about: str(o.about, 2000),
    links,
    qualifications: strList(o.qualifications, 10, 200),
    accent,
  };
  if (typeof o.photo === "string" && o.photo) {
    if (!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(o.photo) || o.photo.length > MAX_PHOTO_CHARS) {
      return { error: "Фото: нужен JPEG не больше ~160 КБ" };
    }
    out.photo = o.photo;
  }
  return { value: out };
}

function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function sanitizeServices(input: unknown): Result<BookingService[]> {
  if (!Array.isArray(input)) return { error: "services должен быть списком" };
  if (input.length > 10) return { error: "Не больше 10 услуг" };
  const out: BookingService[] = [];
  for (const raw of input) {
    if (typeof raw !== "object" || raw === null) return { error: "Некорректная услуга" };
    const s = raw as Record<string, unknown>;
    const title = str(s.title, 100);
    if (!title) return { error: "У каждой услуги должно быть название" };
    const dur = s.duration_minutes;
    if (typeof dur !== "number" || !Number.isInteger(dur) || dur < 10 || dur > 480) {
      return { error: `Услуга «${title}»: длительность — целое число от 10 до 480 мин` };
    }
    let price: number | null = null;
    if (s.price !== null && s.price !== undefined && s.price !== "") {
      if (typeof s.price !== "number" || !Number.isInteger(s.price) || s.price < 0 || s.price > 1_000_000) {
        return { error: `Услуга «${title}»: цена — целое число от 0 до 1 000 000` };
      }
      price = s.price;
    }
    const format: ServiceFormat = s.format === "offline" || s.format === "both" ? s.format : "online";
    const id = typeof s.id === "string" && /^[a-z0-9-]{1,40}$/.test(s.id) ? s.id : newId();
    out.push({ id, title, description: str(s.description, 500), format, duration_minutes: dur, price });
  }
  if (new Set(out.map(s => s.id)).size !== out.length) return { error: "Повторяющийся идентификатор услуги" };
  return { value: out };
}

export function sanitizeReviews(input: unknown): Result<BookingReview[]> {
  if (!Array.isArray(input)) return { error: "reviews должен быть списком" };
  if (input.length > 20) return { error: "Не больше 20 отзывов" };
  const out: BookingReview[] = [];
  for (const raw of input) {
    if (typeof raw !== "object" || raw === null) return { error: "Некорректный отзыв" };
    const r = raw as Record<string, unknown>;
    const author = str(r.author, 60);
    const text = str(r.text, 800);
    if (!author || !text) return { error: "В отзыве нужны имя автора и текст" };
    const id = typeof r.id === "string" && /^[a-z0-9-]{1,40}$/.test(r.id) ? r.id : newId();
    out.push({ id, author, text });
  }
  return { value: out };
}

/** Безопасное чтение jsonb из БД (на случай старых/кривых значений). */
export function readProfile(raw: unknown): BookingProfile {
  const res = sanitizeProfile(raw ?? {});
  return res.value ?? { ...EMPTY_PROFILE };
}
export function readServices(raw: unknown): BookingService[] {
  return sanitizeServices(raw ?? []).value ?? [];
}
export function readReviews(raw: unknown): BookingReview[] {
  return sanitizeReviews(raw ?? []).value ?? [];
}

export function formatPrice(price: number | null): string {
  return price === null ? "По договорённости" : `${price.toLocaleString("ru-RU")} ₽`;
}

export const FORMAT_LABELS: Record<ServiceFormat, string> = {
  online: "Онлайн",
  offline: "Очно",
  both: "Онлайн или очно",
};
