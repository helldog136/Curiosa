import Link from "next/link";
import { LOGIN_HREF } from "@/core/adminLinks";

/**
 * The one frame of the signed-out pages (sign in, forgot password, invitation, reset link, first password, no access): a `main` landmark, one `h1` that is always there
 * (even while a link is being checked or when it does not work), an optional one-line purpose, the form, and a way back to sign in. Presentation only: it reads nothing,
 * decides nothing and holds no secret.
 */
export function AuthShell({ title, intro, children, backLabel, testid }: { title: string; intro?: React.ReactNode; children: React.ReactNode; /** Text of the way back to the sign-in page; leave out when the person is already signed in. */ backLabel?: string; testid: string }) {
  return (
    <main className="mx-auto mt-12 max-w-sm space-y-6 px-4 pb-12 sm:mt-24" data-testid={testid}>
      <header className="space-y-2">
        <h1 className="text-2xl font-bold">{title}</h1>
        {intro && <p className="text-sm leading-6 text-muted">{intro}</p>}
      </header>
      {children}
      {backLabel && <p className="text-sm"><Link href={LOGIN_HREF} className="inline-flex min-h-11 items-center text-accent underline underline-offset-2" data-testid="auth-back">{backLabel}</Link></p>}
    </main>
  );
}
