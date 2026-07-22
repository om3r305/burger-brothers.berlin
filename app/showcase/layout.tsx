import type { ReactNode } from "react";

export const metadata = {
  title: "Burger Brothers • Schaufenster",
  description: "Digitales Schaufenster von Burger Brothers Berlin",
  robots: { index: false, follow: false },
};

export default function ShowcaseLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
