"use server";

import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { createSession, destroySession } from "@/lib/session";

const schema = z.object({ email: z.string().email(), password: z.string().min(1), next: z.string().optional() });

export type LoginState = { error?: string } | undefined;

// A real hash so unknown emails cost the same time as wrong passwords
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 12);

export async function login(_prev: LoginState, form: FormData): Promise<LoginState> {
  const parsed = schema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "Enter your email and password." };

  const user = await db.user.findUnique({ where: { email: parsed.data.email.toLowerCase() } });
  const ok = await bcrypt.compare(parsed.data.password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok) return { error: "Incorrect email or password." };

  await createSession(user.id);
  // one-shot flag read by the client: sync MT4 trades right after signing in
  (await cookies()).set("tj_sync", "1", { path: "/", maxAge: 120, sameSite: "lax" });
  const next = parsed.data.next;
  redirect(next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard");
}

export async function logout() {
  await destroySession();
  redirect("/login");
}
