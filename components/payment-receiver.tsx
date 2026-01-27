"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useUnifiedWalletContext, useWallet } from "@jup-ag/wallet-adapter";
import {
  Connection,
  LAMPORTS_PER_SOL,
  PublicKey,
  VersionedTransaction,
} from "@solana/web3.js";
import { getAssociatedTokenAddress } from "@solana/spl-token";
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
  depositSPLToken,
  getPrivateSOLBalance,
  getPrivateSPLBalance,
  getSessionSignature,
  setLogger,
  signSessionMessage,
  WalletAdapter,
} from "@/lib/privacy-cash";
import { PaymentLinksAPI, PrivacyCashAPI } from "@/lib/api-service";
import type { PaymentLinkPublicInfo } from "@/lib/payment-links-types";
import {
  formatTokenAmount,
  formatTokenAmountInput,
  getTokenByMint,
  getTokenStep,
  isSolMint,
  parseTokenAmountToBaseUnits,
} from "@/lib/token-registry";
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
  const [publicBalanceBaseUnits, setPublicBalanceBaseUnits] = useState<number | null>(null);
  const [privateBalanceBaseUnits, setPrivateBalanceBaseUnits] = useState<number | null>(null);
  const [balancesChecked, setBalancesChecked] = useState(false);
  const [logQueue, setLogQueue] = useState<string[]>([]);
  const [displayLogs, setDisplayLogs] = useState<string[]>([]);
  const lastLogRef = useRef<string | null>(null);

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
        setLinkError(err instanceof Error ? err.message : "Failed to load payment link");
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
    setLogQueue((prev) => [...prev, "Info: Requesting signature to check balances..."]);
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
    if (!publicKey || !token || balancesChecked || status === "checking") return;
    fetchBalances();
  }, [balancesChecked, fetchBalances, publicKey, status, token]);

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
  const feeRate = 0.0025;
  const rentFeeBaseUnits = isSolToken ? Math.floor(0.001 * LAMPORTS_PER_SOL) : 0;
  const estimatedFeeBaseUnits = isValidAmount
    ? Math.floor(amountBaseUnits * feeRate + rentFeeBaseUnits)
    : 0;
  const requiredPrivateBaseUnits = isValidAmount
    ? amountBaseUnits + estimatedFeeBaseUnits
    : 0;

  const shortfallBaseUnits =
    privateBalanceBaseUnits !== null
      ? Math.max(0, requiredPrivateBaseUnits - privateBalanceBaseUnits)
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

  const handleDeposit = useCallback(
    async (amountToDeposit: number) => {
      if (!publicKey || !token) return;
      setStatus("depositing");
      setError(null);
      setLogQueue((prev) => [...prev, "Info: Preparing private deposit..."]);
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

  const handlePay = useCallback(async () => {
    if (!paymentLink) return;
    if (!publicKey || !token) return;
    if (!isValidAmount) {
      setError("Please enter a valid amount");
      return;
    }
    setStatus("paying");
    setError(null);
    setLogQueue((prev) => [...prev, "Info: Preparing private withdrawal..."]);

    try {
      const walletAdapter = getWalletAdapter();
      const recipientResult = await PaymentLinksAPI.getRecipient(
        paymentId,
        amountBaseUnits,
      );

      if (!recipientResult.success || !recipientResult.data) {
        throw new Error(recipientResult.error || "Failed to get recipient");
      }

      const withdrawResult = await (async () => {
        const existingSignature = getSessionSignature(walletAdapter.publicKey);
        const signature =
          existingSignature ?? (await signSessionMessage(walletAdapter));
        const signatureBase64 = toBase64(signature);

        const withdrawApiResult = isSolToken
          ? await PrivacyCashAPI.withdraw({
              amountLamports: amountBaseUnits,
              recipient: recipientResult.data!.recipientAddress,
              publicKey: walletAdapter.publicKey.toBase58(),
              signature: signatureBase64,
            })
          : await PrivacyCashAPI.withdrawSpl({
              amountBaseUnits,
              mintAddress: token.mint,
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
        amount: amountBaseUnits,
      });

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
              {isValidAmount && token
                ? `${formatAmount(amountBaseUnits)} ${token.label}`
                : amount} paid privately
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
            {tokenLabel}
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
                className="text-xl font-bold pr-20"
              />
              <Badge className="absolute right-2 top-1/2 -translate-y-1/2">
                {tokenLabel}
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
                      {publicBalanceBaseUnits !== null && token
                        ? `${formatAmount(publicBalanceBaseUnits)} ${token.label}`
                        : "---"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Private Balance</p>
                    <p className="text-lg font-semibold">
                      {privateBalanceBaseUnits !== null && token
                        ? `${formatAmount(privateBalanceBaseUnits)} ${token.label}`
                        : "---"}
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
                    {token ? `${formatAmount(amountBaseUnits)} ${token.label}` : "---"}
                  </span>
                </div>
                <div className="h-px bg-border/60" />
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Deposit needed</span>
                  <span className={cn("font-semibold", needsDeposit && "text-amber-500")}>
                    {token && shortfallBaseUnits !== null
                      ? `${formatAmount(shortfallBaseUnits)} ${token.label}`
                      : "---"}
                  </span>
                </div>
              </div>
            </div>

            <Separator />

            <div className="space-y-3">
              <Button
                onClick={handlePrimaryAction}
                disabled={
                  isBusy ||
                  !isValidAmount ||
                  (needsDeposit ? shortfallBaseUnits === null : !hasSufficientBalance)
                }
                className="w-full"
              >
                {needsDeposit
                  ? `Deposit ${
                      token && shortfallBaseUnits !== null
                        ? `${formatAmount(shortfallBaseUnits)} ${token.label}`
                        : "---"
                    }`
                  : `Pay ${
                      token
                        ? `${formatAmount(amountBaseUnits)} ${token.label}`
                        : "---"
                    }`}
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
