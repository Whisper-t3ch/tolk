"use client";
import { useRef, useState } from "react";
import { Plus, Trash2, Upload } from "lucide-react";
import { Button, Card, CardContent } from "@/components/ui";
import {
  ACCENTS, MAX_PHOTO_CHARS, FORMAT_LABELS,
  type AccentKey, type BookingProfile, type BookingReview, type BookingService, type ServiceFormat,
} from "@/lib/bookingProfile";

type Patch = { profile?: BookingProfile; services?: BookingService[]; reviews?: BookingReview[] };

interface Props {
  profile: BookingProfile;
  services: BookingService[];
  reviews: BookingReview[];
  saving: boolean;
  /** Сохраняет часть настроек; true — успешно. */
  onSave: (patch: Patch) => Promise<boolean>;
}

const input: React.CSSProperties = {
  display: "block", marginTop: 5, width: "100%", padding: "8px 10px", border: "1px solid #E5DFD5",
  borderRadius: 8, fontSize: 13, fontFamily: "var(--font-sans)", color: "#1C1C1E", background: "#fff", boxSizing: "border-box",
};
const label: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: "#6B6058" };
const h3: React.CSSProperties = { fontSize: 14, fontWeight: 700, color: "#1C1C1E", margin: "0 0 4px" };
const hint: React.CSSProperties = { fontSize: 12.5, color: "#6F5A3F", margin: "0 0 14px", lineHeight: 1.5 };

function newId() {
  return Math.random().toString(36).slice(2, 10);
}

/** Сжимает фото до ~480px по большей стороне, JPEG; возвращает data URL в пределах лимита. */
async function resizePhoto(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 480 / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  for (const q of [0.85, 0.75, 0.65, 0.5]) {
    const url = canvas.toDataURL("image/jpeg", q);
    if (url.length <= MAX_PHOTO_CHARS) return url;
  }
  throw new Error("size");
}

