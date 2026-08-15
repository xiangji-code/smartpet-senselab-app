export function clampIntensity(value: number, max: number): number {
  return Math.max(1, Math.min(max, Math.round(value)));
}

export function intensityFromHorizontalPosition(
  position: number,
  width: number,
  max: number,
): number {
  if (width <= 0) return 1;
  return clampIntensity((position / width) * max, max);
}
