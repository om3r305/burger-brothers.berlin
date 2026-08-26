"use client";

import type { CSSProperties } from "react";
import type { BurgerStudioRecipe } from "@/lib/burger-studio";
import type { BurgerStudioV2Config } from "@/lib/burger-studio-v2";

type StackLayer = {
  id: string;
  name: string;
  className: string;
  order: number;
  kind: string;
};

function visualKey(value?: string) {
  return String(value || "").trim().toLowerCase();
}

function layerKind(group: string, visual?: string) {
  const key = visualKey(visual);
  if (group === "protein") {
    if (key.includes("black-angus") || key.includes("angus")) return "black-angus";
    if (key.includes("chicken-breast") || key.includes("grilled-chicken")) return "chicken-breast";
    if (key.includes("crispy")) return "crispy";
    if (key.includes("vegan")) return "vegan";
    return "beef";
  }
  if (group === "cheese") {
    if (key.includes("gorgonzola")) return "gorgonzola";
    if (key.includes("mozzarella")) return "mozzarella";
    if (key.includes("gouda")) return "gouda";
    return "cheddar";
  }
  if (group === "sauce") {
    if (key.includes("avocado")) return "avocado-sauce";
    if (key.includes("bbq")) return "bbq";
    if (key.includes("italian")) return "italian";
    return "sauce";
  }
  if (key.includes("farmers-market") || key.includes("farmers")) return "farmers-market";
  if (key.includes("lettuce") || key.includes("salat")) return "lettuce";
  if (key.includes("tomato") || key.includes("tomate")) return "tomato";
  if (key.includes("pickle") || key.includes("gurke")) return "pickle";
  if (key.includes("bacon")) return "bacon";
  if (key.includes("guacamole")) return "guacamole";
  if (key.includes("jalap")) return "jalapeno";
  if (key.includes("rost") || key.includes("röst")) return "fried-onion";
  if (key.includes("onion") || key.includes("zwiebel")) return "onion";
  return "topping";
}

// Canonical food order, deliberately independent from selection/object order.
function foodPriority(kind: string, group: string, sauceUnit = 0) {
  if (group === "sauce") return sauceUnit === 0 ? 5 : 90;
  if (kind === "lettuce") return 10;
  if (kind === "tomato") return 20;
  if (["onion", "fried-onion", "pickle"].includes(kind)) return 30;
  if (kind === "farmers-market") return 34;
  if (["beef", "black-angus", "chicken-breast", "crispy", "vegan"].includes(kind)) return 40;
  if (kind === "bacon") return 50;
  if (kind === "jalapeno") return 60;
  if (["cheddar", "gouda", "mozzarella", "gorgonzola"].includes(kind)) return 70;
  if (kind === "guacamole") return 80;
  return 35;
}

// Distance from the visible bottom of one layer to the next layer's bottom in
// the finished burger. The visible food mass intentionally overlaps a little so
// the final burger reads as one hot physical stack rather than floating cards.
function assembledStep(kind: string) {
  if (["sauce", "italian", "bbq", "avocado-sauce"].includes(kind)) return 4;
  if (kind === "lettuce") return 10;
  if (kind === "tomato") return 7;
  if (["onion", "fried-onion", "pickle"].includes(kind)) return 6;
  if (kind === "farmers-market") return 10;
  if (kind === "beef") return 33;
  if (kind === "black-angus") return 39;
  if (kind === "chicken-breast") return 31;
  if (kind === "crispy") return 31;
  if (kind === "vegan") return 27;
  if (kind === "bacon") return 10;
  if (kind === "jalapeno") return 6;
  if (["cheddar", "gouda", "mozzarella", "gorgonzola"].includes(kind)) return 9;
  if (kind === "guacamole") return 7;
  return 8;
}

function bunClass(visual?: string) {
  const key = visualKey(visual);
  if (key.includes("gluten")) return "bsv2-bun--gluten-free";
  if (key.includes("smash")) return "bsv2-bun--smash";
  return "bsv2-bun--classic";
}

