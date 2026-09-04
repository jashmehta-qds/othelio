import { BasketDetail } from "@/features/baskets/BasketDetail";
import { baskets, getBasket } from "@/lib/baskets";

export default async function BasketPage({ params, searchParams }: { params: Promise<{ basketId: string }>; searchParams: Promise<{ action?: string }> }) {
  const [{ basketId }, query] = await Promise.all([params, searchParams]);
  const basket = getBasket(basketId) ?? {
    name: "Custom Basket",
    symbol: "OTH-CUSTOM",
    value: 1000.0,
    change: 0.0,
    updated: "Just now",
    address: basketId,
    holdings: [
      { symbol: "NVDAc", name: "NVIDIA", target: 40, current: 40.0, quantity: 100, value: 4000, color: "#8aa4ff" },
      { symbol: "AAPLc", name: "Apple", target: 30, current: 30.0, quantity: 50, value: 3000, color: "#5371d9" },
      { symbol: "MSFTc", name: "Microsoft", target: 30, current: 30.0, quantity: 40, value: 3000, color: "#858b87" },
    ],
  };

  const initialAction = query.action === "mint" ? "mint" : null;
  return <BasketDetail basket={basket} initialAction={initialAction}/>;
}
