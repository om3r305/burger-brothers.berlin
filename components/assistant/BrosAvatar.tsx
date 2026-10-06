"use client";

import { useId } from "react";

/** Rigged vector character: no video download, canvas loop or extra image requests. */
export default function BrosAvatar({ state = "idle", size = 72 }: {
  state?: "idle" | "greeting" | "speaking" | "thinking" | "listening";
  size?: number;
}) {
  const id = useId().replace(/:/g, "");
  return (
    <span className="bb-bros" data-state={state} aria-hidden="true" style={{ width:size, height:size }}>
      <span className="bb-bros-aura" />
      <span className="bb-bros-laser bb-bros-laser-one" /><span className="bb-bros-laser bb-bros-laser-two" />
      <span className="bb-bros-character">
        <svg viewBox="0 0 200 210" fill="none" focusable="false">
          <defs>
            <linearGradient id={`${id}-bun`} x1="100" y1="42" x2="100" y2="103" gradientUnits="userSpaceOnUse"><stop stopColor="#ffe6a0"/><stop offset=".42" stopColor="#f5b443"/><stop offset="1" stopColor="#cb7023"/></linearGradient>
            <linearGradient id={`${id}-base`} x1="100" y1="137" x2="100" y2="164" gradientUnits="userSpaceOnUse"><stop stopColor="#f8c361"/><stop offset="1" stopColor="#c97425"/></linearGradient>
          </defs>
          <ellipse cx="100" cy="196" rx="56" ry="5" fill="#000" opacity=".18"/>
          <path className="bb-bros-costume bb-bros-cape" d="M49 91 22 174 64 166 99 178 138 166 180 175 151 92Z" fill="#6539a1" stroke="#b584ea" strokeWidth="3"/>
          <g className="bb-bros-leg-left"><path d="M75 155 69 181" stroke="#653d23" strokeWidth="12" strokeLinecap="round"/><path d="M67 177c-15-2-22 6-23 13 10 7 25 7 38 2l-3-11Z" fill="#ef6548" stroke="#462e29" strokeWidth="3"/><path d="m46 190 35 2" stroke="#fff4de" strokeWidth="5" strokeLinecap="round"/></g>
          <g className="bb-bros-leg-right"><path d="m126 155 7 26" stroke="#653d23" strokeWidth="12" strokeLinecap="round"/><path d="M133 177c15-2 22 6 23 13-10 7-25 7-38 2l3-11Z" fill="#ef6548" stroke="#462e29" strokeWidth="3"/><path d="m120 192 35-2" stroke="#fff4de" strokeWidth="5" strokeLinecap="round"/></g>
          <g className="bb-bros-wave"><path d="M47 113c-14 2-20-6-20-20" stroke="#744a2b" strokeWidth="9" strokeLinecap="round"/><path d="M29 94c-7 2-12-1-15-8L8 74c-2-5 4-8 7-3l4 6-5-17c-1-5 5-7 7-2l5 14-1-18c0-5 6-5 7 0l1 19 5-13c2-5 8-2 6 3l-6 16c9-6 15 0 8 6l-9 8Z" fill="#fff9e9" stroke="#bba586" strokeWidth="2.5"/></g>
          <g className="bb-bros-arm-right"><path d="M153 114c17 2 19 13 17 24" stroke="#744a2b" strokeWidth="9" strokeLinecap="round"/><path d="M164 132c-11-3-16 7-8 14l7 7c6 6 20-1 20-11 0-7-6-12-10-7" fill="#fff9e9" stroke="#bba586" strokeWidth="2.5"/></g>
          <path d="M45 139h110c0 17-13 25-55 25s-55-8-55-25Z" fill={`url(#${id}-base)`} stroke="#8a461d" strokeWidth="3"/>
          <rect x="40" y="120" width="120" height="21" rx="10" fill="#603120" stroke="#392319" strokeWidth="3"/>
          <path d="m42 118 25-6 29 4 30-4 30 7-17 14-18-7-18 13-18-11-25 4Z" fill="#ffc831" stroke="#d88e1f" strokeWidth="2"/>
          <rect x="41" y="103" width="118" height="12" rx="6" fill="#ef5945" stroke="#a23026" strokeWidth="2"/>
          <path d="M40 98c10-13 19 8 29-4 10-11 20 9 31-2 12-10 21 10 31 1 10-10 20 8 29 5l-1 10c-12 9-22-5-32 4-11 9-17-6-28 2-11 8-16-8-29-1-12 7-19-5-29-4Z" fill="#76b53e" stroke="#386829" strokeWidth="2.5"/>
          <path d="M43 92c0-30 22-49 57-49s57 19 57 49c-25 13-89 13-114 0Z" fill={`url(#${id}-bun)`} stroke="#9e5824" strokeWidth="3"/>
          <g stroke="#fff0bf" strokeWidth="3.5" strokeLinecap="round"><path d="m65 59 4-2m16-7 3 1m18-1 3 2m15 2 4 2m13 7 3 2M56 71l3-1m39-11 3 1m19 5 2 1"/></g>
          <g className="bb-bros-eyes"><ellipse cx="80" cy="77" rx="10" ry="12" fill="#fffaf1"/><ellipse cx="122" cy="77" rx="10" ry="12" fill="#fffaf1"/><g className="bb-bros-pupils"><ellipse cx="82" cy="79" rx="5" ry="7" fill="#36271f"/><ellipse cx="120" cy="79" rx="5" ry="7" fill="#36271f"/><circle cx="83" cy="76" r="2" fill="white"/><circle cx="121" cy="76" r="2" fill="white"/></g></g>
          <ellipse cx="65" cy="90" rx="7" ry="3.5" fill="#ef8850"/><ellipse cx="138" cy="90" rx="7" ry="3.5" fill="#ef8850"/>
          <path className="bb-bros-smile" d="M88 90q13 13 26 0" stroke="#633321" strokeWidth="3" strokeLinecap="round"/>
          <g className="bb-bros-mouth"><ellipse cx="101" cy="94" rx="10" ry="8" fill="#653326"/><path d="M93 89h16v3H93Z" fill="#fffaf0"/><ellipse cx="101" cy="99" rx="6" ry="3" fill="#ee8076"/></g>
          <g className="bb-bros-costume bb-bros-witch"><path d="m57 49 24-38 23 10 11-8 24 37Z" fill="#462d68" stroke="#bc81ee" strokeWidth="3"/><path d="m76 35 53 7-2 10-57-7Z" fill="#f19d31"/><path d="M51 48q49-10 97 5-45 13-97-5Z" fill="#462d68" stroke="#bc81ee" strokeWidth="3"/><path d="m105 37 9 1-1 9-10-1Z" stroke="#ffe7a1" strokeWidth="3"/><path d="m90 20 3 7 7 2-7 2-2 7-2-7-7-2 7-2Z" fill="#ffdf7c"/></g>
          <g className="bb-bros-costume bb-bros-pumpkin"><path d="M154 150c-13-5-17 8-15 18 3 13 27 15 31 1 3-9-1-22-13-19Z" fill="#f99b21" stroke="#ad561a" strokeWidth="2"/><path d="m154 150 2-7" stroke="#6c932c" strokeWidth="4"/><path d="m145 159 5 4-6 1m19-5-5 4 6 1m-17 6 6 4 6-4" stroke="#5c3320" strokeWidth="3"/></g>
          <g className="bb-bros-costume bb-bros-santa"><path d="M56 48C75 11 120 12 144 36l-15 7c-15-12-29-8-33 4Z" fill="#db4b46" stroke="#8e272c" strokeWidth="3"/><path d="M58 43q38-13 76 0l-2 12q-36-10-74 0Z" fill="#fff8e8" stroke="#dbc8a9" strokeWidth="2"/><circle cx="145" cy="39" r="10" fill="#fff8e8"/></g>
          <g className="bb-bros-costume bb-bros-scarf"><path d="M59 117q41 15 83 0l-1 10q-40 14-82 0Z" fill="#df5550"/><path d="m135 123-7 29 15 3 6-31Z" fill="#df5550"/><path d="m130 141 16 4m-17 3 16 4" stroke="#fff0d2" strokeWidth="3"/></g>
          <g className="bb-bros-costume bb-bros-leaves" fill="#6fbf56" stroke="#286b37" strokeWidth="2"><path d="M65 48c-6-21 11-22 15-13 5-24 27-21 28-2 17-19 33-8 24 13Z"/><path d="m78 42 17-10m8 12 7-16m5 15 12-5" stroke="#d7f5b9"/></g>
          <g className="bb-bros-costume bb-bros-glasses"><path d="M61 71h33v15H65ZM109 71h32l-4 15h-28Z" fill="#25364b" stroke="#f2d16b" strokeWidth="3"/><path d="M94 75h15" stroke="#f2d16b" strokeWidth="3"/><path d="m69 75 13 8m35-8 13 8" stroke="#73e3f0" strokeWidth="2"/></g>
          <g className="bb-bros-costume bb-bros-bunny" fill="#fff0d7" stroke="#c39a6b" strokeWidth="2"><ellipse cx="80" cy="27" rx="10" ry="23" transform="rotate(-15 80 27)"/><ellipse cx="120" cy="27" rx="10" ry="23" transform="rotate(15 120 27)"/><path d="M79 15v24m42-24v24" stroke="#ee9ca4" strokeWidth="5"/></g>
          <g className="bb-bros-costume bb-bros-party"><path d="m79 46 21-37 21 37Z" fill="#9c67d5" stroke="#f9df79" strokeWidth="2"/><path d="m93 25 18 9m-24 3 29 6" stroke="#f9df79" strokeWidth="4"/><circle cx="100" cy="9" r="5" fill="#f9df79"/></g>
          <g className="bb-bros-costume bb-bros-flowers"><path d="M68 44q31-13 64 0" stroke="#64a445" strokeWidth="4"/>{[74,100,127].map(x=><g key={x} fill="#ee8aad"><circle cx={x} cy="37" r="8"/><circle cx={x} cy="37" r="3" fill="#fff2a4"/></g>)}</g>
          <g className="bb-bros-costume bb-bros-crescent"><path d="M133 61a13 13 0 1 1 0-24 10 10 0 1 0 0 24Z" fill="#ffe28c"/><path d="m141 36 2 5 5 1-4 3v5l-4-3-5 1 2-5-3-4 5 1Z" fill="#ffe28c"/></g>
          <g className="bb-bros-costume bb-bros-beanie"><path d="M64 42c0-36 72-36 72 0Z" fill="#68acc6" stroke="#276376" strokeWidth="3"/><path d="M60 39h80v13H60Z" fill="#9ad8dc" stroke="#276376" strokeWidth="2"/><circle cx="100" cy="15" r="8" fill="#def4ed"/></g>
          <g className="bb-bros-costume bb-bros-bow"><path d="m99 128-18-9v21l18-8 21 8v-21Z" fill="#e27857" stroke="#71382c" strokeWidth="2"/><circle cx="100" cy="130" r="5" fill="#ffcc72"/></g>
          <g className="bb-bros-costume bb-bros-school"><path d="m54 37 46-17 46 17-46 18Z" fill="#3b455c" stroke="#eccc75" strokeWidth="2"/><path d="M141 38v22" stroke="#eccc75" strokeWidth="3"/></g>
          <g className="bb-bros-costume bb-bros-tyrol"><path d="m68 42 5-22 35 4 20 22Z" fill="#5b8d60" stroke="#355838" strokeWidth="2"/><path d="M55 46q43-17 87 2" stroke="#355838" strokeWidth="8" strokeLinecap="round"/><path d="m122 41 11-21" stroke="#ffe5a7" strokeWidth="4"/></g>
          <g className="bb-bros-costume bb-bros-badge"><circle cx="146" cy="124" r="13" fill="var(--bb-accent-2, #ffca55)" stroke="#8c572d" strokeWidth="2"/><path className="bb-bros-badge-star" d="m146 114 3 7 7 1-5 5 1 7-6-4-6 4 1-7-5-5 7-1Z" fill="#704328"/><path className="bb-bros-badge-cross" d="M143 115h6v6h6v6h-6v6h-6v-6h-6v-6h6Z" fill="#dc4949"/></g>
          <g className="bb-bros-costume bb-bros-heart" fill="#ec6c93"><path d="M100 128c-18-15-25 9 0 20 25-11 18-35 0-20Z"/></g>
          <g className="bb-bros-costume bb-bros-football"><circle cx="148" cy="147" r="13" fill="#fff3d9" stroke="#514b44" strokeWidth="2"/><path d="m148 141 6 5-2 7h-8l-2-7Z" fill="#514b44"/></g>
          <g className="bb-bros-costume bb-bros-apron"><path d="M71 136h59v17H71Z" fill="#fff0cf" stroke="#8f6442" strokeWidth="2"/><path d="M86 145h28" stroke="#dc8639" strokeWidth="3"/></g>
        </svg>
      </span>
    </span>
  );
}
