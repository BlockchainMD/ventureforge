import { AlertTriangle } from "lucide-react";

export default function ErrorAlert({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
      <AlertTriangle className="h-4 w-4 flex-shrink-0" />
      {message}
    </div>
  );
}
