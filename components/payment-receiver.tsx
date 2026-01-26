"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
import {
  depositSOL,
  getPrivateSOLBalance,
  getSessionSignature,
  signSessionMessage,
  withdrawSOL,
  WalletAdapter,
} from "@/lib/privacy-cash";
import { PaymentLinksAPI, PrivacyCashAPI } from "@/lib/api-service";
import type { PaymentLinkPublicInfo } from "@/lib/payment-links-types";

const RPC_URL =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
  "https://api.mainnet-beta.solana.com";

interface PaymentReceiverProps {
  paymentId: string;
}

type PaymentStatus = "idle" | "checking" | "depositing" | "paying" | "success" | "error";

export function PaymentReceiver({ paymentId }: PaymentReceiverProps) {
  const { publicKey, signMessage, signTransaction } = useWallet();
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
  const [depositAmount, setDepositAmount] = useState("");

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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch balances");
      setStatus("error");
    }
  }, [connection, getWalletAdapter, publicKey]);

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

  const handleDeposit = useCallback(
    async (amountToDeposit: number) => {
      if (!publicKey) return;
      setStatus("depositing");
      setError(null);
      try {
        const walletAdapter = getWalletAdapter();
        const depositResult = await depositSOL({
          connection,
          wallet: walletAdapter,
          amount_in_lamports: amountToDeposit,
        });

        await connection.confirmTransaction(depositResult.tx, "confirmed");
        await fetchBalances();
        setDepositAmount("");
        setStatus("idle");
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

    try {
      const walletAdapter = getWalletAdapter();
      const recipientResult = await PaymentLinksAPI.getRecipient(paymentId, amountLamports);

      if (!recipientResult.success || !recipientResult.data) {
        throw new Error(recipientResult.error || "Failed to get recipient");
      }

      const useBackendWithdraw =
        process.env.NEXT_PUBLIC_PRIVACYCASH_WITHDRAW_BACKEND === "true";

      const withdrawResult = useBackendWithdraw
        ? await (async () => {
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
          })()
        : await withdrawSOL({
            connection,
            wallet: walletAdapter,
            amount_in_lamports: amountLamports,
            recipient: recipientResult.data!.recipientAddress,
          });

      await PaymentLinksAPI.completePayment(paymentId, {
        txSignature: withdrawResult.tx,
        amount: amountLamports,
      });

      setStatus("success");
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

  const isBusy = status === "checking" || status === "depositing" || status === "paying";
  const hasSufficientBalance =
    privateBalance !== null && privateBalance >= requiredPrivateLamports;
  const optionalDepositLamports = Math.floor(parseFloat(depositAmount || "0") * 1e9);

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

        <div className="space-y-4">
          <div>
            <Label>Amount</Label>
            <Input
              type={paymentLink.amountType === "fixed" ? "text" : "number"}
              value={amount}
              readOnly={paymentLink.amountType === "fixed"}
              onChange={(e) => setAmount(e.target.value)}
              className="text-xl font-bold mt-2"
            />
          </div>
        </div>

        <Separator />

        <div className="space-y-4">
          <p className="text-sm font-medium">Wallet</p>
          {!publicKey && (
            <div className="p-4 bg-yellow-500/10 border border-yellow-500/20 rounded text-center">
              <p className="text-sm text-yellow-600">Connect your wallet to continue</p>
            </div>
          )}

          {publicKey && !balancesChecked && (
            <div className="flex items-center justify-between rounded-lg border p-4">
              <div className="text-sm text-muted-foreground">
                Check your balances to continue. You&apos;ll be asked to sign a
                message.
              </div>
              <Button onClick={fetchBalances} disabled={isBusy}>
                Check Balance & Continue
              </Button>
            </div>
          )}

          {publicKey && balancesChecked && (
            <div className="grid grid-cols-2 gap-4 rounded-lg border p-4">
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
          )}
        </div>

        {publicKey && balancesChecked && (
          <>
            <Separator />
            <div className="space-y-3">
              <p className="text-sm font-medium">Deposit (Optional)</p>

              {shortfallLamports !== null && shortfallLamports > 0 ? (
                <div className="space-y-3 rounded-lg border p-4">
                  <div className="text-sm text-muted-foreground">
                    You need to deposit {formatSOL(shortfallLamports)} SOL to pay
                    privately.
                  </div>
                  <Button
                    onClick={() => handleDeposit(shortfallLamports)}
                    disabled={isBusy}
                    className="w-full"
                  >
                    Deposit {formatSOL(shortfallLamports)} SOL
                  </Button>
                </div>
              ) : (
                <div className="space-y-3 rounded-lg border p-4">
                  <Label>Deposit extra SOL (optional)</Label>
                  <div className="flex gap-2">
                    <Input
                      type="number"
                      step="0.001"
                      placeholder="0.5"
                      value={depositAmount}
                      onChange={(e) => setDepositAmount(e.target.value)}
                    />
                    <Button
                      onClick={() => handleDeposit(optionalDepositLamports)}
                      disabled={isBusy || optionalDepositLamports <= 0}
                    >
                      Deposit
                    </Button>
                  </div>
                </div>
              )}
            </div>

            <Separator />

            <div className="space-y-3">
              <p className="text-sm font-medium">Pay</p>
              {paymentLink.tokenType !== "sol" && (
                <div className="p-4 bg-yellow-500/10 border border-yellow-500/20 rounded text-sm text-yellow-600">
                  {paymentLink.tokenType.toUpperCase()} payments are coming soon.
                </div>
              )}
              <Button
                onClick={handlePay}
                disabled={
                  isBusy ||
                  !hasSufficientBalance ||
                  paymentLink.tokenType !== "sol" ||
                  !isValidAmount
                }
                className="w-full"
              >
                Pay {amount} {paymentLink.tokenType.toUpperCase()} Privately
              </Button>
              {!hasSufficientBalance && (
                <p className="text-xs text-muted-foreground">
                  Deposit first to cover the payment amount.
                </p>
              )}
            </div>
          </>
        )}

        {status === "checking" && (
          <div className="flex items-center gap-3 p-4 bg-blue-500/10 border border-blue-500/20 rounded-lg">
            <div className="animate-spin h-4 w-4 border-2 border-blue-500 border-t-transparent rounded-full" />
            <p className="text-sm text-blue-600">Fetching your balances...</p>
          </div>
        )}

        {status === "depositing" && (
          <div className="flex items-center gap-3 p-4 bg-blue-500/10 border border-blue-500/20 rounded-lg">
            <div className="animate-spin h-4 w-4 border-2 border-blue-500 border-t-transparent rounded-full" />
            <p className="text-sm text-blue-600">Depositing privately...</p>
          </div>
        )}

        {status === "paying" && (
          <div className="flex items-center gap-3 p-4 bg-blue-500/10 border border-blue-500/20 rounded-lg">
            <div className="animate-spin h-4 w-4 border-2 border-blue-500 border-t-transparent rounded-full" />
            <p className="text-sm text-blue-600">Sending private payment...</p>
          </div>
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
