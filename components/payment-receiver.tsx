"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useUnifiedWalletContext, useWallet } from "@jup-ag/wallet-adapter";
import {
  Connection,
  LAMPORTS_PER_SOL,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  depositSOL,
  getPrivateSOLBalance,
  getSessionSignature,
  setLogger,
  signSessionMessage,
  withdrawSOL,
  WalletAdapter,
} from "@/lib/privacy-cash";
import { PaymentLinksAPI, PrivacyCashAPI } from "@/lib/api-service";
import type { PaymentLinkPublicInfo } from "@/lib/payment-links-types";
import { Wallet } from "lucide-react";
import { Typewriter } from "@/components/ui/typewriter";
import { cn } from "@/lib/utils";

const RPC_URL =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
  "https://api.mainnet-beta.solana.com";

interface PaymentReceiverProps {
  paymentId: string;
}

type PaymentStatus = "idle" | "checking" | "depositing" | "paying" | "success" | "error";

export function PaymentReceiver({ paymentId }: PaymentReceiverProps) {
  const { publicKey, signMessage, signTransaction, disconnect } = useWallet();
  const { setShowModal } = useUnifiedWalletContext();
  const [connection] = useState(() => new Connection(RPC_URL, "confirmed"));

  const [paymentLink, setPaymentLink] = useState<PaymentLinkPublicInfo | null>(null);
  const [loadingLink, setLoadingLink] = useState(true);
  const [linkError, setLinkError] = useState<string | null>(null);

  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState<PaymentStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [publicBalance, setPublicBalance] = useState<number | null>(null);
  const [privateBalance, setPrivateBalance] = useState<number | null>(null);
  const [balancesChecked, setBalancesChecked] = useState(false);
  const [logQueue, setLogQueue] = useState<string[]>([]);
  const [displayLogs, setDisplayLogs] = useState<string[]>([]);
  const lastLogRef = useRef<string | null>(null);

  useEffect(() => {
    const fetchPaymentLink = async () => {
      try {
        const result = await PaymentLinksAPI.getPaymentLink(paymentId);
        if (!result.success || !result.data) {
          throw new Error(result.error || "Payment link not found");
        }

        const link = result.data.paymentLink;
        setPaymentLink(link);

        if (link.amountType === "fixed" && link.fixedAmount) {
          setAmount((link.fixedAmount / 1e9).toString());
        }
      } catch (err) {
        setLinkError(err instanceof Error ? err.message : "Failed to load payment link");
      } finally {
        setLoadingLink(false);
      }
    };

    fetchPaymentLink();
  }, [paymentId]);

  useEffect(() => {
    setLogger((level, message) => {
      const prefix = level === "error" ? "Error" : level === "warn" ? "Warn" : "Info";
      const nextMessage = `${prefix}: ${message}`;
      if (lastLogRef.current === nextMessage) return;
      lastLogRef.current = nextMessage;
      setLogQueue((prev) => [...prev, nextMessage]);
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

  const fetchBalances = useCallback(async () => {
    if (!publicKey) return;
    setStatus("checking");
    setError(null);
    setLogQueue((prev) => [...prev, "Info: Requesting signature to check balances..."]);
    try {
      const [publicLamports, privateResult] = await Promise.all([
        connection.getBalance(publicKey),
        (async () => {
          const walletAdapter = getWalletAdapter();
          return getPrivateSOLBalance({ connection, wallet: walletAdapter });
        })(),
      ]);

      setPublicBalance(publicLamports);
      setPrivateBalance(privateResult.lamports);
      setBalancesChecked(true);
      setStatus("idle");
      setLogQueue([]);
      setDisplayLogs([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch balances");
      setStatus("error");
    }
  }, [connection, getWalletAdapter, publicKey]);

  useEffect(() => {
    if (!publicKey || balancesChecked || status === "checking") return;
    fetchBalances();
  }, [balancesChecked, fetchBalances, publicKey, status]);

  const formatSOL = (lamports: number) => (lamports / 1e9).toFixed(3);

  const amountLamports = useMemo(() => {
    const parsed = parseFloat(amount);
    return Number.isFinite(parsed) ? Math.floor(parsed * LAMPORTS_PER_SOL) : 0;
  }, [amount]);

  const isValidAmount = amountLamports > 0;
  const feeRate = 0.0025;
  const rentFee = 0.001 * LAMPORTS_PER_SOL;
  const estimatedFeeLamports = isValidAmount
    ? Math.floor(amountLamports * feeRate + rentFee)
    : 0;
  const requiredPrivateLamports = isValidAmount
    ? amountLamports + estimatedFeeLamports
    : 0;

  const shortfallLamports =
    privateBalance !== null
      ? Math.max(0, requiredPrivateLamports - privateBalance)
      : null;

  const address = publicKey?.toBase58();
  const shortAddress = address ? `${address.slice(0, 4)}...${address.slice(-4)}` : null;

  const handleCopyAddress = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
    } catch {
      // ignore clipboard failures
    }
  };

  const handleDisconnect = async () => {
    try {
      await disconnect?.();
    } catch {
      // ignore disconnect failures
    }
  };

  const isBusy = status === "checking" || status === "depositing" || status === "paying";
  const hasSufficientBalance =
    privateBalance !== null && privateBalance >= requiredPrivateLamports;
  const needsDeposit = shortfallLamports !== null && shortfallLamports > 0;

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

  const handleDeposit = useCallback(
    async (amountToDeposit: number) => {
      if (!publicKey) return;
      setStatus("depositing");
      setError(null);
      setLogQueue((prev) => [...prev, "Info: Preparing private deposit..."]);
      try {
        const walletAdapter = getWalletAdapter();
        const depositResult = await depositSOL({
          connection,
          wallet: walletAdapter,
          amount_in_lamports: amountToDeposit,
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
    [connection, fetchBalances, getWalletAdapter, publicKey]
  );

  const handlePay = useCallback(async () => {
    if (!paymentLink) return;
    if (!publicKey) return;
    if (!isValidAmount) {
      setError("Please enter a valid amount");
      return;
    }
    setStatus("paying");
    setError(null);
    setLogQueue((prev) => [...prev, "Info: Preparing private withdrawal..."]);

    try {
      const walletAdapter = getWalletAdapter();
      const recipientResult = await PaymentLinksAPI.getRecipient(paymentId, amountLamports);

      if (!recipientResult.success || !recipientResult.data) {
        throw new Error(recipientResult.error || "Failed to get recipient");
      }

      const withdrawResult = await (async () => {
        const existingSignature = getSessionSignature(walletAdapter.publicKey);
        const signature =
          existingSignature ?? (await signSessionMessage(walletAdapter));
        const signatureBase64 = toBase64(signature);

        const withdrawApiResult = await PrivacyCashAPI.withdraw({
          amountLamports,
          recipient: recipientResult.data!.recipientAddress,
          publicKey: walletAdapter.publicKey.toBase58(),
          signature: signatureBase64,
        });

        if (!withdrawApiResult.success) {
          throw new Error(withdrawApiResult.error || "Backend withdraw failed");
        }

        return withdrawApiResult.data!.result;
      })();

      await PaymentLinksAPI.completePayment(paymentId, {
        txSignature: withdrawResult.tx,
        amount: amountLamports,
      });

      setStatus("success");
      setLogQueue([]);
      setDisplayLogs([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Payment failed");
      setStatus("error");
    }
  }, [
    amountLamports,
    connection,
    getWalletAdapter,
    isValidAmount,
    paymentId,
    paymentLink,
    publicKey,
  ]);

  const handlePrimaryAction = useCallback(async () => {
    if (!publicKey) return;
    if (!isValidAmount) {
      setError("Please enter a valid amount");
      return;
    }
    if (needsDeposit && shortfallLamports) {
      await handleDeposit(shortfallLamports);
      return;
    }
    await handlePay();
  }, [handleDeposit, handlePay, isValidAmount, needsDeposit, publicKey, shortfallLamports]);

  const toBase64 = (bytes: Uint8Array) => {
    let binary = "";
    bytes.forEach((b) => {
      binary += String.fromCharCode(b);
    });
    return btoa(binary);
  };

  if (loadingLink) {
    return (
      <Card className="w-full max-w-2xl mx-auto">
        <CardContent className="py-12">
          <div className="flex flex-col items-center gap-4">
            <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
            <p className="text-muted-foreground">Loading payment request...</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (linkError || !paymentLink) {
    return (
      <Card className="w-full max-w-2xl mx-auto">
        <CardHeader>
          <CardTitle>Payment Link Not Found</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="p-4 bg-red-500/10 border border-red-500/20 rounded text-red-500">
            {linkError || "This payment link does not exist or has expired."}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (paymentLink.status !== "active") {
    return (
      <Card className="w-full max-w-2xl mx-auto">
        <CardHeader>
          <CardTitle>Payment Link Unavailable</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="p-4 bg-yellow-500/10 border border-yellow-500/20 rounded text-yellow-600">
            This payment link is no longer active.
          </div>
        </CardContent>
      </Card>
    );
  }

  if (status === "success") {
    return (
      <Card className="w-full max-w-2xl mx-auto">
        <CardHeader>
          <CardTitle>Payment Sent ✅</CardTitle>
          <CardDescription>Your payment has been sent privately.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-center">
          <div className="p-6 bg-green-500/10 border border-green-500/20 rounded-lg">
            <p className="text-lg font-semibold">
              {amount} {paymentLink.tokenType.toUpperCase()} paid privately
            </p>
            <p className="text-sm text-muted-foreground mt-2">
              Your payment is on-chain, but your identity stays private.
            </p>
          </div>
          <Button asChild className="w-full">
            <a href="/">Done</a>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-2xl mx-auto">
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <CardTitle>{paymentLink.label || "Payment Request"}</CardTitle>
            <CardDescription>Pay privately using ghostsend</CardDescription>
          </div>
          <Badge variant="secondary" className="ml-2">
            {paymentLink.tokenType.toUpperCase()}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {paymentLink.message && (
          <div className="p-4 bg-muted rounded-lg">
            <p className="text-sm italic text-muted-foreground">
              "{paymentLink.message}"
            </p>
          </div>
        )}

        {!publicKey && (
          <Button
            type="button"
            onClick={() => setShowModal(true)}
            className="w-full h-14 gap-3 text-lg font-semibold"
          >
            <Wallet className="h-5 w-5" />
            Connect Wallet
          </Button>
        )}

        <div className="space-y-4">
          <div>
            <Label>Amount</Label>
            <div className="relative mt-2">
              <Input
                type={paymentLink.amountType === "fixed" ? "text" : "number"}
                value={amount}
                readOnly={paymentLink.amountType === "fixed"}
                onChange={(e) => setAmount(e.target.value)}
                className="text-xl font-bold pr-20"
              />
              <Badge className="absolute right-2 top-1/2 -translate-y-1/2">
                {paymentLink.tokenType.toUpperCase()}
              </Badge>
            </div>
          </div>
        </div>

        <Separator />

        <div className="space-y-4">
          <p className="text-sm font-medium">Wallet</p>
          {publicKey && shortAddress && (
            <div className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
              <span className="text-xs text-muted-foreground">Connected Wallet</span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 px-2 text-xs font-mono"
                  >
                    {shortAddress}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>Wallet</DropdownMenuLabel>
                  <DropdownMenuItem onSelect={handleCopyAddress}>
                    Copy address
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onSelect={handleDisconnect}>
                    Disconnect
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
          {publicKey && (
            <div className="relative h-28 overflow-hidden rounded-lg border border-border/60 bg-muted/30">
              <div
                className={cn(
                  "absolute inset-0 px-4 py-3 transition-all duration-500",
                  balancesChecked
                    ? "pointer-events-none opacity-0 translate-y-1"
                    : "opacity-100 translate-y-0"
                )}
              >
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                  <span className="inline-flex h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.7)]" />
                  <span className="uppercase tracking-[0.2em]">Ghost feed</span>
                  <span className="ml-auto text-[9px] uppercase tracking-[0.24em]">
                    {isBusy ? "live" : "idle"}
                  </span>
                </div>
                <div className="mt-2 min-h-[48px] text-sm">
                  {displayLogs.length > 1 && (
                    <div className="text-muted-foreground">
                      {displayLogs[displayLogs.length - 2]}
                    </div>
                  )}
                  {displayLogs.length > 0 ? (
                    <div className="text-foreground">
                      <Typewriter
                        text={displayLogs[displayLogs.length - 1]}
                        speedMs={90}
                      />
                    </div>
                  ) : (
                    <div className="text-muted-foreground">
                      Waiting for your next action...
                    </div>
                  )}
                </div>
              </div>

              <div
                className={cn(
                  "absolute inset-0 px-4 py-3 transition-all duration-500",
                  balancesChecked
                    ? "opacity-100 translate-y-0"
                    : "pointer-events-none opacity-0 translate-y-1"
                )}
              >
                <div className="grid h-full grid-cols-2 items-center gap-4">
                  <div>
                    <p className="text-xs text-muted-foreground">Public Balance</p>
                    <p className="text-lg font-semibold">
                      {publicBalance !== null ? `${formatSOL(publicBalance)} SOL` : "---"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Private Balance</p>
                    <p className="text-lg font-semibold">
                      {privateBalance !== null ? `${formatSOL(privateBalance)} SOL` : "---"}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {publicKey && balancesChecked && (
          <>
            <Separator />
            <div className="space-y-3">
              <p className="text-sm font-medium">Transaction summary</p>
              <div className="space-y-3 rounded-lg border p-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Requirement</span>
                  <span className="font-semibold">
                    {isValidAmount ? formatSOL(amountLamports) : "0.000"} SOL
                  </span>
                </div>
                <div className="h-px bg-border/60" />
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Deposit needed</span>
                  <span className={cn("font-semibold", needsDeposit && "text-amber-500")}>
                    {shortfallLamports !== null ? formatSOL(shortfallLamports) : "0.000"} SOL
                  </span>
                </div>
              </div>
            </div>

            <Separator />

            <div className="space-y-3">
              {paymentLink.tokenType !== "sol" && (
                <div className="p-4 bg-yellow-500/10 border border-yellow-500/20 rounded text-sm text-yellow-600">
                  {paymentLink.tokenType.toUpperCase()} payments are coming soon.
                </div>
              )}
              <Button
                onClick={handlePrimaryAction}
                disabled={
                  isBusy ||
                  paymentLink.tokenType !== "sol" ||
                  !isValidAmount ||
                  (needsDeposit ? shortfallLamports === null : !hasSufficientBalance)
                }
                className="w-full"
              >
                {needsDeposit
                  ? `Deposit ${shortfallLamports ? formatSOL(shortfallLamports) : "0.000"} SOL`
                  : `Pay ${isValidAmount ? formatSOL(amountLamports) : "0.000"} ${paymentLink.tokenType.toUpperCase()}`}
              </Button>
              {needsDeposit ? (
                <p className="text-xs text-muted-foreground">
                  Deposit first to cover the payment amount, then click again to pay.
                </p>
              ) : (
                !hasSufficientBalance && (
                  <p className="text-xs text-muted-foreground">
                    Deposit first to cover the payment amount.
                  </p>
                )
              )}
            </div>
          </>
        )}


        {error && (
          <div className="p-4 bg-red-500/10 border border-red-500/20 rounded text-red-500 text-sm">
            {error}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
