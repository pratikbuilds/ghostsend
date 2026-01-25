/**
 * Get Recipient API
 *
 * POST /api/payment-links/[paymentId]/recipient
 *
 * Returns the recipient address for a payment link after validating the request.
 * This is called by the frontend to perform the withdrawal directly.
 *
 * NOTE: We intentionally do NOT require or log the sender's address - the whole
 * point of Privacy Cash is that the sender remains anonymous.
 */

import { NextRequest, NextResponse } from 'next/server';
import { PaymentLinksStore } from '@/lib/payment-links-store';

interface GetRecipientRequest {
  amount: number;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ paymentId: string }> }
) {
  try {
    const { paymentId } = await params;
    const body = await request.json() as GetRecipientRequest;

    // 1. Get payment link
    const paymentLink = PaymentLinksStore.getPaymentLink(paymentId);

    if (!paymentLink) {
      return NextResponse.json(
        { success: false, error: 'Payment link not found' },
        { status: 404 }
      );
    }

    // 2. Check if payment link can accept payments
    if (!PaymentLinksStore.canAcceptPayment(paymentId)) {
      return NextResponse.json(
        { success: false, error: 'Payment link is no longer active' },
        { status: 410 }
      );
    }

    // 3. Validate amount
    const validation = PaymentLinksStore.validateAmount(paymentId, body.amount);
    if (!validation.valid) {
      return NextResponse.json(
        { success: false, error: validation.error },
        { status: 400 }
      );
    }

    // 4. Return the recipient address
    return NextResponse.json({
      success: true,
      recipientAddress: paymentLink.recipientAddress,
    });
  } catch (error) {
    console.error('Error getting recipient:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to get recipient' },
      { status: 500 }
    );
  }
}
