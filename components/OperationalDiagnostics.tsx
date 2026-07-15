"use client";

import React, {
  Component,
  type ErrorInfo,
  type ReactNode,
  useEffect,
  useMemo,
  useState,
} from "react";

type RouteKind = "tv" | "driver";

type DiagnosticEvent = {
  type: "render" | "window-error" | "promise-rejection";
  message: string;
  stack?: string;
  source?: string;
  line?: number;
  column?: number;
  at: string;
};

type ServerDiagnostic = {
  ok?: boolean;
  now?: string;
  host?: string;
  pathname?: string;
  userAgent?: string;
  cookies?: {
    bb_tv_auth?: boolean;
    bb_tv_sess?: boolean;
    bb_admin_sess?: boolean;
  };
  environment?: {
    tvPinConfigured?: boolean;
    driverPinConfigured?: boolean;
    driverPasswordConfigured?: boolean;
    nodeEnv?: string;
  };
  error?: string;
};

type BoundaryProps = {
  routeKind: RouteKind;
  children: ReactNode;
};

type BoundaryState = {
  renderError: DiagnosticEvent | null;
};

function eventFromError(
  error: unknown,
  type: DiagnosticEvent["type"],
  extra?: Partial<DiagnosticEvent>,
): DiagnosticEvent {
  const normalized =
    error instanceof Error
      ? error
      : new Error(
          typeof error === "string"
            ? error
            : JSON.stringify(error ?? "Unbekannter Fehler"),
        );

  return {
    type,
    message: normalized.message || "Unbekannter Fehler",
    stack: normalized.stack || "",
    at: new Date().toISOString(),
    ...extra,
  };
}

class OperationalErrorBoundary extends Component<
  BoundaryProps,
  BoundaryState
> {
  state: BoundaryState = {
    renderError: null,
  };

  static getDerivedStateFromError(error: unknown): BoundaryState {
    return {
      renderError: eventFromError(error, "render"),
    };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    const renderError = eventFromError(error, "render", {
      stack: [
        error instanceof Error ? error.stack : "",
        info.componentStack || "",
      ]
        .filter(Boolean)
        .join("\n\nCOMPONENT STACK:\n"),
    });

    this.setState({ renderError });

    try {
      localStorage.setItem(
        `bb_${this.props.routeKind}_last_runtime_error`,
        JSON.stringify(renderError),
      );
    } catch {}
  }

  render() {
    return (
      <>
        {this.state.renderError ? null : this.props.children}
        <OperationalDiagnosticPanel
          routeKind={this.props.routeKind}
          renderError={this.state.renderError}
        />
      </>
    );
  }
}

function boolLabel(value?: boolean) {
  return value ? "JA" : "NEIN";
}

function safeStandaloneMode() {
  if (typeof window === "undefined") return false;

  return Boolean(
    (navigator as any)?.standalone ||
      window.matchMedia?.("(display-mode: standalone)")?.matches ||
      window.matchMedia?.("(display-mode: fullscreen)")?.matches,
  );
}

function browserDetails() {
  if (typeof window === "undefined") {
    return {
      href: "",
      pathname: "",
      online: false,
      visibility: "",
      standalone: false,
      viewport: "",
      screen: "",
      userAgent: "",
    };
  }

  return {
    href: window.location.href,
    pathname: window.location.pathname,
    online: navigator.onLine,
    visibility: document.visibilityState,
    standalone: safeStandaloneMode(),
    viewport: `${window.innerWidth}×${window.innerHeight}`,
    screen: `${window.screen?.width || 0}×${window.screen?.height || 0}`,
    userAgent: navigator.userAgent || "",
  };
}

