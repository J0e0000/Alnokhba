import { SignJWT, jwtVerify } from "jose"
import { cookies } from "next/headers"
import { db } from "./db"

const SESSION_COOKIE = "nokhba_session"
const SESSION_SECRET = new TextEncoder().encode(
  process.env.SESSION_SECRET || "nokhba-v1-dev-secret-change-in-production-9f3k2"
)

export interface SessionPayload {
  teacherId: string
  email: string
}

// ─── Hash & verify passwords (dynamic import to reduce compile memory) ───
export async function hashPassword(p: string): Promise<string> {
  const bcrypt = (await import("bcryptjs")).default
  return bcrypt.hash(p, 10)
}
export async function verifyPassword(p: string, hash: string): Promise<boolean> {
  const bcrypt = (await import("bcryptjs")).default
  return bcrypt.compare(p, hash)
}

// ─── JWT session ─────────────────────────────────────────────────────────────
export async function signSession(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(SESSION_SECRET)
}

export async function verifySession(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, SESSION_SECRET)
    return { teacherId: payload.teacherId as string, email: payload.email as string }
  } catch {
    return null
  }
}

// ─── Server-side session getter (for API routes / server components) ─────────
export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies()
  const token = store.get(SESSION_COOKIE)?.value
  if (!token) return null
  return verifySession(token)
}

export async function requireTeacher() {
  const session = await getSession()
  if (!session) return null
  const teacher = await db.teacher.findUnique({
    where: { id: session.teacherId },
    select: {
      id: true,
      email: true,
      fullName: true,
      phone: true,
      centerName: true,
      whatsappNumber: true,
      absenceThreshold: true,
      subscriptionStatus: true,
    },
  })
  return teacher
}

export async function setSessionCookie(token: string) {
  const store = await cookies()
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: false,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  })
}

/** Cookie options for setting on a Response object (Route Handlers). */
export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: false,
  sameSite: "lax" as const,
  path: "/",
  maxAge: 60 * 60 * 24 * 7,
}

/** Build a Set-Cookie header value for a session token. */
export function buildSessionCookieHeader(token: string): string {
  const opts = SESSION_COOKIE_OPTIONS
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    `Path=${opts.path}`,
    `Max-Age=${opts.maxAge}`,
    `SameSite=${opts.sameSite}`,
  ]
  if (opts.httpOnly) parts.push("HttpOnly")
  if (opts.secure) parts.push("Secure")
  return parts.join("; ")
}

export async function clearSessionCookie() {
  const store = await cookies()
  store.delete(SESSION_COOKIE)
}

export { SESSION_COOKIE }
