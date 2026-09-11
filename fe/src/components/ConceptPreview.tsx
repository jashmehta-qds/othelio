import Link from "next/link";
import { OthelioLogo } from "@/components/brand/OthelioLogo";
import IndexConcept from "@/components/IndexConcept";

export default function ConceptPreview({ concept }: { concept: "alloy" | "lens" }) {
  return (
    <main className="concept-page">
      <header>
        <Link href="/" style={{ display: "inline-flex", alignItems: "center", gap: "10px", textDecoration: "none", color: "inherit" }}>
          <OthelioLogo size={24} />
          <span>Othelio</span>
        </Link>
        <nav>
          <Link className={concept === "alloy" ? "active" : ""} href="/concepts/alloy">01 Living alloy</Link>
          <Link className={concept === "lens" ? "active" : ""} href="/concepts/lens">02 Index lens</Link>
        </nav>
      </header>
      <section>
        <h1>Build the basket<br />you want to own.</h1>
        <div className="concept-art">
          <IndexConcept concept={concept} />
          <span>{concept === "alloy" ? "One body. Rebalanced within." : "Many signals. One index."}</span>
        </div>
      </section>
      <footer>
        <span>Motion study / {concept}</span>
        <Link href="/app">Launch app ↗</Link>
      </footer>
    </main>
  );
}

