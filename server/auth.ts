import { betterAuth, APIError, type BetterAuthOptions } from "better-auth";
import { memoryAdapter, type MemoryDB } from "better-auth/adapters/memory";
import type { Pool } from "pg";
import { isAllowlisted } from "./allowlist";
import { EMAIL_ACTION_CLOSED_MESSAGE, SIGNUP_CLOSED_MESSAGE, canSendEmail, deliverAuthEmail } from "./mail";
import { provisioningActive } from "./provision-flag";
import { isProvisionStaff } from "./staff";

export type AuthDatabase = { pool: Pool } | { memory: MemoryDB };

export function authBaseURL(): string {
  return process.env.BETTER_AUTH_URL || "http://localhost:5173";
}

/**
 * Railway's public edge overwrites X-Real-IP with the connecting client.
 * X-Forwarded-For is not a stable single hop, so it is not trusted.
 */
export const CLIENT_IP_HEADERS = ["x-real-ip"];

export function authOptions(database: AuthDatabase): BetterAuthOptions {
  const secret = process.env.BETTER_AUTH_SECRET || "dev-only-secret-change-me";
  if (process.env.NODE_ENV === "production" && !process.env.BETTER_AUTH_SECRET) {
    throw new Error("BETTER_AUTH_SECRET is required in production");
  }
  return {
    appName: "ARStacksOps",
    baseURL: authBaseURL(),
    secret,
    trustedOrigins: [authBaseURL()],
    database: "pool" in database ? database.pool : memoryAdapter(database.memory),
    advanced: {
      ipAddress: {
        ipAddressHeaders: CLIENT_IP_HEADERS,
      },
    },
    telemetry: { enabled: false },
    rateLimit: {
      enabled: process.env.NODE_ENV === "production",
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      autoSignIn: false,
      minPasswordLength: 8,
      sendResetPassword: async ({ user, url }) => {
        if (!canSendEmail()) {
          throw new APIError("SERVICE_UNAVAILABLE", { message: EMAIL_ACTION_CLOSED_MESSAGE });
        }
        await deliverAuthEmail({
          to: user.email,
          subject: "Reset your ARStacksOps password",
          url,
          text: `Reset your password: ${url}`,
        });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: false,
      sendVerificationEmail: async ({ user, url }) => {
        if (!isAllowlisted(user.email)) return;
        if (!canSendEmail()) {
          throw new APIError("SERVICE_UNAVAILABLE", { message: EMAIL_ACTION_CLOSED_MESSAGE });
        }
        await deliverAuthEmail({
          to: user.email,
          subject: "Confirm your ARStacksOps account",
          url,
          text: `Confirm your account: ${url}`,
        });
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            const email = typeof user.email === "string" ? user.email : "";
            if (!isAllowlisted(email)) {
              throw new APIError("BAD_REQUEST", { message: "This email is not allowed to register." });
            }
            if (provisioningActive()) {
              if (!isProvisionStaff(email)) {
                throw new APIError("BAD_REQUEST", { message: "This email is not approved for provisioning." });
              }
              return;
            }
            if (!canSendEmail()) {
              throw new APIError("SERVICE_UNAVAILABLE", { message: SIGNUP_CLOSED_MESSAGE });
            }
          },
        },
      },
      session: {
        create: {
          before: async (session, context) => {
            const userId = typeof session.userId === "string" ? session.userId : "";
            const found = userId ? await context?.context.internalAdapter.findUserById(userId) : null;
            if (!found || !isAllowlisted(found.email)) {
              throw new APIError("FORBIDDEN", { message: "This email is not allowed to sign in." });
            }
          },
        },
      },
    },
  };
}

export function createAuth(database: AuthDatabase) {
  return betterAuth(authOptions(database));
}

export type Auth = ReturnType<typeof createAuth>;