export default function BurgerStackV2({ config, recipe, assembled }: {
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
    const kind = layerKind(ingredient.group, ingredient.visual);
    for (let unit = 0; unit < qty; unit += 1) {
      layers.push({
        id: `${id}-${unit}`,
        name: ingredient.name,
        className: `bsv2-layer--${kind}`,
        order: foodPriority(kind, ingredient.group, unit) + unit / 10,
        kind,
      });
    }
  }
  layers.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));

  const count = layers.length;
  const buildGap = count > 14 ? 38 : 44;
  const buildHeight = Math.max(430, 218 + count * buildGap);

  let finalCursor = 80;
  const finalBottoms = layers.map((layer) => {
    const bottom = finalCursor;
    finalCursor += assembledStep(layer.kind);
    return bottom;
  });
  const finalTopBottom = Math.max(90, finalCursor + 1);
  const finalHeight = Math.max(430, finalTopBottom + 118);

  const stageHeight = assembled ? finalHeight : buildHeight;
  const stackStyle = {
    "--bsv2-count": Math.max(1, count),
    "--bsv2-stage-height": `${stageHeight}px`,
    "--bsv2-gap": `${buildGap}px`,
    "--bsv2-top-bottom": `${finalTopBottom}px`,
  } as CSSProperties;
  const bunVisualClass = bunClass(selectedBun?.visual);

  return (
    <div className={`bsv2-stage ${assembled ? "is-assembled" : "is-building"}`} style={stackStyle}
      data-layer-count={count} aria-label={assembled ? "Fertiger Burger" : "Burger Zutaten schweben getrennt"}>
      <div className="bsv2-stage-light" />
      <div className="bsv2-assembly-flash" aria-hidden="true" />
      <div className="bsv2-shadow" />
      <div className="bsv2-caption"><span className="bsv2-caption-dot" />{assembled ? "FERTIG · HEISS & SAFTIG" : "LIVE STACK · FRISCH GESTAPELT"}</div>

      <div className="bsv2-stack">
        <div className="bsv2-heat-glow" aria-hidden="true" />
        <div className="bsv2-steam" aria-hidden="true"><span /><span /><span /></div>

        {selectedBun ? <div className={`bsv2-piece bsv2-bun bsv2-bun-bottom ${bunVisualClass}`}
          style={{ "--bsv2-i": 0 } as CSSProperties} data-bun-position="bottom" title={`${selectedBun.name} – unten`} /> : null}

        {layers.map((layer, index) => (
          <div key={layer.id} className={`bsv2-piece bsv2-layer ${layer.className}`}
            data-visual-kind={layer.kind} data-food-order={layer.order}
            style={{
              "--bsv2-i": index + 1,
              "--bsv2-r": count - index,
              "--bsv2-final-bottom": `${finalBottoms[index]}px`,
            } as CSSProperties} title={layer.name}>
            <span className="bsv2-food-detail" aria-hidden="true" />
            <span className="bsv2-piece-label">{layer.name}</span>
          </div>
        ))}

        {selectedBun ? <div className={`bsv2-piece bsv2-bun bsv2-bun-top ${bunVisualClass}`}
          style={{
            "--bsv2-i": count + 1,
            "--bsv2-top-bottom": `${finalTopBottom}px`,
          } as CSSProperties} data-bun-position="top" title={`${selectedBun.name} – oben`} /> : null}
      </div>

      {!selectedBun && !count ? <div className="bsv2-empty"><div>🍔</div><strong>Starte mit deinem Bun</strong><span>Danach baust du Schicht für Schicht.</span></div> : null}

      <style jsx>{`
        .bsv2-stage{position:relative;height:var(--bsv2-stage-height);min-height:430px;display:grid;place-items:center;overflow:hidden;border-radius:32px;border:1px solid rgba(255,255,255,.09);background:radial-gradient(circle at 50% 30%,rgba(255,181,61,.19),transparent 31%),radial-gradient(circle at 50% 76%,rgba(143,62,15,.18),transparent 38%),linear-gradient(180deg,#14110e,#090807 70%,#050505);isolation:isolate;transition:height .28s ease}
        .bsv2-stage:before{content:"";position:absolute;inset:0;background:linear-gradient(105deg,transparent 20%,rgba(255,255,255,.035) 48%,transparent 74%);pointer-events:none}
        .bsv2-stage-light{position:absolute;top:-110px;width:380px;height:320px;border-radius:50%;background:rgba(255,160,35,.18);filter:blur(58px);opacity:.78}
        .is-assembled .bsv2-stage-light{animation:bsv2-warm-settle 1.45s ease-out both}
        .bsv2-assembly-flash{position:absolute;z-index:50;inset:0;pointer-events:none;opacity:0;background:radial-gradient(circle at 50% 48%,rgba(255,248,205,.95),rgba(251,191,36,.38) 18%,transparent 54%)}
        .is-assembled .bsv2-assembly-flash{animation:bsv2-flash .24s ease-out both}
        .bsv2-shadow{position:absolute;left:50%;bottom:38px;width:250px;height:34px;transform:translateX(-50%);border-radius:50%;background:rgba(0,0,0,.82);filter:blur(13px);transition:width .25s ease,opacity .25s ease}.is-building .bsv2-shadow{width:180px;opacity:.45}
        .bsv2-caption{position:absolute;left:18px;top:18px;z-index:30;display:flex;align-items:center;gap:8px;font-size:10px;font-weight:950;letter-spacing:.16em;color:#9f968b}.bsv2-caption-dot{width:7px;height:7px;border-radius:50%;background:#fbbf24;box-shadow:0 0 16px rgba(251,191,36,.75)}
        .bsv2-stack{position:relative;width:min(88vw,390px);height:calc(var(--bsv2-stage-height) - 48px);transform:perspective(950px) rotateX(4deg);transform-style:preserve-3d}
        .bsv2-heat-glow{position:absolute;left:50%;bottom:calc(var(--bsv2-top-bottom) - 28px);width:76%;height:88px;transform:translateX(-50%);border-radius:50%;background:radial-gradient(ellipse,rgba(255,137,31,.22),rgba(255,96,17,.07) 48%,transparent 72%);filter:blur(18px);opacity:0;pointer-events:none}.is-assembled .bsv2-heat-glow{animation:bsv2-heat 1.45s ease-out both;animation-delay:.26s}
        .bsv2-steam{position:absolute;z-index:45;left:50%;bottom:calc(var(--bsv2-top-bottom) + 55px);width:170px;height:92px;transform:translateX(-50%);pointer-events:none;opacity:0}.is-assembled .bsv2-steam{opacity:1}.bsv2-steam span{position:absolute;bottom:0;width:22px;height:72px;border-radius:50%;border-left:2px solid rgba(255,245,229,.5);filter:blur(2px);opacity:0}.bsv2-steam span:nth-child(1){left:28px;transform:rotate(-9deg)}.bsv2-steam span:nth-child(2){left:76px;height:84px;transform:rotate(5deg)}.bsv2-steam span:nth-child(3){right:24px;height:67px;transform:rotate(11deg)}.is-assembled .bsv2-steam span{animation:bsv2-steam-rise 1.55s ease-out both}.is-assembled .bsv2-steam span:nth-child(1){animation-delay:.42s}.is-assembled .bsv2-steam span:nth-child(2){animation-delay:.5s}.is-assembled .bsv2-steam span:nth-child(3){animation-delay:.58s}
        .bsv2-piece{position:absolute;left:50%;transform:translateX(-50%);will-change:bottom,top,transform}.is-building .bsv2-piece{transition:top .26s ease,bottom .26s ease,transform .26s ease}
        .is-building .bsv2-layer{top:calc(82px + (var(--bsv2-r) * var(--bsv2-gap)));bottom:auto;transform:translateX(-50%) rotate(calc((var(--bsv2-i) - 4) * .55deg)) scale(.97);filter:drop-shadow(0 16px 12px rgba(0,0,0,.4))}
        .is-assembled .bsv2-layer{top:auto;bottom:var(--bsv2-final-bottom);transform:translateX(-50%);filter:drop-shadow(0 5px 5px rgba(0,0,0,.24));animation:bsv2-drop .23s cubic-bezier(.2,.86,.32,1.18) both;animation-delay:calc(45ms + (var(--bsv2-i) * 48ms))}
        .bsv2-layer{width:76%;height:28px;border-radius:999px;z-index:calc(10 + var(--bsv2-i));box-shadow:inset 0 2px 2px rgba(255,255,255,.16),inset 0 -4px 8px rgba(0,0,0,.22)}
        .bsv2-piece-label{position:absolute;left:calc(100% + 14px);top:50%;transform:translateY(-50%);white-space:nowrap;border:1px solid rgba(255,255,255,.08);border-radius:999px;background:rgba(8,8,8,.84);padding:5px 8px;font-size:9px;font-weight:850;color:#aaa49b;opacity:.82}.is-assembled .bsv2-piece-label{opacity:0}
        .bsv2-food-detail{position:absolute;inset:0;pointer-events:none}

        .bsv2-bun{width:82%;z-index:4;overflow:hidden;border:1px solid rgba(255,218,159,.28);box-shadow:inset 0 4px 7px rgba(255,255,255,.17),inset 0 -8px 13px rgba(103,47,9,.31),0 15px 22px rgba(0,0,0,.32)}
        .bsv2-bun--classic{background:linear-gradient(180deg,#f7b94f,#e48d26 58%,#bd681a)}.bsv2-bun--smash{background:linear-gradient(180deg,#f7c975,#e7a544 52%,#c47824);border-color:rgba(255,231,187,.4)}.bsv2-bun--gluten-free{background:linear-gradient(180deg,#ddb16c,#bc8445 55%,#8f5e32);filter:saturate(.82)}
        .bsv2-bun-top{height:78px;border-radius:130px 130px 32px 32px}.bsv2-bun-bottom{height:48px;border-radius:24px 24px 70px 70px}.bsv2-bun--classic.bsv2-bun-top:before{content:"";position:absolute;inset:5px 12px 12px;background:radial-gradient(ellipse at 8% 34%,#fff7d9 0 3px,#d7a85b 3.2px 4px,transparent 4.5px),radial-gradient(ellipse at 18% 20%,#fff3cf 0 3px,#d7a85b 3.2px 4px,transparent 4.5px),radial-gradient(ellipse at 28% 43%,#fff8dd 0 3px,#cf9a4b 3.2px 4px,transparent 4.5px),radial-gradient(ellipse at 38% 24%,#fff3cf 0 3px,#d7a85b 3.2px 4px,transparent 4.5px),radial-gradient(ellipse at 48% 39%,#fff8dd 0 3px,#cf9a4b 3.2px 4px,transparent 4.5px),radial-gradient(ellipse at 57% 18%,#fff3cf 0 3px,#d7a85b 3.2px 4px,transparent 4.5px),radial-gradient(ellipse at 66% 42%,#fff8dd 0 3px,#cf9a4b 3.2px 4px,transparent 4.5px),radial-gradient(ellipse at 76% 25%,#fff3cf 0 3px,#d7a85b 3.2px 4px,transparent 4.5px),radial-gradient(ellipse at 86% 43%,#fff8dd 0 3px,#cf9a4b 3.2px 4px,transparent 4.5px),radial-gradient(ellipse at 93% 27%,#fff3cf 0 3px,#d7a85b 3.2px 4px,transparent 4.5px);filter:drop-shadow(0 1px 0 rgba(92,46,11,.45));opacity:.98;transform:rotate(-3deg)}
        .bsv2-bun--smash:before,.bsv2-bun--gluten-free:before,.bsv2-bun-bottom:before{content:none}.is-building .bsv2-bun-bottom{bottom:25px;transform:translateX(-50%)}.is-building .bsv2-bun-top{top:25px;transform:translateX(-50%) rotate(-1.2deg)}.is-assembled .bsv2-bun-bottom{bottom:38px;transform:translateX(-50%)}.is-assembled .bsv2-bun-top{bottom:var(--bsv2-top-bottom);transform:translateX(-50%);animation:bsv2-top-close .3s cubic-bezier(.16,.9,.3,1.25) both;animation-delay:calc(110ms + (var(--bsv2-count) * 48ms));z-index:40}

        .bsv2-layer--beef{height:48px;width:78%;border-radius:47% 43% 49% 45%/45% 52% 43% 51%;background:radial-gradient(ellipse at 22% 18%,rgba(255,184,128,.18),transparent 18%),radial-gradient(circle at 14% 66%,#a76143 0 2px,transparent 3px),radial-gradient(circle at 71% 28%,#1a0805 0 2px,transparent 4px),radial-gradient(circle at 84% 71%,#bd7450 0 1px,transparent 3px),repeating-linear-gradient(11deg,rgba(30,10,5,.38) 0 3px,transparent 3px 13px),linear-gradient(180deg,#995a3d 0%,#6c3828 38%,#4b241b 68%,#2d130f 100%);border:2px solid #6d3727;box-shadow:inset 0 5px 6px rgba(255,190,139,.14),inset 0 -9px 11px rgba(17,5,3,.52),0 7px 10px rgba(0,0,0,.3)}
        .bsv2-layer--beef .bsv2-food-detail:before{content:"";position:absolute;inset:8px 10%;border-radius:48%;background:repeating-linear-gradient(9deg,transparent 0 11px,rgba(24,7,4,.65) 11px 14px,transparent 14px 22px);opacity:.7}.bsv2-layer--beef .bsv2-food-detail:after{content:"";position:absolute;left:18%;right:24%;top:7px;height:5px;border-radius:50%;background:linear-gradient(90deg,transparent,rgba(255,196,150,.32),transparent);filter:blur(1px)}
        .bsv2-layer--black-angus{height:57px;width:80%;border-radius:45% 50% 43% 48%/48% 42% 54% 46%;background:radial-gradient(ellipse at 28% 17%,rgba(255,177,116,.16),transparent 19%),radial-gradient(circle at 16% 67%,#7f402d 0 2px,transparent 4px),radial-gradient(circle at 67% 61%,#0e0403 0 3px,transparent 5px),radial-gradient(circle at 83% 26%,#b26745 0 2px,transparent 4px),repeating-linear-gradient(12deg,rgba(8,3,2,.62) 0 4px,transparent 4px 14px),linear-gradient(180deg,#75402f 0%,#4b251d 35%,#2b120e 68%,#160806 100%);border:3px solid #4c241b;box-shadow:inset 0 6px 7px rgba(255,170,112,.12),inset 0 -11px 14px rgba(5,2,1,.62),0 9px 12px rgba(0,0,0,.38)}
        .bsv2-layer--black-angus .bsv2-food-detail:before{content:"";position:absolute;inset:9px 9%;border-radius:48%;background:repeating-linear-gradient(8deg,transparent 0 10px,rgba(5,2,1,.82) 10px 14px,transparent 14px 23px);opacity:.82}.bsv2-layer--black-angus .bsv2-food-detail:after{content:"";position:absolute;left:14%;right:17%;top:8px;height:6px;border-radius:50%;background:linear-gradient(90deg,transparent,rgba(255,190,136,.34),rgba(255,128,72,.18),transparent);filter:blur(1px)}
        .bsv2-layer--chicken-breast{height:46px;width:76%;border-radius:43% 48% 41% 52%/51% 39% 54% 43%;background:radial-gradient(ellipse at 24% 22%,rgba(255,244,194,.46),transparent 25%),radial-gradient(circle at 77% 64%,#a95a27 0 2px,transparent 4px),linear-gradient(180deg,#f0c17b 0%,#d99a54 42%,#bd7138 72%,#87461f 100%);border:2px solid #b46b31;box-shadow:inset 0 5px 6px rgba(255,246,205,.28),inset 0 -8px 10px rgba(95,43,15,.3),0 6px 9px rgba(0,0,0,.26)}
        .bsv2-layer--chicken-breast .bsv2-food-detail:before{content:"";position:absolute;inset:8px 13%;border-radius:45%;background:repeating-linear-gradient(7deg,transparent 0 13px,rgba(92,42,15,.54) 13px 16px,transparent 16px 25px);opacity:.78}.bsv2-layer--chicken-breast .bsv2-food-detail:after{content:"";position:absolute;left:20%;right:28%;top:8px;height:4px;border-radius:999px;background:rgba(255,249,216,.36);filter:blur(.8px)}
        .bsv2-layer--crispy{height:43px;border-radius:37% 43% 35% 46%/42% 36% 48% 41%;background:radial-gradient(circle at 14% 28%,#ffd482 0 3px,transparent 4px),radial-gradient(circle at 52% 66%,#a95b16 0 3px,transparent 4px),radial-gradient(circle at 76% 31%,#ffe09a 0 2px,transparent 4px),repeating-linear-gradient(138deg,#d98823 0 7px,#efab42 7px 12px,#b76617 12px 16px);border:2px solid #e5a54e}
        .bsv2-layer--vegan{height:37px;border-radius:45% 39% 47% 42%;background:radial-gradient(circle at 20% 28%,#7e9f5c 0 2px,transparent 3px),linear-gradient(#536c3d,#2c3f24 65%,#1b2918);border:2px solid #657f4e}
        .bsv2-layer--farmers-market{height:32px;width:73%;border-radius:40% 44% 38% 46%;background:radial-gradient(ellipse at 11% 48%,#ffcc48 0 9px,#d98218 10px 15px,transparent 16px),radial-gradient(ellipse at 28% 56%,#f25837 0 10px,#ad2f22 11px 16px,transparent 17px),radial-gradient(ellipse at 47% 46%,#d8b18f 0 8px,#65364c 9px 16px,#321728 17px 19px,transparent 20px),radial-gradient(ellipse at 65% 58%,#ffd151 0 9px,#c87316 10px 15px,transparent 16px),radial-gradient(ellipse at 82% 44%,#d9b38d 0 8px,#6b3850 9px 16px,#321728 17px 19px,transparent 20px);box-shadow:none}
        .bsv2-layer--farmers-market .bsv2-food-detail:before{content:"";position:absolute;inset:5px 8%;background:repeating-linear-gradient(8deg,transparent 0 11px,rgba(74,31,18,.5) 11px 13px,transparent 13px 22px);opacity:.58;clip-path:inset(0 round 45%)}
        .bsv2-layer--cheddar,.bsv2-layer--gouda,.bsv2-layer--mozzarella,.bsv2-layer--gorgonzola{height:26px;width:75%;border-radius:8px;clip-path:polygon(1% 3%,99% 0,97% 65%,90% 62%,84% 100%,73% 67%,63% 96%,51% 69%,39% 98%,28% 68%,17% 96%,8% 69%,2% 77%);box-shadow:0 5px 7px rgba(0,0,0,.22),inset 0 3px 3px rgba(255,255,255,.18)}.bsv2-layer--cheddar{--bsv2-cheese-drip:#e99b08;background:linear-gradient(180deg,#ffdf55,#f2ae16 55%,#df8700)}.bsv2-layer--gouda{--bsv2-cheese-drip:#d9a13c;background:linear-gradient(180deg,#f9e49a,#e6b85c 58%,#cf9132)}.bsv2-layer--mozzarella{--bsv2-cheese-drip:#f4eccd;width:69%;height:28px;border-radius:48%;clip-path:none;background:radial-gradient(ellipse at 21% 52%,#fffdf1 0 24px,transparent 25px),radial-gradient(ellipse at 51% 45%,#f7efd5 0 29px,transparent 30px),radial-gradient(ellipse at 80% 55%,#fff9df 0 25px,transparent 26px);box-shadow:0 4px 7px rgba(0,0,0,.16)}.bsv2-layer--gorgonzola{--bsv2-cheese-drip:#ded5b4;height:27px;background:radial-gradient(circle,#617d67 0 2px,transparent 3px),radial-gradient(circle at 70% 40%,#758d78 0 2px,transparent 3px),linear-gradient(#f0e7cb,#d5c8a2);background-size:22px 13px,29px 17px,auto}
        .is-assembled .bsv2-layer--cheddar:after,.is-assembled .bsv2-layer--gouda:after,.is-assembled .bsv2-layer--mozzarella:after,.is-assembled .bsv2-layer--gorgonzola:after{content:"";position:absolute;z-index:-1;left:19%;bottom:-8px;width:13px;height:14px;border-radius:2px 2px 10px 10px;background:var(--bsv2-cheese-drip);box-shadow:46px 3px 0 -4px var(--bsv2-cheese-drip),103px 1px 0 -2px var(--bsv2-cheese-drip);transform-origin:50% 0;animation:bsv2-cheese-drip 3.2s cubic-bezier(.22,.7,.24,1) both;animation-delay:calc(520ms + (var(--bsv2-count) * 48ms))}.is-assembled .bsv2-layer--cheddar .bsv2-food-detail,.is-assembled .bsv2-layer--gouda .bsv2-food-detail,.is-assembled .bsv2-layer--mozzarella .bsv2-food-detail,.is-assembled .bsv2-layer--gorgonzola .bsv2-food-detail{animation:bsv2-cheese-settle 2.8s ease-in-out both;animation-delay:calc(500ms + (var(--bsv2-count) * 48ms))}
        .bsv2-layer--lettuce{height:29px;width:81%;border-radius:0;background:radial-gradient(ellipse at 20% 62%,rgba(225,255,157,.35),transparent 28%),repeating-linear-gradient(76deg,rgba(214,248,133,.4) 0 2px,transparent 2px 11px),linear-gradient(#91d354,#34751f);clip-path:polygon(0 50%,7% 9%,14% 45%,22% 2%,31% 47%,40% 11%,48% 54%,57% 3%,66% 47%,75% 8%,84% 51%,94% 5%,100% 48%,96% 83%,84% 69%,74% 94%,62% 71%,51% 94%,40% 72%,28% 91%,17% 69%,7% 87%)}
        .bsv2-layer--lettuce .bsv2-food-detail:before{content:"";position:absolute;left:8%;right:8%;top:47%;height:2px;background:rgba(214,248,133,.42);box-shadow:0 -5px 0 rgba(172,226,99,.22),0 5px 0 rgba(76,130,39,.28)}
        .bsv2-layer--tomato{height:22px;width:70%;border-radius:50%;background:radial-gradient(ellipse at 25% 50%,#ffd0a9 0 5px,#d8372f 6px 22px,transparent 23px),radial-gradient(ellipse at 51% 50%,#ffc59b 0 5px,#e44236 6px 23px,transparent 24px),radial-gradient(ellipse at 77% 50%,#ffd0a9 0 5px,#bd2925 6px 22px,transparent 23px);box-shadow:none}
        .bsv2-layer--pickle{height:19px;width:64%;background:radial-gradient(ellipse at 18% 50%,#d8e886 0 7px,#6f9937 8px 12px,transparent 13px),radial-gradient(ellipse at 50% 50%,#d8e886 0 7px,#618c2e 8px 12px,transparent 13px),radial-gradient(ellipse at 82% 50%,#d8e886 0 7px,#6f9937 8px 12px,transparent 13px);box-shadow:none}
        .bsv2-layer--bacon{height:24px;width:77%;border-radius:10px;background:repeating-linear-gradient(92deg,#682019 0 15px,#b74435 15px 25px,#f2ad96 25px 31px,#8d2d23 31px 44px);clip-path:polygon(0 27%,9% 7%,19% 24%,30% 5%,41% 27%,52% 8%,63% 28%,75% 6%,87% 26%,100% 8%,98% 73%,88% 94%,76% 75%,64% 95%,52% 73%,40% 96%,28% 74%,16% 94%,3% 72%);box-shadow:0 5px 7px rgba(0,0,0,.22)}
        .bsv2-layer--bacon .bsv2-food-detail:before{content:"";position:absolute;left:3%;right:3%;top:7px;height:5px;border-radius:999px;background:repeating-linear-gradient(90deg,rgba(255,199,178,.78) 0 18px,rgba(117,29,24,.2) 18px 34px);opacity:.9}
        .bsv2-layer--jalapeno{height:19px;width:62%;background:radial-gradient(circle at 14% 50%,transparent 0 4px,#72a82d 5px 10px,transparent 11px),radial-gradient(circle at 42% 50%,transparent 0 4px,#4f8621 5px 10px,transparent 11px),radial-gradient(circle at 72% 50%,transparent 0 4px,#79aa32 5px 10px,transparent 11px);box-shadow:none}
        .bsv2-layer--onion{height:19px;width:65%;background:radial-gradient(ellipse at 20% 50%,transparent 0 7px,#d6b2d6 8px 11px,transparent 12px),radial-gradient(ellipse at 50% 50%,transparent 0 8px,#9c659c 9px 12px,transparent 13px),radial-gradient(ellipse at 80% 50%,transparent 0 7px,#e3c5df 8px 11px,transparent 12px);box-shadow:none}.bsv2-layer--fried-onion{height:21px;width:66%;background:radial-gradient(ellipse at 12% 45%,#d99d45 0 6px,transparent 7px),radial-gradient(ellipse at 28% 65%,#a96722 0 7px,transparent 8px),radial-gradient(ellipse at 48% 38%,#e1aa55 0 7px,transparent 8px),radial-gradient(ellipse at 68% 65%,#a96722 0 6px,transparent 7px),radial-gradient(ellipse at 86% 40%,#d99d45 0 7px,transparent 8px);box-shadow:none}
        .bsv2-layer--guacamole{height:20px;width:68%;background:radial-gradient(circle at 30% 50%,#b5d369 0 4px,transparent 5px),linear-gradient(#7fa53d,#4c7423);border-radius:50% 42% 48% 40%}
        .bsv2-layer--sauce,.bsv2-layer--italian,.bsv2-layer--bbq,.bsv2-layer--avocado-sauce{height:11px;width:68%;border-radius:48% 54% 42% 56%;box-shadow:none;clip-path:polygon(0 38%,9% 21%,18% 43%,29% 14%,41% 39%,52% 17%,64% 42%,76% 18%,88% 39%,100% 24%,98% 70%,88% 57%,76% 78%,64% 56%,52% 79%,40% 58%,28% 77%,16% 55%,5% 72%)}.bsv2-layer--sauce{background:linear-gradient(#f4da91,#ceaa50)}.bsv2-layer--italian{background:linear-gradient(#efc77e,#bf8841)}.bsv2-layer--bbq{background:linear-gradient(#9b4430,#42160f)}.bsv2-layer--avocado-sauce{background:linear-gradient(#b8da72,#668d31)}.bsv2-layer--topping{height:18px;background:linear-gradient(#b97745,#80502f)}
        .bsv2-layer--sauce .bsv2-food-detail:after,.bsv2-layer--italian .bsv2-food-detail:after,.bsv2-layer--bbq .bsv2-food-detail:after,.bsv2-layer--avocado-sauce .bsv2-food-detail:after{content:"";position:absolute;left:13%;right:19%;top:2px;height:3px;border-radius:999px;background:linear-gradient(90deg,transparent,rgba(255,255,255,.52),rgba(255,255,255,.18),transparent);filter:blur(.25px);opacity:.9}

        .is-assembled .bsv2-layer--sauce,.is-assembled .bsv2-layer--italian,.is-assembled .bsv2-layer--bbq,.is-assembled .bsv2-layer--avocado-sauce{height:13px;width:72%}
        .is-assembled .bsv2-layer--lettuce{height:31px;width:82%}
        .is-assembled .bsv2-layer--tomato{height:24px;width:72%}
        .is-assembled .bsv2-layer--pickle,.is-assembled .bsv2-layer--onion,.is-assembled .bsv2-layer--fried-onion,.is-assembled .bsv2-layer--jalapeno{height:21px}
        .is-assembled .bsv2-layer--farmers-market{height:34px;width:75%}
        .is-assembled .bsv2-layer--guacamole{height:22px}

        .bsv2-empty{position:absolute;display:flex;flex-direction:column;align-items:center;gap:8px;color:#aaa39a;text-align:center}.bsv2-empty div{font-size:54px;filter:grayscale(.35);opacity:.45}.bsv2-empty strong{font-size:16px;color:#ded8cf}.bsv2-empty span{font-size:12px;color:#706b64}
        @keyframes bsv2-flash{0%{opacity:0}25%{opacity:1}100%{opacity:0}}
        @keyframes bsv2-drop{0%{transform:translate(-50%,-90px) scale(1.04);opacity:.55}72%{transform:translate(-50%,3px) scale(.99)}100%{transform:translateX(-50%);opacity:1}}
        @keyframes bsv2-top-close{0%{transform:translate(-50%,-125px) rotate(-2deg)}70%{transform:translate(-50%,5px) scaleY(.96)}100%{transform:translateX(-50%)}}
        @keyframes bsv2-cheese-drip{0%{transform:scaleY(.08);opacity:0}18%{opacity:.28}58%{transform:scaleY(.72);opacity:.9}84%{transform:scaleY(1.08);opacity:1}100%{transform:scaleY(1);opacity:1}}
        @keyframes bsv2-cheese-settle{0%{transform:scaleY(.96) scaleX(1)}42%{transform:scaleY(1.025) scaleX(1.005)}76%{transform:scaleY(1.06) scaleX(.998)}100%{transform:scaleY(1.045) scaleX(.998)}}
        @keyframes bsv2-steam-rise{0%{opacity:0;transform:translateY(12px) scale(.82)}22%{opacity:.48}70%{opacity:.25}100%{opacity:0;transform:translateY(-42px) translateX(8px) scale(1.15)}}
        @keyframes bsv2-heat{0%{opacity:0;transform:translateX(-50%) scale(.85)}28%{opacity:.95}100%{opacity:0;transform:translateX(-50%) scale(1.08)}}
        @keyframes bsv2-warm-settle{0%{opacity:.78}28%{opacity:1}100%{opacity:.76}}
        @media(max-width:720px){.bsv2-stage{border-radius:24px}.bsv2-stack{width:min(91vw,345px)}.bsv2-piece-label{display:block;left:auto;right:6px;max-width:46%;overflow:hidden;text-overflow:ellipsis;padding:4px 6px;font-size:8px;letter-spacing:.01em}.is-building .bsv2-layer{top:calc(78px + (var(--bsv2-r) * var(--bsv2-gap)))}}
        @media(prefers-reduced-motion:reduce){.bsv2-stage,.bsv2-piece{transition:none!important}.bsv2-assembly-flash,.bsv2-steam,.bsv2-heat-glow{display:none!important}.is-assembled .bsv2-layer,.is-assembled .bsv2-bun-top,.is-assembled .bsv2-stage-light,.is-assembled .bsv2-layer:after,.is-assembled .bsv2-food-detail{animation:none!important}.bsv2-stage-light{filter:none;opacity:.18}}
      `}</style>
    </div>
  );
}
