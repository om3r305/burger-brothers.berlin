"use client";
import { create } from "zustand";

export type Extra = { id:string; label:string; price:number };
export type ItemLine = {
  id: string;
  sku: string;
  name: string;
  price: number;
  qty: number;
  removes?: string[];
  extras?: Extra[];
  note?: string;
  labelAddon?: string;
};

type State = {
  lines: ItemLine[];
  addLine: (line: ItemLine)=>void;
  removeLine: (id: string)=>void;
  clear: ()=>void;
};

export const useCart = create<State>((set)=> ({
  lines: [],
  addLine: (line)=> set(s=> ({ lines: [...s.lines, line] })),
  removeLine: (id)=> set(s=> ({ lines: s.lines.filter(l=>l.id!==id) })),
  clear: ()=> set({ lines: [] }),
}));
