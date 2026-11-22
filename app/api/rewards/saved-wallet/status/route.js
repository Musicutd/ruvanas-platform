import { shopperSavedWalletHttp } from "@/lib/retail-rewards/shopper-saved-wallet-server";
export const dynamic = "force-dynamic";
export const POST = request => shopperSavedWalletHttp.status(request);
