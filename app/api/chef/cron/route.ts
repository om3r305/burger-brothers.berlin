import { NextRequest,NextResponse } from "next/server";
import { runChefReminders } from "@/lib/server/chef";
import { secretMatches } from "@/lib/server/request-security";
export const runtime="nodejs";export const dynamic="force-dynamic";export const revalidate=0;
export async function GET(req:NextRequest){const secret=String(process.env.CRON_SECRET||"").trim(),bearer=String(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"").trim(),allowed=secret?secretMatches(bearer,secret):process.env.NODE_ENV!=="production"&&!process.env.VERCEL;if(!allowed)return NextResponse.json({ok:false,error:"UNAUTHORIZED_CRON_REQUEST"},{status:401,headers:{"Cache-Control":"no-store"}});try{return NextResponse.json({ok:true,...await runChefReminders()},{headers:{"Cache-Control":"no-store"}})}catch(e){console.error("[cron/bb-chef]",e);return NextResponse.json({ok:false,error:"CHEF_REMINDER_FAILED"},{status:500,headers:{"Cache-Control":"no-store"}})}}
