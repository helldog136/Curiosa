import { resolveIcon } from "@/core/icons";

export function EntryIcon({ icon, className = "h-5 w-5" }: { icon: string | null; className?: string }) {
  const resolved = resolveIcon(icon);
  if (!resolved) return null;
  if ("text" in resolved) return <span aria-hidden="true" className="text-lg leading-none">{resolved.text}</span>;
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d={resolved.svg} />
    </svg>
  );
}
