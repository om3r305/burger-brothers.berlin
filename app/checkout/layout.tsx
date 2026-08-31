import type { ReactNode } from "react";
import CheckoutCustomerIdentityLayer from "@/components/checkout/CheckoutCustomerIdentityLayer";

export default function CheckoutLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <CheckoutCustomerIdentityLayer />
    </>
  );
}
