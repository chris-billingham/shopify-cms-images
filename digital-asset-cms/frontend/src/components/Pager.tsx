export function Pager({ page, total, limit, onChange }: {
  page: number;
  total: number;
  limit: number;
  onChange: (p: number) => void;
}) {
  const totalPages = Math.ceil(total / limit);
  if (totalPages <= 1) return null;

  const windowSize = 5;
  const half = Math.floor(windowSize / 2);
  let start = Math.max(1, page - half);
  const end = Math.min(totalPages, start + windowSize - 1);
  if (end - start < windowSize - 1) start = Math.max(1, end - windowSize + 1);
  const pages = Array.from({ length: end - start + 1 }, (_, i) => start + i);

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 4,
      marginTop: 20,
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: 12,
    }}>
      <button className="btn-sketch sm" onClick={() => onChange(page - 1)} disabled={page <= 1}>
        ← prev
      </button>

      {start > 1 && (
        <>
          <button className="btn-sketch sm" onClick={() => onChange(1)}>1</button>
          {start > 2 && <span style={{ color: 'var(--ink-soft)', padding: '0 2px' }}>…</span>}
        </>
      )}

      {pages.map((p) => (
        <button
          key={p}
          className={`btn-sketch sm${p === page ? ' primary' : ''}`}
          onClick={() => onChange(p)}
          aria-current={p === page ? 'page' : undefined}
        >
          {p}
        </button>
      ))}

      {end < totalPages && (
        <>
          {end < totalPages - 1 && <span style={{ color: 'var(--ink-soft)', padding: '0 2px' }}>…</span>}
          <button className="btn-sketch sm" onClick={() => onChange(totalPages)}>{totalPages}</button>
        </>
      )}

      <button className="btn-sketch sm" onClick={() => onChange(page + 1)} disabled={page >= totalPages}>
        next →
      </button>

      <span style={{ marginLeft: 8, color: 'var(--ink-soft)' }}>
        page {page} of {totalPages}
      </span>
    </div>
  );
}
