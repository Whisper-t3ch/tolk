"use client";
import { useCallback, useEffect, useRef, useState } from "react";

export type VoiceState = "idle" | "recording" | "transcribing";

/**
 * Голосовой ввод: запись с микрофона (MediaRecorder) → наш сервер
 * (/api/voice/transcribe, свой GigaAM) → текст через onText.
 * Звук не покидает инфраструктуру ТОЛК и не сохраняется.
 */
export function useVoiceDictation(onText: (text: string) => void) {
  const [state, setState] = useState<VoiceState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [supported, setSupported] = useState(false);
  const recRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  useEffect(() => {
    setSupported(typeof window !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined");
  }, []);

  const flashError = useCallback((msg: string) => {
    setError(msg);
    setTimeout(() => setError(null), 4000);
  }, []);

  const cleanup = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const stop = useCallback(() => {
    if (recRef.current && recRef.current.state !== "inactive") recRef.current.stop();
  }, []);

  const start = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      streamRef.current = stream;
      const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find(m => MediaRecorder.isTypeSupported(m));
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      rec.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      rec.onstop = async () => {
        cleanup();
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
        if (blob.size < 2000) { setState("idle"); flashError("Запись слишком короткая"); return; }
        setState("transcribing");
        try {
          const fd = new FormData();
          fd.append("audio", blob, "voice.webm");
          const res = await fetch("/api/voice/transcribe", { method: "POST", body: fd });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error ?? "Не удалось распознать речь");
          const text = String(data.text ?? "").trim();
          if (text) onTextRef.current(text);
          else flashError("Речь не распознана — попробуйте ещё раз");
        } catch (e) {
          flashError(e instanceof Error ? e.message : "Не удалось распознать речь");
        } finally {
          setState("idle");
        }
      };
      recRef.current = rec;
      rec.start();
      setState("recording");
      // Предел одной записи — 3 минуты.
      timerRef.current = setTimeout(stop, 180_000);
    } catch {
      cleanup();
      setState("idle");
      flashError("Нет доступа к микрофону — разрешите его в браузере");
    }
  }, [cleanup, flashError, stop]);

  const toggle = useCallback(() => {
    if (state === "recording") stop();
    else if (state === "idle") void start();
  }, [state, start, stop]);

  return { state, error, supported, toggle };
}
