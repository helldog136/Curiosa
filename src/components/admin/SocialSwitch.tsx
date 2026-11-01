"use client";

import { Switch } from "./Switch";
import { setSocialShown } from "@/app/admin/(panel)/social/actions";

/** L'interrupteur « Affiché » d'une ligne du tableau des réseaux : il montre l'état, bascule tout de suite et revient en arrière si l'enregistrement échoue. */
export function SocialSwitch({ instanceKey, label, shown, onText, offText, failedText, disabled }: {
  instanceKey: string; label: string; shown: boolean; onText: string; offText: string; failedText: string; disabled?: boolean;
}) {
  return <Switch label={label} checked={shown} onText={onText} offText={offText} failedText={failedText} disabled={disabled} testid={`social-switch-${instanceKey}`} onToggle={(next) => setSocialShown(instanceKey, next)} />;
}
