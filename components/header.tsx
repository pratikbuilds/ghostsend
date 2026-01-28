"use client";

import Image from "next/image";
import { WalletConnectButton } from "@/components/wallet-button";

export function Header() {
  return (
    <header className="sticky top-0 w-full glassmorphic-header">
      <div className="header-content container mx-auto">
        <div className="flex items-center justify-between">
          <div className="logo-container">
            <Image
              src="/logo.png"
              alt="ghostsend logo"
              width={40}
              height={40}
              className="header-logo"
            />
            <h1 className="text-xl font-bold tracking-tight text-foreground/90">
              ghostsend
            </h1>
          </div>
          <nav className="flex items-center">
            <div className="wallet-button-container">
              <WalletConnectButton />
            </div>
          </nav>
        </div>
      </div>
    </header>
  );
}
