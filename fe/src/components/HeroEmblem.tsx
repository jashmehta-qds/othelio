import { OthelioLogo } from "@/components/brand/OthelioLogo";
import IndexField from "@/components/IndexField";
import LiveIndexCounter from "@/components/LiveIndexCounter";
import styles from "./heroEmblem.module.css";

interface HeroEmblemProps {
  nav?: number;
  symbol?: string;
  className?: string;
}

export default function HeroEmblem({ nav, symbol = "OTHL", className = "" }: HeroEmblemProps) {
  return (
    <div className={`${styles.scene} ${className}`}>
      <div className={styles.emblem}>
        <span className={styles.fallback} aria-hidden="true">
          <OthelioLogo size="100%" />
        </span>
        <IndexField />
        <div className={styles.price} aria-label="Illustrative OTHL price animation">
          <div className={styles.priceLine}>
            <span>{symbol}</span>
            <LiveIndexCounter initialValue={nav ?? 104.28} value={nav} />
            <small>USD</small>
          </div>
        </div>
      </div>
    </div>
  );
}
