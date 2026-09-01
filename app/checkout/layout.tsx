import type { ReactNode } from "react";
import CheckoutCustomerIdentityLayer from "@/components/checkout/CheckoutCustomerIdentityLayer";
import CheckoutPhoneStatusCopy from "@/components/checkout/CheckoutPhoneStatusCopy";

export default function CheckoutLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <CheckoutPhoneStatusCopy />
      <CheckoutCustomerIdentityLayer />
    </>
  );
}
