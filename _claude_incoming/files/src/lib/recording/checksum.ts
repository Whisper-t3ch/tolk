// ============================================================
// SHA-256 фрагмента записи.
//
// Зачем: при выгрузке с retry один и тот же фрагмент может доехать
// дважды, а при сбое сети — доехать частично. Backend сверяет checksum
// на приёме и при валидации manifest, чтобы отличить «фрагмент дошёл
// целым» от «дошёл битым» до того, как запись уйдёт в ASR.
//
// crypto.subtle доступен только в secure context (https/localhost) —
// то же требование, что и у getUserMedia, так что отдельной деградации
// не нужно: без secure context запись всё равно невозможна.
// ============================================================

/** "sha256:<hex>" для содержимого Blob. */
export async function checksumBlob(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  const hex = Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
  return `sha256:${hex}`;
}
