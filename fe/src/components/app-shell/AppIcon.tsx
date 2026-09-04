export type AppNavId = "overview" | "baskets" | "activity" | "agents" | "settings";

export function AppIcon({ type }: { type: AppNavId | "arrow" | "plus" | "lock" }) {
  const paths: Record<string, React.ReactNode> = {
    overview: <><path d="M4 10.5 12 4l8 6.5"/><path d="M6.5 9.5V20h11V9.5M10 20v-6h4v6"/></>,
    baskets: <><path d="m12 3 8 4.5-8 4.5-8-4.5L12 3Z"/><path d="m4 12 8 4.5 8-4.5M4 16.5l8 4.5 8-4.5"/></>,
    activity: <path d="M4 12h3l2-5 4 10 2-5h5"/>,
    agents: <><circle cx="12" cy="8" r="3"/><path d="M5 20c.7-4 3-6 7-6s6.3 2 7 6"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1"/></>,
    arrow: <path d="M5 12h14M14 7l5 5-5 5"/>,
    plus: <path d="M12 5v14M5 12h14"/>,
    lock: <><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></>,
  };
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{paths[type]}</svg>;
}
