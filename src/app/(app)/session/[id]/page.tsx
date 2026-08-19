"use client";
import { useState, useEffect, use } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Mic, MicOff, Video, VideoOff, PhoneOff, Clock } from "lucide-react";
import { clients } from "@/lib/mock-data";
import { Button, Card, CardContent } from "@/components/ui";

export default function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const { id } = use(params);
  const client = clients.find(c => c.id === id) || clients[0];
  const [seconds, setSeconds] = useState(0);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [notes, setNotes] = useState("");
  const [ending, setEnding] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => setSeconds(s => s + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60).toString().padStart(2, "0");
    const sec = (s % 60).toString().padStart(2, "0");
    return `${m}:${sec}`;
  };

  function handleEnd() {
    setEnding(true);
    setTimeout(() => router.push(`/session/${client.id}/soap`), 1200);
  }

  return (
    <div style={{ display: "flex", height: "calc(100vh - 120px)", gap: 16, padding: "0 24px 24px" }}>
      {/* Видео */}
      <div style={{ flex: "0 0 60%" }}>
        <Card className="h-full flex flex-col">
          {/* Видео-площадка */}
          <div style={{
            flex: 1,
            background: "#1a2240",
            display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center",
            position: "relative",
            borderRadius: "8px 8px 0 0",
            overflow: "hidden",
          }}>
            {/* Индикатор записи */}
            <div style={{ position: "absolute", top: 16, left: 16, display: "flex", alignItems: "center", gap: 8 }}>
              <motion.div
                animate={{ opacity: [1, 0.3, 1] }}
                transition={{ repeat: Infinity, duration: 1.5 }}
                style={{
                  width: 10, height: 10,
                  background: "#ef4444",
                  borderRadius: "50%",
                }}
              />
              <span style={{ color: "#fff", fontSize: 13, fontWeight: 500 }}>REC</span>
            </div>

            {/* Таймер */}
            <div style={{ position: "absolute", top: 16, right: 16, display: "flex", alignItems: "center", gap: 6, background: "rgba(0,0,0,0.5)", padding: "8px 12px", borderRadius: 8 }}>
              <Clock size={16} color="#fff" />
              <span style={{ color: "#fff", fontSize: 14, fontWeight: 600, fontFamily: "monospace" }}>
                {formatTime(seconds)}
              </span>
            </div>

            {/* Видео-фид (заглушка) */}
            <div style={{ textAlign: "center" }}>
              {camOn ? (
                <>
                  <Video size={48} color="#fff" opacity={0.3} />
                  <p style={{ color: "#fff", marginTop: 12, fontSize: 14 }}>Видео-поток активен</p>
                </>
              ) : (
                <>
                  <VideoOff size={48} color="#fff" opacity={0.3} />
                  <p style={{ color: "#fff", marginTop: 12, fontSize: 14 }}>Видео отключено</p>
                </>
              )}
            </div>

            {/* Информация о клиенте */}
            <div style={{ position: "absolute", bottom: 16, left: 16, background: "rgba(0,0,0,0.6)", padding: "12px 16px", borderRadius: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{
                  width: 40, height: 40,
                  background: "#2D6A5C",
                  borderRadius: "50%",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  color: "#fff", fontWeight: 600,
                }}>
                  {client.initials}
                </div>
                <div>
                  <div style={{ color: "#fff", fontSize: 14, fontWeight: 600 }}>{client.name}</div>
                  <div style={{ color: "rgba(255,255,255,0.7)", fontSize: 12 }}>{client.request}</div>
                </div>
              </div>
            </div>
          </div>

          {/* Контролы */}
          <CardContent className="pb-4 pt-4">
            <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
              <Button
                onClick={() => setMicOn(!micOn)}
                variant={micOn ? "primary" : "danger"}
                size="lg"
                className="rounded-full w-14 h-14 flex items-center justify-center p-0"
              >
                {micOn ? <Mic size={20} /> : <MicOff size={20} />}
              </Button>
              <Button
                onClick={() => setCamOn(!camOn)}
                variant={camOn ? "primary" : "danger"}
                size="lg"
                className="rounded-full w-14 h-14 flex items-center justify-center p-0"
              >
                {camOn ? <Video size={20} /> : <VideoOff size={20} />}
              </Button>
              <Button
                onClick={handleEnd}
                variant="danger"
                size="lg"
                className="rounded-full w-14 h-14 flex items-center justify-center p-0"
              >
                <PhoneOff size={20} />
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Заметки */}
      <div style={{ flex: "0 0 40%" }}>
        <Card className="h-full flex flex-col">
          <CardContent className="flex-1 pt-6 flex flex-col" style={{ minHeight: 0 }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, color: "#1C1C1E", marginBottom: 12 }}>
              Заметки сессии
            </h3>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Ключевые моменты сессии..."
              style={{
                flex: 1,
                padding: "12px 14px",
                border: "1px solid #E5DFD5",
                borderRadius: 8,
                fontSize: 13,
                color: "#1C1C1E",
                fontFamily: "var(--font-sans)",
                resize: "none",
                minHeight: 0,
              }}
            />
            <div style={{ marginTop: 12, padding: "12px", background: "#E8F2EF", borderRadius: 8, borderLeft: "4px solid #2D6A5C" }}>
              <p style={{ fontSize: 12, color: "#2D6A5C", fontWeight: 500, margin: 0 }}>
                💡 Совет: Используйте SOAP-протокол при завершении сессии
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
