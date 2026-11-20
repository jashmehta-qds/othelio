import styles from "./MarketIntro.module.css";

export function MarketIntro({ kind }: { kind: "protected" | "upside" }) {
  const protectedMarket = kind === "protected";
  return (
    <section className={styles.intro} aria-label="How these markets work">
      <div className={styles.topline}>ONE STOCK. TWO WAYS TO PARTICIPATE.</div>
      <h2>
        {protectedMarket
          ? "Less growth, more priority. Or more upside."
          : "Trade the move above a price you choose."}
      </h2>
      <div className={styles.choices}>
        <div className={styles.choice}>
          <span className={styles.marker} aria-hidden="true">
            {protectedMarket ? "01" : "↑"}
          </span>
          <div>
            <h3>{protectedMarket ? "Protected" : "Upside"}</h3>
            <p>
              {protectedMarket
                ? "Gets first share of the stock’s value at lower prices."
                : "Receives the stock’s value above your target at the end. Below the target? Zero."}
            </p>
          </div>
        </div>
        <div className={styles.choice}>
          <span className={styles.marker} aria-hidden="true">
            {protectedMarket ? "02" : "="}
          </span>
          <div>
            <h3>{protectedMarket ? "Upside" : "Protected Value"}</h3>
            <p>
              {protectedMarket
                ? "Gets more value as the stock rises. Can finish with nothing if the price is too low."
                : "Receives the stock’s value up to the target. This is the other side, not a bet that the stock falls."}
            </p>
          </div>
        </div>
      </div>
      <ol className={styles.steps}>
        <li>
          <span>1</span> Pick a stock
        </li>
        <li>
          <span>2</span> Choose your side
        </li>
        <li>
          <span>3</span> Preview your trade
        </li>
      </ol>
    </section>
  );
}
