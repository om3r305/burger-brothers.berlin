// ESC/POS proxy – CP858/CP1252 (Euro) – sabit sıra, belirgin grup başlıkları,
// KDV özeti (7% / 19%), üstte LOGO, barkod en altta.
// Logo: URL'den **BMP** (1/8/24 bpp) indir, auto-invert + brighten + gamma + dithering + auto-crop ile raster bas.

const http = require('http');
const https = require('https');
const net = require('net');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/* ====== .env loader (npm paketi gerekmez) ====== */
function loadLocalEnv(filePath = path.join(__dirname, '.env')) {
  try {
    if (!fs.existsSync(filePath)) return;
    const raw = fs.readFileSync(filePath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      value = value.replace(/\s+#.*$/, '').trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (key && process.env[key] == null) process.env[key] = value;
    }
  } catch (err) {
    console.warn('.env okunamadı:', err?.message || err);
  }
}
loadLocalEnv();

/* ====== AYAR ====== */
const PORT          = Number(process.env.PORT || 7777);
const BIND_HOST     = String(process.env.PRINT_PROXY_HOST || '127.0.0.1').trim() || '127.0.0.1';
const PRINTER_IP    = process.env.PRINTER_HOST || process.env.PRINTER_IP || '192.168.0.150';
const PRINTER_PORT  = Number(process.env.PRINTER_PORT || 9100);
const PRINTER_CODEPAGE = String(process.env.PRINTER_CODEPAGE || 'CP858').trim().toUpperCase();
const PRINT_PROXY_TOKEN = String(process.env.PRINT_PROXY_TOKEN || '').trim();
const ALLOW_ORIGINS = (process.env.ALLOW_ORIGINS || 'https://www.burger-brothers.berlin,https://www.burger-brothers.berlin')
  .split(',').map(s=>s.trim()).filter(Boolean);
const MAX_JSON_BYTES = Math.max(1024, Math.min(1_048_576, Number(process.env.MAX_JSON_BYTES || 262_144) || 262_144));
const MAX_COPIES = Math.max(1, Math.min(10, Number(process.env.MAX_PRINT_COPIES || 3) || 3));
const MAX_LINES = Math.max(1, Math.min(1000, Number(process.env.MAX_PRINT_LINES || 200) || 200));
const MAX_LINE_CHARS = Math.max(20, Math.min(2000, Number(process.env.MAX_PRINT_LINE_CHARS || 240) || 240));
const ALLOW_LEGACY_TAX_FALLBACK =
  String(process.env.PRINT_ALLOW_LEGACY_TAX_FALLBACK || '0') === '1';
const FISCAL_OPERATION_MODE =
  String(process.env.FISCAL_OPERATION_MODE || 'unconfigured').trim().toLowerCase();

if (
  PRINT_PROXY_TOKEN.length < 32 ||
  /^(BURAYA_|CHANGE_ME|CHANGEME|PLACEHOLDER)/i.test(PRINT_PROXY_TOKEN)
) {
  throw new Error('PRINT_PROXY_TOKEN eksik veya zayıf. En az 32 karakterlik rastgele bir token ayarlayın.');
}

// Varsayılan logo: önce print-proxy klasöründeki local BMP, yoksa URL
const DEFAULT_LOGO_FILE = path.join(__dirname, process.env.LOGO_FILE || 'logo-thermal.bmp');
const DEFAULT_LOGO_URL = 'https://www.burger-brothers.berlin/logo-thermal.bmp';
const LOGO_URL         = process.env.LOGO_URL || DEFAULT_LOGO_URL;
const LOGO_URL_ORIGINS = new Set(
  (process.env.LOGO_URL_ORIGINS || 'https://www.burger-brothers.berlin')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
);
const MAX_LOGO_BYTES = Math.max(64_000, Math.min(5_000_000, Number(process.env.MAX_LOGO_BYTES || 3_000_000) || 3_000_000));

// Dev ortamında self-signed https için
const ALLOW_INSECURE_LOGO = String(process.env.ALLOW_INSECURE_LOGO || '0') === '1';
const insecureHttpsAgent  = new https.Agent({ rejectUnauthorized: false });

// Logo render ayarları (env ile override edilebilir)
// Daha koyu varsayılan: threshold ↑, blackBoost ↑
const LOGO_THRESHOLD   = Number(process.env.LOGO_THRESHOLD || 210);  // 190–230; yüksek olursa beyaz zemin kirlenebilir
const LOGO_MAX_WIDTH   = Number(process.env.LOGO_MAX_WIDTH || 280);  // logo daha kompakt; üst boşluk azalır
const LOGO_BRIGHTEN    = Number(process.env.LOGO_BRIGHTEN  || 1.00); // temiz thermal logo için nötr
const LOGO_GAMMA       = Number(process.env.LOGO_GAMMA     || 1.00); // temiz thermal logo için nötr
const LOGO_DITHER      = String(process.env.LOGO_DITHER || '0') === '1';
const LOGO_BLACK_BOOST = Number(process.env.LOGO_BLACK_BOOST || 0.00); // beyaz zemin kirlenmesin
const LOGO_AUTOCROP    = String(process.env.LOGO_AUTOCROP || '1') === '1';
const LOGO_CROP_PAD    = Number(process.env.LOGO_CROP_PAD || 0);      // crop sonrası kenarda bırakılacak pay (px)

// Barkod ölçüleri
const BARCODE_HEIGHT   = Number(process.env.BARCODE_HEIGHT || 80); // 40–255
const BARCODE_MODULE   = Number(process.env.BARCODE_MODULE || 1);  // 1=ince,2=orta,3=kalın

// Varsayılan olarak toplamı kuruşu kuruşuna koru.
// Yalnız işletme açıkça isterse .env içindeki ROUND_TOTAL_STEP_CENTS ile
// farklı bir nakit yuvarlama adımı seçilebilir.
const ROUND_TOTAL_STEP_CENTS = Math.max(
  1,
  Math.min(100, Number(process.env.ROUND_TOTAL_STEP_CENTS || 1) || 1),
);

/* ====== MAĞAZA BİLGİLERİ (başlangıçta bir kez okunur) ====== */
const STORE_HEADER_LINES = [
  process.env.PRINT_STORE_ADDRESS_LINE_1 || 'Berliner Str. 9',
  process.env.PRINT_STORE_ADDRESS_LINE_2 || '13507 Berlin',
  process.env.PRINT_STORE_PHONE || 'Tel: 030 - 405 73 030',
  process.env.PRINT_STORE_TAX_ID || 'St.Nr: 17/602/03138',
].map((value) => String(value || '').trim()).filter(Boolean);

/* ====== CORS, kimlik doğrulama & yardımcılar ====== */
function cors(res, reqOrigin='') {
  if (!reqOrigin || !ALLOW_ORIGINS.includes(reqOrigin)) return false;
  res.setHeader('Access-Control-Allow-Origin', reqOrigin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'OPTIONS, POST, GET');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Print-Proxy-Token');
  res.setHeader('Access-Control-Max-Age', '600');
  return true;
}

function jsonResponse(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(payload));
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  if (a.length !== b.length || a.length === 0) return false;
  return crypto.timingSafeEqual(a, b);
}

function requestAuthorized(req) {
  return safeEqual(req.headers['x-print-proxy-token'], PRINT_PROXY_TOKEN);
}

