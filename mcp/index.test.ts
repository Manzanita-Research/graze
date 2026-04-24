import { describe, expect, test } from "bun:test";
import * as z from "zod/v4";

// Regression: Zod v4's z.object({}) strips unknown keys, which previously
// caused the MCP update_shape / create_shape tools to silently drop every
// caller-supplied prop. The fix is to use z.looseObject({}) on the `props`
// field so caller keys are preserved and forwarded to the Bun server.
describe("props schema shape for update_shape / create_shape", () => {
  test("z.object({}) strips unknown keys (documents the bug)", () => {
    const strict = z.object({});
    expect(strict.parse({ color: "red", size: "xl" })).toEqual({});
  });

  test("z.looseObject({}) preserves unknown keys", () => {
    const loose = z.looseObject({});
    expect(loose.parse({ color: "red", size: "xl" })).toEqual({
      color: "red",
      size: "xl",
    });
  });

  test("z.looseObject({}) preserves nested / heterogeneous prop payloads", () => {
    const loose = z.looseObject({});
    const payload = {
      w: 140,
      h: 100,
      geo: "rectangle",
      color: "green",
      fill: "solid",
      nested: { foo: ["bar", 1, true] },
    };
    expect(loose.parse(payload)).toEqual(payload);
  });
});
