"use client";
import type { BrosTheme } from "@/lib/assistant/bros-themes";

// Props live in the character's SVG rig, not in floating emoji cards.
export const BROS_THEME_GESTURES: Record<BrosTheme, string> = {
  classic:"serve", lights:"project", neon:"prism", retrowave:"cassette",
  halloween:"pumpkin", christmas:"decorate", weihnachten:"unwrap", veganweek:"grow",
  autumn:"catch-leaf", winter:"snowglobe", newyear:"launch", anniversary:"candles",
  valentines:"draw-heart", womensday:"offer-tulips", mothersday:"offer-bouquet",
  fathersday:"bow-gift", easter:"paint-egg", summer:"cool-drink", school:"open-report",
  fan:"kick-ball", germany:"wave-flag", oktoberfest:"offer-pretzel", blackweek:"show-tag",
  medicine:"check-heart", ramadan:"raise-lantern", arcade:"play", popart:"comic-pose",
};
const heart = "M0 6C-18-12-29 12 0 29C29 12 18-12 0 6Z";
function Flowers({tulips=false}:{tulips?:boolean}) {
 return <g><path d="m147 146 14-29m-14 29-5-32m5 32 1-36" stroke="#4d9852" strokeWidth="3"/>
 {[[-5,4],[9,2],[0,-4]].map(([x,y],i)=><g key={i} transform={`translate(${148+x} ${110+y})`}>
 {tulips?<path d="M-7-3-4 1 0-5 4 1 7-3v7C7 13-7 13-7 4Z" fill={["#ef87b3","#ffbc67","#bc99e7"][i]}/>:<g fill={["#ee87b1","#f8a685","#c099e9"][i]}><circle cx="-5" cy="0" r="5"/><circle cx="5" cy="0" r="5"/><circle cx="0" cy="-5" r="5"/><circle cx="0" cy="5" r="5"/><circle r="3" fill="#ffe9a3"/></g>}
 </g>)}<path d="m135 130 13 25 17-25-17 7Z" fill="#fce5c1" stroke="#c38e73" strokeWidth="2"/><path d="m140 147 14-1" stroke="#ef7a9a" strokeWidth="4"/></g>;
}
function Gift({color="#e96d8d"}:{color?:string}) {return <g><rect x="133" y="124" width="36" height="30" rx="4" fill={color} stroke="#744238" strokeWidth="2"/><path d="M151 124v30" stroke="#ffe6a0" strokeWidth="5"/><g className="bb-bros-gift-lid"><rect x="130" y="118" width="42" height="9" rx="3" fill={color} stroke="#744238" strokeWidth="2"/><path d="M151 118c-19-15-20 5 0 0 20 5 19-15 0 0Z" stroke="#ffe6a0" strokeWidth="3"/></g></g>;}
export default function BrosThemeProps({theme,performing}:{theme:BrosTheme;performing:boolean}) {
 const gesture=BROS_THEME_GESTURES[theme];
 return <>
 {theme==="medicine"?<g data-costume="doctor"><path d="m52 112 25 8 23 19 23-19 25-8 7 45H45Z" fill="#fffaf0" stroke="#a9c9cf" strokeWidth="2"/><path d="m77 120 7 25 16-6 16 6 7-25M100 139v19" stroke="#92bbc5" strokeWidth="2"/><path d="M68 118v12c0 17 20 17 20 0v-7m-10 20v8h47v-12" stroke="#425b6b" strokeWidth="3"/><circle cx="125" cy="136" r="5" fill="#aed5dc" stroke="#425b6b" strokeWidth="2"/></g>:null}
 {theme==="school"?<g data-costume="backpack"><path d="M46 111h14v44H46a7 7 0 0 1-7-7v-30a7 7 0 0 1 7-7Z" fill="#7486d0" stroke="#414878" strokeWidth="2"/><path d="M48 119h10v19H48Z" fill="#a3b5ee"/></g>:null}
 {theme==="veganweek"?<g data-costume="garden-apron"><path d="M72 121h56v35H72Z" fill="#2a8258" stroke="#b4e994" strokeWidth="2"/><path d="M100 146v-13m0 8c-12 0-12-12 0-8 12-4 12 8 0 8Z" stroke="#d8f2aa" strokeWidth="2"/></g>:null}
 {performing && theme!=="lights" ? <g className="bb-bros-theme-gesture" data-gesture={gesture} strokeLinejoin="round" strokeLinecap="round">
 {theme==="mothersday"||theme==="womensday"?<Flowers tulips={theme==="womensday"}/>:null}
 {theme==="valentines"?<g><path className="bb-bros-drawn-heart" d={heart} transform="translate(152 116) scale(.8)" stroke="#ff91b8" strokeWidth="3" fill="#ee648d" fillOpacity=".2"/><path d="m136 144 7-6" stroke="#fff4df" strokeWidth="6"/></g>:null}
 {theme==="medicine"?<g><rect x="134" y="112" width="36" height="43" rx="4" fill="#eaf7f7" stroke="#759ca9" strokeWidth="2"/><rect x="144" y="108" width="16" height="7" rx="2" fill="#849eaf"/><path className="bb-bros-heartbeat" d="M138 133h6l3-7 5 15 4-10 3 2h7" stroke="#d7647d" strokeWidth="2"/><path d="M140 148h23" stroke="#a8c4cf" strokeWidth="2"/></g>:null}
 {theme==="school"?<g className="bb-bros-report"><path d="M127 119q12-6 25 0v38q-13-6-25 0Zm25 0q12-6 25 0v38q-13-6-25 0Z" fill="#fff1cb" stroke="#ad844e" strokeWidth="2"/><path d="M133 129h12m-12 7h12m-12 7h8m18-13 5 5 8-10" stroke="#83a86e" strokeWidth="2"/><path d="M152 119v38" stroke="#d7b777" strokeWidth="2"/></g>:null}
 {theme==="veganweek"?<g><path d="M134 142h35l-5 17h-25Z" fill="#cd9068" stroke="#845539" strokeWidth="2"/><g className="bb-bros-growing-leaf"><path d="M151 144v-23" stroke="#66aa54" strokeWidth="3"/><path d="M151 134c-23-2-18-20-1-9 13-21 27-9 1 9Z" fill="#91d571" stroke="#4b9653" strokeWidth="2"/></g></g>:null}
 {theme==="weihnachten"||theme==="fathersday"?<Gift color={theme==="fathersday"?"#648db8":"#dc6666"}/>:null}
 {theme==="christmas"?<g><path d="m151 110-18 31h10l-17 15h50l-17-15h10Z" fill="#4e9764" stroke="#b5dba0" strokeWidth="2"/><path d="m151 101 3 6 7 1-5 4 1 7-6-3-6 3 1-7-5-4 7-1Z" fill="#ffe6a0"/><g className="bb-bros-tree-bulbs" fill="#f6b476"><circle cx="146" cy="131" r="3"/><circle cx="159" cy="143" r="3"/><circle cx="141" cy="150" r="3"/></g></g>:null}
 {theme==="halloween"?<g className="bb-bros-magic-pumpkin"><path d="M135 125c-14 17-5 30 15 29 23 1 30-17 14-29-8-6-12 4-15 1-5-3-9-6-14-1Z" fill="#ee972d" stroke="#a95e32" strokeWidth="2"/><path d="m150 125 3-9" stroke="#6b9452" strokeWidth="4"/><path d="m140 134 6 5h-8m24-5-6 5h8m-23 5 9 5 9-5" stroke="#673b2d" strokeWidth="2"/></g>:null}
 {theme==="anniversary"?<g><rect x="133" y="132" width="37" height="24" rx="4" fill="#bd8055"/><path d="M133 135c5-10 10 8 18 0 7-8 13 8 19-1" stroke="#fff0d0" strokeWidth="5"/><path d="M144 130v-11m16 11v-11" stroke="#be91d4" strokeWidth="3"/><g className="bb-bros-candle-flames" fill="#ffd879"><path d="M144 117c-9-3-1-12 0-12 2 2 8 10 0 12Zm16 0c-9-3-1-12 0-12 2 2 8 10 0 12Z"/></g></g>:null}
 {theme==="winter"?<g><circle cx="152" cy="133" r="23" fill="#bfdff2" fillOpacity=".5" stroke="#d0e9ee" strokeWidth="2"/><circle cx="152" cy="133" r="7" fill="#fffaeb"/><circle cx="152" cy="145" r="10" fill="#fffaeb"/><path d="m152 130 6 3-6 2" fill="#ec9c57"/><path d="M133 156h38" stroke="#8698be" strokeWidth="6"/></g>:null}
 {theme==="autumn"?<g className="bb-bros-caught-leaf"><path d="M145 147c-26-3-22-30-1-38 24 9 27 33 1 38Z" fill="#df9946" stroke="#975e39" strokeWidth="2"/><path d="m145 151-1-36m0 15-10-8m10 17 11-9" stroke="#f6d37b" strokeWidth="2"/></g>:null}
 {theme==="easter"?<g className="bb-bros-painted-egg"><ellipse cx="152" cy="135" rx="17" ry="23" fill="#e6b4e7" stroke="#98689e" strokeWidth="2"/><path d="m137 134 8-5 8 5 8-5 8 5m-28 12h24" stroke="#fff0b7" strokeWidth="3"/></g>:null}
 {theme==="summer"?<g><path d="m140 121 4 34h18l5-34Z" fill="#f1c668" stroke="#e9e5bf" strokeWidth="2"/><path d="M143 132h21" stroke="#ed9164" strokeWidth="7"/><path d="m155 150 2-37 10-4" stroke="#a1d3d2" strokeWidth="3"/><circle cx="141" cy="121" r="7" fill="#e9e286"/></g>:null}
 {theme==="fan"?<g className="bb-bros-kicked-ball"><circle cx="151" cy="162" r="18" fill="#fff7e7" stroke="#706760" strokeWidth="2"/><path d="m151 154 8 6-3 9h-10l-3-9Z" fill="#56545f"/></g>:null}
 {theme==="germany"?<g><path d="M135 156v-46" stroke="#d5b587" strokeWidth="3"/><path d="M137 111h36v9h-36Z" fill="#33343a"/><path d="M137 120h36v9h-36Z" fill="#d85858"/><path d="M137 129h36v9h-36Z" fill="#f5ce66"/></g>:null}
 {theme==="oktoberfest"?<g><path d="M150 133c-18-32-41 13-16 18 20 4 16-31 30-23 21 12-2 35-20 19-17-15 20-20 24-4" stroke="#a96934" strokeWidth="9" fill="none"/><path d="m135 137 2 2m20-6 2 2m3 13 2 1" stroke="#ffebbe" strokeWidth="2"/></g>:null}
 {theme==="blackweek"?<g><path d="m132 120 14-8 25 27-21 20-24-26Z" fill="#b189d7" stroke="#704a96" strokeWidth="2"/><circle cx="137" cy="125" r="3" fill="#ffeac9"/><path d="m144 141 13-6m-8-3 1 1m3 13 1 1" stroke="#fff1d5" strokeWidth="3"/></g>:null}
 {theme==="ramadan"?<g><path d="M144 118v-7c0-10 16-10 16 0v7" stroke="#d6ba76" strokeWidth="2"/><path d="m136 125 16-9 16 9-3 27h-26Z" fill="#e0bb6b" stroke="#987042" strokeWidth="2"/><path d="M144 128v19h16v-19Z" fill="#fff0a3"/><path d="M151 127v21" stroke="#d8ac63" strokeWidth="2"/></g>:null}
 {theme==="arcade"?<g><rect x="129" y="129" width="47" height="23" rx="9" fill="#7c83b9" stroke="#47486f" strokeWidth="2"/><path d="M141 134v13m-6-6h12" stroke="#ece3cd" strokeWidth="3"/><circle cx="161" cy="138" r="3" fill="#e8909d"/><circle cx="168" cy="144" r="3" fill="#b5d390"/></g>:null}
 {theme==="retrowave"?<g><rect x="129" y="125" width="45" height="29" rx="4" fill="#bc81c4" stroke="#744f88" strokeWidth="2"/><path d="M134 133h35v10h-35Z" fill="#efbd98"/><circle cx="141" cy="138" r="4" fill="#6a597c"/><circle cx="162" cy="138" r="4" fill="#6a597c"/></g>:null}
 {theme==="neon"?<g><path className="bb-bros-prism" d="m151 111 23 19-23 27-23-27Z" fill="#76d7e7" fillOpacity=".7" stroke="#dbb0f6" strokeWidth="2"/><path d="m128 130 23 7 23-7m-23 7v20" stroke="#e9d5ff" strokeWidth="2"/></g>:null}
 {theme==="newyear"?<g className="bb-bros-hand-rocket"><path d="m143 135 9-22 9 22-9 6Z" fill="#e5a0af" stroke="#975f85" strokeWidth="2"/><path d="m146 138 6 13 6-13" fill="#ffdd85"/></g>:null}
 {theme==="popart"?<g><path d="m135 113 10 7 10-11 6 12 16-2-7 13 9 9-16 2-2 15-11-10-13 7 2-15-12-7 12-8Z" fill="#f2d46d" stroke="#cb648d" strokeWidth="3"/><path d="M153 123v13m0 6v1" stroke="#74618d" strokeWidth="3"/></g>:null}
 {theme==="classic"?<g><path d="m140 155 12-24" stroke="#bc9571" strokeWidth="4"/><path d="m144 121 17 8 7-15-17-8Z" fill="#d1d7da" stroke="#6e7f88" strokeWidth="2"/><path d="m152 113 8 4m-11 1 8 4" stroke="#89979c" strokeWidth="2"/></g>:null}
 </g>:null}
 {performing && theme==="valentines"?<g className="bb-bros-heart-eyes" fill="#ec678f"><path d={heart} transform="translate(80 71) scale(.3)"/><path d={heart} transform="translate(122 71) scale(.3)"/></g>:null}
 </>;
}
