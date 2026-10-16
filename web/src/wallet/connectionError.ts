import { ProviderNotFoundError } from "wagmi";
import { UserRejectedRequestError } from "viem";

/** Connector failures can wrap provider errors; only a rejection means declined. */
export function connectionErrorText(error: unknown): string {
  if (!error) return "";
  let cause: unknown = error;
  for (let depth = 0; cause && depth < 12; depth++) {
    if (cause instanceof ProviderNotFoundError)
      return "No browser wallet detected. Open this page in your wallet browser, or choose Coinbase Wallet.";
    if (
      cause instanceof UserRejectedRequestError ||
      (cause as { code?: number }).code === 4001
    )
      return "The wallet declined the connection. Choose a wallet to try again.";
    cause = (cause as { cause?: unknown }).cause;
  }
  return "Unable to connect to this wallet. Try again, or choose another wallet.";
}
