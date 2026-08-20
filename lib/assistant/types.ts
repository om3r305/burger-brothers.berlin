export type AssistantRole = "user" | "assistant";

export type AssistantConversationMessage = {
  role: AssistantRole;
  content: string;
};

export type AssistantCatalogExtra = {
  id: string;
  name: string;
  price: number;
};

export type AssistantCatalogProduct = {
  id: string;
  sku: string;
  name: string;
  category: string;
  description: string;
  basePrice: number;
  displayPrice: number;
  badge: string;
  extras: AssistantCatalogExtra[];
  allergens: string[];
};

export type AssistantCartLine = {
  productId: string;
  name: string;
  quantity: number;
  extraIds?: string[];
  remove?: string[];
  note?: string;
};

export type AssistantActionType =
  | "add_to_cart"
  | "show_product"
  | "go_checkout";

export type AssistantAction = {
  type: AssistantActionType;
  productId: string;
  quantity: number;
  extraIds: string[];
  remove: string[];
  note: string;
  requiresConfirmation: boolean;
};

export type AssistantResult = {
  reply: string;
  language: string;
  actions: AssistantAction[];
  provider?: "local" | "openai" | "local_fallback";
  model?: string;
};

export type AssistantRequest = {
  message: string;
  history?: AssistantConversationMessage[];
  catalog?: AssistantCatalogProduct[];
  cart?: AssistantCartLine[];
  orderMode?: "pickup" | "delivery";
  lastSuggestedProductIds?: string[];
};
