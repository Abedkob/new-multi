import type { DefaultSession } from "next-auth";
import type { Role } from "@/lib/roles";

declare module "next-auth" {
  interface User {
    role: Role;
    tenantId: string | null;
    mustChangePassword: boolean;
    sessionVersion: number;
  }
  interface Session {
    user: {
      id: string;
      role: Role;
      tenantId: string | null;
      mustChangePassword: boolean;
      sessionVersion: number;
    } & DefaultSession["user"];
  }
}
