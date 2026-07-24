import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma, getTenantId } from "@/lib/db";

export const SCHNELL_COOKIE = "bb_schnell_sess";
export const SCHNELL_SETTINGS_KEY = "schnellbestellung";

export type SchnellSettings = {
  enabled: boolean;
  paused: boolean;
  cashEnabled: boolean;
  onlineEnabled: boolean;
  splitEnabled: boolean;
  tvEnabled: boolean;
  soundEnabled: boolean;
  autoPrint: boolean;
  radiusMeters: number;
  maxAccuracyMeters: number;
  qrTtlMinutes: number;
  qrGraceMinutes: number;
  sessionMinutes: number;
  recheckMinutes: number;
  maxOrdersPerDevice: number;
  orderWindowMinutes: number;
  numberStart: number;
  generation: number;
  shopLat: number;
  shopLng: number;
  visibleCategories: string[];
  hiddenProductIds: string[];
};

export const DEFAULT_SCHNELL_SETTINGS: SchnellSettings = {
  enabled: false, paused: false, cashEnabled: true, onlineEnabled: false,
  splitEnabled: false, tvEnabled: true, soundEnabled: true, autoPrint: true,
  radiusMeters: 100, maxAccuracyMeters: 75, qrTtlMinutes: 10, qrGraceMinutes: 2,
  sessionMinutes: 30, recheckMinutes: 15, maxOrdersPerDevice: 3,
  orderWindowMinutes: 30, numberStart: 1, generation: 1,
  shopLat: Number(process.env.SCHNELLBESTELLUNG_SHOP_LAT || 52.5881),
  shopLng: Number(process.env.SCHNELLBESTELLUNG_SHOP_LNG || 13.2866),
  visibleCategories: [], hiddenProductIds: [],
};

