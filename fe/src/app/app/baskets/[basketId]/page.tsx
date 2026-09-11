import { BasketDetail } from "@/features/baskets/BasketDetail";
import { getBasket } from "@/lib/baskets";

export default async function BasketPage({ params, searchParams }: { params: Promise<{ basketId: string }>; searchParams: Promise<{ action?: string }> }) {
  const [{ basketId }, query] = await Promise.all([params, searchParams]);
  const basket = getBasket(basketId) ?? {
    name: "Basket Safe",
    symbol: "OTH",
    value: 0.0,
    change: 0.0,
    updated: "Just now",
    address: basketId,
    holdings: [],
  };

  const initialAction = query.action === "mint" ? "mint" : null;
  return <BasketDetail basket={basket} initialAction={initialAction}/>;
}
