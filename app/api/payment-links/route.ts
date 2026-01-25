/**
 * Payment Links API
 *
 * POST /api/payment-links - Create a new payment link
 */

import { NextRequest, NextResponse } from 'next/server';
import { PublicKey } from '@solana/web3.js';
import { PaymentLinksStore } from '@/lib/payment-links-store';
import type { CreatePaymentLinkRequest, CreatePaymentLinkResponse } from '@/lib/payment-links-types';

/**
 * POST /api/payment-links
 * Create a new payment link
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as CreatePaymentLinkRequest;

    // Validate recipient address
    try {
      new PublicKey(body.recipientAddress);
    } catch (err) {
      return NextResponse.json(
        { success: false, error: 'Invalid recipient address' },
        { status: 400 }
      );
    }

    // Validate token type
    const validTokens = ['sol', 'usdc', 'usdt', 'zec', 'ore', 'store'];
    if (!validTokens.includes(body.tokenType)) {
      return NextResponse.json(
        { success: false, error: 'Invalid token type' },
        { status: 400 }
      );
    }

    // Validate amount type
    if (!['fixed', 'flexible'].includes(body.amountType)) {
      return NextResponse.json(
        { success: false, error: 'Invalid amount type' },
        { status: 400 }
      );
    }

    // Create payment link
    const paymentLink = PaymentLinksStore.createPaymentLink(body);

    // Get base URL from request
    const baseUrl = request.nextUrl.origin;
    const url = `${baseUrl}/pay/${paymentLink.paymentId}`;

    const response: CreatePaymentLinkResponse = {
      success: true,
      paymentLink,
      url,
    };

    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    console.error('Error creating payment link:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create payment link',
      },
      { status: 500 }
    );
  }
}
