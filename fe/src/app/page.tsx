import Link from "next/link";
import { OthelioLogo } from "@/components/brand/OthelioLogo";
import HeroEmblem from "@/components/HeroEmblem";
import StockLogo from "@/components/StockLogo";
import WavesBackground from "@/components/WavesBackground";
import styles from "./landing.module.css";

const holdings = [
  { symbol: "NVDA", weight: "40%" },
  { symbol: "AAPL", weight: "30%" },
  { symbol: "MSFT", weight: "20%" },
  { symbol: "USDC", weight: "10%" },
];

function Arrow() {
  return <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M3 10h13M11 4l6 6-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

export default function Home() {
  return (
    <main className={styles.landing}>
      <WavesBackground />
      <header className={styles.header}>
        <Link href="/" className={styles.wordmark} aria-label="Othelio home"><OthelioLogo size={28} aria-hidden="true" /><span>Othelio</span></Link>
        <Link href="/app" className={styles.headerLink}>Open app <Arrow /></Link>
      </header>

      <section className={styles.hero} aria-labelledby="hero-title">
        <div className={styles.heroCopy}>
          <h1 id="hero-title">Build the <span>basket</span><br />{" "}you want to own.</h1>
        </div>
        <div className={styles.heroVisual}>
          <HeroEmblem />
        </div>
      </section>
      <a className={styles.scrollCue} href="#inside">Look inside the basket <span>↓</span></a>

      <section className={styles.inside} id="inside" aria-labelledby="inside-title">
        <div className={styles.insideCopy}>
          <div className={styles.sectionRule} />
          <h2 id="inside-title">One token.<br /><span>Every position visible.</span></h2>
          <p>Your basket has its own holdings and allocation. See what sits beneath the token, then change the mix when you choose.</p>
          <Link href="/app" className={styles.textAction}>Explore Othelio <Arrow /></Link>
        </div>
        <div className={styles.holdings}>
          <div className={styles.holdingsHeader}>
            <div className={styles.holdingsMark}><OthelioLogo size={30} aria-hidden="true" /></div>
            <div><span>INSIDE A BASKET</span><strong>Illustrative composition</strong></div>
            <span className={styles.holdingsTotal}>100%</span>
          </div>
          <div className={styles.holdingsList}>
            {holdings.map(({ symbol, weight }, index) => (
              <div className={styles.holding} key={symbol}>
                <span className={styles.holdingIcon}>
                  <StockLogo symbol={symbol} size={32} roundedFull />
                </span>
                <span className={styles.holdingSymbol}>{symbol}</span>
                <strong>{weight}</strong>
              </div>
            ))}
          </div>
          <div className={styles.holdingsFoot}><span>THE MIX IS YOURS TO DEFINE</span><span>↗</span></div>
        </div>
      </section>

      <section className={styles.closing} aria-labelledby="closing-title">
        <OthelioLogo size={68} aria-hidden="true" />
        <h2 id="closing-title">Own the mix.</h2>
        <Link href="/app" className={styles.primaryAction}>Build your basket <Arrow /></Link>
      </section>
      <footer className={styles.footer}>
        <span>© Othelio</span>
        <p>Illustrative assets and allocations. Company marks are for identification only. Availability depends on network and eligibility.</p>
      </footer>
    </main>
  );
}
