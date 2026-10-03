export type ActivityTargetWeight = { assetAddress: string; weightBps: number };
export type ActivityAllocationChange = ActivityTargetWeight & { previousWeightBps: number | null };

type ActivityAllocationPayload = {
  soldAssets?: unknown;
  boughtAssets?: unknown;
  acquiredAssets?: unknown;
  targetWeights?: unknown;
};

export function touchedTargetWeights(payload: ActivityAllocationPayload): ActivityTargetWeight[] {
  const sold = Array.isArray(payload.soldAssets) ? payload.soldAssets : [];
  const bought = Array.isArray(payload.boughtAssets)
    ? payload.boughtAssets
    : Array.isArray(payload.acquiredAssets) ? payload.acquiredAssets : [];
  const touched = new Set([...sold, ...bought].map((address) => String(address).toLowerCase()));
  if (!Array.isArray(payload.targetWeights)) return [];

  return payload.targetWeights.filter((item): item is ActivityTargetWeight =>
    Boolean(
      item
      && typeof item === "object"
      && "assetAddress" in item
      && typeof item.assetAddress === "string"
      && "weightBps" in item
      && typeof item.weightBps === "number"
      && touched.has(item.assetAddress.toLowerCase()),
    ));
}

export function allocationChangesForActivity(
  payload: ActivityAllocationPayload,
  olderPayloads: ActivityAllocationPayload[],
): ActivityAllocationChange[] {
  return touchedTargetWeights(payload).map((target) => {
    let previousWeightBps: number | null = null;

    for (const olderPayload of olderPayloads) {
      if (!Array.isArray(olderPayload.targetWeights)) continue;
      const previousTarget = olderPayload.targetWeights.find((item) =>
        Boolean(
          item
          && typeof item === "object"
          && "assetAddress" in item
          && typeof item.assetAddress === "string"
          && item.assetAddress.toLowerCase() === target.assetAddress.toLowerCase()
          && "weightBps" in item
          && typeof item.weightBps === "number",
        ));
      if (!previousTarget || typeof previousTarget !== "object" || !("weightBps" in previousTarget)) continue;
      previousWeightBps = previousTarget.weightBps as number;
      break;
    }

    return { ...target, previousWeightBps };
  });
}
