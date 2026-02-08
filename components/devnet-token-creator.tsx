"use client";

import { useCallback, useState } from "react";
import { useWallet } from "@jup-ag/wallet-adapter";
import { Connection, VersionedTransaction } from "@solana/web3.js";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { WalletConnectButton } from "@/components/wallet-button";
import { CopyButton } from "@/components/ui/copy-button";
import {
  createDevnetToken,
  requestDevnetAirdrop,
  getDevnetBalance,
  DEVNET_RPC_URL,
  type CreateTokenResult,
} from "@/lib/devnet-token";
import { Coins, Loader2, CheckCircle2, ExternalLink, Sparkles, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

type CreationStatus =
  | "idle"
  | "checking-balance"
  | "airdropping"
  | "creating"
  | "success"
  | "error";

const MINIMUM_SOL_REQUIRED = 0.05; // Minimum SOL needed for token creation
const AIRDROP_AMOUNT = 1; // Amount of SOL to airdrop
const TOKEN_AMOUNT = 100000; // Amount of tokens to mint
const TOKEN_DECIMALS = 9;

export function DevnetTokenCreator() {
  const { publicKey, signTransaction } = useWallet();
  const [connection] = useState(() => new Connection(DEVNET_RPC_URL, "confirmed"));

  const [status, setStatus] = useState<CreationStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CreateTokenResult | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>("");

  const handleCreateToken = useCallback(async () => {
    if (!publicKey || !signTransaction) {
      setError("Please connect your wallet first");
      return;
    }

    setStatus("checking-balance");
    setError(null);
    setResult(null);
    setStatusMessage("Checking SOL balance on devnet...");

    try {
      // Check current balance
      let balance = await getDevnetBalance(connection, publicKey);
      setStatusMessage(`Current balance: ${balance.toFixed(4)} SOL`);

      // If balance is too low, request airdrop
      if (balance < MINIMUM_SOL_REQUIRED) {
        setStatus("airdropping");
        setStatusMessage("Requesting SOL airdrop from devnet faucet...");

        try {
          await requestDevnetAirdrop(connection, publicKey, AIRDROP_AMOUNT);
          balance = await getDevnetBalance(connection, publicKey);
          setStatusMessage(`Airdrop received! New balance: ${balance.toFixed(4)} SOL`);
        } catch (airdropError) {
          // Airdrop might fail due to rate limiting
          const message =
            airdropError instanceof Error ? airdropError.message : String(airdropError);
          if (message.includes("429") || message.toLowerCase().includes("rate")) {
            throw new Error(
              "Devnet faucet rate limited. Please try again in a few minutes or use https://faucet.solana.com"
            );
          }
          throw airdropError;
        }
      }

      // Create the token
      setStatus("creating");
      setStatusMessage("Creating token and minting 100,000 tokens to your wallet...");

      const walletAdapter = {
        publicKey,
        signTransaction: async (tx: VersionedTransaction) => {
          return signTransaction(tx);
        },
      };

      const tokenResult = await createDevnetToken(
        connection,
        walletAdapter,
        TOKEN_DECIMALS,
        TOKEN_AMOUNT
      );

      setResult(tokenResult);
      setStatus("success");
      setStatusMessage("Token created successfully!");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create token";
      setError(message);
      setStatus("error");
      setStatusMessage("");
    }
  }, [connection, publicKey, signTransaction]);

  const handleReset = useCallback(() => {
    setStatus("idle");
    setError(null);
    setResult(null);
    setStatusMessage("");
  }, []);

  const isBusy = status === "checking-balance" || status === "airdropping" || status === "creating";

  const getExplorerUrl = (type: "tx" | "address", value: string) => {
    return `https://explorer.solana.com/${type}/${value}?cluster=devnet`;
  };

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-amber-400" />
          Devnet Token Creator
        </CardTitle>
        <CardDescription>
          Create a new SPL token on Solana devnet with one click. Automatically mints{" "}
          {TOKEN_AMOUNT.toLocaleString()} tokens to your wallet.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {!publicKey ? (
          <div className="flex flex-col items-center gap-4 py-4">
            <p className="text-muted-foreground text-sm text-center">
              Connect your wallet to create a devnet token
            </p>
            <WalletConnectButton />
          </div>
        ) : status === "success" && result ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-emerald-400">
              <CheckCircle2 className="h-5 w-5" />
              <span className="font-medium">Token Created Successfully!</span>
            </div>

            <div className="space-y-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-4">
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Mint Address</p>
                <div className="flex items-center gap-2">
                  <code className="text-xs font-mono text-foreground break-all">
                    {result.mintAddress}
                  </code>
                  <CopyButton text={result.mintAddress} />
                  <a
                    href={getExplorerUrl("address", result.mintAddress)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </div>
              </div>

              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Your Token Account</p>
                <div className="flex items-center gap-2">
                  <code className="text-xs font-mono text-foreground break-all">
                    {result.tokenAccount}
                  </code>
                  <CopyButton text={result.tokenAccount} />
                  <a
                    href={getExplorerUrl("address", result.tokenAccount)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </div>
              </div>

              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Amount Minted</p>
                <p className="text-sm font-medium text-foreground">
                  {result.amountMinted.toLocaleString()} tokens
                </p>
              </div>

              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Transaction</p>
                <a
                  href={getExplorerUrl("tx", result.signature)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
                >
                  View on Solana Explorer
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </div>

            <Button variant="outline" onClick={handleReset} className="w-full">
              Create Another Token
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {error && (
              <div className="flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/10 p-3">
                <AlertCircle className="h-4 w-4 text-red-400 mt-0.5 shrink-0" />
                <p className="text-sm text-red-400">{error}</p>
              </div>
            )}

            {statusMessage && isBusy && (
              <div className="flex items-center gap-2 text-muted-foreground text-sm">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>{statusMessage}</span>
              </div>
            )}

            <div className="rounded-lg border border-border/50 bg-muted/30 p-4 space-y-2">
              <p className="text-xs text-muted-foreground">What this will do:</p>
              <ul className="text-xs text-foreground space-y-1 list-disc list-inside">
                <li>Check your devnet SOL balance</li>
                <li>Request SOL airdrop if needed (for transaction fees)</li>
                <li>Create a new SPL token mint</li>
                <li>Mint {TOKEN_AMOUNT.toLocaleString()} tokens to your wallet</li>
              </ul>
            </div>

            <Button
              onClick={handleCreateToken}
              disabled={isBusy}
              className={cn("w-full gap-2", isBusy && "opacity-70")}
            >
              {isBusy ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {status === "checking-balance" && "Checking Balance..."}
                  {status === "airdropping" && "Requesting Airdrop..."}
                  {status === "creating" && "Creating Token..."}
                </>
              ) : (
                <>
                  <Coins className="h-4 w-4" />
                  Create Devnet Token
                </>
              )}
            </Button>

            {status === "error" && (
              <Button variant="outline" onClick={handleReset} className="w-full">
                Try Again
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
