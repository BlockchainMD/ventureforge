import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { RoundResponse } from "@/api/types";
import ScoreBar from "./ScoreBar";

export default function RoundDetail({ round }: { round: RoundResponse }) {
  const [open, setOpen] = useState(false);
  const scores = round.scores as {
    dimension_scores?: Array<{
      dimension: string;
      score: number;
    }>;
    composite_score?: number;
  };

  return (
    <div className="border rounded-lg bg-white">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm hover:bg-gray-50"
      >
        <div className="flex items-center gap-2">
          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          <span className="font-medium">Round {round.round_number}</span>
          {round.decision && (
            <span
              className={`text-xs px-2 py-0.5 rounded ${
                round.decision === "advance"
                  ? "bg-green-100 text-green-700"
                  : round.decision === "escalate"
                    ? "bg-red-100 text-red-700"
                    : "bg-blue-100 text-blue-700"
              }`}
            >
              {round.decision}
            </span>
          )}
        </div>
        {scores?.composite_score != null && (
          <span className="text-xs text-gray-500">
            {scores.composite_score.toFixed(2)}
          </span>
        )}
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-3">
          {scores?.dimension_scores?.map((d) => (
            <ScoreBar key={d.dimension} score={d.score} label={d.dimension} />
          ))}
          {round.decision_rationale && (
            <p className="text-xs text-gray-500 mt-2">
              {round.decision_rationale}
            </p>
          )}
          {round.duration_seconds != null && (
            <p className="text-xs text-gray-400">
              {round.duration_seconds.toFixed(1)}s
            </p>
          )}
        </div>
      )}
    </div>
  );
}
