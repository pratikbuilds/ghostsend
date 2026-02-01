"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWallet } from "@jup-ag/wallet-adapter";
import { Connection, LAMPORTS_PER_SOL, PublicKey, VersionedTransaction } from "@solana/web3.js";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { WalletConnectButton } from "@/components/wallet-button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  getTokenStep,
  isSolMint,
  parseTokenAmountToBaseUnits,
  SOL_MINT,
  tokenRegistry,
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
  ChevronRight,
  FileSignature,
  Send,
  Loader2,
  Shield,
  ShieldCheck,
  Terminal,
  CheckCircle2,
  ExternalLink,
  Plus,
  X,
} from "lucide-react";

const RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
const MAX_RECIPIENTS = 5;

type TransferStatus = "idle" | "checking" | "depositing" | "transferring" | "success" | "error";
type RecipientEntry = { id: string; address: string; amount: string };

export function PrivateTransfer() {
  const { publicKey, signMessage, signTransaction } = useWallet();
  const [connection] = useState(() => new Connection(RPC_URL, "confirmed"));

  const [recipients, setRecipients] = useState<RecipientEntry[]>([
    { id: "r1", address: "", amount: "" },
  ]);
  const [tokenMint, setTokenMint] = useState<TokenMint>(SOL_MINT);
  const [status, setStatus] = useState<TransferStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [publicBalanceBaseUnits, setPublicBalanceBaseUnits] = useState<number | null>(null);
  const [privateBalanceBaseUnits, setPrivateBalanceBaseUnits] = useState<number | null>(null);
  const [balancesChecked, setBalancesChecked] = useState(false);
  const [txSignatures, setTxSignatures] = useState<string[]>([]);
  const [logQueue, setLogQueue] = useState<string[]>([]);
  const [displayLogs, setDisplayLogs] = useState<string[]>([]);
  const [activityLogs, setActivityLogs] = useState<string[]>([]);
  const [activityExiting, setActivityExiting] = useState(false);
  const [activityExpanded, setActivityExpanded] = useState(false);
  const [relayerConfig, setRelayerConfig] =
    useState<Awaited<ReturnType<typeof getRelayerConfig>>>(null);
  const lastLogRef = useRef<string | null>(null);
  const activityLogsRef = useRef<HTMLDivElement>(null);
  const activityExitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nextRecipientIdRef = useRef(1);

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

  const updateRecipient = useCallback((id: string, updates: Partial<RecipientEntry>) => {
    setRecipients((prev) =>
      prev.map((entry) => (entry.id === id ? { ...entry, ...updates } : entry))
    );
  }, []);

  const addRecipient = useCallback(() => {
    setRecipients((prev) => {
      if (prev.length >= MAX_RECIPIENTS) return prev;
      const nextId = nextRecipientIdRef.current + 1;
      nextRecipientIdRef.current = nextId;
      return [...prev, { id: `r${nextId}`, address: "", amount: "" }];
    });
  }, []);

  const removeRecipient = useCallback((id: string) => {
    setRecipients((prev) => (prev.length <= 1 ? prev : prev.filter((entry) => entry.id !== id)));
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

  const tokenStep = useMemo(() => (token ? getTokenStep(token) : "0.001"), [token]);

  const minimumBaseUnits = useMemo(() => {
    if (!token || !relayerConfig) return 0;
    const minHuman = relayerConfig.minimum_withdrawal[token.name];
    if (minHuman == null || minHuman <= 0) return 0;
    if (isSolToken) return Math.floor(minHuman * LAMPORTS_PER_SOL);
    return Math.floor(minHuman * token.unitsPerToken);
  }, [isSolToken, relayerConfig, token]);

  const recipientRows = useMemo(() => {
    return recipients.map((entry) => {
      const address = entry.address.trim();
      const hasAddress = address.length > 0;
      let isValidAddress = false;
      if (hasAddress) {
        try {
          new PublicKey(address);
          isValidAddress = true;
        } catch {
          isValidAddress = false;
        }
      }
      const hasAmount = entry.amount.trim().length > 0;
      const parsed = token ? parseTokenAmountToBaseUnits(entry.amount, token) : NaN;
      const amountBaseUnits = Number.isFinite(parsed) ? parsed : 0;
      const meetsMinimum = minimumBaseUnits === 0 || amountBaseUnits >= minimumBaseUnits;
      const isValidAmount = hasAmount && amountBaseUnits > 0 && meetsMinimum;
      const belowMinimum = hasAmount && amountBaseUnits > 0 && !meetsMinimum;
      const isEmpty = !hasAddress && !hasAmount;
      const breakdown =
        isValidAddress && isValidAmount && token
          ? isSolToken
            ? (() => {
                const { totalLamports, feeLamports } = computeTotalLamportsForRecipient(
                  amountBaseUnits,
                  relayerConfig
                );
                const c = relayerConfig ?? { withdraw_rent_fee: 0.006 };
                const rentLamports = Math.floor(LAMPORTS_PER_SOL * c.withdraw_rent_fee);
                const rateLamports = feeLamports - rentLamports;
                return {
                  toRecipientBaseUnits: amountBaseUnits,
                  feeBaseUnits: feeLamports,
                  rentBaseUnits: rentLamports,
                  rateFeeBaseUnits: Math.max(0, rateLamports),
                  totalFromPrivateBaseUnits: totalLamports,
                };
              })()
            : (() => {
                const { totalBaseUnits, feeBaseUnits } = computeTotalBaseUnitsForRecipientSPL(
                  amountBaseUnits,
                  token.unitsPerToken,
                  token.name,
                  relayerConfig
                );
                const c = relayerConfig ?? { rent_fees: {} as Record<string, number> };
                const tokenRentFee = (c.rent_fees as Record<string, number>)[token.name] ?? 0.001;
                const rentBaseUnits = Math.floor(token.unitsPerToken * tokenRentFee);
                const rateFeeBaseUnits = Math.max(0, feeBaseUnits - rentBaseUnits);
                return {
                  toRecipientBaseUnits: amountBaseUnits,
                  feeBaseUnits,
                  rentBaseUnits,
                  rateFeeBaseUnits,
                  totalFromPrivateBaseUnits: totalBaseUnits,
                };
              })()
          : null;
      return {
        ...entry,
        address,
        hasAddress,
        hasAmount,
        amountBaseUnits,
        isValidAddress,
        isValidAmount,
        belowMinimum,
        isEmpty,
        breakdown,
      };
    });
  }, [isSolToken, minimumBaseUnits, recipients, relayerConfig, token]);

  const activeRecipients = useMemo(
    () => recipientRows.filter((row) => !row.isEmpty),
    [recipientRows]
  );
  const hasRecipients = activeRecipients.length > 0;
  const hasInvalidRecipients = activeRecipients.some(
    (row) => !row.isValidAddress || !row.isValidAmount
  );
  const validRecipients = useMemo(
    () => activeRecipients.filter((row) => row.isValidAddress && row.isValidAmount),
    [activeRecipients]
  );

  const totalBreakdown = useMemo(() => {
    if (!token || !hasRecipients || hasInvalidRecipients) return null;
    return validRecipients.reduce(
      (acc, row) => {
        if (!row.breakdown) return acc;
        acc.toRecipients += row.breakdown.toRecipientBaseUnits;
        acc.fee += row.breakdown.feeBaseUnits;
        acc.rent += row.breakdown.rentBaseUnits ?? 0;
        acc.rateFee += row.breakdown.rateFeeBaseUnits ?? 0;
        acc.totalFromPrivate += row.breakdown.totalFromPrivateBaseUnits;
        return acc;
      },
      { toRecipients: 0, fee: 0, rent: 0, rateFee: 0, totalFromPrivate: 0 }
    );
  }, [hasInvalidRecipients, hasRecipients, token, validRecipients]);

  const requiredPrivateBaseUnits = totalBreakdown?.totalFromPrivate ?? 0;
  const shortfallBaseUnits =
    privateBalanceBaseUnits !== null
      ? Math.max(0, requiredPrivateBaseUnits - privateBalanceBaseUnits)
      : null;

  const isBusy = status === "checking" || status === "depositing" || status === "transferring";
  const hasSufficientBalance =
    privateBalanceBaseUnits !== null && privateBalanceBaseUnits >= requiredPrivateBaseUnits;
  const needsDeposit = shortfallBaseUnits !== null && shortfallBaseUnits > 0;

  const rentPerRecipientDisplay = useMemo(() => {
    if (!token || !relayerConfig) return null;
    if (isSolToken) {
      const rent = relayerConfig.withdraw_rent_fee;
      return rent != null ? `${rent < 0.01 ? rent.toFixed(4) : rent.toFixed(2)} SOL` : null;
    }
    const rent = (relayerConfig.rent_fees as Record<string, number>)[token.name];
    if (rent == null) return null;
    const str = rent < 0.01 ? rent.toFixed(4) : rent.toFixed(2);
    return `${str} ${token.label}`;
  }, [isSolToken, relayerConfig, token]);

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
        setActivityExpanded(false);
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
    if (!hasRecipients) {
      setError("Add at least one recipient");
      return;
    }
    if (hasInvalidRecipients) {
      setError("Please fix recipient addresses and amounts");
      return;
    }
    setStatus("transferring");
    setError(null);
    const transferLog = "Info: Preparing private transfer...";
    setLogQueue((prev) => [...prev, transferLog]);
    setActivityLogs((prev) => [...prev.slice(-11), transferLog]);

    try {
      const walletAdapter = getWalletAdapter();
      const signatures: string[] = [];
      for (const [index, row] of validRecipients.entries()) {
        const perRecipientLog = `Info: Sending to recipient ${index + 1}/${
          validRecipients.length
        }...`;
        setLogQueue((prev) => [...prev, perRecipientLog]);
        setActivityLogs((prev) => [...prev.slice(-11), perRecipientLog]);

        const totalToDeduct = row.breakdown?.totalFromPrivateBaseUnits ?? row.amountBaseUnits;
        const result = isSolToken
          ? await withdrawSOL({
              connection,
              wallet: walletAdapter,
              amount_in_lamports: totalToDeduct,
              recipient: row.address,
            })
          : await withdrawSPLToken({
              connection,
              wallet: walletAdapter,
              mintAddress: token.mint,
              base_units: totalToDeduct,
              recipient: row.address,
            });

        signatures.push(result.tx);
      }

      setTxSignatures(signatures);
      setStatus("success");
      setLogQueue([]);
      setDisplayLogs([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Transfer failed");
      setStatus("error");
    }
  }, [
    connection,
    getWalletAdapter,
    hasInvalidRecipients,
    hasRecipients,
    isSolToken,
    publicKey,
    token,
    validRecipients,
  ]);

  const handlePrimaryAction = useCallback(async () => {
    if (!publicKey) return;
    if (!hasRecipients) {
      setError("Add at least one recipient");
      return;
    }
    if (hasInvalidRecipients) {
      setError("Please fix recipient addresses and amounts");
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
    hasInvalidRecipients,
    hasRecipients,
    needsDeposit,
    publicKey,
    shortfallBaseUnits,
  ]);

  const isDepositing = status === "depositing";
  const isTransferring = status === "transferring";
  const isChecking = status === "checking";
  const isError = status === "error";
  const recipientCount = validRecipients.length;
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
            : token && totalBreakdown && recipientCount > 0
              ? `Transfer ${formatAmount(totalBreakdown.toRecipients)} ${token.label} to ${recipientCount} ${recipientCount === 1 ? "recipient" : "recipients"}`
              : "Transfer";

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
              Transfers sent
            </CardTitle>
            <CardDescription className="text-sm text-muted-foreground">
              Sent privately to {recipientCount} {recipientCount === 1 ? "recipient" : "recipients"}
              .
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6 px-6 pb-8 pt-4">
            <div className="flex flex-col gap-1 rounded-lg border border-border/50 bg-muted/10 px-5 py-5 text-center">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Total sent
              </p>
              <p className="mt-1 text-2xl font-bold tabular-nums tracking-tight text-foreground sm:text-3xl">
                {token && totalBreakdown
                  ? `${formatAmount(totalBreakdown.toRecipients)} ${token.label}`
                  : "---"}
              </p>
              <p className="mt-2 text-xs text-muted-foreground font-mono truncate">
                {recipientCount} {recipientCount === 1 ? "recipient" : "recipients"}
              </p>
            </div>
            {validRecipients.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Recipients
                </p>
                <div className="space-y-2 rounded-lg border border-border/50 bg-muted/10 px-3 py-2">
                  {validRecipients.map((row, index) => {
                    const signature = txSignatures[index];
                    return (
                      <div key={row.id} className="flex items-center gap-3">
                        <div className="min-w-0 flex-1">
                          <span className="text-xs font-mono truncate block">{row.address}</span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-xs font-semibold tabular-nums text-foreground">
                            {token ? `${formatAmount(row.amountBaseUnits)} ${token.label}` : "---"}
                          </span>
                          {signature && (
                            <a
                              href={`https://solscan.io/tx/${signature}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                              aria-label={`View transaction for recipient ${index + 1}`}
                            >
                              Tx
                              <ExternalLink className="size-3" />
                            </a>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            <Button
              onClick={() => {
                setStatus("idle");
                setRecipients([{ id: "r1", address: "", amount: "" }]);
                nextRecipientIdRef.current = 1;
                setTxSignatures([]);
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
      <Card className="flex max-h-[min(90vh,42rem)] flex-col overflow-hidden rounded-2xl border-border/50 bg-card/90 shadow-[0_0_0_1px_var(--border),0_8px_40px_-12px_oklch(0.72_0.15_220/8%)] dark:shadow-[0_0_0_1px_var(--border),0_8px_40px_-12px_black/30%]">
        <CardHeader className="shrink-0 space-y-2 px-6 pt-6 pb-4">
          <CardTitle className="text-lg font-semibold tracking-tight sm:text-xl">
            Private Transfer
          </CardTitle>
          <CardDescription className="text-sm text-muted-foreground">
            Send tokens privately to up to five Solana addresses at once.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col overflow-hidden px-6 pb-6">
          <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto overflow-x-hidden">
            {/* Token */}
            <div className="space-y-2">
              <Label>Token</Label>
              <Select value={tokenMint} onValueChange={(value) => setTokenMint(value as TokenMint)}>
                <SelectTrigger className="h-11 rounded-lg">
                  <SelectValue placeholder="Select token">
                    {token ? (
                      <span className="flex items-center gap-2.5">
                        <Image
                          src={token.icon}
                          alt={`${token.label} icon`}
                          className="h-6 w-6 rounded-full shrink-0"
                          loading="lazy"
                          width={24}
                          height={24}
                        />
                        <span className="uppercase text-sm font-semibold">{token.label}</span>
                      </span>
                    ) : null}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {tokenRegistry.map((option) => (
                    <SelectItem key={option.mint} value={option.mint} textValue={option.label}>
                      <span className="flex items-center gap-2.5">
                        <Image
                          src={option.icon}
                          alt={`${option.label} icon`}
                          className="h-5 w-5 rounded-full shrink-0"
                          loading="lazy"
                          width={20}
                          height={20}
                        />
                        <span className="flex items-center gap-2">
                          <span className="uppercase">{option.label}</span>
                          {option.note ? (
                            <span className="text-muted-foreground text-xs normal-case">
                              ({option.note})
                            </span>
                          ) : null}
                        </span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Recipients */}
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <Label>Recipients</Label>
                <WalletConnectButton size="sm" />
              </div>
              <p className="text-xs text-muted-foreground">
                Up to {MAX_RECIPIENTS} recipients. Same token for all transfers.
              </p>
              <div className="space-y-3">
                {recipientRows.map((row, index) => (
                  <div key={row.id} className="space-y-1.5">
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_200px]">
                      <Input
                        type="text"
                        placeholder={`Recipient ${index + 1} address`}
                        value={row.address}
                        onChange={(e) => updateRecipient(row.id, { address: e.target.value })}
                        autoComplete="off"
                        aria-invalid={row.hasAddress && !row.isValidAddress}
                        className="min-w-0"
                      />
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          inputMode="decimal"
                          step={tokenStep}
                          placeholder="0.00"
                          value={row.amount}
                          onChange={(e) => updateRecipient(row.id, { amount: e.target.value })}
                          autoComplete="off"
                          aria-invalid={row.hasAmount && !row.isValidAmount}
                          className="min-w-0"
                        />
                        {recipients.length > 1 && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => removeRecipient(row.id)}
                            aria-label={`Remove recipient ${index + 1}`}
                          >
                            <X className="size-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                    {row.hasAddress && !row.isValidAddress && (
                      <p className="text-xs text-red-500">Invalid Solana address</p>
                    )}
                    {row.belowMinimum && token && (
                      <p className="text-xs text-red-500">
                        Min withdrawal: {formatAmount(minimumBaseUnits)} {token.label}
                      </p>
                    )}
                    {row.hasAmount && !row.isValidAmount && !row.belowMinimum && (
                      <p className="text-xs text-red-500">Enter a valid amount</p>
                    )}
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addRecipient}
                  disabled={recipients.length >= MAX_RECIPIENTS}
                  className="gap-2"
                >
                  <Plus className="size-4" />
                  Add recipient
                </Button>
                <span className="text-xs text-muted-foreground">
                  {recipients.length}/{MAX_RECIPIENTS} recipients
                </span>
              </div>
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
                  {totalBreakdown ? (
                    <>
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Recipients</span>
                        <span className="font-semibold tabular-nums">{recipientCount}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">To recipients</span>
                        <span className="font-semibold tabular-nums">
                          {token
                            ? `${formatAmount(totalBreakdown.toRecipients)} ${token.label}`
                            : "---"}
                        </span>
                      </div>
                      {totalBreakdown.fee > 0 && (
                        <>
                          {totalBreakdown.rent > 0 && (
                            <div className="flex items-center justify-between">
                              <span className="text-muted-foreground">Rent fee</span>
                              <span className="tabular-nums">
                                {token
                                  ? `${formatAmount(totalBreakdown.rent)} ${token.label}`
                                  : "---"}
                              </span>
                            </div>
                          )}
                          {totalBreakdown.rateFee > 0 && (
                            <div className="flex items-center justify-between">
                              <span className="text-muted-foreground">0.35% fee</span>
                              <span className="tabular-nums">
                                {token
                                  ? `${formatAmount(totalBreakdown.rateFee)} ${token.label}`
                                  : "---"}
                              </span>
                            </div>
                          )}
                          <div className="flex items-center justify-between">
                            <span className="text-muted-foreground font-medium">Total fee</span>
                            <span className="tabular-nums font-medium">
                              {token ? `${formatAmount(totalBreakdown.fee)} ${token.label}` : "---"}
                            </span>
                          </div>
                        </>
                      )}
                      <p className="text-[10px] text-muted-foreground/80 pt-0.5">
                        Withdrawal fees: 0.35% of amount
                        {rentPerRecipientDisplay != null
                          ? ` + ${rentPerRecipientDisplay} per recipient`
                          : " + rent per recipient"}
                        .
                      </p>
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
                          <span className="text-muted-foreground">Deposit</span>
                          <span className={cn("font-semibold tabular-nums", "text-amber-500")}>
                            {token ? `${formatAmount(shortfallBaseUnits)} ${token.label}` : "—"}
                          </span>
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <p className="text-xs text-muted-foreground">
                        Add recipient addresses and amounts to calculate totals.
                      </p>
                      <p className="text-[10px] text-muted-foreground/80 pt-0.5">
                        Withdrawal fees: 0.35% of amount
                        {rentPerRecipientDisplay != null
                          ? ` + ${rentPerRecipientDisplay} per recipient`
                          : " + rent per recipient"}
                        .
                      </p>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Activity log — collapsible, only visible during SDK operations */}
            {isBusy && showActivityPanel && activityLogs.length > 0 && (
              <div
                className={cn(
                  "rounded-xl border border-primary/20 bg-black/40 shadow-[inset_0_0_20px_oklch(0.72_0.15_220/6%)] flex flex-col overflow-hidden transition-[opacity,transform] duration-200 ease-out",
                  activityExpanded ? "max-h-24" : "max-h-10",
                  activityExiting && "opacity-0 scale-[0.98] pointer-events-none"
                )}
              >
                <button
                  type="button"
                  onClick={() => setActivityExpanded((prev) => !prev)}
                  className="flex w-full items-center gap-2 border-b border-border/50 bg-muted/20 px-3 py-1.5 shrink-0 text-left hover:bg-muted/30 transition-colors"
                  aria-expanded={activityExpanded}
                  aria-controls="activity-log-body"
                  id="activity-log-header"
                >
                  <Terminal className="size-3.5 text-primary shrink-0" aria-hidden />
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Activity
                  </span>
                  {!activityExpanded && activityLogs.length > 0 && (
                    <span className="truncate text-[11px] text-muted-foreground/90 font-normal normal-case">
                      {activityLogs[activityLogs.length - 1]}
                    </span>
                  )}
                  <ChevronRight
                    className={cn(
                      "ml-auto size-4 shrink-0 text-muted-foreground transition-transform",
                      activityExpanded && "rotate-90"
                    )}
                    aria-hidden
                  />
                </button>
                <div
                  id="activity-log-body"
                  ref={activityLogsRef}
                  className={cn(
                    "min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 py-1 font-mono text-[11px] tabular-nums",
                    !activityExpanded && "hidden"
                  )}
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
          </div>

          <div className="mt-4 shrink-0 space-y-3">
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
                !hasRecipients ||
                hasInvalidRecipients ||
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
                Deposit, then click Transfer to send to all recipients.
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
