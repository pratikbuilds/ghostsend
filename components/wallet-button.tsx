"use client";

import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { useUnifiedWalletContext, useWallet } from "@jup-ag/wallet-adapter";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Wallet } from "lucide-react";

function WalletBtn() {
  const { connected, disconnect, connecting, publicKey } = useWallet();
  const { setShowModal } = useUnifiedWalletContext();

  return connected ? (
    <Button
      variant="outline"
      size="sm"
      className="gap-2 text-xs sm:text-sm"
      onClick={disconnect}
    >
      <Wallet className="h-4 w-4" />
      <span
        className="hidden sm:inline max-w-[120px] truncate"
        title={publicKey?.toBase58()}
      >
        {publicKey?.toBase58()?.slice(0, 4) +
          "..." +
          publicKey?.toBase58()?.slice(-4)}
      </span>
      <span className="sm:hidden">Connected</span>
    </Button>
  ) : (
    <Button
      variant="default"
      size="sm"
      className="gap-2 text-xs sm:text-sm"
      disabled={connecting}
      onClick={() => setShowModal(true)}
    >
      <Wallet className="h-4 w-4" />
      <span>Connect Wallet</span>
    </Button>
  );
}

function truncateAddress(address: string) {
  if (address.length <= 12) return address;
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

export function WalletButton() {
  const wallet = useWallet();
  const address = wallet.publicKey?.toBase58();

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
          <Button
            variant="outline"
            size="sm"
            className="font-mono min-w-[140px]"
          >
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
      <WalletBtn />
    </div>
  );
}
