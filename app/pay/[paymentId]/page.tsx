"use client";

import { use, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { PaymentReceiver } from "@/components/payment-receiver";

export default function PaymentPage({
  params,
}: {
  params: Promise<{ paymentId: string }>;
}) {
  const { paymentId } = use(params);
  const [hideIntro, setHideIntro] = useState(false);

  return (
    <div className="h-dvh w-full relative bg-black flex flex-col overflow-hidden">
      <div
        className="absolute inset-0 z-0"
        style={{
          background:
            "radial-gradient(ellipse 80% 60% at 50% 0%, rgba(120, 180, 255, 0.25), transparent 70%), #000000",
        }}
      />
      <div
        className="absolute inset-0 z-10"
        style={{
          backgroundImage:
            "radial-gradient(circle at 25% 25%, #222222 0.5px, transparent 1px), radial-gradient(circle at 75% 75%, #111111 0.5px, transparent 1px)",
          backgroundSize: "10px 10px",
          imageRendering: "pixelated",
          opacity: 0.6,
        }}
      />
      <Link href="/" className="absolute top-6 left-6 z-30 block">
        <Image
          src="/new_logo.png"
          alt="ghostsend logo"
          width={1536}
          height={1024}
          className="h-auto w-[clamp(100px,20vw,160px)] opacity-90 hover:opacity-100 transition-opacity"
          priority
        />
        <h1 className="sr-only">ghostsend</h1>
      </Link>
      <main className="relative z-20 flex-1 min-h-0 flex items-center justify-center px-4 py-6 overflow-hidden">
        <div className="w-full max-w-2xl h-full max-h-[calc(100dvh-6rem)] flex flex-col items-center justify-center gap-3">
          {!hideIntro && (
            <div className="flex flex-col items-center gap-1.5 text-center shrink-0 ">
              <div
                className="flex items-center justify-center gap-2 rounded-full border border-primary/30 bg-primary/5 px-4 py-1.5 text-sm text-primary"
                aria-hidden
              >
                <span className="size-2 rounded-full bg-primary" />
                Private payment request
              </div>
              <p className="text-balance text-sm text-muted-foreground max-w-lg">
                Connect wallet, sign once to reveal balance, then pay.
              </p>
            </div>
          )}
          <div className="min-h-0 w-full flex justify-center overflow-hidden">
            <PaymentReceiver
              paymentId={paymentId}
              onSigningChange={setHideIntro}
            />
          </div>
        </div>
      </main>
    </div>
  );
}
