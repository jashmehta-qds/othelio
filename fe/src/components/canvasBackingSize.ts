type CanvasLayout = Pick<HTMLCanvasElement, "clientWidth" | "clientHeight">;

// CSS transforms affect getBoundingClientRect(), but not the canvas's layout size.
export function canvasBackingSize(canvas: CanvasLayout, devicePixelRatio: number): number {
  const dpr = Math.min(devicePixelRatio || 1, 1.8);
  return Math.round(Math.min(canvas.clientWidth, canvas.clientHeight) * dpr);
}
