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
import { tokenDetails } from "@/lib/privacy-cash";
import type { TokenType } from "@/lib/payment-links-types";

interface AmountTokenInputProps {
  amount: string;
  onAmountChange: (value: string) => void;
  token: TokenType;
  onTokenChange: (value: TokenType) => void;
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
  const selectedToken = tokenDetails.find((option) => option.value === token);

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex items-center gap-3">
        <Input
          type="number"
          inputMode="decimal"
          name="amount"
          autoComplete="off"
          step="0.001"
          placeholder="0.00"
          value={amount}
          onChange={(event) => onAmountChange(event.target.value)}
          className="flex-1 h-12 text-lg font-medium border border-border/40 rounded-lg bg-background/50 px-4 py-3"
          aria-label="Amount"
        />
        <Select value={token} onValueChange={(value) => onTokenChange(value as TokenType)}>
          <SelectTrigger
            className="w-24 h-12 border border-border/40 rounded-lg bg-background/50 font-medium"
            aria-label="Token"
          >
            <SelectValue>
              {selectedToken ? (
                <span className="flex items-center gap-2">
                  <img
                    src={selectedToken.icon}
                    alt={`${selectedToken.label} icon`}
                    className="h-4 w-4"
                    loading="lazy"
                  />
                  <span>{selectedToken.label}</span>
                </span>
              ) : null}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {tokenDetails.map((option) => (
              <SelectItem
                key={option.value}
                value={option.value}
                disabled={option.disabled}
                textValue={option.label}
              >
                <span className="flex items-center gap-2">
                  <img
                    src={option.icon}
                    alt={`${option.label} icon`}
                    className="h-4 w-4"
                    loading="lazy"
                  />
                  <span className="flex items-center gap-2">
                    <span>{option.label}</span>
                    {option.note ? (
                      <span className="text-muted-foreground text-xs">
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
