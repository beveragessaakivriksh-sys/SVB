import { customerClosingStock } from "./billUtils";

// Customers, distributors and distributor hotels share the same pricing/GST
// shape, but their primary name column, id column and table differ. These
// helpers keep Orders, Bill Entries, cloning, summaries and stock calculations
// party-type agnostic.

// A distributor hotel is a "party" too: stored under a distributor and
// referenced by distributor_hotel_id on orders / bills / deliveries.
export function isDistributorHotel(record) {
  return !!record && (record.party_type === "distributor_hotel" || !!record.distributor_id || !!record.distributor_hotel_id);
}

export function isDistributorParty(record) {
  return !!record && (record.party_type === "distributor" || !!record.distributor_id || isDistributorHotel(record));
}

export function partyTypeOf(record) {
  return isDistributorParty(record) ? "distributor" : "customer";
}

export function partyName(party) {
  return party?.hotel_name || party?.distributor_name || party?.customer_name || party?.display_name || "";
}

export function partyDisplayName(party) {
  return party?.display_name || partyName(party);
}

// The parent distributor of any order / bill / delivery — either directly or
// through its distributor hotel. Used to show the distributor name alongside
// hotel entries everywhere (tables, PDFs and CSV exports).
export function distributorIdOf(record, distributorsById = {}, distributorHotelsById = {}) {
  if (!record) return null;
  if (record.distributor_id) return record.distributor_id;
  const hotel = record.distributor_hotel_id && distributorHotelsById[record.distributor_hotel_id];
  return hotel?.distributor_id || null;
}

export function distributorNameOf(record, distributorsById = {}, distributorHotelsById = {}) {
  const id = distributorIdOf(record, distributorsById, distributorHotelsById);
  const d = id && distributorsById[id];
  return d ? (d.display_name || d.distributor_name || "") : "";
}

// "Hotel Name (Distributor Name)" — avoids duplicating the label if the name
// already contains it (older records may have been saved with it).
export function withDistributorLabel(name, distributorName) {
  const label = String(name || "").trim();
  const dist = String(distributorName || "").trim();
  if (!label || !dist || label.includes(dist)) return label;
  return `${label} (${dist})`;
}

// Alpha-sorts customers, distributors or distributor hotels by display name.
export function sortPartiesAlpha(parties = []) {
  return [...parties].sort((a, b) =>
    partyDisplayName(a).localeCompare(partyDisplayName(b), undefined, { sensitivity: "base" })
  );
}

export function resolveParty(record, customersById = {}, distributorsById = {}, distributorHotelsById = {}) {
  if (!record) return undefined;
  if (record.distributor_hotel_id && distributorHotelsById[record.distributor_hotel_id]) {
    return distributorHotelsById[record.distributor_hotel_id];
  }
  return isDistributorParty(record)
    ? distributorsById[record.distributor_id]
    : customersById[record.customer_id];
}

export function distributorClosingStock(distributor, bills = []) {
  return customerClosingStock(distributor, bills, []);
}
