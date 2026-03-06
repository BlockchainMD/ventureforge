import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { OpportunityThesis } from "@/api/types";

const fields: { key: keyof OpportunityThesis; label: string }[] = [
  { key: "one_liner", label: "One Liner" },
  { key: "problem_statement", label: "Problem" },
  { key: "solution_concept", label: "Solution" },
  { key: "why_now", label: "Why Now" },
  { key: "why_agentic", label: "Why Agentic" },
  { key: "market_signal", label: "Market Signal" },
  { key: "moat_hypothesis", label: "Moat" },
  { key: "biggest_risk", label: "Biggest Risk" },
  { key: "recommended_first_customer", label: "First Customer" },
];

export default function ThesisViewer({
  thesis,
}: {
  thesis: OpportunityThesis;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border rounded-lg bg-white">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-4 py-3 text-sm font-medium hover:bg-gray-50"
      >
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        {thesis.title}
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-2">
          {fields.map(({ key, label }) => {
            const val = thesis[key];
            if (!val || (Array.isArray(val) && val.length === 0)) return null;
            return (
              <div key={key}>
                <span className="text-xs font-medium text-gray-500">
                  {label}
                </span>
                <p className="text-sm text-gray-700">
                  {Array.isArray(val) ? val.join(", ") : String(val)}
                </p>
              </div>
            );
          })}
          {thesis.comparable_companies &&
            thesis.comparable_companies.length > 0 && (
              <div>
                <span className="text-xs font-medium text-gray-500">
                  Comparables
                </span>
                <p className="text-sm text-gray-700">
                  {thesis.comparable_companies.join(", ")}
                </p>
              </div>
            )}
        </div>
      )}
    </div>
  );
}
