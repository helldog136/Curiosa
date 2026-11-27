"use client";

import { useRouter } from "next/navigation";
import { Switch } from "./Switch";

/**
 * The « Show the installed modules too » switch of the catalogue (finding F-INFO-001): what is already on the site is hidden by default, so that what can be added
 * comes first. The page is rendered by the server from `?installed=1`, so the switch only moves to the other address; it follows what the page says.
 */
export function ShowInstalledSwitch({ on, onHref, offHref, label }: { on: boolean; onHref: string; offHref: string; label: string }) {
  const router = useRouter();
  return (
    <div className="flex items-center gap-2" data-testid="show-installed">
      <Switch label={label} checked={on} quiet onToggle={(next) => { router.replace(next ? onHref : offHref, { scroll: false }); }} testid="show-installed-switch" />
      <span className="text-sm" aria-hidden="true">{label}</span>
    </div>
  );
}
