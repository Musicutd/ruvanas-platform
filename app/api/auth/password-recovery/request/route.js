import { accountRecoveryHandlers } from "@/lib/account-recovery-server";
export const dynamic = "force-dynamic";
export async function POST(request) { return accountRecoveryHandlers(request).request(request); }
