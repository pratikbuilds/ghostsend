"use client";

import { useCallback, useState } from "react";
import { useWallet } from "@jup-ag/wallet-adapter";
import { Connection, PublicKey, VersionedTransaction } from "@solana/web3.js";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { WalletConnectButton } from "@/components/wallet-button";
import { cn } from "@/lib/utils";
import {
  getConfig,
  deposit,
  transferAmount,
  prepareWithdrawal,
  withdraw,
  signAndSend,
  type MagicBlockConfig,
} from "@/lib/magicblock-api";
import {
  Loader2,
  CheckCircle2,
  XCircle,
  ChevronRight,
  ExternalLink,
  Settings,
  Wallet,
  Send,
  ArrowDownToLine,
  Shield,
} from "lucide-react";
import { RPC_URL, ER_ROUTER_URL, getSolscanUrl } from "@/lib/network-config";
import { getTokenByMint, parseTokenAmountToBaseUnits } from "@/lib/token-registry";

const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const DEFAULT_UNITS_PER_TOKEN = 1_000_000;

type StepStatus = "idle" | "loading" | "success" | "error";

interface StepState {
  status: StepStatus;
  signature?: string;
  error?: string;
}

const INITIAL_STEP: StepState = { status: "idle" };

const STEPS = [
  { key: "config", label: "Fetch Config", group: "Setup", icon: Settings },
  { key: "senderDeposit", label: "Sender Deposit", group: "Deposit", icon: ArrowDownToLine },
  { key: "receiverInit", label: "Receiver Init", group: "Deposit", icon: Wallet },
  { key: "transfer", label: "Transfer", group: "Transfer", icon: Send },
  { key: "prepareWithdrawal", label: "Prepare Withdrawal", group: "Withdraw", icon: Shield },
  { key: "withdraw", label: "Withdraw", group: "Withdraw", icon: ArrowDownToLine },
] as const;

type StepKey = (typeof STEPS)[number]["key"];

