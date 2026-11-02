import Link from "next/link";
import { OthelioLogo } from "@/components/brand/OthelioLogo";
import HeroEmblem from "@/components/HeroEmblem";
import WavesBackground from "@/components/WavesBackground";
import LiveRebalanceHoldings from "@/components/landing/LiveRebalanceHoldings";
import styles from "./landing.module.css";

function Arrow() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M3 10h13M11 4l6 6-6 6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function Home() {
  return (
    <main className={styles.landing}>
      <WavesBackground />
      <header className={styles.header}>
        <Link href="/" className={styles.wordmark} aria-label="Othelio home">
          <OthelioLogo size={28} aria-hidden="true" />
          <span>Othelio</span>
        </Link>
        <Link href="/app" className={styles.headerLink}>
          Open app <Arrow />
        </Link>
      </header>

      {/* Hero Section */}
      <section className={styles.hero} aria-labelledby="hero-title">
        <div className={styles.heroCopy}>
          <h1 id="hero-title">
            Own, Transform & Trade
            <br />
          </h1>
          <p className={styles.heroSubtitle}>
            Personalize tokenized equities with configurable flavors.
            <br />
            Hold the mix you believe in, rebalance with one click, or operate via agents.
          </p>
          <Link href="/app" className={styles.primaryAction}>
            Build your basket <Arrow />
          </Link>
        </div>
        <div className={styles.heroVisual}>
          <HeroEmblem />
        </div>
      </section>

      <a className={styles.scrollCue} href="#inside">
        Look inside the basket <span>↓</span>
      </a>

      {/* Look Inside Section with Live Rebalance Story */}
      <section className={styles.inside} id="inside" aria-labelledby="inside-title">
        <div className={styles.insideCopy}>
          <div className={styles.sectionRule} />
          <h2 id="inside-title">
            One token.
            <br />
            <span>Every position visible.</span>
          </h2>
          <p>
            Your basket has its own holdings and allocation. See what sits beneath the token,
            then change the mix when you choose.
          </p>
          <Link href="/app" className={styles.textAction}>
            Explore Othelio <Arrow />
          </Link>
        </div>
        <LiveRebalanceHoldings />
      </section>

      {/* Closing CTA */}
      <section className={styles.closing} aria-labelledby="closing-title">
        <OthelioLogo size={68} aria-hidden="true" />
        <h2 id="closing-title">Own the mix.</h2>
        <Link href="/app" className={styles.primaryAction}>
          Build your basket <Arrow />
        </Link>
      </section>

      <footer className={styles.footer}>
        <span>© Othelio</span>
        <p>
          Illustrative assets and allocations. Company marks are for identification only.
          Availability depends on network and eligibility.
        </p>
      </footer>
    </main>
  );
}