function readJson(req, maxBytes = MAX_JSON_BYTES) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    let settled = false;

    req.on('data', (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > maxBytes) {
        settled = true;
        const error = new Error('payload_too_large');
        error.statusCode = 413;
        reject(error);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        const error = new Error('invalid_json');
        error.statusCode = 400;
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function requestError(res, error) {
  const status = Number(error?.statusCode || 500);
  const code = error?.publicCode ||
    (status === 413
      ? 'payload_too_large'
      : status === 400
        ? 'invalid_request'
        : 'print_failed');
  if (status >= 500) console.error('[print-proxy]', error?.message || error);
  return jsonResponse(res, status, { ok: false, error: code });
}

/** HTTPS self-signed destekli, redirect takip eden downloader */
function httpGetBuffer(absUrl) {
  return new Promise((resolve, reject) => {
    const startUrl = new URL(absUrl);
    const allowed = (u) =>
      u.protocol === 'https:' &&
      !u.username &&
      !u.password &&
      LOGO_URL_ORIGINS.has(u.origin);

    if (!allowed(startUrl)) return reject(new Error('logo_url_not_allowed'));

    const fetchOnce = (u, depth=0) => {
      if (!allowed(u)) return reject(new Error('logo_url_not_allowed'));
      if (depth > 3) return reject(new Error('too_many_redirects'));
      const isHttps = u.protocol === 'https:';
      const lib = isHttps ? https : http;

      const opts = {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || (isHttps ? 443 : 80),
        path: u.pathname + u.search,
        method: 'GET',
        timeout: 10000,
      };
      if (isHttps && ALLOW_INSECURE_LOGO) opts.agent = insecureHttpsAgent;

      const req = lib.request(opts, (res) => {
        const code = res.statusCode || 0;
        if ([301,302,303,307,308].includes(code) && res.headers.location) {
          const nextUrl = new URL(res.headers.location, u);
          res.resume();
          if (!allowed(nextUrl)) return reject(new Error('logo_redirect_not_allowed'));
          return fetchOnce(nextUrl, depth+1);
        }
        if (code >= 400) {
          res.resume();
          return reject(new Error('HTTP ' + code));
        }
        const chunks=[];
        let size = 0;
        res.on('data', (chunk) => {
          size += chunk.length;
          if (size > MAX_LOGO_BYTES) {
            res.destroy();
            req.destroy(new Error('logo_too_large'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', ()=> resolve(Buffer.concat(chunks)));
      });
      req.on('timeout', ()=>{ req.destroy(new Error('timeout')); });
      req.on('error', reject);
      req.end();
    };

    fetchOnce(startUrl, 0);
  });
}
function sendToPrinter(buf) {
  return new Promise((resolve, reject) => {
    const sock = new net.Socket();
    sock.once('error', reject);
    sock.connect(PRINTER_PORT, PRINTER_IP, () => {
      sock.write(buf);
      setTimeout(()=>{ try{ sock.end(); }catch{} }, 120);
      resolve(true);
    });
  });
}

/* ====== ESC/POS helpers ====== */
const ESC=0x1B, GS=0x1D;
const LINE = 42; // 80mm, font A

const init      = () => Buffer.from([ESC,0x40]);
const align     = n => Buffer.from([ESC,0x61,n]);
const bold      = on=> Buffer.from([ESC,0x45,on?1:0]);
const doubleStrike = on=> Buffer.from([ESC,0x47,on?1:0]);
const underline = on=> Buffer.from([ESC,0x2D,on?1:0]);
const CUT_ENABLED = String(process.env.CUT_ENABLED || '1') === '1';
const CUT_FEED_LINES = Number(process.env.CUT_FEED_LINES || 8);
const feedLines = (n=1) => Buffer.from([ESC,0x64, Math.max(0, Math.min(255, Number(n)||0))]);

function cut(){
  if (!CUT_ENABLED) return Buffer.alloc(0);
  // Metapace/ESC-POS full cut. Barkoddan sonra feedLines ile kağıdı öne aldığımız için
  // barkod yarım kalmadan keser.
  return Buffer.from([GS,0x56,0x00]);
}
const fontA     = () => Buffer.from([GS,0x66,0x00]);
const size      = (w=1,h=1)=>Buffer.from([GS,0x21, ((Math.max(1,w)-1)<<4)|((Math.max(1,h)-1)&0x0F)]);
const codepage1252 = () => Buffer.from([ESC,0x74,16]);
const codepage857  = () => Buffer.from([ESC,0x74,13]);
const codepage858  = () => Buffer.from([ESC,0x74,19]);
const selectCodepage = () => {
  if (PRINTER_CODEPAGE === 'CP1252') return codepage1252();
  if (PRINTER_CODEPAGE === 'CP858') return codepage858();
  return codepage857();
};
const fontSel   = n => Buffer.from([ESC,0x4D,n]); // 0:A 1:B (B daha dar)
const lineSpace = n => Buffer.from([ESC,0x33, Math.max(0, Math.min(255, n))]);
const lineSpaceDefault = () => Buffer.from([ESC,0x32]);

const cp1252Special = new Map([
  [0x20AC,0x80],[0x201A,0x82],[0x0192,0x83],[0x201E,0x84],[0x2026,0x85],[0x2020,0x86],[0x2021,0x87],
  [0x02C6,0x88],[0x2030,0x89],[0x0160,0x8A],[0x2039,0x8B],[0x0152,0x8C],[0x2018,0x91],[0x2019,0x92],
  [0x201C,0x93],[0x201D,0x94],[0x2022,0x95],[0x2013,0x96],[0x2014,0x97],[0x02DC,0x98],[0x2122,0x99],
  [0x0161,0x9A],[0x203A,0x9B],[0x0153,0x9C],[0x0178,0x9F],
]);

const cp857Special = new Map([
  ['Ç',0x80],['ü',0x81],['é',0x82],['â',0x83],['ä',0x84],['à',0x85],['å',0x86],['ç',0x87],
  ['ê',0x88],['ë',0x89],['è',0x8A],['ï',0x8B],['î',0x8C],['ı',0x8D],['Ä',0x8E],['Å',0x8F],
  ['É',0x90],['æ',0x91],['Æ',0x92],['ô',0x93],['ö',0x94],['ò',0x95],['û',0x96],['ù',0x97],
  ['İ',0x98],['Ö',0x99],['Ü',0x9A],['ø',0x9B],['£',0x9C],['Ø',0x9D],['Ş',0x9E],['ş',0x9F],
  ['á',0xA0],['í',0xA1],['ó',0xA2],['ú',0xA3],['ñ',0xA4],['Ñ',0xA5],['Ğ',0xA6],['ğ',0xA7],
  ['ß',0xE1],['õ',0xE4],['Õ',0xE5],['Ú',0xE9],['Û',0xEA],['Ù',0xEB],['°',0xF8],['²',0xFD],['³',0xFC],['¼',0xAC],['½',0xAB],['¾',0xF3],
]);

function sanitizePrinterText(value=''){
  return String(value).replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ');
}

function enc1252Str(s=''){
  const out=[];
  for(const ch of sanitizePrinterText(s)){
    const cp=ch.codePointAt(0);
    if (cp<=0xFF) out.push(cp);
    else if (cp1252Special.has(cp)) out.push(cp1252Special.get(cp));
    else out.push(0x3F);
  }
  return Buffer.from(out);
}
function enc857Str(s=''){
  const out=[];
  for(const ch of sanitizePrinterText(s)){
    const cp=ch.codePointAt(0);
    if (cp>=0x20 && cp<=0x7E) { out.push(cp); continue; }
    if (cp857Special.has(ch)) { out.push(cp857Special.get(ch)); continue; }
    if (ch === '€') {
      // CP858 Euro kodu. Fişte EUR yerine € isteniyor.
      // Yazıcı ayarında PRINTER_CODEPAGE=CP858 önerilir.
      out.push(0xD5);
      continue;
    }
    if (ch === '–' || ch === '—') { out.push(0x2D); continue; }
    if (ch === '×') { out.push(0x78); continue; }
    if (ch === '’' || ch === '‘' || ch === '´' || ch === '`') { out.push(0x27); continue; }
    if (ch === '“' || ch === '”') { out.push(0x22); continue; }
    out.push(0x3F);
  }
  return Buffer.from(out);
}
function encStr(s=''){
  if (PRINTER_CODEPAGE === 'CP1252') return enc1252Str(s);
  return enc857Str(s);
}
const text  = (s='') => Buffer.concat([encStr(String(s)), Buffer.from('\n')]);
const twoCol= (L,R)=>{const l=String(L), r=String(R); const sp=Math.max(1, LINE-l.length-r.length); return l+' '.repeat(sp)+r;};

function wrapLines(prefix='', value='', max=LINE){
  const p = String(prefix || '');
  const words = String(value || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (!words.length) return [];
  const out = [];
  let line = p;
  const cont = ' '.repeat(Math.min(p.length, Math.max(0, max - 1)));

  for (const word of words){
    const candidate = (line === p || !line.trim()) ? line + word : line + ' ' + word;
    if (candidate.length <= max){
      line = candidate;
      continue;
    }

    if (line.trim()) out.push(line);
    line = cont + word;

    while (line.length > max){
      out.push(line.slice(0, max));
      line = cont + line.slice(max);
    }
  }

  if (line.trim()) out.push(line);
  return out;
}

function pushWrapped(out, prefix, value, opts={}){
  const lines = wrapLines(prefix, value, opts.max || LINE);
  for (const line of lines) out.push(text(line));
}

/* ====== CODE128 ====== */
function code128(data='', opts={}){
  const clean = String(data || '')
    .trim()
    .replace(/[^ -~]/g, '')
    .slice(0, 48);

  if (!clean) return Buffer.alloc(0);

  // ESC/POS CODE128 Function B güvenli kullanım: önce Code Set B seçilir ({B).
  // HRI kapalı; sipariş numarasını barkodun altında biz bir kez yazıyoruz.
  const payload = Buffer.from(`{B${clean}`, 'ascii');

  return Buffer.concat([
    align(1),
    Buffer.from([GS,0x48,0x00]),                                     // HRI kapalı
    Buffer.from([GS,0x68, Math.max(40, Math.min(255, BARCODE_HEIGHT))]), // yükseklik
    Buffer.from([GS,0x77, Math.max(1, Math.min(3, BARCODE_MODULE))]),    // modül genişliği
    Buffer.from([GS,0x6B,0x49, payload.length]),                     // CODE128
    payload,
    opts?.showText === false ? Buffer.alloc(0) : text(clean)         // eski fişlerde HRI satırı korunur
  ]);
}

/* ====== parse yardımcıları ====== */
function num(v){
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (v == null) return 0;
  const s = String(v).trim().replace(/[€\s]/g,'').replace(',', '.');
  const m = s.match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : 0;
}
function money(v){
  const value = num(v);
  // Fişte Euro işareti rakama bitişik basılsın: 15.00€
  return value.toFixed(2) + '€';
}
function signedMoney(v){
  const value = round2(num(v));
  return (value > 0 ? '+' : '') + money(value);
}
function roundFinalTotal(v){
  const value = round2(num(v));
  const cents = Math.round(value * 100);
  const roundedCents = Math.round(cents / ROUND_TOTAL_STEP_CENTS) * ROUND_TOTAL_STEP_CENTS;
  return round2(roundedCents / 100);
}

const STRIP_SEPARATORS = [' - ', ' – ', ' — ', ': '];
function cleanName(name=''){
  let s=String(name).trim();
  for(const sep of STRIP_SEPARATORS){
    if (s.includes(sep)){
      const parts = s.split(sep).map(p=>p.trim()).filter(Boolean);
      if (parts.length>1) s = parts[parts.length-1];
    }
  }
  return s;
}

/* ====== KATEGORİ ====== */
function normGroupName(raw=''){
  const s=String(raw||'').toLowerCase();
  if (!s) return '';
  if (/(mittag|lunch)/.test(s))            return 'Mittagsmenü';
  if (/(vegan|vegetar|vegetarisch)/.test(s)) return 'Vegan / Vegetarisch';
  if (/(getränk|drink|beverage)/.test(s))    return 'Getränke';
  if (/(soße|sauce|sossen|sos)/.test(s))     return 'Soßen';
  if (/(snack|beilage|beilagen)/.test(s))    return 'Extras';
  if (/(hot\s*dog)/.test(s))                 return 'Hotdogs';
  if (/(burger)/.test(s))                    return 'Burger';
  if (/(extra|zusatz)/.test(s))              return 'Extras';
  return s.replace(/\b\w/g, m=>m.toUpperCase());
}
function detectCategory(it){
  const raw = it?.group || it?.category || it?.type || '';
  const g = normGroupName(raw); if (g) return g;
  const name = String(it?.name||'').toLowerCase();
  if (/(mittag|lunch)/.test(name)) return 'Mittagsmenü';
  if (/burger/.test(name)) return 'Burger';
  if (/(vegan|vegetar)/.test(name)) return 'Vegan / Vegetarisch';
  if (/(getränk|cola|ayran|fanta|sprite|wasser|water|pepsi)/.test(name)) return 'Getränke';
  if (/(soße|sauce|sos|bbq|mayo|ketchup|senf|ranch|aioli|garlic|truffle|chipotle|tartar|sour\s*creme)/.test(name)) return 'Soßen';
  if (/(snack|beilage|beilagen|wings|sticks|rings|fries)/.test(name)) return 'Extras';
  if (/(extra|zusatz)/.test(name)) return 'Extras';
  return 'Andere';
}

/* ====== geplant / hedef saat ====== */
function validMinutes(value){
  const n = num(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}
function parseHhmmToToday(value){
  const m = String(value || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hh = Math.max(0, Math.min(23, parseInt(m[1], 10)));
  const mm = Math.max(0, Math.min(59, parseInt(m[2], 10)));
  const d = new Date();
  d.setHours(hh, mm, 0, 0);
  return d;
}
function fmtTime(d){
  return d.toLocaleTimeString('de-DE', {hour:'2-digit', minute:'2-digit'});
}
function computeGeplant(o){
  const plannedDate = parseHhmmToToday(o?.planned);
  if (plannedDate) return fmtTime(plannedDate);

  const dueIso = o?.targetAt || o?.dueAt || o?.plannedAt || o?.etaAt;
  if (dueIso){
    const d = new Date(dueIso);
    if (Number.isFinite(d.valueOf())) return fmtTime(d);
  }

  const base = new Date(o?.ts || o?.createdAt || Date.now());
  const avg =
    validMinutes(o?.etaMin) ??
    validMinutes(o?.avgMin) ??
    validMinutes(o?.avg) ??
    validMinutes(o?.eta) ??
    (String(o?.mode || '').toLowerCase()==='pickup' ? 15 : 35);

  const plusList = ['etaAdjustMin','addMin','plusMin','delayMin','adjustMin','deltaMin','extraMin','extendMin','bumpMin'];
  const extra = plusList.reduce((sum,key) => sum + (validMinutes(o?.[key]) ?? 0), 0);
  base.setMinutes(base.getMinutes() + avg + extra);
  return fmtTime(base);
}

/* ====== not & adres ====== */
function extractOrderNote(o){
  const c = o?.customer || {};
  return (o?.lifa || o?.lifaNote ||
          o?.note || o?.orderNote || o?.deliveryNote ||
          c?.note || c?.deliveryNote || c?.deliveryHint || c?.hinweis || '');
}
function stripHouseNumber(street='', house=''){
  let clean = String(street || '').trim();
  const houseText = String(house || '').trim();

  if (houseText) {
    const escaped = houseText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    clean = clean.replace(new RegExp(`\\s+${escaped}\\s*$`, 'i'), '').trim();
  }

  // House numbers are intentionally omitted on the kitchen receipt. The full
  // delivery address remains stored in the order and visible in TV/admin.
  clean = clean.replace(/\s+\d+[a-zA-Z]?(?:[-/]\d+[a-zA-Z]?)?\s*$/i, '').trim();
  return clean;
}

function buildDeliveryAddress(cust={}){
  let zip = String(cust.zip || cust.plz || '').trim();
  let street = String(cust.street || cust['straße'] || cust.strasse || '').trim();
  const house = String(cust.houseNo || cust.hausnr || cust.house || cust.nr || '').trim();
  const free = String(cust.address || '').trim();

  if (free){
    const parts = free.split('|').map(s=>s.trim()).filter(Boolean);
    const joined = parts.join(' ');
    const zipMatch = joined.match(/\b(\d{5})\b/);
    if (!zip && zipMatch) zip = zipMatch[1];

    if (!street){
      const candidate = parts.find(part => !/^(?:\d{5})(?:\s|$)/.test(part)) || parts[0] || free;
      street = candidate
        .replace(/\b\d{5}\b.*$/i, '')
        .replace(/,.*$/i, '')
        .trim();
    }
  }

  street = stripHouseNumber(street, house);
  return [zip, street].filter(Boolean).join(' - ');
}

function firstNonEmptyText(...values){
  for (const value of values){
    const textValue = String(value ?? '').trim();
    if (textValue) return textValue;
  }
  return '';
}

function buildReceiptDiscountRows(o, amounts){
  const meta = o?.meta && typeof o.meta === 'object' ? o.meta : {};
  const pricing = o?.pricing && typeof o.pricing === 'object' ? o.pricing : {};
  const fees = o?.fees && typeof o.fees === 'object' ? o.fees : {};
  const rows = [];

  const addRow = (label, amount) => {
    const cleanLabel = firstNonEmptyText(label, 'Rabatt / Angebot');
    const cleanAmount = Math.abs(round2(num(amount)));
    if (!cleanLabel || cleanAmount <= 0) return;

    const existing = rows.find(row => row.label.toLowerCase() === cleanLabel.toLowerCase());
    if (existing){
      existing.amount = round2(existing.amount + cleanAmount);
      return;
    }
    rows.push({ label: cleanLabel, amount: cleanAmount });
  };

  if (amounts.rewardDiscount > 0){
    const reward = meta?.reward && typeof meta.reward === 'object' ? meta.reward : {};
    const rewardLabel = firstNonEmptyText(
      reward?.customerLabel,
      reward?.label,
      'Überraschung',
    );
    addRow(`Glücksgewinn - ${rewardLabel}`, amounts.rewardDiscount);
  }

  let regularRemaining = Math.max(0, round2(amounts.regularDiscount));
  const consumeRegular = (label, rawAmount) => {
    if (regularRemaining <= 0.009) return;
    const requested = Math.abs(round2(num(rawAmount)));
    const amount = requested > 0 ? Math.min(regularRemaining, requested) : regularRemaining;
    if (amount <= 0) return;
    addRow(label, amount);
    regularRemaining = Math.max(0, round2(regularRemaining - amount));
  };

  const campaigns = Array.isArray(meta?.campaigns) ? meta.campaigns : [];
  for (const campaign of campaigns){
    const label = firstNonEmptyText(
      campaign?.name,
      campaign?.badgeText,
      campaign?.title,
      'Kampagne / Angebot',
    );
    consumeRegular(label, campaign?.amount);
  }

  const adjustments = Array.isArray(o?.adjustments) ? o.adjustments : [];
  for (const adjustment of adjustments){
    const type = String(adjustment?.type || '').toLowerCase();
    if (type && type !== 'discount') continue;

    const code = firstNonEmptyText(adjustment?.code, adjustment?.couponCode);
    const reason = firstNonEmptyText(
      adjustment?.campaignName,
      adjustment?.campaignTitle,
      adjustment?.campaign,
      adjustment?.reason,
      adjustment?.source,
    );
    const label = code
      ? `Rabatt (${code})${reason ? ` - ${reason}` : ''}`
      : reason || 'Rabatt / Angebot';
    consumeRegular(
      label,
      adjustment?.amount ?? adjustment?.value ?? adjustment?.price ?? adjustment?.total,
    );
  }

  const campaignLabel = firstNonEmptyText(
    meta?.campaignName,
    meta?.campaignTitle,
    meta?.campaign,
    meta?.discountReason,
    meta?.discountLabel,
    pricing?.campaignName,
    pricing?.campaignTitle,
    pricing?.campaign,
    pricing?.discountReason,
    pricing?.discountLabel,
    fees?.discountReason,
    fees?.discountLabel,
  );
  if (campaignLabel) consumeRegular(campaignLabel, regularRemaining);
  if (regularRemaining > 0.009) consumeRegular('Rabatt / Angebot', regularRemaining);

  if (amounts.couponDiscount > 0){
    const couponMeta = meta?.couponMeta && typeof meta.couponMeta === 'object' ? meta.couponMeta : {};
    const couponLifecycle = meta?.couponLifecycle && typeof meta.couponLifecycle === 'object' ? meta.couponLifecycle : {};
    const code = firstNonEmptyText(
      o?.coupon,
      meta?.coupon,
      couponMeta?.code,
      couponMeta?.couponCode,
      couponLifecycle?.code,
      couponLifecycle?.couponCode,
    );
    const title = firstNonEmptyText(
      couponMeta?.title,
      couponMeta?.name,
      couponLifecycle?.title,
      couponLifecycle?.name,
      meta?.couponTitle,
      pricing?.couponTitle,
    );
    const label = code
      ? `Gutschein ${code}${title ? ` - ${title}` : ''}`
      : `Gutschein${title ? ` - ${title}` : ''}`;
    addRow(label, amounts.couponDiscount);
  }

  return rows;
}

/* ====== ücret tespit: derin & etiket bazlı ====== */
function findDeliveryFeeDeep(order){
  const P = order?.pricing || {};
  const F = order?.fees || {};
  const direct =
    [ P.delivery, P.deliveryFee, P.deliverySurcharge, P.surcharges, P.surcharge,
      P.shipping, P.ship, P.delivery_cost, P.zoneFee,
      F.delivery, F.deliveryFee, F.deliverySurcharge, F.surcharges, F.surcharge, F.shipping
    ].map(num).find(x => x > 0) || 0;
  if (direct > 0) return direct;

  const rxKey = /(liefer|lieferung|liefergeb|lieferaufschlag|zustell|versand|shipping|delivery|surcharge|aufschlag|zone)/i;

  let found = 0;
  const buckets = [
    order?.totals, order?.summary, order?.surcharges,
    P?.totals, P?.summary, P?.breakdown, P?.surcharges,
    F?.totals, F?.summary, F?.surcharges
  ].filter(Array.isArray);

  for (const arr of buckets){
    for (const row of arr){
      const label = String(row?.label || row?.title || row?.name || '').toLowerCase();
      if (rxKey.test(label)) {
        const val = num(row?.amount ?? row?.value ?? row?.price ?? row?.total);
        if (val > 0) { found = val; break; }
      }
    }
    if (found > 0) break;
  }

  if (found > 0) return found;

  function walk(o){
    if (!o || typeof o !== 'object') return;
    for (const [k,v] of Object.entries(o)){
      if (v && typeof v === 'object'){ walk(v); continue; }
      if (rxKey.test(String(k))){ const n = num(v); if (n > 0) { found = n; return; } }
    }
  }
  walk(order);
  return found || 0;
}

/* ====== Barkod fişi için KDV yardımcıları ====== */
function euros(v, inCents=false){
  if (inCents){
    if (typeof v === 'number') return v/100;
    const n = parseInt(String(v).replace(/\D+/g,''),10);
    return Number.isFinite(n) ? n/100 : 0;
  }
  return num(v);
}
function round2(x){ return Math.round((x + Number.EPSILON) * 100) / 100; }

function itemExtrasUnitTotal(item){
  return round2(
    (Array.isArray(item?.add) ? item.add : []).reduce(
      (sum, extra) => sum + Math.max(0, num(extra?.price)),
      0,
    ),
  );
}

function resolveReceiptItemPricing(order, items, merchandiseHint=0){
  const baseItemsSum = round2(
    items.reduce(
      (sum, item) => sum + num(item?.price) * Math.max(1, num(item?.qty || 1)),
      0,
    ),
  );
  const itemsWithExtrasSum = round2(
    items.reduce(
      (sum, item) =>
        sum +
        (num(item?.price) + itemExtrasUnitTotal(item)) *
          Math.max(1, num(item?.qty || 1)),
      0,
    ),
  );

  const extrasDifference = Math.abs(itemsWithExtrasSum - baseItemsSum);
  if (extrasDifference <= 0.009) {
    return {
      pricesIncludeExtras: true,
      subtotal: baseItemsSum,
    };
  }

  const target = round2(num(merchandiseHint));
  if (target > 0) {
    const baseDistance = Math.abs(baseItemsSum - target);
    const withExtrasDistance = Math.abs(itemsWithExtrasSum - target);

    if (withExtrasDistance + 0.009 < baseDistance) {
      return {
        pricesIncludeExtras: false,
        subtotal: itemsWithExtrasSum,
      };
    }

    if (baseDistance + 0.009 < withExtrasDistance) {
      return {
        pricesIncludeExtras: true,
        subtotal: baseItemsSum,
      };
    }
  }

  const mode = String(order?.mode || '').toLowerCase();
  const channel = String(order?.channel || '').toLowerCase();
  const metaSource = String(order?.meta?.source || '').toLowerCase();
  const pricesIncludeExtras = !(
    mode === 'dine_in' ||
    channel === 'schnellbestellung' ||
    metaSource === 'qr_quick_order'
  );

  return {
    pricesIncludeExtras,
    subtotal: pricesIncludeExtras ? baseItemsSum : itemsWithExtrasSum,
  };
}

function receiptItemUnitPrice(item, pricingMode){
  const basePrice = num(item?.price);
  return round2(
    basePrice +
      (pricingMode?.pricesIncludeExtras ? 0 : itemExtrasUnitTotal(item)),
  );
}

function proRataSplit(amount, partA, partB){
  const total = partA + partB;
  if (total <= 0) return [0,0];
  return [round2(amount * (partA/total)), round2(amount * (partB/total))];
}
function calcVatBlocks({br7, br19, delivery=0, discount=0}){
  if (delivery>0){
    const [d7,d19] = proRataSplit(delivery, br7, br19);
    br7 += d7; br19 += d19;
  }
  if (discount>0){
    const [k7,k19] = proRataSplit(discount, br7, br19);
    br7 = Math.max(0, br7 - k7);
    br19 = Math.max(0, br19 - k19);
  }
  const net19 = round2(br19 / 1.19);
  const vat19 = round2(br19 - net19);
  const net7  = round2(br7 / 1.07);
  const vat7  = round2(br7 - net7);
  const total = round2(br7 + br19);
  return { net19, vat19, net7, vat7, total };
}

/* ====== BMP → ESC/POS raster (brighten + gamma + auto-invert + scale + FS dithering + AUTO-CROP) ====== */
function bmpToEscPosRaster(buf, opts={}){
  const threshold  = Number(opts.threshold ?? LOGO_THRESHOLD);
  const maxWidth   = Number(opts.maxWidth ?? LOGO_MAX_WIDTH);
  const autoInvert = opts.autoInvert !== false;
  const brighten   = Number(opts.brighten ?? LOGO_BRIGHTEN);
  const gamma      = Number(opts.gamma ?? LOGO_GAMMA);
  const useDither  = opts.dither ?? LOGO_DITHER;
  const blackBoost = Math.max(0, Math.min(0.5, Number(opts.blackBoost ?? LOGO_BLACK_BOOST)));
  const doAutoCrop = (opts.autoCrop ?? LOGO_AUTOCROP) ? true : false;
  const cropPad    = Math.max(0, Number(opts.cropPad ?? LOGO_CROP_PAD));

  if (buf.readUInt16LE(0) !== 0x4D42) throw new Error('BMP değil');
  const dataOffset = buf.readUInt32LE(10);
  const headerSize = buf.readUInt32LE(14);
  const w = buf.readInt32LE(18);
  const hSigned = buf.readInt32LE(22);
  const planes = buf.readUInt16LE(26);
  const bpp = buf.readUInt16LE(28);
  const comp = buf.readUInt32LE(30);
  if (planes !== 1 || comp !== 0) throw new Error('Desteklenmeyen BMP');

  const absH = Math.abs(hSigned);
  const bottomUp = hSigned > 0;

  // Palet (8bpp)
  let palette = null;
  if (bpp === 8){
    const colors = (dataOffset - 14 - headerSize) / 4;
    palette = [];
    for (let i=0;i<colors;i++){
      const b = buf[14+headerSize + i*4 + 0];
      const g = buf[14+headerSize + i*4 + 1];
      const r = buf[14+headerSize + i*4 + 2];
      palette.push([r,g,b]);
    }
  } else if (!(bpp===1 || bpp===24)) {
    throw new Error('1/8/24 bpp BMP desteklenir');
  }

  const rowSize = Math.floor((bpp * w + 31)/32)*4;

  // Ölçek
  const scale = Math.max(1, Math.floor(w / Math.max(1, maxWidth)));
  const outW0 = Math.max(1, Math.floor(w / scale));
  const outH0 = Math.max(1, Math.floor(absH / scale));

  // Luma helper
  function L(r,g,b){
    let rr=r/255, gg=g/255, bb=b/255;
    rr = Math.pow(rr, 1/gamma);
    gg = Math.pow(gg, 1/gamma);
    bb = Math.pow(bb, 1/gamma);
    let y = (0.2126*rr + 0.7152*gg + 0.0722*bb) * 255 * brighten;
    if (y>255) y=255; if (y<0) y=0;
    return y;
  }

  // Ortalama aydınlık → invert?
  let sampleSum = 0, sampleCnt = 0;
  const takeEvery = Math.max(1, Math.floor((w*absH) / 20000));
  for (let row=0; row<absH; row+=takeEvery){
    const srcRow = bottomUp ? (absH-1-row) : row;
    const rowStart = dataOffset + srcRow*rowSize;
    for (let x=0; x<w; x+=takeEvery){
      let r,g,b;
      if (bpp===24){ const idx=rowStart+x*3; b=buf[idx]; g=buf[idx+1]; r=buf[idx+2]; }
      else if (bpp===8){ const idx=rowStart+x; [r,g,b]=(palette[ buf[idx] ]||[255,255,255]); }
      else {
        const byte=buf[rowStart+(x>>3)], bit=7-(x&7), val=(byte>>bit)&1;
        const pal = palette && palette[val];
        if (pal) [r,g,b] = pal;
        else r=g=b= val ? 255 : 0;
      }
      sampleSum += L(r,g,b); sampleCnt++;
    }
  }
  const avgLuma = sampleCnt ? (sampleSum/sampleCnt) : 255;
  const invert = autoInvert && avgLuma < 110;

  // Gri buffer (downscale)
  const gray0 = new Float32Array(outW0*outH0);
  for (let oy=0; oy<outH0; oy++){
    const sy0 = oy*scale;
    const srcRow = bottomUp ? (absH-1 - sy0) : sy0;
    const rowStart = dataOffset + srcRow*rowSize;
    for (let ox=0; ox<outW0; ox++){
      const sx0 = ox*scale;
      let r,g,b;
      if (bpp===24){ const idx=rowStart+sx0*3; b=buf[idx]; g=buf[idx+1]; r=buf[idx+2]; }
      else if (bpp===8){ const idx=rowStart+sx0; [r,g,b]=(palette[ buf[idx] ]||[255,255,255]); }
      else {
        const byte=buf[rowStart+(sx0>>3)], bit=7-(sx0&7), val=(byte>>bit)&1;
        const pal = palette && palette[val];
        if (pal) [r,g,b] = pal;
        else r=g=b= val ? 255 : 0;
      }
      let y = L(r,g,b);
      if (invert) y = 255 - y;
      // Siyah önyargı: sadece zaten koyu/gri piksellere uygula.
      // Saf beyaza uygularsak logo etrafında gri/siyah kare oluşur.
      if (y < 245 && blackBoost > 0) y = Math.max(0, y - 255*blackBoost);
      gray0[oy*outW0 + ox] = y;
    }
  }

  // ==== OTO-CROP: dış açık alanları kırp ====
  let minX=outW0, minY=outH0, maxX=-1, maxY=-1;
  const inkThr = Math.max(0, threshold - 20);
  if (LOGO_AUTOCROP || doAutoCrop){
    for (let y=0; y<outH0; y++){
      for (let x=0; x<outW0; x++){
        const v = gray0[y*outW0 + x];
        if (v < inkThr){
          if (x<minX) minX=x; if (x>maxX) maxX=x;
          if (y<minY) minY=y; if (y>maxY) maxY=y;
        }
      }
    }
    if (maxX<0 || maxY<0){ minX=0; minY=0; maxX=outW0-1; maxY=outH0-1; }
  }else{
    minX=0; minY=0; maxX=outW0-1; maxY=outH0-1;
  }
  minX = Math.max(0, minX - cropPad);
  minY = Math.max(0, minY - cropPad);
  maxX = Math.min(outW0-1, maxX + cropPad);
  maxY = Math.min(outH0-1, maxY + cropPad);

  const outW = Math.max(1, maxX - minX + 1);
  const outH = Math.max(1, maxY - minY + 1);

  // Dithering (Floyd–Steinberg) → 1-bit
  const bytesPerRow = Math.ceil(outW/8);
  const xL = bytesPerRow & 0xFF, xH = (bytesPerRow>>8)&0xFF;
  const yL = outH & 0xFF, yH = (outH>>8)&0xFF;
  const out = [ Buffer.from([GS,0x76,0x30,0x00, xL,xH, yL,yH]) ];

  const gray = new Float32Array(outW*outH);
  for (let y=0; y<outH; y++){
    for (let x=0; x<outW; x++){
      gray[y*outW + x] = gray0[(y+minY)*outW0 + (x+minX)];
    }
  }

  for (let y=0; y<outH; y++){
    const rowBuf = Buffer.alloc(bytesPerRow,0);
    for (let x=0; x<outW; x++){
      const i = y*outW + x;
      const old = gray[i];
      const newVal = (old < threshold) ? 0 : 255;
      const err = old - newVal;
      if (useDither){
        if (x+1<outW) gray[i+1]         += err*7/16;
        if (y+1<outH){
          if (x>0)      gray[i+outW-1] += err*3/16;
          gray[i+outW]  += err*5/16;
          if (x+1<outW) gray[i+outW+1] += err*1/16;
        }
      }
      if (newVal===0) rowBuf[x>>3] |= (0x80 >> (x&7));
    }
    out.push(rowBuf);
  }

  return Buffer.concat(out);
}

function loadLocalLogoBuffer(){
  const candidates = [
    process.env.LOGO_FILE ? path.resolve(__dirname, process.env.LOGO_FILE) : null,
    DEFAULT_LOGO_FILE,
    path.join(process.cwd(), 'print-proxy', 'logo-thermal.bmp'),
    path.join(process.cwd(), 'logo-thermal.bmp'),
  ].filter(Boolean);
  for (const file of candidates){
    try{ if (fs.existsSync(file)) return fs.readFileSync(file); }catch{}
  }
  return null;
}

async function printLogoIfAny(overrideUrl){
  try{
    // Agent URL gönderse bile önce local logo-thermal.bmp kullanılır.
    // Böylece gerçek domain açılmadan da logo basılır.
    let buf = loadLocalLogoBuffer();

    if (!buf && overrideUrl && /^https?:\/\//i.test(String(overrideUrl))) {
      buf = await httpGetBuffer(String(overrideUrl));
    }

    if (!buf && LOGO_URL) buf = await httpGetBuffer(LOGO_URL);
    if (!buf) return Buffer.alloc(0);
    if (buf.length > 20*1024*1024) throw new Error('Logo çok büyük');
    const raster = bmpToEscPosRaster(buf, {
      threshold: LOGO_THRESHOLD,
      maxWidth: LOGO_MAX_WIDTH,
      autoInvert: true,
      brighten: LOGO_BRIGHTEN,
      gamma: LOGO_GAMMA,
      dither: LOGO_DITHER,
      blackBoost: LOGO_BLACK_BOOST,
      autoCrop: LOGO_AUTOCROP,
      cropPad: LOGO_CROP_PAD,
    });
    return Buffer.concat([ align(1), raster, align(0) ]);
  }catch(e){
    console.warn('Logo basılamadı:', e.message || e);
    return Buffer.alloc(0);
  }
}


/* ====== Schnellbestellung: ayrı kasa + mutfak fişi ====== */
function isSchnellOrder(o={}){
  const mode = String(o?.mode || '').trim().toLowerCase();
  const channel = String(o?.channel || '').trim().toLowerCase();
  const source = String(o?.meta?.source || '').trim().toLowerCase();
  return channel === 'schnellbestellung' || source === 'qr_quick_order';
}

function moneyDe(v){
  return `${num(v).toFixed(2).replace('.', ',')} €`;
}

function signedMoneyDe(v){
  const value = round2(num(v));
  return `${value > 0 ? '+' : ''}${moneyDe(value)}`;
}

function upperReceipt(value=''){
  // CP858/CP857 büyük ẞ karakterini desteklemez; okunabilir SOßEN biçimi korunur.
  return String(value || '').toLocaleUpperCase('de-DE').replace(/ẞ/g, 'ß');
}

function receiptDateParts(value){
  const date = new Date(value || Date.now());
  const safe = Number.isFinite(date.valueOf()) ? date : new Date();
  const format = (options) => new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Europe/Berlin',
    ...options,
  }).format(safe);

  return {
    weekday: format({ weekday: 'long' }),
    date: format({ day: '2-digit', month: '2-digit', year: 'numeric' }),
    time: format({ hour: '2-digit', minute: '2-digit', hour12: false }),
  };
}

function formatSchnellNumber(value){
  const number = Math.max(0, Math.floor(num(value)));
  return String(number).padStart(4, '0');
}

function isLunchSideExtra(extra={}){
  const id = String(extra?.id || '').toLowerCase();
  const kind = String(extra?.kind || '').toLowerCase();
  return kind === 'side_upgrade' || id.startsWith('lunch-side:');
}

function isIncludedLunchSide(extra={}){
  if (!isLunchSideExtra(extra)) return false;
  const label = String(extra?.label || extra?.name || '').toLowerCase();
  return num(extra?.price) <= 0.009 || /\binklusive\b/.test(label);
}

function cleanLunchSideLabel(extra={}){
  return String(extra?.label || extra?.name || '')
    .replace(/\s*\(\s*\+?\s*[-+]?\d+(?:[.,]\d+)?\s*€?\s*\)\s*$/i, '')
    .trim();
}

function isBlackAngusItem(item={}){
  const value = `${item?.name || ''} ${item?.sku || ''}`.toLowerCase();
  return /\bblack\s*angus\b|\bangus\b/.test(value);
}

const SCHNELL_DONENESS_LABELS = {
  light: 'Leicht gebraten',
  normal: 'Normal gebraten',
  well_done: 'Durchgebraten',
};

function noteLines(value=''){
  return String(value || '')
    .split(/[\r\n;]+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function isDonenessLine(value=''){
  return /\b(?:leicht|normal)\s+gebraten\b|\bdurchgebraten\b/i.test(String(value || ''));
}

function receiptDonenessLabel(item={}){
  if (!isBlackAngusItem(item)) return '';

  const value = item?.doneness;
  const objectValue = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const code = String(
    objectValue?.code ?? (typeof value === 'string' ? value : ''),
  ).trim().toLowerCase();
  const label = String(objectValue?.label || SCHNELL_DONENESS_LABELS[code] || '').trim();
  if (label) return label;

  return noteLines(item?.note).find(isDonenessLine) || '';
}

function schnellPaymentLabel(method=''){
  const value = String(method || '').trim().toLowerCase();
  if (/paypal/.test(value)) return 'PAYPAL';
  if (/stripe|card|karte|online|apple|google/.test(value)) return 'ONLINE';
  return 'BAR';
}

function vatTableRow(rate, net, tax, gross){
  return String(rate).padEnd(6) +
    moneyDe(net).padStart(12) +
    moneyDe(tax).padStart(12) +
    moneyDe(gross).padStart(12);
}

function vatTableHeader(){
  return 'MwSt.'.padEnd(6) +
    'Netto'.padStart(12) +
    'Steuer'.padStart(12) +
    'Brutto'.padStart(12);
}

function pushSchnellPricedLine(out, label, amount, options={}){
  const left = String(label || '');
  const right = String(amount || '');
  const maxLeft = Math.max(8, LINE - right.length - 1);
  const lines = wrapLines('', left, maxLeft);

  if (!lines.length){
    out.push(text(twoCol('', right)));
    return;
  }

  lines.forEach((line, index) => {
    out.push(text(index === lines.length - 1 ? twoCol(line, right) : line));
  });
}

function resolveSchnellReceiptContext(o={}){
  const items = Array.isArray(o?.items) ? o.items : [];
  const P = o?.pricing || {};
  const F = o?.fees || {};
  const M = o?.meta || {};
  const PAY = o?.payment || M?.payment || {};

  const merchandiseValue = num(o?.merchandise);
  const pricingSubtotalValue = num(P.subtotal);
  const subtotalHint = merchandiseValue > 0 ? merchandiseValue : pricingSubtotalValue;
  const receiptItemPricing = resolveReceiptItemPricing(o, items, subtotalHint);
  const itemsSum = receiptItemPricing.subtotal;
  const subtotal = merchandiseValue > 0
    ? merchandiseValue
    : pricingSubtotalValue > 0
      ? pricingSubtotalValue
      : itemsSum;

  const deliveryFee = findDeliveryFeeDeep(o);
  const serviceFee = num(PAY.serviceFeeTotal ?? P.service ?? F.service);
  const otherFee = num(P.other ?? P.misc ?? F.other);

  const rewardMeta = M?.reward && typeof M.reward === 'object' ? M.reward : {};
  const rewardDiscount = Math.max(0, num(rewardMeta?.discountAmount));
  let regularDiscount = Math.max(0, num(o?.discount ?? P.regularDiscount ?? F.discount));
  regularDiscount = Math.max(0, regularDiscount - rewardDiscount);
  const couponDiscount = Math.max(0, num(o?.couponDiscount ?? P.couponDiscount ?? M?.couponDiscount));
  let discountSum = regularDiscount + couponDiscount + rewardDiscount;

  let explicitTotal = num(
    PAY.collectedTotal ?? PAY.payableTotal ?? P.total ?? o?.total ?? o?.amount ?? o?.payable ?? o?.toPay,
  );
  if (explicitTotal <= 0) {
    explicitTotal = Math.max(0, subtotal + deliveryFee + serviceFee + otherFee - discountSum);
  }

  const derivedDiscount = Math.max(0, subtotal + deliveryFee + serviceFee + otherFee - explicitTotal);
  if (discountSum <= 0 && derivedDiscount > 0) {
    regularDiscount = derivedDiscount;
    discountSum = derivedDiscount;
  }

  let br7 = 0;
  let br19 = 0;
  for (const item of items){
    const qty = Math.max(1, num(item?.qty || 1));
    const gross = receiptItemUnitPrice(item, receiptItemPricing) * qty;
    const rate = Number(item?.taxRate);
    if (rate === 7) br7 += gross;
    else if (rate === 19) br19 += gross;
    else if (ALLOW_LEGACY_TAX_FALLBACK) {
      if (detectCategory(item) === 'Getränke') br19 += gross;
      else br7 += gross;
    } else {
      const error = new Error('tax_rate_missing');
      error.statusCode = 422;
      error.publicCode = 'tax_rate_missing';
      throw error;
    }
  }

  const vat = calcVatBlocks({
    br7,
    br19,
    delivery: deliveryFee,
    discount: discountSum,
  });

  return {
    items,
    meta: M,
    receiptItemPricing,
    subtotal,
    deliveryFee,
    serviceFee,
    otherFee,
    regularDiscount,
    couponDiscount,
    rewardDiscount,
    explicitTotal: roundFinalTotal(explicitTotal),
    vat,
    customerNumber: Number(o?.customerNumber ?? M?.customerNumber ?? 0),
    isTakeaway: M?.takeaway === true || String(M?.fulfillment || '').toLowerCase() === 'takeaway',
    paymentMethod: o?.paymentMethod ?? PAY?.method ?? M?.paymentMethod ?? 'cash',
    when: receiptDateParts(o?.ts || o?.createdAt || Date.now()),
  };
}

function schnellCashBaseUnitPrice(item={}){
  const originalPrice = num(item?.originalPrice);
  const price = num(item?.price);
  return originalPrice > price ? originalPrice : price;
}

function pushSchnellCashItem(out, item){
  const qty = Math.max(1, num(item?.qty || 1));
  const baseLine = schnellCashBaseUnitPrice(item) * qty;
  const itemName = cleanName(String(item?.name || 'Artikel'));
  const itemPrice = item?.complimentaryTableSauce === true ? 'Kostenlos' : moneyDe(baseLine);
  out.push(bold(1));
  pushSchnellPricedLine(out, `${qty}x ${itemName}`, itemPrice);
  out.push(bold(0));

  const doneness = receiptDonenessLabel(item);
  if (doneness) pushWrapped(out, '   ', doneness, { max: LINE });

  for (const extra of Array.isArray(item?.add) ? item.add : []){
    if (isIncludedLunchSide(extra)) continue;
    const rawName = isLunchSideExtra(extra)
      ? cleanLunchSideLabel(extra)
      : cleanName(extra?.label || extra?.name || 'Extra');
    if (!rawName) continue;
    const amount = Math.max(0, num(extra?.price)) * qty;
    const amountText = amount > 0.009 ? moneyDe(amount) : 'Kostenlos';
    pushSchnellPricedLine(out, `   + ${rawName}`, amountText);
  }

  for (const removed of Array.isArray(item?.rm) ? item.rm : []){
    const value = String(removed || '').trim();
    if (value) pushWrapped(out, '   Ohne ', value, { max: LINE });
  }

  for (const line of noteLines(item?.note)){
    if (isDonenessLine(line)) continue;
    pushWrapped(out, '   ', line, { max: LINE });
  }
  out.push(text(''));
}

async function buildSchnellCashReceipt(o, opts={}){
  const ctx = resolveSchnellReceiptContext(o);
  const out = [init(), selectCodepage(), fontA(), lineSpace(30)];
  const logoChunk = await printLogoIfAny(opts.logoUrl);
  if (logoChunk.length) out.push(logoChunk);
  else out.push(align(1), size(2,2), text(opts.brand || 'Burger Brothers'), size(1,1), align(0));

  out.push(align(1));
  for (const rawLine of STORE_HEADER_LINES){
    const line = String(rawLine || '').replace(/^St\.?\s*-?\s*Nr\.?\s*:/i, 'St.-Nr.:');
    out.push(text(line));
  }
  out.push(align(0), text('-'.repeat(LINE)));

  const dateLeft = `${ctx.when.weekday}, ${ctx.when.date} ${ctx.when.time}`;
  const numberRight = ctx.customerNumber > 0 ? `Nr. ${formatSchnellNumber(ctx.customerNumber)}` : '';
  out.push(text(twoCol(dateLeft, numberRight)));
  out.push(text('-'.repeat(LINE)), text(''));

  for (const item of ctx.items) pushSchnellCashItem(out, item);

  out.push(text('-'.repeat(LINE)));
  out.push(text(twoCol('Zwischensumme', moneyDe(ctx.subtotal))));
  if (ctx.deliveryFee > 0) out.push(text(twoCol('Lieferaufschläge', moneyDe(ctx.deliveryFee))));
  if (ctx.serviceFee > 0) out.push(text(twoCol('Service', moneyDe(ctx.serviceFee))));
  if (ctx.otherFee > 0) out.push(text(twoCol('Sonstiges', moneyDe(ctx.otherFee))));
  if (ctx.regularDiscount > 0) out.push(text(twoCol('Rabatt', '-' + moneyDe(ctx.regularDiscount))));
  if (ctx.couponDiscount > 0){
    const code = firstNonEmptyText(o?.coupon, ctx.meta?.coupon);
    out.push(text(twoCol(code ? `Gutschein ${code}` : 'Gutschein', '-' + moneyDe(ctx.couponDiscount))));
  }
  if (ctx.rewardDiscount > 0) out.push(text(twoCol('Geschenk', '-' + moneyDe(ctx.rewardDiscount))));
  out.push(text('-'.repeat(LINE)));
  out.push(bold(1), size(1,2), text(twoCol('GESAMT', moneyDe(ctx.explicitTotal))), size(1,1), bold(0));
  out.push(text('='.repeat(LINE)));
  out.push(text(twoCol(`Zahlungsart: ${schnellPaymentLabel(ctx.paymentMethod)}`, moneyDe(ctx.explicitTotal))));
  out.push(text('-'.repeat(LINE)));

  out.push(text(vatTableHeader()));
  out.push(text(vatTableRow('7 %', ctx.vat.net7, ctx.vat.vat7, ctx.vat.net7 + ctx.vat.vat7)));
  out.push(text(vatTableRow('19 %', ctx.vat.net19, ctx.vat.vat19, ctx.vat.net19 + ctx.vat.vat19)));
  out.push(text('-'.repeat(LINE)), text(''));

  out.push(align(1), text('Vielen Dank für Ihre Bestellung!'), align(0));
  out.push(lineSpaceDefault(), feedLines(CUT_FEED_LINES), cut());
  return Buffer.concat(out);
}

function kitchenGroupOrder(keys){
  const preferred = [
    'Mittagsmenü',
    'Burger',
    'Vegan / Vegetarisch',
    'Hotdogs',
    'Extras',
    'Getränke',
    'Soßen',
  ];
  return [
    ...preferred.filter((key) => keys.includes(key)),
    ...keys.filter((key) => !preferred.includes(key)).sort(),
  ];
}

function pushSchnellKitchenWrapped(out, prefix, value, options={}){
  const lines = wrapLines(prefix, value, options.max || LINE);
  for (const line of lines){
    out.push(
      options.boldText ? bold(1) : bold(0),
      text(line),
      bold(0),
    );
  }
}

function pushSchnellKitchenPricedLine(out, label, amount, options={}){
  const emphasize = options.emphasize === true;
  if (emphasize) {
    out.push(lineSpace(52), size(1,2), bold(1), doubleStrike(1));
  } else if (options.boldText) {
    out.push(bold(1), doubleStrike(1));
  }

  pushSchnellPricedLine(out, label, amount);

  if (emphasize) {
    out.push(doubleStrike(0), bold(0), size(1,1), lineSpace(36));
  } else if (options.boldText) {
    out.push(doubleStrike(0), bold(0));
  }
}

function pushSchnellKitchenItem(out, item, ctx){
  const qty = Math.max(1, num(item?.qty || 1));
  const lineTotal = receiptItemUnitPrice(item, ctx.receiptItemPricing) * qty;
  const itemName = upperReceipt(cleanName(String(item?.name || 'Artikel')));
  const priceText = item?.complimentaryTableSauce === true ? 'KOSTENLOS' : moneyDe(lineTotal);
  pushSchnellKitchenPricedLine(
    out,
    `${qty}x ${itemName}`,
    priceText,
    { boldText:true, emphasize:true },
  );

  const doneness = receiptDonenessLabel(item);
  if (doneness){
    pushSchnellKitchenWrapped(out, '   ', upperReceipt(doneness), { boldText:true });
  }

  for (const extra of Array.isArray(item?.add) ? item.add : []){
    if (isIncludedLunchSide(extra)) continue;
    if (isLunchSideExtra(extra)){
      const label = upperReceipt(cleanLunchSideLabel(extra));
      const amount = Math.max(0, num(extra?.price)) * qty;
      if (!label) continue;
      if (amount > 0.009) {
        pushSchnellKitchenPricedLine(out, `   + ${label}`, signedMoneyDe(amount));
      } else {
        pushSchnellKitchenWrapped(out, '   + ', label);
      }
      continue;
    }

    const extraName = upperReceipt(cleanName(extra?.label || extra?.name || 'Extra'));
    if (extraName) pushSchnellKitchenWrapped(out, '   + ', extraName);
  }

  for (const removed of Array.isArray(item?.rm) ? item.rm : []){
    const value = upperReceipt(String(removed || '').trim());
    if (value) pushSchnellKitchenWrapped(out, '   OHNE ', value, { boldText:true });
  }

  for (const rawLine of noteLines(item?.note)){
    if (isDonenessLine(rawLine)) continue;
    const line = upperReceipt(rawLine);
    if (line) pushSchnellKitchenWrapped(out, '   ', line, { boldText:/^OHNE\b/.test(line) });
  }
  out.push(text(''));
}

function buildSchnellKitchenTicket(o){
  const ctx = resolveSchnellReceiptContext(o);
  // Gerçek ESC/POS metin Font A (ESC M 0) kullanılır. Eski fontA()
  // yardımcısı barkod HRI fontunu seçiyordu ve metni değiştirmiyordu.
  // 1x2 dikey büyütme kaldırıldığı için harfler artık sıkışmaz/üst üste binmez.
  const out = [
    init(),
    selectCodepage(),
    fontSel(0),
    size(1,1),
    lineSpace(36),
  ];
  out.push(text(twoCol(ctx.when.date, ctx.when.time)));
  out.push(bold(1), text('SCHNELLBESTELLUNG'), bold(0), text(''));

  const grouped = new Map();
  for (const item of ctx.items){
    const group = detectCategory(item);
    if (!grouped.has(group)) grouped.set(group, []);
    grouped.get(group).push(item);
  }

  for (const group of kitchenGroupOrder([...grouped.keys()])){
    out.push(
      lineSpace(52),
      size(1,2),
      bold(1),
      doubleStrike(1),
      underline(1),
      text(upperReceipt(group)),
      underline(0),
      doubleStrike(0),
      bold(0),
      size(1,1),
      lineSpace(36),
      text(''),
    );
    for (const item of grouped.get(group)) pushSchnellKitchenItem(out, item, ctx);
  }

  if (ctx.customerNumber > 0){
    out.push(align(1), bold(1), size(3,3), text(String(ctx.customerNumber)), size(1,1));
    if (ctx.isTakeaway) out.push(size(2,2), text('ZUM MITNEHMEN'), size(1,1));
    out.push(bold(0), align(0));
  }

  out.push(fontSel(0), size(1,1), lineSpaceDefault(), feedLines(CUT_FEED_LINES), cut());
  return Buffer.concat(out);
}

async function buildPrintPayload(o, opts={}){
  if (!isSchnellOrder(o)) return buildTicketFromOrder(o, opts);
  const cashReceipt = await buildSchnellCashReceipt(o, opts);
  const kitchenTicket = buildSchnellKitchenTicket(o);
  return Buffer.concat([cashReceipt, kitchenTicket]);
}

/* ====== Fiş (tam) ====== */
async function buildTicketFromOrder(o, opts={}){
  const brand = opts.brand || 'Burger Brothers';

  function titleCase(s=''){
    return String(s).trim().replace(/\s+/g,' ').toLowerCase().replace(/\b\w/g, m=>m.toUpperCase());
  }
  function isPlanned(o){
    if (o?.planned) return true;
    if (o?.isPlanned) return !!o.isPlanned;
    if (o?.targetAt || o?.dueAt) return true;
    const lbl = String(o?.plannedLabel||'').trim();
    return !!lbl;
  }
  const baseLabel = (() => {
    const m = String(o?.mode||'').toLowerCase();
    if (m==='delivery') return 'Lieferung';
    if (m==='pickup')   return 'Abholung';
    const ch = String(o?.channel || '').trim();
    return ch ? titleCase(ch) : 'Bestellung';
  })();
  const headerTag = [ isPlanned(o) ? 'Geplant' : '', baseLabel ].filter(Boolean).join(' ');
  const mode = String(o?.mode || '').toLowerCase();
  const channel = String(o?.channel || '').toLowerCase();
  const isDineIn = mode === 'dine_in' || channel === 'schnellbestellung';
  const isDelivery = mode === 'delivery';

  const when = new Date(o?.ts || o?.createdAt || Date.now());
  const headerTime = isDineIn ? fmtTime(when) : computeGeplant(o);
  const whenStr = `${String(when.getDate()).padStart(2,'0')}.${String(when.getMonth()+1).padStart(2,'0')}.${when.getFullYear()} ${String(when.getHours()).padStart(2,'0')}:${String(when.getMinutes()).padStart(2,'0')}`;
  const name  = String(o?.customer?.name || '').trim();
  const orderId = String(o?.id || '');

  const items = Array.isArray(o?.items) ? o.items : [];

  // Gruplama
  const map = new Map();
  for (const it of items){
    const g = detectCategory(it);
    if (!map.has(g)) map.set(g, []);
    map.get(g).push(it);
  }
  const ORDER = ['Burger','Vegan / Vegetarisch','Mittagsmenü','Hotdogs','Extras','Getränke','Soßen'];
  const orderedKeys = []; for (const k of ORDER) if (map.has(k)) orderedKeys.push(k);
  const others = [...map.keys()].filter(k=>!ORDER.includes(k)).sort();
  const keys = [...orderedKeys, ...others];

  // Pricing
  const P = o?.pricing || {};
  const F = o?.fees || {};
  const M = o?.meta || {};
  const PAY = o?.payment || M?.payment || {};
  const merchandiseValue = num(o?.merchandise);
  const pricingSubtotalValue = num(P.subtotal);
  const subtotalHint =
    merchandiseValue > 0 ? merchandiseValue : pricingSubtotalValue;
  const receiptItemPricing = resolveReceiptItemPricing(
    o,
    items,
    subtotalHint,
  );
  const itemsSum = receiptItemPricing.subtotal;
  const subtotal =
    merchandiseValue > 0
      ? merchandiseValue
      : pricingSubtotalValue > 0
        ? pricingSubtotalValue
        : itemsSum;
  const deliveryFee = findDeliveryFeeDeep(o);
  const serviceFee  = num(PAY.serviceFeeTotal ?? P.service ?? F.service);
  const otherFee    = num(P.other ?? P.misc ?? F.other);
  let explicitTotal = num(
    PAY.collectedTotal ??
      PAY.payableTotal ??
      P.total ??
      o.total ??
      o.amount ??
      o.payable ??
      o.toPay,
  );

  const rewardMeta = M?.reward && typeof M.reward === 'object' ? M.reward : {};
  const rewardDiscount = Math.max(0, num(rewardMeta?.discountAmount));
  let regularDiscount = Math.max(0, num(o?.discount ?? P.regularDiscount ?? F.discount));
  // The order discount already includes the Glücksgewinn. Split it out so the
  // receipt shows the real reward without counting the amount twice.
  regularDiscount = Math.max(0, regularDiscount - rewardDiscount);
  let couponDiscount  = Math.max(0, num(o?.couponDiscount ?? P.couponDiscount ?? o?.meta?.couponDiscount));
  let discountSum = regularDiscount + couponDiscount + rewardDiscount;

  if (explicitTotal <= 0) {
    explicitTotal = Math.max(0, subtotal + deliveryFee + serviceFee + otherFee - discountSum);
  }

  const derivedDiscount = Math.max(0, (subtotal + deliveryFee + serviceFee + otherFee) - explicitTotal);
  if (discountSum <= 0 && derivedDiscount > 0) {
    regularDiscount = derivedDiscount;
    discountSum = derivedDiscount;
  }

  // ===== KDV toplama =====
  let br7 = 0, br19 = 0;
  if (items.length){
    for (const it of items){
      const qty   = num(it?.qty||1);
      const gross = receiptItemUnitPrice(it, receiptItemPricing) * qty;
      const rate  = Number(it?.taxRate);
      if (rate === 7)  { br7  += gross; continue; }
      if (rate === 19) { br19 += gross; continue; }
      if (ALLOW_LEGACY_TAX_FALLBACK) {
        const cat = detectCategory(it);
        if (cat === 'Getränke') br19 += gross;
        else br7 += gross;
        continue;
      }
      const error = new Error('tax_rate_missing');
      error.statusCode = 422;
      error.publicCode = 'tax_rate_missing';
      throw error;
    }
  }
  if (o?.summary){
    br7  = br7  || num(o.summary.brutto7);
    br19 = br19 || num(o.summary.brutto19);
  }

  const { net19, vat19, net7, vat7 } =
    calcVatBlocks({ br7, br19, delivery: deliveryFee, discount: discountSum });

  const paymentMethod = String(
    PAY.method || o?.paymentMethod || M?.paymentMethod || 'cash',
  ).toLowerCase();
  const paymentStatus = String(
    PAY.status || o?.paymentStatus || M?.paymentStatus || 'pending',
  ).toLowerCase();
  const paymentShares = Array.isArray(PAY.shares) ? PAY.shares : [];
  const isSplitPayment = paymentMethod.includes('split') || paymentShares.length > 1;
  const sharePaidAmount = paymentShares.reduce((sum, share) => {
    const status = String(share?.status || '').toLowerCase();
    return status === 'paid'
      ? sum + num(share?.amount ?? (num(share?.baseAmount) + num(share?.serviceFee)))
      : sum;
  }, 0);
  const chargedTotal = num(PAY.collectedTotal ?? PAY.payableTotal ?? explicitTotal);
  const remainingPayment = Math.max(0, chargedTotal - sharePaidAmount);
  const paymentPaid = ['paid', 'succeeded', 'completed'].includes(paymentStatus);
  const onlinePayment = /online|stripe|card|karte|klarna|paypal|apple|google/.test(paymentMethod);

  const out=[];
  out.push(init(), selectCodepage(), fontA(), lineSpace(30));

  // ===== ÜST BLOK =====
  const isTakeaway = isDineIn && (M?.takeaway === true || String(M?.fulfillment || '').toLowerCase() === 'takeaway');
  const customerNumber = Number(o?.customerNumber ?? M?.customerNumber ?? 0);

  const logoChunk = await printLogoIfAny(opts.logoUrl);
  if (logoChunk.length) out.push(logoChunk);
  else out.push(align(1), size(2,2), text(brand), align(0));

  if (headerTag) {
    if (mode === 'delivery' || mode === 'pickup') {
      // Same strong visual weight as ONLINE BEZAHLT / BARZAHLUNG.
      out.push(align(1), bold(1), size(2,2), text(headerTag.toUpperCase()), size(1,1), bold(0), align(0));
    } else {
      out.push(align(1), size(2,1), text(headerTag), align(0));
    }
  }
  out.push(align(1), size(2,2), text(headerTime), size(1,1), align(0));

  out.push(align(1));
  for (const ln of STORE_HEADER_LINES) out.push(text(ln));
  if (FISCAL_OPERATION_MODE === 'external_certified_pos') {
    out.push(
      bold(1),
      text('KEIN STEUERBELEG'),
      text('Vorgang im Kassensystem erfassen'),
      bold(0),
    );
  } else if (FISCAL_OPERATION_MODE !== 'webshop_only') {
    out.push(
      bold(1),
      text('FISKALMODUS UNGEKLAERT'),
      text('KEIN STEUERBELEG'),
      bold(0),
    );
  }
  out.push(text(''), align(0));

  out.push(text(twoCol('Zeit', whenStr)));
  out.push(text('-'.repeat(LINE)));

  // ===== ÜRÜNLER =====
  for (const g of keys){
    out.push(bold(1), underline(1), size(1,2), text(g), size(1,1), underline(0), bold(0));
    for (const it of map.get(g)){
      const qty=num(it.qty||1);
      const line=qty*receiptItemUnitPrice(it, receiptItemPricing);
      const itemName = cleanName(String(it.name||''));
      const itemPriceText = it?.complimentaryTableSauce === true
        ? 'Kostenlos'
        : money(line);
      out.push(bold(1), size(1,1), text(twoCol(`${qty}x ${itemName}`, itemPriceText)), bold(0));
      if (Array.isArray(it.add) && it.add.length){
        for (const a of it.add){
          const extraName = cleanName(a?.label || a?.name || 'Extra');
          if (!extraName) continue;
          out.push(bold(1));
          pushWrapped(out, '   + ', extraName, { max: 54 });
          out.push(bold(0));
        }
      }

      if (Array.isArray(it.rm) && it.rm.length){
        for (const r of it.rm){
          const removeName = String(r || '').trim();
          if (removeName) pushWrapped(out, '   - ohne ', removeName, { max: 54 });
        }
      }

      const desc = String(it.description || it.desc || it.itemDescription || it?.meta?.description || '').trim();
      if (desc) {
        out.push(fontSel(1));
        pushWrapped(out, '     ', desc, { max: 56 });
        out.push(fontSel(0));
      }

      if (it.note){
        const note = String(it.note).trim();
        if (note) {
          out.push(fontSel(1), bold(1));
          pushWrapped(out, '     ', note, { max: 56 });
          out.push(bold(0), fontSel(0));
        }
      }

      // Mutfakta satırlar birbirine yapışmasın.
      out.push(text(''));
    }
  }

  // ===== TOPLAM + KDV ÖZETİ =====
  out.push(text('-'.repeat(LINE)));
  out.push(size(1,2), text(twoCol('Zwischensumme', money(subtotal))), size(1,1));
  if (deliveryFee) out.push(text(twoCol('Lieferaufschläge', money(deliveryFee))));
  if (serviceFee)  out.push(text(twoCol('Service',          money(serviceFee))));
  if (otherFee)    out.push(text(twoCol('Sonstiges',        money(otherFee))));
  const discountRows = buildReceiptDiscountRows(o, {
    regularDiscount,
    couponDiscount,
    rewardDiscount,
  });
  for (const row of discountRows){
    out.push(bold(1));
    const wrappedLabel = wrapLines('', row.label, 29);
    if (wrappedLabel.length <= 1){
      out.push(text(twoCol(wrappedLabel[0] || 'Rabatt / Angebot', '-' + money(row.amount))));
    } else {
      for (const labelLine of wrappedLabel) out.push(text(labelLine));
      out.push(text(twoCol('  Rabattbetrag', '-' + money(row.amount))));
    }
    out.push(bold(0));
  }

  // ===== KDV blokları — HER ZAMAN GÖRÜNSÜN =====
  out.push(text(''));
  out.push(text(twoCol('Netto MwSt 19 %', money(net19))));
  out.push(text(twoCol('MwSt 19 %',       money(vat19))));
  out.push(text(twoCol('Netto MwSt 7 %',  money(net7))));
  out.push(text(twoCol('MwSt 7 %',        money(vat7))));

  const finalTotal = roundFinalTotal(explicitTotal);
  // Rundung satırı mutfak fişinde gösterilmiyor; toplam yuvarlama mantığı korunuyor.
  out.push(bold(1), size(1,2), text(twoCol('Gesamt', money(finalTotal))), size(1,1), bold(0), text(''));

  // ===== ZAHLUNGSANWEISUNG (DIREKT VOR ADRESSE/BARKOD) =====
  out.push(text('='.repeat(LINE)), align(1), bold(1), size(2,2));
  if (isSplitPayment && paymentPaid) {
    out.push(text('GETRENNT BEZAHLT'), size(1,2), text('NICHTS KASSIEREN'));
  } else if (isSplitPayment) {
    out.push(
      text('GETRENNT ZAHLEN OFFEN'),
      size(1,2),
      text(`RESTBETRAG: ${money(remainingPayment || chargedTotal)}`),
    );
  } else if (onlinePayment && paymentPaid) {
    out.push(text('ONLINE BEZAHLT'), size(1,2), text('NICHTS KASSIEREN'));
  } else {
    out.push(
      text(isDineIn ? 'BAR OFFEN' : 'BARZAHLUNG'),
      size(1,2),
      text(`BETRAG KASSIEREN: ${money(finalTotal)}`),
    );
  }
  out.push(size(1,1), bold(0), align(0), text('='.repeat(LINE)), text(''));

  // Schnellbestellung number and fulfillment now sit directly below BAR OFFEN.
  // Pickup/delivery receipts keep the top clean and focused on their channel.
  if (isDineIn && customerNumber > 0) {
    out.push(align(1), bold(1), size(3,3), text(String(customerNumber)));
    out.push(size(1,1), text('SALONBESTELLUNG'));
    if (isTakeaway) out.push(size(2,2), text('ZUM MITNEHMEN'));
    out.push(size(1,1), bold(0), align(0), text(''));
  }

  // Delivery kitchen slips need a distance-readable destination. Pickup and
  // Schnellbestellung intentionally print no customer address at the bottom.
  if (isDelivery) {
    const deliveryAddress = buildDeliveryAddress(o?.customer || {});
    const deliveryCustomerName = /^Nummer\s+\d+$/i.test(name) ? '' : name;
    if (deliveryAddress || deliveryCustomerName) {
      out.push(align(1), bold(1), size(2,2));
      const largeLineWidth = Math.max(12, Math.floor(LINE / 2));
      if (deliveryAddress) {
        for (const line of wrapLines('', deliveryAddress, largeLineWidth)) out.push(text(line));
      }
      if (deliveryCustomerName) {
        for (const line of wrapLines('', deliveryCustomerName, largeLineWidth)) out.push(text(line));
      }
      out.push(size(1,1), bold(0), align(0), text(''));
    }
  }

  const orderNote = extractOrderNote(o);
  if (orderNote){
    out.push(fontSel(1), text('Lieferhinweis: ' + String(orderNote)), fontSel(0));
    out.push(text(''));
  }

  // ===== BARKOD (EN ALTA) =====
  if (orderId) out.push(code128(orderId));

  // Barkod printer ağzında kalmasın; önce yeterli boşluk ver, sonra kes.
  // CUT_FEED_LINES .env ile arttırılıp azaltılabilir.
  out.push(lineSpaceDefault(), feedLines(CUT_FEED_LINES), cut());
  return Buffer.concat(out);
}

/* ====== HTTP ====== */
const server = http.createServer(async (req,res)=>{
  const reqOrigin = String(req.headers.origin || '');
  const originAllowed = cors(res, reqOrigin);
  const u = new URL(req.url || '/', 'http://127.0.0.1');

  if (req.method==='OPTIONS'){
    if (reqOrigin && !originAllowed) return jsonResponse(res, 403, { ok:false, error:'origin_not_allowed' });
    res.writeHead(204, {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    return res.end();
  }

  if (reqOrigin && !originAllowed) {
    return jsonResponse(res, 403, { ok:false, error:'origin_not_allowed' });
  }

  if (!requestAuthorized(req)) {
    return jsonResponse(res, 401, { ok:false, error:'unauthorized' });
  }

  if (req.method==='GET' && u.pathname==='/health'){
    return jsonResponse(res, 200, {
      ok:true,
      printer:{host:PRINTER_IP, port:PRINTER_PORT, codepage: PRINTER_CODEPAGE},
      logoUrl: LOGO_URL || null,
      localLogo: fs.existsSync(DEFAULT_LOGO_FILE) ? DEFAULT_LOGO_FILE : null,
      insecureLogoAllowed: ALLOW_INSECURE_LOGO,
      logoParams: {
        threshold: LOGO_THRESHOLD,
        maxWidth: LOGO_MAX_WIDTH,
        brighten: LOGO_BRIGHTEN,
        gamma: LOGO_GAMMA,
        dither: LOGO_DITHER,
        blackBoost: LOGO_BLACK_BOOST,
        autoCrop: LOGO_AUTOCROP,
        cropPad: LOGO_CROP_PAD
      },
      barcode: { height: BARCODE_HEIGHT, module: BARCODE_MODULE },
      limits: {
        maxJsonBytes: MAX_JSON_BYTES,
        maxCopies: MAX_COPIES,
        maxLines: MAX_LINES,
        maxLineChars: MAX_LINE_CHARS,
      },
      legacyTaxFallback: ALLOW_LEGACY_TAX_FALLBACK,
      fiscalOperationMode: FISCAL_OPERATION_MODE,
    });
  }

  // Sadece barkod bas (CODE128)
  if (req.method==='POST' && u.pathname==='/print/barcode'){
    try{
      const body = await readJson(req);
      const content = String(body?.content || '').trim();
      const copies = Number.parseInt(body?.copies || 1, 10);
      if (!content) {
        return jsonResponse(res, 400, {ok:false, error:'content_required'});
      }
      if (!Number.isInteger(copies) || copies < 1 || copies > MAX_COPIES) {
        return jsonResponse(res, 422, {ok:false, error:'copies_out_of_range'});
      }
      const chunks = [];
      for (let i=0;i<copies;i++){
        chunks.push(init(), selectCodepage(), fontA(), lineSpace(34));
        chunks.push(code128(content));
        chunks.push(lineSpaceDefault(), text('\n'), cut());
      }
      await sendToPrinter(Buffer.concat(chunks));
      return jsonResponse(res, 200, {ok:true, printed:content, copies});
    }catch(e){
      return requestError(res, e);
    }
  }

  if (req.method==='POST' && u.pathname==='/print/test'){
    try{
      const b = Buffer.concat([
        init(), selectCodepage(), fontA(), lineSpace(34),
        align(1), size(2,2), text('*** TEST ***'),
        align(0), text('Jalapeños € ä ö ü ß ñ – OK'),
        lineSpaceDefault(), cut()
      ]);
      await sendToPrinter(b);
      return jsonResponse(res, 200, {ok:true});
    }catch(e){
      return requestError(res, e);
    }
  }

  if (req.method==='POST' && u.pathname==='/print/lines'){
    try{
      const body=await readJson(req); const lines=Array.isArray(body?.lines)?body.lines:[];
      if (lines.length > MAX_LINES) {
        return jsonResponse(res, 422, {ok:false, error:'too_many_lines'});
      }
      const safeLines = lines.map((line) => String(line || ''));
      if (safeLines.some((line) => line.length > MAX_LINE_CHARS)) {
        return jsonResponse(res, 422, {ok:false, error:'line_too_long'});
      }
      const b=Buffer.concat([init(), selectCodepage(), fontA(), lineSpace(34), ...safeLines.map(l=>text(l)), lineSpaceDefault(), cut()]);
      await sendToPrinter(b);
      return jsonResponse(res, 200, {ok:true,lines:safeLines.length});
    }catch(e){
      return requestError(res, e);
    }
  }

  if (req.method==='POST' && u.pathname==='/print/full'){
    try{
      const body=await readJson(req);
      if (!body?.order || typeof body.order !== 'object' || Array.isArray(body.order)) {
        return jsonResponse(res, 400, {ok:false, error:'order_required'});
      }
      const payload=await buildPrintPayload(body?.order||{}, body?.options||{});
      await sendToPrinter(payload);
      return jsonResponse(res, 200, {ok:true,printed:String(body?.order?.id||'')});
    }catch(e){
      return requestError(res, e);
    }
  }

  // Eski isim korunur; güvenlik nedeniyle URL çözümleme kaldırılmıştır.
  // İstemci doğrulanmış order nesnesini göndermelidir.
  if (req.method==='POST' && u.pathname==='/print/pdf'){
    try{
      const body=await readJson(req);
      let order = body?.order || null;
      if (!order){
        return jsonResponse(res, 400, {
          ok:false,
          error: body?.url ? 'url_resolution_disabled' : 'order_required',
        });
      }
      const payload=await buildTicketFromOrder(order, body?.options||{ brand:'Burger Brothers' });
      await sendToPrinter(payload);
      return jsonResponse(res, 200, {ok:true,printed:String(order?.id||'')});
    }catch(e){
      return requestError(res, e);
    }
  }

  return jsonResponse(res, 404, { ok:false, error:'not_found' });
});

server.requestTimeout = 15_000;
server.headersTimeout = 10_000;
server.keepAliveTimeout = 5_000;
server.maxHeadersCount = 64;

server.on('clientError', (_error, socket) => {
  if (!socket.writable) return;
  socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
});

server.listen(PORT, BIND_HOST, ()=>{
  console.log(`✅ print-proxy up on http://${BIND_HOST}:${PORT}`);
  console.log(`➡️  Printer: ${PRINTER_IP}:${PRINTER_PORT} codepage=${PRINTER_CODEPAGE}`);
  if (fs.existsSync(DEFAULT_LOGO_FILE)) console.log(`🖼  Local Logo: ${DEFAULT_LOGO_FILE}`);
  if (LOGO_URL) console.log(`🖼  Logo URL: ${LOGO_URL}  (insecure:${ALLOW_INSECURE_LOGO?'yes':'no'}) thr:${LOGO_THRESHOLD} mw:${LOGO_MAX_WIDTH} bright:${LOGO_BRIGHTEN} gamma:${LOGO_GAMMA} dither:${LOGO_DITHER?'on':'off'} blackBoost:${LOGO_BLACK_BOOST} autocrop:${LOGO_AUTOCROP?'on':'off'} pad:${LOGO_CROP_PAD}`);
  console.log(`🏷  Barcode h=${BARCODE_HEIGHT} module=${BARCODE_MODULE}`);
});
