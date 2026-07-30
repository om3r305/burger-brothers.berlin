ALTER TABLE "Product"
ADD COLUMN "taxRate" INTEGER NOT NULL DEFAULT 7;

UPDATE "Product"
SET "taxRate" = 19
WHERE LOWER("category") IN (
  'drink',
  'drinks',
  'getränke',
  'getranke',
  'bubbletea',
  'bubble_tea'
);

ALTER TABLE "Product"
ADD CONSTRAINT "Product_taxRate_check"
CHECK ("taxRate" IN (7, 19));
