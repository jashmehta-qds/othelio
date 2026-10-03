import { fetchApi } from "./api";
import { formatUnits } from "viem";

export type Holding = {
  symbol: string;
  name: string;
  target: number;
  current: number;
  quantity: number;
  value: number;
  color: string;
  address?: string;
  avgCost?: number;
};

export type Basket = {
  name: string;
  symbol: string;
  value: number;
  change: number;
  updated: string;
  address: string;
  holdings: Holding[];
  isIndexed?: boolean;
  realizedGains?: number;
  owner?: string;
  ensDomain?: string;
};

export type BasketActivity = {
  eventType: string;
  actorAddress: string | null;
  txHash: string;
  chainId?: number | string;
  basketAddress?: string;
  logIndex?: number;
  payload?: unknown;
  blockNumber?: number;
  occurredAt: string;
};

export function recordLocalActivity(basketAddress: string, event_type: string, txHash?: string) {
  // No-op: all activity is strictly backend/on-chain driven
}

export function getLocalActivity(basketAddress: string): BasketActivity[] {
  return [];
}

const techHoldings: Holding[] = [
  { symbol: "NVDAc", name: "NVIDIA", target: 38, current: 38.2, quantity: 4800.04, value: 9424.18, color: "#8aa4ff" },
  { symbol: "AAPLc", name: "Apple", target: 31, current: 30.8, quantity: 36.12, value: 7607.24, color: "#5371d9" },
  { symbol: "MSFTc", name: "Microsoft", target: 21, current: 21.1, quantity: 12.51, value: 5201.1, color: "#858b87" },
  { symbol: "USDC", name: "USD Coin", target: 10, current: 9.9, quantity: 2447.9, value: 2447.9, color: "#8daed0" },
];

export const baskets: Basket[] = [];

