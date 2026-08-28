import { NextRequest, NextResponse } from "next/server";
import { enforceRateLimit, hasTrustedMutationOrigin } from "@/lib/server/request-security";
import { CHEF_COOKIE, completeChefPlan, createChefSession, deleteChefItem, deleteChefPlan, ensureChefBootstrap, findChefUserByUsername, getChefState, latestChefNotification, placeChefOrder, receiveChefNeeds, requireChef, saveChefReport, upsertChefItem, upsertChefPlan, upsertChefPush, upsertChefUser, verifyChefPin } from "@/lib/server/chef";

export const runtime="nodejs"; export const dynamic="force-dynamic"; export const revalidate=0;
const headers={"Cache-Control":"no-store, no-cache, must-revalidate"};
const json=(payload:Record<string,unknown>,status=200)=>NextResponse.json(payload,{status,headers});

export async function GET(req:NextRequest){
  await ensureChefBootstrap();
  const user=await requireChef(req); if(!user)return json({ok:false,error:"UNAUTHORIZED"},401);
  if(req.nextUrl.searchParams.get("view")==="push")return json({ok:true,notification:await latestChefNotification()});
  return json({ok:true,...await getChefState(user)});
}

export async function POST(req:NextRequest){
  if(!hasTrustedMutationOrigin(req))return json({ok:false,error:"ORIGIN_NOT_ALLOWED"},403);
  const body=await req.json().catch(()=>({} as any)),action=String(body?.action||"").trim();
  if(action==="login"){
    const limited=await enforceRateLimit(req,"login:chef",6,15*60_000); if(limited)return limited;
    await ensureChefBootstrap(); const username=String(body?.username||"").trim(),pin=String(body?.pin||""),user=await findChefUserByUsername(username);
    if(!user?.active||!verifyChefPin(pin,user.pinHash))return json({ok:false,error:"INVALID_CREDENTIALS"},401);
    const res=json({ok:true,user:{id:user.id,username:user.username,displayName:user.displayName,role:user.role,canOrder:user.canOrder}});
    res.cookies.set(CHEF_COOKIE,createChefSession(user.id),{httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"strict",path:"/",maxAge:30*24*60*60}); return res;
  }
  if(action==="logout"){const res=json({ok:true});res.cookies.set(CHEF_COOKIE,"",{httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"strict",path:"/",maxAge:0});return res}
  const user=await requireChef(req); if(!user)return json({ok:false,error:"UNAUTHORIZED"},401);
  try{
    if(action==="saveReport")return json({ok:true,...await saveChefReport(user,body)});
    if(action==="placeOrder")return json({ok:true,...await placeChefOrder(user,body?.needIds)});
    if(action==="receiveNeeds")return json({ok:true,...await receiveChefNeeds(user,body?.needIds)});
    if(action==="upsertItem")return json({ok:true,item:await upsertChefItem(user,body?.item||{})});
    if(action==="deleteItem")return json({ok:true,...await deleteChefItem(user,body?.id)});
    if(action==="upsertUser")return json({ok:true,user:await upsertChefUser(user,body?.user||{})});
    if(action==="upsertPlan")return json({ok:true,plan:await upsertChefPlan(user,body?.plan||{})});
    if(action==="completePlan")return json({ok:true,plan:await completeChefPlan(user,body?.id)});
    if(action==="deletePlan")return json({ok:true,...await deleteChefPlan(user,body?.id)});
    if(action==="subscribePush"){await upsertChefPush(req,body?.subscription);return json({ok:true})}
    return json({ok:false,error:"UNKNOWN_ACTION"},400);
  }catch(error){
    const code=error instanceof Error?error.message:"SERVER_ERROR";
    const status=["ADMIN_REQUIRED","ORDER_PERMISSION_REQUIRED"].includes(code)?403:["NO_ORDER_ITEMS","NO_OPEN_ORDER_ITEMS","MULTIPLE_SUPPLIERS","ITEM_NAME_REQUIRED","USER_FIELDS_REQUIRED","PIN_TOO_SHORT","USERNAME_EXISTS","PLAN_FIELDS_REQUIRED","PLAN_NOT_FOUND"].includes(code)?400:500;
    if(status===500)console.error("[bb-chef]",error); return json({ok:false,error:code},status);
  }
}
