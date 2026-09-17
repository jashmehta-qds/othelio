import { useAccount } from "wagmi";
import { useHydrated } from "@/hooks/useHydrated";

/** True only while the browser is restoring a persisted wallet connection. */
export function useWalletRestoring() {
  const isHydrated = useHydrated();
  const { isConnecting, isReconnecting } = useAccount();

  return !isHydrated || isConnecting || isReconnecting;
}
