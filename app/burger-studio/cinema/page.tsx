import { Suspense } from "react";
import BurgerStudioCinema from "@/components/burger-studio/BurgerStudioCinema";

export const metadata = {
  title: "Burger Studio Cinema | Burger Brothers Berlin",
  robots: { index: false, follow: false },
};

export default function BurgerStudioCinemaPage() {
  return <Suspense fallback={<div style={{ minHeight: "100dvh", background: "#050505", color: "white" }}>Studio wird geladen …</div>}>
    <BurgerStudioCinema />
  </Suspense>;
}
