"use client";

import type { BurgerStudioConfig, BurgerStudioRecipe } from "@/lib/burger-studio";

function layerClass(group: string, visual?: string) {
  const key = String(visual || "").toLowerCase();
  if (group === "protein") return key.includes("crispy") ? "bs-layer--crispy" : key.includes("vegan") ? "bs-layer--vegan" : "bs-layer--beef";
  if (group === "cheese") return "bs-layer--cheese";
  if (group === "sauce") return key.includes("avocado") ? "bs-layer--avocado" : key.includes("bbq") ? "bs-layer--bbq" : "bs-layer--sauce";
  if (key.includes("lettuce") || key.includes("salat")) return "bs-layer--lettuce";
  if (key.includes("tomato") || key.includes("tomate")) return "bs-layer--tomato";
  if (key.includes("pickle") || key.includes("gurke")) return "bs-layer--pickle";
  if (key.includes("bacon")) return "bs-layer--bacon";
  if (key.includes("guacamole")) return "bs-layer--guacamole";
  if (key.includes("jalap")) return "bs-layer--jalapeno";
  if (key.includes("onion") || key.includes("zwiebel")) return "bs-layer--onion";
  return "bs-layer--topping";
}

export default function BurgerStack({ config, recipe }: { config: BurgerStudioConfig; recipe: BurgerStudioRecipe }) {
  const ingredientMap = new Map(config.ingredients.map((item) => [item.id, item]));
  const layers: Array<{ id: string; name: string; className: string; index: number }> = [];

  const groupOrder = ["sauce", "topping", "cheese", "protein"];
  let index = 0;
  for (const group of groupOrder) {
    for (const [id, qty] of Object.entries(recipe.ingredients)) {
      const ingredient = ingredientMap.get(id);
      if (!ingredient || ingredient.group !== group) continue;
      for (let unit = 0; unit < qty; unit += 1) {
        layers.push({
          id: `${id}-${unit}`,
          name: ingredient.name,
          className: layerClass(ingredient.group, ingredient.visual),
          index: index++,
        });
      }
    }
  }

  return (
    <div className="bs-stage" aria-label="Dein Burger als Schichtansicht">
      <div className="bs-glow" />
      <div className="bs-stack">
        <div className="bs-layer bs-layer--bun-top" title="Bun" />
        {layers.map((layer) => (
          <div
            key={layer.id}
            className={`bs-layer ${layer.className}`}
            style={{ "--bs-i": layer.index } as React.CSSProperties}
            title={layer.name}
          >
            <span>{layer.name}</span>
          </div>
        ))}
        <div className="bs-layer bs-layer--bun-bottom" title="Bun" />
      </div>

      <style jsx>{`
        .bs-stage { position: relative; min-height: 330px; display: grid; place-items: center; overflow: hidden; border-radius: 30px; background: radial-gradient(circle at 50% 35%, rgba(251,191,36,.13), transparent 42%), linear-gradient(180deg, rgba(255,255,255,.035), rgba(0,0,0,.12)); border: 1px solid rgba(255,255,255,.08); }
        .bs-glow { position:absolute; width:210px; height:210px; border-radius:999px; background:rgba(245,158,11,.11); filter:blur(35px); }
        .bs-stack { position:relative; width:min(78vw,330px); height:280px; transform:perspective(760px) rotateX(7deg); }
        .bs-layer { position:absolute; left:50%; width:76%; height:28px; transform:translateX(-50%); border-radius:999px; box-shadow:0 12px 18px rgba(0,0,0,.26), inset 0 2px 3px rgba(255,255,255,.18); transition:all .28s cubic-bezier(.2,.85,.2,1); animation:bs-drop .34s both; }
        .bs-layer span { position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); opacity:0; pointer-events:none; white-space:nowrap; font-size:9px; font-weight:900; letter-spacing:.08em; }
        .bs-layer--bun-top { top:20px; height:66px; width:82%; border-radius:120px 120px 35px 35px; background:linear-gradient(#f8bf62,#d98929); border:2px solid rgba(255,214,141,.4); z-index:90; }
        .bs-layer--bun-top:after { content:""; position:absolute; inset:12px 28px 28px; background:radial-gradient(circle,#fff0c7 0 2px,transparent 3px); background-size:22px 18px; opacity:.7; }
        .bs-layer--bun-bottom { bottom:18px; height:48px; width:80%; border-radius:26px 26px 70px 70px; background:linear-gradient(#df9134,#b9671e); border:2px solid rgba(255,214,141,.3); z-index:2; }
        .bs-layer:not(.bs-layer--bun-top):not(.bs-layer--bun-bottom) { bottom:calc(64px + (var(--bs-i) * 18px)); z-index:calc(10 + var(--bs-i)); }
        .bs-layer--beef { height:34px; background:linear-gradient(#60311f,#2d160f 65%,#1d0e0a); border:2px solid #7d452e; }
        .bs-layer--crispy { height:38px; background:repeating-linear-gradient(135deg,#d58c28 0 8px,#f0ad3f 8px 13px,#b66a1c 13px 18px); border:2px solid #f2bd64; }
        .bs-layer--vegan { height:34px; background:linear-gradient(#41662f,#203a1c); border:2px solid #6f9653; }
        .bs-layer--cheese { width:70%; height:18px; border-radius:5px; background:#f3b61f; transform:translateX(-50%) rotate(-2deg); clip-path:polygon(2% 0,98% 4%,88% 100%,50% 72%,14% 100%); }
        .bs-layer--lettuce { height:20px; background:#64a735; clip-path:polygon(0 45%,8% 12%,17% 50%,27% 5%,37% 55%,48% 10%,58% 52%,69% 0,80% 48%,92% 9%,100% 45%,100% 80%,0 82%); }
        .bs-layer--tomato { height:17px; background:linear-gradient(#f04a36,#b9231f); border:2px solid #ff7565; }
        .bs-layer--pickle { height:15px; width:62%; background:repeating-linear-gradient(90deg,#7e9b2d 0 25px,#abc949 25px 47px); border:2px solid #bbd85c; }
        .bs-layer--bacon { height:16px; width:72%; border-radius:8px; background:repeating-linear-gradient(90deg,#7e2a20 0 18px,#d86b50 18px 31px,#f6aa8d 31px 37px); transform:translateX(-50%) rotate(2deg); }
        .bs-layer--guacamole,.bs-layer--avocado { height:18px; background:linear-gradient(#82a83b,#4f721d); }
        .bs-layer--jalapeno { height:14px; width:58%; background:repeating-radial-gradient(circle at 20% 50%,#c6e562 0 6px,#5a8f28 7px 12px,transparent 13px 22px); box-shadow:none; }
        .bs-layer--onion { height:13px; width:62%; background:repeating-linear-gradient(90deg,#f0d1ee 0 16px,#9d5d98 16px 20px,transparent 20px 27px); box-shadow:none; }
        .bs-layer--sauce,.bs-layer--bbq,.bs-layer--avocado { height:10px; width:65%; box-shadow:none; }
        .bs-layer--sauce { background:#f1c86a; }
        .bs-layer--bbq { background:#6d2418; }
        .bs-layer--avocado { background:#8fbd45; }
        .bs-layer--topping { height:15px; background:#b86d35; }
        @keyframes bs-drop { from { opacity:0; transform:translateX(-50%) translateY(-18px) scale(.94); } to { opacity:1; } }
        @media (max-width:640px){ .bs-stage{min-height:285px}.bs-stack{height:245px;width:min(88vw,310px)}.bs-layer:not(.bs-layer--bun-top):not(.bs-layer--bun-bottom){bottom:calc(58px + (var(--bs-i) * 15px))}.bs-layer--bun-top{top:16px} }
        @media (prefers-reduced-motion:reduce){ .bs-layer{animation:none;transition:none} }
      `}</style>
    </div>
  );
}
