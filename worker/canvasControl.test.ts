import { describe, expect, test } from "bun:test";
import type { TLRecord } from "@tldraw/tlschema";
import {
  createCanvasShape,
  deleteCanvasShapes,
  getCanvasShapes,
  updateCanvasShape,
  type RoomStore,
} from "./canvasControl";

function createStore(): RoomStore {
  const records = new Map<string, TLRecord>();
  return {
    get: (id) => records.get(id) ?? null,
    getAll: () => [...records.values()],
    put: (record) => {
      records.set(record.id, record);
    },
    delete: (recordOrId) => {
      records.delete(typeof recordOrId === "string" ? recordOrId : recordOrId.id);
    },
  };
}

describe("authoritative canvas control helpers", () => {
  test("creates a complete note shape without a browser client", () => {
    const store = createStore();

    const shape = createCanvasShape(store, {
      id: "agent-note",
      type: "note",
      x: 40,
      y: 50,
      props: { richText: "hello", color: "light-violet" },
    });

    expect(shape.id).toBe("shape:agent-note");
    expect(shape.type).toBe("note");
    expect(shape.x).toBe(40);
    expect(shape.y).toBe(50);
    expect(getCanvasShapes(store).map((s) => s.id)).toEqual([
      "shape:agent-note",
    ]);
  });

  test("creates one shape per command even when called repeatedly", () => {
    const store = createStore();

    createCanvasShape(store, { id: "a", type: "geo" });
    createCanvasShape(store, { id: "b", type: "geo" });

    expect(getCanvasShapes(store).map((s) => s.id)).toEqual([
      "shape:a",
      "shape:b",
    ]);
  });

  test("updates and deletes by caller-facing suffix id", () => {
    const store = createStore();
    createCanvasShape(store, {
      id: "box",
      type: "geo",
      props: { w: 100, color: "black" },
    });

    const updated = updateCanvasShape(store, {
      shapeId: "box",
      props: { color: "red" },
    });
    expect(updated?.props).toMatchObject({ w: 100, color: "red" });

    const deleted = deleteCanvasShapes(store, { shapeIds: ["box"] });
    expect(deleted).toEqual(["shape:box"]);
    expect(getCanvasShapes(store)).toHaveLength(0);
  });

  test("image creation also writes the required asset record", () => {
    const store = createStore();

    const shape = createCanvasShape(store, {
      id: "img-1",
      type: "image",
      props: {
        url: "/api/uploads/u1",
        w: 384,
        h: 384,
        nativeW: 1024,
        nativeH: 1024,
      },
    });

    expect(shape.type).toBe("image");
    const records = store.getAll();
    expect(records.some((record) => record.typeName === "asset")).toBe(true);
    expect(records.some((record) => record.id === "shape:img-1")).toBe(true);
  });

  test("long text shapes get a fixed wrapping width instead of one-line autosize", () => {
    const store = createStore();

    const shape = createCanvasShape(store, {
      id: "long-text",
      type: "text",
      props: {
        richText:
          "Text label: lightweight headings, captions, and annotations.",
      },
    });

    expect(shape.type).toBe("text");
    expect(shape.props.autoSize).toBe(false);
    expect(shape.props.w).toBeGreaterThan(300);
    expect(shape.props.w).toBeLessThanOrEqual(560);
  });

  test("explicit text width opts into wrapping without replacing caller width", () => {
    const store = createStore();

    const shape = createCanvasShape(store, {
      id: "fixed-text",
      type: "text",
      props: {
        w: 240,
        richText: "A deliberately wrapped caption.",
      },
    });

    expect(shape.type).toBe("text");
    expect(shape.props.autoSize).toBe(false);
    expect(shape.props.w).toBe(240);
  });

  test("long note text gets growY so it does not spill below the sticky", () => {
    const store = createStore();

    const shape = createCanvasShape(store, {
      id: "long-note",
      type: "note",
      props: {
        richText:
          "Smoke test complete: note, text, geo, arrow, update existing shape, delete temporary shape.",
      },
    });

    expect(shape.type).toBe("note");
    expect(shape.props.growY).toBeGreaterThan(0);
  });

  test("labeled geo shapes expand defaults to fit their text", () => {
    const store = createStore();

    const shape = createCanvasShape(store, {
      id: "labeled-geo",
      type: "geo",
      props: {
        richText:
          "Smoke matrix: create note/text/geo/arrow/update existing shape/delete temporary",
        fill: "semi",
      },
    });

    expect(shape.type).toBe("geo");
    expect(shape.props.w).toBeGreaterThan(200);
    expect(shape.props.h).toBeGreaterThanOrEqual(100);
    expect(shape.props.growY).toBe(0);
  });

  test("omitted coordinates auto-place new shapes away from existing shapes", () => {
    const store = createStore();

    const first = createCanvasShape(store, {
      id: "auto-a",
      type: "note",
      props: { richText: "first" },
    });
    const second = createCanvasShape(store, {
      id: "auto-b",
      type: "note",
      props: { richText: "second" },
    });

    expect(first.x).toBe(120);
    expect(first.y).toBe(120);
    expect({ x: second.x, y: second.y }).not.toEqual({
      x: first.x,
      y: first.y,
    });
  });

  test("recreating an existing shape id preserves its position when x/y are omitted", () => {
    const store = createStore();

    createCanvasShape(store, {
      id: "stable",
      type: "text",
      x: 345,
      y: 456,
      props: { richText: "before" },
    });
    const recreated = createCanvasShape(store, {
      id: "stable",
      type: "text",
      props: { richText: "after" },
    });

    expect(recreated.x).toBe(345);
    expect(recreated.y).toBe(456);
  });

  test("layout and style hints choose useful defaults without leaking into props", () => {
    const store = createStore();

    const heading = createCanvasShape(store, {
      id: "heading",
      type: "text",
      layout: "heading",
      style: "idea",
      props: { richText: "A useful heading" },
    });

    expect(heading.type).toBe("text");
    expect(heading.props.size).toBe("xl");
    expect(heading.props.w).toBe(720);
    expect(heading.props.autoSize).toBe(false);
    expect(heading.props.color).toBe("violet");
    expect("layout" in heading.props).toBe(false);
    expect("style" in heading.props).toBe(false);
  });

  test("props-level layout and style hints are accepted and stripped", () => {
    const store = createStore();

    const card = createCanvasShape(store, {
      id: "card",
      type: "geo",
      props: {
        layout: "card",
        style: "warning",
        richText: "Needs attention",
      },
    });

    expect(card.type).toBe("geo");
    expect(card.props.w).toBe(320);
    expect(card.props.h).toBe(180);
    expect(card.props.color).toBe("red");
    expect(card.props.fill).toBe("semi");
    expect("layout" in card.props).toBe(false);
    expect("style" in card.props).toBe(false);
  });
});
