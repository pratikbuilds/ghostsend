"use client"

import { WalletButton } from "@/components/wallet-button"

export function Header() {
  return (
    <header className="sticky top-0 z-50 w-full border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-16 items-center justify-between px-4">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight">Privacy UI</h1>
        </div>
        <nav className="flex items-center gap-4">
          <WalletButton />
        </nav>
      </div>
    </header>
  )
}