export function MagicBlockTransfer() {
  const { publicKey, signTransaction } = useWallet();
  const [connection] = useState(() => new Connection(RPC_URL, "confirmed"));
  const [erConnection] = useState(() => new Connection(ER_ROUTER_URL, "confirmed"));

  const [mint, setMint] = useState(USDC_MINT);
  const [receiver, setReceiver] = useState("");
  const [amount, setAmount] = useState("");
  const [config, setConfig] = useState<MagicBlockConfig | null>(null);
  const [steps, setSteps] = useState<Record<StepKey, StepState>>(
    () =>
      Object.fromEntries(STEPS.map((s) => [s.key, { ...INITIAL_STEP }])) as Record<
        StepKey,
        StepState
      >
  );
  const [expandedGroup, setExpandedGroup] = useState<string | null>("Setup");

  const updateStep = useCallback((key: StepKey, update: Partial<StepState>) => {
    setSteps((prev) => ({ ...prev, [key]: { ...prev[key], ...update } }));
  }, []);

  const uiAmountToBaseUnits = useCallback(
    (uiAmount: string): number => {
      const token = getTokenByMint(mint);
      if (token) {
        const base = parseTokenAmountToBaseUnits(uiAmount, token);
        return Number.isFinite(base) ? base : 0;
      }
      const parsed = Number(uiAmount);
      return Number.isFinite(parsed) ? Math.floor(parsed * DEFAULT_UNITS_PER_TOKEN) : 0;
    },
    [mint]
  );

  const execStep = useCallback(
    async (
      key: StepKey,
      fn: () => Promise<VersionedTransaction | void>,
      sendConnection?: Connection
    ) => {
      if (!signTransaction) return;
      updateStep(key, { status: "loading", error: undefined, signature: undefined });
      const conn = sendConnection ?? connection;
      try {
        const result = await fn();
        if (result) {
          const sig = await signAndSend(result, signTransaction, conn);
          updateStep(key, { status: "success", signature: sig });
        } else {
          updateStep(key, { status: "success" });
        }
      } catch (err) {
        updateStep(key, {
          status: "error",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [connection, signTransaction, updateStep]
  );

  const handleStep = useCallback(
    async (key: StepKey) => {
      if (!publicKey || !signTransaction) return;

      const mintPubkey = mint ? new PublicKey(mint) : null;
      const receiverPubkey = receiver ? new PublicKey(receiver) : null;
      const user = publicKey.toBase58();

      switch (key) {
        case "config":
          updateStep("config", { status: "loading" });
          try {
            const cfg = await getConfig();
            setConfig(cfg);
            updateStep("config", { status: "success" });
          } catch (err) {
            updateStep("config", {
              status: "error",
              error: err instanceof Error ? err.message : String(err),
            });
          }
          return;

        case "senderDeposit":
          if (!mintPubkey || !mint) return;
          return execStep(key, () => deposit({ user, mint, amount: uiAmountToBaseUnits(amount) }));

        case "receiverInit":
          if (!mintPubkey || !receiverPubkey || !receiver) return;
          return execStep(key, () => deposit({ user: receiver, mint, amount: 0 }));

        case "transfer":
          if (!mintPubkey || !receiverPubkey || !receiver) return;
          return execStep(
            key,
            () =>
              transferAmount({
                sender: user,
                recipient: receiver,
                mint,
                amount: uiAmountToBaseUnits(amount),
              }),
            erConnection
          );

        case "prepareWithdrawal":
          if (!mintPubkey) return;
          return execStep(key, () => prepareWithdrawal({ user, mint }));

        case "withdraw":
          if (!mintPubkey) return;
          return execStep(key, () =>
            withdraw({ owner: user, user, mint, amount: uiAmountToBaseUnits(amount) })
          );
      }
    },
    [
      publicKey,
      signTransaction,
      execStep,
      updateStep,
      mint,
      receiver,
      amount,
      erConnection,
      uiAmountToBaseUnits,
    ]
  );

  const groups = STEPS.reduce<{ group: string; steps: (typeof STEPS)[number][] }[]>((acc, step) => {
    const last = acc[acc.length - 1];
    if (last && last.group === step.group) {
      last.steps.push(step);
    } else {
      acc.push({ group: step.group, steps: [step] });
    }
    return acc;
  }, []);

  const cardClass =
    "w-full max-w-2xl mx-auto overflow-hidden rounded-2xl border-border/50 bg-card/90 shadow-[0_0_0_1px_var(--border),0_8px_40px_-12px_oklch(0.72_0.15_220/8%)] dark:shadow-[0_0_0_1px_var(--border),0_8px_40px_-12px_black/30%]";

  return (
    <div className="space-y-4">
      <Card className={cn(cardClass, "flex max-h-[min(90vh,48rem)] flex-col")}>
        <CardHeader className="shrink-0 space-y-2 px-6 pt-6 pb-4">
          <CardTitle className="text-lg font-semibold tracking-tight sm:text-xl">
            MagicBlock Private SPL
          </CardTitle>
          <CardDescription className="text-sm text-muted-foreground">
            Private ephemeral SPL token transfers via MagicBlock PER API.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col overflow-hidden px-6 pb-6">
          <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto overflow-x-hidden">
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <Label>Parameters</Label>
                <WalletConnectButton size="sm" />
              </div>
              <div className="space-y-2">
                <div>
                  <Label className="text-xs text-muted-foreground">Token Mint Address</Label>
                  <Input
                    type="text"
                    placeholder="e.g. EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
                    value={mint}
                    onChange={(e) => setMint(e.target.value)}
                    autoComplete="off"
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Receiver Address</Label>
                  <Input
                    type="text"
                    placeholder="Receiver Solana address"
                    value={receiver}
                    onChange={(e) => setReceiver(e.target.value)}
                    autoComplete="off"
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">
                    Amount (e.g. 1 for 1 USDC)
                  </Label>
                  <Input
                    type="number"
                    placeholder="1"
                    min={0}
                    step="any"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    autoComplete="off"
                  />
                </div>
              </div>
            </div>

            {config && (
              <div className="rounded-lg border border-border/50 bg-muted/10 px-3 py-2 text-xs font-mono space-y-0.5">
                <p className="text-muted-foreground">
                  <span className="text-foreground">endpoint:</span> {config.endpoint_url}
                </p>
                <p className="text-muted-foreground">
                  <span className="text-foreground">delegation:</span> {config.delegation_program}
                </p>
                <p className="text-muted-foreground">
                  <span className="text-foreground">validator:</span> {config.default_validator}
                </p>
              </div>
            )}

            <div className="space-y-1">
              {groups.map(({ group, steps: groupSteps }) => {
                const isExpanded = expandedGroup === group;
                const groupDone = groupSteps.every((s) => steps[s.key].status === "success");
                const groupHasError = groupSteps.some((s) => steps[s.key].status === "error");

                return (
                  <div key={group} className="rounded-lg border border-border/40 overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setExpandedGroup(isExpanded ? null : group)}
                      className="flex w-full items-center gap-2 px-3 py-2 hover:bg-muted/20 transition-colors text-left"
                    >
                      <ChevronRight
                        className={cn(
                          "size-4 shrink-0 text-muted-foreground transition-transform",
                          isExpanded && "rotate-90"
                        )}
                      />
                      <span className="text-sm font-medium flex-1">{group}</span>
                      {groupDone && <CheckCircle2 className="size-4 text-green-500 shrink-0" />}
                      {groupHasError && !groupDone && (
                        <XCircle className="size-4 text-red-500 shrink-0" />
                      )}
                    </button>
                    {isExpanded && (
                      <div className="border-t border-border/30 px-3 py-2 space-y-2">
                        {groupSteps.map((step) => {
                          const state = steps[step.key];
                          const Icon = step.icon;
                          const isLoading = state.status === "loading";
                          const isSuccess = state.status === "success";
                          const isError = state.status === "error";

                          const needsWallet = !publicKey;
                          const needsMint = step.key !== "config" && !mint;
                          const needsReceiver =
                            ["receiverInit", "transfer"].includes(step.key) && !receiver;
                          const needsAmount =
                            ["senderDeposit", "transfer", "withdraw"].includes(step.key) && !amount;
                          const disabled =
                            needsWallet || needsMint || needsReceiver || needsAmount || isLoading;

                          const getButtonText = () => {
                            if (isLoading) return "…";
                            if (isSuccess) return "Redo";
                            if (isError) return "Retry";
                            return "Run";
                          };

                          const getButtonVariant = () => {
                            if (isError) return "destructive" as const;
                            if (isSuccess) return "outline" as const;
                            return "default" as const;
                          };

                          return (
                            <div key={step.key} className="flex items-start gap-3">
                              <div className="pt-1.5 shrink-0">
                                {isLoading ? (
                                  <Loader2 className="size-4 text-primary animate-spin" />
                                ) : isSuccess ? (
                                  <CheckCircle2 className="size-4 text-green-500" />
                                ) : isError ? (
                                  <XCircle className="size-4 text-red-500" />
                                ) : (
                                  <Icon className="size-4 text-muted-foreground" />
                                )}
                              </div>
                              <div className="flex-1 min-w-0 space-y-1">
                                <span className="text-sm">{step.label}</span>
                                {state.signature && (
                                  <a
                                    href={getSolscanUrl(state.signature)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                                  >
                                    {state.signature.slice(0, 16)}…
                                    <ExternalLink className="size-3" />
                                  </a>
                                )}
                                {state.error && (
                                  <p className="text-xs text-red-500 break-all">{state.error}</p>
                                )}
                              </div>
                              <Button
                                size="sm"
                                variant={getButtonVariant()}
                                disabled={disabled}
                                onClick={() => handleStep(step.key)}
                                className="shrink-0"
                              >
                                {getButtonText()}
                              </Button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
