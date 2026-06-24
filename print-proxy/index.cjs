// ESC/POS proxy – CP1252 (Euro) – sabit sıra, belirgin grup başlıkları,
// KDV özeti (7% / 19%), üstte LOGO, barkod en altta.
// Logo: URL'den **BMP** (1/8/24 bpp) indir, auto-invert + brighten + gamma + dithering + auto-crop ile raster bas.

const http = require('http');
const https = require('https');
const url = require('url');
const net = require('net');

/* ====== AYAR ====== */
const PORT          = Number(process.env.PORT || 7777);
const PRINTER_IP    = process.env.PRINTER_IP || '192.168.0.150';
const PRINTER_PORT  = Number(process.env.PRINTER_PORT || 9100);
const ALLOW_ORIGINS = (process.env.ALLOW_ORIGINS || 'https://www.burger-brothers.berlin,https://www.burger-brothers.berlin')
  .split(',').map(s=>s.trim()).filter(Boolean);

// Varsayılan logo: Next.js public klasörü (public/logo-thermal.bmp)
const DEFAULT_LOGO_URL = 'https://www.burger-brothers.berlin/logo-thermal.bmp';
const LOGO_URL         = process.env.LOGO_URL || DEFAULT_LOGO_URL;

// Dev ortamında self-signed https için
const ALLOW_INSECURE_LOGO = String(process.env.ALLOW_INSECURE_LOGO || '0') === '1';
const insecureHttpsAgent  = new https.Agent({ rejectUnauthorized: false });

// Logo render ayarları (env ile override edilebilir)
// Daha koyu varsayılan: threshold ↑, blackBoost ↑
const LOGO_THRESHOLD   = Number(process.env.LOGO_THRESHOLD || 242);  // 210–245 (yükseldikçe daha siyah)
const LOGO_MAX_WIDTH   = Number(process.env.LOGO_MAX_WIDTH || 320);  // 300–340
const LOGO_BRIGHTEN    = Number(process.env.LOGO_BRIGHTEN  || 1.20); // 1.0–1.4
const LOGO_GAMMA       = Number(process.env.LOGO_GAMMA     || 1.10); // 1.0–1.6
const LOGO_DITHER      = String(process.env.LOGO_DITHER || '1') === '1';
const LOGO_BLACK_BOOST = Number(process.env.LOGO_BLACK_BOOST || 0.12); // 0.00–0.20
const LOGO_AUTOCROP    = String(process.env.LOGO_AUTOCROP || '1') === '1';
const LOGO_CROP_PAD    = Number(process.env.LOGO_CROP_PAD || 4);      // crop sonrası kenarda bırakılacak pay (px)

// Barkod ölçüleri
const BARCODE_HEIGHT   = Number(process.env.BARCODE_HEIGHT || 80); // 40–255
const BARCODE_MODULE   = Number(process.env.BARCODE_MODULE || 1);  // 1=ince,2=orta,3=kalın

/* ====== SABİT MAĞAZA BİLGİLERİ ====== */
const STORE_HEADER_LINES = [
  'Berliner Str. 9',
  '13507 Berlin',
  'Tel: 030 - 405 73 030',
  'St.Nr: 17/602/03138',
];

/* ====== CORS & yardımcılar ====== */
function cors(res, reqOrigin='') {
  const origin = (ALLOW_ORIGINS.includes(reqOrigin) ? reqOrigin : ALLOW_ORIGINS[0]) || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'OPTIONS, POST, GET');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}
function readJson(req) {
  return new Promise((resolve, reject) => {
    let buf=''; req.on('data', c => buf+=c);
    req.on('end', () => { try{ resolve(buf?JSON.parse(buf):{}); } catch(e){ reject(e); } });
    req.on('error', reject);
  });
}

