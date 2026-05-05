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
const AUTO_PLACE_START = { x: 120, y: 120 };
const AUTO_PLACE_MAX_X = 1400;
const AUTO_PLACE_GAP = 48;
const AUTO_PLACE_MARGIN = 24;

type CanvasShapeType = "note" | "text" | "geo" | "arrow" | "image";
type LayoutHint = "auto" | "heading" | "caption" | "compact" | "wide" | "card";
type StyleHint = "default" | "muted" | "question" | "warning" | "success" | "idea";

export interface CanvasCreateShapeInput {
  id?: unknown;
  type?: unknown;
  x?: unknown;
  y?: unknown;
  layout?: unknown;
  style?: unknown;
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
      ? (input.type as CanvasShapeType)
      : "geo";
  const props = isRecord(input.props) ? input.props : {};
  const layout = getLayoutHint(input.layout ?? props.layout);
  const style = getStyleHint(input.style ?? props.style ?? props.tone);
  const shapeId = normalizeShapeId(input.id);
  const existing = findShape(store, shapeId);
  const base = createShapeBase(
    store,
    shapeId,
    input.x ?? existing?.x,
    input.y ?? existing?.y,
  );

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
          ...getStyleProps("note", style),
          ...getLayoutPresetProps("note", layout),
          ...getNoteLayoutProps(props, layout),
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
          ...getStyleProps("text", style),
          ...getLayoutPresetProps("text", layout),
          ...getTextLayoutProps(props, layout),
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
          ...getStyleProps("arrow", style),
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
          ...getLayoutPresetProps("image", layout),
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
          ...getStyleProps("geo", style),
          ...getLayoutPresetProps("geo", layout),
          ...getGeoLayoutProps(props, layout),
          ...withRichText(props),
        },
      } satisfies TLGeoShape;
      break;
  }

  if (!existing && (!isFiniteNumber(input.x) || !isFiniteNumber(input.y))) {
    const position = findOpenPosition(store, shape);
    shape = {
      ...shape,
      x: isFiniteNumber(input.x) ? input.x : position.x,
      y: isFiniteNumber(input.y) ? input.y : position.y,
    } as TLShape;
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

function findOpenPosition(store: RoomStore, shape: TLShape) {
  const footprint = getShapeFootprint(shape);
  const existing = getCanvasShapes(store)
    .filter((other) => other.id !== shape.id && other.parentId === DEFAULT_PAGE_ID)
    .map(getShapeBounds);
  const stepX = Math.max(180, Math.ceil(footprint.w + AUTO_PLACE_GAP));
  const stepY = Math.max(140, Math.ceil(footprint.h + AUTO_PLACE_GAP));

  for (let y = AUTO_PLACE_START.y; y < 4000; y += stepY) {
    for (let x = AUTO_PLACE_START.x; x < AUTO_PLACE_MAX_X; x += stepX) {
      const candidate = { x, y, w: footprint.w, h: footprint.h };
      if (!existing.some((bounds) => boxesOverlap(candidate, bounds))) {
        return { x, y };
      }
    }
  }

  const bottom = existing.reduce(
    (max, bounds) => Math.max(max, bounds.y + bounds.h),
    AUTO_PLACE_START.y,
  );
  return { x: AUTO_PLACE_START.x, y: bottom + AUTO_PLACE_GAP };
}

function getShapeBounds(shape: TLShape) {
  const footprint = getShapeFootprint(shape);
  return {
    x: shape.x - AUTO_PLACE_MARGIN,
    y: shape.y - AUTO_PLACE_MARGIN,
    w: footprint.w + AUTO_PLACE_MARGIN * 2,
    h: footprint.h + AUTO_PLACE_MARGIN * 2,
  };
}

function getShapeFootprint(shape: TLShape) {
  switch (shape.type) {
    case "note":
      return {
        w: NOTE_SIZE * shape.props.scale,
        h: (NOTE_SIZE + shape.props.growY) * shape.props.scale,
      };
    case "text": {
      const text = plainTextFromRichText(shape.props.richText);
      const width = shape.props.autoSize
        ? estimateTextWidth(text, getTextFontSize(shape.props), 560)
        : shape.props.w;
      return {
        w: width * shape.props.scale,
        h:
          estimateWrappedTextHeight(
            text,
            getTextFontSize(shape.props),
            width,
            0,
          ) * shape.props.scale,
      };
    }
    case "geo":
      return {
        w: shape.props.w * shape.props.scale,
        h: (shape.props.h + shape.props.growY) * shape.props.scale,
      };
    case "arrow": {
      const start = shape.props.start;
      const end = shape.props.end;
      return {
        w: Math.max(80, Math.abs(end.x - start.x) + 40),
        h: Math.max(60, Math.abs(end.y - start.y) + 40),
      };
    }
    case "image":
      return { w: shape.props.w, h: shape.props.h };
    default:
      return { w: 220, h: 140 };
  }
}

function boxesOverlap(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
) {
  return (
    a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y
  );
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
  delete next.layout;
  delete next.style;
  delete next.tone;
  return next;
}

function getLayoutHint(value: unknown): LayoutHint {
  if (
    value === "heading" ||
    value === "caption" ||
    value === "compact" ||
    value === "wide" ||
    value === "card"
  ) {
    return value;
  }
  return "auto";
}

function getStyleHint(value: unknown): StyleHint {
  return value === "muted" ||
    value === "question" ||
    value === "warning" ||
    value === "success" ||
    value === "idea"
    ? value
    : "default";
}

function getStyleProps(
  shapeType: Exclude<CanvasShapeType, "image">,
  style: StyleHint,
) {
  if (style === "default") return {};

  const palette = {
    muted: {
      text: { color: "grey" },
      note: { color: "grey", labelColor: "black" },
      geo: { color: "grey", labelColor: "black", fill: "none" },
      arrow: { color: "grey", labelColor: "black" },
    },
    question: {
      text: { color: "blue" },
      note: { color: "light-blue", labelColor: "black" },
      geo: { color: "blue", labelColor: "black", fill: "semi" },
      arrow: { color: "blue", labelColor: "black" },
    },
    warning: {
      text: { color: "red" },
      note: { color: "light-red", labelColor: "black" },
      geo: { color: "red", labelColor: "black", fill: "semi" },
      arrow: { color: "red", labelColor: "black" },
    },
    success: {
      text: { color: "green" },
      note: { color: "light-green", labelColor: "black" },
      geo: { color: "green", labelColor: "black", fill: "semi" },
      arrow: { color: "green", labelColor: "black" },
    },
    idea: {
      text: { color: "violet" },
      note: { color: "yellow", labelColor: "black" },
      geo: { color: "violet", labelColor: "black", fill: "semi" },
      arrow: { color: "violet", labelColor: "black" },
    },
  } satisfies Record<
    Exclude<StyleHint, "default">,
    Record<Exclude<CanvasShapeType, "image">, Record<string, unknown>>
  >;

  return palette[style][shapeType];
}

function getLayoutPresetProps(shapeType: CanvasShapeType, layout: LayoutHint) {
  if (layout === "auto") return {};

  const presets = {
    heading: {
      text: { size: "xl", w: 720, autoSize: false },
      note: { size: "xl", scale: 1.2 },
      geo: { w: 520, h: 120, size: "xl" },
      arrow: {},
      image: { w: 512, h: 512 },
    },
    caption: {
      text: { size: "s", w: 360, autoSize: false },
      note: { size: "s" },
      geo: { w: 240, h: 80, size: "s" },
      arrow: { size: "s" },
      image: { w: 240, h: 240 },
    },
    compact: {
      text: { size: "s", w: 260, autoSize: false },
      note: { size: "s" },
      geo: { w: 180, h: 80, size: "s" },
      arrow: { size: "s" },
      image: { w: 220, h: 220 },
    },
    wide: {
      text: { w: 560, autoSize: false },
      note: {},
      geo: { w: 520, h: 140 },
      arrow: { end: { x: 180, y: 0 } },
      image: { w: 448, h: 448 },
    },
    card: {
      text: { w: 360, autoSize: false },
      note: {},
      geo: { w: 320, h: 180, fill: "semi" },
      arrow: {},
      image: { w: 384, h: 384 },
    },
  } satisfies Record<Exclude<LayoutHint, "auto">, Record<CanvasShapeType, object>>;

  return presets[layout][shapeType];
}

function getTextLayoutProps(props: Record<string, unknown>, layout: LayoutHint) {
  const hasExplicitWidth = isFiniteNumber(props.w);
  const hasExplicitAutoSize = typeof props.autoSize === "boolean";
  const text = getPlainTextFromProps(props);

  if (hasExplicitWidth && !hasExplicitAutoSize) {
    return { autoSize: false };
  }

  if (!text || layout !== "auto" || hasExplicitAutoSize || hasExplicitWidth) {
    return {};
  }

  const lineStats = getTextStats(text);
  if (lineStats.longestLine <= 22 && lineStats.lineCount === 1) return {};

  return {
    autoSize: false,
    w: estimateTextWidth(text, getTextFontSize(props), 560),
  };
}

function getNoteLayoutProps(props: Record<string, unknown>, layout: LayoutHint) {
  const text = getPlainTextFromProps(props);
  if (!text) return {};

  const hasExplicitGrowY = isFiniteNumber(props.growY);
  const hasExplicitFontSizeAdjustment = isFiniteNumber(props.fontSizeAdjustment);
  const fontSize = getNoteFontSize(props, layout);
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

function getGeoLayoutProps(props: Record<string, unknown>, layout: LayoutHint) {
  const text = getPlainTextFromProps(props);
  if (!text || layout !== "auto") return {};

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

function getTextFontSize(props: { size?: unknown }) {
  return TEXT_FONT_SIZES[getSize(props)];
}

function getLabelFontSize(props: { size?: unknown }) {
  return LABEL_FONT_SIZES[getSize(props)];
}

function getNoteFontSize(props: { size?: unknown }, layout: LayoutHint) {
  if (props.size === undefined) {
    if (layout === "caption" || layout === "compact") return LABEL_FONT_SIZES.s;
    if (layout === "heading") return LABEL_FONT_SIZES.xl;
  }
  return getLabelFontSize(props);
}

function getSize(props: { size?: unknown }): keyof typeof LABEL_FONT_SIZES {
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
