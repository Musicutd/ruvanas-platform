import { shopperSavedWalletHttp } from "@/lib/retail-rewards/shopper-saved-wallet-server";
export const dynamic = "force-dynamic";
export async function DELETE(request, context) {
  return shopperSavedWalletHttp.remove(request, (await context.params).id);
}
