import {
  AssetRecordType,
  createShapeId,
  toRichText,
  type TLArrowShape,
  type TLAsset,
  type TLGeoShape,
  type TLImageShape,
  type TLNoteShape,
  type TLParentId,
  type TLRecord,
  type TLShape,
  type TLShapeId,
  type TLTextShape,
} from "@tldraw/tlschema";
import { getIndexAbove, type IndexKey, type JsonObject } from "@tldraw/utils";

const DEFAULT_PAGE_ID = "page:page" as TLParentId;
const CANVAS_SHAPE_TYPES = new Set(["note", "text", "geo", "arrow", "image"]);
const NOTE_SIZE = 200;
const LABEL_PADDING = 16;
const TEXT_FONT_SIZES = { s: 18, m: 24, l: 36, xl: 44 } as const;
const LABEL_FONT_SIZES = { s: 18, m: 22, l: 26, xl: 32 } as const;
const TEXT_LINE_HEIGHT = 1.35;
const DEFAULT_SIZE = "m";

export interface CanvasCreateShapeInput {
  id?: unknown;
  type?: unknown;
  x?: unknown;
  y?: unknown;
  props?: unknown;
}

export interface CanvasUpdateShapeInput {
  shapeId?: unknown;
  props?: unknown;
}

export interface CanvasDeleteShapesInput {
  shapeIds?: unknown;
}

export interface RoomStore {
  get(id: string): TLRecord | null;
  getAll(): TLRecord[];
  put(record: TLRecord): void;
  delete(recordOrId: TLRecord | string): void;
}

export function createCanvasShape(store: RoomStore, input: CanvasCreateShapeInput) {
  const shapeType =
    typeof input.type === "string" && CANVAS_SHAPE_TYPES.has(input.type)
      ? input.type
      : "geo";
  const props = isRecord(input.props) ? input.props : {};
  const shapeId = normalizeShapeId(input.id);
  const base = createShapeBase(store, shapeId, input.x, input.y);

  let shape: TLShape;
  const recordsToPut: TLRecord[] = [];

  switch (shapeType) {
    case "note":
      shape = {
        ...base,
        type: "note",
        props: {
          color: "yellow",
          labelColor: "black",
          size: "m",
          font: "draw",
          fontSizeAdjustment: 0,
          align: "middle",
          verticalAlign: "middle",
          growY: 0,
          url: "",
          richText: toRichText(""),
          scale: 1,
          ...getNoteLayoutProps(props),
          ...withRichText(props),
        },
      } satisfies TLNoteShape;
      break;
    case "text":
      shape = {
        ...base,
        type: "text",
        props: {
          color: "black",
          size: "m",
          font: "draw",
          textAlign: "start",
          w: 200,
          richText: toRichText(""),
          scale: 1,
          autoSize: true,
          ...getTextLayoutProps(props),
          ...withRichText(props),
        },
      } satisfies TLTextShape;
      break;
    case "arrow":
      shape = {
        ...base,
        type: "arrow",
        props: {
          kind: "arc",
          labelColor: "black",
          color: "black",
          fill: "none",
          dash: "draw",
          size: "m",
          arrowheadStart: "none",
          arrowheadEnd: "arrow",
          font: "draw",
          start: { x: 0, y: 0 },
          end: { x: 100, y: 100 },
          bend: 0,
          richText: toRichText(""),
          labelPosition: 0.5,
          scale: 1,
          elbowMidPoint: 0.5,
          ...withRichText(props),
        },
      } satisfies TLArrowShape;
      break;
    case "image": {
      const url = typeof props.url === "string" ? props.url : "";
      const nativeW = getNumber(props.nativeW, getNumber(props.w, 1024));
      const nativeH = getNumber(props.nativeH, getNumber(props.h, 1024));
      const w = getNumber(props.w, 384);
      const h = getNumber(props.h, 384);
      const asset = AssetRecordType.create({
        id: AssetRecordType.createId(shapeId.slice("shape:".length)),
        type: "image",
        props: {
          name: "generated.png",
          src: url,
          w: nativeW,
          h: nativeH,
          mimeType: "image/png",
          isAnimated: false,
        },
      }) satisfies TLAsset;
      recordsToPut.push(asset);
      shape = {
        ...base,
        type: "image",
        props: {
          w,
          h,
          playing: true,
          url: "",
          assetId: asset.id,
          crop: null,
          flipX: false,
          flipY: false,
          altText: "",
        },
      } satisfies TLImageShape;
      break;
    }
    default:
      shape = {
        ...base,
        type: "geo",
        props: {
          geo: "rectangle",
          dash: "draw",
          url: "",
          w: 200,
          h: 120,
          growY: 0,
          scale: 1,
          labelColor: "black",
          color: "black",
          fill: "none",
          size: "m",
          font: "draw",
          align: "middle",
          verticalAlign: "middle",
          richText: toRichText(""),
          ...getGeoLayoutProps(props),
          ...withRichText(props),
        },
      } satisfies TLGeoShape;
      break;
  }

  for (const record of recordsToPut) store.put(record);
  store.put(shape);
  return shape;
}

