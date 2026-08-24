"use client";

import type { CSSProperties } from "react";
import type { BurgerStudioRecipe } from "@/lib/burger-studio";
import type { BurgerStudioV2Config } from "@/lib/burger-studio-v2";

type StackLayer = {
  id: string;
  name: string;
  className: string;
  order: number;
};

function visualKey(value?: string) {
  return String(value || "").trim().toLowerCase();
}

function layerClass(group: string, visual?: string) {
  const key = visualKey(visual);
  if (group === "protein") {
    if (key.includes("crispy")) return "bsv2-layer--crispy";
    if (key.includes("vegan")) return "bsv2-layer--vegan";
    return "bsv2-layer--beef";
  }
  if (group === "cheese") {
    if (key.includes("gorgonzola")) return "bsv2-layer--gorgonzola";
    if (key.includes("mozzarella")) return "bsv2-layer--mozzarella";
    if (key.includes("gouda")) return "bsv2-layer--gouda";
    return "bsv2-layer--cheddar";
  }
  if (group === "sauce") {
    if (key.includes("avocado")) return "bsv2-layer--avocado-sauce";
    if (key.includes("bbq")) return "bsv2-layer--bbq";
    if (key.includes("italian")) return "bsv2-layer--italian";
    return "bsv2-layer--sauce";
  }
  if (key.includes("lettuce") || key.includes("salat")) return "bsv2-layer--lettuce";
  if (key.includes("tomato") || key.includes("tomate")) return "bsv2-layer--tomato";
  if (key.includes("pickle") || key.includes("gurke")) return "bsv2-layer--pickle";
  if (key.includes("bacon")) return "bsv2-layer--bacon";
  if (key.includes("guacamole")) return "bsv2-layer--guacamole";
  if (key.includes("jalap")) return "bsv2-layer--jalapeno";
  if (key.includes("onion") || key.includes("zwiebel")) return "bsv2-layer--onion";
  return "bsv2-layer--topping";
}

function physicalPriority(group: string, visual?: string) {
  const key = visualKey(visual);
  if (key.includes("lettuce") || key.includes("salat")) return 10;
  if (group === "sauce") return 20;
  if (group === "protein") return 30;
  if (group === "cheese") return 40;
  if (key.includes("bacon")) return 50;
  if (key.includes("pickle") || key.includes("gurke")) return 60;
  if (key.includes("tomato") || key.includes("tomate")) return 65;
  if (key.includes("onion") || key.includes("zwiebel")) return 70;
  if (key.includes("jalap")) return 75;
  if (key.includes("guacamole")) return 80;
  return 55;
}

function bunClass(visual?: string) {
  const key = visualKey(visual);
  if (key.includes("gluten")) return "bsv2-bun--gluten-free";
  if (key.includes("smash")) return "bsv2-bun--smash";
  return "bsv2-bun--classic";
}

