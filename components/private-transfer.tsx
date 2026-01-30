"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWallet } from "@jup-ag/wallet-adapter";
import { Connection, PublicKey, VersionedTransaction } from "@solana/web3.js";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { WalletConnectButton } from "@/components/wallet-button";
import { AmountTokenInput } from "@/components/ui/amount-token-input";
import {
  depositSOL,
  depositSPLToken,
  getPrivateSOLBalance,
  getPrivateSPLBalance,
  setLogger,
  withdrawSOL,
  withdrawSPLToken,
  WalletAdapter,
} from "@/lib/privacy-cash";
import {
  formatTokenAmount,
  getTokenByMint,
  isSolMint,
  parseTokenAmountToBaseUnits,
  SOL_MINT,
} from "@/lib/token-registry";
import {
  getRelayerConfig,
  computeTotalLamportsForRecipient,
  computeTotalBaseUnitsForRecipientSPL,
} from "@/lib/fee-config";
import { Typewriter } from "@/components/ui/typewriter";
import { cn } from "@/lib/utils";
import type { TokenMint } from "@/lib/payment-links-types";
import {
  FileSignature,
  Send,
  Loader2,
  Shield,
  ShieldCheck,
  Terminal,
  CheckCircle2,
  ExternalLink,
} from "lucide-react";

const RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";

type TransferStatus = "idle" | "checking" | "depositing" | "transferring" | "success" | "error";

