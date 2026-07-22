"use client";

import { useCallback, useEffect, useState } from "react";
import type { StoredOrder, TvToastTone } from "@/types/tv";

type Notify = (
  message: string,
  tone?: TvToastTone,
  durationMs?: number,
) => void;

export function useTvPrint(notify: Notify) {
  const [printingOrderId, setPrintingOrderId] = useState("");

  useEffect(() => {
    try {
      if (!localStorage.getItem("bb_print_proxy_url")) {
        localStorage.setItem(
          "bb_print_proxy_url",
          "http://127.0.0.1:7777",
        );
      }
    } catch {
      // Local proxy URL fallback remains available in printOrder.
    }
  }, []);

  const printOrder = useCallback(
    async (
      order: StoredOrder,
      options: {
        notifySuccess?: boolean;
        throwOnError?: boolean;
      } = {},
    ) => {
      const notifySuccess = options.notifySuccess !== false;
      const throwOnError = options.throwOnError === true;

      setPrintingOrderId(order.id);

      try {
        const proxy =
          localStorage.getItem("bb_print_proxy_url") ||
          "http://127.0.0.1:7777";

        const response = await fetch(`${proxy}/print/full`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            order,
            options: {
              paper: "80mm",
              copies: 1,
              maskName: false,
              maskPhone: false,
            },
          }),
        });

        if (!response.ok) {
          const detail = await response.text().catch(() => "");
          throw new Error(`Proxy ${response.status}: ${detail}`);
        }

        if (notifySuccess) {
          notify("🖨️ Druckauftrag gesendet.", "success");
        }

        return true;
      } catch (caught) {
        const message =
          caught instanceof Error ? caught.message : String(caught || "");

        console.error("TV print failed", caught);

        if (!throwOnError) {
          notify(
            `Drucken fehlgeschlagen: ${message}\nPrint-Proxy, Firewall und bb_print_proxy_url prüfen.`,
            "error",
            7000,
          );
        }

        if (throwOnError) throw caught;
        return false;
      } finally {
        setPrintingOrderId("");
      }
    },
    [notify],
  );

  return {
    printOrder,
    printingOrderId,
  };
}
