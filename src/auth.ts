import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "@/core/db";
import { getAuthSecret } from "@/core/secret";
import { clientIp } from "@/core/auth/clientIp";
import { checkLogin, recordFailure, recordSuccess } from "@/core/auth/lockout";
import { verifyPassword } from "@/core/auth/password";
import { readToken } from "@/core/auth/twoFactor";

export const { handlers, auth, signIn, signOut } = NextAuth({
  secret: getAuthSecret(),
  // Le site tourne derrière un reverse proxy qui fixe le Host.
  trustHost: true,
  pages: { signIn: "/admin/login" },
  // Session en jeton, valable 14 jours au plus ; elle se coupe aussi à tout moment (voir core/auth/sessions.ts).
  session: { strategy: "jwt", maxAge: 14 * 24 * 60 * 60 },
  providers: [
    Credentials({
      credentials: { email: {}, password: {}, ticket: {} },
      async authorize(credentials, request) {
        // « Billet » : mot de passe ET deuxième facteur (ou clé d'accès) déjà vérifiés par la page de connexion. C'est la seule entrée pour un compte protégé.
        if (typeof credentials?.ticket === "string" && credentials.ticket) {
          const id = readToken("ticket", credentials.ticket);
          const owner = id ? await prisma.user.findUnique({ where: { id } }) : null;
          return owner ? { id: owner.id, email: owner.email, name: owner.name, role: owner.role, locale: owner.locale, sessionVersion: owner.sessionVersion } : null;
        }
        const email = typeof credentials?.email === "string" ? credentials.email.trim().toLowerCase() : "";
        const password = typeof credentials?.password === "string" ? credentials.password : "";
        if (!email || !password) return null;
        const ip = clientIp((name) => request?.headers?.get(name));
        // Bloqué (adresse ou e-mail) : on ne regarde même pas le mot de passe.
        if ((await checkLogin(ip, email)).locked) return null;
        const user = await verifyPassword(email, password);
        if (!user) { await recordFailure(ip, email); return null; }
        // Compte protégé par la double vérification : le mot de passe seul n'ouvre jamais la session (pas de contournement par l'adresse /api/auth).
        if (user.totpEnabledAt) return null;
        await recordSuccess(ip, user.id, email);
        return { id: user.id, email: user.email, name: user.name, role: user.role, locale: user.locale, sessionVersion: user.sessionVersion };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
        token.locale = user.locale ?? null;
        token.sv = user.sessionVersion ?? 0;
      }
      return token;
    },
    session({ session, token }) {
      session.user.id = token.id as string;
      session.user.role = token.role as string;
      session.user.locale = (token.locale as string | null) ?? null;
      session.user.sv = typeof token.sv === "number" ? token.sv : 0;
      return session;
    },
  },
});
