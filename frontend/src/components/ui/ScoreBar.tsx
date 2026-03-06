function scoreColor(score: number): string {
  if (score >= 8) return "bg-green-500";
  if (score >= 6) return "bg-blue-500";
  if (score >= 4) return "bg-amber-500";
  return "bg-red-500";
}

export default function ScoreBar({
  score,
  max = 10,
  label,
}: {
  score: number;
  max?: number;
  label?: string;
}) {
  const pct = Math.min((score / max) * 100, 100);
  return (
    <div className="flex items-center gap-2">
      {label && (
        <span className="text-xs text-gray-500 w-28 truncate">{label}</span>
      )}
      <div className="flex-1 bg-gray-200 rounded-full h-2">
        <div
          className={`h-2 rounded-full ${scoreColor(score)}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs font-medium text-gray-600 w-8 text-right">
        {score.toFixed(1)}
      </span>
    </div>
  );
}
