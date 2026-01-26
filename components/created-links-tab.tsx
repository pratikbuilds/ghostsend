"use client";

import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CopyButton } from "@/components/ui/copy-button";
import { Input } from "@/components/ui/input";
import type { PaymentLinkMetadata } from "@/lib/payment-links-types";

interface CreatedLinksTabProps {
  links: PaymentLinkMetadata[];
  loading: boolean;
  onDelete: (paymentId: string) => void;
  isWalletConnected: boolean;
}

export function CreatedLinksTab({
  links,
  loading,
  onDelete,
  isWalletConnected,
}: CreatedLinksTabProps) {
  const baseUrl = useMemo(() => {
    if (typeof window === "undefined") return "";
    return window.location.origin;
  }, []);

  if (!isWalletConnected) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          Connect your wallet to view created links.
        </CardContent>
      </Card>
    );
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          Loading your links...
        </CardContent>
      </Card>
    );
  }

  if (links.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          No links yet. Create a payment link to get started.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {links.map((link) => {
        const url = baseUrl ? `${baseUrl}/pay/${link.paymentId}` : "";
        const createdAt = new Date(link.createdAt).toLocaleString();
        const statusLabel = link.status === "completed" ? "Completed" : "Pending";
        const amountLabel = link.fixedAmount
          ? `${(link.fixedAmount / 1e9).toFixed(3)} ${link.tokenType.toUpperCase()}`
          : `0 ${link.tokenType.toUpperCase()}`;
        const canShare = typeof navigator !== "undefined" && Boolean(navigator.share);

        return (
          <Card key={link.paymentId}>
            <CardContent className="space-y-3 p-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="space-y-1">
                  <div className="text-lg font-semibold">{amountLabel}</div>
                  <div className="text-xs text-muted-foreground">
                    Created {createdAt}
                  </div>
                </div>
                <Badge variant={link.status === "completed" ? "secondary" : "outline"}>
                  {statusLabel}
                </Badge>
              </div>

              {url && (
                <div className="space-y-3">
                  <div className="flex gap-2">
                    <Input value={url} readOnly className="h-9 text-xs" />
                    <CopyButton text={url} className="h-9 px-4" />
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-9 px-4"
                      disabled={!canShare}
                      onClick={() => {
                        if (navigator.share) navigator.share({ url });
                      }}
                    >
                      Share
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      className="h-9 px-4"
                      onClick={() => onDelete(link.paymentId)}
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
