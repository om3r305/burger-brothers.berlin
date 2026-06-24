// app/admin/layout.tsx
import type { ReactNode } from "react";
import AdminShell from "./AdminShell"; // client shell

export const metadata = {
  title: "Burger Brothers • Admin",
  description: "Burger Brothers – Adminbereich",
  manifest: "/admin/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Burger Admin",
  },
};

export default function AdminLayout({ children }: { children: ReactNode }) {
  // Server tarafı: sadece shell'i sarıyoruz; metadata'yı Next head'e koyuyor.
  return <AdminShell>{children}</AdminShell>;
}
