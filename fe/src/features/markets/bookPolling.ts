export type BookPollingMode = "live" | "preview";

// Only the selected book needs trading-speed updates. Cards and unselected
// claims are previews; errors should not turn either mode into a retry storm.
export function bookPollingOptions(mode: BookPollingMode) {
  const interval = mode === "live" ? 15_000 : 30_000;
  return {
    staleTime: interval - 1_000,
    retry: false,
    refetchInterval: (query: { state: { error: unknown } }) =>
      query.state.error ? 30_000 : interval,
    refetchIntervalInBackground: false,
  };
}
