import type { PhaseResponse } from "@/api/types";
import StatusBadge from "./StatusBadge";
import QualityGauge from "./QualityGauge";

export default function PhaseTimeline({
  phases,
  selectedPhase,
  onSelect,
}: {
  phases: PhaseResponse[];
  selectedPhase: string | null;
  onSelect: (name: string) => void;
}) {
  return (
    <div className="space-y-1">
      {phases.map((p, i) => (
        <button
          key={p.id}
          onClick={() => onSelect(p.phase_name)}
          className={`w-full text-left p-3 rounded-lg border transition-colors ${
            selectedPhase === p.phase_name
              ? "border-blue-300 bg-blue-50"
              : "border-gray-200 bg-white hover:border-gray-300"
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="flex items-center justify-center w-6 h-6 rounded-full bg-gray-100 text-xs font-medium text-gray-600">
                {i + 1}
              </span>
              <span className="text-sm font-medium">{p.phase_name}</span>
            </div>
            <StatusBadge status={p.status} />
          </div>
          <div className="flex items-center justify-between mt-2 ml-8">
            <span className="text-xs text-gray-500">
              {p.round_count} round{p.round_count !== 1 && "s"}
            </span>
            {p.quality_score != null && p.quality_score > 0 && (
              <QualityGauge score={p.quality_score} size={36} />
            )}
          </div>
        </button>
      ))}
    </div>
  );
}
