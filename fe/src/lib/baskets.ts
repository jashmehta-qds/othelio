export type Holding = {
  symbol: string;
  name: string;
  target: number;
  current: number;
  quantity: number;
  value: number;
  color: string;
};

export type Basket = {
  name: string;
  symbol: string;
  value: number;
  change: number;
  updated: string;
  address: string;
  holdings: Holding[];
};

const techHoldings: Holding[] = [
  { symbol: "NVDAc", name: "NVIDIA", target: 38, current: 38.2, quantity: 4800.04, value: 9424.18, color: "#8aa4ff" },
  { symbol: "AAPLc", name: "Apple", target: 31, current: 30.8, quantity: 36.12, value: 7607.24, color: "#5371d9" },
  { symbol: "MSFTc", name: "Microsoft", target: 21, current: 21.1, quantity: 12.51, value: 5201.1, color: "#858b87" },
  { symbol: "USDC", name: "USD Coin", target: 10, current: 9.9, quantity: 2447.9, value: 2447.9, color: "#8daed0" },
];

export const baskets: Basket[] = [
  { name: "Tech Leaders", symbol: "OTHL-TECH", value: 24680.42, change: 3.53, updated: "Just now", address: "0x9bDe4A7C3F2E8D1a6B5C0F9347A2E18D5C6B1A7C", holdings: techHoldings },
  { name: "AI Infrastructure", symbol: "OTHL-AI", value: 18450, change: 5.92, updated: "4 min ago", address: "0x2eA18B3C7D9F4A6E1C5B8D2F0A7E4C6B9D3183F9", holdings: techHoldings.slice(0, 3) },
  { name: "Mega Cap Core", symbol: "OTHL-MEGA", value: 32100.5, change: 3.45, updated: "11 min ago", address: "0x6c47A2E8D5B1F9C3A7E4D8B2C6F1A5E9D3B0B210", holdings: techHoldings },
];

export const supportedAssets: Holding[] = [
  ...techHoldings,
  { symbol: "GOOGLc", name: "Alphabet", target: 0, current: 0, quantity: 0, value: 0, color: "#6f8cff" },
  { symbol: "TSLAc", name: "Tesla", target: 0, current: 0, quantity: 0, value: 0, color: "#b16f83" },
  { symbol: "AMZNc", name: "Amazon", target: 0, current: 0, quantity: 0, value: 0, color: "#b88a58" },
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

export function getBasket(address: string) {
  const created = getCreatedBaskets();
  const foundCreated = created.find((b) => b.address.toLowerCase() === address.toLowerCase());
  if (foundCreated) return foundCreated;
  return baskets.find((basket) => basket.address.toLowerCase() === address.toLowerCase());
}

export function formatAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
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
