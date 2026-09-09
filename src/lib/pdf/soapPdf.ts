// ------------------------------------------------------------
// Генерация PDF-версии протокола сессии (S/O/A/P) через pdf-lib.
// Раньше кнопка "PDF" на странице /session/[id]/soap была фейковой
// заглушкой (setTimeout + уведомление "PDF готов"), реального файла
// не существовало — это первая настоящая реализация.
//
// pdf-lib не поддерживает кириллицу через встроенные (standard 14)
// шрифты — нужен embed кастомного TTF с кириллическими глифами через
// @pdf-lib/fontkit. Шрифт PT Sans (SIL Open Font License, свободная
// лицензия) собран из отдельных latin+cyrillic субсетов пакета
// @fontsource/pt-sans и лежит в src/assets/fonts — см. комментарий
// там же при необходимости пересобрать.
// ------------------------------------------------------------
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { readFile } from "fs/promises";
import path from "path";

export interface SoapPdfInput {
  clientName: string;
  scheduledAt: string;
  durationMinutes: number;
  templateTitle?: string | null;
  blocks: Array<{ label: string; text: string }>;
}

const PAGE_WIDTH = 595.28; // A4 при 72 DPI
const PAGE_HEIGHT = 841.89;
const MARGIN = 56;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

async function loadFontBytes(filename: string): Promise<Buffer> {
  const fontPath = path.join(process.cwd(), "src", "assets", "fonts", filename);
  return readFile(fontPath);
}

// Простой перенос строк по ширине без внешних зависимостей — режет
// по словам, оценивая ширину через font.widthOfTextAtSize.
function wrapText(text: string, font: PDFFont, fontSize: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    if (paragraph.trim() === "") {
      lines.push("");
      continue;
    }
    const words = paragraph.split(/\s+/).filter(Boolean);
    let current = "";
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, fontSize) > maxWidth && current) {
        lines.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }
    if (current) lines.push(current);
  }
  return lines;
}

/**
 * Собирает PDF-документ протокола сессии и возвращает его как Uint8Array —
 * вызывающий API route оборачивает это в NextResponse с нужными заголовками.
 */
export async function generateSoapPdf(input: SoapPdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);

  const [regularBytes, boldBytes] = await Promise.all([
    loadFontBytes("PTSans-Regular.ttf"),
    loadFontBytes("PTSans-Bold.ttf"),
  ]);
  const regularFont = await doc.embedFont(regularBytes);
  const boldFont = await doc.embedFont(boldBytes);

  let page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;

  const ensureSpace = (needed: number) => {
    if (y - needed < MARGIN) {
      page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      y = PAGE_HEIGHT - MARGIN;
    }
  };

  const drawWrapped = (text: string, font: PDFFont, size: number, color = rgb(0.11, 0.11, 0.12), lineGap = 4) => {
    const lines = wrapText(text, font, size, CONTENT_WIDTH);
    for (const line of lines) {
      ensureSpace(size + lineGap);
      page.drawText(line, { x: MARGIN, y, size, font, color });
      y -= size + lineGap;
    }
  };

  // Заголовок
  drawWrapped("Протокол сессии", boldFont, 20, rgb(0.11, 0.42, 0.36));
  y -= 6;

  const dateLabel = new Date(input.scheduledAt).toLocaleDateString("ru", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  drawWrapped(`${input.clientName} · ${dateLabel} · ${input.durationMinutes} минут`, regularFont, 11, rgb(0.42, 0.38, 0.33));
  if (input.templateTitle) {
    drawWrapped(`Формат: ${input.templateTitle}`, regularFont, 10, rgb(0.55, 0.45, 0.33));
  }
  y -= 10;

  // Разделительная линия
  ensureSpace(20);
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: PAGE_WIDTH - MARGIN, y },
    thickness: 1,
    color: rgb(0.9, 0.87, 0.82),
  });
  y -= 20;

  for (const block of input.blocks) {
    ensureSpace(24);
    drawWrapped(block.label, boldFont, 13, rgb(0.11, 0.11, 0.12));
    y -= 2;
    drawWrapped(block.text || "(не заполнено)", regularFont, 11.5, undefined, 5);
    y -= 14;
  }

  return doc.save();
}

// Экспортируется отдельно на случай, если понадобится типизировать
// возвращаемую страницу где-то ещё — сейчас не используется вовне.
export type { PDFPage };
