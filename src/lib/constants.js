export const SUPPLIER = {
  org_name: "Saaki Vriksh Foods And Beverages",
  gstin: "29DBWPS4204L2ZS",
  street_address: "108/1, 1st cross, Vaddrapalaya Agra Main Road",
  city: "BANGALORE",
  state: "Karnataka",
  country: "India",
  zip: "560043",
  phone: "9486622222",
  email: "saakivriksh4@gmail.com",
};

export const BANK_NOTES =
  "Account Name: Saaki Vriksh Foods & Beverages Account No: 920020061507862 Bank Name: Axis Bank IFSC & Branch: UTIB0002179 & HENNUR ROAD";

export const TERMS_GST =
  "Crates and bottles are properties of M/s. Saaki Vriksh foods and beverages, You are liable to return it back, Incase damaged or lost Rs. 60 will be charged per bottle and Rs.600 per crate.";

export const TERMS_NON_GST =
  "Crates and bottles are properties of manufacturer, You are liable to return it back, Incase damaged or lost Rs. 60 will be charged per bottle and Rs.600 per crate.";

export const CATEGORIES = ["Goli Fizz", "Goli Blast", "Petbottle"];
export const FLAVOURS = ["Orange", "Lemon", "Cola", "Mango", "Pineapple", "Apple", "Grape"];
export const BOTTLES_PER_CRATE = 24;
export const PETBOTTLE_PER_CRATE = 30;

export const bottlesPerCrate = (category) => (category === "Petbottle" ? PETBOTTLE_PER_CRATE : BOTTLES_PER_CRATE);

export const CGST_RATE = 20;
export const SGST_RATE = 20;
export const HSN_SAC = "22021010";

export const PAYMENT_MODES = ["UPI", "Cash", "Bank Transfer", "Cheque"];

export const priceKey = (category, flavour) => `${category}|${flavour}`;

export const getCategoryMrpField = (category) => {
  if (category === "Goli Fizz") return "goli_fizz_mrp";
  if (category === "Goli Blast") return "goli_blast_mrp";
  if (category === "Petbottle") return "petbottle_mrp";
  return null;
};

export const todayISO = () => new Date().toISOString().slice(0, 10);