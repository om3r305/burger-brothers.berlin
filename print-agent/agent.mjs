#!/usr/bin/env node
// print-agent/agent.mjs
// Burger Brothers Berlin local ESC/POS print agent.
// Node 20+ gerekir. Ek npm paketi gerekmez.

import fs from "fs";
import path from "path";
import net from "net";
import process from "process";

const DEFAULT_CONFIG_PATH = path.join(process.cwd(), "print-agent", "config.json");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function loadConfig() {
  const configPath = process.argv[2] || process.env.PRINT_AGENT_CONFIG || DEFAULT_CONFIG_PATH;

  if (!fs.existsSync(configPath)) {
    throw new Error(`Config bulunamadı: ${configPath}`);
  }

  const fileCfg = readJson(configPath);

  const cfg = {
    baseUrl: process.env.PRINT_BASE_URL || fileCfg.baseUrl || "",
    token: process.env.PRINT_AGENT_TOKEN || fileCfg.token || "",
    agentName: process.env.PRINT_AGENT_NAME || fileCfg.agentName || "shop-tv-1",
    printerHost: process.env.PRINTER_HOST || fileCfg.printerHost || "",
    printerPort: Number(process.env.PRINTER_PORT || fileCfg.printerPort || 9100),
    printerName: process.env.PRINTER_NAME || fileCfg.printerName || "",
    pollSeconds: Number(process.env.PRINT_POLL_SECONDS || fileCfg.pollSeconds || 5),
    maxJobs: Number(process.env.PRINT_MAX_JOBS || fileCfg.maxJobs || 3),
    lookbackMinutes: Number(process.env.PRINT_LOOKBACK_MINUTES || fileCfg.lookbackMinutes || 720),
    leaseSeconds: Number(process.env.PRINT_LEASE_SECONDS || fileCfg.leaseSeconds || 180),
    maxAttempts: Number(process.env.PRINT_MAX_ATTEMPTS || fileCfg.maxAttempts || 5),
    socketTimeoutMs: Number(process.env.PRINT_SOCKET_TIMEOUT_MS || fileCfg.socketTimeoutMs || 12000),
    receiptWidth: Number(process.env.PRINT_RECEIPT_WIDTH || fileCfg.receiptWidth || 42),
    printBarcode: fileCfg.printBarcode !== false,
    cutPaper: fileCfg.cutPaper !== false,
    cashDrawer: fileCfg.cashDrawer === true,
  };

  cfg.baseUrl = String(cfg.baseUrl).replace(/\/+$/, "");

  if (!cfg.baseUrl) throw new Error("baseUrl eksik.");
  if (!cfg.printerHost) throw new Error("printerHost eksik.");
  if (!Number.isFinite(cfg.printerPort) || cfg.printerPort <= 0) throw new Error("printerPort geçersiz.");

  return cfg;
}

function log(...args) {
  console.log(new Date().toLocaleString("de-DE"), "-", ...args);
}

function ascii(input) {
  return String(input ?? "")
    .replace(/€/g, "EUR")
    .replace(/Ä/g, "Ae")
    .replace(/Ö/g, "Oe")
    .replace(/Ü/g, "Ue")
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/Ğ/g, "G")
    .replace(/ğ/g, "g")
    .replace(/Ş/g, "S")
    .replace(/ş/g, "s")
    .replace(/İ/g, "I")
    .replace(/ı/g, "i")
    .replace(/Ç/g, "C")
    .replace(/ç/g, "c")
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "?");
}

function clean(value) {
  return ascii(String(value ?? "").trim());
}