/** HTTPS self-signed destekli, redirect takip eden downloader */
function httpGetBuffer(absUrl) {
  return new Promise((resolve, reject) => {
    const startUrl = new URL(absUrl);
    const fetchOnce = (u, depth=0) => {
      if (depth > 5) return reject(new Error('Too many redirects'));
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
          return fetchOnce(nextUrl, depth+1);
        }
        if (code >= 400) {
          res.resume();
          return reject(new Error('HTTP ' + code));
        }
        const chunks=[];
        res.on('data', c=>chunks.push(c));
        res.on('end', ()=> resolve(Buffer.concat(chunks)));
      });
      req.on('timeout', ()=>{ req.destroy(new Error('timeout')); });
      req.on('error', reject);
      req.end();
    };

    fetchOnce(startUrl, 0);
  });
}
const httpGetJson = (absUrl) => httpGetBuffer(absUrl).then(b=>JSON.parse(b.toString('utf8')));

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
const underline = on=> Buffer.from([ESC,0x2D,on?1:0]);
const cut       = () => Buffer.from([GS,0x56,0x42,0x03]);
const fontA     = () => Buffer.from([GS,0x66,0x00]);
const size      = (w=1,h=1)=>Buffer.from([GS,0x21, ((Math.max(1,w)-1)<<4)|((Math.max(1,h)-1)&0x0F)]);
const codepage1252 = () => Buffer.from([ESC,0x74,16]);
const fontSel   = n => Buffer.from([ESC,0x4D,n]); // 0:A 1:B (B daha dar)
const lineSpace = n => Buffer.from([ESC,0x33, Math.max(0, Math.min(255, n))]);
const lineSpaceDefault = () => Buffer.from([ESC,0x32]);

const cp1252Special = new Map([
  [0x20AC,0x80],[0x201A,0x82],[0x0192,0x83],[0x201E,0x84],[0x2026,0x85],[0x2020,0x86],[0x2021,0x87],
  [0x02C6,0x88],[0x2030,0x89],[0x0160,0x8A],[0x2039,0x8B],[0x0152,0x8C],[0x2018,0x91],[0x2019,0x92],
  [0x201C,0x93],[0x201D,0x94],[0x2022,0x95],[0x2013,0x96],[0x2014,0x97],[0x02DC,0x98],[0x2122,0x99],
  [0x0161,0x9A],[0x203A,0x9B],[0x0153,0x9C],[0x0178,0x9F],
]);
function enc1252Str(s=''){
  const out=[];
  for(const ch of String(s)){
    const cp=ch.codePointAt(0);
    if (cp<=0xFF) out.push(cp);
    else if (cp1252Special.has(cp)) out.push(cp1252Special.get(cp));
    else out.push(0x3F);
  }
  return Buffer.from(out);
}
const text  = (s='') => Buffer.concat([enc1252Str(String(s)), Buffer.from('\n')]);
const twoCol= (L,R)=>{const l=String(L), r=String(R); const sp=Math.max(1, LINE-l.length-r.length); return l+' '.repeat(sp)+r;};

