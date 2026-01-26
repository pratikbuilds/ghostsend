"use client";

import { useEffect, useState } from "react";
import { useUnifiedWalletContext, useWallet } from "@jup-ag/wallet-adapter";
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
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { CopyButton } from "@/components/ui/copy-button";
import { AmountTokenInput } from "@/components/ui/amount-token-input";
import { PaymentLinksAPI } from "@/lib/api-service";
import type { PaymentLinkMetadata, TokenType } from "@/lib/payment-links-types";
import { Link2 } from "lucide-react";

type CreatedLink = { metadata: PaymentLinkMetadata; url: string };

interface PaymentLinkCreatorProps {
  onCreated?: (created: CreatedLink) => void;
}

export function PaymentLinkCreator({ onCreated }: PaymentLinkCreatorProps) {
  const { publicKey, connected, connecting, disconnect } = useWallet();
  const { setShowModal } = useUnifiedWalletContext();

  const [tokenType, setTokenType] = useState<TokenType>("sol");
  const [amount, setAmount] = useState("");
  const [message, setMessage] = useState("");
  const [recipientAddress, setRecipientAddress] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdLink, setCreatedLink] = useState<CreatedLink | null>(null);

  const address = publicKey?.toBase58();
  const shortAddress = address
    ? `${address.slice(0, 4)}...${address.slice(-4)}`
    : null;

  useEffect(() => {
    if (address && !recipientAddress) {
      setRecipientAddress(address);
    }
  }, [address, recipientAddress]);

  const handleCopyAddress = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
    } catch {
      // ignore clipboard failures (e.g. http / permissions)
    }
  };

  const handleDisconnect = async () => {
    try {
      await disconnect?.();
    } catch {
      // ignore disconnect failures
    }
  };

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
      const amountSol = parseFloat(amount);
      if (isNaN(amountSol) || amountSol <= 0) {
        throw new Error("Please enter a valid amount");
      }

      const body = {
        recipientAddress: resolvedRecipient,
        tokenType,
        amountType: "fixed" as const,
        fixedAmount: Math.floor(amountSol * 1e9),
        reusable: false,
        message: message.trim() || undefined,
      };

      const result = await PaymentLinksAPI.createPaymentLink(body);

      if (!result.success || !result.data) {
        throw new Error(result.error || "Failed to create payment link");
      }

      const created = {
        metadata: result.data.paymentLink,
        url: result.data.url,
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

  const formatAmount = (lamports?: number) => {
    if (!lamports) return "N/A";
    return `${(lamports / 1e9).toFixed(3)} SOL`;
  };

  return (
    <div className="space-y-4">
      {createdLink ? (
        <Card className="border-border/60 bg-card/80">
          <CardHeader className="space-y-2 pb-4">
            <CardTitle>Payment Link Created!</CardTitle>
            <CardDescription>
              Share this link to receive payments
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Payment Link</Label>
              <div className="flex gap-2">
                <Input value={createdLink.url} readOnly className="flex-1" />
                <CopyButton text={createdLink.url} />
              </div>
            </div>

            <div className="space-y-2 p-4 bg-muted rounded-lg">
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Token:</span>
                <Badge variant="secondary">
                  {createdLink.metadata.tokenType.toUpperCase()}
                </Badge>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Amount:</span>
                <span className="text-sm font-medium">
                  {formatAmount(createdLink.metadata.fixedAmount)}
                </span>
              </div>
              {createdLink.metadata.message && (
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">
                    Message:
                  </span>
                  <span className="text-sm font-medium">
                    {createdLink.metadata.message}
                  </span>
                </div>
              )}
            </div>

            <Button
              onClick={() => setCreatedLink(null)}
              variant="outline"
              className="w-full"
            >
              Create Another Link
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-border/60 bg-card/80">
          <CardHeader className="space-y-2 pb-4">
            <CardTitle>Create Payment Link</CardTitle>
            <CardDescription>
              Generate a private payment link. Recipients won&apos;t see your
              wallet address publicly.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
              <span className="text-xs text-muted-foreground">
                Connected Wallet
              </span>
              {connected && address ? (
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
                    <DropdownMenuItem
                      variant="destructive"
                      onSelect={handleDisconnect}
                    >
                      Disconnect
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {connecting ? "Connecting..." : "Not connected"}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={connecting}
                    className="h-7 px-2 text-xs"
                    onClick={() => setShowModal(true)}
                  >
                    Connect wallet
                  </Button>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Recipient address</Label>
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
                token={tokenType}
                onTokenChange={setTokenType}
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
              className="w-full h-14 gap-3 text-lg font-semibold"
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
