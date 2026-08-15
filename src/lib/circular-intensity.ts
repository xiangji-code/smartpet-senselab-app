const FULL_CIRCLE = Math.PI * 2;

export function clampIntensity(value: number, max: number): number {
  return Math.max(1, Math.min(max, Math.round(value)));
}

export function intensityProgress(value: number, max: number): number {
  if (max <= 0) return 0;
  return clampIntensity(value, max) / max;
}

export function intensityFromPoint(
  x: number,
  y: number,
  size: number,
  max: number,
  currentValue: number,
): number {
  const center = size / 2;
  const offsetX = x - center;
  const offsetY = y - center;

  if (Math.hypot(offsetX, offsetY) < size * 0.2) {
    return clampIntensity(currentValue, max);
  }

  const clockwiseFromBottom = (Math.atan2(offsetY, offsetX) - Math.PI / 2 + FULL_CIRCLE) % FULL_CIRCLE;
  return clampIntensity((clockwiseFromBottom / FULL_CIRCLE) * max, max);
}
