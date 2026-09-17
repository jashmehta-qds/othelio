export const WALLET_REQUEST_REJECTED_MESSAGE =
  "Transaction cancelled. Nothing was created and no funds moved.";

type WalletErrorLike = {
  code?: unknown;
  message?: unknown;
  cause?: WalletErrorLike;
};

function errorDetails(error: unknown): WalletErrorLike | null {
  return typeof error === "object" && error !== null ? (error as WalletErrorLike) : null;
}

export function isWalletRequestRejected(error: unknown): boolean {
  let current = errorDetails(error);

  while (current) {
    if (current.code === 4001) return true;

    if (typeof current.message === "string") {
      const message = current.message.toLowerCase();
      if (
        message.includes("user rejected") ||
        message.includes("user denied") ||
        message.includes("user cancelled") ||
        message.includes("user canceled")
      ) {
        return true;
      }
    }

    current = errorDetails(current.cause);
  }

  return false;
}

export function walletActionError(error: unknown, fallback: string): string {
  if (isWalletRequestRejected(error)) return WALLET_REQUEST_REJECTED_MESSAGE;
  return error instanceof Error ? error.message : fallback;
}
