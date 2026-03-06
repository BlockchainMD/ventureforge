import { useOpportunities } from "@/hooks/useOpportunities";
import OpportunityTable from "@/components/ui/OpportunityTable";
import LoadingSpinner from "@/components/ui/LoadingSpinner";
import EmptyState from "@/components/ui/EmptyState";
import ErrorAlert from "@/components/ui/ErrorAlert";

export default function Opportunities() {
  const { data: opportunities, loading, error } = useOpportunities();

  return (
    <div>
      <h1 className="text-xl font-semibold mb-6">Opportunities</h1>

      {error && <ErrorAlert message={error.message} />}
      {loading ? (
        <LoadingSpinner />
      ) : !opportunities || opportunities.length === 0 ? (
        <EmptyState message="No opportunities found. Run a screener to discover opportunities." />
      ) : (
        <div className="bg-white rounded-lg border overflow-hidden">
          <OpportunityTable opportunities={opportunities} />
        </div>
      )}
    </div>
  );
}
