import { Link } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import StatusBadge from "./StatusBadge";
import type { RunResponse } from "@/api/types";

export default function RunCard({ run }: { run: RunResponse }) {
  return (
    <Link
      to={`/runs/${run.id}`}
      className="block hover:bg-gray-50 transition-colors"
    >
      <tr className="contents">
        <td className="px-4 py-3 text-sm font-mono text-gray-500">
          {run.id.slice(0, 8)}
        </td>
        <td className="px-4 py-3 text-sm capitalize">{run.run_type}</td>
        <td className="px-4 py-3">
          <StatusBadge status={run.status} />
        </td>
        <td className="px-4 py-3 text-sm text-gray-500">
          {run.current_phase ?? "-"}
        </td>
        <td className="px-4 py-3 text-sm text-gray-500">
          {formatDistanceToNow(new Date(run.created_at), { addSuffix: true })}
        </td>
      </tr>
    </Link>
  );
}
