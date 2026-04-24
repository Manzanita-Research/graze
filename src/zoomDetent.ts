/**
 * Decide whether the zoom-detent snap-to-100% should fire.
 *
 * The detent only fires when the zoom CROSSES 1 (user wheel/pinch zoom), not
 * merely when it enters a band around 1. Firing on proximity alone used to
 * cancel programmatic camera animations that started at z=1 — the first frame
 * (e.g. z=1.003) would fall inside the band, the detent would `setCamera({ z:1
 * }, { immediate: true })`, and that immediate call would cancel the animation
 * leaving x/y frozen at frame-1 progress.
 *
 * `snappedAt100` is hysteresis: it blocks re-snapping while zoom is still
 * within 2× DETENT of 1 and resets once we've moved clearly away.
 */

export const ZOOM_DETENT = 0.04;

export function evaluateZoomDetent(args: {
  prevZoom: number;
  zoom: number;
  snappedAt100: boolean;
  detent?: number;
}): { shouldSnap: boolean; nextSnappedAt100: boolean } {
  const { prevZoom, zoom, snappedAt100 } = args;
  const detent = args.detent ?? ZOOM_DETENT;

  const crossed =
    (prevZoom < 1 && zoom > 1) || (prevZoom > 1 && zoom < 1);

  if (crossed && !snappedAt100) {
    return { shouldSnap: true, nextSnappedAt100: true };
  }

  if (Math.abs(zoom - 1) > detent * 2) {
    return { shouldSnap: false, nextSnappedAt100: false };
  }

  return { shouldSnap: false, nextSnappedAt100: snappedAt100 };
}
