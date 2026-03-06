import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { OpportunityBrief } from "@/api/types";
import StatusBadge from "./StatusBadge";
import ScoreBar from "./ScoreBar";

type SortKey = "title" | "composite_score" | "status";

export default function OpportunityTable({
  opportunities,
}: {
  opportunities: OpportunityBrief[];
}) {
  const [sortKey, setSortKey] = useState<SortKey>("composite_score");
  const [sortAsc, setSortAsc] = useState(false);
  const navigate = useNavigate();

  const sorted = [...opportunities].sort((a, b) => {
    const va = a[sortKey];
    const vb = b[sortKey];
    const cmp = typeof va === "number" ? va - (vb as number) : String(va).localeCompare(String(vb));
    return sortAsc ? cmp : -cmp;
  });

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else {
      setSortKey(key);
      setSortAsc(false);
    }
  };

  const cols: { key: SortKey; label: string }[] = [
    { key: "title", label: "Title" },
    { key: "composite_score", label: "Score" },
    { key: "status", label: "Status" },
  ];

  return (
    <table className="w-full">
      <thead>
        <tr className="border-b text-left">
          {cols.map((c) => (
            <th
              key={c.key}
              onClick={() => toggleSort(c.key)}
              className="px-4 py-2 text-xs font-medium text-gray-500 uppercase cursor-pointer hover:text-gray-700"
            >
              {c.label} {sortKey === c.key && (sortAsc ? "^" : "v")}
            </th>
          ))}
          <th className="px-4 py-2 text-xs font-medium text-gray-500 uppercase">
            Problem Space
          </th>
          <th className="px-4 py-2" />
        </tr>
      </thead>
      <tbody>
        {sorted.map((opp) => (
          <tr key={opp.id} className="border-b hover:bg-gray-50">
            <td className="px-4 py-3 text-sm font-medium">{opp.title}</td>
            <td className="px-4 py-3 w-48">
              <ScoreBar score={opp.composite_score} />
            </td>
            <td className="px-4 py-3">
              <StatusBadge status={opp.status} />
            </td>
            <td className="px-4 py-3 text-sm text-gray-500 max-w-xs truncate">
              {opp.problem_space}
            </td>
            <td className="px-4 py-3">
              <button
                onClick={() =>
                  navigate("/new", { state: { fromOpportunity: opp } })
                }
                className="text-xs text-blue-600 hover:underline"
              >
                Build
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
