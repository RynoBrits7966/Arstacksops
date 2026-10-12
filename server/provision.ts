import path from "node:path";
import { pathToFileURL } from "node:url";
import { isAllowlisted } from "./allowlist";
import { createListeningApp } from "./app";
import type { Auth } from "./auth";
import { withProvisioning } from "./provision-flag";
import { PROVISION_STAFF } from "./staff";

const MIN_PASSWORD_LENGTH = 8;

export type ProvisionStatus = "created" | "credential-added" | "verified-existing" | "unchanged";

export interface ProvisionResult {
  email: string;
  status: ProvisionStatus;
}

interface CredentialAccount {
  providerId?: string;
  password?: string | null;
}

interface FoundUser {
  user: { id: string; emailVerified?: boolean };
  accounts?: CredentialAccount[];
}

interface Plan {
  email: string;
  name: string;
  passwordEnv: string;
  existing: FoundUser | null;
  secret: string | null;
}

export function describeProvision(result: ProvisionResult): string {
  switch (result.status) {
    case "created":
      return `${result.email} created and marked verified`;
    case "credential-added":
      return `${result.email} credential added and marked verified`;
    case "verified-existing":
      return `${result.email} marked verified; password left unchanged`;
    case "unchanged":
      return `${result.email} already verified; password left unchanged`;
  }
}

export function safeProvisionError(error: unknown): string {
  let message = error instanceof Error ? error.message : "Provisioning failed";
  for (const member of PROVISION_STAFF) {
    const secret = process.env[member.passwordEnv];
    if (secret) message = message.split(secret).join("[redacted]");
  }
  return message;
}

function requiredPassword(envName: string): string {
  const value = process.env[envName] ?? "";
  if (!value.trim()) throw new Error(`${envName} is not set`);
  if (value.length < MIN_PASSWORD_LENGTH) throw new Error(`${envName} must be at least 8 characters`);
  return value;
}

function credentialPassword(found: FoundUser | null): string | null {
  const account = found?.accounts?.find(
    (item) => item.providerId === "credential" && typeof item.password === "string" && item.password.length > 0,
  );
  return account?.password ?? null;
}

export async function provisionStaff(auth: Auth): Promise<ProvisionResult[]> {
  const ctx = await auth.$context;
  const plans: Plan[] = [];
  for (const member of PROVISION_STAFF) {
    if (!isAllowlisted(member.email)) {
      throw new Error(`${member.email} is not on SIGNUP_ALLOWLIST`);
    }
    const found = await ctx.internalAdapter.findUserByEmail(member.email, { includeAccounts: true });
    const existing = found as FoundUser | null;
    const hasPassword = credentialPassword(existing) !== null;
    plans.push({
      email: member.email,
      name: member.name,
      passwordEnv: member.passwordEnv,
      existing,
      secret: hasPassword ? null : requiredPassword(member.passwordEnv),
    });
  }

  return withProvisioning(async () => {
    const results: ProvisionResult[] = [];
    for (const plan of plans) {
      if (!plan.existing) {
        if (!plan.secret) throw new Error(`${plan.passwordEnv} is not set`);
        const created = await ctx.internalAdapter.createUser({
          email: plan.email,
          name: plan.name,
          emailVerified: true,
        }, { method: "email-password" });
        await ctx.internalAdapter.linkAccount({
          userId: created.id,
          providerId: "credential",
          accountId: created.id,
          password: await ctx.password.hash(plan.secret),
        });
        results.push({ email: plan.email, status: "created" });
        continue;
      }
      const hadPassword = credentialPassword(plan.existing) !== null;
      if (!hadPassword) {
        if (!plan.secret) throw new Error(`${plan.passwordEnv} is not set`);
        await ctx.internalAdapter.linkAccount({
          userId: plan.existing.user.id,
          providerId: "credential",
          accountId: plan.existing.user.id,
          password: await ctx.password.hash(plan.secret),
        });
      }
      if (!plan.existing.user.emailVerified) {
        await ctx.internalAdapter.updateUser(plan.existing.user.id, { emailVerified: true });
      }
      if (!hadPassword) results.push({ email: plan.email, status: "credential-added" });
      else if (!plan.existing.user.emailVerified) results.push({ email: plan.email, status: "verified-existing" });
      else results.push({ email: plan.email, status: "unchanged" });
    }
    return results;
  });
}

export async function provisionFromEnv(): Promise<ProvisionResult[]> {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required to provision accounts");
  }
  const { auth } = await createListeningApp();
  return provisionStaff(auth);
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  if (import.meta.url === pathToFileURL(entry).href) return true;
  const base = path.basename(entry);
  return base === "provision.ts" || base === "provision.js";
}

if (isDirectRun()) {
  provisionFromEnv()
    .then((results) => {
      for (const result of results) console.log(describeProvision(result));
      process.exit(0);
    })
    .catch((error: unknown) => {
      console.error(safeProvisionError(error));
      process.exit(1);
    });
}
