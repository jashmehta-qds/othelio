export function SectionPage({ title, description }: { title: string; description: string }) {
  return <section className="app-page-frame"><header><h1 className="page-title">{title}</h1><p className="page-description">{description}</p></header><div className="empty-surface"><strong>Preview environment</strong><p>This workspace is ready for its domain data and actions to be connected.</p></div></section>;
}
