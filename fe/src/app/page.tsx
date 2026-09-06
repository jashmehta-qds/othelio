import Link from "next/link";
import IndexField from "@/components/IndexField";
import LiveIndexCounter from "@/components/LiveIndexCounter";

export default function Home() {
  return (
    <main className="quiet-home">
      <header className="quiet-nav">
        <Link href="/" className="quiet-wordmark" aria-label="Othelio home">Othelio</Link>
        <Link href="/app" className="quiet-launch">Launch App</Link>
      </header>

      <section className="quiet-hero-grid" aria-labelledby="quiet-title">
        <div className="hero-left-content">
          <h1 id="quiet-title">Build the <span className="text-[#DBFF75]">basket</span><br />you want to own.</h1>
        </div>

        <div className="hero-right-animation">
          <div className="liquid-o-container" aria-label="Othelio Liquid Metal O emblem">
            <IndexField />
            <div className="index-value-overlay" aria-label="Othelio index reference price live counter">
              <span>OTHL</span>
              <LiveIndexCounter initialValue={104.28} />
              <small>USD</small>
            </div>
          </div>
        </div>
      </section>

      <footer className="quiet-footer">
        <p>Markets are given.<br />Baskets are chosen.</p>
        <span>© Othelio</span>
      </footer>
    </main>
  );
}