export function PrivateTransfer() {
  const { publicKey, signMessage, signTransaction } = useWallet();
  const [connection] = useState(() => new Connection(RPC_URL, "confirmed"));

  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [tokenMint, setTokenMint] = useState<TokenMint>(SOL_MINT);
  const [status, setStatus] = useState<TransferStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [publicBalanceBaseUnits, setPublicBalanceBaseUnits] = useState<number | null>(null);
  const [privateBalanceBaseUnits, setPrivateBalanceBaseUnits] = useState<number | null>(null);
  const [balancesChecked, setBalancesChecked] = useState(false);
  const [txSignature, setTxSignature] = useState<string | null>(null);
  const [logQueue, setLogQueue] = useState<string[]>([]);
  const [displayLogs, setDisplayLogs] = useState<string[]>([]);
  const [activityLogs, setActivityLogs] = useState<string[]>([]);
  const [activityExiting, setActivityExiting] = useState(false);
  const [relayerConfig, setRelayerConfig] =
    useState<Awaited<ReturnType<typeof getRelayerConfig>>>(null);
  const lastLogRef = useRef<string | null>(null);
  const activityLogsRef = useRef<HTMLDivElement>(null);
  const activityExitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const token = useMemo(() => getTokenByMint(tokenMint), [tokenMint]);
  const isSolToken = token ? isSolMint(token.mint) : false;

  // Reset balances when token changes
  useEffect(() => {
    setBalancesChecked(false);
    setPublicBalanceBaseUnits(null);
    setPrivateBalanceBaseUnits(null);
  }, [tokenMint]);

  useEffect(() => {
    setLogger((level, message) => {
      const prefix = level === "error" ? "Error" : level === "warn" ? "Warn" : "Info";
      const nextMessage = `${prefix}: ${message}`;
      if (lastLogRef.current === nextMessage) return;
      lastLogRef.current = nextMessage;
      setLogQueue((prev) => [...prev, nextMessage]);
      setActivityLogs((prev) => [...prev.slice(-11), nextMessage]);
    });
  }, []);

  useEffect(() => {
    getRelayerConfig().then(setRelayerConfig);
  }, []);

  const getWalletAdapter = useCallback((): WalletAdapter => {
    if (!publicKey || !signMessage || !signTransaction) {
      throw new Error("Please connect your wallet");
    }
    return {
      publicKey,
      signMessage: async (message: Uint8Array) => {
        const result = await signMessage(message);
        return (result as { signature?: Uint8Array }).signature ?? result;
      },
      signTransaction: async (tx: VersionedTransaction) => {
        return signTransaction(tx);
      },
    };
  }, [publicKey, signMessage, signTransaction]);

  const getPublicTokenBalance = useCallback(
    async (targetConnection: Connection, owner: PublicKey, mint: string) => {
      const ata = await getAssociatedTokenAddress(new PublicKey(mint), owner);
      try {
        const balance = await targetConnection.getTokenAccountBalance(ata);
        return Number(balance.value.amount);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.toLowerCase().includes("could not find account")) {
          return 0;
        }
        throw err;
      }
    },
    []
  );

  const fetchBalances = useCallback(async () => {
    if (!publicKey || !token) return;
    setStatus("checking");
    setError(null);
    const balanceLog = "Info: Requesting signature to check balances...";
    setLogQueue((prev) => [...prev, balanceLog]);
    setActivityLogs((prev) => [...prev.slice(-11), balanceLog]);
    try {
      const walletAdapter = getWalletAdapter();

      const publicBalance = isSolToken
        ? await connection.getBalance(publicKey)
        : await getPublicTokenBalance(connection, publicKey, token.mint);

      const privateBaseUnits = isSolToken
        ? (await getPrivateSOLBalance({ connection, wallet: walletAdapter })).lamports
        : (
            await getPrivateSPLBalance({
              connection,
              wallet: walletAdapter,
              mintAddress: token.mint,
            })
          ).base_units;

      setPublicBalanceBaseUnits(publicBalance);
      setPrivateBalanceBaseUnits(privateBaseUnits);
      setBalancesChecked(true);
      setStatus("idle");
      setLogQueue([]);
      setDisplayLogs([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch balances");
      setStatus("error");
    }
  }, [connection, getPublicTokenBalance, getWalletAdapter, isSolToken, publicKey, token]);

  useEffect(() => {
    if (!publicKey || !token || balancesChecked || status === "checking") return;
    fetchBalances();
  }, [balancesChecked, fetchBalances, publicKey, status, token]);

  const formatAmount = useCallback(
    (baseUnits: number) => {
      if (!token) return "---";
      return formatTokenAmount(baseUnits, token);
    },
    [token]
  );

  const amountBaseUnits = useMemo(() => {
    if (!token) return 0;
    const parsed = parseTokenAmountToBaseUnits(amount, token);
    return Number.isFinite(parsed) ? parsed : 0;
  }, [amount, token]);

  const isValidAmount = amountBaseUnits > 0;

  const isValidRecipient = useMemo(() => {
    if (!recipient.trim()) return false;
    try {
      new PublicKey(recipient.trim());
      return true;
    } catch {
      return false;
    }
  }, [recipient]);

  const payFeeBreakdown = useMemo(() => {
    if (!isValidAmount || !token) return null;
    if (isSolToken) {
      const { totalLamports, feeLamports } = computeTotalLamportsForRecipient(
        amountBaseUnits,
        relayerConfig
      );
      return {
        toRecipientBaseUnits: amountBaseUnits,
        feeBaseUnits: feeLamports,
        totalFromPrivateBaseUnits: totalLamports,
      };
    }
    const { totalBaseUnits, feeBaseUnits } = computeTotalBaseUnitsForRecipientSPL(
      amountBaseUnits,
      token.unitsPerToken,
      token.name,
      relayerConfig
    );
    return {
      toRecipientBaseUnits: amountBaseUnits,
      feeBaseUnits,
      totalFromPrivateBaseUnits: totalBaseUnits,
    };
  }, [amountBaseUnits, isSolToken, isValidAmount, relayerConfig, token]);

  const requiredPrivateBaseUnits = payFeeBreakdown?.totalFromPrivateBaseUnits ?? 0;
  const shortfallBaseUnits =
    privateBalanceBaseUnits !== null
      ? Math.max(0, requiredPrivateBaseUnits - privateBalanceBaseUnits)
      : null;

  const isBusy = status === "checking" || status === "depositing" || status === "transferring";
  const hasSufficientBalance =
    privateBalanceBaseUnits !== null && privateBalanceBaseUnits >= requiredPrivateBaseUnits;
  const needsDeposit = shortfallBaseUnits !== null && shortfallBaseUnits > 0;

  // Log queue drainer
  useEffect(() => {
    if (!isBusy) return;
    if (logQueue.length === 0) return;
    const interval = setInterval(() => {
      setLogQueue((prev) => {
        if (prev.length === 0) return prev;
        const [next, ...rest] = prev;
        setDisplayLogs((existing) => {
          const updated = [...existing, next];
          return updated.slice(-4);
        });
        return rest;
      });
    }, 900);
    return () => clearInterval(interval);
  }, [isBusy, logQueue.length]);

  useEffect(() => {
    activityLogsRef.current?.scrollTo({
      top: activityLogsRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [activityLogs]);

  const showActivityPanel = (isBusy || activityExiting) && activityLogs.length > 0;
  useEffect(() => {
    if (isBusy) {
      if (activityExitTimeoutRef.current) {
        clearTimeout(activityExitTimeoutRef.current);
        activityExitTimeoutRef.current = null;
      }
      setActivityExiting(false);
      return;
    }
    if (activityLogs.length > 0 && !activityExiting) {
      setActivityExiting(true);
      activityExitTimeoutRef.current = setTimeout(() => {
        setActivityExiting(false);
        setActivityLogs([]);
        activityExitTimeoutRef.current = null;
      }, 280);
    }
    return () => {
      if (activityExitTimeoutRef.current) clearTimeout(activityExitTimeoutRef.current);
    };
  }, [isBusy, activityLogs.length, activityExiting]);

  const handleDeposit = useCallback(
    async (amountToDeposit: number) => {
      if (!publicKey || !token) return;
      setStatus("depositing");
      setError(null);
      const depositLog = "Info: Preparing private deposit...";
      setLogQueue((prev) => [...prev, depositLog]);
      setActivityLogs((prev) => [...prev.slice(-11), depositLog]);

      try {
        const walletAdapter = getWalletAdapter();
        const depositResult = isSolToken
          ? await depositSOL({
              connection,
              wallet: walletAdapter,
              amount_in_lamports: amountToDeposit,
            })
          : await depositSPLToken({
              connection,
              wallet: walletAdapter,
              mintAddress: token.mint,
              base_units: amountToDeposit,
            });

        await connection.confirmTransaction(depositResult.tx, "confirmed");
        await fetchBalances();
        setStatus("idle");
        setLogQueue([]);
        setDisplayLogs([]);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Deposit failed");
        setStatus("error");
      }
    },
    [connection, fetchBalances, getWalletAdapter, isSolToken, publicKey, token]
  );

  const handleTransfer = useCallback(async () => {
    if (!publicKey || !token) return;
    if (!isValidAmount) {
      setError("Please enter a valid amount");
      return;
    }
    if (!isValidRecipient) {
      setError("Please enter a valid Solana address");
      return;
    }
    setStatus("transferring");
    setError(null);
    const transferLog = "Info: Preparing private transfer...";
    setLogQueue((prev) => [...prev, transferLog]);
    setActivityLogs((prev) => [...prev.slice(-11), transferLog]);

    try {
      const walletAdapter = getWalletAdapter();
      const recipientAddress = recipient.trim();

      const result = isSolToken
        ? await withdrawSOL({
            connection,
            wallet: walletAdapter,
            amount_in_lamports: amountBaseUnits,
            recipient: recipientAddress,
          })
        : await withdrawSPLToken({
            connection,
            wallet: walletAdapter,
            mintAddress: token.mint,
            base_units: amountBaseUnits,
            recipient: recipientAddress,
          });

      setTxSignature(result.tx);
      setStatus("success");
      setLogQueue([]);
      setDisplayLogs([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Transfer failed");
      setStatus("error");
    }
  }, [
    amountBaseUnits,
    connection,
    getWalletAdapter,
    isSolToken,
    isValidAmount,
    isValidRecipient,
    publicKey,
    recipient,
    token,
  ]);

  const handlePrimaryAction = useCallback(async () => {
    if (!publicKey) return;
    if (!isValidAmount) {
      setError("Please enter a valid amount");
      return;
    }
    if (!isValidRecipient) {
      setError("Please enter a valid Solana address");
      return;
    }
    if (needsDeposit && shortfallBaseUnits) {
      await handleDeposit(shortfallBaseUnits);
      return;
    }
    await handleTransfer();
  }, [
    handleDeposit,
    handleTransfer,
    isValidAmount,
    isValidRecipient,
    needsDeposit,
    publicKey,
    shortfallBaseUnits,
  ]);

  const isDepositing = status === "depositing";
  const isTransferring = status === "transferring";
  const isChecking = status === "checking";
  const isError = status === "error";
  const buttonLabel = isChecking
    ? "Checking balance…"
    : isDepositing
      ? "Depositing…"
      : isTransferring
        ? "Transferring…"
        : isError
          ? "Try again"
          : needsDeposit
            ? `Deposit ${
                token && shortfallBaseUnits !== null
                  ? `${formatAmount(shortfallBaseUnits)} ${token.label}`
                  : "---"
              }`
            : `Transfer ${token ? `${formatAmount(amountBaseUnits)} ${token.label}` : "---"}`;

  const cardClass =
    "w-full max-w-2xl mx-auto overflow-hidden rounded-2xl border-border/50 bg-card/90 shadow-[0_0_0_1px_var(--border),0_8px_40px_-12px_oklch(0.72_0.15_220/12%)] dark:shadow-[0_0_0_1px_var(--border),0_8px_40px_-12px_black/40%]";

  if (status === "success") {
    return (
      <div className="space-y-4">
        <Card className={cn(cardClass, "animate-success-in")} size="default">
          <CardHeader className="space-y-3 px-6 pt-8 pb-2 text-center">
            <div
              className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 ring-2 ring-primary/20"
              aria-hidden
            >
              <CheckCircle2 className="h-8 w-8 text-primary" strokeWidth={1.75} />
            </div>
            <CardTitle className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
              Transfer sent
            </CardTitle>
            <CardDescription className="text-sm text-muted-foreground">
              Your transfer has been sent privately.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6 px-6 pb-8 pt-4">
            <div className="flex flex-col gap-1 rounded-lg border border-border/50 bg-muted/10 px-5 py-5 text-center">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Transferred
              </p>
              <p className="mt-1 text-2xl font-bold tabular-nums tracking-tight text-foreground sm:text-3xl">
                {isValidAmount && token
                  ? `${formatAmount(amountBaseUnits)} ${token.label}`
                  : amount}
              </p>
              <p className="mt-2 text-xs text-muted-foreground font-mono truncate">
                To: {recipient}
              </p>
              {txSignature && (
                <a
                  href={`https://solscan.io/tx/${txSignature}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-flex items-center justify-center gap-1 text-xs text-primary hover:underline"
                >
                  View on Solscan
                  <ExternalLink className="size-3" />
                </a>
              )}
            </div>
            <Button
              onClick={() => {
                setStatus("idle");
                setAmount("");
                setRecipient("");
                setTxSignature(null);
                setBalancesChecked(false);
                setPublicBalanceBaseUnits(null);
                setPrivateBalanceBaseUnits(null);
              }}
              className="h-12 w-full rounded-lg bg-primary text-primary-foreground font-semibold shadow-lg shadow-primary/20 hover:bg-primary/90 hover:shadow-primary/25 active:translate-y-px transition-all"
            >
              <Send className="h-4 w-4" />
              New Transfer
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const stepConnect = !publicKey;
  const stepSign = publicKey && !balancesChecked;
  const stepTransfer = publicKey && balancesChecked;

  return (
    <div className="space-y-4">
      <Card className="border-border/50 bg-card/90 overflow-hidden rounded-2xl shadow-[0_0_0_1px_var(--border),0_8px_40px_-12px_oklch(0.72_0.15_220/8%)] dark:shadow-[0_0_0_1px_var(--border),0_8px_40px_-12px_black/30%]">
        <CardHeader className="space-y-2 px-6 pt-6 pb-4">
          <CardTitle className="text-lg font-semibold tracking-tight sm:text-xl">
            Private Transfer
          </CardTitle>
          <CardDescription className="text-sm text-muted-foreground">
            Send tokens privately to any Solana address.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5 px-6 pb-8">
          {/* Recipient */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <Label>Recipient address</Label>
              <WalletConnectButton size="sm" />
            </div>
            <Input
              type="text"
              placeholder="Paste a Solana address"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              autoComplete="off"
            />
            {recipient.trim() && !isValidRecipient && (
              <p className="text-xs text-red-500">Invalid Solana address</p>
            )}
          </div>

          {/* Amount */}
          <div className="space-y-2">
            <Label>Amount</Label>
            <AmountTokenInput
              amount={amount}
              onAmountChange={setAmount}
              token={tokenMint}
              onTokenChange={setTokenMint}
            />
          </div>

          {/* Balances — only shown after signing */}
          {stepTransfer &&
            publicBalanceBaseUnits !== null &&
            privateBalanceBaseUnits !== null &&
            token && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div className="flex items-center justify-between gap-2 rounded-lg border border-border/40 bg-background/40 px-2.5 py-1.5">
                  <div className="flex items-center gap-2 min-w-0">
                    {token.icon && (
                      <span
                        className="size-3.5 rounded-full bg-cover bg-center bg-no-repeat shrink-0"
                        style={{ backgroundImage: `url(${token.icon})` }}
                        role="img"
                        aria-hidden
                      />
                    )}
                    <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                      Public
                    </p>
                  </div>
                  <span className="text-xs font-semibold tabular-nums text-foreground">
                    {formatAmount(publicBalanceBaseUnits)} {token.label}
                  </span>
                </div>
                <div className="relative flex items-center justify-between gap-2 rounded-lg border border-cyan-400/60 bg-[radial-gradient(120%_120%_at_0%_0%,rgba(56,189,248,0.28),rgba(14,116,144,0.22),rgba(3,105,161,0.08))] px-2.5 py-1.5 shadow-[0_0_0_1px_rgba(56,189,248,0.6),0_0_18px_rgba(56,189,248,0.35)]">
                  <div className="flex items-center gap-2 min-w-0">
                    {token.icon && (
                      <span
                        className="size-3.5 rounded-full bg-cover bg-center bg-no-repeat shrink-0"
                        style={{ backgroundImage: `url(${token.icon})` }}
                        role="img"
                        aria-hidden
                      />
                    )}
                    <p className="text-[10px] font-semibold text-cyan-200 uppercase tracking-wider">
                      Private
                    </p>
                  </div>
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold tabular-nums text-cyan-100">
                    <Shield className="size-3 text-cyan-200" aria-hidden />
                    {formatAmount(privateBalanceBaseUnits)} {token.label}
                  </span>
                </div>
              </div>
            )}

          {/* Sign prompt — shown when wallet connected but not yet signed */}
          {stepSign && (
            <div className="rounded-xl border border-primary/25 bg-primary/5 p-3 space-y-2">
              <div className="flex items-center gap-3">
                <div className="rounded-full bg-primary/15 p-2 shrink-0" aria-hidden>
                  {isBusy ? (
                    <Loader2 className="size-5 text-primary animate-spin" aria-hidden />
                  ) : (
                    <FileSignature className="size-5 text-primary" aria-hidden />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">
                    {isBusy ? "Check your wallet" : "Sign to reveal private balance"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Sign in wallet — fetching private balance...
                  </p>
                </div>
              </div>
              {isBusy && displayLogs.length > 0 && (
                <p className="text-xs text-primary pl-11">
                  <Typewriter
                    text={displayLogs[displayLogs.length - 1] ?? "Requesting signature…"}
                    speedMs={90}
                  />
                </p>
              )}
              <div className="flex items-center gap-2 rounded-lg bg-background/50 px-3 py-2">
                <ShieldCheck className="size-4 text-primary shrink-0" aria-hidden />
                <span className="text-xs text-muted-foreground">
                  Signing does not send any transaction.
                </span>
              </div>
            </div>
          )}

          {/* Transfer summary — shown after balances are checked */}
          {publicKey && balancesChecked && (
            <div className="rounded-xl border border-border/50 bg-muted/10 px-3.5 py-2.5 space-y-2">
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                Transfer summary
              </p>
              <div className="grid grid-cols-1 gap-1.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">To recipient</span>
                  <span className="font-semibold tabular-nums">
                    {token ? `${formatAmount(amountBaseUnits)} ${token.label}` : "---"}
                  </span>
                </div>
                {payFeeBreakdown && payFeeBreakdown.feeBaseUnits > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Relayer fee</span>
                    <span className="tabular-nums">
                      {token
                        ? `${formatAmount(payFeeBreakdown.feeBaseUnits)} ${token.label}`
                        : "---"}
                    </span>
                  </div>
                )}
                <div className="flex items-center justify-between border-t border-border/50 pt-2">
                  <span className="text-muted-foreground font-medium">Total from private</span>
                  <span className="font-semibold tabular-nums">
                    {token ? `${formatAmount(requiredPrivateBaseUnits)} ${token.label}` : "---"}
                  </span>
                </div>
                {needsDeposit && shortfallBaseUnits !== null && (
                  <div className="flex items-center justify-between pt-1">
                    <span className="text-muted-foreground">Deposit</span>
                    <span className={cn("font-semibold tabular-nums", "text-amber-500")}>
                      {token ? `${formatAmount(shortfallBaseUnits)} ${token.label}` : "—"}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Activity log — only visible during SDK operations */}
          {isBusy && showActivityPanel && activityLogs.length > 0 && (
            <div
              className={cn(
                "rounded-xl border border-primary/20 bg-black/40 shadow-[inset_0_0_20px_oklch(0.72_0.15_220/6%)] overflow-hidden h-16 flex flex-col transition-[opacity,transform] duration-200 ease-out",
                activityExiting && "opacity-0 scale-[0.98] pointer-events-none"
              )}
            >
              <div className="flex items-center gap-2 border-b border-border/50 bg-muted/20 px-3 py-1 shrink-0">
                <Terminal className="size-3.5 text-primary" aria-hidden />
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Activity
                </span>
                <span
                  className="ml-auto size-1.5 rounded-full bg-primary animate-pulse"
                  aria-hidden
                />
              </div>
              <div
                ref={activityLogsRef}
                className="h-full min-h-0 overflow-y-auto overflow-x-hidden px-3 py-1 font-mono text-[11px] tabular-nums"
                role="log"
                aria-live="polite"
                aria-label="SDK activity log"
              >
                <div className="space-y-0.5">
                  {activityLogs.map((line, i) => (
                    <div
                      key={i}
                      className={cn(
                        "animate-log-line-in text-muted-foreground truncate",
                        line.startsWith("Error") && "text-red-400",
                        line.startsWith("Warn") && "text-amber-400",
                        line.startsWith("Info") && "text-primary/90"
                      )}
                    >
                      <span className="select-none text-muted-foreground/60">
                        {String(i + 1).padStart(2)}{" "}
                      </span>
                      {line}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded text-red-500 text-sm">
              {error}
            </div>
          )}

          <Button
            onClick={stepConnect ? undefined : stepSign ? undefined : handlePrimaryAction}
            disabled={
              stepConnect ||
              stepSign ||
              (isBusy && !isError) ||
              !isValidAmount ||
              !isValidRecipient ||
              (needsDeposit ? shortfallBaseUnits === null : !hasSufficientBalance)
            }
            variant={isError ? "destructive" : "default"}
            className={cn(
              "w-full h-14 gap-3 rounded-2xl text-lg font-semibold shadow-lg hover:shadow-xl active:translate-y-px active:shadow-md disabled:opacity-50 transition-all",
              !isError &&
                "bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80"
            )}
          >
            {isBusy && !isError ? (
              <Loader2 className="h-5 w-5 shrink-0 animate-spin" aria-hidden />
            ) : (
              <Send className="h-5 w-5" />
            )}
            {stepConnect
              ? "Connect wallet to transfer"
              : stepSign
                ? "Sign to continue"
                : buttonLabel}
          </Button>
          {needsDeposit && stepTransfer && (
            <p className="text-xs text-muted-foreground text-pretty text-center">
              Deposit, then click Transfer.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
