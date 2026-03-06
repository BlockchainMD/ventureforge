const colors: Record<string, string> = {
  RUNNING: "bg-blue-100 text-blue-800",
  COMPLETED: "bg-green-100 text-green-800",
  FAILED: "bg-red-100 text-red-800",
  PAUSED: "bg-amber-100 text-amber-800",
  PENDING: "bg-gray-100 text-gray-600",
};

export default function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
        colors[status] ?? colors.PENDING
      }`}
    >
      {status}
    </span>
  );
}
