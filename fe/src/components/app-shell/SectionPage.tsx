export function SectionPage({ title, description }: { title: string; description: string }) {
  return <section className="basket-index flow-page"><header><h1>{title}</h1><p>{description}</p></header><div className="empty-surface"><strong>Preview environment</strong><p>This workspace is ready for its domain data and actions to be connected.</p></div></section>;
}
