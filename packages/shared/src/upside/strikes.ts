export function gridFloor(value: bigint, tick: bigint): bigint {
  return value / tick * tick;
}

export function gridCeil(value: bigint, tick: bigint): bigint {
  return gridFloor(value + tick - 1n, tick);
}

export function upsidePresetStrikes(reference: bigint, move: bigint, tick: bigint): bigint[] {
  if (reference <= 0n || move <= 0n || tick <= 0n) return [];
  const nearest = (value: bigint) => gridFloor(value + tick / 2n, tick) || tick;
  return [reference, reference + move / 2n, reference + move, reference + move * 2n].map(nearest);
}