export function updateCanvasShape(store: RoomStore, input: CanvasUpdateShapeInput) {
  if (typeof input.shapeId !== "string" || input.shapeId.length === 0) {
    throw new Error("shapeId required");
  }
  const shape = findShape(store, input.shapeId);
  if (!shape) return null;

  const props = isRecord(input.props) ? withRichText(input.props) : {};
  const updated = {
    ...shape,
    props: {
      ...shape.props,
      ...props,
    },
  } as TLShape;
  store.put(updated);
  return updated;
}

export function deleteCanvasShapes(store: RoomStore, input: CanvasDeleteShapesInput) {
  if (!Array.isArray(input.shapeIds) || input.shapeIds.length === 0) {
    throw new Error("shapeIds required");
  }

  const deleted: string[] = [];
  for (const candidate of input.shapeIds) {
    if (typeof candidate !== "string" || candidate.length === 0) continue;
    const shape = findShape(store, candidate);
    if (!shape) continue;
    store.delete(shape.id);
    deleted.push(shape.id);
  }
  return deleted;
}

export function getCanvasShapes(store: RoomStore) {
  return store
    .getAll()
    .filter((record): record is TLShape => record.typeName === "shape")
    .sort((a, b) => a.index.localeCompare(b.index));
}

function createShapeBase(
  store: RoomStore,
  id: TLShapeId,
  x: unknown,
  y: unknown,
): Omit<TLShape, "type" | "props"> {
  const shapes = getCanvasShapes(store).filter(
    (shape) => shape.parentId === DEFAULT_PAGE_ID,
  );
  const highest = shapes.at(-1);
  const index = getIndexAbove(highest?.index ?? ("a0" as IndexKey));

  return {
    id,
    typeName: "shape",
    x: typeof x === "number" ? x : 0,
    y: typeof y === "number" ? y : 0,
    rotation: 0,
    index,
    parentId: DEFAULT_PAGE_ID,
    isLocked: false,
    opacity: 1,
    meta: {} as JsonObject,
  };
}

function normalizeShapeId(id: unknown): TLShapeId {
  if (typeof id === "string" && id.length > 0) {
    return id.startsWith("shape:")
      ? (id as TLShapeId)
      : createShapeId(id);
  }
  return createShapeId();
}

function findShape(store: RoomStore, id: string): TLShape | null {
  const normalized = id.startsWith("shape:") ? id : `shape:${id}`;
  const exact = store.get(normalized);
  if (exact?.typeName === "shape") return exact;

  return (
    getCanvasShapes(store).find(
      (shape) => shape.id === id || shape.id.endsWith(id),
    ) ?? null
  );
}

function withRichText(props: Record<string, unknown>): Record<string, unknown> {
  const next = { ...props };
  const richText = next.richText;
  const text = next.text;
  if (typeof richText === "string") {
    next.richText = toRichText(richText);
  } else if (richText === undefined && typeof text === "string") {
    next.richText = toRichText(text);
  }
  delete next.text;
  delete next.nativeW;
  delete next.nativeH;
  return next;
}

function getTextLayoutProps(props: Record<string, unknown>) {
  const hasExplicitWidth = isFiniteNumber(props.w);
  const hasExplicitAutoSize = typeof props.autoSize === "boolean";
  const text = getPlainTextFromProps(props);

  if (hasExplicitWidth && !hasExplicitAutoSize) {
    return { autoSize: false };
  }

  if (!text || hasExplicitAutoSize || hasExplicitWidth) return {};

  const lineStats = getTextStats(text);
  if (lineStats.longestLine <= 22 && lineStats.lineCount === 1) return {};

  return {
    autoSize: false,
    w: estimateTextWidth(text, getTextFontSize(props), 560),
  };
}

function getNoteLayoutProps(props: Record<string, unknown>) {
  const text = getPlainTextFromProps(props);
  if (!text) return {};

  const hasExplicitGrowY = isFiniteNumber(props.growY);
  const hasExplicitFontSizeAdjustment = isFiniteNumber(props.fontSizeAdjustment);
  const fontSize = getNoteFontSize(props);
  const fontSizeAdjustment = hasExplicitFontSizeAdjustment
    ? undefined
    : getNoteFontSizeAdjustment(text, fontSize);
  const layoutFontSize = fontSizeAdjustment ?? fontSize;
  const estimatedHeight = estimateWrappedTextHeight(
    text,
    layoutFontSize,
    NOTE_SIZE - LABEL_PADDING * 2,
    LABEL_PADDING * 2,
  );
  const growY = Math.max(0, Math.ceil(estimatedHeight - NOTE_SIZE));

  return {
    ...(fontSizeAdjustment === undefined ? {} : { fontSizeAdjustment }),
    ...(hasExplicitGrowY ? {} : { growY }),
  };
}

