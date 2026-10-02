import { formatUnits } from "viem";
import type { PositionSnapshot } from "@/types/shared";
import { supportedAssets, type Holding } from "./baskets";

export function currentHoldingsFromSnapshot(snapshot: PositionSnapshot | undefined): Holding[] | null {
  if (!snapshot || snapshot.readCompleteness !== "COMPLETE" || !["COMPLETE", "STALE"].includes(snapshot.valuationStatus)) return null;
  return snapshot.tokens.flatMap((token): Holding[] => {
    if (token.liquidAmountBaseUnits === null || token.priceUsdE8 === null) return [];
    const amount = BigInt(token.liquidAmountBaseUnits);
    if (amount <= BigInt(0)) return [];
    const quantity = Number(formatUnits(amount, token.decimals));
    const value = Number(formatUnits(amount * BigInt(token.priceUsdE8) / BigInt(10) ** BigInt(token.decimals), 8));
    const meta = supportedAssets.find((asset) => asset.address?.toLowerCase() === token.assetAddress.toLowerCase());
    const symbol = meta?.symbol ?? token.symbol ?? `${token.assetAddress.slice(0, 6)}…`;
    return [{
      address: token.assetAddress,
      symbol,
      name: meta?.name ?? symbol,
      target: 0,
      current: 0,
      quantity,
      value,
      color: meta?.color ?? "#8aa4ff",
    }];
  });
}

export function liveAllocation(holdings: Holding[], snapshot: PositionSnapshot | undefined): Holding[] | null {
  if (!snapshot || snapshot.readCompleteness !== "COMPLETE" || !["COMPLETE", "STALE"].includes(snapshot.valuationStatus) || holdings.length === 0) {
    return null;
  }

  const positions = new Map<string, { valueUsdE8: bigint; quantity: number; symbol?: string }>();
  let totalUsdE8 = BigInt(0);
  for (const token of snapshot.tokens) {
    if (token.liquidAmountBaseUnits === null) return null;
    const amount = BigInt(token.liquidAmountBaseUnits);
    if (amount > BigInt(0) && token.priceUsdE8 === null) return null;
    const valueUsdE8 = amount * BigInt(token.priceUsdE8 ?? "0") / BigInt(10) ** BigInt(token.decimals);
    positions.set(token.assetAddress.toLowerCase(), {
      valueUsdE8,
      quantity: Number(formatUnits(amount, token.decimals)),
      symbol: token.symbol,
    });
    totalUsdE8 += valueUsdE8;
  }
  if (totalUsdE8 === BigInt(0)) return null;

  const weightOf = (valueUsdE8: bigint) => Number(valueUsdE8 * BigInt(1_000_000) / totalUsdE8) / 10_000;
  const targetAddresses = new Set(holdings.map((holding) => holding.address?.toLowerCase()));
  const configured = holdings.map((holding) => {
    const position = holding.address ? positions.get(holding.address.toLowerCase()) : undefined;
    const valueUsdE8 = position?.valueUsdE8 ?? BigInt(0);
    return {
      ...holding,
      current: weightOf(valueUsdE8),
      quantity: position?.quantity ?? 0,
      value: Number(formatUnits(valueUsdE8, 8)),
    };
  });
  const unconfigured = snapshot.tokens.flatMap((token): Holding[] => {
    if (targetAddresses.has(token.assetAddress.toLowerCase())) return [];
    const position = positions.get(token.assetAddress.toLowerCase());
    if (!position || position.valueUsdE8 === BigInt(0)) return [];
    const metadata = supportedAssets.find((asset) => asset.address?.toLowerCase() === token.assetAddress.toLowerCase());
    const symbol = metadata?.symbol ?? position.symbol ?? `${token.assetAddress.slice(0, 6)}…`;
    return [{
      address: token.assetAddress,
      symbol,
      name: metadata?.name ?? symbol,
      target: 0,
      current: weightOf(position.valueUsdE8),
      quantity: position.quantity,
      value: Number(formatUnits(position.valueUsdE8, 8)),
      color: metadata?.color ?? "#8aa4ff",
    }];
  });
  const allocation = [...configured, ...unconfigured];
  const largestCurrent = allocation.reduce((largest, holding, index) =>
    holding.current > allocation[largest].current ? index : largest, 0);
  const roundedTotal = allocation.reduce((sum, holding) => sum + holding.current, 0);
  allocation[largestCurrent].current += 100 - roundedTotal;
  return allocation;
}
