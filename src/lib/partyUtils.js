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
