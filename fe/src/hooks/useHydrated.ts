import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/** Keeps SSR and the first client render on the same pre-hydration snapshot. */
export function useHydrated() {
  return useSyncExternalStore(subscribe, () => true, () => false);
}
