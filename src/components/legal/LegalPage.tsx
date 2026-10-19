import Link from "next/link";
import { OPERATOR } from "@/lib/legal/operator";

export interface LegalSection {
  title: string;
  paragraphs: string[];
}

export default function LegalPage({ title, sections }: { title: string; sections: LegalSection[] }) {
  return (
    <div style={{ minHeight: "100vh", background: "#F5F3EF", padding: "32px 16px" }}>
      <article
        style={{
          maxWidth: 780, margin: "0 auto", background: "#FFFFFF", border: "1px solid #E5DFD5",
          borderRadius: 16, padding: "32px clamp(16px, 4vw, 40px)",
          color: "#1C1C1E", lineHeight: 1.65, fontSize: 15,
        }}
      >
        <Link href="/" style={{ fontSize: 13, color: "#2D6A5C", fontWeight: 600, textDecoration: "none" }}>
          ← На главную
        </Link>
        <h1 style={{ fontSize: 26, fontWeight: 800, margin: "16px 0 4px" }}>{title}</h1>
        <p style={{ fontSize: 13, color: "#6F5A3F", margin: "0 0 24px" }}>
          Редакция от {OPERATOR.updatedAt} · {OPERATOR.site}
        </p>
        {sections.map((s, i) => (
          <section key={i} style={{ marginBottom: 20 }}>
            <h2 style={{ fontSize: 17, fontWeight: 700, margin: "0 0 8px" }}>
              {i + 1}. {s.title}
            </h2>
            {s.paragraphs.map((p, j) => (
              <p key={j} style={{ margin: "0 0 8px" }}>{p}</p>
            ))}
          </section>
        ))}
      </article>
    </div>
  );
}
