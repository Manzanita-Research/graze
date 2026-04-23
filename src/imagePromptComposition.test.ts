import { describe, expect, test } from "bun:test";
import {
  buildPromptFromSelection,
  isTextOnlySelection,
} from "./imagePromptComposition";

describe("isTextOnlySelection", () => {
  test("returns false for empty selection", () => {
    expect(isTextOnlySelection([])).toBe(false);
  });

  test("returns true when every shape is text or note", () => {
    expect(
      isTextOnlySelection([{ type: "text" }, { type: "note" }, { type: "note" }]),
    ).toBe(true);
  });

  test("returns false when any shape is not text/note (draw)", () => {
    expect(
      isTextOnlySelection([{ type: "note" }, { type: "draw" }]),
    ).toBe(false);
  });

  test("returns false when any shape is geo or arrow", () => {
    expect(isTextOnlySelection([{ type: "geo" }])).toBe(false);
    expect(
      isTextOnlySelection([{ type: "text" }, { type: "arrow" }]),
    ).toBe(false);
  });
});

describe("buildPromptFromSelection", () => {
  test("joins shape texts with \\n\\n when typed prompt is empty", () => {
    expect(buildPromptFromSelection("", ["hello", "world"])).toBe("hello\n\nworld");
  });

  test("prepends typed prompt before shape texts joined by \\n\\n", () => {
    expect(
      buildPromptFromSelection("render as watercolor", ["hello", "world"]),
    ).toBe("render as watercolor\n\nhello\n\nworld");
  });

  test("returns just the typed prompt when selection text is empty", () => {
    expect(buildPromptFromSelection("a red apple", [])).toBe("a red apple");
  });

  test("trims whitespace-only entries out of the output", () => {
    expect(buildPromptFromSelection("  ", ["  ", "hello", ""])).toBe("hello");
  });

  test("preserves shape text order", () => {
    expect(
      buildPromptFromSelection("", ["first", "second", "third"]),
    ).toBe("first\n\nsecond\n\nthird");
  });
});
