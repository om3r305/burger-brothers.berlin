export type OrderStatus =
  | "new"
  | "preparing"
  | "ready"
  | "out_for_delivery"
  | "done"
  | "cancelled";

export type OrderMode = "pickup" | "delivery";
export type TvSoundKind = "delivery" | "pickup";
export type TvView = "incoming" | "onroad" | "finished";
export type LeftPanel = "overview" | "articles";

export type StoredOrderExtra = {
  label?: string;
  name?: string;
  price?: number;
};

export type StoredOrderItem = {
  id?: string;
  sku?: string;
  name: string;
  category?: string;
  price: number;
  qty: number;
  add?: StoredOrderExtra[];
  rm?: string[];
  note?: string;
};

export type CustomerAddressInfo = {
  note?: string;
  hint?: string;
};

export type Customer = {
  name?: string;
  customerName?: string;
  phone?: string;
  telephone?: string;
  addressLine?: string;
  address?: string;
  street?: string;
  house?: string;
  houseNo?: string;
  plz?: string | null;
  zip?: string | null;
  postalCode?: string | null;
  deliveryHint?: string;
  note?: string;
  orderNote?: string;
  deliveryNote?: string;
  hinweis?: string;
  paymentMethod?: string;
  payment_method?: string;
  zahlung?: string;
  zahlungsart?: string;
  addressInfo?: CustomerAddressInfo;
  addresses?: CustomerAddressInfo;
};

export type DriverPosition = {
  lat?: number;
  lng?: number;
  latitude?: number;
  longitude?: number;
  lon?: number;
  ts?: number;
};

export type Driver = {
  id?: string | null;
  name?: string | null;
  lastPos?: DriverPosition;
  lastDriverPos?: DriverPosition;
  driverPos?: DriverPosition;
  position?: DriverPosition;
};

export type Adjustment = {
  type?: string;
  label?: string;
  title?: string;
  name?: string;
  code?: string;
  couponCode?: string;
  reason?: string;
  source?: string;
  campaign?: string;
  campaignName?: string;
  campaignTitle?: string;
  amount?: number | string;
  value?: number | string;
  price?: number | string;
  total?: number | string;
};

export type CouponMeta = {
  code?: string;
  couponCode?: string;
  title?: string;
  name?: string;
  discountAmount?: number | string;
  couponDiscount?: number | string;
  amount?: number | string;
};

export type PaymentInfo = {
  method?: string;
  type?: string;
  name?: string;
  provider?: string;
  status?: string;
  paid?: boolean | string;
  isPaid?: boolean | string;
};

export type Pricing = {
  subtotal?: number | string;
  total?: number | string;
  delivery?: number | string;
  deliveryFee?: number | string;
  deliverySurcharge?: number | string;
  surcharges?: number | string | Adjustment[];
  surcharge?: number | string;
  shipping?: number | string;
  ship?: number | string;
  delivery_cost?: number | string;
  zoneFee?: number | string;
  service?: number | string;
  other?: number | string;
  misc?: number | string;
  discount?: number | string;
  discountAmount?: number | string;
  campaignDiscount?: number | string;
  campaignDiscountAmount?: number | string;
  campaignName?: string;
  campaignTitle?: string;
  campaign?: string;
  discountReason?: string;
  discountLabel?: string;
  couponTitle?: string;
  tip?: number | string;
  tipAmount?: number | string;
  tip_amount?: number | string;
  trinkgeld?: number | string;
  trinkgeldAmount?: number | string;
  pickupTip?: number | string;
  pickupTipAmount?: number | string;
  kitchenTip?: number | string;
  kitchenTipAmount?: number | string;
  tipKitchen?: number | string;
  paymentMethod?: string;
  payment_method?: string;
  paymentType?: string;
  payment_type?: string;
  paymentStatus?: string;
  payment_status?: string;
  totals?: Adjustment[];
  summary?: Adjustment[];
  breakdown?: Adjustment[];
  fees?: Adjustment[];
};

export type Fees = Pricing;

