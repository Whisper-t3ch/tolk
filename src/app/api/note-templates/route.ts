import { NextResponse } from "next/server";

// Раздел "Шаблоны заметок" убран — шаблоны протоколов теперь часть
// базы знаний (GET /api/knowledge, source_type: "protocol"), а
// заполнение реальной заметки сессии использует /api/sessions/[id]/soap
// с опциональным выбором шаблона (см. migration_017). Эти роуты
// оставлены как понятная 410-заглушка на случай прямых обращений.
export async function GET() {
  return NextResponse.json(
    { error: "Этот раздел упразднён. Используйте /api/knowledge (source_type: protocol)." },
    { status: 410 }
  );
}

export async function POST() {
  return NextResponse.json(
    { error: "Этот раздел упразднён. Используйте /api/knowledge (source_type: protocol)." },
    { status: 410 }
  );
}
