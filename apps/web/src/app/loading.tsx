export default function Loading() {
  return (
    <div className="container" aria-busy="true" aria-label="Loading">
      <div className="skeleton" style={{ height: 70, margin: "35px 0" }} />
      <div className="card-grid">
        {[1, 2, 3, 4].map((i) => (
          <div className="skeleton" key={i} />
        ))}
      </div>
    </div>
  );
}
