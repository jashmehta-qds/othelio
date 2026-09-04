export function BasketLogo({ name, size = "default" }: { name: string; size?: "small" | "default" }) {
  return <span className={`basket-mark${size === "small" ? " basket-mark-small" : ""}`} role="img" aria-label={`${name} basket`}><span/><span/></span>;
}
