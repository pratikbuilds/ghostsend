"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWallet } from "@jup-ag/wallet-adapter";
import { Connection, PublicKey, VersionedTransaction } from "@solana/web3.js";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { WalletConnectButton } from "@/components/wallet-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  depositSOL,
  depositSPLToken,
  getPrivateSOLBalance,
  getPrivateSPLBalance,
  getSessionSignature,
  setLogger,
  signSessionMessage,
  WalletAdapter,
} from "@/lib/privacy-cash";
import { PaymentLinksAPI } from "@/lib/api-service";
import type { PaymentLinkPublicInfo } from "@/lib/payment-links-types";
import {
  formatTokenAmount,
  formatTokenAmountInput,
  getTokenByMint,
  getTokenStep,
  isSolMint,
  parseTokenAmountToBaseUnits,
} from "@/lib/token-registry";
import {
  getRelayerConfig,
  computeTotalLamportsForRecipient,
  computeTotalBaseUnitsForRecipientSPL,
} from "@/lib/fee-config";
import { Typewriter } from "@/components/ui/typewriter";
import { cn } from "@/lib/utils";
import {
  Wallet,
  FileSignature,
  Send,
  Loader2,
  ShieldCheck,
  Terminal,
  CheckCircle2,
} from "lucide-react";

const RPC_URL =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
  "https://api.mainnet-beta.solana.com";

interface PaymentReceiverProps {
  paymentId: string;
  /** When true, parent can hide page-level intro to avoid two log areas during sign step */
  onSigningChange?: (isSigning: boolean) => void;
}

type PaymentStatus =
  | "idle"
  | "checking"
  | "depositing"
  | "paying"
  | "success"
  | "error";

