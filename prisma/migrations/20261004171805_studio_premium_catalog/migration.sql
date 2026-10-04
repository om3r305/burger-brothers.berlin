-- The V2 normalizer already exposes these ingredients. Persist them and their
-- canonical prices together so an existing installation can actually order them.
-- Keep saved overrides and every unrelated setting/product extra.
BEGIN;

WITH defaults AS (
  SELECT '[
    {"id":"black-angus","name":"Black Angus Patty","group":"protein","addPrice":6,"removeCredit":0,"max":3,"active":true,"vegan":false,"visual":"black-angus"},
    {"id":"chicken-breast","name":"Chicken Breast","group":"protein","addPrice":4.5,"removeCredit":0,"max":3,"active":true,"vegan":false,"visual":"chicken-breast"},
    {"id":"farmers-market","name":"Farmers Market Gemüse","group":"topping","addPrice":3,"removeCredit":0,"max":2,"active":true,"vegan":true,"visual":"farmers-market"}
  ]'::jsonb AS ingredients
), studio_rows AS (
  SELECT s.id, s.key,
    CASE WHEN s.key='menu' THEN s.value->'burgerStudio'
      ELSE s.value->'menu'->'burgerStudio' END AS config
  FROM "Setting" s
  WHERE s."tenantId"='cf847d52-b1ef-421a-b153-fa020e2f4efa'
    AND s.key IN ('menu','bb_settings_v6','settings','app:settings')
), migrated AS (
  SELECT r.id, r.key, jsonb_set(r.config, '{ingredients}', r.config->'ingredients' ||
    COALESCE((SELECT jsonb_agg(d) FROM defaults, jsonb_array_elements(defaults.ingredients) d
      WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(r.config->'ingredients') i WHERE i->>'id'=d->>'id')), '[]'::jsonb)) AS config
  FROM studio_rows r WHERE jsonb_typeof(r.config->'ingredients')='array'
)
UPDATE "Setting" s SET value=jsonb_set(s.value,
  CASE WHEN m.key='menu' THEN '{burgerStudio}'::text[] ELSE '{menu,burgerStudio}'::text[] END,
  m.config), "updatedAt"=NOW()
FROM migrated m WHERE s.id=m.id;

WITH config AS (
  SELECT value->'menu'->'burgerStudio' AS studio FROM "Setting"
  WHERE "tenantId"='cf847d52-b1ef-421a-b153-fa020e2f4efa' AND key='bb_settings_v6'
), extras AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id','bstudio:add:' || (i->>'id'), 'sku','bstudio:add:' || (i->>'id'),
    'name',i->>'name', 'label',i->>'name', 'price',i->'addPrice')), '[]'::jsonb) AS items
  FROM config, jsonb_array_elements(config.studio->'ingredients') i
  WHERE i->>'id' IN ('black-angus','chicken-breast','farmers-market') AND i->>'active'='true'
)
UPDATE "Product" p SET "extrasJson"=
  COALESCE((SELECT jsonb_agg(e) FROM jsonb_array_elements(
    CASE WHEN jsonb_typeof(p."extrasJson")='array' THEN p."extrasJson" ELSE '[]'::jsonb END) e
    WHERE COALESCE(e->>'id',e->>'sku','') NOT IN (
      'bstudio:add:black-angus','bstudio:add:chicken-breast','bstudio:add:farmers-market')), '[]'::jsonb) || extras.items,
  "updatedAt"=NOW()
FROM extras, config
WHERE p."tenantId"='cf847d52-b1ef-421a-b153-fa020e2f4efa' AND config.studio->>'enabled'='true'
  AND (p.sku='BSTUDIO-SCRATCH-BASE' OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p."extrasJson")='array' THEN p."extrasJson" ELSE '[]'::jsonb END) e
    WHERE COALESCE(e->>'id',e->>'sku')='bstudio:marker'));

COMMIT;
