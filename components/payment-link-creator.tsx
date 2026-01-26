"use client";

import { useState } from "react";
import { useWallet } from "@jup-ag/wallet-adapter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { CopyButton } from "@/components/ui/copy-button";
import { PaymentLinksAPI } from "@/lib/api-service";
import type { PaymentLinkMetadata } from "@/lib/payment-links-types";

export function PaymentLinkCreator() {
  const { publicKey } = useWallet();

  // Form state
  const [tokenType, setTokenType] = useState<string>("sol");
  const [amountType, setAmountType] = useState<"fixed" | "flexible">("fixed");
  const [fixedAmount, setFixedAmount] = useState("");
  const [minAmount, setMinAmount] = useState("");
  const [maxAmount, setMaxAmount] = useState("");
  const [reusable, setReusable] = useState(false);
  const [maxUsageCount, setMaxUsageCount] = useState("");
  const [label, setLabel] = useState("");
  const [message, setMessage] = useState("");

  // UI state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdLink, setCreatedLink] = useState<{ metadata: PaymentLinkMetadata; url: string } | null>(null);

  const handleCreate = async () => {
    if (!publicKey) {
      setError("Please connect your wallet");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const body: any = {
        recipientAddress: publicKey.toBase58(),
        tokenType,
        amountType,
        reusable,
      };

      if (amountType === "fixed") {
        const amountSol = parseFloat(fixedAmount);
        if (isNaN(amountSol) || amountSol <= 0) {
          throw new Error("Please enter a valid amount");
        }
        body.fixedAmount = Math.floor(amountSol * 1e9); // Convert SOL to lamports
      } else {
        if (minAmount) {
          const minSol = parseFloat(minAmount);
          if (!isNaN(minSol)) {
            body.minAmount = Math.floor(minSol * 1e9);
          }
        }
        if (maxAmount) {
          const maxSol = parseFloat(maxAmount);
          if (!isNaN(maxSol)) {
            body.maxAmount = Math.floor(maxSol * 1e9);
          }
        }
      }

      if (reusable && maxUsageCount) {
        const count = parseInt(maxUsageCount);
        if (!isNaN(count) && count > 0) {
          body.maxUsageCount = count;
        }
      }

      if (label.trim()) {
        body.label = label.trim();
      }

      if (message.trim()) {
        body.message = message.trim();
      }

      const result = await PaymentLinksAPI.createPaymentLink(body);

      if (!result.success || !result.data) {
        throw new Error(result.error || "Failed to create payment link");
      }

      setCreatedLink({ 
        metadata: result.data.paymentLink, 
        url: result.data.url 
      });

      // Reset form
      setFixedAmount("");
      setMinAmount("");
      setMaxAmount("");
      setLabel("");
      setMessage("");
      setMaxUsageCount("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create payment link");
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
      <Card>
        <CardHeader>
          <CardTitle>Create Payment Link</CardTitle>
          <CardDescription>
            Generate a private payment link. Recipients won't see your wallet address until they pay.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Token Type */}
          <div className="space-y-2">
            <Label>Token</Label>
            <Select value={tokenType} onValueChange={setTokenType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sol">SOL</SelectItem>
                <SelectItem value="usdc" disabled>
                  USDC (Coming Soon)
                </SelectItem>
                <SelectItem value="usdt" disabled>
                  USDT (Coming Soon)
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Amount Type */}
          <div className="space-y-2">
            <Label>Amount Type</Label>
            <div className="flex gap-2">
              <Button
                type="button"
                variant={amountType === "fixed" ? "default" : "outline"}
                onClick={() => setAmountType("fixed")}
                className="flex-1"
              >
                Fixed
              </Button>
              <Button
                type="button"
                variant={amountType === "flexible" ? "default" : "outline"}
                onClick={() => setAmountType("flexible")}
                className="flex-1"
              >
                Flexible
              </Button>
            </div>
          </div>

          {/* Fixed Amount */}
          {amountType === "fixed" && (
            <div className="space-y-2">
              <Label>Amount (SOL)</Label>
              <Input
                type="number"
                step="0.001"
                placeholder="1.5"
                value={fixedAmount}
                onChange={(e) => setFixedAmount(e.target.value)}
              />
            </div>
          )}

          {/* Flexible Amount Range */}
          {amountType === "flexible" && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Min Amount (SOL, optional)</Label>
                <Input
                  type="number"
                  step="0.001"
                  placeholder="0.1"
                  value={minAmount}
                  onChange={(e) => setMinAmount(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Max Amount (SOL, optional)</Label>
                <Input
                  type="number"
                  step="0.001"
                  placeholder="10"
                  value={maxAmount}
                  onChange={(e) => setMaxAmount(e.target.value)}
                />
              </div>
            </div>
          )}

          {/* Reusable */}
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="reusable"
              checked={reusable}
              onChange={(e) => setReusable(e.target.checked)}
              className="h-4 w-4"
            />
            <Label htmlFor="reusable">Reusable link (can accept multiple payments)</Label>
          </div>

          {/* Max Usage Count */}
          {reusable && (
            <div className="space-y-2">
              <Label>Max Usage Count (optional)</Label>
              <Input
                type="number"
                placeholder="10"
                value={maxUsageCount}
                onChange={(e) => setMaxUsageCount(e.target.value)}
              />
            </div>
          )}

          {/* Label */}
          <div className="space-y-2">
            <Label>Label (optional)</Label>
            <Input
              placeholder="Coffee donation"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              maxLength={50}
            />
          </div>

          {/* Message */}
          <div className="space-y-2">
            <Label>Message (optional)</Label>
            <Textarea
              placeholder="Thank you for your support!"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={200}
              rows={3}
            />
          </div>

          {/* Error */}
          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded text-red-500 text-sm">
              {error}
            </div>
          )}

          {/* Create Button */}
          <Button onClick={handleCreate} disabled={loading || !publicKey} className="w-full">
            {loading ? "Creating..." : "Create Payment Link"}
          </Button>

          {!publicKey && (
            <p className="text-sm text-muted-foreground text-center">Connect your wallet to create payment links</p>
          )}
        </CardContent>
      </Card>

      {/* Created Link Display */}
      {createdLink && (
        <Card>
          <CardHeader>
            <CardTitle>Payment Link Created!</CardTitle>
            <CardDescription>Share this link to receive payments</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Link */}
            <div className="space-y-2">
              <Label>Payment Link</Label>
              <div className="flex gap-2">
                <Input value={createdLink.url} readOnly className="flex-1" />
                <CopyButton text={createdLink.url} />
              </div>
            </div>

            {/* Details */}
            <div className="space-y-2 p-4 bg-muted rounded-lg">
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Token:</span>
                <Badge variant="secondary">{createdLink.metadata.tokenType.toUpperCase()}</Badge>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Amount:</span>
                <span className="text-sm font-medium">
                  {createdLink.metadata.amountType === "fixed"
                    ? formatAmount(createdLink.metadata.fixedAmount)
                    : "Flexible"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Type:</span>
                <span className="text-sm font-medium">
                  {createdLink.metadata.reusable ? "Reusable" : "One-time"}
                </span>
              </div>
              {createdLink.metadata.label && (
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Label:</span>
                  <span className="text-sm font-medium">{createdLink.metadata.label}</span>
                </div>
              )}
            </div>

            <Button onClick={() => setCreatedLink(null)} variant="outline" className="w-full">
              Create Another Link
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
