"use client";

import type { CSSProperties } from "react";
import type { BrosTheme, BrosEffect } from "@/lib/assistant/bros-themes";

// Every calendar theme has its own centrepiece, even when it shares a particle family.
export const BROS_SCENE_MOTIFS: Record<BrosTheme, string> = {
  classic:"🍔", lights:"✨", neon:"💎", retrowave:"📼", halloween:"🎃",
  christmas:"🎄", weihnachten:"🎁", veganweek:"🌱", autumn:"🍂", winter:"⛄",
  newyear:"🎆", anniversary:"🎂", valentines:"💝", womensday:"🌷", mothersday:"💐",
  fathersday:"🎩", easter:"🐣", summer:"☀️", school:"🎒", fan:"⚽", germany:"🇩🇪",
  oktoberfest:"🥨", blackweek:"🏷️", medicine:"🩺", ramadan:"🌙", arcade:"👾", popart:"💥",
};

export default function BrosThemeShow({theme,effect}:{theme:BrosTheme;effect:BrosEffect}) {
  return <span className="bb-bros-scene" data-scene={theme} data-effect={effect} aria-hidden="true">
    <span className="bb-bros-scene-floor" />
    {effect==="beam" ? <svg className="bb-bros-light-stage" viewBox="0 0 160 140" fill="none" focusable="false">
      <ellipse cx="80" cy="123" rx="36" ry="7" fill="#302341"/>
      <g className="bb-bros-stage-beam bb-bros-stage-beam-one"><path d="M80 111 8 10 85 2Z" fill="#b779ed" fillOpacity=".28"/><path d="m80 111-52-97" stroke="#cf9aff" strokeWidth="2"/></g>
      <g className="bb-bros-stage-beam bb-bros-stage-beam-two"><path d="m80 111 8-109 65 12Z" fill="#65e7ef" fillOpacity=".25"/><path d="m80 111 51-91" stroke="#8bf4ff" strokeWidth="2"/></g>
      <g className="bb-bros-stage-beam bb-bros-stage-beam-three"><path d="M80 111 31 11h102Z" fill="#f5e18a" fillOpacity=".17"/></g>
      <rect x="61" y="104" width="38" height="17" rx="6" fill="#3d3654" stroke="#aa83d6" strokeWidth="2"/>
      <circle cx="80" cy="110" r="5" fill="#e5ffff"/>
      <path d="M67 124h26" stroke="#8a718c" strokeWidth="4" strokeLinecap="round"/>
    </svg> : null}
    {effect==="snow" && <svg className="bb-bros-scene-tree" viewBox="0 0 80 110" fill="none" focusable="false"><path d="m40 13-19 28h9L12 66h13L5 91h70L55 66h13L50 41h9Z" fill="#398458" stroke="#8bd3a0" strokeWidth="2"/><path d="M35 91h10v15H35Z" fill="#a97a45"/><path d="m40 3 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1Z" fill="#ffe58a"/><g fill="#ffc17c"><circle cx="36" cy="35" r="3"/><circle cx="47" cy="52" r="3"/><circle cx="28" cy="70" r="3"/><circle cx="54" cy="82" r="3"/></g></svg>}
    {effect==="fireworks" && <svg className="bb-bros-scene-rocket" viewBox="0 0 24 40" focusable="false"><path d="m4 25 8-24 8 24-8 7Z" fill="#cf8ebe"/><path d="m7 30 5 10 5-10" fill="#ffdf82"/></svg>}
    {Array.from({length:8},(_,i)=><i className="bb-bros-scene-particle" key={i} style={{"--bros-particle":i} as CSSProperties}>
      {effect==="bats" ? <svg viewBox="0 0 32 20" focusable="false"><path className="bb-bros-bat-wing" d="M16 9 4 1 1 12 7 10 11 16Z" fill="#b899ef"/><path className="bb-bros-bat-wing" d="M16 9 28 1 31 12 25 10 21 16Z" fill="#b899ef"/><path d="m12 6 1-5 3 4 3-4 1 5v8l-4 5-4-5Z" fill="#594277"/></svg> : effect==="snow"?"❄":effect==="leaves"?<svg viewBox="0 0 32 24" focusable="false"><path d="M4 21C0 0 18 0 30 3 29 18 16 24 4 21Z" fill="#87c46c"/><path d="m4 21 18-12" stroke="#d8f2ae" strokeWidth="2"/></svg>:effect==="hearts"?"♥":"✦"}
    </i>)}
  </span>;
}
