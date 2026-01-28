"use client";

import { useEffect, useMemo, useState } from "react";
import { useUnifiedWalletContext, useWallet } from "@jup-ag/wallet-adapter";
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
import { Textarea } from "@/components/ui/textarea";
import { CopyButton } from "@/components/ui/copy-button";
import { cn } from "@/lib/utils";
import { AmountTokenInput } from "@/components/ui/amount-token-input";
import { PaymentLinksAPI } from "@/lib/api-service";
import type { PaymentLinkMetadata, TokenMint } from "@/lib/payment-links-types";
import {
  SOL_MINT,
  formatTokenAmount,
  getTokenByMint,
  parseTokenAmountToBaseUnits,
  tokenRegistry,
} from "@/lib/token-registry";
import { Link2, CheckCircle2, Copy, Check } from "lucide-react";

type CreatedLink = { metadata: PaymentLinkMetadata; url: string };

function CopyButtonWithIcon({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // no-op
    }
  };
  return (
    <Button
      onClick={handleCopy}
      variant="outline"
      size="sm"
      className={cn(
        "h-11 shrink-0 gap-2 rounded-lg border-primary/30 bg-primary/5 px-4 font-medium text-primary hover:bg-primary/10 hover:border-primary/50 transition-all [&_svg]:size-4",
        copied && "border-green-500/40 bg-green-500/10 text-green-600 dark:text-green-400",
        className
      )}
    >
      {copied ? (
        <>
          <Check className="size-4" />
          Copied
        </>
      ) : (
        <>
          <Copy className="size-4" />
          Copy
        </>
      )}
    </Button>
  );
}

interface PaymentLinkCreatorProps {
  onCreated?: (created: CreatedLink) => void;
}

