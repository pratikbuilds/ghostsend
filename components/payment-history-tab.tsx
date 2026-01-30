"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { PaymentRecord } from "@/lib/payment-links-types";
import { formatTokenAmount, getTokenByMint } from "@/lib/token-registry";

interface PaymentHistoryTabProps {
  payments: PaymentRecord[];
  loading: boolean;
  isWalletConnected: boolean;
}

export function PaymentHistoryTab({
  payments,
  loading,
  isWalletConnected,
}: PaymentHistoryTabProps) {
  if (!isWalletConnected) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          Connect your wallet to view payment history.
        </CardContent>
      </Card>
    );
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          Loading payment history...
        </CardContent>
      </Card>
    );
  }

  if (payments.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          No payments yet. Share a link to start receiving payments.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {payments.map((payment) => {
        const dateLabel = new Date(payment.completedAt).toLocaleString();
        const token = getTokenByMint(payment.tokenMint);
        const amountLabel = token
          ? `${formatTokenAmount(payment.amount, token)} ${token.label}`
          : "Unknown token";
        const explorerUrl = `https://explorer.solana.com/tx/${payment.txSignature}`;

        return (
          <Card key={payment.id}>
            <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
              <div>
                <div className="text-sm font-semibold">{amountLabel}</div>
                <div className="text-xs text-muted-foreground">{dateLabel}</div>
                <div className="text-xs text-muted-foreground">Status: {payment.status}</div>
              </div>
              <Button asChild variant="outline">
                <a href={explorerUrl} target="_blank" rel="noopener noreferrer">
                  View Proof
                </a>
              </Button>
            </CardContent>
          </Card>
        );
      })}
      <p className="text-xs text-muted-foreground text-center">
        Session data only. Payments reset on page reload.
      </p>
    </div>
  );
}
