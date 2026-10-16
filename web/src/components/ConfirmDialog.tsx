import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { EXPLORER_URL, IMD_SYMBOL, TREASURY_ADDRESS } from "../config";
import { fmtAmount, fmtUsd, short } from "../lib/format";
import { usdValue, type Plan, type Pricing, type Progress } from "../lib/sweep";
import { minimumOut } from "../lib/directSale";

type Props = {
  plan: Plan;
  pricing: Pricing | null;
  progress: Progress | null;
  error: string | null;
  returnFocus?: HTMLElement | null;
  onConfirm: () => void;
  onClose: () => void;
};

function progressText(p: Progress): string {
  if (p.step === "approve")
    return `${p.approval === "permit" ? "Authorize the router for" : "Approve Permit2 to spend"} ${p.token.symbol} in your wallet (${p.index} of ${p.total})…`;
  if (p.step === "sign")
    return `Confirm sale ${p.batch} of ${p.batches} in your wallet.${p.gasWei ? ` Estimated gas: ${fmtAmount(p.gasWei)} ETH.` : ""}`;
  return p.batches > 1
    ? `Waiting for sale ${p.batch} of ${p.batches} to confirm…`
    : "Waiting for the transaction to confirm…";
}

export function ConfirmDialog({
  plan,
  pricing,
  progress,
  error,
  returnFocus,
  onConfirm,
  onClose,
}: Props) {
  const titleId = useId();
  const box = useRef<HTMLDivElement>(null);
  const running = progress !== null && error === null;

  const closeRef = useRef(onClose);
  const runningRef = useRef(running);
  closeRef.current = onClose;
  runningRef.current = running;
  useEffect(() => {
    const previous =
      returnFocus ?? (document.activeElement as HTMLElement | null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !runningRef.current) closeRef.current();
      if (e.key === "Tab") {
        const nodes = box.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), a[href], [tabindex="0"]',
        );
        if (!nodes?.length) {
          e.preventDefault();
          return;
        }
        const first = nodes[0],
          last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        }
        if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    addEventListener("keydown", onKey);
    document.getElementById("page")?.setAttribute("inert", "");
    box.current?.querySelector<HTMLElement>("button")?.focus();
    return () => {
      removeEventListener("keydown", onKey);
      document.getElementById("page")?.removeAttribute("inert");
      requestAnimationFrame(() => {
        if (previous?.isConnected && !previous.matches(":disabled"))
          previous.focus();
        else document.getElementById("tokens-heading")?.focus();
      });
    };
  }, []);

  const n = plan.items.length;
  return createPortal(
    <div className="sheet-bg" onClick={() => !running && onClose()}>
      <div
        className="sheet sheet-wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={box}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-head">
          <h2 id={titleId}>
            {n === 1 ? "Sell 1 token for IMD?" : `Sell ${n} tokens for IMD?`}
          </h2>
          <button
            className="x"
            aria-label="Close"
            onClick={onClose}
            disabled={running}
          >
            ×
          </button>
        </div>

        <p className="plan-note">
          {plan.requiresApproval
            ? "Live quote before approval. After approval, the complete sale is simulated before you sign."
            : "Simulated quote. Network conditions can change before the transaction settles."}
        </p>
        {n > 0 ? (
          <table className="plan">
            <thead>
              <tr>
                <th>Token</th>
                <th className="num">Amount</th>
                <th className="num">{IMD_SYMBOL} gross</th>
              </tr>
            </thead>
            <tbody>
              {plan.items.map(({ token, imdOut }) => (
                <tr key={token.address}>
                  <td>
                    {token.symbol}
                    {token.liveRoute &&
                      token.liveRoute.amountIn < token.balance && (
                        <span className="note">Partial balance</span>
                      )}
                  </td>
                  <td className="num">
                    {fmtAmount(
                      token.liveRoute?.amountIn ?? token.balance,
                      token.decimals,
                    )}
                  </td>
                  <td className="num">
                    {fmtAmount(imdOut)}
                    <span className="note">
                      Minimum {fmtAmount(minimumOut(imdOut))}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="plan-note">
            None of the selected tokens can be sold right now. Each one is
            listed below with the reason.
          </p>
        )}

        {plan.excluded.length > 0 && (
          <div className="excluded">
            <p className="plan-note">Left out of this sale:</p>
            <ul>
              {plan.excluded.map(({ token, reason }) => (
                <li key={token.address}>
                  <span className="token-name">{token.symbol}</span>{" "}
                  <span className="note">{reason}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {n > 0 && (
          <dl className="totals">
            <div>
              <dt>Gross proceeds</dt>
              <dd>
                {fmtAmount(plan.gross)} {IMD_SYMBOL}
              </dd>
            </div>
            <div>
              <dt>
                Fee 2%, to treasury{" "}
                <a
                  className="mono"
                  href={`${EXPLORER_URL}/address/${TREASURY_ADDRESS}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {short(TREASURY_ADDRESS)}
                </a>
              </dt>
              <dd>
                −{fmtAmount(plan.fee)} {IMD_SYMBOL}
              </dd>
            </div>
            <div className="total">
              <dt>You receive</dt>
              <dd>
                {fmtAmount(plan.net)} {IMD_SYMBOL}
                {pricing && (
                  <span className="note">
                    {fmtUsd(usdValue(plan.net, pricing))}
                  </span>
                )}
              </dd>
            </div>
          </dl>
        )}

        <p className="plan-note">
          {plan.gasWei !== null &&
            `Estimated sale gas: ${fmtAmount(plan.gasWei)} ETH. `}
          {plan.gasNote}
        </p>
        <p className="plan-note">
          Your wallet may ask for a token approval to Permit2 and a separate
          router authorization, limited to this amount and 10 minutes. Then
          confirm one sale per token. Minimum proceeds are 3% below each quote.
          A reverted sale charges no sale fee; network gas is still paid.
        </p>

        <p className="status-line" role="status" aria-live="polite">
          {error ? error : progress ? progressText(progress) : ""}
        </p>

        <div className="sheet-actions">
          <button
            className="btn btn-secondary"
            onClick={onClose}
            disabled={running}
          >
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={onConfirm}
            disabled={running || n === 0}
          >
            {running
              ? "Selling…"
              : n === 1
                ? "Sell 1 token"
                : `Sell ${n} tokens`}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