export default function BookingProfileEditor({ profile, services, reviews, saving, onSave }: Props) {
  const [p, setP] = useState<BookingProfile>(profile);
  const [tags, setTags] = useState(profile.tags.join(", "));
  const [quals, setQuals] = useState(profile.qualifications.join("\n"));
  const [svc, setSvc] = useState<BookingService[]>(services);
  const [rev, setRev] = useState<BookingReview[]>(reviews);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function setLink(k: "telegram" | "vk" | "website", v: string) {
    setP(prev => ({ ...prev, links: { ...prev.links, [k]: v } }));
  }

  async function pickPhoto(file: File | undefined) {
    if (!file) return;
    setPhotoError(null);
    try {
      const url = await resizePhoto(file);
      setP(prev => ({ ...prev, photo: url }));
    } catch {
      setPhotoError("Не удалось обработать фото — выберите другое изображение (JPG или PNG)");
    }
  }

  function saveProfile() {
    return onSave({
      profile: {
        ...p,
        tags: tags.split(/[,\n]/).map(t => t.trim()).filter(Boolean),
        qualifications: quals.split("\n").map(t => t.trim()).filter(Boolean),
      },
    });
  }

  function updateService(id: string, patch: Partial<BookingService>) {
    setSvc(list => list.map(s => (s.id === id ? { ...s, ...patch } : s)));
  }

  return (
    <>
      {/* Профиль специалиста */}
      <Card className="mb-4">
        <CardContent className="pt-6">
          <h3 style={h3}>Профиль на странице записи</h3>
          <p style={hint}>Клиент видит это до выбора времени: фото, чем вы занимаетесь, ваш подход и квалификацию.</p>

          <div style={{ display: "flex", gap: 16, alignItems: "center", marginBottom: 14, flexWrap: "wrap" }}>
            <div style={{
              width: 84, height: 84, borderRadius: "50%", overflow: "hidden", background: "#F5F3EF",
              border: "1px solid #E5DFD5", display: "flex", alignItems: "center", justifyContent: "center",
              color: "#8A7F70", fontSize: 11, textAlign: "center", flexShrink: 0,
            }}>
              {p.photo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.photo} alt="Фото" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              ) : "Нет фото"}
            </div>
            <div>
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={e => { pickPhoto(e.target.files?.[0]); e.target.value = ""; }} />
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()}>
                  <Upload size={13} style={{ marginRight: 5 }} /> {p.photo ? "Заменить фото" : "Загрузить фото"}
                </Button>
                {p.photo && (
                  <Button size="sm" variant="secondary" onClick={() => setP(prev => ({ ...prev, photo: undefined }))}>Убрать</Button>
                )}
              </div>
              {photoError && <p style={{ fontSize: 12, color: "#B91C1C", margin: "6px 0 0" }}>{photoError}</p>}
            </div>
          </div>

          <div style={{ display: "grid", gap: 12 }}>
            <div>
              <label style={label}>Заголовок под именем</label>
              <input style={input} maxLength={120} value={p.headline} placeholder="Например: Клинический психолог, КПТ"
                onChange={e => setP({ ...p, headline: e.target.value })} />
            </div>
            <div>
              <label style={label}>Метки подхода и тем (через запятую)</label>
              <input style={input} value={tags} placeholder="КПТ, тревога, отношения, самооценка"
                onChange={e => setTags(e.target.value)} />
            </div>
            <div>
              <label style={label}>О специалисте</label>
              <textarea style={{ ...input, minHeight: 110, resize: "vertical" }} maxLength={2000} value={p.about}
                placeholder="Коротко о себе, с какими запросами работаете, как проходит первая встреча"
                onChange={e => setP({ ...p, about: e.target.value })} />
            </div>
            <div>
              <label style={label}>Квалификация (каждый пункт с новой строки)</label>
              <textarea style={{ ...input, minHeight: 90, resize: "vertical" }} value={quals}
                placeholder={"Высшее психологическое образование, МГУ\nПовышение квалификации: КПТ, 2024\nСупервизия, личная терапия"}
                onChange={e => setQuals(e.target.value)} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12 }}>
              <div>
                <label style={label}>Telegram</label>
                <input style={input} value={p.links.telegram ?? ""} placeholder="@username" onChange={e => setLink("telegram", e.target.value)} />
              </div>
              <div>
                <label style={label}>ВКонтакте</label>
                <input style={input} value={p.links.vk ?? ""} placeholder="vk.com/username" onChange={e => setLink("vk", e.target.value)} />
              </div>
              <div>
                <label style={label}>Сайт</label>
                <input style={input} value={p.links.website ?? ""} placeholder="example.ru" onChange={e => setLink("website", e.target.value)} />
              </div>
            </div>
            <div>
              <label style={label}>Цвет страницы</label>
              <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                {(Object.keys(ACCENTS) as AccentKey[]).map(k => (
                  <button
                    key={k}
                    type="button"
                    title={ACCENTS[k].label}
                    aria-label={ACCENTS[k].label}
                    onClick={() => setP({ ...p, accent: k })}
                    style={{
                      width: 30, height: 30, borderRadius: "50%", background: ACCENTS[k].color, cursor: "pointer",
                      border: p.accent === k ? "3px solid #1C1C1E" : "3px solid #fff",
                      boxShadow: "0 0 0 1px #E5DFD5",
                    }}
                  />
                ))}
              </div>
            </div>
          </div>
          <div style={{ marginTop: 16 }}>
            <Button onClick={saveProfile} disabled={saving}>Сохранить профиль</Button>
          </div>
        </CardContent>
      </Card>

      {/* Услуги */}
      <Card className="mb-4">
        <CardContent className="pt-6">
          <h3 style={h3}>Услуги</h3>
          <p style={hint}>
            Клиент выбирает услугу, и время подбирается под её длительность. Если услуг нет, используется длительность из «Параметров записи».
          </p>
          <div style={{ display: "grid", gap: 12 }}>
            {svc.map(s => (
              <div key={s.id} style={{ border: "1px solid #E5DFD5", borderRadius: 10, padding: 12, background: "#FBF9F5" }}>
                <div style={{ display: "flex", gap: 8 }}>
                  <input style={{ ...input, marginTop: 0 }} maxLength={100} value={s.title} placeholder="Название, например «Индивидуальная консультация»"
                    onChange={e => updateService(s.id, { title: e.target.value })} />
                  <button type="button" aria-label="Удалить услугу" onClick={() => setSvc(list => list.filter(x => x.id !== s.id))}
                    style={{ border: "1px solid #E5DFD5", borderRadius: 8, background: "#fff", cursor: "pointer", padding: "0 10px" }}>
                    <Trash2 size={14} color="#B91C1C" />
                  </button>
                </div>
                <textarea style={{ ...input, minHeight: 54, resize: "vertical" }} maxLength={500} value={s.description}
                  placeholder="Описание: для кого, что входит" onChange={e => updateService(s.id, { description: e.target.value })} />
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10, marginTop: 8 }}>
                  <div>
                    <label style={label}>Формат</label>
                    <select style={input} value={s.format} onChange={e => updateService(s.id, { format: e.target.value as ServiceFormat })}>
                      {(Object.keys(FORMAT_LABELS) as ServiceFormat[]).map(f => <option key={f} value={f}>{FORMAT_LABELS[f]}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={label}>Длительность, мин</label>
                    <input style={input} type="number" min={10} max={480} value={s.duration_minutes}
                      onChange={e => updateService(s.id, { duration_minutes: Number(e.target.value) })} />
                  </div>
                  <div>
                    <label style={label}>Цена, ₽ (пусто — по договорённости)</label>
                    <input style={input} type="number" min={0} max={1000000} value={s.price ?? ""}
                      onChange={e => updateService(s.id, { price: e.target.value === "" ? null : Number(e.target.value) })} />
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
            <Button size="sm" variant="secondary" disabled={svc.length >= 10}
              onClick={() => setSvc(list => [...list, { id: newId(), title: "", description: "", format: "online", duration_minutes: 50, price: null }])}>
              <Plus size={13} style={{ marginRight: 5 }} /> Добавить услугу
            </Button>
            <Button onClick={() => onSave({ services: svc })} disabled={saving}>Сохранить услуги</Button>
          </div>
        </CardContent>
      </Card>

      {/* Отзывы */}
      <Card className="mb-4">
        <CardContent className="pt-6">
          <h3 style={h3}>Отзывы</h3>
          <p style={hint}>Добавляйте только настоящие отзывы с согласия авторов; имя можно сократить («Анна, 34 года»).</p>
          <div style={{ display: "grid", gap: 12 }}>
            {rev.map(r => (
              <div key={r.id} style={{ border: "1px solid #E5DFD5", borderRadius: 10, padding: 12, background: "#FBF9F5" }}>
                <div style={{ display: "flex", gap: 8 }}>
                  <input style={{ ...input, marginTop: 0 }} maxLength={60} value={r.author} placeholder="Имя автора"
                    onChange={e => setRev(list => list.map(x => (x.id === r.id ? { ...x, author: e.target.value } : x)))} />
                  <button type="button" aria-label="Удалить отзыв" onClick={() => setRev(list => list.filter(x => x.id !== r.id))}
                    style={{ border: "1px solid #E5DFD5", borderRadius: 8, background: "#fff", cursor: "pointer", padding: "0 10px" }}>
                    <Trash2 size={14} color="#B91C1C" />
                  </button>
                </div>
                <textarea style={{ ...input, minHeight: 70, resize: "vertical" }} maxLength={800} value={r.text} placeholder="Текст отзыва"
                  onChange={e => setRev(list => list.map(x => (x.id === r.id ? { ...x, text: e.target.value } : x)))} />
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
            <Button size="sm" variant="secondary" disabled={rev.length >= 20}
              onClick={() => setRev(list => [...list, { id: newId(), author: "", text: "" }])}>
              <Plus size={13} style={{ marginRight: 5 }} /> Добавить отзыв
            </Button>
            <Button onClick={() => onSave({ reviews: rev.filter(r => r.author.trim() || r.text.trim()) })} disabled={saving}>Сохранить отзывы</Button>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
