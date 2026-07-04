#!/usr/bin/env node
// print-agent/agent.mjs
// Burger Brothers Berlin print bridge.
// Amaç: Otomatik yazdırmayı TV'deki manuel yazdırma ile aynı tasarıma bağlamak.
// Bu agent kendi fiş tasarımını üretmez; mevcut print-proxy /print/full endpointine gönderir.
// Böylece manuel TV baskısı ve otomatik agent baskısı aynı logo/KDV/barkod dizaynını kullanır.
// Node 20+ gerekir. Ek npm paketi gerekmez.

import fs from "fs";
import path from "path";
import process from "process";

const DEFAULT_CONFIG_PATH = path.join(process.cwd(), "print-agent", "config.json");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function trimSlash(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function loadConfig() {
  const configPath = process.argv[2] || process.env.PRINT_AGENT_CONFIG || DEFAULT_CONFIG_PATH;

  if (!fs.existsSync(configPath)) {
    throw new Error(`Config bulunamadı: ${configPath}`);
  }

  const fileCfg = readJson(configPath);

  const cfg = {
    // Gerçek domain / Vercel
    baseUrl: trimSlash(process.env.PRINT_BASE_URL || fileCfg.baseUrl || ""),

    // Vercel ENV'deki PRINT_AGENT_TOKEN ile aynı olmalı
    token: process.env.PRINT_AGENT_TOKEN || fileCfg.token || "",

    // Agent adı DB print meta içinde görünür
    agentName: process.env.PRINT_AGENT_NAME || fileCfg.agentName || "shop-tv-1",

    // Mevcut print-proxy adresi. Tasarım ve yazıcı IP ayarları print-proxy içinde kalır.
    printProxyUrl: trimSlash(
      process.env.PRINT_PROXY_URL || fileCfg.printProxyUrl || "http://127.0.0.1:7777",
    ),

    // /api/print/jobs tarafına bilgi amaçlı gönderilir
    printerName: process.env.PRINTER_NAME || fileCfg.printerName || "print-proxy",

    pollSeconds: Number(process.env.PRINT_POLL_SECONDS || fileCfg.pollSeconds || 5),
    maxJobs: Number(process.env.PRINT_MAX_JOBS || fileCfg.maxJobs || 3),
    lookbackMinutes: Number(process.env.PRINT_LOOKBACK_MINUTES || fileCfg.lookbackMinutes || 720),
    leaseSeconds: Number(process.env.PRINT_LEASE_SECONDS || fileCfg.leaseSeconds || 180),
    maxAttempts: Number(process.env.PRINT_MAX_ATTEMPTS || fileCfg.maxAttempts || 5),

    fetchTimeoutMs: Number(process.env.PRINT_FETCH_TIMEOUT_MS || fileCfg.fetchTimeoutMs || 30000),

    // print-proxy /print/full options
    options: {
      paper: fileCfg?.options?.paper || "80mm",
      copies: Number(fileCfg?.options?.copies || 1),
      brand: fileCfg?.options?.brand || "Burger Brothers",
      logoUrl: fileCfg?.options?.logoUrl || undefined,
      maskName: fileCfg?.options?.maskName ?? false,
      maskPhone: fileCfg?.options?.maskPhone ?? false,
    },
  };

  if (!cfg.baseUrl) throw new Error("baseUrl eksik.");
  if (!cfg.printProxyUrl) throw new Error("printProxyUrl eksik.");

  return cfg;
}

function log(...args) {
  console.log(new Date().toLocaleString("de-DE"), "-", ...args);
}

function withTimeout(ms) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);

  return {
    signal: controller.signal,
    cancel: () => clearTimeout(timeout),
  };
}