function obj(v: unknown): Record<string, any> { return v && typeof v === "object" && !Array.isArray(v) ? v as any : {}; }
function clamp(v: unknown, min: number, max: number, fallback: number) { const n=Number(v); return Number.isFinite(n) ? Math.min(max,Math.max(min,n)) : fallback; }
export function normalizeSchnellSettings(v: unknown): SchnellSettings {
  const x=obj(v), d=DEFAULT_SCHNELL_SETTINGS;
  return {
    enabled:x.enabled===true, paused:x.paused===true, cashEnabled:x.cashEnabled!==false,
    onlineEnabled:x.onlineEnabled===true, splitEnabled:x.splitEnabled===true,
    tvEnabled:x.tvEnabled!==false, soundEnabled:x.soundEnabled!==false, autoPrint:x.autoPrint!==false,
    radiusMeters:clamp(x.radiusMeters,25,500,d.radiusMeters), maxAccuracyMeters:clamp(x.maxAccuracyMeters,20,500,d.maxAccuracyMeters),
    qrTtlMinutes:clamp(x.qrTtlMinutes,2,60,d.qrTtlMinutes), qrGraceMinutes:clamp(x.qrGraceMinutes,0,10,d.qrGraceMinutes),
    sessionMinutes:clamp(x.sessionMinutes,5,120,d.sessionMinutes), recheckMinutes:clamp(x.recheckMinutes,5,60,d.recheckMinutes),
    maxOrdersPerDevice:clamp(x.maxOrdersPerDevice,1,20,d.maxOrdersPerDevice), orderWindowMinutes:clamp(x.orderWindowMinutes,5,180,d.orderWindowMinutes),
    numberStart:clamp(x.numberStart,1,999,d.numberStart), generation:clamp(x.generation,1,999999,d.generation),
    shopLat:clamp(x.shopLat,-90,90,d.shopLat), shopLng:clamp(x.shopLng,-180,180,d.shopLng),
    visibleCategories:Array.isArray(x.visibleCategories)?x.visibleCategories.map(String).filter(Boolean).slice(0,50):[],
    hiddenProductIds:Array.isArray(x.hiddenProductIds)?x.hiddenProductIds.map(String).filter(Boolean).slice(0,500):[],
  };
}
export async function getSchnellSettings() {
  const tenantId=await getTenantId();
  const row=await prisma.setting.findUnique({where:{tenantId_key:{tenantId,key:SCHNELL_SETTINGS_KEY}},select:{value:true}});
  return normalizeSchnellSettings(row?.value);
}
export async function saveSchnellSettings(value: unknown) {
  const tenantId=await getTenantId(); const settings=normalizeSchnellSettings(value);
  await prisma.setting.upsert({where:{tenantId_key:{tenantId,key:SCHNELL_SETTINGS_KEY}},update:{value:settings as any},create:{tenantId,key:SCHNELL_SETTINGS_KEY,value:settings as any}});
  return settings;
}
function secret(){ const s=String(process.env.SESSION_SECRET||process.env.NEXTAUTH_SECRET||process.env.AUTH_SECRET||"").trim(); if(!s) throw new Error("SESSION_SECRET_MISSING"); return s; }
function b64(v:string){return Buffer.from(v).toString("base64url")}
function unb64(v:string){return Buffer.from(v,"base64url").toString("utf8")}
function sign(data:string){return createHmac("sha256",secret()).update(data).digest("base64url")}
export function createSignedToken(payload:Record<string,unknown>){const body=b64(JSON.stringify(payload));return `${body}.${sign(body)}`}
export function readSignedToken(token:string):Record<string,any>|null{try{const [body,sig]=token.split(".");if(!body||!sig)return null;const a=Buffer.from(sig),b=Buffer.from(sign(body));if(a.length!==b.length||!timingSafeEqual(a,b))return null;return JSON.parse(unb64(body));}catch{return null}}
export function createAccessToken(settings:SchnellSettings){const now=Date.now();return createSignedToken({typ:"schnell-access",iat:now,exp:now+settings.qrTtlMinutes*60000,gen:settings.generation,nonce:randomBytes(10).toString("hex")})}
export function verifyAccessToken(token:string,settings:SchnellSettings){const p=readSignedToken(token);if(!p||p.typ!=="schnell-access"||Number(p.gen)!==settings.generation)return null;const now=Date.now();if(Number(p.exp)+settings.qrGraceMinutes*60000<now)return null;return p}
export function createSessionToken(settings:SchnellSettings, data:{lat:number;lng:number;accuracy:number;deviceId:string}){const now=Date.now();return createSignedToken({typ:"schnell-session",iat:now,exp:now+settings.sessionMinutes*60000,locAt:now,gen:settings.generation,...data})}
export function verifySessionToken(token:string,settings:SchnellSettings){const p=readSignedToken(token);if(!p||p.typ!=="schnell-session"||Number(p.gen)!==settings.generation||Number(p.exp)<Date.now())return null;return p}
export function distanceMeters(aLat:number,aLng:number,bLat:number,bLng:number){const R=6371000,toRad=(x:number)=>x*Math.PI/180;const dLat=toRad(bLat-aLat),dLng=toRad(bLng-aLng);const q=Math.sin(dLat/2)**2+Math.cos(toRad(aLat))*Math.cos(toRad(bLat))*Math.sin(dLng/2)**2;return 2*R*Math.atan2(Math.sqrt(q),Math.sqrt(1-q));}
export function berlinBusinessDate(d=new Date()){return new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Berlin",year:"numeric",month:"2-digit",day:"2-digit"}).format(d)}
export async function createCashSchnellOrder(params:{items:any[];idempotencyKey:string;deviceId:string;session:any}){
  const tenantId=await getTenantId(); const businessDate=berlinBusinessDate();
  for(let attempt=0;attempt<4;attempt++){
    try{return await prisma.$transaction(async tx=>{
      const existing=await tx.order.findFirst({where:{tenantId,channel:"schnellbestellung",ts:{gte:new Date(Date.now()-24*60*60*1000)}},orderBy:{ts:"desc"},take:1});
      if(existing){const m=obj(existing.meta);if(m.idempotencyKey===params.idempotencyKey)return {order:existing,customerNumber:Number(m.customerNumber),reused:true};}
      const settingsRow=await tx.setting.findUnique({where:{tenantId_key:{tenantId,key:SCHNELL_SETTINGS_KEY}},select:{value:true}});
      const settings=normalizeSchnellSettings(settingsRow?.value); if(!settings.enabled||settings.paused||!settings.cashEnabled)throw new Error("SCHNELL_UNAVAILABLE");
      const since=new Date(Date.now()-settings.orderWindowMinutes*60000);
      const recent=await tx.order.findMany({where:{tenantId,channel:"schnellbestellung",ts:{gte:since}},select:{meta:true},take:100});
      const count=recent.filter(r=>obj(r.meta).deviceId===params.deviceId).length;if(count>=settings.maxOrdersPerDevice)throw new Error("DEVICE_RATE_LIMIT");
      const ids=params.items.map(i=>String(i.productId||i.id||"")).filter(Boolean); if(!ids.length)throw new Error("EMPTY_CART");
      const products=await tx.product.findMany({where:{tenantId,id:{in:ids},active:true}});const byId=new Map(products.map(p=>[p.id,p]));
      let total=0;const canonical:any[]=[];
      for(const raw of params.items.slice(0,60)){const p=byId.get(String(raw.productId||raw.id||""));if(!p)throw new Error("PRODUCT_UNAVAILABLE");if(settings.hiddenProductIds.includes(p.id))throw new Error("PRODUCT_UNAVAILABLE");if(settings.visibleCategories.length&&!settings.visibleCategories.includes(p.category))throw new Error("PRODUCT_UNAVAILABLE");const qty=Math.max(1,Math.min(20,Math.floor(Number(raw.qty)||1)));const extrasRaw=Array.isArray((p.extrasJson as any))?(p.extrasJson as any):[];const selectedIds=new Set((Array.isArray(raw.extraIds)?raw.extraIds:[]).map(String));const extras=extrasRaw.filter((e:any)=>selectedIds.has(String(e.id||e.name))).map((e:any)=>({id:String(e.id||e.name),name:String(e.name||e.label||"Extra"),price:Number(e.price)||0}));const unit=Number(p.price)+extras.reduce((s:number,e:any)=>s+e.price,0);total+=unit*qty;canonical.push({id:p.id,sku:p.sku,name:p.name,category:p.category,price:Number(p.price),qty,add:extras,note:String(raw.note||"").slice(0,300)});}
      total=Math.round(total*100)/100;
      const counterKey=`schnell-counter:${businessDate}`;const counter=await tx.setting.findUnique({where:{tenantId_key:{tenantId,key:counterKey}},select:{value:true}});const last=Number(obj(counter?.value).lastNumber)||settings.numberStart-1;const customerNumber=last+1;
      await tx.setting.upsert({where:{tenantId_key:{tenantId,key:counterKey}},update:{value:{lastNumber:customerNumber,businessDate,updatedAt:new Date().toISOString()}},create:{tenantId,key:counterKey,value:{lastNumber:customerNumber,businessDate,updatedAt:new Date().toISOString()}}});
      const order=await tx.order.create({data:{tenantId,mode:"dine_in",channel:"schnellbestellung",status:"new",merchandise:new Prisma.Decimal(total),discount:new Prisma.Decimal(0),surcharges:new Prisma.Decimal(0),total:new Prisma.Decimal(total),customer:{name:`Nummer ${customerNumber}`},items:canonical,meta:{source:"qr_quick_order",customerNumber,businessDate,tableNumber:null,paymentMethod:"cash",paymentStatus:"pay_at_counter",deviceId:params.deviceId,idempotencyKey:params.idempotencyKey,sessionIssuedAt:params.session.iat,printRequested:settings.autoPrint,tvEnabled:settings.tvEnabled}}});
      return {order,customerNumber,reused:false};
    },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,maxWait:10000,timeout:30000});}catch(e:any){if(e?.code==='P2034'&&attempt<3)continue;throw e;}}
  throw new Error("ORDER_TRANSACTION_FAILED");
}
