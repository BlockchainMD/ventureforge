import type { PhaseResponse } from "@/api/types";
import SectionCard from "./SectionCard";

export default function BlueprintViewer({
  phases,
}: {
  phases: PhaseResponse[];
}) {
  return (
    <div className="space-y-2">
      {phases.map((p) => (
        <SectionCard key={p.id} phase={p} />
      ))}
    </div>
  );
}
