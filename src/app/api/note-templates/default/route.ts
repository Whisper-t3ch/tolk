import { NextResponse } from "next/server";

// Раздел "Шаблоны заметок" убран — см. комментарий в api/note-templates/route.ts.
export async function POST() {
  return NextResponse.json(
    { error: "Этот раздел упразднён. Выбор шаблона теперь делается прямо на странице протокола сессии." },
    { status: 410 }
  );
}
