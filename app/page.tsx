"use client";

import Image from "next/image";
import Link from "next/link";
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

      {/* Logo in top-left corner */}
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

      {/* Centered main content — fixed height so tab bar doesn't jump when switching tabs */}
      <main className="relative z-20 min-h-screen flex items-center justify-center px-4 py-20">
        <div className="w-full max-w-xl h-[640px] flex flex-col">
          <PaymentLinksManager />
        </div>
      </main>
    </div>
  );
}
