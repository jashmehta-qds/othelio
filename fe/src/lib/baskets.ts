export type Holding = {
  symbol: string;
  name: string;
  target: number;
  current: number;
  quantity: number;
  value: number;
  color: string;
  address?: string;
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
};

export type BasketActivity = {
  event_type: string;
  actor_address: string;
  tx_hash: string;
  block_number?: number;
  occurred_at: string;
};

export function recordLocalActivity(basketAddress: string, event_type: string, txHash?: string) {
  if (typeof window === "undefined") return;
  try {
    const key = `othelio_activity_${basketAddress.toLowerCase()}`;
    const existing: BasketActivity[] = JSON.parse(localStorage.getItem(key) || "[]");

    if (txHash && existing.some((item) => item.tx_hash.toLowerCase() === txHash.toLowerCase())) {
      return;
    }

    const newEntry: BasketActivity = {
      event_type,
      actor_address: "Wallet execution",
      tx_hash: txHash || `0x${Math.random().toString(16).slice(2)}${Math.random().toString(16).slice(2)}`,
      occurred_at: new Date().toISOString(),
    };

    const combined = [newEntry, ...existing];
    const unique = combined.filter(
      (item, idx, self) => idx === self.findIndex((t) => t.tx_hash.toLowerCase() === item.tx_hash.toLowerCase())
    );

    localStorage.setItem(key, JSON.stringify(unique.slice(0, 10)));
  } catch (err) {
    console.error(err);
  }
}

export function getLocalActivity(basketAddress: string): BasketActivity[] {
  if (typeof window === "undefined") return [];
  try {
    const key = `othelio_activity_${basketAddress.toLowerCase()}`;
    const raw: BasketActivity[] = JSON.parse(localStorage.getItem(key) || "[]");
    const unique = raw.filter(
      (item, idx, self) => idx === self.findIndex((t) => t.tx_hash.toLowerCase() === item.tx_hash.toLowerCase())
    );
    return unique.slice(0, 10);
  } catch (err) {
    return [];
  }
}

const techHoldings: Holding[] = [
  { symbol: "NVDAc", name: "NVIDIA", target: 38, current: 38.2, quantity: 4800.04, value: 9424.18, color: "#8aa4ff" },
  { symbol: "AAPLc", name: "Apple", target: 31, current: 30.8, quantity: 36.12, value: 7607.24, color: "#5371d9" },
  { symbol: "MSFTc", name: "Microsoft", target: 21, current: 21.1, quantity: 12.51, value: 5201.1, color: "#858b87" },
  { symbol: "USDC", name: "USD Coin", target: 10, current: 9.9, quantity: 2447.9, value: 2447.9, color: "#8daed0" },
];

export const baskets: Basket[] = [];

export const supportedAssets: Holding[] = [
  { symbol: "NVDAc", name: "NVIDIA Corp", target: 0, current: 0, quantity: 0, value: 0, color: "#8aa4ff" },
  { symbol: "AAPLc", name: "Apple Inc", target: 0, current: 0, quantity: 0, value: 0, color: "#5371d9" },
  { symbol: "MSFTc", name: "Microsoft Corp", target: 0, current: 0, quantity: 0, value: 0, color: "#858b87" },
  { symbol: "GOOGLc", name: "Alphabet Inc", target: 0, current: 0, quantity: 0, value: 0, color: "#6f8cff" },
  { symbol: "AMZNc", name: "Amazon.com Inc", target: 0, current: 0, quantity: 0, value: 0, color: "#b88a58" },
  { symbol: "METAc", name: "Meta Platforms", target: 0, current: 0, quantity: 0, value: 0, color: "#4e7fff" },
  { symbol: "TSLAc", name: "Tesla Inc", target: 0, current: 0, quantity: 0, value: 0, color: "#b16f83" },
  { symbol: "COINc", name: "Coinbase Global", target: 0, current: 0, quantity: 0, value: 0, color: "#0052ff" },
  { symbol: "MSTRc", name: "MicroStrategy Inc", target: 0, current: 0, quantity: 0, value: 0, color: "#d94141" },
  { symbol: "CRCLc", name: "Circle Internet Financial", target: 0, current: 0, quantity: 0, value: 0, color: "#2775ca" },
  { symbol: "INTCc", name: "Intel Corp", target: 0, current: 0, quantity: 0, value: 0, color: "#0071c5" },
  { symbol: "SNDKc", name: "SanDisk Corp", target: 0, current: 0, quantity: 0, value: 0, color: "#e2231a" },
  { symbol: "SPCXc", name: "SpaceX (Destiny Tech100)", target: 0, current: 0, quantity: 0, value: 0, color: "#3f4652" },
];

export function getCreatedBaskets(): Basket[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem("othelio_created_baskets");
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveCreatedBasket(basket: Basket) {
  if (typeof window === "undefined") return;
  try {
    const existing = getCreatedBaskets();
    const updated = [basket, ...existing.filter((b) => b.address.toLowerCase() !== basket.address.toLowerCase())];
    localStorage.setItem("othelio_created_baskets", JSON.stringify(updated));
  } catch (err) {
    console.error("Failed to save created basket:", err);
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
          value: 1000,
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
  GOOGLc: 175.80,
  AMZNc: 186.30,
  METAc: 512.60,
  TSLAc: 218.40,
  COINc: 210.00,
  MSTRc: 135.00,
  CRCLc: 28.50,
  INTCc: 31.20,
  SNDKc: 65.00,
  SPCXc: 42.00,
  USDC: 1.00,
};

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

export function getSlippageTolerance(): number {
  if (typeof window === "undefined") return 0.5;
  try {
    const stored = localStorage.getItem("othelio_slippage");
    return stored ? Number(stored) : 0.5;
  } catch {
    return 0.5;
  }
}

export function setSlippageTolerance(val: number) {
  if (typeof window === "undefined") return;
  try {
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
