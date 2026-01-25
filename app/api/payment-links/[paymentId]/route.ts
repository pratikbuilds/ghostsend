/**
 * Payment Link Details API
 *
 * GET /api/payment-links/[paymentId] - Get public payment link info (no recipient)
 */

import { NextRequest, NextResponse } from 'next/server';
import { PaymentLinksStore } from '@/lib/payment-links-store';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ paymentId: string }> }
) {
  try {
    const { paymentId } = await params;

    // Get public info (does not include recipient address)
    const paymentLink = PaymentLinksStore.getPaymentLinkPublicInfo(paymentId);

    if (!paymentLink) {
      return NextResponse.json(
        { success: false, error: 'Payment link not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      paymentLink,
    });
  } catch (error) {
    console.error('Error fetching payment link:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch payment link',
      },
      { status: 500 }
    );
  }
}
