import { shopperSavedWalletHttp } from "@/lib/retail-rewards/shopper-saved-wallet-server";
export const dynamic = "force-dynamic";
export const GET = request => shopperSavedWalletHttp.list(request);
export const POST = request => shopperSavedWalletHttp.save(request);
