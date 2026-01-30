import { tokens as sdkTokens } from "privacycash/utils";

type UiTokenMeta = {
  name: string;
  label: string;
  icon: string;
  note?: string;
};

const uiTokenMeta: Record<string, Omit<UiTokenMeta, "name">> = {
  sol: {
    label: "SOL",
    icon: "https://wsrv.nl/?w=32&h=32&url=https%3A%2F%2Fraw.githubusercontent.com%2Fsolana-labs%2Ftoken-list%2Fmain%2Fassets%2Fmainnet%2FSo11111111111111111111111111111111111111112%2Flogo.png&dpr=2&quality=80",
  },
  usdc: {
    label: "USDC",
    icon: "https://wsrv.nl/?w=32&h=32&url=https%3A%2F%2Fraw.githubusercontent.com%2Fsolana-labs%2Ftoken-list%2Fmain%2Fassets%2Fmainnet%2FEPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v%2Flogo.png&dpr=2&quality=80",
  },
  usdt: {
    label: "USDT",
    icon: "https://wsrv.nl/?w=32&h=32&url=https%3A%2F%2Fraw.githubusercontent.com%2Fsolana-labs%2Ftoken-list%2Fmain%2Fassets%2Fmainnet%2FEs9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB%2Flogo.svg&dpr=2&quality=80",
  },
  zec: {
    label: "ZEC",
    icon: "https://wsrv.nl/?w=32&h=32&url=https%3A%2F%2Farweave.net%2FQSYqnmB7NYlB7n1R6rz935Y07dlRK0tIuKe2mof5Sho&dpr=2&quality=80",
  },
  ore: {
    label: "ORE",
    icon: "https://wsrv.nl/?w=32&h=32&url=https%3A%2F%2Fore.supply%2Fassets%2Ficon.png&dpr=2&quality=80",
  },
  store: {
    label: "STORE",
    icon: "https://wsrv.nl/?w=32&h=32&url=https%3A%2F%2Fore.supply%2Fassets%2Ficon-lst.png&dpr=2&quality=80",
  },
};

function getDecimals(unitsPerToken: number) {
  let decimals = 0;
  let value = unitsPerToken;
  while (value > 1 && value % 10 === 0) {
    decimals += 1;
    value = value / 10;
  }
  return decimals;
}

export type TokenInfo = {
  name: string;
  mint: string;
  unitsPerToken: number;
  decimals: number;
  label: string;
  icon: string;
  note?: string;
};

export const tokenRegistry: TokenInfo[] = sdkTokens.map((token) => {
  const meta = uiTokenMeta[token.name] ?? {
    label: token.name.toUpperCase(),
    icon: "",
  };

  const mint = typeof token.pubkey === "string" ? token.pubkey : token.pubkey.toBase58();

  return {
    name: token.name,
    mint,
    unitsPerToken: token.units_per_token,
    decimals: getDecimals(token.units_per_token),
    label: meta.label,
    icon: meta.icon,
    note: meta.note,
  };
});

const tokenByMint = new Map(tokenRegistry.map((token) => [token.mint, token]));
const tokenByName = new Map(tokenRegistry.map((token) => [token.name, token]));

export const SOL_MINT = tokenByName.get("sol")?.mint ?? "";

export function getTokenByMint(mint: string) {
  return tokenByMint.get(mint);
}

export function getTokenByName(name: string) {
  return tokenByName.get(name);
}

export function isSolMint(mint: string) {
  return Boolean(SOL_MINT) && mint === SOL_MINT;
}

export function formatTokenAmount(baseUnits: number, token: TokenInfo, maximumFractionDigits = 6) {
  const value = baseUnits / token.unitsPerToken;
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: Math.min(maximumFractionDigits, token.decimals),
  }).format(value);
}

export function formatTokenAmountInput(baseUnits: number, token: TokenInfo) {
  const value = baseUnits / token.unitsPerToken;
  const fixed = value.toFixed(token.decimals);
  return fixed.replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}

export function parseTokenAmountToBaseUnits(amount: string, token: TokenInfo) {
  const parsed = Number(amount);
  if (!Number.isFinite(parsed)) return NaN;
  return Math.floor(parsed * token.unitsPerToken);
}

export function getTokenStep(token: TokenInfo) {
  const decimals = Math.min(token.decimals, 6);
  return decimals === 0 ? "1" : (1 / Math.pow(10, decimals)).toString();
}
