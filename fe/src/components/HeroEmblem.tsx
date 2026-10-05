import { OthelioLogo } from "@/components/brand/OthelioLogo";
import IndexField from "@/components/IndexField";
import LiveIndexCounter from "@/components/LiveIndexCounter";
import styles from "./heroEmblem.module.css";

export default function HeroEmblem() {
  return (
    <div className={styles.scene}>
      <div className={styles.emblem}>
        <span className={styles.fallback} aria-hidden="true"><OthelioLogo size="100%" /></span>
        <IndexField />
        <div className={styles.price} aria-label="Illustrative OTHL price animation">
          <div className={styles.priceLine}>
            <span>OTHL</span>
            <LiveIndexCounter initialValue={104.28} />
            <small>USD</small>
          </div>
        </div>
      </div>
    </div>
  );
}
