import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface User {
    role?: string;
    locale?: string | null;
  }
  interface Session {
    user: { id: string; role: string; locale: string | null } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    role?: string;
    locale?: string | null;
  }
}
