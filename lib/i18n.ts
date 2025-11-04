// lib/i18n.ts
import de from "@/i18n/de.json";

type Dict = typeof de;
const dict: Dict = de;

export function t(path: string, vars?: Record<string, string | number>): string {
  const segs = path.split(".");
  let cur: any = dict;
  for (const s of segs) {
    if (cur && typeof cur === "object" && s in cur) cur = cur[s];
    else return path; // fallback to key
  }
  let out = String(cur);
  if (vars) {
    for (const [k,v] of Object.entries(vars)) {
      out = out.replace(new RegExp(`{{${k}}}`,'g'), String(v));
    }
  }
  return out;
}
