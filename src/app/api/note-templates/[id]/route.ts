import { NextResponse } from "next/server";

// Раздел "Шаблоны заметок" убран — см. комментарий в api/note-templates/route.ts.
export async function DELETE() {
  return NextResponse.json(
    { error: "Этот раздел упразднён. Используйте /api/knowledge?id= (source_type: protocol)." },
    { status: 410 }
  );
}