export function PaymentReceiver({
  paymentId,
  onSigningChange,
}: PaymentReceiverProps) {
  const { publicKey, signMessage, signTransaction } = useWallet();
  const [connection] = useState(() => new Connection(RPC_URL, "confirmed"));

  const [paymentLink, setPaymentLink] = useState<PaymentLinkPublicInfo | null>(
    null,
  );
  const [loadingLink, setLoadingLink] = useState(true);
  const [linkError, setLinkError] = useState<string | null>(null);

  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState<PaymentStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [publicBalanceBaseUnits, setPublicBalanceBaseUnits] = useState<
    number | null
  >(null);
  const [privateBalanceBaseUnits, setPrivateBalanceBaseUnits] = useState<
    number | null
  >(null);
  const [balancesChecked, setBalancesChecked] = useState(false);
  const [logQueue, setLogQueue] = useState<string[]>([]);
  const [displayLogs, setDisplayLogs] = useState<string[]>([]);
  const [activityLogs, setActivityLogs] = useState<string[]>([]);
  const [activityExiting, setActivityExiting] = useState(false);
  const [relayerConfig, setRelayerConfig] =
    useState<Awaited<ReturnType<typeof getRelayerConfig>>>(null);
  const lastLogRef = useRef<string | null>(null);
  const activityLogsRef = useRef<HTMLDivElement>(null);
  const activityExitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const token = useMemo(
    () => (paymentLink ? getTokenByMint(paymentLink.tokenMint) : undefined),
    [paymentLink],
  );

  const isSolToken = token ? isSolMint(token.mint) : false;

  useEffect(() => {
    const fetchPaymentLink = async () => {
      try {
        const result = await PaymentLinksAPI.getPaymentLink(paymentId);
        if (!result.success || !result.data) {
          throw new Error(result.error || "Payment link not found");
        }

        const link = result.data.paymentLink;
        setPaymentLink(link);

        if (link.amountType === "fixed") {
          setAmount("");
        }
      } catch (err) {
        setLinkError(
          err instanceof Error ? err.message : "Failed to load payment link",
        );
      } finally {
        setLoadingLink(false);
      }
    };

    fetchPaymentLink();
  }, [paymentId]);

  useEffect(() => {
    if (!paymentLink || !token) return;
    if (paymentLink.amountType !== "fixed" || !paymentLink.fixedAmount) return;
    setAmount(formatTokenAmountInput(paymentLink.fixedAmount, token));
  }, [paymentLink, token]);

  useEffect(() => {
    setLogger((level, message) => {
      const prefix =
        level === "error" ? "Error" : level === "warn" ? "Warn" : "Info";
      const nextMessage = `${prefix}: ${message}`;
      if (lastLogRef.current === nextMessage) return;
      lastLogRef.current = nextMessage;
      setLogQueue((prev) => [...prev, nextMessage]);
      setActivityLogs((prev) => [...prev.slice(-11), nextMessage]);
    });
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
    [],
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
        ? (await getPrivateSOLBalance({ connection, wallet: walletAdapter }))
            .lamports
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
  }, [connection, getWalletAdapter, isSolToken, publicKey, token]);

  useEffect(() => {
    if (!publicKey || !token || balancesChecked || status === "checking")
      return;
    fetchBalances();
  }, [balancesChecked, fetchBalances, publicKey, status, token]);

  useEffect(() => {
    getRelayerConfig().then(setRelayerConfig);
  }, []);

  const formatAmount = useCallback(
    (baseUnits: number) => {
      if (!token) return "---";
      return formatTokenAmount(baseUnits, token);
    },
    [token],
  );

  const tokenLabel = token?.label ?? "Token";

  const amountBaseUnits = useMemo(() => {
    if (!token) return 0;
    const parsed = parseTokenAmountToBaseUnits(amount, token);
    return Number.isFinite(parsed) ? parsed : 0;
  }, [amount, token]);

  const isValidAmount = amountBaseUnits > 0;

  const payFeeBreakdown = useMemo(() => {
    if (!isValidAmount || !token) return null;
    if (isSolToken) {
      const { totalLamports, feeLamports } = computeTotalLamportsForRecipient(
        amountBaseUnits,
        relayerConfig,
      );
      return {
        toRecipientBaseUnits: amountBaseUnits,
        feeBaseUnits: feeLamports,
        totalFromPrivateBaseUnits: totalLamports,
      };
    }
    const { totalBaseUnits, feeBaseUnits } =
      computeTotalBaseUnitsForRecipientSPL(
        amountBaseUnits,
        token.unitsPerToken,
        token.name,
        relayerConfig,
      );
    return {
      toRecipientBaseUnits: amountBaseUnits,
      feeBaseUnits,
      totalFromPrivateBaseUnits: totalBaseUnits,
    };
  }, [amountBaseUnits, isSolToken, isValidAmount, relayerConfig, token]);

  const requiredPrivateBaseUnits =
    payFeeBreakdown?.totalFromPrivateBaseUnits ?? 0;

  const shortfallBaseUnits =
    privateBalanceBaseUnits !== null
      ? Math.max(0, requiredPrivateBaseUnits - privateBalanceBaseUnits)
      : null;

  const isBusy =
    status === "checking" || status === "depositing" || status === "paying";
  const hasSufficientBalance =
    privateBalanceBaseUnits !== null &&
    privateBalanceBaseUnits >= requiredPrivateBaseUnits;
  const needsDeposit = shortfallBaseUnits !== null && shortfallBaseUnits > 0;

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

  const showActivityPanel =
    (isBusy || activityExiting) && activityLogs.length > 0;
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
      if (activityExitTimeoutRef.current)
        clearTimeout(activityExitTimeoutRef.current);
    };
  }, [isBusy, activityLogs.length, activityExiting]);

  const isSigning = Boolean(publicKey && !balancesChecked && isBusy);
  useEffect(() => {
    onSigningChange?.(isSigning);
    return () => onSigningChange?.(false);
  }, [isSigning, onSigningChange]);

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
    [connection, fetchBalances, getWalletAdapter, isSolToken, publicKey, token],
  );

  const isDepositing = status === "depositing";
  const isPaying = status === "paying";
  const isChecking = status === "checking";
  const isError = status === "error";
  const buttonLabel = isChecking
    ? "Checking balance…"
    : isDepositing
      ? "Depositing…"
      : isPaying
        ? "Paying…"
        : isError
          ? "Try again"
          : needsDeposit
            ? `Deposit ${token && shortfallBaseUnits !== null ? `${formatAmount(shortfallBaseUnits)} ${token.label}` : "---"}`
            : `Pay ${token ? `${formatAmount(amountBaseUnits)} ${token.label}` : "---"}`;

  const handlePay = useCallback(async () => {
    if (!paymentLink) return;
    if (!publicKey || !token) return;
    if (!isValidAmount) {
      setError("Please enter a valid amount");
      return;
    }
    setStatus("paying");
    setError(null);
    const payLog = "Info: Preparing private withdrawal...";
    setLogQueue((prev) => [...prev, payLog]);
    setActivityLogs((prev) => [...prev.slice(-11), payLog]);

    try {
      const walletAdapter = getWalletAdapter();
      // Same as before: total to deduct (recipient + fee) for SDK; backend resolves recipient from paymentId
      const totalToDeduct =
        payFeeBreakdown?.totalFromPrivateBaseUnits ?? amountBaseUnits;

      await (async () => {
        const existingSignature = getSessionSignature(walletAdapter.publicKey);
        const signature =
          existingSignature ?? (await signSessionMessage(walletAdapter));
        const signatureBase64 = toBase64(signature);

        const withdrawApiResult = await PaymentLinksAPI.withdrawPayment(
          paymentId,
          isSolToken
            ? {
                amountLamports: totalToDeduct,
                publicKey: walletAdapter.publicKey.toBase58(),
                signature: signatureBase64,
              }
            : {
                amountBaseUnits: totalToDeduct,
                publicKey: walletAdapter.publicKey.toBase58(),
                signature: signatureBase64,
              },
        );

        if (!withdrawApiResult.success) {
          throw new Error(withdrawApiResult.error || "Backend withdraw failed");
        }
      })();

      setStatus("success");
      setLogQueue([]);
      setDisplayLogs([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Payment failed");
      setStatus("error");
    }
  }, [
    amountBaseUnits,
    getWalletAdapter,
    isSolToken,
    isValidAmount,
    payFeeBreakdown,
    paymentId,
    paymentLink,
    publicKey,
    token,
  ]);

  const handlePrimaryAction = useCallback(async () => {
    if (!publicKey) return;
    if (!isValidAmount) {
      setError("Please enter a valid amount");
      return;
    }
    if (needsDeposit && shortfallBaseUnits) {
      await handleDeposit(shortfallBaseUnits);
      return;
    }
    await handlePay();
  }, [
    handleDeposit,
    handlePay,
    isValidAmount,
    needsDeposit,
    publicKey,
    shortfallBaseUnits,
  ]);

  const toBase64 = (bytes: Uint8Array) => {
    let binary = "";
    bytes.forEach((b) => {
      binary += String.fromCharCode(b);
    });
    return btoa(binary);
  };

  const cardClass =
    "w-full max-w-2xl mx-auto overflow-hidden rounded-2xl border-border/50 bg-card/90 shadow-[0_0_0_1px_var(--border),0_8px_40px_-12px_oklch(0.72_0.15_220/12%)] dark:shadow-[0_0_0_1px_var(--border),0_8px_40px_-12px_black/40%]";

  if (loadingLink) {
    return (
      <Card className={cardClass}>
        <CardContent className="py-12">
          <div className="flex flex-col items-center gap-4">
            <div className="size-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            <p className="text-sm text-muted-foreground">
              Loading payment request...
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (linkError || !paymentLink) {
    return (
      <Card className={cardClass}>
        <CardHeader className="px-6 pt-6 pb-4">
          <CardTitle className="text-lg font-semibold tracking-tight">
            Payment Link Not Found
          </CardTitle>
        </CardHeader>
        <CardContent className="px-6 pb-8">
          <div className="rounded-lg p-4 bg-red-500/10 border border-red-500/20 text-red-500 text-sm">
            {linkError || "This payment link does not exist or has expired."}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (paymentLink.status !== "active") {
    return (
      <Card className={cardClass}>
        <CardHeader className="px-6 pt-6 pb-4">
          <CardTitle className="text-lg font-semibold tracking-tight">
            Payment Link Unavailable
          </CardTitle>
        </CardHeader>
        <CardContent className="px-6 pb-8">
          <div className="rounded-lg p-4 bg-yellow-500/10 border border-yellow-500/20 text-yellow-600 text-sm">
            This payment link is no longer active.
          </div>
        </CardContent>
      </Card>
    );
  }

  if (status === "success") {
    return (
      <Card className={cn(cardClass, "animate-success-in")}>
        <CardHeader className="space-y-3 px-6 pt-8 pb-2 text-center">
          <div
            className="mx-auto flex size-14 items-center justify-center rounded-full bg-primary/10 ring-2 ring-primary/20"
            aria-hidden
          >
            <CheckCircle2 className="size-8 text-primary" strokeWidth={1.75} />
          </div>
          <CardTitle className="text-xl font-semibold tracking-tight sm:text-2xl">
            Payment sent
          </CardTitle>
          <CardDescription className="text-sm text-muted-foreground">
            Your payment has been sent privately.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6 px-6 pb-8 pt-4">
          <div className="rounded-lg border border-border/50 bg-muted/20 px-5 py-4 text-center">
            <p className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
              Paid
            </p>
            <p className="mt-1 text-xl font-bold tabular-nums tracking-tight text-foreground sm:text-2xl">
              {isValidAmount && token
                ? `${formatAmount(amountBaseUnits)} ${token.label}`
                : amount}{" "}
              paid privately
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              On-chain; your identity stays private.
            </p>
          </div>
          <Button
            asChild
            className="btn-neon h-14 w-full rounded-lg bg-primary text-primary-foreground text-lg font-semibold"
          >
            <a href="/">Done</a>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const stepConnect = !publicKey;
  const stepSign = publicKey && !balancesChecked;
  const stepPay = publicKey && balancesChecked;

  return (
    <Card className="w-full max-w-2xl mx-auto overflow-hidden rounded-2xl border-border/50 bg-card/90 shadow-[0_0_0_1px_var(--border),0_8px_40px_-12px_oklch(0.72_0.15_220/12%)] dark:shadow-[0_0_0_1px_var(--border),0_8px_40px_-12px_black/40%] max-h-full flex flex-col min-h-0">
      <CardHeader className="space-y-2 px-5 pt-5 pb-3 shrink-0">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <CardTitle className="text-lg font-semibold tracking-tight sm:text-xl text-balance">
              {paymentLink.label || "Payment Request"}
            </CardTitle>
            <CardDescription className="text-sm text-muted-foreground">
              Pay privately with ghostsend
            </CardDescription>
          </div>
          {token && (
            <div className="flex items-center gap-1.5 shrink-0 rounded-full border border-border/50 bg-muted/50 px-2.5 py-1">
              {token.icon ? (
                <span
                  className="size-5 rounded-full bg-cover bg-center bg-no-repeat shrink-0"
                  style={{ backgroundImage: `url(${token.icon})` }}
                  role="img"
                  aria-hidden
                />
              ) : null}
              <span className="text-xs font-medium text-foreground">
                {token.label}
              </span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 pt-2" aria-label="Progress">
          <div
            className={cn(
              "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
              stepConnect
                ? "bg-primary/15 text-primary"
                : "bg-muted text-muted-foreground",
            )}
          >
            <Wallet className="size-3.5" aria-hidden />
            <span>1. Connect</span>
          </div>
          <div className="h-px w-3 bg-border" aria-hidden />
          <div
            className={cn(
              "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
              stepSign
                ? "bg-primary/15 text-primary"
                : stepPay
                  ? "bg-muted text-muted-foreground"
                  : "bg-muted/60 text-muted-foreground",
            )}
          >
            <FileSignature className="size-3.5" aria-hidden />
            <span>2. Sign</span>
          </div>
          <div className="h-px w-3 bg-border" aria-hidden />
          <div
            className={cn(
              "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
              stepPay
                ? "bg-primary/15 text-primary"
                : "bg-muted/60 text-muted-foreground",
            )}
          >
            <Send className="size-3.5" aria-hidden />
            <span>3. Pay</span>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 px-5 pb-6 pt-0 min-h-0 flex flex-col">
        {paymentLink.message && (
          <div className="rounded-lg border border-border/50 bg-muted/20 px-3 py-2 shrink-0">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Message
            </p>
            <p className="mt-1 text-sm text-foreground text-pretty line-clamp-2">
              "{paymentLink.message}"
            </p>
          </div>
        )}

        <div className="space-y-1.5 shrink-0">
          <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Amount
          </Label>
          <div className="relative">
            <Input
              type={paymentLink.amountType === "fixed" ? "text" : "number"}
              step={
                paymentLink.amountType === "fixed"
                  ? undefined
                  : token
                    ? getTokenStep(token)
                    : "0.001"
              }
              value={amount}
              readOnly={paymentLink.amountType === "fixed"}
              onChange={(e) => setAmount(e.target.value)}
              className="h-11 rounded-lg border-input bg-muted/30 font-semibold pr-20 tabular-nums"
            />
            <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1.5 pointer-events-none">
              {token?.icon ? (
                <span
                  className="size-5 rounded-full bg-cover bg-center bg-no-repeat shrink-0"
                  style={{ backgroundImage: `url(${token.icon})` }}
                  role="img"
                  aria-hidden
                />
              ) : null}
              <span className="text-xs font-semibold tabular-nums">
                {tokenLabel}
              </span>
            </div>
          </div>
        </div>

        <Separator />

        <div className="space-y-3">
          <div className="flex flex-row flex-wrap items-start justify-between gap-3 rounded-xl border border-border/50 bg-muted/10 px-4 py-3">
            <div className="flex flex-col gap-2 min-w-0 flex-1">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Wallet
              </p>
              {stepPay &&
                publicBalanceBaseUnits !== null &&
                privateBalanceBaseUnits !== null &&
                token && (
                  <div className="flex flex-wrap gap-3">
                    <div className="flex items-center gap-2 rounded-lg border border-border/40 bg-background/50 px-3 py-2 min-w-0">
                      {token.icon && (
                        <span
                          className="size-4 rounded-full bg-cover bg-center bg-no-repeat shrink-0"
                          style={{ backgroundImage: `url(${token.icon})` }}
                          role="img"
                          aria-hidden
                        />
                      )}
                      <div className="min-w-0">
                        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                          Public
                        </p>
                        <p className="text-xs font-semibold tabular-nums text-foreground">
                          {formatAmount(publicBalanceBaseUnits)} {token.label}
                        </p>
                        <p className="text-[10px] text-muted-foreground/80">
                          On-chain, visible
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 min-w-0">
                      {token.icon && (
                        <span
                          className="size-4 rounded-full bg-cover bg-center bg-no-repeat shrink-0"
                          style={{ backgroundImage: `url(${token.icon})` }}
                          role="img"
                          aria-hidden
                        />
                      )}
                      <div className="min-w-0">
                        <p className="text-[10px] font-medium text-primary/90 uppercase tracking-wider">
                          Private
                        </p>
                        <p className="text-xs font-semibold tabular-nums text-foreground">
                          {formatAmount(privateBalanceBaseUnits)} {token.label}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          Shielded, private
                        </p>
                      </div>
                    </div>
                  </div>
                )}
            </div>
            <div className="shrink-0 ml-auto">
              <WalletConnectButton size="sm" />
            </div>
          </div>

          {stepConnect && (
            <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-muted/30 py-6 px-4 text-center">
              <div className="rounded-full bg-primary/10 p-3" aria-hidden>
                <Wallet className="size-6 text-primary" />
              </div>
              <p className="text-xs text-muted-foreground text-pretty max-w-xs">
                Connect wallet to see balances and pay.
              </p>
            </div>
          )}

          {stepSign && (
            <div className="rounded-xl border border-primary/25 bg-primary/5 p-4 space-y-2">
              <div className="flex items-center gap-3">
                <div
                  className="rounded-full bg-primary/15 p-2 shrink-0"
                  aria-hidden
                >
                  {isBusy ? (
                    <Loader2
                      className="size-5 text-primary animate-spin"
                      aria-hidden
                    />
                  ) : (
                    <FileSignature
                      className="size-5 text-primary"
                      aria-hidden
                    />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">
                    {isBusy
                      ? "Check your wallet"
                      : "Sign to reveal private balance"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Sign in wallet — no funds sent, free.
                  </p>
                </div>
              </div>
              {isBusy && showActivityPanel && (
                <p className="text-xs text-muted-foreground/90 pl-11">
                  See activity below for status.
                </p>
              )}
              {isBusy && !showActivityPanel && (
                <p className="text-xs text-primary pl-11">
                  <Typewriter
                    text={
                      displayLogs[displayLogs.length - 1] ??
                      "Requesting signature…"
                    }
                    speedMs={90}
                  />
                </p>
              )}
              <div className="flex items-center gap-2 rounded-lg bg-background/50 px-3 py-2">
                <ShieldCheck
                  className="size-4 text-primary shrink-0"
                  aria-hidden
                />
                <span className="text-xs text-muted-foreground">
                  Signing does not send any transaction.
                </span>
              </div>
            </div>
          )}
        </div>

        {showActivityPanel && activityLogs.length > 0 && (
          <div
            className={cn(
              "rounded-xl border border-primary/20 bg-black/40 shadow-[inset_0_0_20px_oklch(0.72_0.15_220/6%)] overflow-hidden h-20 flex flex-col transition-[opacity,transform] duration-200 ease-out",
              activityExiting && "opacity-0 scale-[0.98] pointer-events-none",
            )}
          >
            <div className="flex items-center gap-2 border-b border-border/50 bg-muted/20 px-3 py-1.5 shrink-0">
              <Terminal className="size-3.5 text-primary" aria-hidden />
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Activity
              </span>
              {isBusy && (
                <span
                  className="ml-auto size-1.5 rounded-full bg-primary animate-pulse"
                  aria-hidden
                />
              )}
            </div>
            <div
              ref={activityLogsRef}
              className="h-full min-h-0 overflow-y-auto overflow-x-hidden px-3 py-1.5 font-mono text-xs tabular-nums"
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
                      line.startsWith("Info") && "text-primary/90",
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

        {publicKey && balancesChecked && (
          <>
            <div className="rounded-xl border border-border/50 bg-muted/10 px-4 py-3 space-y-2.5 shrink-0">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Payment summary
              </p>
              <div className="grid grid-cols-1 gap-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">To recipient</span>
                  <span className="font-semibold tabular-nums">
                    {token
                      ? `${formatAmount(amountBaseUnits)} ${token.label}`
                      : "---"}
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
                  <span className="text-muted-foreground font-medium">
                    Total from private
                  </span>
                  <span className="font-semibold tabular-nums">
                    {token
                      ? `${formatAmount(requiredPrivateBaseUnits)} ${token.label}`
                      : "---"}
                  </span>
                </div>
                {needsDeposit && shortfallBaseUnits !== null && (
                  <div className="flex items-center justify-between pt-1">
                    <span className="text-muted-foreground">
                      Deposit (no fee)
                    </span>
                    <span
                      className={cn(
                        "font-semibold tabular-nums",
                        "text-amber-500",
                      )}
                    >
                      {token
                        ? `${formatAmount(shortfallBaseUnits)} ${token.label}`
                        : "—"}
                    </span>
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-1 shrink-0">
              <Button
                onClick={handlePrimaryAction}
                disabled={
                  (isBusy && !isError) ||
                  !isValidAmount ||
                  (needsDeposit
                    ? shortfallBaseUnits === null
                    : !hasSufficientBalance)
                }
                variant={isError ? "destructive" : "default"}
                className={cn(
                  "h-12 w-full gap-2 rounded-lg text-base font-semibold",
                  !isError && "btn-neon bg-primary text-primary-foreground",
                )}
              >
                {isBusy && !isError ? (
                  <Loader2
                    className="size-5 shrink-0 animate-spin"
                    aria-hidden
                  />
                ) : token?.icon && !isError ? (
                  <span
                    className="size-5 rounded-full bg-cover bg-center bg-no-repeat shrink-0"
                    style={{ backgroundImage: `url(${token.icon})` }}
                    role="img"
                    aria-hidden
                  />
                ) : null}
                {buttonLabel}
              </Button>
              {needsDeposit && (
                <p className="text-xs text-muted-foreground text-pretty text-center">
                  Deposit, then click Pay.
                </p>
              )}
            </div>
          </>
        )}

        {error && (
          <div className="rounded-lg p-3 bg-red-500/10 border border-red-500/20 text-red-500 text-sm">
            {error}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
