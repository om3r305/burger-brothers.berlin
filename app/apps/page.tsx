import type { Metadata } from "next";
import MobileAppsClient from "@/components/mobile/MobileAppsClient";

export const metadata: Metadata = {
  title: "Burger Brothers Apps",
  description: "Android Apps von Burger Brothers Berlin herunterladen.",
};

export default function MobileAppsPage() {
  return <MobileAppsClient />;
}
