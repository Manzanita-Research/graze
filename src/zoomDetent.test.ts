import { describe, expect, test } from "bun:test";
import { ZOOM_DETENT, evaluateZoomDetent } from "./zoomDetent";

describe("evaluateZoomDetent", () => {
  test("snaps when user zoom crosses from below 1 to above 1", () => {
    const r = evaluateZoomDetent({
      prevZoom: 0.9,
      zoom: 1.05,
      snappedAt100: false,
    });
    expect(r.shouldSnap).toBe(true);
    expect(r.nextSnappedAt100).toBe(true);
  });

  test("snaps when user zoom crosses from above 1 to below 1", () => {
    const r = evaluateZoomDetent({
      prevZoom: 1.1,
      zoom: 0.98,
      snappedAt100: false,
    });
    expect(r.shouldSnap).toBe(true);
    expect(r.nextSnappedAt100).toBe(true);
  });

  // The bug this feature fixes: a programmatic camera animation starting at
  // z=1 and heading toward z=2 produces intermediate frames like 1.003 that
  // fall inside the old near-100 detent band. The old code snapped here and
  // killed the in-flight animation. The new code must NOT snap because
  // prevZoom === 1 (no crossing).
  test("does not snap on animation frame near 1 when starting at 1 (regression guard)", () => {
    const r = evaluateZoomDetent({
      prevZoom: 1,
      zoom: 1.003,
      snappedAt100: false,
    });
    expect(r.shouldSnap).toBe(false);
    expect(r.nextSnappedAt100).toBe(false);
  });

  test("does not snap on an early animation frame heading from 1 toward 2", () => {
    const r = evaluateZoomDetent({
      prevZoom: 1.003,
      zoom: 1.01,
      snappedAt100: false,
    });
    expect(r.shouldSnap).toBe(false);
    expect(r.nextSnappedAt100).toBe(false);
  });

  test("does not re-snap when already snappedAt100", () => {
    const r = evaluateZoomDetent({
      prevZoom: 0.95,
      zoom: 1.02,
      snappedAt100: true,
    });
    expect(r.shouldSnap).toBe(false);
    expect(r.nextSnappedAt100).toBe(true);
  });

  test("resets snappedAt100 once zoom moves beyond 2× DETENT from 1", () => {
    const r = evaluateZoomDetent({
      prevZoom: 1.05,
      zoom: 1.2,
      snappedAt100: true,
    });
    expect(r.shouldSnap).toBe(false);
    expect(r.nextSnappedAt100).toBe(false);
  });

  test("does not reset snappedAt100 while still inside the hysteresis band", () => {
    const r = evaluateZoomDetent({
      prevZoom: 1.0,
      zoom: 1.05,
      snappedAt100: true,
    });
    expect(r.shouldSnap).toBe(false);
    expect(r.nextSnappedAt100).toBe(true);
  });

  test("does not snap when no crossing occurs near but not across 1", () => {
    // old near100 trigger would fire here; new code must not.
    const r = evaluateZoomDetent({
      prevZoom: 0.99,
      zoom: 0.98,
      snappedAt100: false,
    });
    expect(r.shouldSnap).toBe(false);
    expect(r.nextSnappedAt100).toBe(false);
  });

  test("does snap for a wheel-zoom crossing from 0.5 to 1.05 in one frame", () => {
    const r = evaluateZoomDetent({
      prevZoom: 0.5,
      zoom: 1.05,
      snappedAt100: false,
    });
    expect(r.shouldSnap).toBe(true);
    expect(r.nextSnappedAt100).toBe(true);
  });

  test("exports DETENT = 0.04", () => {
    expect(ZOOM_DETENT).toBe(0.04);
  });
});
