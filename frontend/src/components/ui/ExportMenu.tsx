import { useState, useRef, useEffect } from "react";
import { Download } from "lucide-react";
import { getExportUrl } from "@/api/client";

export default function ExportMenu({ runId }: { runId: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const formats = ["json", "pdf", "docx"] as const;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 px-3 py-1.5 text-sm bg-white border rounded-md hover:bg-gray-50"
      >
        <Download size={14} />
        Export
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-32 bg-white border rounded-md shadow-lg z-10">
          {formats.map((f) => (
            <a
              key={f}
              href={getExportUrl(runId, f)}
              download
              className="block px-3 py-2 text-sm hover:bg-gray-50"
              onClick={() => setOpen(false)}
            >
              {f.toUpperCase()}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
