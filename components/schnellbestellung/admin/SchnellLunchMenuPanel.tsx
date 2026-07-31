"use client";

export type SchnellLunchMenuAdmin = {
  id: string;
  name: string;
  description: string;
  badge: string;
  enabled: boolean;
  vegetarian: boolean;
  sortOrder: number;
  menuPrice: number;
  burgerProductId: string;
  includedSideProductId: string;
  allowedSideProductIds: string[];
  allowExistingBurgerModifiers: boolean;
  allowNotes: boolean;
};

export type SchnellLunchSettingsAdmin = {
  enabled: boolean;
  weekdays: number[];
  startTime: string;
  endTime: string;
  timezone: "Europe/Berlin";
  menus: SchnellLunchMenuAdmin[];
};

export type SchnellAdminCatalogProduct = {
  id: string;
  name: string;
  category: string;
  categoryLabel: string;
  price: number;
};

type Props = {
  value: SchnellLunchSettingsAdmin;
  catalog: SchnellAdminCatalogProduct[];
  onChange: (value: SchnellLunchSettingsAdmin) => void;
};

const DAYS = [
  { value: 1, label: "Mo" },
  { value: 2, label: "Di" },
  { value: 3, label: "Mi" },
  { value: 4, label: "Do" },
  { value: 5, label: "Fr" },
  { value: 6, label: "Sa" },
  { value: 7, label: "So" },
];

const euro = (value: number) =>
  Number(value || 0).toLocaleString("de-DE", {
    style: "currency",
    currency: "EUR",
  });

function newLunchMenu(index: number): SchnellLunchMenuAdmin {
  return {
    id: crypto.randomUUID(),
    name: `Mittagsmenü ${index + 1}`,
    description: "Burger + Beilage inklusive",
    badge: "Mittagsmenü",
    enabled: true,
    vegetarian: false,
    sortOrder: (index + 1) * 10,
    menuPrice: 9,
    burgerProductId: "",
    includedSideProductId: "",
    allowedSideProductIds: [],
    allowExistingBurgerModifiers: true,
    allowNotes: true,
  };
}