export function PaymentLinkCreator({ onCreated }: PaymentLinkCreatorProps) {
  const { publicKey } = useWallet();
  const { setShowModal } = useUnifiedWalletContext();

  const [tokenMint, setTokenMint] = useState<TokenMint>(
    SOL_MINT || tokenRegistry[0]?.mint || "",
  );
  const [amount, setAmount] = useState("");
  const [message, setMessage] = useState("");
  const [recipientAddress, setRecipientAddress] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdLink, setCreatedLink] = useState<CreatedLink | null>(null);

  const baseUrl = useMemo(() => {
    if (typeof window === "undefined") return "";
    return window.location.origin;
  }, []);

  const address = publicKey?.toBase58();

  useEffect(() => {
    if (address && !recipientAddress) {
      setRecipientAddress(address);
    }
  }, [address, recipientAddress]);

  const handleCreate = async () => {
    const resolvedRecipient = recipientAddress.trim() || address;
    if (!resolvedRecipient) {
      setError("Enter a recipient address or connect a wallet");
      setShowModal(true);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const token = getTokenByMint(tokenMint);
      if (!token) {
        throw new Error("Unsupported token");
      }

      const baseUnits = parseTokenAmountToBaseUnits(amount, token);
      if (!Number.isFinite(baseUnits) || baseUnits <= 0) {
        throw new Error("Please enter a valid amount");
      }

      const body = {
        recipientAddress: resolvedRecipient,
        tokenMint,
        amountType: "fixed" as const,
        fixedAmount: baseUnits,
        reusable: false,
        message: message.trim() || undefined,
      };

      const result = await PaymentLinksAPI.createPaymentLink(body);

      if (!result.success || !result.data) {
        throw new Error(result.error || "Failed to create payment link");
      }

      const resolvedUrl = baseUrl
        ? `${baseUrl}/pay/${result.data.paymentLink.paymentId}`
        : result.data.url;

      const created = {
        metadata: result.data.paymentLink,
        url: resolvedUrl,
      };

      setCreatedLink(created);
      onCreated?.(created);

      setAmount("");
      setMessage("");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to create payment link",
      );
    } finally {
      setLoading(false);
    }
  };

  const formatAmount = (baseUnits?: number, mint?: string) => {
    if (!baseUnits || !mint) return "N/A";
    const token = getTokenByMint(mint);
    if (!token) return "N/A";
    return `${formatTokenAmount(baseUnits, token)} ${token.label}`;
  };

  return (
    <div className="space-y-4">
      {createdLink ? (
        <Card
          className="animate-success-in border-border/50 bg-card/90 overflow-hidden rounded-2xl shadow-[0_0_0_1px_var(--border),0_8px_40px_-12px_oklch(0.72_0.15_220/12%)] dark:shadow-[0_0_0_1px_var(--border),0_8px_40px_-12px_black/40%]"
          size="default"
        >
          <CardHeader className="space-y-3 px-6 pt-8 pb-2 text-center">
            <div
              className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 ring-2 ring-primary/20"
              aria-hidden
            >
              <CheckCircle2 className="h-8 w-8 text-primary" strokeWidth={1.75} />
            </div>
            <CardTitle className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
              Payment link ready
            </CardTitle>
            <CardDescription className="text-sm text-muted-foreground">
              Share the link below — recipients can pay without seeing your wallet
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6 px-6 pb-8 pt-4">
            <div className="space-y-2">
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Payment link
              </Label>
              <div className="flex gap-2 items-stretch">
                <Input
                  value={createdLink.url}
                  readOnly
                  className="flex-1 min-h-0 h-11 font-mono text-sm tabular-nums text-foreground selection:bg-primary/20 rounded-lg border-input bg-muted/30 py-2.5 px-3"
                />
                <CopyButtonWithIcon text={createdLink.url} />
              </div>
            </div>

            {/* Token + amount: single loud block, no chip */}
            {(() => {
              const token = getTokenByMint(createdLink.metadata.tokenMint);
              const label = token?.label ?? "Token";
              const icon = token?.icon;
              const amountStr = formatAmount(
                createdLink.metadata.fixedAmount,
                createdLink.metadata.tokenMint,
              );
              return (
                <div className="flex flex-col gap-1 rounded-lg border border-border/50 bg-muted/10 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
                  <div className="flex items-center gap-3">
                    {icon ? (
                      <span
                        className="size-10 shrink-0 rounded-full bg-cover bg-center bg-no-repeat ring-2 ring-primary/20"
                        style={{ backgroundImage: `url(${icon})` }}
                        role="img"
                        aria-hidden
                      />
                    ) : null}
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        Token
                      </p>
                      <p className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
                        {label}
                      </p>
                    </div>
                  </div>
                  <div className="border-t border-border/50 pt-4 sm:border-t-0 sm:border-l sm:border-border/50 sm:pt-0 sm:pl-6 sm:min-w-0">
                    <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Amount
                    </p>
                    <p className="mt-0.5 text-2xl font-bold tabular-nums tracking-tight text-foreground sm:text-3xl">
                      {amountStr}
                    </p>
                  </div>
                </div>
              );
            })()}
            {createdLink.metadata.message && (
              <div className="rounded-lg border border-border/50 bg-muted/20 px-4 py-3">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Message
                </p>
                <p className="mt-1.5 text-sm text-foreground">
                  {createdLink.metadata.message}
                </p>
              </div>
            )}

            <div className="flex flex-col gap-2 pt-2">
              <Button
                onClick={() => setCreatedLink(null)}
                className="h-12 w-full rounded-lg bg-primary text-primary-foreground font-semibold shadow-lg shadow-primary/20 hover:bg-primary/90 hover:shadow-primary/25 active:translate-y-px transition-all"
              >
                <Link2 className="h-4 w-4" />
                Create another link
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-border/50 bg-card/90 overflow-hidden rounded-2xl shadow-[0_0_0_1px_var(--border),0_8px_40px_-12px_oklch(0.72_0.15_220/8%)] dark:shadow-[0_0_0_1px_var(--border),0_8px_40px_-12px_black/30%]">
          <CardHeader className="space-y-2 px-6 pt-6 pb-4">
            <CardTitle className="text-lg font-semibold tracking-tight sm:text-xl">
              Create payment link
            </CardTitle>
            <CardDescription className="text-sm text-muted-foreground">
              Generate a private link. Recipients pay without seeing your wallet
              address.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5 px-6 pb-8">
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <Label>Recipient address</Label>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => address && setRecipientAddress(address)}
                    disabled={!address}
                  >
                    Use connected wallet
                  </Button>
                  <WalletConnectButton size="sm" />
                </div>
              </div>
              <Input
                value={recipientAddress}
                onChange={(event) => setRecipientAddress(event.target.value)}
                placeholder="Paste a Solana address"
                autoComplete="off"
              />
              <p className="text-xs text-muted-foreground">
                Connect a wallet or paste the address you want to receive funds.
              </p>
            </div>

            <div className="space-y-2">
              <Label>Amount</Label>
              <AmountTokenInput
                amount={amount}
                onAmountChange={setAmount}
                token={tokenMint}
                onTokenChange={setTokenMint}
              />
            </div>

            <div className="space-y-2">
              <Label>Message (optional)</Label>
              <Textarea
                placeholder="Thanks!"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                maxLength={200}
                rows={3}
              />
            </div>

            {error && (
              <div className="p-3 bg-red-500/10 border border-red-500/20 rounded text-red-500 text-sm">
                {error}
              </div>
            )}

            <Button
              onClick={handleCreate}
              disabled={loading}
              className="w-full h-14 gap-3 rounded-2xl bg-primary text-primary-foreground text-lg font-semibold shadow-lg hover:bg-primary/90 hover:shadow-xl active:bg-primary/80 active:translate-y-px active:shadow-md disabled:opacity-50 transition-all"
            >
              <Link2 className="h-5 w-5" />
              {loading ? "Creating..." : "Generate Payment Link"}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
