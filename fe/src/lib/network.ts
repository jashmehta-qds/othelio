import { base, foundry } from "wagmi/chains";

/** Display metadata comes from the configured wagmi chain definitions. */
export function networkLabelForChainId(chainId: number): string {
  if (chainId === foundry.id) return foundry.name;
  if (chainId === base.id) return base.name;
  return `Chain ${chainId}`;
}
