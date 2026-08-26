from pathlib import Path

stack_path = Path("components/burger-studio/BurgerStackV2.tsx")
stack = stack_path.read_text(encoding="utf-8")

old_cheese = '''        .is-assembled .bsv2-layer--cheddar:after,.is-assembled .bsv2-layer--gouda:after,.is-assembled .bsv2-layer--mozzarella:after,.is-assembled .bsv2-layer--gorgonzola:after{content:"";position:absolute;z-index:-1;left:19%;bottom:-8px;width:13px;height:14px;border-radius:2px 2px 10px 10px;background:var(--bsv2-cheese-drip);box-shadow:46px 3px 0 -4px var(--bsv2-cheese-drip),103px 1px 0 -2px var(--bsv2-cheese-drip);transform-origin:50% 0;animation:bsv2-cheese-drip .52s cubic-bezier(.2,.8,.3,1) both;animation-delay:calc(220ms + (var(--bsv2-i) * 48ms))}.is-assembled .bsv2-layer--cheddar .bsv2-food-detail,.is-assembled .bsv2-layer--gouda .bsv2-food-detail,.is-assembled .bsv2-layer--mozzarella .bsv2-food-detail,.is-assembled .bsv2-layer--gorgonzola .bsv2-food-detail{animation:bsv2-cheese-settle .5s ease-out both;animation-delay:calc(210ms + (var(--bsv2-i) * 48ms))}'''
new_cheese = '''        .is-assembled .bsv2-layer--cheddar:after,.is-assembled .bsv2-layer--gouda:after,.is-assembled .bsv2-layer--mozzarella:after,.is-assembled .bsv2-layer--gorgonzola:after{content:"";position:absolute;z-index:-1;left:19%;bottom:-8px;width:13px;height:14px;border-radius:2px 2px 10px 10px;background:var(--bsv2-cheese-drip);box-shadow:46px 3px 0 -4px var(--bsv2-cheese-drip),103px 1px 0 -2px var(--bsv2-cheese-drip);transform-origin:50% 0;animation:bsv2-cheese-drip 3.2s cubic-bezier(.22,.7,.24,1) both;animation-delay:calc(520ms + (var(--bsv2-count) * 48ms))}.is-assembled .bsv2-layer--cheddar .bsv2-food-detail,.is-assembled .bsv2-layer--gouda .bsv2-food-detail,.is-assembled .bsv2-layer--mozzarella .bsv2-food-detail,.is-assembled .bsv2-layer--gorgonzola .bsv2-food-detail{animation:bsv2-cheese-settle 2.8s ease-in-out both;animation-delay:calc(500ms + (var(--bsv2-count) * 48ms))}'''

old_keyframes = '''        @keyframes bsv2-cheese-drip{0%{transform:scaleY(.15);opacity:0}45%{opacity:1}78%{transform:scaleY(1.12)}100%{transform:scaleY(1);opacity:1}}
        @keyframes bsv2-cheese-settle{0%{transform:scaleY(.84) scaleX(1.02)}55%{transform:scaleY(1.09) scaleX(.99)}100%{transform:scale(1)}}'''
new_keyframes = '''        @keyframes bsv2-cheese-drip{0%{transform:scaleY(.08);opacity:0}18%{opacity:.28}58%{transform:scaleY(.72);opacity:.9}84%{transform:scaleY(1.08);opacity:1}100%{transform:scaleY(1);opacity:1}}
        @keyframes bsv2-cheese-settle{0%{transform:scaleY(.96) scaleX(1)}42%{transform:scaleY(1.025) scaleX(1.005)}76%{transform:scaleY(1.06) scaleX(.998)}100%{transform:scaleY(1.045) scaleX(.998)}}'''

old_mobile = '''        @media(max-width:720px){.bsv2-stage{border-radius:24px}.bsv2-stack{width:min(91vw,345px)}.bsv2-piece-label{display:none}.is-building .bsv2-layer{top:calc(78px + (var(--bsv2-r) * var(--bsv2-gap)))}}'''
new_mobile = '''        @media(max-width:720px){.bsv2-stage{border-radius:24px}.bsv2-stack{width:min(91vw,345px)}.bsv2-piece-label{display:block;left:auto;right:6px;max-width:46%;overflow:hidden;text-overflow:ellipsis;padding:4px 6px;font-size:8px;letter-spacing:.01em}.is-building .bsv2-layer{top:calc(78px + (var(--bsv2-r) * var(--bsv2-gap)))}}'''

for old, new, label in [
    (old_cheese, new_cheese, "cheese animation block"),
    (old_keyframes, new_keyframes, "cheese keyframes"),
    (old_mobile, new_mobile, "mobile label media rule"),
]:
    count = stack.count(old)
    if count != 1:
        raise SystemExit(f"Expected exactly one {label}, found {count}; refusing partial patch")
    stack = stack.replace(old, new, 1)
stack_path.write_text(stack, encoding="utf-8")

test_path = Path("tools/burger-studio-mobile-assembly-regression-tests.cjs")
test = test_path.read_text(encoding="utf-8")
marker = 'console.log("Burger Studio mobile assembly regression tests: OK");'
assertions = '''// Mobile live polish: ingredient labels remain visible and bounded instead of
// being removed at <=720px. The finished burger still fades them away.
assert(!stack.includes('.bsv2-piece-label{display:none}'));
assert(stack.includes('.bsv2-piece-label{display:block;left:auto;right:6px;max-width:46%;overflow:hidden;text-overflow:ellipsis'));
assert(stack.includes('.is-assembled .bsv2-piece-label{opacity:0}'));

// Cheese begins only after the top-bun close window and then melts slowly.
assert(stack.includes('animation:bsv2-cheese-drip 3.2s'));
assert(stack.includes('animation-delay:calc(520ms + (var(--bsv2-count) * 48ms))'));
assert(stack.includes('animation:bsv2-cheese-settle 2.8s ease-in-out both'));
assert(stack.includes('animation-delay:calc(500ms + (var(--bsv2-count) * 48ms))'));

// Preserve the smoke/steam finish and reduced-motion protection.
assert(stack.includes('animation:bsv2-steam-rise 1.55s ease-out both'));
assert(stack.includes('.is-assembled .bsv2-layer:after,.is-assembled .bsv2-food-detail{animation:none!important}'));

console.log("Burger Studio mobile assembly regression tests: OK");'''
if test.count(marker) != 1:
    raise SystemExit("Could not find unique mobile regression test marker")
test = test.replace(marker, assertions, 1)
test_path.write_text(test, encoding="utf-8")
