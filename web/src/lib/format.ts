import { formatUnits } from "viem";

const usdFormat = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});
/** Exact decimal conversion; never round a wallet balance through Number. */
export function fmtAmount(value: bigint, decimals: number | null = 18): string {
  if (decimals === null) return `${value.toString()} raw units`;
  const [whole, fraction] = formatUnits(value, decimals).split(".");
  const grouped = whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction ? `${grouped}.${fraction}` : grouped;
}

export function fmtUsd(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "–";
  if (value > 0 && value < 0.01) return "<$0.01";
  return usdFormat.format(value);
}

export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** Compact previews always have an exact counterpart in the token/review details. */
export function fmtPreview(value: bigint, decimals: number | null = 18): string {
  if (decimals === null) return "Raw units";
  const number = Number(formatUnits(value, decimals));
  if (!Number.isFinite(number)) return "See exact amount";
  if (number > 0 && number < 0.000001) return "<0.000001";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: number < 1 ? 6 : 4, maximumSignificantDigits: 8 }).format(number);
}

/** The one-line reason viem or a wallet gives for a failure. */
export function errorText(e: unknown): string {
  if (e && typeof e === "object") {
    const o = e as { shortMessage?: string; message?: string };
    if (o.shortMessage) return o.shortMessage;
    if (o.message) return o.message.split("\n")[0]!;
  }
  return String(e);
}