async function fetchJson(url, options = {}, timeoutMs = 30000) {
  const timeout = withTimeout(timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: timeout.signal,
    });

    const text = await response.text();
    let payload = null;

    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = { raw: text };
    }

    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}: ${JSON.stringify(payload)}`);
    }

    return payload;
  } finally {
    timeout.cancel();
  }
}

async function apiJson(cfg, pathname, options = {}) {
  const url = `${cfg.baseUrl}${pathname}`;
  const headers = {
    "Content-Type": "application/json",
    "x-print-agent-token": cfg.token,
    "x-print-agent-name": cfg.agentName,
    ...(options.headers || {}),
  };

  return fetchJson(
    url,
    {
      ...options,
      headers,
    },
    cfg.fetchTimeoutMs,
  );
}

async function proxyJson(cfg, pathname, options = {}) {
  const url = `${cfg.printProxyUrl}${pathname}`;
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };

  return fetchJson(
    url,
    {
      ...options,
      headers,
    },
    cfg.fetchTimeoutMs,
  );
}

async function fetchJobs(cfg) {
  const params = new URLSearchParams({
    agent: cfg.agentName,
    printer: cfg.printerName,
    max: String(cfg.maxJobs),
    lookbackMinutes: String(cfg.lookbackMinutes),
    leaseSeconds: String(cfg.leaseSeconds),
    maxAttempts: String(cfg.maxAttempts),
  });

  const payload = await apiJson(cfg, `/api/print/jobs?${params.toString()}`, {
    method: "GET",
  });

  return Array.isArray(payload?.jobs) ? payload.jobs : [];
}

async function markJob(cfg, job, status, extra = {}) {
  return apiJson(cfg, "/api/print/mark", {
    method: "POST",
    body: JSON.stringify({
      id: job.orderId || job.id,
      jobId: job.jobId,
      status,
      agent: cfg.agentName,
      printer: cfg.printerName,
      ...extra,
    }),
  });
}

function num(value, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value == null || value === "") return fallback;

  const text = String(value).trim().replace(/[€\s]/g, "").replace(",", ".");
  const match = text.match(/-?\d+(\.\d+)?/);
  const parsed = match ? Number(match[0]) : Number(text);

  return Number.isFinite(parsed) ? parsed : fallback;
}

function clean(value) {
  return String(value ?? "").trim();
}

function normalizeCustomerForProxy(customer = {}) {
  const addressLine = clean(
    customer.addressLine ||
      customer.address ||
      [customer.street, customer.house || customer.houseNo].filter(Boolean).join(" "),
  );

  return {
    ...customer,
    name: clean(customer.name),
    phone: clean(customer.phone),
    email: clean(customer.email),
    address: addressLine,
    addressLine,
    street: clean(customer.street),
    house: clean(customer.house || customer.houseNo),
    houseNo: clean(customer.houseNo || customer.house),
    zip: clean(customer.zip || customer.plz || customer.postalCode),
    plz: clean(customer.plz || customer.zip || customer.postalCode),
    city: clean(customer.city),
    floor: clean(customer.floor),
    entrance: clean(customer.entrance),
    deliveryHint: clean(customer.deliveryHint || customer.note),
    note: clean(customer.note || customer.deliveryHint),
  };
}

function normalizeItemsForProxy(items = []) {
  return (Array.isArray(items) ? items : []).map((item) => ({
    id: item.id ? String(item.id) : undefined,
    sku: item.sku ? String(item.sku) : undefined,
    name: clean(item.name || item.title || "Artikel"),
    category: clean(item.category || item.group || item.type),
    group: clean(item.group || item.category || item.type),
    price: num(item.price ?? item.unitPrice, 0),
    qty: Math.max(1, num(item.qty ?? item.quantity, 1)),
    add: Array.isArray(item.add || item.extras)
      ? (item.add || item.extras).map((extra) => ({
          id: extra?.id ? String(extra.id) : undefined,
          label: clean(extra?.label || extra?.name),
          name: clean(extra?.name || extra?.label),
          price: num(extra?.price, 0),
        }))
      : [],
    rm: Array.isArray(item.rm || item.remove)
      ? (item.rm || item.remove).map((entry) => String(entry))
      : [],
    note: clean(item.note),
    taxRate: item.taxRate,
  }));
}

/*
  /api/print/jobs cevabını eski print-proxy /print/full'in beklediği order şekline çevirir.
  Tasarım yine print-proxy içindeki buildTicketFromOrder fonksiyonundan gelir.
*/
function jobToProxyOrder(job) {
  const totals = job.totals || {};
  const customer = normalizeCustomerForProxy(job.customer || {});
  const items = normalizeItemsForProxy(job.items || []);
  const note = clean(job.note || customer.deliveryHint || customer.note);
  const couponDiscount = num(totals.couponDiscount, 0);
  const regularDiscount = num(totals.discount, 0);
  const discountTotal = regularDiscount + couponDiscount;

  const adjustments = [];

  if (regularDiscount > 0) {
    adjustments.push({
      type: "discount",
      source: "Rabatt",
      reason: "Rabatt / Angebot",
      amount: regularDiscount,
    });
  }

  if (couponDiscount > 0) {
    adjustments.push({
      type: "discount",
      source: "Gutschein",
      code: totals.coupon || "",
      reason: totals.coupon ? `Gutschein ${totals.coupon}` : "Gutschein",
      amount: couponDiscount,
    });
  }

  return {
    id: job.orderId || job.id,
    orderId: job.orderId || job.id,
    ts: job.ts || Date.now(),
    createdAt: job.createdAt || undefined,
    updatedAt: job.updatedAt || undefined,
    mode: job.mode || "delivery",
    channel: job.channel || job?.meta?.source || "web",
    status: job.status || "new",
    planned: job.planned || undefined,
    etaMin: job.etaMin ?? undefined,
    etaAdjustMin: job.etaAdjustMin ?? 0,

    customer,
    items,
    note,
    orderNote: note,
    deliveryNote: note,

    merchandise: num(totals.merchandise, 0),
    discount: regularDiscount,
    coupon: totals.coupon || null,
    couponDiscount,
    surcharges: num(totals.surcharges, 0),
    total: num(totals.total, 0),
    amount: num(totals.total, 0),
    payable: num(totals.total, 0),
    toPay: num(totals.total, 0),

    pricing: {
      subtotal: num(totals.merchandise, 0),
      discount: discountTotal,
      total: num(totals.total, 0),
      delivery: num(totals.surcharges, 0),
      deliveryFee: num(totals.surcharges, 0),
    },

    fees: {
      delivery: num(totals.surcharges, 0),
      deliveryFee: num(totals.surcharges, 0),
    },

    adjustments,

    meta: {
      ...(job.meta || {}),
      note,
      orderNote: note,
      paymentMethod: job?.payment?.method || job?.meta?.paymentMethod || null,
      paymentStatus: job?.payment?.status || job?.meta?.paymentStatus || null,
      coupon: totals.coupon || job?.meta?.coupon || null,
      couponDiscount,
    },
  };
}

async function printViaProxy(cfg, job) {
  const order = jobToProxyOrder(job);

  return proxyJson(cfg, "/print/full", {
    method: "POST",
    body: JSON.stringify({
      order,
      options: cfg.options,
    }),
  });
}

async function checkProxy(cfg) {
  try {
    const health = await proxyJson(cfg, "/health", { method: "GET" }, 8000);
    log("print-proxy OK:", JSON.stringify(health?.printer || health || {}));
  } catch (error) {
    log("print-proxy uyarı:", error?.message || error);
    log("Agent yine başlar ama yazdırma için print-proxy açık olmalı.");
  }
}

async function handleJob(cfg, job) {
  const orderId = job.orderId || job.id;

  log("Yazdiriliyor:", orderId);

  try {
    await printViaProxy(cfg, job);
    await markJob(cfg, job, "printed");
    log("Basildi:", orderId);
  } catch (error) {
    const message = error?.message || String(error);

    log("Yazdirma hatasi:", orderId, message);

    try {
      await markJob(cfg, job, "failed", {
        error: message.slice(0, 500),
      });
    } catch (markError) {
      log("Hata DB'ye yazilamadi:", markError?.message || markError);
    }
  }
}

let stopped = false;

process.on("SIGINT", () => {
  stopped = true;
  log("Durduruluyor...");
});

process.on("SIGTERM", () => {
  stopped = true;
  log("Durduruluyor...");
});

async function main() {
  const cfg = loadConfig();

  log("Print Agent Bridge basladi");
  log("Domain:", cfg.baseUrl);
  log("Print proxy:", cfg.printProxyUrl);
  log("Agent:", cfg.agentName);

  await checkProxy(cfg);

  while (!stopped) {
    try {
      const jobs = await fetchJobs(cfg);

      if (jobs.length) {
        log(`${jobs.length} yeni yazdirma isi var.`);
      }

      for (const job of jobs) {
        if (stopped) break;
        await handleJob(cfg, job);
      }
    } catch (error) {
      log("Agent hata:", error?.message || error);
    }

    await sleep(Math.max(1, cfg.pollSeconds) * 1000);
  }

  log("Print Agent durdu.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
