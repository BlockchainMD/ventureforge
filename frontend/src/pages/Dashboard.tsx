import { Link } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { PlusCircle } from "lucide-react";
import { useRuns } from "@/hooks/useRuns";
import { parseUTC } from "@/api/utils";
import StatusBadge from "@/components/ui/StatusBadge";
import LoadingSpinner from "@/components/ui/LoadingSpinner";
import EmptyState from "@/components/ui/EmptyState";
import ErrorAlert from "@/components/ui/ErrorAlert";

export default function Dashboard() {
  const { runs, loading, error } = useRuns();

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">Runs</h1>
        <Link
          to="/new"
          className="flex items-center gap-1 bg-blue-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-blue-700"
        >
          <PlusCircle size={16} />
          New Run
        </Link>
      </div>

      {error && <ErrorAlert message={error.message} />}
      {loading && !runs.length ? (
        <LoadingSpinner />
      ) : runs.length === 0 ? (
        <EmptyState message="No runs yet. Start a screener or builder run." />
      ) : (
        <div className="bg-white rounded-lg border overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b bg-gray-50 text-left">
                <th className="px-4 py-2 text-xs font-medium text-gray-500 uppercase">
                  ID
                </th>
                <th className="px-4 py-2 text-xs font-medium text-gray-500 uppercase">
                  Type
                </th>
                <th className="px-4 py-2 text-xs font-medium text-gray-500 uppercase">
                  Status
                </th>
                <th className="px-4 py-2 text-xs font-medium text-gray-500 uppercase">
                  Phase
                </th>
                <th className="px-4 py-2 text-xs font-medium text-gray-500 uppercase">
                  Started
                </th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id} className="border-b hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <Link
                      to={`/runs/${run.id}`}
                      className="text-sm font-mono text-blue-600 hover:underline"
                    >
                      {run.id.slice(0, 8)}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-sm capitalize">
                    {run.run_type}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={run.status} />
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {run.current_phase ?? "-"}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {formatDistanceToNow(parseUTC(run.created_at), {
                      addSuffix: true,
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
