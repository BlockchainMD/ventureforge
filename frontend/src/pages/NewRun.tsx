import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { startScreener, startBuilder } from "@/api/client";
import type { ScreenerInput, BuilderInput } from "@/api/types";
import ScreenerForm from "@/components/ui/ScreenerForm";
import BuilderForm from "@/components/ui/BuilderForm";
import ErrorAlert from "@/components/ui/ErrorAlert";

export default function NewRun() {
  const [tab, setTab] = useState<"screener" | "builder">("screener");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const fromOpp = (location.state as { fromOpportunity?: Record<string, unknown> })?.fromOpportunity;

  const handleScreener = async (input: ScreenerInput) => {
    setSubmitting(true);
    setError(null);
    try {
      const run = await startScreener(input);
      navigate(`/runs/${run.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start screener");
    } finally {
      setSubmitting(false);
    }
  };

  const handleBuilder = async (input: BuilderInput) => {
    setSubmitting(true);
    setError(null);
    try {
      const run = await startBuilder(input);
      navigate(`/runs/${run.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start builder");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-semibold mb-6">New Run</h1>

      <div className="flex gap-2 mb-6">
        <button
          onClick={() => setTab("screener")}
          className={`px-4 py-2 text-sm font-medium rounded-md ${
            tab === "screener"
              ? "bg-gray-900 text-white"
              : "bg-gray-100 text-gray-600 hover:bg-gray-200"
          }`}
        >
          Screener
        </button>
        <button
          onClick={() => setTab("builder")}
          className={`px-4 py-2 text-sm font-medium rounded-md ${
            tab === "builder"
              ? "bg-gray-900 text-white"
              : "bg-gray-100 text-gray-600 hover:bg-gray-200"
          }`}
        >
          Builder
        </button>
      </div>

      {error && (
        <div className="mb-4">
          <ErrorAlert message={error} />
        </div>
      )}

      {tab === "screener" ? (
        <ScreenerForm onSubmit={handleScreener} disabled={submitting} />
      ) : (
        <BuilderForm
          onSubmit={handleBuilder}
          disabled={submitting}
          initialThesis={fromOpp as Record<string, string> | undefined}
        />
      )}
    </div>
  );
}
