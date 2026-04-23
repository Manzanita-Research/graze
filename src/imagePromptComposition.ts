/**
 * Pure helpers for composing `POST /api/images/generate` inputs from a tldraw
 * selection. Kept free of tldraw imports so the logic is directly unit-testable
 * with `bun test` — the App.tsx layer is responsible for pulling shape text out
 * of `editor.getShape(id)` and forwarding it here as plain strings.
 */

export type ShapeKind = { type: string };

/**
 * Returns true when the selection is non-empty AND every shape is a text-
 * bearing shape (`text` or `note`). Drives the JSON-vs-multipart routing.
 * Empty selection returns false so the caller handles it as the "empty
 * selection + dock" flow.
 */
export function isTextOnlySelection(shapes: ShapeKind[]): boolean {
  if (shapes.length === 0) return false;
  return shapes.every((s) => s.type === "text" || s.type === "note");
}

/**
 * Build the `prompt` string for the JSON path.
 *
 * Order: typed prompt first, then each shape's text in shape-creation order.
 * Join delimiter: `\n\n`. Empty/whitespace-only entries are dropped.
 */
export function buildPromptFromSelection(
  typedPrompt: string,
  shapeTexts: string[],
): string {
  const parts: string[] = [];
  const typed = typedPrompt.trim();
  if (typed) parts.push(typed);
  for (const t of shapeTexts) {
    const trimmed = t.trim();
    if (trimmed) parts.push(trimmed);
  }
  return parts.join("\n\n");
}