export const supportedAssets: Holding[] = [
  { symbol: "NVDAc", name: "NVIDIA Corp", target: 0, current: 0, quantity: 0, value: 0, color: "#8aa4ff", address: "0xb20000000000000000000078ee7ce2fE4908108C" },
  { symbol: "AAPLc", name: "Apple Inc", target: 0, current: 0, quantity: 0, value: 0, color: "#5371d9", address: "0xb200000000000000000000C2e324d24d7eEcd1fb" },
  { symbol: "MSFTc", name: "Microsoft Corp", target: 0, current: 0, quantity: 0, value: 0, color: "#858b87", address: "0xB200000000000000000000Ab99cFa739E253872B" },
  { symbol: "GOOGLc", name: "Alphabet Inc", target: 0, current: 0, quantity: 0, value: 0, color: "#6f8cff", address: "0xb2000000000000000000002D0BA3164cc74f58B7" },
  { symbol: "AMZNc", name: "Amazon.com Inc", target: 0, current: 0, quantity: 0, value: 0, color: "#b88a58", address: "0xb200000000000000000000d9192b6B456483C2E8" },
  { symbol: "METAc", name: "Meta Platforms", target: 0, current: 0, quantity: 0, value: 0, color: "#4e7fff", address: "0xb2000000000000000000008bC8786B856E61707C" },
  { symbol: "TSLAc", name: "Tesla Inc", target: 0, current: 0, quantity: 0, value: 0, color: "#b16f83", address: "0xb2000000000000000000001e800a7f5189430cD0" },
  { symbol: "COINc", name: "Coinbase Global", target: 0, current: 0, quantity: 0, value: 0, color: "#0052ff", address: "0xb200000000000000000000c85a31389D71F3ecfb" },
  { symbol: "MSTRc", name: "MicroStrategy Inc", target: 0, current: 0, quantity: 0, value: 0, color: "#d94141", address: "0xb2000000000000000000004884b426556b92883d" },
  { symbol: "CRCLc", name: "Circle Internet Financial", target: 0, current: 0, quantity: 0, value: 0, color: "#2775ca", address: "0xB20000000000000000000019f6E7C675b73C2e4D" },
  { symbol: "INTCc", name: "Intel Corp", target: 0, current: 0, quantity: 0, value: 0, color: "#0071c5", address: "0xB2000000000000000000004AFF16039bA04bdFBc" },
  { symbol: "SNDKc", name: "SanDisk Corp", target: 0, current: 0, quantity: 0, value: 0, color: "#e2231a", address: "0xb200000000000000000000397293Cb8cda9a10c5" },
  { symbol: "SPCXc", name: "SpaceX (Destiny Tech100)", target: 0, current: 0, quantity: 0, value: 0, color: "#3f4652", address: "0xb2000000000000000000007b9fcbd005511aCBd5" },
  { symbol: "USDC", name: "USD Coin", target: 0, current: 0, quantity: 0, value: 0, color: "#8daed0", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" },
];

export function getCreatedBaskets(): Basket[] {
  return [];
}

export function saveCreatedBasket(basket: Basket) {
  // No-op: all baskets are strictly backend/on-chain driven
}

export async function clearCreatedBaskets() {
  if (typeof window === "undefined") return;
  try {
    try {
      await fetchApi('/v1/baskets/reset', { method: 'DELETE' });
    } catch {
      // Ignore if backend service is offline
    }

    window.dispatchEvent(new Event("basket_updated"));
    window.dispatchEvent(new Event("storage"));
  } catch (err) {
    console.error("Failed to clear created baskets:", err);
  }
}

export function updateBasketWeights(address: string, newTargets: Record<string, number>) {
  if (typeof window === "undefined") return;
  try {
    const created = getCreatedBaskets();
    let targetBasket = created.find((b) => b.address.toLowerCase() === address.toLowerCase());

    if (!targetBasket) {
      const staticMatch = baskets.find((b) => b.address.toLowerCase() === address.toLowerCase());
      if (staticMatch) {
        targetBasket = { ...staticMatch };
      } else {
        targetBasket = {
          name: "Custom Basket",
          symbol: "OTH-CUSTOM",
          value: 0,
          change: 0.0,
          updated: "Just now",
          address: address,
          holdings: [],
        };
      }
    }

    targetBasket.holdings = Object.entries(newTargets).map(([symbol, weight]) => {
      const existingHolding = targetBasket!.holdings.find((h) => h.symbol === symbol);
      const meta = supportedAssets.find((a) => a.symbol === symbol);
      const val = (targetBasket!.value * weight) / 100;
      return {
        symbol,
        name: existingHolding?.name || meta?.name || symbol,
        target: weight,
        current: weight,
        quantity: Math.max(1, Math.round(val / 100)),
        value: val,
        color: existingHolding?.color || meta?.color || "#8aa4ff",
      };
    });
    targetBasket.updated = "Just now";
    saveCreatedBasket(targetBasket);
    window.dispatchEvent(new Event("basket_updated"));
  } catch (err) {
    console.error("Failed to update basket weights:", err);
  }
}

export const assetPrices: Record<string, number> = {
  NVDAc: 125.40,
  AAPLc: 224.50,
  MSFTc: 415.20,
  GOOGLc: 175.00,
  AMZNc: 180.00,
  METAc: 500.00,
  TSLAc: 250.00,
  COINc: 200.00,
  MSTRc: 135.00,
  CRCLc: 28.50,
  INTCc: 31.20,
  SNDKc: 65.00,
  SPCXc: 42.00,
  USDC: 1.00,
};

export const SECTOR_MAPPING: Record<string, string> = {
  NVDAc: "Big Tech & AI",
  AAPLc: "Big Tech & AI",
  MSFTc: "Big Tech & AI",
  GOOGLc: "Big Tech & AI",
  AMZNc: "Big Tech & AI",
  METAc: "Big Tech & AI",
  COINc: "Fintech & Crypto Infrastructure",
  MSTRc: "Fintech & Crypto Infrastructure",
  CRCLc: "Fintech & Crypto Infrastructure",
  INTCc: "Semiconductors & Hardware",
  SNDKc: "Semiconductors & Hardware",
  TSLAc: "Aerospace & Next-Gen",
  SPCXc: "Aerospace & Next-Gen",
  USDC: "USD & Cash Equiv",
};

export const SECTOR_COLORS: Record<string, string> = {
  "Big Tech & AI": "#8aa4ff",
  "Fintech & Crypto Infrastructure": "#0052ff",
  "Semiconductors & Hardware": "#0071c5",
  "Aerospace & Next-Gen": "#b16f83",
  "USD & Cash Equiv": "#8daed0",
};

export function getAssetSector(symbol: string): string {
  return SECTOR_MAPPING[symbol] || "USD & Cash Equiv";
}

export const asset1dChanges: Record<string, number> = {
  NVDAc: 2.1,
  AAPLc: 0.8,
  MSFTc: -0.4,
  GOOGLc: 1.2,
  AMZNc: 0.5,
  METAc: 1.8,
  TSLAc: -2.1,
  COINc: 3.4,
  MSTRc: 4.2,
  CRCLc: 0.3,
  INTCc: -1.1,
  SNDKc: 1.5,
  SPCXc: 0.9,
  USDC: 0.0,
};

export const asset7dChanges: Record<string, number> = {
  NVDAc: 4.5,
  AAPLc: 1.9,
  MSFTc: 0.8,
  GOOGLc: 2.8,
  AMZNc: 2.1,
  METAc: 3.9,
  TSLAc: -0.8,
  COINc: 7.6,
  MSTRc: 9.1,
  CRCLc: 0.7,
  INTCc: -1.8,
  SNDKc: 3.2,
  SPCXc: 4.1,
  USDC: 0.0,
};

export const asset30dChanges: Record<string, number> = {
  NVDAc: 8.4,
  AAPLc: 3.2,
  MSFTc: 2.1,
  GOOGLc: 4.5,
  AMZNc: 3.8,
  METAc: 6.2,
  TSLAc: -1.5,
  COINc: 12.0,
  MSTRc: 15.4,
  CRCLc: 1.1,
  INTCc: -2.3,
  SNDKc: 5.0,
  SPCXc: 7.2,
  USDC: 0.0,
};

export function getAssetChange(symbol: string, timeframe: "1D" | "7D" | "30D" = "30D"): number {
  if (timeframe === "1D") return asset1dChanges[symbol] ?? 0;
  if (timeframe === "7D") return asset7dChanges[symbol] ?? 0;
  return asset30dChanges[symbol] ?? 0;
}

export const defaultDemoBaskets: Basket[] = [
  {
    name: "AI & Tech Growth",
    symbol: "OTH-AITECH",
    value: 24840.42,
    change: 5.8,
    updated: "2 mins ago",
    address: "0x1111111111111111111111111111111111111111",
    realizedGains: 1250.0,
    holdings: [
      { symbol: "NVDAc", name: "NVIDIA Corp", target: 38, current: 38.2, quantity: 75.27, value: 9439.36, color: "#8aa4ff" },
      { symbol: "AAPLc", name: "Apple Inc", target: 31, current: 30.8, quantity: 34.08, value: 7650.53, color: "#5371d9" },
      { symbol: "MSFTc", name: "Microsoft Corp", target: 21, current: 21.1, quantity: 12.56, value: 5216.49, color: "#858b87" },
      { symbol: "USDC", name: "USD Coin", target: 10, current: 9.9, quantity: 2534.04, value: 2534.04, color: "#8daed0" },
    ],
  },
  {
    name: "Crypto Core & Infra",
    symbol: "OTH-CRYPTO",
    value: 15320.0,
    change: 11.2,
    updated: "10 mins ago",
    address: "0x2222222222222222222222222222222222222222",
    realizedGains: 820.5,
    holdings: [
      { symbol: "COINc", name: "Coinbase Global", target: 40, current: 40.0, quantity: 29.18, value: 6128.0, color: "#0052ff" },
      { symbol: "MSTRc", name: "MicroStrategy Inc", target: 35, current: 35.0, quantity: 39.71, value: 5362.0, color: "#d94141" },
      { symbol: "CRCLc", name: "Circle Internet Financial", target: 15, current: 15.0, quantity: 80.63, value: 2298.0, color: "#2775ca" },
      { symbol: "USDC", name: "USD Coin", target: 10, current: 10.0, quantity: 1532.0, value: 1532.0, color: "#8daed0" },
    ],
  },
  {
    name: "Semiconductors & DeepTech",
    symbol: "OTH-CHIPS",
    value: 12450.0,
    change: 3.4,
    updated: "1 hour ago",
    address: "0x3333333333333333333333333333333333333333",
    realizedGains: 410.0,
    holdings: [
      { symbol: "INTCc", name: "Intel Corp", target: 35, current: 35.0, quantity: 139.66, value: 4357.5, color: "#0071c5" },
      { symbol: "SNDKc", name: "SanDisk Corp", target: 30, current: 30.0, quantity: 57.46, value: 3735.0, color: "#e2231a" },
      { symbol: "SPCXc", name: "SpaceX (Destiny Tech100)", target: 25, current: 25.0, quantity: 74.1, value: 3112.5, color: "#3f4652" },
      { symbol: "USDC", name: "USD Coin", target: 10, current: 10.0, quantity: 1245.0, value: 1245.0, color: "#8daed0" },
    ],
  },
];

export function depositBasket(address: string, amount: number, txHash?: string) {
  if (typeof window === "undefined") return;
  try {
    const created = getCreatedBaskets();
    let targetBasket: Basket | undefined = created.find((b) => b.address.toLowerCase() === address.toLowerCase());
    if (!targetBasket) {
      const staticMatch = baskets.find((b) => b.address.toLowerCase() === address.toLowerCase());
      if (staticMatch) {
        targetBasket = JSON.parse(JSON.stringify(staticMatch));
      } else {
        targetBasket = {
          name: "Basket",
          symbol: "OTHL",
          value: 0,
          change: 0,
          updated: "Just now",
          address: address,
          holdings: JSON.parse(JSON.stringify(techHoldings)),
        };
      }
    }
    if (!targetBasket) return;

    targetBasket.value = (targetBasket.value || 0) + amount;
    const basketVal = targetBasket.value;
    targetBasket.holdings = targetBasket.holdings.map((h) => {
      const val = (basketVal * h.target) / 100;
      const price = assetPrices[h.symbol] || 100;
      const qty = Number((val / price).toFixed(4));
      return {
        ...h,
        value: val,
        quantity: qty,
      };
    });
    targetBasket.updated = "Just now";
    saveCreatedBasket(targetBasket);
    recordLocalActivity(address, "BasketFunded", txHash);
    window.dispatchEvent(new Event("basket_updated"));
  } catch (err) {
    console.error("Failed to deposit to basket:", err);
  }
}

export function withdrawBasket(address: string, amountShares: number, txHash?: string) {
  if (typeof window === "undefined") return;
  try {
    const created = getCreatedBaskets();
    let targetBasket: Basket | undefined = created.find((b) => b.address.toLowerCase() === address.toLowerCase());
    if (!targetBasket) {
      const staticMatch = baskets.find((b) => b.address.toLowerCase() === address.toLowerCase());
      if (staticMatch) {
        targetBasket = JSON.parse(JSON.stringify(staticMatch));
      } else {
        targetBasket = {
          name: "Basket",
          symbol: "OTHL",
          value: 0,
          change: 0,
          updated: "Just now",
          address: address,
          holdings: JSON.parse(JSON.stringify(techHoldings)),
        };
      }
    }
    if (!targetBasket) return;

    const withdrawVal = amountShares * 100;
    targetBasket.value = Math.max(0, (targetBasket.value || 0) - withdrawVal);
    const basketVal = targetBasket.value;
    targetBasket.holdings = targetBasket.holdings.map((h) => {
      const val = (basketVal * h.target) / 100;
      const price = assetPrices[h.symbol] || 100;
      const qty = Number((val / price).toFixed(4));
      return {
        ...h,
        value: val,
        quantity: qty,
      };
    });
    targetBasket.updated = "Just now";
    saveCreatedBasket(targetBasket);
    recordLocalActivity(address, "BasketWithdrawn", txHash);
    window.dispatchEvent(new Event("basket_updated"));
  } catch (err) {
    console.error("Failed to withdraw from basket:", err);
  }
}

export function getBasket(address: string) {
  const created = getCreatedBaskets();
  const foundCreated = created.find((b) => b.address.toLowerCase() === address.toLowerCase());
  if (foundCreated) return foundCreated;
  return baskets.find((basket) => basket.address.toLowerCase() === address.toLowerCase());
}

export function formatAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function isUserFacingActivity(evt: BasketActivity): boolean {
  if (!evt || !evt.eventType) return false;
  const type = evt.eventType.toUpperCase();
  if (["DEX_ROUTE_EXECUTED", "AERODROMEROUTEEXECUTED"].includes(type)) return false;
  return true;
}

export function formatEventLabel(eventType: string): string {
  if (!eventType) return "Operation";
  const type = eventType.toUpperCase();
  if (type === "BASKETCREATED" || type === "CREATED") return "Basket Created";
  if (type === "BASKETFUNDED" || type === "FUNDED" || type === "MINTED" || type === "DEPOSIT") return "Deposit";
  if (type === "BASKETWITHDRAWN" || type === "WITHDRAWN" || type === "WITHDRAW") return "Withdrawal";
  if (type === "BASKETREBALANCED" || type === "REBALANCED" || type === "WEIGHTS_UPDATED") return "Rebalance";
  return eventType;
}

export function formatEventMetadata(evt: any): { amountText: string; isPositive?: boolean } {
  if (!evt) return { amountText: "" };
  const type = (evt.eventType || "").toUpperCase();
  const payload = typeof evt.payload === "string" ? JSON.parse(evt.payload || "{}") : (evt.payload || {});

  if (type === "BASKETFUNDED" || type === "FUNDED" || type === "MINTED") {
    if (payload?.inputAmount) {
      const val = Number(payload.inputAmount) / 1_000_000;
      return { amountText: `+$${val.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, isPositive: true };
    }
    return { amountText: "" };
  }

  if (type === "BASKETWITHDRAWN" || type === "WITHDRAWN") {
    const withdrawnAssets = Array.isArray(payload?.withdrawnAssets) ? payload.withdrawnAssets : [];
    const withdrawnAmounts = Array.isArray(payload?.withdrawnAmounts) ? payload.withdrawnAmounts : [];
    if (payload?.navRedeemed) {
      const val = Number(payload.navRedeemed) / 1_000_000;
      return { amountText: `-$${val.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, isPositive: false };
    }
    return { amountText: "" };
  }

  if (type === "BASKETCREATED" || type === "CREATED") {
    return { amountText: payload?.name ? `${payload.name}` : "+1 Basket" };
  }

  if (type === "BASKETREBALANCED" || type === "REBALANCED" || type === "WEIGHTS_UPDATED") {
    return { amountText: "Rebalanced" };
  }

  return { amountText: "" };
}

export function getConfirmedCashFlowUsd(evt: BasketActivity): number | null {
  const metadata = formatEventMetadata(evt);
  const match = metadata.amountText.match(/^([+-])\$([\d,]+(?:\.\d+)?)$/);
  if (!match) return null;
  const amount = Number(match[2].replaceAll(',', ''));
  if (!Number.isFinite(amount)) return null;
  return match[1] === '-' ? -amount : amount;
}

export function getSlippageTolerance(accountAddress?: string): number {
  if (typeof window === "undefined") return 0.5;
  try {
    if (accountAddress) {
      const scoped = localStorage.getItem(`othelio_slippage_${accountAddress.toLowerCase()}`);
      if (scoped) return Number(scoped);
    }
    const stored = localStorage.getItem("othelio_slippage");
    return stored ? Number(stored) : 0.5;
  } catch {
    return 0.5;
  }
}

export function setSlippageTolerance(val: number, accountAddress?: string) {
  if (typeof window === "undefined") return;
  try {
    if (accountAddress) {
      localStorage.setItem(`othelio_slippage_${accountAddress.toLowerCase()}`, val.toString());
    }
    localStorage.setItem("othelio_slippage", val.toString());
    window.dispatchEvent(new Event("slippage_updated"));
  } catch (err) {
    console.error("Failed to save slippage setting:", err);
  }
}

export function formatCompactNumber(num: number): string {
  if (num < 0) return `-${formatCompactNumber(Math.abs(num))}`;
  if (num < 1000) {
    return num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  if (num < 10000) {
    // Less than 10,000: round down to 10s -> 4.56k
    const floored10s = Math.floor(num / 10) * 10;
    const valInK = floored10s / 1000;
    return `${valInK.toFixed(2)}k`;
  }
  if (num < 100000) {
    // 10,000 to 100,000: round down to hundreds -> 10.5k
    const flooredHundreds = Math.floor(num / 100) * 100;
    const valInK = flooredHundreds / 1000;
    return `${valInK % 1 === 0 ? valInK.toFixed(0) : valInK.toFixed(1)}k`;
  }
  if (num < 1000000) {
    // 100,000 to 1,000,000: round down to thousands -> 142k
    const flooredThousands = Math.floor(num / 1000);
    return `${flooredThousands}k`;
  }
  // 1,000,000 and above: round down to 10-thousands -> 3.45m
  const floored10k = Math.floor(num / 10000) * 10000;
  const valInM = floored10k / 1000000;
  return `${valInM % 1 === 0 ? valInM.toFixed(0) : valInM.toFixed(2)}m`;
}

export const portfolioValue = baskets.reduce((sum, basket) => sum + basket.value, 0);

export function getExplorerTxUrl(txHash: string, chainId: number = 31337): string {
  if (!txHash || txHash === "0x0000000000000000000000000000000000000000000000000000000000000000") {
    return "#";
  }
  if (chainId === 31337) {
    return "#";
  }
  if (chainId === 8453) {
    return `https://basescan.org/tx/${txHash}`;
  }
  return `https://etherscan.io/tx/${txHash}`;
}
