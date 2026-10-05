// Phone previews keep the same food width for every recipe. Pack only the
// vertical positions into a fixed canvas instead of scaling an ever taller one.
export const MOBILE_STACK_HEIGHT = 365;
export const MOBILE_STACK_SCALE = 0.8;

export function mobileStackLayout(heights: number[], finalBottoms: number[], finalTop: number) {
  const foodCeiling = MOBILE_STACK_HEIGHT - 123 - 18;
  const base = 80;
  let gap = 30;
  heights.forEach((height, index) => {
    if (index > 0) gap = Math.min(gap, (foodCeiling - base - height) / index);
  });
  gap = Math.max(0, gap);
  const buildBottoms = heights.map((_, index) => base + index * gap);
  const buildTop = Math.max(100, ...buildBottoms.map((bottom, index) => bottom + heights[index] + 6));

  let compression = Math.min(1, (foodCeiling - 38) / Math.max(1, finalTop - 38));
  finalBottoms.forEach((bottom, index) => {
    if (bottom > 38) compression = Math.min(compression, (foodCeiling - heights[index] - 38) / (bottom - 38));
  });
  compression = Math.max(0, compression);
  return {
    buildBottoms,
    buildTop,
    finalBottoms: finalBottoms.map(bottom => 38 + (bottom - 38) * compression),
    finalTop: 38 + (finalTop - 38) * compression,
  };
}

// Matches the actual photo/CSS heights, including the tallest protein artwork.
export function mobileLayerHeight(kind: string) {
  const heights: Record<string, number> = {
    beef: 68, "black-angus": 80, crispy: 70, "chicken-breast": 64, vegan: 62,
    lettuce: 38, tomato: 27, onion: 24, bacon: 28, pickle: 25, jalapeno: 24,
    "fried-onion": 27, "farmers-market": 37, guacamole: 25,
    cheddar: 26, gouda: 26, mozzarella: 28, gorgonzola: 27,
    sauce: 13, italian: 13, bbq: 13, "avocado-sauce": 13,
  };
  return heights[kind] || 28;
}
