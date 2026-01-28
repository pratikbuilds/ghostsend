"use client";

import { use } from "react";
import { PaymentReceiver } from "@/components/payment-receiver";

import Image from "next/image";

export default function PaymentPage({
  params,
}: {
  params: Promise<{ paymentId: string }>;
}) {
  const { paymentId } = use(params);

  return (
    <div className="min-h-screen w-full relative bg-black">
      {/* Prismatic Aurora Burst - Multi-layered Gradient */}
      <div
        className="absolute inset-0 z-0"
        style={{
          background:
            "radial-gradient(ellipse 80% 60% at 50% 0%, rgba(120, 180, 255, 0.25), transparent 70%), #000000",
        }}
      />
      <main className="relative z-20 container mx-auto px-4 py-8">
        <div className="max-w-2xl mx-auto space-y-6">
          {/* Hero section */}

          <div className="flex flex-col items-center">
            <Image
              src="/new_logo.png"
              alt="ghostsend logo"
              width={1536}
              height={1024}
              className="h-auto w-[clamp(140px,32vw,220px)]"
              priority
            />
            <h1 className="sr-only">ghostsend</h1>
            <p className="text-muted-foreground">
              You've received a private payment request. Complete the payment
              below.
            </p>
          </div>

          {/* Payment component */}
          <PaymentReceiver paymentId={paymentId} />
        </div>
      </main>
    </div>
  );
}
