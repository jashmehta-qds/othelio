import { redirect } from "next/navigation";

export default async function BasketBorrowRedirectPage({ params }: { params: Promise<{ basketId: string }> }) {
  const { basketId } = await params;
  redirect(`/app/borrow/${basketId}`);
}

