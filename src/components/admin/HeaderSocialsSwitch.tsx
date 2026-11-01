"use client";

import { Switch } from "./Switch";
import { setHeaderSocials } from "@/app/admin/(panel)/social/actions";

/** L'interrupteur « Afficher mes réseaux dans l'en-tête » : il montre l'état, bascule tout de suite et revient en arrière si l'enregistrement échoue. */
export function HeaderSocialsSwitch({ label, shown, onText, offText, failedText }: { label: string; shown: boolean; onText: string; offText: string; failedText: string }) {
  return <Switch label={label} checked={shown} onText={onText} offText={offText} failedText={failedText} testid="social-header-switch" onToggle={(next) => setHeaderSocials(next)} />;
}
