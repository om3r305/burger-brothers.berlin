import type { OrderMode, OrderStatus } from "@/lib/orders";

export type UnknownRecord = Record<string, unknown>;

export type DriverIdentity = {
  id: string;
  name: string;
};

export type DriverTab = "new" | "mine";

export type DriverPosition = {
  lat: number;
  lng: number;
  ts?: number;
};

export type DriverAssignment = {
  id?: string;
  name?: string;
  deviceId?: string;
  assignedAt?: number;
  lastPos?: DriverPosition | null;
  position?: DriverPosition | null;
  [key: string]: unknown;
};

export type DriverCustomer = {
  name?: string;
  phone?: string;
  address?: string;
  addressLine?: string;
  street?: string;
  house?: string;
  houseNo?: string;
  zip?: string;
  plz?: string;
  postalCode?: string;
  city?: string;
  email?: string;
  deliveryHint?: string;
  deliveryNote?: string;
  orderNote?: string;
  note?: string;
  lieferhinweis?: string;
  [key: string]: unknown;
};

export type DriverOrderExtra = {
  name?: string;
  label?: string;
  price?: number;
  [key: string]: unknown;
};

export type DriverOrderItem = {
  id?: string;
  sku?: string;
  code?: string;
  name: string;
  title?: string;
  category?: string;
  categoryKey?: string;
  type?: string;
  group?: string;
  section?: string;
  price: number;
  unitPrice?: number;
  qty: number;
  quantity?: number;
  add?: DriverOrderExtra[];
  extras?: DriverOrderExtra[];
  rm?: string[];
  remove?: string[];
  note?: string;
  [key: string]: unknown;
};

export type DriverOrderMeta = {
  status?: string;
  statusManual?: string;
  mode?: string;
  driver?: DriverAssignment | null;
  driverId?: string | null;
  driverName?: string | null;
  claimedAt?: number | null;
  deliveredAt?: number | null;
  doneAt?: number | null;
  completedAt?: number | null;
  lastPos?: DriverPosition | null;
  lastDriverPos?: DriverPosition | null;
  lastDriverPosAt?: number | null;
  firstSeenAt?: number | null;
  etaMin?: number | string | null;
  eta?: number | string | null;
  etaAdjustMin?: number | string | null;
  etaAdjust?: number | string | null;
  etaDeltaMin?: number | string | null;
  planned?: string | null;
  plannedTime?: string | null;
  planned_time?: string | null;
  preorderTime?: string | null;
  preorder_time?: string | null;
  payment?: UnknownRecord;
  checkout?: UnknownRecord;
  paymentMethod?: string;
  payment_method?: string;
  paymentType?: string;
  payment_type?: string;
  paymentProvider?: string;
  payment_provider?: string;
  paymentStatus?: string;
  payment_status?: string;
  stripePaymentIntentId?: string;
  paymentIntentId?: string;
  checkoutSessionId?: string;
  tip?: number | string;
  trinkgeld?: number | string;
  tipAmount?: number | string;
  trinkgeldAmount?: number | string;
  payableTotal?: number | string;
  total?: number | string;
  note?: string;
  orderNote?: string;
  deliveryNote?: string;
  lieferhinweis?: string;
  customerNote?: string;
  history?: unknown[];
  createdAt?: string | number;
  created_at?: string | number;
  orderCreatedAt?: string | number;
  order_created_at?: string | number;
  submittedAt?: string | number;
  submitted_at?: string | number;
  checkoutAt?: string | number;
  checkout_at?: string | number;
  createdAtMs?: number;
  updatedAt?: string | number;
  updated_at?: string | number;
  deliveredAtMs?: number;
  ts?: string | number;
  [key: string]: unknown;
};

export type DriverOrder = {
  id: string;
  orderId?: string;
  ts: number;
  createdAt?: string | null;
  created_at?: string | null;
  updatedAt?: string | null;
  updated_at?: string | null;
  doneAt?: number | string | null;
  done_at?: number | string | null;
  completedAt?: number | string | null;
  completed_at?: number | string | null;
  deliveredAt?: number | string | null;
  delivered_at?: number | string | null;
  mode: OrderMode;
  channel?: string;
  status: OrderStatus;
  planned?: string | null;
  etaMin?: number | null;
  etaAdjustMin?: number | null;
  customer: DriverCustomer;
  items: DriverOrderItem[];
  meta: DriverOrderMeta;
  driver?: DriverAssignment | null;
  driverName?: string;
  plz?: string | null;
  note?: string;
  orderNote?: string;
  deliveryNote?: string;
  total?: number;
  amount?: number;
  payable?: number;
  toPay?: number;
  archivedAt?: string | number | null;
  anonymizedAt?: string | number | null;
  payment?: UnknownRecord;
  checkout?: UnknownRecord;
  paymentMethod?: string;
  payment_method?: string;
  paymentType?: string;
  payment_type?: string;
  paymentProvider?: string;
  payment_provider?: string;
  paymentStatus?: string;
  payment_status?: string;
  tip?: number | string;
  trinkgeld?: number | string;
  gratuity?: number | string;
  [key: string]: unknown;
};

export type DriverToastTone = "info" | "success" | "warning" | "error";

export type DriverToastMessage = {
  id: number;
  tone: DriverToastTone;
  message: string;
};

export type DriverConfirmRequest = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "default" | "warning" | "danger";
  details?: string[];
};

export type DriverCompletionToast = {
  id: string;
  tip: number;
  total: number;
};

export type DriverStats = {
  count: number;
  total: number;
  tip: number;
};

export type DriverRouteSettings = {
  routePlzPriority: string[];
  storeOrigin: string;
};

export type DriverTimingSettings = {
  timezone: string;
  avgPickup: number;
  avgDelivery: number;
  refreshMs: number;
  activeUnknownGraceMs: number;
};
