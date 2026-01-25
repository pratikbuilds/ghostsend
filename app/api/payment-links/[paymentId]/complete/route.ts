/**
 * Complete Payment API
 *
 * POST /api/payment-links/[paymentId]/complete
 *
 * Marks a payment link as used after successful payment.
 * - Increments usage count
 * - Marks one-time links as completed
 *
 * No payment records are stored - the tx is on-chain.
 */

import { NextRequest, NextResponse } from "next/server";
import { PaymentLinksStore } from "@/lib/payment-links-store";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ paymentId: string }> }
) {
  try {
    const { paymentId } = await params;

    const paymentLink = PaymentLinksStore.getPaymentLink(paymentId);

    if (!paymentLink) {
      return NextResponse.json(
        { success: false, error: "Payment link not found" },
        { status: 404 }
      );
    }

    // 2. Increment usage count (marks one-time links as completed)
    PaymentLinksStore.incrementUsageCount(paymentId);

    // 3. Return success
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error completing payment:", error);
    return NextResponse.json(
      { success: false, error: "Failed to complete payment" },
      { status: 500 }
    );
  }
}
