// lib/supabaseTypes.ts
// TypeScript interfaces mirroring supabase/migrations/001_initial_schema.sql
// Used to type the Supabase client (see supabaseClient.ts).

export type Role = "admin" | "user";
export type PaymentStatus = "completed" | "pending";
export type DispatchStatus = "pending" | "dispatched";
export type DeliveryStatus = "pending" | "delivered";
export type ProductCategory = "Goli Fizz" | "Goli Blast" | "Petbottle";
export type PaymentMode = "UPI" | "Cash" | "Bank Transfer" | "Cheque";
export type InvoiceSeriesType = "gst" | "non_gst";

export interface BillItem {
  category: ProductCategory;
  flavour: string;
  label?: string;
  crates: number;
  loose: number;
  rate: number;
  amount: number;
}

export interface Profile {
  id: string;
  email: string | null;
  full_name: string | null;
  role: Role;
  created_at: string;
  updated_at: string;
}

export interface Customer {
  id: string;
  user_id: string | null;
  customer_name: string;
  display_name: string | null;
  has_gst: boolean;
  place_of_supply: string | null;
  place_of_supply_state_code: string | null;
  gst_treatment: string | null;
  gstin: string | null;
  billing_attention: string | null;
  billing_address: string | null;
  billing_street2: string | null;
  billing_city: string | null;
  billing_state: string | null;
  billing_country: string | null;
  billing_code: string | null;
  shipping_attention: string | null;
  shipping_address: string | null;
  shipping_street2: string | null;
  shipping_city: string | null;
  shipping_state: string | null;
  shipping_country: string | null;
  shipping_code: string | null;
  goli_fizz_mrp: number;
  goli_blast_mrp: number;
  petbottle_mrp: number;
  payment_terms_label: string | null;
  closing_stock_crates: number;
  closing_stock_loose: number;
  product_prices: Record<string, { selling_price?: number; mrp?: number }>;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Product {
  id: string;
  user_id: string | null;
  category: ProductCategory;
  flavour: string;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface InvoiceSeries {
  id: string;
  user_id: string | null;
  type: InvoiceSeriesType;
  prefix: string;
  series_name: string;
  next_number: number;
  padding: number;
  created_at: string;
  updated_at: string;
}

export interface Bill {
  id: string;
  user_id: string | null;
  customer_id: string | null;
  has_gst: boolean;
  invoice_number: string;
  invoice_series: string | null;
  invoice_date: string;
  due_date: string | null;
  place_of_supply: string | null;
  place_of_supply_state_code: string | null;
  gst_treatment: string | null;
  gstin: string | null;
  billing_attention: string | null;
  billing_address: string | null;
  billing_street2: string | null;
  billing_city: string | null;
  billing_state: string | null;
  billing_country: string | null;
  billing_code: string | null;
  shipping_attention: string | null;
  shipping_address: string | null;
  shipping_street2: string | null;
  shipping_city: string | null;
  shipping_state: string | null;
  shipping_country: string | null;
  shipping_code: string | null;
  payment_terms_label: string | null;
  items: BillItem[];
  subtotal: number;
  tax_total: number;
  total: number;
  returned_crates: number;
  damaged_bottles: number;
  payment_status: PaymentStatus;
  payment_mode: string | null;
  paid_amount: number;
  dispatch_status: DispatchStatus;
  dispatch_date: string | null;
  delivery_status: DeliveryStatus;
  delivery_date: string | null;
  terms_conditions: string | null;
  created_by_name: string | null;
  modified_by_name: string | null;
  delivery_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Delivery {
  id: string;
  user_id: string | null;
  customer_id: string | null;
  bill_id: string | null;
  customer_name: string | null;
  delivery_date: string;
  payment_status: PaymentStatus;
  payment_mode: PaymentMode | null;
  paid_amount: number;
  items: BillItem[];
  returned_crates: number;
  damaged_bottles: number;
  total_bottles: number;
  total_amount: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface CrateEntry {
  id: string;
  user_id: string | null;
  customer_id: string | null;
  customer_name: string | null;
  entry_date: string;
  crates_returned: number;
  loose_bottles_returned: number;
  damaged_bottles: number;
  bill_id: string | null;
  source: "manual" | "bill" | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface DailyProduction {
  id: string;
  user_id: string | null;
  production_date: string;
  entries: Array<Record<string, unknown>>;
  total_units: number;
  closing_stock: Array<{ category: ProductCategory; flavour: string; quantity: number }>;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Order {
  id: string;
  user_id: string | null;
  customer_id: string | null;
  customer_name: string | null;
  display_name: string | null;
  has_gst: boolean;
  internal_invoice_number: string;
  invoice_number: string | null;
  invoice_series: string | null;
  order_date: string;
  items: BillItem[];
  total_bottles: number;
  total_amount: number;
  dispatch_status: DispatchStatus;
  dispatched_date: string | null;
  bill_id: string | null;
  created_by_name: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface DailySummary {
  id: string;
  user_id: string | null;
  user_name: string | null;
  summary_date: string;
  morning_start_time: string | null;
  evening_end_time: string | null;
  morning_kms: number;
  evening_kms: number;
  total_kms: number;
  created_at: string;
  updated_at: string;
}

export interface LiveLocation {
  user_id: string;
  latitude: number;
  longitude: number;
  speed: number;
  heading: number;
  is_live_active: boolean;
  updated_at: string;
}

export interface LocationHistory {
  id: string;
  user_id: string;
  latitude: number;
  longitude: number;
  accuracy: number;
  created_at: string;
}

export interface Database {
  public: {
    Tables: {
      profiles: { Row: Profile; Insert: Partial<Profile>; Update: Partial<Profile> };
      customers: { Row: Customer; Insert: Partial<Customer>; Update: Partial<Customer> };
      products: { Row: Product; Insert: Partial<Product>; Update: Partial<Product> };
      invoice_series: { Row: InvoiceSeries; Insert: Partial<InvoiceSeries>; Update: Partial<InvoiceSeries> };
      bills: { Row: Bill; Insert: Partial<Bill>; Update: Partial<Bill> };
      deliveries: { Row: Delivery; Insert: Partial<Delivery>; Update: Partial<Delivery> };
      crate_entries: { Row: CrateEntry; Insert: Partial<CrateEntry>; Update: Partial<CrateEntry> };
      daily_productions: { Row: DailyProduction; Insert: Partial<DailyProduction>; Update: Partial<DailyProduction> };
      orders: { Row: Order; Insert: Partial<Order>; Update: Partial<Order> };
      daily_summaries: { Row: DailySummary; Insert: Partial<DailySummary>; Update: Partial<DailySummary> };
      live_locations: { Row: LiveLocation; Insert: Partial<LiveLocation>; Update: Partial<LiveLocation> };
      location_history: { Row: LocationHistory; Insert: Partial<LocationHistory>; Update: Partial<LocationHistory> };
    };
  };
}