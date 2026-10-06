"use client";
import { useCallback,useEffect,useRef,useState } from "react";
import { brosThemeNote,normalizeBrosTheme,type BrosTheme } from "@/lib/assistant/bros-themes";

export type BrosAction="idle"|"walk"|"wave"|"look"|"stretch"|"showcase";
const HELLO="Hallo, herzlich willkommen! Ich bin Bros. Brauchst du Hilfe beim Bestellen? Tippe einfach auf mich.";
export function useBrosCompanion(active:boolean,guides:boolean,blocked:boolean) {
  const [theme,setTheme]=useState<BrosTheme>("classic");
  const [awake,setAwake]=useState(true);
  const [bubble,setBubble]=useState("");
  const [action,setAction]=useState<BrosAction>("idle");
  const muted=useRef(false);
  const hideBubble=useCallback(()=>{ muted.current=true; setBubble(""); setAction("idle"); },[]);
  useEffect(()=>{
    const sync=()=>setTheme(normalizeBrosTheme(document.documentElement.getAttribute("data-bb-theme")));
    const visibility=()=>setAwake(!document.hidden);
    sync();visibility();
    const observer=new MutationObserver(sync);
    observer.observe(document.documentElement,{attributes:true,attributeFilter:["data-bb-theme"]});
    document.addEventListener("visibilitychange",visibility);
    return ()=>{observer.disconnect();document.removeEventListener("visibilitychange",visibility);};
  },[]);
  useEffect(()=>{
    setBubble("");setAction("idle");
    if(!active || !awake || blocked) return;
    const timers=new Set<number>();
    const later=(ms:number,fn:()=>void)=>{const id=window.setTimeout(()=>{timers.delete(id);fn();},ms);timers.add(id);};
    const note=brosThemeNote(theme);
    const introKey="bb_bros_companion_intro_v3";
    const noteKey="bb_bros_companion_theme_v2";
    let introduced=false,topicSeen=false;
    try {introduced=localStorage.getItem(introKey)==="1";topicSeen=localStorage.getItem(noteKey)===`${note.day}:${theme}`;} catch {}
    if(guides && !introduced && !muted.current) {
      later(900,()=>{if(muted.current)return;setBubble(HELLO);setAction("wave");try{localStorage.setItem(introKey,"1");}catch{}});
      later(8500,()=>{setBubble("");setAction("idle");});
    }
    if(guides && !topicSeen && !muted.current && theme!=="classic") {
      later(introduced?6000:14000,()=>{
        if(muted.current || document.activeElement?.matches("input,textarea,select"))return;
        setBubble(note.text);setAction("showcase");
        try{localStorage.setItem(noteKey,`${note.day}:${theme}`);}catch{}
      });
      later(introduced?13000:21000,()=>{setBubble("");setAction("idle");});
    }
    let cycle=0;
    const idle=window.setInterval(()=>{
      if(document.activeElement?.matches("input,textarea,select"))return;
      const routine: BrosAction[]=["walk","look","stretch","walk","wave"];
      cycle++;
      const show=cycle%4===0 && theme!=="classic";
      setAction(show?"showcase":routine[(cycle-1)%routine.length]);
      later(show?7000:3200,()=>setAction("idle"));
    },26000);
    return ()=>{timers.forEach(window.clearTimeout);window.clearInterval(idle);};
  },[active,guides,awake,blocked,theme]);
  return {theme,bubble,action,hideBubble,effect:brosThemeNote(theme).effect};
}
