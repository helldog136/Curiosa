import { HelpTip } from "./HelpTip";
import type { NetHealthView } from "@/core/netHealthText";

/** Colour of the dot of each problem of an external service (block `netHealth`). */
const NET_DOT = { slow: "bg-warning", rate: "bg-warning", quota: "bg-warning", down: "bg-danger" } as const;

/**
 * The `netHealth` block (R33): shown only when a service has a problem, one line per problem, the detail in the "?" bubble. A healthy state is not shown at all
 * (the caller does not render this component for an empty view).
 */
export function NetHealthNote({ view }: { view: NetHealthView }) {
  return (
    <section data-testid="net-health" className="flex items-start gap-2 rounded-field border-token border-warning p-3 text-sm" role="status" aria-label={view.title}>
      <ul className="min-w-0 flex-1 space-y-1.5">
        {view.lines.map((l) => (
          <li key={`${l.host}-${l.label}`} className="flex items-start gap-2">
            <span aria-hidden="true" className={`mt-1.5 inline-block h-2 w-2 shrink-0 rounded-chip ${NET_DOT[l.state]}`} />
            <span className="min-w-0 break-words">{l.text}</span>
          </li>
        ))}
      </ul>
      <HelpTip help={view.hint} name={view.title} always />
    </section>
  );
}
