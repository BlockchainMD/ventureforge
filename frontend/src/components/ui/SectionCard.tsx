import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { PhaseResponse } from "@/api/types";
import StatusBadge from "./StatusBadge";
import QualityGauge from "./QualityGauge";

export default function SectionCard({ phase }: { phase: PhaseResponse }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border rounded-lg bg-white">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50"
      >
        <div className="flex items-center gap-2">
          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          <span className="text-sm font-medium">{phase.phase_name}</span>
          <StatusBadge status={phase.status} />
        </div>
        {phase.quality_score != null && phase.quality_score > 0 && (
          <QualityGauge score={phase.quality_score} size={32} />
        )}
      </button>
      {open && (
        <div className="px-4 pb-4 text-sm text-gray-600">
          <div className="flex gap-4 text-xs text-gray-500">
            <span>{phase.round_count} rounds</span>
            {phase.started_at && (
              <span>
                Started: {new Date(phase.started_at).toLocaleString()}
              </span>
            )}
            {phase.completed_at && (
              <span>
                Completed: {new Date(phase.completed_at).toLocaleString()}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
