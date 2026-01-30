"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { getTokenByMint, getTokenStep, tokenRegistry } from "@/lib/token-registry";
import type { TokenMint } from "@/lib/payment-links-types";

interface AmountTokenInputProps {
  amount: string;
  onAmountChange: (value: string) => void;
  token: TokenMint;
  onTokenChange: (value: TokenMint) => void;
  onMax?: () => void;
  maxDisabled?: boolean;
  maxLoading?: boolean;
  maxTooltip?: string;
  className?: string;
}

export function AmountTokenInput({
  amount,
  onAmountChange,
  token,
  onTokenChange,
  onMax,
  maxDisabled,
  maxLoading,
  maxTooltip,
  className,
}: AmountTokenInputProps) {
  const selectedToken = getTokenByMint(token);
  const step = selectedToken ? getTokenStep(selectedToken) : "0.001";

  return (
    <div className={cn("space-y-3", className)}>
      <div className="relative flex items-stretch h-12 rounded-sm border border-border/40 bg-background/50 overflow-hidden focus-within:ring-1 focus-within:ring-ring/50 focus-within:border-ring transition-colors">
        <input
          type="number"
          inputMode="decimal"
          name="amount"
          autoComplete="off"
          step={step}
          placeholder="0.00"
          value={amount}
          onChange={(event) => onAmountChange(event.target.value)}
          className="flex-1 h-full text-lg font-medium bg-transparent px-4 py-0 outline-none placeholder:text-muted-foreground [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none [-moz-appearance:textfield]"
          aria-label="Amount"
        />
        <Select value={token} onValueChange={(value) => onTokenChange(value as TokenMint)}>
          <SelectTrigger
            className="h-full! min-w-[140px] border-0! rounded-none bg-transparent font-medium px-4 py-0! shadow-none hover:bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 m-0 shrink-0"
            aria-label="Token"
          >
            <SelectValue>
              {selectedToken ? (
                <span className="flex items-center gap-2.5">
                  <img
                    src={selectedToken.icon}
                    alt={`${selectedToken.label} icon`}
                    className="h-6 w-6 rounded-full shrink-0"
                    loading="lazy"
                  />
                  <span className="uppercase  text-sm font-semibold">{selectedToken.label}</span>
                </span>
              ) : null}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {tokenRegistry.map((option) => (
              <SelectItem key={option.mint} value={option.mint} textValue={option.label}>
                <span className="flex items-center gap-2.5">
                  <img
                    src={option.icon}
                    alt={`${option.label} icon`}
                    className="h-5 w-5 rounded-full shrink-0"
                    loading="lazy"
                  />
                  <span className="flex items-center gap-2">
                    <span className="uppercase ">{option.label}</span>
                    {option.note ? (
                      <span className="text-muted-foreground text-xs normal-case">
                        ({option.note})
                      </span>
                    ) : null}
                  </span>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {onMax && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onMax}
          disabled={maxDisabled || maxLoading}
          className="text-xs text-muted-foreground hover:text-foreground"
          title={maxDisabled ? maxTooltip : "Use max balance"}
        >
          {maxLoading ? "Loading..." : "Use max balance"}
        </Button>
      )}
    </div>
  );
}
