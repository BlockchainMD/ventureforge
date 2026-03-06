import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, Pause, Play, Trash2 } from "lucide-react";
import { useRun } from "@/hooks/useRun";
import { usePhases } from "@/hooks/usePhases";
import { useRounds } from "@/hooks/useRounds";
import { pauseRun, resumeRun, deleteRun } from "@/api/client";
import StatusBadge from "@/components/ui/StatusBadge";
import PhaseTimeline from "@/components/ui/PhaseTimeline";
import RoundDetail from "@/components/ui/RoundDetail";
import ExportMenu from "@/components/ui/ExportMenu";
import LoadingSpinner from "@/components/ui/LoadingSpinner";
import ErrorAlert from "@/components/ui/ErrorAlert";

export default function RunDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { run, error, loading, polling } = useRun(id!);
  const { data: phases } = usePhases(id!, polling);
  const [selectedPhase, setSelectedPhase] = useState<string | null>(null);
  const { data: rounds } = useRounds(
    id!,
    selectedPhase ?? "",
    !!selectedPhase && polling
  );

  if (loading && !run) return <LoadingSpinner />;
  if (error) return <ErrorAlert message={error.message} />;
  if (!run) return <ErrorAlert message="Run not found" />;

  const isActive = run.status === "RUNNING" || run.status === "PENDING";

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Link to="/" className="text-gray-400 hover:text-gray-600">
            <ArrowLeft size={20} />
          </Link>
          <h1 className="text-xl font-semibold font-mono">
            {run.id.slice(0, 8)}
          </h1>
          <StatusBadge status={run.status} />
          <span className="text-sm text-gray-500 capitalize">
            {run.run_type}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {run.status === "RUNNING" && (
            <button
              onClick={() => pauseRun(run.id)}
              className="flex items-center gap-1 px-3 py-1.5 text-sm border rounded-md hover:bg-gray-50"
            >
              <Pause size={14} />
              Pause
            </button>
          )}
          {run.status === "PAUSED" && (
            <button
              onClick={() => resumeRun(run.id)}
              className="flex items-center gap-1 px-3 py-1.5 text-sm border rounded-md hover:bg-gray-50"
            >
              <Play size={14} />
              Resume
            </button>
          )}
          {!isActive && <ExportMenu runId={run.id} />}
          <button
            onClick={async () => {
              await deleteRun(run.id);
              window.location.href = "/";
            }}
            className="flex items-center gap-1 px-3 py-1.5 text-sm border border-red-200 text-red-600 rounded-md hover:bg-red-50"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {polling && (
        <div className="mb-4 text-xs text-blue-600 bg-blue-50 px-3 py-1.5 rounded-md inline-block">
          Live polling active
        </div>
      )}

      <div className="grid grid-cols-3 gap-6">
        <div>
          <h2 className="text-sm font-medium text-gray-500 mb-3 uppercase">
            Phases
          </h2>
          {phases && phases.length > 0 ? (
            <PhaseTimeline
              phases={phases}
              selectedPhase={selectedPhase}
              onSelect={setSelectedPhase}
            />
          ) : (
            <p className="text-sm text-gray-400">Waiting for phases...</p>
          )}
        </div>

        <div className="col-span-2">
          {selectedPhase ? (
            <div>
              <h2 className="text-sm font-medium text-gray-500 mb-3 uppercase">
                Rounds - {selectedPhase}
              </h2>
              {rounds && rounds.length > 0 ? (
                <div className="space-y-2">
                  {rounds.map((r) => (
                    <RoundDetail key={r.id} round={r} />
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-400">No rounds yet.</p>
              )}
            </div>
          ) : (
            <div className="text-sm text-gray-400 py-8 text-center">
              Select a phase to view rounds and scores
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