function eur(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return "0,00 EUR";
  return `${n.toFixed(2).replace(".", ",")} EUR`;
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function esc(...bytes) {
  return Buffer.from(bytes);
}

function txt(value = "") {
  return Buffer.from(ascii(value), "ascii");
}

function line(value = "") {
  return txt(`${value}\n`);
}

function repeat(char, count) {
  return char.repeat(Math.max(0, count));
}

function leftRight(left, right, width) {
  const l = clean(left);
  const r = clean(right);
  const maxLeft = Math.max(0, width - r.length - 1);
  const sliced = l.length > maxLeft ? l.slice(0, maxLeft) : l;
  return `${sliced}${repeat(" ", Math.max(1, width - sliced.length - r.length))}${r}`;
}

function wrap(text, width) {
  const words = clean(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";

  for (const word of words) {
    if (!current) {
      current = word.length > width ? word.slice(0, width) : word;
    } else if ((current + " " + word).length <= width) {
      current += " " + word;
    } else {
      lines.push(current);
      current = word.length > width ? word.slice(0, width) : word;
    }
  }

  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

function center(text, width) {
  const value = clean(text);
  const left = Math.floor(Math.max(0, width - value.length) / 2);
  return `${repeat(" ", left)}${value}`;
}

function paymentLabel(value) {
  const raw = clean(value).toLowerCase();

  if (raw === "cash" || raw === "bar" || raw === "barzahlung") return "Barzahlung";
  if (raw === "online" || raw === "stripe" || raw === "card") return "Online";
  if (raw === "contactless" || raw === "kontaktlos") return "Kontaktlos";
  if (raw === "split_contactless" || raw === "split") return "Getrennt/Kontaktlos";

  return value ? clean(value) : "";
}

function barcode(orderId) {
  const safe = clean(orderId).replace(/[^A-Za-z0-9_-]/g, "");
  if (!safe) return line("");

  const data = Buffer.from(`{B${safe}`, "ascii");

  return Buffer.concat([
    esc(0x1d, 0x48, 0x02), // HRI below
    esc(0x1d, 0x68, 0x50), // height
    esc(0x1d, 0x77, 0x02), // width
    esc(0x1d, 0x6b, 0x49, data.length), // CODE128
    data,
    line(""),
  ]);
}

function receipt(job, cfg) {
  const width = cfg.receiptWidth;
  const chunks = [];
  const push = (b) => chunks.push(b);
  const pushLine = (v = "") => push(line(v));

  const id = clean(job.orderId || job.id || "");
  const mode = job.mode === "pickup" ? "Abholung" : "Lieferung";
  const totals = job.totals || {};
  const customer = job.customer || {};
  const pay = paymentLabel(job?.payment?.method || job?.meta?.paymentMethod || "");

  push(esc(0x1b, 0x40)); // init
  push(esc(0x1b, 0x61, 0x01)); // center
  push(esc(0x1b, 0x45, 0x01)); // bold
  pushLine(center("BURGER BROTHERS", width));
  push(esc(0x1b, 0x45, 0x00));
  pushLine(center("Berlin Tegel", width));
  pushLine("");

  push(esc(0x1b, 0x61, 0x00)); // left
  push(esc(0x1b, 0x45, 0x01));
  pushLine(`Bestellung #${id}`);
  push(esc(0x1b, 0x45, 0x00));
  pushLine(leftRight("Art", mode, width));

  if (job.channel) pushLine(leftRight("Kanal", clean(job.channel), width));
  if (job.planned) pushLine(leftRight("Geplant", clean(job.planned), width));

  const eta = Number(job.etaMin || 0) + Number(job.etaAdjustMin || 0);
  if (eta > 0) pushLine(leftRight("ETA", `~${eta} Min`, width));
  if (pay) pushLine(leftRight("Zahlung", pay, width));

  pushLine(repeat("-", width));

  if (customer.name || customer.phone || customer.addressLine || customer.address) {
    push(esc(0x1b, 0x45, 0x01));
    pushLine("Kunde");
    push(esc(0x1b, 0x45, 0x00));

    if (customer.name) pushLine(clean(customer.name));
    if (customer.phone) pushLine(clean(customer.phone));

    const address = customer.addressLine || customer.address || "";
    if (address) wrap(address, width).forEach(pushLine);

    const zipLine = [customer.plz || customer.zip, customer.city].filter(Boolean).join(" ");
    if (zipLine) pushLine(clean(zipLine));
    if (customer.floor) pushLine(`Etage: ${clean(customer.floor)}`);
    if (customer.entrance) pushLine(`Aufgang: ${clean(customer.entrance)}`);

    const note = job.note || customer.deliveryHint || customer.note || "";
    if (note) {
      pushLine("");
      push(esc(0x1b, 0x45, 0x01));
      pushLine("Hinweis");
      push(esc(0x1b, 0x45, 0x00));
      wrap(note, width).forEach(pushLine);
    }

    pushLine(repeat("-", width));
  }

  push(esc(0x1b, 0x45, 0x01));
  pushLine("Artikel");
  push(esc(0x1b, 0x45, 0x00));

  for (const item of array(job.items)) {
    const qty = Number(item.qty || 1);
    const name = clean(item.name || "Artikel");
    const unit = Number(item.price || 0);
    const right = unit > 0 ? eur(unit * qty) : "";

    pushLine(leftRight(`${qty} x ${name}`, right, width));

    for (const extra of array(item.add)) {
      const extraName = clean(extra.label || extra.name || "Extra");
      const extraPrice = Number(extra.price || 0);
      pushLine(leftRight(`  + ${extraName}`, extraPrice > 0 ? `+${eur(extraPrice)}` : "", width));
    }

    const rm = array(item.rm).filter(Boolean);
    if (rm.length) pushLine(`  Ohne: ${clean(rm.join(", "))}`);

    if (item.note) wrap(`  Hinweis: ${item.note}`, width).forEach(pushLine);
  }

  pushLine(repeat("-", width));
  pushLine(leftRight("Warenwert", eur(totals.merchandise), width));
  if (Number(totals.discount || 0) > 0) pushLine(leftRight("Rabatt", `-${eur(totals.discount)}`, width));
  if (Number(totals.couponDiscount || 0) > 0) {
    pushLine(leftRight(totals.coupon ? `Gutschein ${totals.coupon}` : "Gutschein", `-${eur(totals.couponDiscount)}`, width));
  }
  if (Number(totals.surcharges || 0) > 0) pushLine(leftRight("Aufschlaege", eur(totals.surcharges), width));

  push(esc(0x1b, 0x45, 0x01));
  pushLine(leftRight("GESAMT", eur(totals.total), width));
  push(esc(0x1b, 0x45, 0x00));
  pushLine(repeat("-", width));

  if (cfg.printBarcode && id) {
    push(esc(0x1b, 0x61, 0x01));
    pushLine(`#${id}`);
    push(barcode(id));
    push(esc(0x1b, 0x61, 0x00));
  }

  pushLine("");
  pushLine("");
  pushLine("");

  if (cfg.cashDrawer) push(esc(0x1b, 0x70, 0x00, 0x32, 0x32));
  if (cfg.cutPaper) push(esc(0x1d, 0x56, 0x42, 0x00));

  return Buffer.concat(chunks);
}

function send(buffer, cfg) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: cfg.printerHost, port: cfg.printerPort }, () => {
      socket.write(buffer, (error) => {
        if (error) {
          socket.destroy();
          reject(error);
          return;
        }

        socket.end();
      });
    });

    socket.setTimeout(cfg.socketTimeoutMs || 12000);
    socket.on("timeout", () => socket.destroy(new Error("printer_socket_timeout")));
    socket.on("error", reject);
    socket.on("close", resolve);
  });
}