/* ====== CODE128 ====== */
function code128(data=''){
  const payload = Buffer.from(String(data),'ascii');
  return Buffer.concat([
    align(1),
    Buffer.from([GS,0x48,0x02]),                                     // HRI altta
    Buffer.from([GS,0x68, Math.max(40, Math.min(255, BARCODE_HEIGHT))]), // yükseklik
    Buffer.from([GS,0x77, Math.max(1, Math.min(3, BARCODE_MODULE))]),    // modül genişliği
    Buffer.from([GS,0x6B,0x49, payload.length]),                     // CODE128
    payload,
    text(String(data))
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
const money = v => num(v).toFixed(2)+'€';

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
  if (/burger/.test(name)) return 'Burger';
  if (/(vegan|vegetar)/.test(name)) return 'Vegan / Vegetarisch';
  if (/(getränk|cola|ayran|fanta|sprite|wasser|water|pepsi)/.test(name)) return 'Getränke';
  if (/(soße|sauce|sos|bbq|mayo|ketchup|senf|ranch|aioli|garlic|truffle|chipotle|tartar|sour\s*creme)/.test(name)) return 'Soßen';
  if (/(snack|beilage|beilagen|wings|sticks|rings|fries)/.test(name)) return 'Extras';
  if (/(extra|zusatz)/.test(name)) return 'Extras';
  return 'Andere';
}

/* ====== URL'den order çöz ====== */
async function resolveOrderFromUrl(urlStr){
  const u = new URL(urlStr);
  const m = u.pathname.match(/\/print\/barcode\/([^/]+)/i);
  const orderId = m ? decodeURIComponent(m[1]) : null;
  if (!orderId) return null;
  const list = await httpGetJson(`${u.protocol}//${u.host}/api/orders`).catch(()=>null);
  if (!Array.isArray(list)) return null;
  return list.find(o=>String(o?.id)===String(orderId)) || null;
}

/* ====== geplant saat ====== */
function computeGeplant(o){
  if (o?.planned){
    const [hh,mm] = String(o.planned).split(':').map(x=>parseInt(x,10));
    if (!Number.isNaN(hh)){
      const d = new Date(); d.setHours(hh||0, mm||0, 0, 0);
      return d.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
    }
  }
  const dueIso = o?.targetAt || o?.dueAt;
  if (dueIso){
    const d = new Date(dueIso);
    return d.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
  }
  const base = new Date(o?.ts || Date.now());
  const avg =
    Number.isFinite(num(o?.avgMin)) ? num(o.avgMin) :
    Number.isFinite(num(o?.etaMin)) ? num(o.etaMin) :
    Number.isFinite(num(o?.avg))    ? num(o.avg)    :
    Number.isFinite(num(o?.eta))    ? num(o.eta)    :
    (o?.mode==='pickup'?15:35);
  const plusList = ['addMin','plusMin','delayMin','adjustMin','deltaMin','extraMin','extendMin','bumpMin'];
  const extra = plusList.reduce((s,k)=> s + (Number.isFinite(num(o?.[k]))? num(o[k]) : 0), 0);
  base.setMinutes(base.getMinutes() + avg + extra);
  return base.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
}

/* ====== not & adres ====== */
function extractOrderNote(o){
  const c = o?.customer || {};
  return (o?.lifa || o?.lifaNote ||
          o?.note || o?.orderNote || o?.deliveryNote ||
          c?.note || c?.deliveryNote || c?.deliveryHint || c?.hinweis || '');
}
function buildAddressLine(cust={}){
  let zip = String(cust.zip || cust.plz || '').trim();
  let street = String(cust.street || cust['straße'] || cust.strasse || '').trim();
  let house = String(cust.houseNo || cust.hausnr || cust.house || cust.nr || '').trim();

  if (!zip || !street || !house){
    const free = String(cust.address || '').trim();
    if (free){
      const parts = free.split('|').map(s=>s.trim());
      if (!street && parts[0]) {
        const m = parts[0].match(/^(.+?)\s+(\S+)$/);
        if (m){ street = m[1]; house = house || m[2]; }
      }
      const whole = parts[1] || parts[0] || free;
      const mz = whole.match(/\b(\d{5})\b/);
      if (mz && !zip) zip = mz[1];
      if (!street){
        const m2 = whole.match(/^(.+?)\s+(\S+)$/);
        if (m2){ street = m2[1]; house = house || m2[2]; }
      }
    }
  }
  return [zip, street, house].filter(Boolean).join(' - ');
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
      else { const byte=buf[rowStart+(x>>3)], bit=7-(x&7), val=(byte>>bit)&1; r=g=b= val?0:255; }
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
      else { const byte=buf[rowStart+(sx0>>3)], bit=7-(sx0&7), val=(byte>>bit)&1; r=g=b= val?0:255; }
      let y = L(r,g,b);
      if (invert) y = 255 - y;
      // Siyah önyargı (daha koyu baskı)
      y = Math.max(0, y - 255*blackBoost);
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

async function printLogoIfAny(overrideUrl){
  const urlStr = overrideUrl || LOGO_URL;
  if (!urlStr) return Buffer.alloc(0);
  try{
    const buf = await httpGetBuffer(urlStr);
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
    console.warn('Logo indirilemedi:', e.message || e);
    return Buffer.alloc(0);
  }
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
    const ch = String(o?.channel || '').trim();
    if (ch) return titleCase(ch);
    const m = String(o?.mode||'').toLowerCase();
    if (m==='delivery') return 'Lieferung';
    if (m==='pickup')   return 'Abholung';
    return '';
  })();
  const headerTag = [ isPlanned(o) ? 'Geplant' : '', baseLabel ].filter(Boolean).join(' ');

  const gepl = computeGeplant(o);
  const when = new Date(o?.ts || Date.now());
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
  const ORDER = ['Burger','Vegan / Vegetarisch','Hotdogs','Extras','Getränke','Soßen'];
  const orderedKeys = []; for (const k of ORDER) if (map.has(k)) orderedKeys.push(k);
  const others = [...map.keys()].filter(k=>!ORDER.includes(k)).sort();
  const keys = [...orderedKeys, ...others];

  // Pricing
  const P = o?.pricing || {};
  const F = o?.fees || {};
  const itemsSum  = items.reduce((s,it)=> s + num(it.price)*num(it.qty||1), 0);
  const subRaw    = num(P.subtotal);
  const subtotal  = subRaw > 0 ? subRaw : itemsSum;
  const deliveryFee = findDeliveryFeeDeep(o);
  const serviceFee  = num(P.service ?? F.service);
  const otherFee    = num(P.other ?? P.misc ?? F.other);
  let explicitTotal = num(P.total ?? o.total ?? o.amount ?? o.payable ?? o.toPay);
  if (explicitTotal <= 0) {
    explicitTotal = subtotal + deliveryFee + serviceFee + otherFee - num(P.discount ?? F.discount);
  }
  let discountSum = num(P.discount ?? F.discount);
  const fees = deliveryFee + serviceFee + otherFee;
  const derivedDiscount = Math.max(0, (subtotal + fees) - explicitTotal);
  if (Math.abs((subtotal + fees) - explicitTotal - discountSum) > 0.01) discountSum = derivedDiscount;

  const discList = Array.isArray(o?.adjustments)
    ? o.adjustments.filter(a=>String(a?.type||'').toLowerCase()==='discount')
    : [];

  // ===== KDV toplama =====
  let br7 = 0, br19 = 0;
  if (items.length){
    for (const it of items){
      const qty   = num(it?.qty||1);
      const gross = num(it?.price) * qty;
      const rate  = Number(it?.taxRate);
      if (rate === 7)  { br7  += gross; continue; }
      if (rate === 19) { br19 += gross; continue; }
      const cat = detectCategory(it);
      if (cat === 'Getränke') br19 += gross;
      else br7 += gross;
    }
  }
  if (o?.summary){
    br7  = br7  || num(o.summary.brutto7);
    br19 = br19 || num(o.summary.brutto19);
  }

  const { net19, vat19, net7, vat7 } =
    calcVatBlocks({ br7, br19, delivery: deliveryFee, discount: discountSum });

  const out=[];
  out.push(init(), codepage1252(), fontA(), lineSpace(34));

  // ===== ÜST BLOK =====
  const logoChunk = await printLogoIfAny(opts.logoUrl);
  if (logoChunk.length) out.push(logoChunk);
  else out.push(align(1), size(2,2), text(brand), align(0));

  if (headerTag) out.push(align(1), size(2,1), text(headerTag), align(0));
  out.push(align(1), size(2,2), text(gepl), size(1,1), align(0));

  out.push(align(1));
  for (const ln of STORE_HEADER_LINES) out.push(text(ln));
  out.push(text(''), align(0));

  out.push(text(twoCol('Zeit', whenStr)));
  out.push(text('-'.repeat(LINE)));

  // ===== ÜRÜNLER =====
  for (const g of keys){
    out.push(bold(1), underline(1), size(1,2), text(g), size(1,1), underline(0), bold(0));
    for (const it of map.get(g)){
      const qty=num(it.qty||1), price=num(it.price||0), line=qty*price;
      const itemName = cleanName(String(it.name||''));
      out.push(bold(1), size(1,1), text(twoCol(`${qty}× ${itemName}`, money(line))), bold(0));
      if (it.note){ out.push(fontSel(1), text('  ' + String(it.note)), fontSel(0)); }
      if (Array.isArray(it.add) && it.add.length){
        const extras = it.add.map(a=>cleanName(a?.label||a?.name||'')).filter(Boolean).join(', ');
        if (extras) out.push(fontSel(1), text('  ' + extras), fontSel(0));
      }
      if (Array.isArray(it.rm) && it.rm.length){
        out.push(fontSel(1), text('  Ohne: ' + it.rm.join(', ')), fontSel(0));
      }
    }
  }

  // ===== TOPLAM + KDV ÖZETİ =====
  out.push(text('-'.repeat(LINE)));
  out.push(size(1,2), text(twoCol('Zwischensumme', money(subtotal))), size(1,1));
  if (deliveryFee) out.push(text(twoCol('Lieferaufschläge', money(deliveryFee))));
  if (serviceFee)  out.push(text(twoCol('Service',          money(serviceFee))));
  if (otherFee)    out.push(text(twoCol('Sonstiges',        money(otherFee))));
  if (discountSum){
    out.push(text(twoCol('Rabatte', '-' + money(discountSum))));
    for (const a of discList){
      const tag = [a?.code, a?.reason].filter(Boolean).join(' – ') || (a?.source||'');
      if (num(a?.amount) > 0){
        out.push(text(twoCol('  - ' + (tag||'Indirim'), '-' + money(num(a.amount)))));
      }
    }
  }

  // ===== KDV blokları — HER ZAMAN GÖRÜNSÜN =====
  out.push(text(''));
  out.push(text(twoCol('Netto MwSt 19 %', money(net19))));
  out.push(text(twoCol('MwSt 19 %',       money(vat19))));
  out.push(text(twoCol('Netto MwSt 7 %',  money(net7))));
  out.push(text(twoCol('MwSt 7 %',        money(vat7))));

  out.push(bold(1), size(1,2), text(twoCol('Gesamt', money(explicitTotal))), size(1,1), bold(0), text(''));

  // ===== ADRES (barkod ÜSTÜ) + Lifa notu =====
  const bottomAddress = [buildAddressLine(o?.customer||{}), name].filter(Boolean).join(' - ');
  if (bottomAddress) out.push(bold(1), text(bottomAddress), bold(0));

  const orderNote = extractOrderNote(o);
  if (orderNote){
    out.push(fontSel(1), text('Lieferhinweis: ' + String(orderNote)), fontSel(0));
    out.push(text(''));
  }

  // ===== BARKOD (EN ALTA) =====
  if (orderId) out.push(code128(orderId));

  out.push(lineSpaceDefault(), text('\n'), cut());
  return Buffer.concat(out);
}

/* ====== HTTP ====== */
const server = http.createServer(async (req,res)=>{
  cors(res, req.headers.origin||'');
  const u = url.parse(req.url, true);
  if (req.method==='OPTIONS'){ res.statusCode=200; return res.end(); }

  if (req.method==='GET' && u.pathname==='/health'){
    res.writeHead(200, {'Content-Type':'application/json'});
    return res.end(JSON.stringify({
      ok:true,
      printer:{host:PRINTER_IP, port:PRINTER_PORT},
      logoUrl: LOGO_URL || null,
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
      barcode: { height: BARCODE_HEIGHT, module: BARCODE_MODULE }
    }));
  }

  // === YENİ: Sadece barkod bas (CODE128) ===
  if (req.method==='POST' && u.pathname==='/print/barcode'){
    try{
      const body = await readJson(req);
      const content = String(body?.content || '').trim();
      const copies = Math.max(1, parseInt(body?.copies || 1, 10));
      if (!content) {
        res.writeHead(400, {'Content-Type':'application/json'});
        return res.end(JSON.stringify({ok:false, error:'content required'}));
      }
      const chunks = [];
      for (let i=0;i<copies;i++){
        chunks.push(init(), codepage1252(), fontA(), lineSpace(34));
        // İstersen üstte küçük başlık/metin ekleyebilirsin:
        // chunks.push(align(1), text('BARKOD'), align(0));
        chunks.push(code128(content));
        chunks.push(lineSpaceDefault(), text('\n'), cut());
      }
      await sendToPrinter(Buffer.concat(chunks));
      res.writeHead(200, {'Content-Type':'application/json'});
      return res.end(JSON.stringify({ok:true, printed:content, copies}));
    }catch(e){
      res.writeHead(500, {'Content-Type':'application/json'});
      return res.end(JSON.stringify({ok:false, error:String(e)}));
    }
  }

  if (req.method==='POST' && u.pathname==='/print/test'){
    try{
      const b = Buffer.concat([
        init(), codepage1252(), fontA(), lineSpace(34),
        align(1), size(2,2), text('*** TEST ***'),
        align(0), text('Jalapeños € ä ö ü ß ñ – OK'),
        lineSpaceDefault(), cut()
      ]);
      await sendToPrinter(b);
      res.writeHead(200, {'Content-Type':'application/json'});
      return res.end(JSON.stringify({ok:true}));
    }catch(e){
      res.writeHead(500, {'Content-Type':'application/json'});
      return res.end(JSON.stringify({ok:false,error:String(e)}));
    }
  }

  if (req.method==='POST' && u.pathname==='/print/lines'){
    try{
      const body=await readJson(req); const lines=Array.isArray(body?.lines)?body.lines:[];
      const b=Buffer.concat([init(), codepage1252(), fontA(), lineSpace(34), ...lines.map(l=>text(String(l))), lineSpaceDefault(), cut()]);
      await sendToPrinter(b);
      res.writeHead(200, {'Content-Type':'application/json'});
      return res.end(JSON.stringify({ok:true,lines:lines.length}));
    }catch(e){
      res.writeHead(500, {'Content-Type':'application/json'});
      return res.end(JSON.stringify({ok:false,error:String(e)}));
    }
  }

  if (req.method==='POST' && u.pathname==='/print/full'){
    try{
      const body=await readJson(req);
      const payload=await buildTicketFromOrder(body?.order||{}, body?.options||{});
      await sendToPrinter(payload);
      res.writeHead(200, {'Content-Type':'application/json'});
      return res.end(JSON.stringify({ok:true,printed:String(body?.order?.id||'')}));
    }catch(e){
      res.writeHead(500, {'Content-Type':'application/json'});
      return res.end(JSON.stringify({ok:false,error:String(e)}));
    }
  }

  if (req.method==='POST' && u.pathname==='/print/pdf'){
    try{
      const body=await readJson(req);
      let order = body?.order || null;
      if (!order && body?.url) order = await resolveOrderFromUrl(body.url);
      if (!order){
        res.writeHead(400, {'Content-Type':'application/json'});
        return res.end(JSON.stringify({ok:false,error:'order not resolved from url'}));
      }
      const payload=await buildTicketFromOrder(order, body?.options||{ brand:'Burger Brothers' });
      await sendToPrinter(payload);
      res.writeHead(200, {'Content-Type':'application/json'});
      return res.end(JSON.stringify({ok:true,printed:String(order?.id||'')}));
    }catch(e){
      res.writeHead(500, {'Content-Type':'application/json'});
      return res.end(JSON.stringify({ok:false,error:String(e)}));
    }
  }

  res.writeHead(404, {'Content-Type':'application/json'});
  res.end(JSON.stringify({ ok:false, error:'Not found' }));
});

server.listen(PORT, ()=>{
  console.log(`✅ print-proxy up on http://127.0.0.1:${PORT}`);
  console.log(`➡️  Printer: ${PRINTER_IP}:${PRINTER_PORT}`);
  if (LOGO_URL) console.log(`🖼  Logo URL: ${LOGO_URL}  (insecure:${ALLOW_INSECURE_LOGO?'yes':'no'}) thr:${LOGO_THRESHOLD} mw:${LOGO_MAX_WIDTH} bright:${LOGO_BRIGHTEN} gamma:${LOGO_GAMMA} dither:${LOGO_DITHER?'on':'off'} blackBoost:${LOGO_BLACK_BOOST} autocrop:${LOGO_AUTOCROP?'on':'off'} pad:${LOGO_CROP_PAD}`);
  console.log(`🏷  Barcode h=${BARCODE_HEIGHT} module=${BARCODE_MODULE}`);
});
