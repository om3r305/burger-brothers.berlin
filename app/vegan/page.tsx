// app/vegan/page.tsx
import { redirect } from "next/navigation";

export default function VeganRedirect() {
  // Eski /vegan linklerini tek sayfadaki vegan sekmesine taşıyoruz
  redirect("/menu?cat=vegan");
}
