"use client";

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
import { cn } from "@/lib/utils";
import { Wallet } from "lucide-react";

type WalletConnectButtonProps = {
  size?: "sm" | "default";
  className?: string;
  align?: "start" | "center" | "end";
};

function truncateAddress(address: string) {
  if (address.length <= 12) return address;
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

function StatusDot({ status }: { status: "connected" | "connecting" | "idle" }) {
  return (
    <span
      className={cn(
        "inline-flex h-2 w-2 rounded-full",
        status === "connected" && "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.7)]",
        status === "connecting" && "bg-amber-400 animate-pulse",
        status === "idle" && "bg-muted-foreground/60",
      )}
    />
  );
}

export function WalletConnectButton({
  size = "sm",
  className,
  align = "end",
}: WalletConnectButtonProps) {
  const wallet = useWallet();
  const address = wallet.publicKey?.toBase58();
  const { setShowModal } = useUnifiedWalletContext();

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

  if (wallet.connecting) {
    return (
      <Button
        variant="outline"
        size={size}
        disabled
        className={cn("min-w-[140px] gap-2", className)}
      >
        <StatusDot status="connecting" />
        <span className="animate-pulse">Connecting...</span>
      </Button>
    );
  }

  if (wallet.connected && address) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size={size}
            className={cn("font-mono min-w-[140px] gap-2", className)}
            title={address}
          >
            <StatusDot status="connected" />
            {truncateAddress(address)}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align={align}>
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

  return (
    <Button
      variant="default"
      size={size}
      className={cn("gap-2", className)}
      onClick={() => setShowModal(true)}
    >
      <StatusDot status="idle" />
      <Wallet className="h-4 w-4" />
      <span>Connect wallet</span>
    </Button>
  );
}

export const WalletButton = WalletConnectButton;
