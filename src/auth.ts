import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/core/db";
import { getAuthSecret } from "@/core/secret";
import { clientIp } from "@/core/auth/clientIp";
import { checkLogin, recordFailure, recordSuccess } from "@/core/auth/lockout";

// Mot de passe fictif : on compare toujours un mot de passe, même si l'e-mail n'existe pas, pour que la durée de la réponse ne révèle pas quels comptes existent.
const DUMMY_HASH = bcrypt.hashSync("curiosa-dummy-password", 12);

export const { handlers, auth, signIn, signOut } = NextAuth({
  secret: getAuthSecret(),
  // Le site tourne derrière un reverse proxy qui fixe le Host.
  trustHost: true,
  pages: { signIn: "/admin/login" },
  // Session en jeton, valable 14 jours au plus ; elle se coupe aussi à tout moment (voir core/auth/sessions.ts).
  session: { strategy: "jwt", maxAge: 14 * 24 * 60 * 60 },
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(credentials, request) {
        const email = typeof credentials?.email === "string" ? credentials.email.trim().toLowerCase() : "";
        const password = typeof credentials?.password === "string" ? credentials.password : "";
        if (!email || !password) return null;
        const ip = clientIp((name) => request?.headers?.get(name));
        // Bloqué (adresse ou e-mail) : on ne regarde même pas le mot de passe.
        if ((await checkLogin(ip, email)).locked) return null;
        const user = await prisma.user.findUnique({ where: { email } });
        const good = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
        if (!user || !good) { await recordFailure(ip, email); return null; }
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
