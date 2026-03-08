import { useMemo } from "react";
import { useLessons } from "@/hooks/useLessons";
import LoadingSpinner from "@/components/ui/LoadingSpinner";
import EmptyState from "@/components/ui/EmptyState";
import ErrorAlert from "@/components/ui/ErrorAlert";
import { formatDistanceToNow } from "date-fns";
import { parseUTC } from "@/api/utils";

export default function Lessons() {
  const { data: lessons, loading, error } = useLessons();

  const grouped = useMemo(() => {
    if (!lessons) return {};
    return lessons.reduce(
      (acc, l) => {
        (acc[l.category] ??= []).push(l);
        return acc;
      },
      {} as Record<string, typeof lessons>
    );
  }, [lessons]);

  return (
    <div>
      <h1 className="text-xl font-semibold mb-6">Lessons</h1>

      {error && <ErrorAlert message={error.message} />}
      {loading ? (
        <LoadingSpinner />
      ) : !lessons || lessons.length === 0 ? (
        <EmptyState message="No lessons accumulated yet. Lessons are learned from completed runs." />
      ) : (
        <div className="space-y-6">
          {Object.entries(grouped).map(([category, items]) => (
            <div key={category}>
              <h2 className="text-sm font-medium text-gray-500 uppercase mb-3">
                {category}
              </h2>
              <div className="space-y-2">
                {items.map((lesson) => (
                  <div
                    key={lesson.id}
                    className="bg-white border rounded-lg p-4"
                  >
                    <p className="text-sm text-gray-800">{lesson.insight}</p>
                    <div className="flex items-center gap-3 mt-2">
                      {lesson.applies_to.map((tag) => (
                        <span
                          key={tag}
                          className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded"
                        >
                          {tag}
                        </span>
                      ))}
                      <span className="text-xs text-gray-400">
                        {formatDistanceToNow(parseUTC(lesson.created_at), {
                          addSuffix: true,
                        })}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