function getGeoLayoutProps(props: Record<string, unknown>) {
  const text = getPlainTextFromProps(props);
  if (!text) return {};

  const hasExplicitWidth = isFiniteNumber(props.w);
  const hasExplicitHeight = isFiniteNumber(props.h);
  const hasExplicitGrowY = isFiniteNumber(props.growY);
  const fontSize = getLabelFontSize(props);
  const w = hasExplicitWidth
    ? (props.w as number)
    : estimateTextWidth(text, fontSize, 420, 160) + LABEL_PADDING * 2;
  const estimatedLabelHeight = estimateWrappedTextHeight(
    text,
    fontSize,
    Math.max(32, w - LABEL_PADDING * 2),
    LABEL_PADDING * 2,
  );
  const h = hasExplicitHeight
    ? (props.h as number)
    : Math.max(100, Math.ceil(estimatedLabelHeight + 20));
  const growY = Math.max(0, Math.ceil(estimatedLabelHeight - h));

  return {
    ...(hasExplicitWidth ? {} : { w }),
    ...(hasExplicitHeight ? {} : { h }),
    ...(hasExplicitGrowY ? {} : { growY }),
  };
}

function getPlainTextFromProps(props: Record<string, unknown>): string {
  if (typeof props.richText === "string") return props.richText.trim();
  const fromRichText = plainTextFromRichText(props.richText);
  if (fromRichText) return fromRichText.trim();
  return typeof props.text === "string" ? props.text.trim() : "";
}

function plainTextFromRichText(value: unknown): string {
  if (!isRecord(value)) return "";
  const content = value.content;
  if (!Array.isArray(content)) return "";

  if (value.type === "doc") {
    return content.map((node) => plainTextFromRichTextNode(node)).join("\n");
  }
  return plainTextFromRichTextNode(value);
}

function plainTextFromRichTextNode(value: unknown): string {
  if (!isRecord(value)) return "";
  if (typeof value.text === "string") return value.text;
  const content = value.content;
  if (!Array.isArray(content)) return "";
  return content.map((node) => plainTextFromRichTextNode(node)).join("");
}

function estimateTextWidth(
  text: string,
  fontSize: number,
  maxWidth: number,
  minWidth = 140,
) {
  const stats = getTextStats(text);
  const charWidth = estimateCharWidth(fontSize);
  const targetChars = clamp(
    Math.max(stats.longestWord, Math.min(stats.longestLine, 42)),
    12,
    Math.floor(maxWidth / charWidth),
  );
  return Math.ceil(clamp(targetChars * charWidth + 8, minWidth, maxWidth));
}

function estimateWrappedTextHeight(
  text: string,
  fontSize: number,
  maxTextWidth: number,
  verticalPadding: number,
) {
  const charsPerLine = Math.max(
    1,
    Math.floor(maxTextWidth / estimateCharWidth(fontSize)),
  );
  const lineCount = text
    .split("\n")
    .reduce(
      (sum, line) => sum + Math.max(1, Math.ceil(line.length / charsPerLine)),
      0,
    );
  return lineCount * fontSize * TEXT_LINE_HEIGHT + verticalPadding;
}

function getNoteFontSizeAdjustment(text: string, defaultFontSize: number) {
  const longestWord = getTextStats(text).longestWord;
  const charsAtDefault = Math.floor(
    (NOTE_SIZE - LABEL_PADDING * 2) / estimateCharWidth(defaultFontSize),
  );
  if (longestWord <= charsAtDefault) return undefined;

  const adjusted = Math.floor(
    (NOTE_SIZE - LABEL_PADDING * 2) / (longestWord * 0.58),
  );
  return clamp(adjusted, 14, defaultFontSize);
}

function getTextStats(text: string) {
  const lines = text.split("\n");
  const words = text.match(/\S+/g) ?? [];
  return {
    lineCount: lines.length,
    longestLine: Math.max(0, ...lines.map((line) => line.length)),
    longestWord: Math.max(0, ...words.map((word) => word.length)),
  };
}

function getTextFontSize(props: Record<string, unknown>) {
  return TEXT_FONT_SIZES[getSize(props)];
}

function getLabelFontSize(props: Record<string, unknown>) {
  return LABEL_FONT_SIZES[getSize(props)];
}

function getNoteFontSize(props: Record<string, unknown>) {
  return getLabelFontSize(props);
}

function getSize(props: Record<string, unknown>): keyof typeof LABEL_FONT_SIZES {
  return props.size === "s" ||
    props.size === "m" ||
    props.size === "l" ||
    props.size === "xl"
    ? props.size
    : DEFAULT_SIZE;
}

function estimateCharWidth(fontSize: number) {
  return fontSize * 0.58;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
