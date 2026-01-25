"use client";

import { useState, useEffect, useCallback } from "react";
import { useWallet } from "@jup-ag/wallet-adapter";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  clearSession,
  depositSOL,
  getPrivateSOLBalance,
  getSessionSignature,
  signSessionMessage,
  setLogger,
  withdrawSOL,
  WalletAdapter,
} from "@/lib/privacy-cash";
import type { PaymentLinkPublicInfo } from "@/lib/payment-links-types";

const RPC_URL =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
  "https://api.mainnet-beta.solana.com";

interface PaymentLinkSenderProps {
  paymentId: string;
}

type PaymentStatus =
  | "idle"
  | "awaitingSignature"
  | "fetchingBalance"
  | "depositing"
  | "confirmingDeposit"
  | "withdrawing"
  | "success"
  | "error";

interface LogEntry {
  timestamp: Date;
  message: string;
  type: "info" | "success" | "error";
}

export function PaymentLinkSender({ paymentId }: PaymentLinkSenderProps) {
  const { publicKey, signMessage, signTransaction } = useWallet();
  const [connection] = useState(() => new Connection(RPC_URL, "confirmed"));

  // Payment link data
  const [paymentLink, setPaymentLink] = useState<PaymentLinkPublicInfo | null>(
    null
  );
  const [loadingLink, setLoadingLink] = useState(true);
  const [linkError, setLinkError] = useState<string | null>(null);

  // Payment state
  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState<PaymentStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [txSignature, setTxSignature] = useState<string | null>(null);
  const [explorerUrl, setExplorerUrl] = useState<string | null>(null);
  const [privateBalance, setPrivateBalance] = useState<number | null>(null);
  const [publicBalance, setPublicBalance] = useState<number | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [verboseLogs, setVerboseLogs] = useState(false);

  // Payment summary from prepare
  const [paymentSummary, setPaymentSummary] = useState<{
    amount: number;
    fee: number;
    recipientPreview: string;
  } | null>(null);

  const addLog = useCallback(
    (message: string, type: "info" | "success" | "error" = "info") => {
      setLogs((prev) => [...prev, { timestamp: new Date(), message, type }]);
    },
    []
  );

  const clearLogs = useCallback(() => {
    setLogs([]);
  }, []);

  useEffect(() => {
    setLogger((level, message) => {
      if (level === "debug" && !verboseLogs) return;
      const type =
        level === "error" ? "error" : level === "warn" ? "error" : "info";
      addLog(`[SDK] ${message}`, type);
    });
  }, [verboseLogs, addLog]);

  // Load payment link details
  useEffect(() => {
    const fetchPaymentLink = async () => {
      try {
        const response = await fetch(`/api/payment-links/${paymentId}`);
        const data = await response.json();

        if (!data.success) {
          throw new Error(data.error || "Payment link not found");
        }

        setPaymentLink(data.paymentLink);

        // Set default amount if fixed
        if (
          data.paymentLink.amountType === "fixed" &&
          data.paymentLink.fixedAmount
        ) {
          setAmount((data.paymentLink.fixedAmount / 1e9).toString());
        }
      } catch (err) {
        setLinkError(
          err instanceof Error ? err.message : "Failed to load payment link"
        );
      } finally {
        setLoadingLink(false);
      }
    };

    fetchPaymentLink();
  }, [paymentId]);

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

  const fetchPublicBalance = useCallback(async () => {
    if (!publicKey) return;
    setStatus("fetchingBalance");
    addLog("Fetching public balance...");
    try {
      const balance = await connection.getBalance(publicKey);
      setPublicBalance(balance);
      addLog(
        `Public balance: ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL`,
        "success"
      );
      setStatus("idle");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      addLog(`Failed to fetch public balance: ${message}`, "error");
      setStatus("error");
    }
  }, [publicKey, connection, addLog]);

  const fetchPrivateBalance = useCallback(async () => {
    try {
      setStatus("awaitingSignature");
      addLog("Please sign to initialize your privacy session...");
      const walletAdapter = getWalletAdapter();
      setStatus("fetchingBalance");
      addLog("Fetching private balance (this can take a bit)...");
      const result = await getPrivateSOLBalance({
        connection,
        wallet: walletAdapter,
      });
      setPrivateBalance(result.lamports);
      addLog(
        `Private balance: ${(result.lamports / LAMPORTS_PER_SOL).toFixed(
          4
        )} SOL`,
        "success"
      );
      setStatus("idle");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      addLog(`Failed to fetch private balance: ${message}`, "error");
      setStatus("error");
    }
  }, [connection, getWalletAdapter, addLog]);

  const handleClearSession = useCallback(() => {
    clearSession();
    setPrivateBalance(null);
    addLog("Session cleared");
  }, [addLog]);

  const handleDepositShortfall = async (shortfallLamports: number) => {
    if (!paymentLink) {
      setError("Payment link not loaded");
      return;
    }

    if (shortfallLamports <= 0) {
      setError("No deposit required");
      return;
    }

    try {
      setError(null);
      setStatus("awaitingSignature");

      const walletAdapter = getWalletAdapter();

      addLog(
        `Starting deposit of ${(shortfallLamports / LAMPORTS_PER_SOL).toFixed(
          4
        )} SOL (${shortfallLamports} lamports)...`
      );

      setStatus("depositing");
      const depositResult = await depositSOL({
        connection,
        wallet: walletAdapter,
        amount_in_lamports: shortfallLamports,
      });

      addLog(`Deposit submitted. TX: ${depositResult.tx}`, "success");
      addLog(`Explorer: https://explorer.solana.com/tx/${depositResult.tx}`);

      setStatus("confirmingDeposit");
      await connection.confirmTransaction(depositResult.tx, "confirmed");
      addLog("Deposit confirmed", "success");

      await fetchPublicBalance();
      await fetchPrivateBalance();
      setStatus("idle");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Deposit failed";
      addLog(`Deposit failed: ${message}`, "error");
      setError(message);
      setStatus("error");
    }
  };

  const handleWithdrawPay = async (amountLamports: number) => {
    if (!paymentLink) {
      setError("Payment link not loaded");
      return;
    }

    if (isNaN(amountLamports) || amountLamports <= 0) {
      setError("Please enter a valid amount");
      return;
    }

    try {
      setError(null);
      setStatus("awaitingSignature");

      const walletAdapter = getWalletAdapter();

      addLog(
        `Starting withdrawal of ${(amountLamports / LAMPORTS_PER_SOL).toFixed(
          4
        )} SOL (${amountLamports} lamports)...`
      );

      setStatus("withdrawing");
      const fee_rate = 0.0025;
      const rent_fee = 0.001 * LAMPORTS_PER_SOL;
      const estimated_fee = Math.floor(amountLamports * fee_rate + rent_fee);

      setPaymentSummary({
        amount: amountLamports,
        fee: estimated_fee,
        recipientPreview: "****...****",
      });

      const recipientResponse = await fetch(
        `/api/payment-links/${paymentId}/recipient`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            amount: amountLamports,
          }),
        }
      );

      const recipientData = await recipientResponse.json();

      if (!recipientData.success) {
        throw new Error(recipientData.error || "Failed to get recipient");
      }

      const useBackendWithdraw =
        process.env.NEXT_PUBLIC_PRIVACYCASH_WITHDRAW_BACKEND === "true";

      const withdrawResult = useBackendWithdraw
        ? await (async () => {
            addLog("Using backend withdraw (signature sent to server)...");
            setStatus("awaitingSignature");
            const existingSignature = getSessionSignature(
              walletAdapter.publicKey
            );
            const signature =
              existingSignature ?? (await signSessionMessage(walletAdapter));
            if (existingSignature) {
              addLog("Reusing existing session signature.");
            }
            const signatureBase64 = toBase64(signature);
            setStatus("withdrawing");

            const response = await fetch("/api/privacy-cash/withdraw", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                amountLamports,
                recipient: recipientData.recipientAddress,
                publicKey: walletAdapter.publicKey.toBase58(),
                signature: signatureBase64,
              }),
            });

            const data = await response.json();
            addLog(
              `Backend withdraw response: ${JSON.stringify(
                data?.success ? data.result : data
              )}`
            );
            if (!data.success) {
              throw new Error(data.error || "Backend withdraw failed");
            }
            return data.result as {
              isPartial: boolean;
              tx: string;
              recipient: string;
              amount_in_lamports: number;
              fee_in_lamports: number;
            };
          })()
        : await withdrawSOL({
            connection,
            wallet: walletAdapter,
            amount_in_lamports: amountLamports,
            recipient: recipientData.recipientAddress,
          });

      addLog(`Withdrawal successful! TX: ${withdrawResult.tx}`, "success");
      addLog(
        `Received: ${(
          withdrawResult.amount_in_lamports / LAMPORTS_PER_SOL
        ).toFixed(4)} SOL`
      );
      addLog(
        `Fee: ${(withdrawResult.fee_in_lamports / LAMPORTS_PER_SOL).toFixed(
          4
        )} SOL`
      );
      addLog(`Explorer: https://explorer.solana.com/tx/${withdrawResult.tx}`);

      const completeResponse = await fetch(
        `/api/payment-links/${paymentId}/complete`,
        { method: "POST" }
      );

      const completeData = await completeResponse.json();

      if (!completeData.success) {
        addLog(
          `Failed to mark payment as complete: ${completeData.error}`,
          "error"
        );
      }

      setTxSignature(withdrawResult.tx);
      const cluster = process.env.NEXT_PUBLIC_SOLANA_NETWORK || "mainnet-beta";
      setExplorerUrl(
        `https://explorer.solana.com/tx/${withdrawResult.tx}?cluster=${cluster}`
      );
      setStatus("success");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Payment failed";
      addLog(`Payment failed: ${message}`, "error");
      setError(message);
      setStatus("error");
    }
  };

  const formatSOL = (lamports: number) => {
    return (lamports / 1e9).toFixed(4);
  };

  const toBase64 = (bytes: Uint8Array) => {
    let binary = "";
    bytes.forEach((b) => {
      binary += String.fromCharCode(b);
    });
    return btoa(binary);
  };

  const getStatusMessage = () => {
    switch (status) {
      case "awaitingSignature":
        return "Awaiting wallet signature...";
      case "fetchingBalance":
        return "Fetching balances...";
      case "depositing":
        return "Shielding your SOL deposit...";
      case "confirmingDeposit":
        return "Confirming deposit...";
      case "withdrawing":
        return "Sending private payment to recipient...";
      default:
        return null;
    }
  };

  const amountLamports = Math.floor(parseFloat(amount) * LAMPORTS_PER_SOL);
  const isValidAmount = !isNaN(amountLamports) && amountLamports > 0;
  const fee_rate = 0.0025;
  const rent_fee = 0.001 * LAMPORTS_PER_SOL;
  const estimatedFeeLamports = isValidAmount
    ? Math.floor(amountLamports * fee_rate + rent_fee)
    : 0;
  const requiredPrivateLamports = isValidAmount
    ? amountLamports + estimatedFeeLamports
    : 0;
  const isFixedAmount = paymentLink?.amountType === "fixed";
  const minAmountLamports = paymentLink?.minAmount ?? null;
  const maxWithdrawLamports =
    privateBalance !== null
      ? Math.max(0, Math.floor((privateBalance - rent_fee) / (1 + fee_rate)))
      : null;
  let canAdjustForFee = false;
  let shortfallLamports: number | null = null;

  if (privateBalance !== null && isValidAmount) {
    if (privateBalance < amountLamports) {
      shortfallLamports = Math.max(0, requiredPrivateLamports - privateBalance);
    } else if (privateBalance < requiredPrivateLamports) {
      const meetsMin =
        minAmountLamports === null ||
        (maxWithdrawLamports ?? 0) >= minAmountLamports;
      if (!isFixedAmount && meetsMin) {
        canAdjustForFee = true;
        shortfallLamports = 0;
      } else {
        shortfallLamports = Math.max(
          0,
          requiredPrivateLamports - privateBalance
        );
      }
    } else {
      shortfallLamports = 0;
    }
  }

  const effectiveWithdrawLamports = canAdjustForFee
    ? Math.max(0, maxWithdrawLamports ?? 0)
    : amountLamports;
  const isBusy = status !== "idle" && status !== "error";

  if (loadingLink) {
    return (
      <Card className="w-full max-w-2xl mx-auto">
        <CardContent className="py-12">
          <div className="flex flex-col items-center gap-4">
            <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
            <p className="text-muted-foreground">Loading payment link...</p>
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
          <CardTitle>Payment Successful! 🎉</CardTitle>
          <CardDescription>
            Your payment has been processed via Privacy Cash
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="p-6 bg-green-500/10 border border-green-500/20 rounded-lg text-center space-y-4">
            <div className="text-6xl">✅</div>
            <div>
              <p className="font-semibold text-green-600">Payment Completed</p>
              <p className="text-sm text-muted-foreground mt-2">
                Paid {formatSOL(paymentSummary!.amount)} SOL privately
              </p>
            </div>
          </div>

          {explorerUrl && (
            <div className="space-y-2">
              <Label>Transaction</Label>
              <div className="flex gap-2">
                <Input
                  value={txSignature || ""}
                  readOnly
                  className="flex-1 font-mono text-xs"
                />
                <Button asChild variant="outline">
                  <a
                    href={explorerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    View
                  </a>
                </Button>
              </div>
            </div>
          )}

          <Separator />

          <div className="text-sm text-muted-foreground text-center">
            <p>Thank you for using Privacy Cash!</p>
            <p className="mt-1">
              Your payment was sent privately without revealing your identity.
            </p>
          </div>
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
            <CardDescription>Pay securely using Privacy Cash</CardDescription>
          </div>
          <Badge variant="secondary" className="ml-2">
            {paymentLink.tokenType.toUpperCase()}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Message from recipient */}
        {paymentLink.message && (
          <div className="p-4 bg-muted rounded-lg">
            <p className="text-sm italic text-muted-foreground">
              "{paymentLink.message}"
            </p>
          </div>
        )}

        {/* Payment details */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Payment Type</span>
            <Badge variant="outline">
              {paymentLink.amountType === "fixed"
                ? "Fixed Amount"
                : "Flexible Amount"}
            </Badge>
          </div>

          {paymentLink.amountType === "fixed" ? (
            <div>
              <Label>Amount (SOL)</Label>
              <Input
                type="text"
                value={amount}
                readOnly
                className="text-xl font-bold mt-2"
              />
            </div>
          ) : (
            <div>
              <Label>
                Amount (SOL)
                {paymentLink.minAmount && paymentLink.maxAmount && (
                  <span className="ml-2 text-xs text-muted-foreground font-normal">
                    Min: {formatSOL(paymentLink.minAmount)} - Max:{" "}
                    {formatSOL(paymentLink.maxAmount)}
                  </span>
                )}
              </Label>
              <Input
                type="number"
                step="0.001"
                placeholder="Enter amount"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="text-xl font-bold mt-2"
              />
            </div>
          )}

          {paymentLink.reusable && (
            <div className="text-xs text-muted-foreground">
              This is a reusable payment link. It has been used{" "}
              {paymentLink.usageCount} time(s).
            </div>
          )}
        </div>

        <Separator />

        {/* Balances */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Balances</p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={fetchPublicBalance}
                disabled={!publicKey || isBusy}
              >
                Refresh Public
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={fetchPrivateBalance}
                disabled={!publicKey || isBusy}
              >
                Refresh Private
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClearSession}
                disabled={!publicKey || isBusy}
              >
                Clear Session
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 rounded-lg border p-4">
            <div>
              <p className="text-xs text-muted-foreground">Public Balance</p>
              <p className="text-lg font-semibold">
                {publicBalance !== null
                  ? `${formatSOL(publicBalance)} SOL`
                  : "---"}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Private Balance</p>
              <p className="text-lg font-semibold">
                {privateBalance !== null
                  ? `${formatSOL(privateBalance)} SOL`
                  : "---"}
              </p>
            </div>
          </div>
          {!publicKey && (
            <div className="text-xs text-muted-foreground">
              Connect your wallet to view balances.
            </div>
          )}
        </div>

        <Separator />

        {/* Payment actions */}
        <div className="space-y-3">
          <p className="text-sm font-medium">Payment Actions</p>

          {!publicKey && (
            <div className="p-4 bg-yellow-500/10 border border-yellow-500/20 rounded text-center">
              <p className="text-sm text-yellow-600">
                Please connect your wallet to continue
              </p>
            </div>
          )}

          {publicKey && !isValidAmount && (
            <div className="p-4 bg-yellow-500/10 border border-yellow-500/20 rounded text-center">
              <p className="text-sm text-yellow-600">
                Enter a valid amount to continue
              </p>
            </div>
          )}

          {publicKey && isValidAmount && privateBalance === null && (
            <div className="flex items-center justify-between rounded-lg border p-4">
              <div className="text-sm text-muted-foreground">
                Fetch your private balance to check if a deposit is required.
                You will be asked to sign a message.
              </div>
              <Button onClick={fetchPrivateBalance} disabled={isBusy}>
                Fetch Private Balance
              </Button>
            </div>
          )}

          {publicKey &&
            isValidAmount &&
            privateBalance !== null &&
            shortfallLamports !== null &&
            shortfallLamports > 0 && (
              <div className="space-y-3 rounded-lg border p-4">
                <div className="flex justify-between text-sm">
                  <span>Required (amount + fee)</span>
                  <span className="font-medium">
                    {formatSOL(requiredPrivateLamports)} SOL
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>Private Balance</span>
                  <span className="font-medium">
                    {formatSOL(privateBalance)} SOL
                  </span>
                </div>
                <div className="flex justify-between text-sm font-semibold">
                  <span>Shortfall</span>
                  <span>{formatSOL(shortfallLamports)} SOL</span>
                </div>
                <Button
                  onClick={() => handleDepositShortfall(shortfallLamports)}
                  disabled={isBusy}
                  className="w-full"
                >
                  Deposit Shortfall
                </Button>
              </div>
            )}

          {publicKey &&
            isValidAmount &&
            privateBalance !== null &&
            shortfallLamports !== null &&
            shortfallLamports === 0 && (
              <div className="space-y-3 rounded-lg border p-4">
                <div className="flex justify-between text-sm">
                  <span>Private Balance</span>
                  <span className="font-medium">
                    {formatSOL(privateBalance)} SOL
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>Required (amount + fee)</span>
                  <span className="font-medium">
                    {formatSOL(requiredPrivateLamports)} SOL
                  </span>
                </div>
                {canAdjustForFee && (
                  <div className="text-xs text-muted-foreground">
                    Fee will be deducted from the withdrawal. Estimated send
                    amount: {formatSOL(effectiveWithdrawLamports)} SOL.
                  </div>
                )}
                <Button
                  onClick={() => {
                    if (canAdjustForFee) {
                      addLog(
                        `Fee shortfall detected. Adjusting withdrawal to ${formatSOL(
                          effectiveWithdrawLamports
                        )} SOL.`
                      );
                    }
                    handleWithdrawPay(effectiveWithdrawLamports);
                  }}
                  disabled={isBusy}
                  className="w-full"
                >
                  Withdraw & Pay
                </Button>
              </div>
            )}
        </div>

        {/* Payment summary (shown during withdraw) */}
        {paymentSummary && status === "withdrawing" && (
          <div className="space-y-2 p-4 bg-muted rounded-lg">
            <div className="flex justify-between text-sm">
              <span>Amount</span>
              <span className="font-medium">
                {formatSOL(paymentSummary.amount)} SOL
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span>Fee</span>
              <span className="font-medium">
                {formatSOL(paymentSummary.fee)} SOL
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span>Recipient</span>
              <span className="font-mono text-xs">
                {paymentSummary.recipientPreview}
              </span>
            </div>
            <Separator className="my-2" />
            <div className="flex justify-between font-semibold">
              <span>Total</span>
              <span>
                {formatSOL(paymentSummary.amount + paymentSummary.fee)} SOL
              </span>
            </div>
          </div>
        )}

        {/* Status message */}
        {getStatusMessage() && (
          <div className="flex items-center gap-3 p-4 bg-blue-500/10 border border-blue-500/20 rounded-lg">
            <div className="animate-spin h-4 w-4 border-2 border-blue-500 border-t-transparent rounded-full" />
            <p className="text-sm text-blue-600">{getStatusMessage()}</p>
          </div>
        )}

        {/* Error */}
        {error && status === "error" && (
          <div className="p-4 bg-red-500/10 border border-red-500/20 rounded text-red-500 text-sm">
            {error}
          </div>
        )}

        {/* Activity log */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">Activity Log</Label>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Switch
                  id="payment-link-verbose-logs"
                  checked={verboseLogs}
                  onCheckedChange={setVerboseLogs}
                />
                <Label
                  htmlFor="payment-link-verbose-logs"
                  className="text-sm font-normal"
                >
                  Verbose
                </Label>
              </div>
              <Button variant="ghost" size="sm" onClick={clearLogs}>
                Clear
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            SDK logs appear here so you can see what&apos;s running under the
            hood.
          </p>
          <div className="h-48 overflow-y-auto rounded bg-muted/50 p-4 font-mono text-xs">
            {logs.length === 0 ? (
              <p className="text-muted-foreground">No activity yet</p>
            ) : (
              logs.map((log, i) => (
                <div
                  key={i}
                  className={`mb-1 ${
                    log.type === "error"
                      ? "text-red-500"
                      : log.type === "success"
                      ? "text-green-500"
                      : "text-foreground"
                  }`}
                >
                  <span className="text-muted-foreground">
                    [{log.timestamp.toLocaleTimeString()}]
                  </span>{" "}
                  {log.message}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Privacy notice */}
        <div className="text-xs text-muted-foreground text-center space-y-1">
          <p>🔒 Your payment is private and secure</p>
          <p>The recipient's address is protected from public view</p>
        </div>
      </CardContent>
    </Card>
  );
}
