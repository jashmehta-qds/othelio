import { BasketBorrowManagement } from "@/features/borrow/BasketBorrowManagement";

export default async function BorrowBasketPage({ params }: { params: Promise<{ basketId: string }> }) {
  const { basketId } = await params;
  return <BasketBorrowManagement basketId={basketId} />;
}