function OperationalDiagnosticPanel({
  routeKind,
  renderError,
}: {
  routeKind: RouteKind;
  renderError: DiagnosticEvent | null;
}) {
  const [events, setEvents] = useState<DiagnosticEvent[]>([]);
  const [server, setServer] = useState<ServerDiagnostic | null>(null);
  const [serverLoading, setServerLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [browser, setBrowser] = useState(() => browserDetails());

  useEffect(() => {
    setBrowser(browserDetails());

    const query = new URLSearchParams(window.location.search);
    const forced =
      query.get("diag") === "1" ||
      localStorage.getItem("bb_operational_diagnostics_open") === "1";

    if (forced) setOpen(true);

    const onWindowError = (event: ErrorEvent) => {
      const next = eventFromError(
        event.error || event.message,
        "window-error",
        {
          source: event.filename || "",
          line: event.lineno || 0,
          column: event.colno || 0,
        },
      );

      setEvents((current) => [...current.slice(-7), next]);
      setOpen(true);
    };

    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      const next = eventFromError(
        event.reason,
        "promise-rejection",
      );

      setEvents((current) => [...current.slice(-7), next]);
      setOpen(true);
    };

    window.addEventListener("error", onWindowError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);

    return () => {
      window.removeEventListener("error", onWindowError);
      window.removeEventListener(
        "unhandledrejection",
        onUnhandledRejection,
      );
    };
  }, []);

  useEffect(() => {
    let active = true;

    const load = async () => {
      setServerLoading(true);

      try {
        const response = await fetch(
          `/api/diagnostics/operational?route=${encodeURIComponent(routeKind)}`,
          {
            method: "GET",
            cache: "no-store",
            headers: {
              accept: "application/json",
            },
          },
        );

        const payload = await response.json().catch(() => ({}));

        if (active) {
          setServer({
            ...payload,
            ok: response.ok && payload?.ok !== false,
          });
        }
      } catch (error) {
        if (active) {
          setServer({
            ok: false,
            error:
              error instanceof Error
                ? error.message
                : String(error || "DIAGNOSTIC_FETCH_FAILED"),
          });
        }
      } finally {
        if (active) setServerLoading(false);
      }
    };

    void load();

    return () => {
      active = false;
    };
  }, [routeKind]);

  useEffect(() => {
    if (renderError) setOpen(true);
  }, [renderError]);

  const allEvents = useMemo(
    () => (renderError ? [renderError, ...events] : events),
    [events, renderError],
  );

  const diagnosticText = useMemo(
    () =>
      JSON.stringify(
        {
          routeKind,
          browser,
          server,
          events: allEvents,
          generatedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    [allEvents, browser, routeKind, server],
  );

  const toggle = () => {
    setOpen((current) => {
      const next = !current;

      try {
        localStorage.setItem(
          "bb_operational_diagnostics_open",
          next ? "1" : "0",
        );
      } catch {}

      return next;
    });
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(diagnosticText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt(
        "Diagnose kopieren:",
        diagnosticText,
      );
    }
  };

  const reloadWithoutCache = () => {
    const url = new URL(window.location.href);
    url.searchParams.set("_bbdiag", String(Date.now()));
    window.location.replace(url.toString());
  };

  return (
    <div
      data-bb-operational-diagnostics={routeKind}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2147483646,
        pointerEvents: "none",
        fontFamily:
          "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      }}
    >
      <button
        type="button"
        onClick={toggle}
        style={{
          position: "absolute",
          right: 10,
          bottom: "calc(10px + env(safe-area-inset-bottom))",
          pointerEvents: "auto",
          minWidth: 48,
          height: 48,
          padding: "0 12px",
          borderRadius: 999,
          border: "1px solid rgba(255,255,255,.35)",
          background:
            allEvents.length > 0
              ? "rgba(185,28,28,.96)"
              : "rgba(15,23,42,.94)",
          color: "#fff",
          fontWeight: 800,
          fontSize: 12,
          boxShadow: "0 10px 30px rgba(0,0,0,.45)",
        }}
      >
        DIAG{allEvents.length ? ` ${allEvents.length}` : ""}
      </button>

      {open && (
        <section
          aria-label={`${routeKind.toUpperCase()} Diagnose`}
          style={{
            position: "absolute",
            inset: 8,
            bottom: "calc(66px + env(safe-area-inset-bottom))",
            pointerEvents: "auto",
            overflow: "auto",
            borderRadius: 18,
            border: "2px solid rgba(56,189,248,.75)",
            background: "rgba(2,6,23,.98)",
            color: "#e2e8f0",
            padding: 14,
            boxShadow: "0 20px 60px rgba(0,0,0,.68)",
            WebkitOverflowScrolling: "touch",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              marginBottom: 12,
            }}
          >
            <div>
              <strong style={{ color: "#7dd3fc", fontSize: 16 }}>
                {routeKind.toUpperCase()} DIAGNOSE
              </strong>
              <div style={{ fontSize: 11, color: "#94a3b8" }}>
                Bu ekranı fotoğrafla veya “Kopyala” ile gönder.
              </div>
            </div>

            <button
              type="button"
              onClick={toggle}
              style={{
                border: "1px solid #475569",
                borderRadius: 10,
                padding: "8px 10px",
                background: "#111827",
                color: "#fff",
              }}
            >
              Kapat
            </button>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0,1fr)",
              gap: 10,
            }}
          >
            <DiagnosticBlock title="ROUTE / TARAYICI">
              <Line label="URL" value={browser.href} />
              <Line label="Path" value={browser.pathname} />
              <Line
                label="PWA"
                value={boolLabel(browser.standalone)}
              />
              <Line
                label="Online"
                value={boolLabel(browser.online)}
              />
              <Line label="Visibility" value={browser.visibility} />
              <Line label="Viewport" value={browser.viewport} />
              <Line label="Screen" value={browser.screen} />
              <Line label="User-Agent" value={browser.userAgent} />
            </DiagnosticBlock>

            <DiagnosticBlock title="SUNUCU / COOKIE">
              <Line
                label="Durum"
                value={
                  serverLoading
                    ? "YÜKLENİYOR"
                    : server?.ok
                      ? "OK"
                      : `HATA: ${server?.error || "Bilinmiyor"}`
                }
              />
              <Line
                label="bb_tv_auth"
                value={boolLabel(server?.cookies?.bb_tv_auth)}
              />
              <Line
                label="bb_tv_sess"
                value={boolLabel(server?.cookies?.bb_tv_sess)}
              />
              <Line
                label="bb_admin_sess"
                value={boolLabel(server?.cookies?.bb_admin_sess)}
              />
              <Line
                label="TV PIN env"
                value={boolLabel(
                  server?.environment?.tvPinConfigured,
                )}
              />
              <Line
                label="Driver PIN env"
                value={boolLabel(
                  server?.environment?.driverPinConfigured,
                )}
              />
              <Line
                label="Driver şifre env"
                value={boolLabel(
                  server?.environment?.driverPasswordConfigured,
                )}
              />
              <Line label="Host" value={server?.host || "-"} />
              <Line label="Server time" value={server?.now || "-"} />
            </DiagnosticBlock>

            <DiagnosticBlock title={`HATALAR (${allEvents.length})`}>
              {allEvents.length === 0 ? (
                <div style={{ color: "#86efac" }}>
                  Henüz JavaScript hatası yakalanmadı.
                </div>
              ) : (
                allEvents.map((item, index) => (
                  <pre
                    key={`${item.at}-${index}`}
                    style={{
                      whiteSpace: "pre-wrap",
                      overflowWrap: "anywhere",
                      margin: "0 0 10px",
                      padding: 10,
                      borderRadius: 10,
                      background: "rgba(127,29,29,.34)",
                      border: "1px solid rgba(248,113,113,.45)",
                      color: "#fecaca",
                      fontSize: 11,
                    }}
                  >
                    {`${item.type}\n${item.message}\n${item.source || ""}:${item.line || 0}:${item.column || 0}\n${item.stack || ""}`}
                  </pre>
                ))
              )}
            </DiagnosticBlock>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 8,
              marginTop: 12,
            }}
          >
            <button
              type="button"
              onClick={copy}
              style={{
                minHeight: 44,
                border: 0,
                borderRadius: 12,
                background: "#0284c7",
                color: "#fff",
                fontWeight: 800,
              }}
            >
              {copied ? "KOPYALANDI ✅" : "TEŞHİSİ KOPYALA"}
            </button>

            <button
              type="button"
              onClick={reloadWithoutCache}
              style={{
                minHeight: 44,
                border: "1px solid #475569",
                borderRadius: 12,
                background: "#111827",
                color: "#fff",
                fontWeight: 800,
              }}
            >
              YENİDEN YÜKLE
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

function DiagnosticBlock({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        minWidth: 0,
        borderRadius: 12,
        border: "1px solid #334155",
        background: "rgba(15,23,42,.78)",
        padding: 10,
      }}
    >
      <div
        style={{
          marginBottom: 8,
          color: "#fbbf24",
          fontWeight: 900,
          fontSize: 12,
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

function Line({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "120px minmax(0,1fr)",
        gap: 8,
        padding: "4px 0",
        borderBottom: "1px solid rgba(51,65,85,.45)",
        fontSize: 11,
      }}
    >
      <span style={{ color: "#94a3b8" }}>{label}</span>
      <span
        style={{
          color: "#f8fafc",
          overflowWrap: "anywhere",
        }}
      >
        {value || "-"}
      </span>
    </div>
  );
}

export default function OperationalDiagnostics({
  routeKind,
  children,
}: BoundaryProps) {
  return (
    <OperationalErrorBoundary routeKind={routeKind}>
      {children}
    </OperationalErrorBoundary>
  );
}