export default function SchnellLunchMenuPanel({ value, catalog, onChange }: Props) {
  const burgers = catalog.filter(
    (product) => product.category === "burger" || product.category === "vegan",
  );
  const sides = catalog.filter((product) => product.category === "extras");
  const productById = new Map(catalog.map((product) => [product.id, product]));

  function updateMenu(id: string, patch: Partial<SchnellLunchMenuAdmin>) {
    onChange({
      ...value,
      menus: value.menus.map((menu) =>
        menu.id === id ? { ...menu, ...patch } : menu,
      ),
    });
  }

  function setIncludedSide(menu: SchnellLunchMenuAdmin, productId: string) {
    updateMenu(menu.id, {
      includedSideProductId: productId,
      allowedSideProductIds: Array.from(
        new Set([productId, ...menu.allowedSideProductIds].filter(Boolean)),
      ),
    });
  }

  function toggleAllowedSide(
    menu: SchnellLunchMenuAdmin,
    productId: string,
    checked: boolean,
  ) {
    const next = new Set(menu.allowedSideProductIds);
    if (checked) next.add(productId);
    else if (productId !== menu.includedSideProductId) next.delete(productId);

    if (menu.includedSideProductId) next.add(menu.includedSideProductId);
    updateMenu(menu.id, { allowedSideProductIds: Array.from(next) });
  }

  function toggleWeekday(day: number, checked: boolean) {
    const next = new Set(value.weekdays);
    if (checked) next.add(day);
    else next.delete(day);
    if (next.size === 0) return;

    onChange({
      ...value,
      weekdays: Array.from(next).sort((left, right) => left - right),
    });
  }

  return (
    <section className="mt-8 rounded-2xl border border-amber-300/30 bg-amber-300/[0.04] p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-black">Mittagsmenü</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-stone-400">
            Yalnız Schnellbestellung ekranında çalışır. Manuel yazılan tek fiyat
            menü fiyatıdır; burger, standart Beilage, alternatif Beilage ve
            ekstraların fiyatları mevcut ürünlerden otomatik okunur.
          </p>
        </div>
        <label className="flex items-center gap-3 rounded-xl border border-amber-300/30 bg-amber-300/10 px-4 py-3 font-black">
          <input
            type="checkbox"
            checked={value.enabled}
            onChange={(event) =>
              onChange({ ...value, enabled: event.target.checked })
            }
            className="h-5 w-5"
          />
          Mittagsmenü aktif
        </label>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_220px_220px]">
        <div>
          <div className="text-sm font-bold text-stone-300">Geçerli günler</div>
          <div className="mt-2 flex flex-wrap gap-2">
            {DAYS.map((day) => {
              const checked = value.weekdays.includes(day.value);
              return (
                <label
                  key={day.value}
                  className={`rounded-xl border px-3 py-2 text-sm font-black ${
                    checked
                      ? "border-emerald-400/50 bg-emerald-400/10"
                      : "border-stone-700 bg-black/20 text-stone-500"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(event) =>
                      toggleWeekday(day.value, event.target.checked)
                    }
                    className="sr-only"
                  />
                  {day.label}
                </label>
              );
            })}
          </div>
        </div>
        <label>
          <span className="text-sm text-stone-400">Başlangıç</span>
          <input
            type="time"
            value={value.startTime}
            onChange={(event) =>
              onChange({ ...value, startTime: event.target.value })
            }
            className="mt-1 w-full rounded-xl bg-stone-900 p-3"
          />
        </label>
        <label>
          <span className="text-sm text-stone-400">Bitiş</span>
          <input
            type="time"
            value={value.endTime}
            onChange={(event) =>
              onChange({ ...value, endTime: event.target.value })
            }
            className="mt-1 w-full rounded-xl bg-stone-900 p-3"
          />
        </label>
      </div>

      <div className="mt-3 text-xs text-stone-500">
        Saat dilimi: Europe/Berlin · Bitiş saatinden sonra kategori otomatik kapanır.
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-5">
        <div>
          <h3 className="text-lg font-black">Tanımlı Mittagsmenüler</h3>
          <p className="mt-1 text-sm text-stone-400">
            İstediğin kadar menü ekleyebilirsin.
          </p>
        </div>
        <button
          type="button"
          onClick={() =>
            onChange({
              ...value,
              menus: [...value.menus, newLunchMenu(value.menus.length)],
            })
          }
          className="rounded-xl bg-amber-400 px-4 py-2 font-black text-black"
        >
          + Mittagsmenü ekle
        </button>
      </div>

      <div className="mt-5 space-y-5">
        {value.menus.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-stone-700 p-7 text-center text-stone-400">
            Henüz Mittagsmenü tanımlanmadı.
          </div>
        ) : null}

        {value.menus.map((menu, index) => {
          const includedSide = productById.get(menu.includedSideProductId);
          const burger = productById.get(menu.burgerProductId);

          return (
            <article
              key={menu.id}
              className="rounded-2xl border border-stone-700 bg-black/25 p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="font-black">
                  #{index + 1} · {menu.name || "Adsız Mittagsmenü"}
                </div>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 text-sm font-bold">
                    <input
                      type="checkbox"
                      checked={menu.enabled}
                      onChange={(event) =>
                        updateMenu(menu.id, { enabled: event.target.checked })
                      }
                    />
                    Aktif
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      onChange({
                        ...value,
                        menus: value.menus.filter((item) => item.id !== menu.id),
                      })
                    }
                    className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm font-bold text-red-200"
                  >
                    Sil
                  </button>
                </div>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <label>
                  <span className="text-sm text-stone-400">Menü adı</span>
                  <input
                    value={menu.name}
                    onChange={(event) =>
                      updateMenu(menu.id, { name: event.target.value })
                    }
                    className="mt-1 w-full rounded-xl bg-stone-900 p-3"
                    placeholder="Cheesy Cheese Mittagsmenü"
                  />
                </label>
                <label>
                  <span className="text-sm text-stone-400">
                    Menü fiyatı (€) — manuel yazılan tek fiyat
                  </span>
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    value={Number(menu.menuPrice)}
                    onChange={(event) =>
                      updateMenu(menu.id, {
                        menuPrice: Number(event.target.value),
                      })
                    }
                    className="mt-1 w-full rounded-xl border border-amber-300/30 bg-stone-900 p-3 font-black text-amber-200"
                  />
                </label>
                <label className="md:col-span-2">
                  <span className="text-sm text-stone-400">Açıklama</span>
                  <input
                    value={menu.description}
                    onChange={(event) =>
                      updateMenu(menu.id, { description: event.target.value })
                    }
                    className="mt-1 w-full rounded-xl bg-stone-900 p-3"
                    placeholder="Burger + Pommes inklusive"
                  />
                </label>
                <label>
                  <span className="text-sm text-stone-400">Rozet</span>
                  <input
                    value={menu.badge}
                    onChange={(event) =>
                      updateMenu(menu.id, { badge: event.target.value })
                    }
                    className="mt-1 w-full rounded-xl bg-stone-900 p-3"
                    placeholder="Mittagsmenü"
                  />
                </label>
                <label>
                  <span className="text-sm text-stone-400">Sıralama</span>
                  <input
                    type="number"
                    step="1"
                    value={Number(menu.sortOrder)}
                    onChange={(event) =>
                      updateMenu(menu.id, { sortOrder: Number(event.target.value) })
                    }
                    className="mt-1 w-full rounded-xl bg-stone-900 p-3"
                  />
                </label>

                <label>
                  <span className="text-sm text-stone-400">Burger seç</span>
                  <select
                    value={menu.burgerProductId}
                    onChange={(event) =>
                      updateMenu(menu.id, {
                        burgerProductId: event.target.value,
                      })
                    }
                    className="mt-1 w-full rounded-xl bg-stone-900 p-3"
                  >
                    <option value="">Burger seç</option>
                    {burgers.map((product) => (
                      <option key={product.id} value={product.id}>
                        {product.categoryLabel} · {product.name} · {euro(product.price)}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  <span className="text-sm text-stone-400">
                    Menüye dahil standart Beilage
                  </span>
                  <select
                    value={menu.includedSideProductId}
                    onChange={(event) =>
                      setIncludedSide(menu, event.target.value)
                    }
                    className="mt-1 w-full rounded-xl bg-stone-900 p-3"
                  >
                    <option value="">Standart Beilage seç</option>
                    {sides.map((product) => (
                      <option key={product.id} value={product.id}>
                        {product.name} · {euro(product.price)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <div className="font-black">Alternatif Beilage seçenekleri</div>
                <p className="mt-1 text-xs leading-5 text-stone-400">
                  Ek ücret otomatik hesaplanır: seçilen ürünün güncel fiyatı −
                  standart Beilage güncel fiyatı. Burada manuel fark alanı yoktur.
                </p>

                {!includedSide ? (
                  <div className="mt-3 rounded-xl bg-amber-400/10 p-3 text-sm text-amber-100">
                    Önce standart Beilage seç.
                  </div>
                ) : (
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {sides.map((side) => {
                      const checked = menu.allowedSideProductIds.includes(side.id);
                      const included = side.id === menu.includedSideProductId;
                      const difference = Math.max(
                        0,
                        Number(side.price) - Number(includedSide.price),
                      );

                      return (
                        <label
                          key={side.id}
                          className={`flex items-center justify-between gap-3 rounded-xl border p-3 ${
                            checked
                              ? "border-emerald-400/35 bg-emerald-400/[0.07]"
                              : "border-stone-700 bg-black/20"
                          }`}
                        >
                          <span className="min-w-0">
                            <span className="block truncate font-bold">{side.name}</span>
                            <span className="text-xs text-stone-400">
                              {included ? "inklusive" : `Müşteriye +${euro(difference)}`}
                            </span>
                          </span>
                          <input
                            type="checkbox"
                            checked={checked || included}
                            disabled={included}
                            onChange={(event) =>
                              toggleAllowedSide(menu, side.id, event.target.checked)
                            }
                            className="h-5 w-5 shrink-0"
                          />
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <label className="flex items-center gap-3 rounded-xl border border-stone-700 p-3 font-bold">
                  <input
                    type="checkbox"
                    checked={menu.vegetarian}
                    onChange={(event) =>
                      updateMenu(menu.id, { vegetarian: event.target.checked })
                    }
                  />
                  Vegetarisch rozeti
                </label>
                <label className="flex items-center gap-3 rounded-xl border border-stone-700 p-3 font-bold">
                  <input
                    type="checkbox"
                    checked={menu.allowExistingBurgerModifiers}
                    onChange={(event) =>
                      updateMenu(menu.id, {
                        allowExistingBurgerModifiers: event.target.checked,
                      })
                    }
                  />
                  Burger ekstraları
                </label>
                <label className="flex items-center gap-3 rounded-xl border border-stone-700 p-3 font-bold">
                  <input
                    type="checkbox"
                    checked={menu.allowNotes}
                    onChange={(event) =>
                      updateMenu(menu.id, { allowNotes: event.target.checked })
                    }
                  />
                  Not alanı
                </label>
              </div>

              <div className="mt-4 rounded-xl border border-white/10 bg-black/30 p-3 text-sm text-stone-300">
                <strong>Canlı bağlantı:</strong>{" "}
                {burger ? burger.name : "Burger seçilmedi"} +{" "}
                {includedSide ? `${includedSide.name} inklusive` : "Beilage seçilmedi"} ·
                Menü fiyatı {euro(menu.menuPrice)}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
