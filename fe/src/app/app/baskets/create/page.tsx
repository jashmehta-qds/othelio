"use client";

import { useRouter } from "next/navigation";
import { CreateBasketModal } from "@/components/CreateBasketModal";

/** This route shares the one exact reviewed factory-plan submission flow with the drawer. */
export default function CreateBasketPage() {
  const router = useRouter();
  return <CreateBasketModal isOpen onClose={() => router.push("/app/baskets")} />;
}
