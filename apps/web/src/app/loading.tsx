export default function Loading() {
  return (
    <div className="container loading" aria-busy="true">
      <div className="skeleton skeleton-heading" />
      <div className="card-grid" aria-hidden="true">
        {[1, 2, 3].map((i) => (
          <div className="skeleton skeleton-card" key={i} />
        ))}
      </div>
    </div>
  );
}
