"use client";

import { useCallback, useEffect, useState } from "react";
import {
  LASTNAME_KEY,
  REMEMBER_KEY,
  authenticateDriver,
  clearPosKey,
  writeCurrentDriver,
} from "@/lib/driver/domain";
import type { DriverIdentity, DriverOrder, DriverToastTone } from "@/types/driver";

type Notify = (
  message: string,
  tone?: DriverToastTone,
  durationMs?: number,
) => void;

async function readServerDriverSession(): Promise<DriverIdentity | null> {
  try {
    const response = await fetch("/api/drivers/session", {
      method: "GET",
      credentials: "same-origin",
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    const payload = await response.json().catch(() => ({}));
    const id = String(payload?.driver?.id || "").trim();
    const name = String(payload?.driver?.name || "").trim();

    return response.ok && payload?.ok !== false && id && name
      ? { id, name }
      : null;
  } catch {
    return null;
  }
}

export function useDriverAuth({ notify }: { notify: Notify }) {
  const [current, setCurrent] = useState<DriverIdentity | null>(null);
  const [remember, setRememberState] = useState(true);
  const [loginName, setLoginNameState] = useState("");
  const [loginPass, setLoginPass] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const remembered = localStorage.getItem(REMEMBER_KEY);
    const rememberValue = remembered === null ? true : remembered === "1";
    setRememberState(rememberValue);

    const lastName = localStorage.getItem(LASTNAME_KEY);
    if (lastName) setLoginNameState(lastName);

    void readServerDriverSession().then((driver) => {
      if (cancelled) return;

      if (driver) {
        setCurrent(driver);
        setLoginNameState(driver.name);
        localStorage.setItem(LASTNAME_KEY, driver.name);

        if (rememberValue) {
          writeCurrentDriver(driver);
        } else {
          writeCurrentDriver(null);
        }
      } else {
        // Local storage is only a convenience cache. A missing/expired signed
        // Driver cookie must never leave the UI looking authenticated.
        setCurrent(null);
        writeCurrentDriver(null);
      }

      setHydrated(true);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onSessionExpired = () => {
      setCurrent(null);
      writeCurrentDriver(null);
      notify("Fahrer-Sitzung ist abgelaufen. Bitte neu anmelden.", "warning", 6000);
    };

    window.addEventListener(
      "bb:driver-session-expired",
      onSessionExpired as EventListener,
    );

    return () => {
      window.removeEventListener(
        "bb:driver-session-expired",
        onSessionExpired as EventListener,
      );
    };
  }, [notify]);

  const setRemember = useCallback((value: boolean) => {
    setRememberState(value);
    localStorage.setItem(REMEMBER_KEY, value ? "1" : "0");
  }, []);

  const setLoginName = useCallback((value: string) => {
    setLoginNameState(value);
    localStorage.setItem(LASTNAME_KEY, value || "");
  }, []);

  const login = useCallback(async () => {
    const name = loginName.trim();
    const password = loginPass;

    if (!name || !password) {
      notify("Bitte Benutzername und Passwort eingeben.", "warning");
      return false;
    }

    setAuthBusy(true);

    try {
      const driver = await authenticateDriver(name, password, remember);

      if (!driver) {
        notify(
          "Ungültiger Benutzer oder Passwort. Bitte Admin kontaktieren.",
          "error",
        );
        return false;
      }

      setCurrent(driver);
      setLoginNameState(driver.name);
      localStorage.setItem(LASTNAME_KEY, driver.name);

      if (remember) {
        writeCurrentDriver(driver);
        localStorage.setItem(REMEMBER_KEY, "1");
      } else {
        writeCurrentDriver(null);
        localStorage.setItem(REMEMBER_KEY, "0");
      }

      setLoginPass("");
      notify(`Willkommen, ${driver.name}.`, "success");
      return true;
    } finally {
      setAuthBusy(false);
    }
  }, [loginName, loginPass, notify, remember]);

  const logout = useCallback(
    async (activeOrders: DriverOrder[]) => {
      setAuthBusy(true);

      try {
        for (const order of activeOrders) {
          clearPosKey(order.id);
        }

        try {
          await fetch("/api/drivers", {
            method: "DELETE",
            credentials: "same-origin",
          });
        } catch {
          // Cookie cleanup failure is surfaced by the next protected request.
        }

        setCurrent(null);
        writeCurrentDriver(null);
        notify("Abgemeldet.", "info");
      } finally {
        setAuthBusy(false);
      }
    },
    [notify],
  );

  return {
    current,
    setCurrent,
    remember,
    setRemember,
    loginName,
    setLoginName,
    loginPass,
    setLoginPass,
    authBusy,
    hydrated,
    login,
    logout,
  };
}