export type OrderMeta = {
  createdAt?: string | number;
  created_at?: string | number;
  orderCreatedAt?: string | number;
  order_created_at?: string | number;
  submittedAt?: string | number;
  submitted_at?: string | number;
  checkoutAt?: string | number;
  checkout_at?: string | number;
  updatedAt?: string | number;
  updated_at?: string | number;
  ts?: string | number;
  history?: unknown[];
  status?: string;
  statusManual?: string;
  etaMin?: number | string;
  eta?: number | string;
  etaAdjustMin?: number | string;
  etaAdjust?: number | string;
  note?: string;
  orderNote?: string;
  deliveryNote?: string;
  doneAt?: string | number;
  done_at?: string | number;
  completedAt?: string | number;
  completed_at?: string | number;
  deliveredAt?: string | number;
  delivered_at?: string | number;
  driver?: Driver;
  driverId?: string;
  driverName?: string;
  payment?: PaymentInfo;
  paymentMethod?: string;
  payment_method?: string;
  paymentType?: string;
  payment_type?: string;
  payMethod?: string;
  pay_method?: string;
  zahlung?: string;
  zahlungsart?: string;
  paymentStatus?: string;
  payment_status?: string;
  paid?: boolean | string;
  isPaid?: boolean | string;
  campaignName?: string;
  campaignTitle?: string;
  campaign?: string;
  discountReason?: string;
  discountLabel?: string;
  coupon?: string;
  couponTitle?: string;
  couponDiscount?: number | string;
  couponMeta?: CouponMeta;
  couponLifecycle?: CouponMeta;
  discountAmount?: number | string;
  tip?: number | string;
  tipAmount?: number | string;
  tip_amount?: number | string;
  trinkgeld?: number | string;
  trinkgeldAmount?: number | string;
  pickupTip?: number | string;
  pickupTipAmount?: number | string;
  kitchenTip?: number | string;
  kitchenTipAmount?: number | string;
  tipKitchen?: number | string;
  totals?: Adjustment[];
  summary?: Adjustment[];
  breakdown?: Adjustment[];
  fees?: Adjustment[];
  adjustments?: Adjustment[];
  acceptedAt?: number;
  acceptedBy?: string;
  finalEtaMin?: number;
  acceptedEtaMin?: number;
  planned?: string;
  confirmedPlanned?: string;
  acceptedPlanned?: string;
};

export type StoredOrder = {
  id: string;
  orderId?: string;
  ts: number;
  createdAt?: string | null;
  created_at?: string | null;
  updatedAt?: string | null;
  updated_at?: string | null;
  doneAt?: string | null;
  done_at?: string | null;
  completedAt?: string | null;
  completed_at?: string | null;
  deliveredAt?: string | null;
  delivered_at?: string | null;
  mode: OrderMode;
  channel?: string;
  status: OrderStatus;
  legacyStatus?: string;
  planned?: string | null;
  etaMin?: number | null;
  etaAdjustMin?: number | null;
  customer?: Customer;
  customerName?: string;
  phone?: string;
  addressLine?: string;
  items: StoredOrderItem[];
  meta?: OrderMeta;
  pricing?: Pricing;
  fees?: Fees;
  adjustments?: Adjustment[];
  merchandise?: number;
  discount?: number;
  surcharges?: number;
  couponDiscount?: number;
  coupon?: string | null;
  total?: number;
  amount?: number;
  payable?: number;
  toPay?: number;
  driver?: Driver | null;
  driverName?: string;
  plz?: string | null;
  note?: string;
  orderNote?: string;
  deliveryNote?: string;
  comment?: string;
  comments?: string;
  checkoutNote?: string;
  basketNote?: string;
  cartNote?: string;
  extraNote?: string;
  delivery?: { note?: string };
  payment?: PaymentInfo;
  paymentMethod?: string;
  payment_method?: string;
  paymentType?: string;
  payment_type?: string;
  payMethod?: string;
  pay_method?: string;
  zahlung?: string;
  zahlungsart?: string;
  paymentStatus?: string;
  payment_status?: string;
  paid?: boolean | string;
  isPaid?: boolean | string;
  history?: unknown[];
  totals?: Adjustment[];
  summary?: Adjustment[];
  breakdown?: Adjustment[];
  tip?: number | string;
  tipAmount?: number | string;
  tip_amount?: number | string;
  trinkgeld?: number | string;
  trinkgeldAmount?: number | string;
  pickupTip?: number | string;
  pickupTipAmount?: number | string;
  kitchenTip?: number | string;
  kitchenTipAmount?: number | string;
  tipKitchen?: number | string;
};

export type TvProduct = {
  id?: string;
  sku?: string;
  code?: string;
  name: string;
  category?: string;
  active?: boolean;
  price?: number;
};

export type ProductAvailabilityEntry = {
  disabled?: boolean;
  mode?: "today" | "manual" | string;
  until?: string | null;
  by?: string;
  updatedAt?: number;
  productId?: string;
  name?: string;
};

export type ProductAvailabilityMap = Record<
  string,
  ProductAvailabilityEntry | null | undefined
>;

export type ProductAvailabilityAction = "open" | "today" | "manual";

export type DiscountRow = {
  label: string;
  amount: number;
};

export type MinuteCacheEntry = {
  deadlineMs: number;
  etaKey: number;
  plannedKey: string;
};

export type TvOrderClockEntry = {
  startMs: number;
  dayKey: string;
  orderId?: string;
};

export type TvFirstSeenEntry = {
  firstSeenMs: number;
  dayKey: string;
  orderId?: string;
};

export type TvToastTone = "success" | "error" | "warning" | "info";

export type TvToastMessage = {
  id: number;
  tone: TvToastTone;
  message: string;
};

export type TvConfirmRequest = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
};
