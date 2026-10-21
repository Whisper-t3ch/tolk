"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, Square, X } from "lucide-react";

export interface SentVoiceMessage {
  id: string; direction: string; text: string; created_at: string;
  status: string; error_message: string | null;
}

/**
 * Кнопка записи голосового сообщения клиенту: нажали — идёт запись (таймер),
 * «стоп» — запись уходит клиенту в Telegram, ✕ — отмена. До 3 минут.
 */
export default function VoiceMessageButton({
  clientId, channel, size = 32, disabled, onSent, onError,
}: {
  clientId: string;
  channel: "telegram" | "vk";
  size?: number;
  disabled?: boolean;
  onSent: (message: SentVoiceMessage) => void;
  onError: (message: string) => void;
}) {
  const [state, setState] = useState<"idle" | "recording" | "sending">("idle");
  const [seconds, setSeconds] = useState(0);
  const [supported, setSupported] = useState(false);
  const recRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const cancelledRef = useRef(false);
  const startedAtRef = useRef(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setSupported(typeof window !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined");
  }, []);

  const cleanup = useCallback(() => {
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = null;
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  }, []);
  useEffect(() => cleanup, [cleanup]);

  const finish = useCallback((cancel: boolean) => {
    cancelledRef.current = cancel;
    if (recRef.current && recRef.current.state !== "inactive") recRef.current.stop();
  }, []);

  async function start() {
    if (channel !== "telegram") {
      onError("Голосовые сообщения пока работают только в Telegram");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      streamRef.current = stream;
      const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find(m => MediaRecorder.isTypeSupported(m));
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      cancelledRef.current = false;
      rec.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      rec.onstop = async () => {
        const duration = (Date.now() - startedAtRef.current) / 1000;
        cleanup();
        if (cancelledRef.current) { setState("idle"); return; }
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
        if (blob.size < 2000 || duration < 1) { setState("idle"); onError("Запись слишком короткая"); return; }
        setState("sending");
        try {
          const fd = new FormData();
          fd.append("client_id", clientId);
          fd.append("channel", channel);
          fd.append("duration", String(Math.round(duration)));
          fd.append("audio", blob, blob.type.includes("mp4") ? "voice.m4a" : "voice.webm");
          const res = await fetch("/api/messages/voice", { method: "POST", body: fd });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error ?? "Не удалось отправить голосовое сообщение");
          onSent(data.message);
        } catch (e) {
          onError(e instanceof Error ? e.message : "Не удалось отправить голосовое сообщение");
        } finally {
          setState("idle");
        }
      };
      recRef.current = rec;
      startedAtRef.current = Date.now();
      setSeconds(0);
      rec.start();
      setState("recording");
      tickRef.current = setInterval(() => {
        const s = Math.floor((Date.now() - startedAtRef.current) / 1000);
        setSeconds(s);
        if (s >= 180) finish(false);
      }, 500);
    } catch {
      cleanup();
      setState("idle");
      onError("Нет доступа к микрофону — разрешите его в браузере");
    }
  }

  if (!supported) return null;

  const baseBtn = {
    height: size, borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center",
    gap: 4, cursor: "pointer", border: "1px solid #E5DFD5", fontFamily: "var(--font-sans)", fontSize: 12, fontWeight: 600,
  } as const;

  if (state === "recording") {
    const mm = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
    return (
      <>
        <button onClick={() => finish(true)} title="Отменить запись" style={{ ...baseBtn, width: size, background: "#F5F1E8", color: "#6B6058" }}>
          <X size={16} />
        </button>
        <button onClick={() => finish(false)} title="Остановить и отправить" style={{ ...baseBtn, padding: "0 10px", background: "#EF4444", border: "none", color: "#fff" }}>
          <Square size={12} fill="#fff" /> {mm}
        </button>
      </>
    );
  }
  return (
    <button
      onClick={start}
      disabled={disabled || state === "sending"}
      title={state === "sending" ? "Отправляю…" : "Записать голосовое сообщение"}
      style={{ ...baseBtn, width: size, background: "#F5F1E8", color: state === "sending" ? "#A7C4BC" : "#6B6058" }}
    >
      <Mic size={16} />
    </button>
  );
}
