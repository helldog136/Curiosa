"use client";

import { useActionState, useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { loginAction, passkeyLoginFinish, passkeyLoginStart } from "@/app/admin/(auth)/login/actions";
import { passkeysSupported, getPasskeyAssertion } from "./webauthn";
import { ui } from "./ui";
import { PendingButton } from "./PendingButton";
import { PasswordInput } from "./PasswordInput";
import { clearSecrets, submitKeepingValues } from "./keepValues";

type Labels = { email: string; password: string; submit: string; code: string; codeHelp: string; codeSubmit: string; back: string; passkey: string; passkeyOr: string; passkeyCancelled: string };

/** Connexion en un ou deux temps : e-mail + mot de passe, puis (si le compte a la double vérification) le code de l'application ou un code de secours. */
export function LoginForm({ labels }: { labels: Labels }) {
  const [state, action, pending] = useActionState(loginAction, null);
  const codeStep = state?.step === "code" && !!state.token;
  const supported = useSyncExternalStore(() => () => {}, passkeysSupported, () => false);
  const [passkeyError, setPasskeyError] = useState("");
  const [busy, startPasskey] = useTransition();
  // Après un refus, l'e-mail reste (pour le corriger) mais ni le mot de passe ni le code à usage unique ne restent affichés.
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (!state) return;
    clearSecrets(formRef.current);
    const code = formRef.current?.elements.namedItem("code");
    if (code instanceof HTMLInputElement) code.value = "";
  }, [state]);
  // Connexion sans mot de passe : l'appareil demande l'empreinte, le visage ou le code ; aucun e-mail à saisir.
  const signInWithPasskey = () => startPasskey(async () => {
    setPasskeyError("");
    const begun = await passkeyLoginStart();
    if (!begun.options || !begun.challengeId) return;
    let response;
    try { response = await getPasskeyAssertion(begun.options); } catch { setPasskeyError(labels.passkeyCancelled); return; }
    const result = await passkeyLoginFinish(begun.challengeId, response);
    if (result?.error) setPasskeyError(result.error);
  });
  return (
    <form ref={formRef} method="post" onSubmit={submitKeepingValues(action)} className="space-y-4">
      {codeStep ? (
        <>
          <input type="hidden" name="token" value={state!.token} />
          <div className="text-sm">
            <label className={ui.label} htmlFor="login-code">{labels.code}</label>
            <input id="login-code" name="code" required autoFocus inputMode="text" autoComplete="one-time-code" autoCapitalize="off" spellCheck={false} className={`${ui.input} !text-lg tracking-widest`} data-testid="login-code" />
          </div>
          <p className={ui.help}>{labels.codeHelp}</p>
        </>
      ) : (
        <>
          <div className="text-sm">
            <label className={ui.label} htmlFor="login-email">{labels.email}</label>
            <input id="login-email" name="email" type="email" required autoComplete="username" inputMode="email" autoCapitalize="none" spellCheck={false} className={ui.input} />
          </div>
          <div className="text-sm">
            <label className={ui.label} htmlFor="login-password">{labels.password}</label>
            <PasswordInput id="login-password" name="password" required autoComplete="current-password" />
          </div>
        </>
      )}
      {state?.error && <p role="alert" className="rounded-lg border border-red-500/50 bg-red-500/10 p-3 text-sm">{state.error}</p>}
      <div className="flex items-center gap-3">
        <PendingButton variant="primary" pending={pending}>{codeStep ? labels.codeSubmit : labels.submit}</PendingButton>
        {codeStep && <button type="button" className={ui.btn} onClick={() => window.location.reload()}>{labels.back}</button>}
      </div>
      {supported && !codeStep && (
        <div className="space-y-3 border-t border-line pt-4">
          <p className="text-center text-xs text-muted">{labels.passkeyOr}</p>
          <button type="button" className={`${ui.btn} w-full`} disabled={busy} onClick={signInWithPasskey} data-testid="login-passkey">🔑 {labels.passkey}</button>
          {passkeyError && <p role="alert" className="rounded-lg border border-red-500/50 bg-red-500/10 p-3 text-sm">{passkeyError}</p>}
        </div>
      )}
    </form>
  );
}
