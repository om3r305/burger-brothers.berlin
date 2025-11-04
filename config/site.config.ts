// config/site.ts
export const siteConfig = {
  brand: {
    name: "Burger Brothers Berlin",
    logoPath: "/logo-burger-brothers.png",
    slogan: "Retro-Optik mit ruhigen Flammen.",
  },

  /** Kontakt & Links – Footer ve Checkout buradan okuyor */
  contact: {
    /** WhatsApp butonu için: sadece rakamlar, ülke kodu dahil (49...) */
     whatsappDefaultMessage: "Hallo! Ich möchte bestellen.",
    phone: "030 40573030",
    address: "Berliner Straße 9, 13507 Berlin",
    email: "contact@burgerbrothers.berlin",
    instagram: "https://instagram.com/burgerbrothers",
    tiktok: "",
    facebook: "",
    googleMaps: "https://maps.app.goo.gl/wBEDLh8jVxsx64kMA",
    googleReviews: "www.google.com/maps/place//data=!4m3!3m2!1s0x47a85585f1c7f571:0xf1edb31a065e27c2!12e1?source=g.page.m.nr._&laa=nmx-review-solicitation-recommendation-card",
  },

  /** Temel UI ayarları */
  ui: {
    colors: { bg: "#1b1713", text: "#f5efe6", neon: "#39FF14" },
    entryButtonLabel: "Jetzt bestellen",
    /** İstersen splash’ı atlamak için true yap */
    skipSplash: false,
  },

  /** Sesler (Landing’de kullanılıyor) */
  audio: {
    fireLoop:
      "https://cdn.pixabay.com/download/audio/2021/10/26/audio_8c0b2b.mp3?filename=fire-crackling-ambient-ambient-1-5960.mp3",
    grillLoop:
      "https://cdn.pixabay.com/download/audio/2022/03/15/audio_2dd6ea.mp3?filename=steak-sizzle-1-112268.mp3",
    click:
      "https://cdn.pixabay.com/download/audio/2021/09/14/audio_9b8f3e2b3e.mp3?filename=menu-click-110624.mp3",
    volume: { fire: 0.45, grill: 0.45, click: 0.8 },
  },

  /** Fiyat/indirim kuralları */
  rules: {
    /** Teslimat için gerekli minimum (store.computePricing bunu kullanır) */
    minOrderTotal: 15,
    /** İndirim eşiği ve oran (örn. %10) */
    discountThreshold: 15,
    discountRate: 0.1,
  },

  /** Menü kategorileri – Admin ve Menü aynı listeyi paylaşır */
  menu: {
    categories: [
      { id: "burger",     label: "Burger" },
      { id: "vegan",      label: "Vegan / Vegetarisch" },
      { id: "extras",     label: "Extras" },
      { id: "sauces",     label: "Soßen" },
      { id: "hotdogs",    label: "Hot Dogs" },
      { id: "donuts",     label: "Donuts" },        // 🆕
      { id: "bubbleTea",  label: "Bubble Tea" },    // 🆕
      { id: "drinks",     label: "Getränke" },
    ],
  },

  /** Varsayılan feature flag’ler (Admin Settings yoksa buradan okunur) */
  features: {
    donuts:    { enabled: true },    // 🆕
    bubbleTea: { enabled: true },    // 🆕
  },

  /** Kampanyalar & Görsel rozetler */
  offers: {
    /** —— ÖNEMLİ: Checkout’taki ücretsiz sos banner’ı bunun enabled alanına bakıyor —— */
    freebies: {
      enabled: true,               // <- Banner’ın görünmesi için gerekli
      label: "Gratis Soßen",
      category: "sauces",
      tiers: [
        { minTotal: 15, freeSauces: 1 },
        { minTotal: 30, freeSauces: 2 },
        { minTotal: 45, freeSauces: 3 },
      ],
    },
    badges: {
      veganWeek: { text: "Vegan-Woche", color: "bg-emerald-500" },
      fathersDay: { text: "Vatertag", color: "bg-amber-400" },
    },
  },

  /** Opsiyonel promosyon motoru (ileride kullanılmak üzere) */
  promotions: [
    // örn:
    // {
    //   id: "vatertag-10",
    //   name: "Vatertag 10% auf Burger",
    //   type: "percentOffCategory",
    //   targetCategory: "burger",
    //   percent: 10,
    //   badgeText: "−10%",
    //   active: false,
    //   startsAt: "2025-06-01T00:00:00+02:00",
    //   endsAt: "2025-06-02T23:59:59+02:00",
    //   priority: 10,
    // },
  ],

  /** Teslimat bölgeleri (Checkout → PLZ kontrolü buradan) */
  delivery: {
    zones: [
      { zip: "13507", minPayable: 15 },
      { zip: "13509", minPayable: 15 },
      { zip: "13437", minPayable: 25 },
      { zip: "13467", minPayable: 25 },
      { zip: "13469", minPayable: 25 },
      { zip: "13503", minPayable: 25 },
      { zip: "13505", minPayable: 25 },
      { zip: "13403", minPayable: 20 },
      { zip: "13405", minPayable: 20 },
    ],
    requireKnownZip: true,
  },

  /** (Opsiyonel) Basit analytics toplayıcı için bayraklar */
  analytics: {
    enabled: true,
    /** İstersen değiştir: /api/analytics/collect */
    endpoint: "/api/analytics/collect",
    sampleRate: 1.0,
  },
} as const;

export type SiteConfig = typeof siteConfig;
export default siteConfig;
