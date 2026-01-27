"use client";

import Image from "next/image";
import { PaymentLinksManager } from "@/components/payment-links-manager";

export default function Page() {
  return (
    <div className="min-h-screen w-full relative bg-black">
      {/* Dark Noise Colored Background */}
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
      <main className="relative z-20 container mx-auto px-4 ">
        <div className="mx-auto flex max-w-xl flex-col ">
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
          </div>

          <PaymentLinksManager />
        </div>
      </main>
    </div>
  );
}
