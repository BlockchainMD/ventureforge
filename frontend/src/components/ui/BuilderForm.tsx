import { useState } from "react";
import type { BuilderInput, OpportunityThesis } from "@/api/types";

const emptyThesis: OpportunityThesis = {
  title: "",
  one_liner: "",
  problem_statement: "",
  solution_concept: "",
  why_now: "",
  why_agentic: "",
  market_signal: "",
  moat_hypothesis: "",
  biggest_risk: "",
  comparable_companies: [],
  recommended_first_customer: "",
};

export default function BuilderForm({
  onSubmit,
  disabled,
  initialThesis,
}: {
  onSubmit: (input: BuilderInput) => void;
  disabled: boolean;
  initialThesis?: Partial<OpportunityThesis>;
}) {
  const [mode, setMode] = useState<"form" | "json">("form");
  const [thesis, setThesis] = useState<OpportunityThesis>({
    ...emptyThesis,
    ...initialThesis,
  });
  const [jsonText, setJsonText] = useState("");
  const [depth, setDepth] = useState<"mvp" | "full" | "investor_ready">(
    "investor_ready"
  );
  const [founderContext, setFounderContext] = useState("");

  const update = (key: keyof OpportunityThesis, value: string) =>
    setThesis((t) => ({ ...t, [key]: value }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const opp = mode === "json" ? JSON.parse(jsonText) : thesis;
    onSubmit({
      opportunity: opp,
      depth,
      founder_context: founderContext || undefined,
    });
  };

  const fields: { key: keyof OpportunityThesis; label: string }[] = [
    { key: "title", label: "Title" },
    { key: "one_liner", label: "One Liner" },
    { key: "problem_statement", label: "Problem Statement" },
    { key: "solution_concept", label: "Solution Concept" },
    { key: "why_now", label: "Why Now" },
    { key: "why_agentic", label: "Why Agentic" },
    { key: "market_signal", label: "Market Signal" },
    { key: "moat_hypothesis", label: "Moat Hypothesis" },
    { key: "biggest_risk", label: "Biggest Risk" },
  ];

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="flex gap-2 mb-4">
        <button
          type="button"
          onClick={() => setMode("form")}
          className={`px-3 py-1 text-sm rounded-md ${
            mode === "form"
              ? "bg-gray-900 text-white"
              : "bg-gray-100 text-gray-600"
          }`}
        >
          Form
        </button>
        <button
          type="button"
          onClick={() => setMode("json")}
          className={`px-3 py-1 text-sm rounded-md ${
            mode === "json"
              ? "bg-gray-900 text-white"
              : "bg-gray-100 text-gray-600"
          }`}
        >
          JSON
        </button>
      </div>

      {mode === "json" ? (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Paste OpportunityThesis JSON
          </label>
          <textarea
            value={jsonText}
            onChange={(e) => setJsonText(e.target.value)}
            rows={12}
            className="w-full border rounded-md px-3 py-2 text-sm font-mono"
            placeholder='{"title": "...", "one_liner": "...", ...}'
          />
        </div>
      ) : (
        <>
          {fields.map(({ key, label }) => (
            <div key={key}>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {label}
              </label>
              {key === "problem_statement" || key === "solution_concept" ? (
                <textarea
                  value={String(thesis[key] ?? "")}
                  onChange={(e) => update(key, e.target.value)}
                  rows={3}
                  className="w-full border rounded-md px-3 py-2 text-sm"
                />
              ) : (
                <input
                  type="text"
                  value={String(thesis[key] ?? "")}
                  onChange={(e) => update(key, e.target.value)}
                  className="w-full border rounded-md px-3 py-2 text-sm"
                />
              )}
            </div>
          ))}
        </>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Depth
          </label>
          <select
            value={depth}
            onChange={(e) =>
              setDepth(e.target.value as "mvp" | "full" | "investor_ready")
            }
            className="w-full border rounded-md px-3 py-2 text-sm"
          >
            <option value="mvp">MVP</option>
            <option value="full">Full</option>
            <option value="investor_ready">Investor Ready</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Founder Context (optional)
          </label>
          <input
            type="text"
            value={founderContext}
            onChange={(e) => setFounderContext(e.target.value)}
            className="w-full border rounded-md px-3 py-2 text-sm"
          />
        </div>
      </div>

      <button
        type="submit"
        disabled={disabled}
        className="w-full bg-blue-600 text-white rounded-md px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
      >
        Start Builder
      </button>
    </form>
  );
}
