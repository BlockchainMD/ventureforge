import { useState } from "react";
import type { ScreenerInput } from "@/api/types";

export default function ScreenerForm({
  onSubmit,
  disabled,
}: {
  onSubmit: (input: ScreenerInput) => void;
  disabled: boolean;
}) {
  const [domain, setDomain] = useState("");
  const [constraints, setConstraints] = useState("");
  const [antiPatterns, setAntiPatterns] = useState("");
  const [maxCandidates, setMaxCandidates] = useState(8);
  const [qualityThreshold, setQualityThreshold] = useState(0.82);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      domain: domain || undefined,
      constraints: constraints
        ? constraints.split(",").map((s) => s.trim())
        : [],
      anti_patterns: antiPatterns
        ? antiPatterns.split(",").map((s) => s.trim())
        : [],
      max_candidates: maxCandidates,
      quality_threshold: qualityThreshold,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Domain (optional)
        </label>
        <input
          type="text"
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          placeholder="e.g. healthcare, fintech, legal"
          className="w-full border rounded-md px-3 py-2 text-sm"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Constraints (comma-separated)
        </label>
        <input
          type="text"
          value={constraints}
          onChange={(e) => setConstraints(e.target.value)}
          placeholder="e.g. B2B only, SaaS model"
          className="w-full border rounded-md px-3 py-2 text-sm"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Anti-patterns (comma-separated)
        </label>
        <input
          type="text"
          value={antiPatterns}
          onChange={(e) => setAntiPatterns(e.target.value)}
          placeholder="e.g. marketplace, hardware"
          className="w-full border rounded-md px-3 py-2 text-sm"
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Max Candidates
          </label>
          <input
            type="number"
            value={maxCandidates}
            onChange={(e) => setMaxCandidates(Number(e.target.value))}
            min={1}
            max={20}
            className="w-full border rounded-md px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Quality Threshold
          </label>
          <input
            type="number"
            value={qualityThreshold}
            onChange={(e) => setQualityThreshold(Number(e.target.value))}
            min={0}
            max={1}
            step={0.01}
            className="w-full border rounded-md px-3 py-2 text-sm"
          />
        </div>
      </div>
      <button
        type="submit"
        disabled={disabled}
        className="w-full bg-blue-600 text-white rounded-md px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
      >
        Start Screener
      </button>
    </form>
  );
}