async function api(cfg, pathname, options = {}) {
  const response = await fetch(`${cfg.baseUrl}${pathname}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "x-print-agent-token": cfg.token,
      "x-print-agent-name": cfg.agentName,
      ...(options.headers || {}),
    },
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
}

async function jobs(cfg) {
  const params = new URLSearchParams({
    agent: cfg.agentName,
    printer: cfg.printerName || `${cfg.printerHost}:${cfg.printerPort}`,
    max: String(cfg.maxJobs),
    lookbackMinutes: String(cfg.lookbackMinutes),
    leaseSeconds: String(cfg.leaseSeconds),
    maxAttempts: String(cfg.maxAttempts),
  });

  const payload = await api(cfg, `/api/print/jobs?${params.toString()}`, { method: "GET" });
  return Array.isArray(payload?.jobs) ? payload.jobs : [];
}

async function mark(cfg, job, status, extra = {}) {
  return api(cfg, "/api/print/mark", {
    method: "POST",
    body: JSON.stringify({
      id: job.orderId || job.id,
      jobId: job.jobId,
      status,
      agent: cfg.agentName,
      printer: cfg.printerName || `${cfg.printerHost}:${cfg.printerPort}`,
      ...extra,
    }),
  });
}

async function handle(cfg, job) {
  const id = job.orderId || job.id;
  log("Yazdiriliyor:", id);

  try {
    await send(receipt(job, cfg), cfg);
    await mark(cfg, job, "printed");
    log("Basildi:", id);
  } catch (error) {
    const message = error?.message || String(error);
    log("Yazdirma hatasi:", id, message);

    try {
      await mark(cfg, job, "failed", { error: message.slice(0, 500) });
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

  log("Print Agent basladi");
  log("Domain:", cfg.baseUrl);
  log("Yazici:", `${cfg.printerHost}:${cfg.printerPort}`);
  log("Agent:", cfg.agentName);

  while (!stopped) {
    try {
      const list = await jobs(cfg);
      if (list.length) log(`${list.length} yeni yazdirma isi var.`);

      for (const job of list) {
        if (stopped) break;
        await handle(cfg, job);
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
