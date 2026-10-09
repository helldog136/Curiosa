"use client";

import { useActionState } from "react";
import { loginAction } from "@/app/admin/(auth)/login/actions";
import { ui } from "./ui";

type Labels = { email: string; password: string; submit: string; code: string; codeHelp: string; codeSubmit: string; back: string };

/** Connexion en un ou deux temps : e-mail + mot de passe, puis (si le compte a la double vérification) le code de l'application ou un code de secours. */
export function LoginForm({ labels }: { labels: Labels }) {
  const [state, action, pending] = useActionState(loginAction, null);
  const codeStep = state?.step === "code" && !!state.token;
  return (
    <form action={action} className="space-y-4">
      {codeStep ? (
        <>
          <input type="hidden" name="token" value={state!.token} />
          <label className="block text-sm">
            <span className={ui.label}>{labels.code}</span>
            <input name="code" required autoFocus inputMode="text" autoComplete="one-time-code" autoCapitalize="off" spellCheck={false} className={`${ui.input} !text-lg tracking-widest`} data-testid="login-code" />
          </label>
          <p className={ui.help}>{labels.codeHelp}</p>
        </>
      ) : (
        <>
          <label className="block text-sm">
            <span className={ui.label}>{labels.email}</span>
            <input name="email" type="email" required autoComplete="username" className={ui.input} />
          </label>
          <label className="block text-sm">
            <span className={ui.label}>{labels.password}</span>
            <input name="password" type="password" required autoComplete="current-password" className={ui.input} />
          </label>
        </>
      )}
      {state?.error && <p role="alert" className="rounded-lg border border-red-500/50 bg-red-500/10 p-3 text-sm">{state.error}</p>}
      <div className="flex items-center gap-3">
        <button className={ui.btnPrimary} disabled={pending}>{codeStep ? labels.codeSubmit : labels.submit}</button>
        {codeStep && <button type="button" className={ui.btn} onClick={() => window.location.reload()}>{labels.back}</button>}
      </div>
    </form>
  );
}
