function gaugeColor(score: number): string {
  if (score >= 0.85) return "text-green-500";
  if (score >= 0.7) return "text-blue-500";
  if (score >= 0.5) return "text-amber-500";
  return "text-red-500";
}

export default function QualityGauge({
  score,
  size = 80,
}: {
  score: number;
  size?: number;
}) {
  const r = (size - 8) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - Math.min(score, 1));

  return (
    <div className="inline-flex flex-col items-center">
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth={6}
          className="text-gray-200"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth={6}
          strokeDasharray={circ}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className={gaugeColor(score)}
        />
      </svg>
      <span className={`text-sm font-semibold mt-1 ${gaugeColor(score)}`}>
        {(score * 100).toFixed(0)}%
      </span>
    </div>
  );
}
