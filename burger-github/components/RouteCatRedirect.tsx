"use client";

import { useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";

/** /menu?cat=extras gibi istekleri ilgili sayfaya yönlendirir. */
export default function RouteCatRedirect() {
  const sp = useSearchParams();
  const router = useRouter();

  useEffect(() => {
    const raw = (sp.get("cat") || "").toLowerCase();

    const map: Record<string, string> = {
      extras: "/extras",
      extra: "/extras",
      drinks: "/drinks",
      getraenke: "/drinks",
      sauces: "/sauces",
      sos: "/sauces",
      sossen: "/sauces",
      hotdogs: "/hotdogs",
      donuts: "/donuts",
      bubbletea: "/bubble-tea",
      "bubble-tea": "/bubble-tea",
    };

    const target = map[raw];
    if (target) router.replace(target);
  }, [sp, router]);

  return null;
}
