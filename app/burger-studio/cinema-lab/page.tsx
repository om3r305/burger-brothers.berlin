import { Suspense } from "react";
import BurgerStudioCinemaLab from "@/components/burger-studio/BurgerStudioCinemaLab";

export const metadata = {
  title: "Cinema Lab | Burger Brothers Berlin",
  robots: { index: false, follow: false },
};

export default function CinemaLabPage() {
  return <Suspense fallback={<div style={{ minHeight: "100dvh", background: "#080807", color: "#ead5ba" }}>Die Bühne wird vorbereitet …</div>}><BurgerStudioCinemaLab /></Suspense>;
}
