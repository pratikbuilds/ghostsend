"use client";

import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { useWallet } from "@jup-ag/wallet-adapter";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// Dynamic import with SSR disabled - this is critical for wallet adapters
const UnifiedWalletButton = dynamic(
  () => import("@jup-ag/wallet-adapter").then((mod) => mod.UnifiedWalletButton),
  {
    ssr: false,
    loading: () => (
      <Button variant="outline" size="sm" disabled className="min-w-[140px]">
        <span className="animate-pulse">Loading...</span>
      </Button>
    ),
  }
);

function truncateAddress(address: string) {
  if (address.length <= 12) return address;
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

export function WalletButton() {
  const [mounted, setMounted] = useState(false);
  const wallet = useWallet();
  const address = wallet.publicKey?.toBase58();

  // Handle SSR hydration - only render wallet UI after mount
  useEffect(() => {
    setMounted(true);
  }, []);

  const handleCopy = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
    } catch {
      // ignore clipboard failures (e.g. http / permissions)
    }
  };

  const handleDisconnect = async () => {
    try {
      await wallet.disconnect?.();
    } catch {
      // ignore disconnect failures
    }
  };

  // Show skeleton during SSR/hydration
  if (!mounted) {
    return (
      <Button variant="outline" size="sm" disabled className="min-w-[140px]">
        <span className="animate-pulse">Loading...</span>
      </Button>
    );
  }

  // Show connecting state
  if (wallet.connecting) {
    return (
      <Button variant="outline" size="sm" disabled className="min-w-[140px]">
        <span className="animate-pulse">Connecting...</span>
      </Button>
    );
  }

  // Show connected state with dropdown
  if (wallet.connected && address) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="font-mono min-w-[140px]">
            {truncateAddress(address)}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>Wallet</DropdownMenuLabel>
          <DropdownMenuItem onSelect={handleCopy}>
            Copy address
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={handleDisconnect}>
            Disconnect
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  // Show connect button
  return (
    <div className="wallet-adapter-button-container">
      <UnifiedWalletButton />
    </div>
  );
}
