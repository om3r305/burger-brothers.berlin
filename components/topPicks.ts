export function getTopBadge(name:string){
  if (typeof window === "undefined") return null;
  try{
    const counts = JSON.parse(localStorage.getItem("bb_sales")||"{}");
    const val = counts[name] || 0;
    if (val >= 10) return "🔥 Bestseller";
    if (val >= 5) return "⭐ Top";
    return null;
  }catch{ return null; }
}
