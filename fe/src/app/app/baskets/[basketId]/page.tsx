import { notFound } from "next/navigation";
import { BasketDetail } from "@/features/baskets/BasketDetail";
import { baskets, getBasket } from "@/lib/baskets";

export function generateStaticParams() {
  return baskets.map((basket) => ({ basketId: basket.address }));
}

export default async function BasketPage({ params, searchParams }: PageProps<"/app/baskets/[basketId]">) {
  const [{ basketId }, query] = await Promise.all([params, searchParams]);
  const basket = getBasket(basketId);
  if (!basket) notFound();
  const initialAction = query.action === "mint" ? "mint" : null;
  return <BasketDetail basket={basket} initialAction={initialAction}/>;
}
