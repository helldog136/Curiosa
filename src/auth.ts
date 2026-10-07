import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/core/db";
import { getAuthSecret } from "@/core/secret";

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;
const failed = new Map<string, { count: number; first: number }>();

function limited(email: string): boolean {
  const e = failed.get(email);
  if (!e) return false;
  if (Date.now() - e.first > WINDOW_MS) {
    failed.delete(email);
    return false;
  }
  return e.count >= MAX_ATTEMPTS;
}

function fail(email: string): null {
  const e = failed.get(email);
  if (!e || Date.now() - e.first > WINDOW_MS) failed.set(email, { count: 1, first: Date.now() });
  else e.count += 1;
  return null;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  secret: getAuthSecret(),
  // Le site tourne derrière un reverse proxy qui fixe le Host.
  trustHost: true,
  pages: { signIn: "/admin/login" },
  session: { strategy: "jwt" },
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(credentials) {
        const email = typeof credentials?.email === "string" ? credentials.email.trim().toLowerCase() : "";
        const password = typeof credentials?.password === "string" ? credentials.password : "";
        if (!email || !password || limited(email)) return null;
        const user = await prisma.user.findUnique({ where: { email } });
        if (!user || !(await bcrypt.compare(password, user.passwordHash))) return fail(email);
        failed.delete(email);
        return { id: user.id, email: user.email, name: user.name, role: user.role, locale: user.locale };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
        token.locale = user.locale ?? null;
      }
      return token;
    },
    session({ session, token }) {
      session.user.id = token.id as string;
      session.user.role = token.role as string;
      session.user.locale = (token.locale as string | null) ?? null;
      return session;
    },
  },
});
