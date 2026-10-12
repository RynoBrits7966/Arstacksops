/** The only accounts a one-time provision command may create or mark verified. */
export const PROVISION_STAFF = [
  { email: "andrew@arstacks.co.za", name: "Andrew", passwordEnv: "PROVISION_PASSWORD_ANDREW" },
  { email: "barend@arstacks.co.za", name: "Barend", passwordEnv: "PROVISION_PASSWORD_BAREND" },
  { email: "ryno@arstacks.co.za", name: "Ryno", passwordEnv: "PROVISION_PASSWORD_RYNO" },
] as const;

export function isProvisionStaff(email: string): boolean {
  return PROVISION_STAFF.some((member) => member.email === email.trim().toLowerCase());
}
