"use client";

import { useRouter } from "next/navigation";
import { ModalWindow } from "./ModalWindow";
import { type ModalSize } from "./modalWidth";

/**
 * Window above the page for an intercepted route (catalogue details, settings of an extension): closing goes back to the previous page, so the list keeps its
 * search, its filter and its position. Look and behaviour (Esc, click beside, focus kept inside and returned to the opener, full screen on a phone) come from
 * `ModalWindow`, shared with the edit dialog of module lists.
 */
export function RouteModal({ children, label, closeLabel, testid = "route-modal", size = "wide" }: { children: React.ReactNode; /** Name of the window for screen readers. */ label: string; closeLabel: string; testid?: string; size?: ModalSize }) {
  const router = useRouter();
  return <ModalWindow label={label} closeLabel={closeLabel} testid={testid} size={size} onClose={() => router.back()}>{children}</ModalWindow>;
}