export default function BurgerStackV2({
  config,
  recipe,
  assembled,
}: {
  config: BurgerStudioV2Config;
  recipe: BurgerStudioRecipe;
  assembled: boolean;
}) {
  const ingredientMap = new Map(config.ingredients.map((item) => [item.id, item]));
  const selectedBun = Object.entries(recipe.ingredients || {})
    .map(([id, qty]) => ({ ingredient: ingredientMap.get(id), qty: Number(qty) || 0 }))
    .find((entry) => entry.ingredient?.group === "bun" && entry.qty > 0)?.ingredient;

  const layers: StackLayer[] = [];
  for (const [id, rawQty] of Object.entries(recipe.ingredients || {})) {
    const ingredient = ingredientMap.get(id);
    if (!ingredient || !ingredient.active || ingredient.group === "bun") continue;
    const qty = Math.max(0, Math.min(ingredient.max, Math.round(Number(rawQty) || 0)));
    for (let unit = 0; unit < qty; unit += 1) {
      layers.push({
        id: `${id}-${unit}`,
        name: ingredient.name,
        className: layerClass(ingredient.group, ingredient.visual),
        order: physicalPriority(ingredient.group, ingredient.visual) + unit / 10,
      });
    }
  }
  layers.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));

  const bunVisualClass = bunClass(selectedBun?.visual);
  const stateClass = assembled ? "is-assembled" : "is-building";
  const layerCount = Math.max(1, layers.length);

  return (
    <div
      className={`bsv2-stage ${stateClass}`}
      aria-label={assembled ? "Fertiger Burger" : "Burger Zutaten schweben getrennt"}
    >
      <div className="bsv2-stage-light" />
      <div className="bsv2-shadow" />
      <div className="bsv2-caption">
        <span className="bsv2-caption-dot" />
        {assembled ? "FERTIG · ALLES SITZT" : "LIVE STACK · ZUTATEN SCHWEBEN"}
      </div>

      <div className="bsv2-stack" style={{ "--bsv2-count": layerCount } as CSSProperties}>
        {selectedBun ? (
          <div
            className={`bsv2-piece bsv2-bun bsv2-bun-bottom ${bunVisualClass}`}
            style={{ "--bsv2-i": 0 } as CSSProperties}
            title={`${selectedBun.name} – unten`}
          />
        ) : null}

        {layers.map((layer, index) => (
          <div
            key={layer.id}
            className={`bsv2-piece bsv2-layer ${layer.className}`}
            style={
              {
                "--bsv2-i": index + 1,
                "--bsv2-float": `${34 + index * 42}px`,
              } as CSSProperties
            }
            title={layer.name}
          >
            <span className="bsv2-piece-label">{layer.name}</span>
          </div>
        ))}

        {selectedBun ? (
          <div
            className={`bsv2-piece bsv2-bun bsv2-bun-top ${bunVisualClass}`}
            style={{ "--bsv2-i": layers.length + 1 } as CSSProperties}
            title={`${selectedBun.name} – oben`}
          />
        ) : null}
      </div>

      {!selectedBun && !layers.length ? (
        <div className="bsv2-empty">
          <div>🍔</div>
          <strong>Starte mit deinem Bun</strong>
          <span>Danach baust du Schicht für Schicht.</span>
        </div>
      ) : null}

      <style jsx>{`
        .bsv2-stage{position:relative;min-height:430px;display:grid;place-items:center;overflow:hidden;border-radius:32px;border:1px solid rgba(255,255,255,.09);background:radial-gradient(circle at 50% 28%,rgba(255,188,62,.15),transparent 34%),radial-gradient(circle at 50% 78%,rgba(123,69,22,.13),transparent 37%),linear-gradient(180deg,#11100f 0%,#080808 72%,#050505 100%);isolation:isolate}
        .bsv2-stage:before{content:"";position:absolute;inset:0;background:linear-gradient(105deg,transparent 20%,rgba(255,255,255,.025) 48%,transparent 74%);pointer-events:none}
        .bsv2-stage-light{position:absolute;top:-110px;width:360px;height:300px;border-radius:50%;background:rgba(255,179,47,.16);filter:blur(55px);opacity:.75}
        .bsv2-shadow{position:absolute;left:50%;bottom:40px;width:250px;height:34px;transform:translateX(-50%);border-radius:50%;background:rgba(0,0,0,.82);filter:blur(13px);transition:width .6s ease,opacity .6s ease}
        .is-building .bsv2-shadow{width:180px;opacity:.45}
        .bsv2-caption{position:absolute;left:18px;top:18px;z-index:30;display:flex;align-items:center;gap:8px;font-size:10px;font-weight:950;letter-spacing:.16em;color:#8f8a82}
        .bsv2-caption-dot{width:7px;height:7px;border-radius:50%;background:#fbbf24;box-shadow:0 0 16px rgba(251,191,36,.75)}
        .bsv2-stack{position:relative;width:min(88vw,390px);height:370px;transform:perspective(950px) rotateX(5deg);transform-style:preserve-3d}
        .bsv2-piece{position:absolute;left:50%;transform:translateX(-50%);transition:bottom .68s cubic-bezier(.18,1.34,.38,1),top .68s cubic-bezier(.18,1.34,.38,1),transform .68s cubic-bezier(.18,1.34,.38,1),filter .5s ease;transition-delay:calc(var(--bsv2-i) * 42ms);will-change:bottom,top,transform}
        .is-building .bsv2-layer{top:var(--bsv2-float);bottom:auto;transform:translateX(-50%) rotate(calc((var(--bsv2-i) - 4) * .65deg)) scale(.96);filter:drop-shadow(0 18px 14px rgba(0,0,0,.34))}
        .is-assembled .bsv2-layer{top:auto;bottom:calc(72px + (var(--bsv2-i) * 20px));transform:translateX(-50%) scale(1);filter:drop-shadow(0 8px 7px rgba(0,0,0,.26))}
        .bsv2-layer{width:76%;height:30px;border-radius:999px;z-index:calc(10 + var(--bsv2-i));box-shadow:inset 0 2px 2px rgba(255,255,255,.16),inset 0 -4px 8px rgba(0,0,0,.22)}
        .bsv2-piece-label{position:absolute;left:calc(100% + 16px);top:50%;transform:translateY(-50%);white-space:nowrap;border:1px solid rgba(255,255,255,.08);border-radius:999px;background:rgba(8,8,8,.82);padding:5px 8px;font-size:9px;font-weight:850;color:#9e9a94;opacity:.78;transition:opacity .25s ease}
        .is-assembled .bsv2-piece-label{opacity:0}

        .bsv2-bun{width:82%;z-index:4;overflow:hidden;border:1px solid rgba(255,218,159,.28);box-shadow:inset 0 4px 7px rgba(255,255,255,.17),inset 0 -8px 13px rgba(103,47,9,.31),0 15px 22px rgba(0,0,0,.32)}
        .bsv2-bun:before{content:"";position:absolute;inset:0;background:radial-gradient(circle at 18% 35%,rgba(255,236,193,.82) 0 1.7px,transparent 2.7px),radial-gradient(circle at 39% 23%,rgba(255,236,193,.7) 0 1.6px,transparent 2.6px),radial-gradient(circle at 62% 31%,rgba(255,236,193,.75) 0 1.6px,transparent 2.6px),radial-gradient(circle at 78% 20%,rgba(255,236,193,.7) 0 1.5px,transparent 2.5px);opacity:.8}
        .bsv2-bun--classic{background:linear-gradient(180deg,#f5b44d 0%,#df8a25 58%,#bd681a 100%)}
        .bsv2-bun--smash{background:linear-gradient(180deg,#f7c975 0%,#e7a544 52%,#c47824 100%);border-color:rgba(255,231,187,.4)}
        .bsv2-bun--gluten-free{background:linear-gradient(180deg,#ddb16c 0%,#bc8445 55%,#8f5e32 100%);filter:saturate(.82)}
        .bsv2-bun-top{height:78px;border-radius:130px 130px 32px 32px}
        .bsv2-bun-bottom{height:48px;border-radius:24px 24px 70px 70px}
        .is-building .bsv2-bun-bottom{bottom:28px;top:auto}
        .is-building .bsv2-bun-top{top:20px;bottom:auto;transform:translateX(-50%) rotate(-1.2deg)}
        .is-assembled .bsv2-bun-bottom{bottom:38px;top:auto}
        .is-assembled .bsv2-bun-top{top:auto;bottom:calc(77px + ((var(--bsv2-count) + 1) * 20px));transform:translateX(-50%)}

        .bsv2-layer--beef{height:38px;border-radius:42% 48% 44% 50%/47% 41% 52% 43%;background:radial-gradient(circle at 18% 28%,#8a4b31 0 2px,transparent 3px),radial-gradient(circle at 67% 61%,#1b0d09 0 2px,transparent 4px),repeating-linear-gradient(8deg,rgba(16,7,4,.35) 0 3px,transparent 3px 11px),linear-gradient(180deg,#6d3825 0%,#3b1c13 60%,#21100c 100%);border:2px solid #79432d}
        .bsv2-layer--crispy{height:42px;border-radius:37% 43% 35% 46%/42% 36% 48% 41%;background:radial-gradient(circle at 14% 28%,#f3c067 0 3px,transparent 4px),radial-gradient(circle at 52% 66%,#a95b16 0 3px,transparent 4px),radial-gradient(circle at 76% 31%,#ffe09a 0 2px,transparent 4px),repeating-linear-gradient(138deg,#d98823 0 7px,#efab42 7px 12px,#b76617 12px 16px);border:2px solid #e5a54e}
        .bsv2-layer--vegan{height:36px;border-radius:45% 39% 47% 42%;background:radial-gradient(circle at 20% 28%,#7e9f5c 0 2px,transparent 3px),linear-gradient(180deg,#536c3d,#2c3f24 65%,#1b2918);border:2px solid #657f4e}
        .bsv2-layer--cheddar,.bsv2-layer--gouda,.bsv2-layer--mozzarella,.bsv2-layer--gorgonzola{height:18px;width:72%;border-radius:4px;clip-path:polygon(1% 4%,98% 0,93% 70%,82% 66%,73% 100%,61% 69%,49% 94%,37% 70%,24% 96%,13% 70%,4% 78%);box-shadow:0 5px 7px rgba(0,0,0,.22)}
        .bsv2-layer--cheddar{background:linear-gradient(#ffc731,#e79b0e)}
        .bsv2-layer--gouda{background:linear-gradient(#f5cf70,#d9a94d)}
        .bsv2-layer--mozzarella{background:linear-gradient(#fff7d8,#e8d9a8)}
        .bsv2-layer--gorgonzola{background:radial-gradient(circle,#719072 0 2px,transparent 3px),linear-gradient(#eee5c8,#d8cfac);background-size:24px 14px,auto}
        .bsv2-layer--lettuce{height:24px;width:80%;border-radius:0;background:repeating-linear-gradient(76deg,rgba(204,239,121,.3) 0 2px,transparent 2px 12px),linear-gradient(180deg,#7ebc3f,#3f7e24);clip-path:polygon(0 50%,7% 9%,14% 45%,22% 2%,31% 47%,40% 11%,48% 54%,57% 3%,66% 47%,75% 8%,84% 51%,94% 5%,100% 48%,96% 83%,84% 69%,74% 94%,62% 71%,51% 94%,40% 72%,28% 91%,17% 69%,7% 87%)}
        .bsv2-layer--tomato{height:19px;width:70%;background:radial-gradient(circle at 26% 50%,#ffd0a9 0 2px,transparent 3px),radial-gradient(circle at 70% 50%,#ffd0a9 0 2px,transparent 3px),linear-gradient(#f15c49,#b92722);border:2px solid #f77a67}
        .bsv2-layer--pickle{height:15px;width:62%;background:radial-gradient(ellipse at 18% 50%,#d2e579 0 8px,#6f9937 9px 12px,transparent 13px),radial-gradient(ellipse at 50% 50%,#d2e579 0 8px,#6f9937 9px 12px,transparent 13px),radial-gradient(ellipse at 82% 50%,#d2e579 0 8px,#6f9937 9px 12px,transparent 13px);box-shadow:none}
        .bsv2-layer--bacon{height:16px;width:75%;border-radius:8px;background:repeating-linear-gradient(92deg,#7c2b22 0 17px,#c45543 17px 28px,#f0a48d 28px 34px,#8e3025 34px 48px);clip-path:polygon(0 28%,10% 6%,21% 25%,34% 5%,46% 27%,59% 8%,72% 29%,86% 5%,100% 23%,98% 74%,87% 95%,73% 75%,60% 96%,47% 72%,34% 95%,21% 73%,9% 94%,1% 72%)}
        .bsv2-layer--guacamole{height:18px;width:68%;background:radial-gradient(circle at 30% 50%,#a6c65a 0 4px,transparent 5px),linear-gradient(#7fa53d,#4c7423);border-radius:50% 42% 48% 40%}
        .bsv2-layer--jalapeno{height:15px;width:61%;background:radial-gradient(circle at 14% 50%,transparent 0 4px,#72a82d 5px 9px,transparent 10px),radial-gradient(circle at 42% 50%,transparent 0 4px,#5c9226 5px 9px,transparent 10px),radial-gradient(circle at 72% 50%,transparent 0 4px,#79aa32 5px 9px,transparent 10px);box-shadow:none}
        .bsv2-layer--onion{height:15px;width:64%;background:radial-gradient(ellipse at 20% 50%,transparent 0 7px,#d6b2d6 8px 10px,transparent 11px),radial-gradient(ellipse at 50% 50%,transparent 0 8px,#9c659c 9px 11px,transparent 12px),radial-gradient(ellipse at 80% 50%,transparent 0 7px,#e3c5df 8px 10px,transparent 11px);box-shadow:none}
        .bsv2-layer--sauce,.bsv2-layer--italian,.bsv2-layer--bbq,.bsv2-layer--avocado-sauce{height:12px;width:67%;border-radius:50%;box-shadow:0 4px 6px rgba(0,0,0,.18)}
        .bsv2-layer--sauce{background:linear-gradient(#f1d27b,#ceaa50)}
        .bsv2-layer--italian{background:linear-gradient(#efc77e,#bf8841)}
        .bsv2-layer--bbq{background:linear-gradient(#7b3021,#42160f)}
        .bsv2-layer--avocado-sauce{background:linear-gradient(#a9c85b,#6f9635)}
        .bsv2-layer--topping{height:16px;background:linear-gradient(#b97745,#80502f)}
        .bsv2-empty{position:absolute;display:flex;flex-direction:column;align-items:center;gap:8px;color:#aaa39a;text-align:center}.bsv2-empty div{font-size:54px;filter:grayscale(.35);opacity:.45}.bsv2-empty strong{font-size:16px;color:#ded8cf}.bsv2-empty span{font-size:12px;color:#706b64}
        @media(max-width:720px){.bsv2-stage{min-height:370px}.bsv2-stack{height:320px;width:min(91vw,345px)}.bsv2-piece-label{display:none}.is-building .bsv2-layer{top:calc(42px + (var(--bsv2-i) * 34px))}.is-assembled .bsv2-layer{bottom:calc(65px + (var(--bsv2-i) * 17px))}.is-assembled .bsv2-bun-top{bottom:calc(70px + ((var(--bsv2-count) + 1) * 17px))}}
        @media(prefers-reduced-motion:reduce){.bsv2-piece{transition:none}.bsv2-stage-light{display:none}}
      `}</style>
    </div>
  );
}
