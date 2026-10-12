let active = false;

/** True only inside the provision command's write step, in that process. */
export function provisioningActive(): boolean {
  return active;
}

export async function withProvisioning<T>(fn: () => Promise<T>): Promise<T> {
  if (active) throw new Error("Provisioning is already running");
  active = true;
  try {
    return await fn();
  } finally {
    active = false;
  }
}
