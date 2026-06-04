/** UsageChart — simple bar chart showing per-model usage. */

export default function UsageChart({ keys = [] }) {
  if (keys.length === 0) {
    return (
      <div className="text-center py-8 text-base-content/50">
        <p>No usage data available</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {keys.map((key) => (
        <div key={key.id} className="flex items-center gap-3">
          <span className="text-xs font-mono w-24 truncate">
            sk-...{key.key_suffix}
          </span>
          <div className="flex-1">
            <progress
              className="progress progress-primary w-full"
              value={key.is_active ? 25 : 100}
              max="100"
            />
          </div>
          <span className="text-xs text-base-content/50 w-12 text-right">
            {key.is_active ? 'Active' : 'Revoked'}
          </span>
        </div>
      ))}
    </div>
  );
}
