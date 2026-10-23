import type { ReactNode } from "react";
import { AppIcon } from "@/components/app-shell/AppIcon";

export function State({ title, description, action, tone = "empty" }: {
  title: string; description?: string; action?: ReactNode; tone?: "empty" | "loading" | "error";
}) {
  return <div className="ui-state" data-tone={tone} role={tone === "error" ? "alert" : "status"} aria-busy={tone === "loading"}>
    <span className="ui-state-icon"><AppIcon type={tone === "error" ? "alert" : tone === "loading" ? "sync" : "baskets"} /></span>
    <h2>{title}</h2>{description && <p>{description}</p>}{action && <div className="ui-state-action">{action}</div>}
  </div>;
}
