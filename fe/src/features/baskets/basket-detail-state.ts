export type BasketDetailState = "restoring" | "disconnected" | "loading" | "error" | "indexing" | "ready";

export interface BasketDetailStateInput {
  isWalletRestoring: boolean;
  isConnected: boolean;
  isLoading: boolean;
  isError: boolean;
  isIndexed: boolean;
}

export function deriveBasketDetailState({
  isWalletRestoring,
  isConnected,
  isLoading,
  isError,
  isIndexed,
}: BasketDetailStateInput): BasketDetailState {
  if (isWalletRestoring) return "restoring";
  if (!isConnected) return "disconnected";
  if (isIndexed) return "ready";
  if (isLoading) return "loading";
  if (isError) return "error";
  return "indexing";
}
