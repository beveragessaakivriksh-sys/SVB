import { describe, it, expect } from "vitest";
import {
  isDistributorHotel,
  isDistributorParty,
  partyTypeOf,
  partyName,
  partyDisplayName,
  sortPartiesAlpha,
  resolveParty,
  distributorClosingStock,
} from "@/lib/partyUtils";

const customer = { id: "c1", customer_name: "Hotel One", display_name: "Hotel One" };
const distributor = { id: "d1", distributor_name: "Distributor One", display_name: "Dist One" };
const hotel = { id: "h1", distributor_id: "d1", hotel_name: "Hotel Alpha", display_name: "Hotel Alpha" };

describe("distributor party helpers", () => {
  it("detects distributor records by party_type or distributor_id", () => {
    expect(isDistributorParty({ party_type: "distributor" })).toBe(true);
    expect(isDistributorParty({ distributor_id: "d1" })).toBe(true);
    expect(isDistributorParty({ party_type: "customer", customer_id: "c1" })).toBe(false);
    expect(partyTypeOf({ distributor_id: "d1" })).toBe("distributor");
    expect(partyTypeOf({ customer_id: "c1" })).toBe("customer");
  });

  it("reads the correct name column for each party type", () => {
    expect(partyName(customer)).toBe("Hotel One");
    expect(partyName(distributor)).toBe("Distributor One");
    expect(partyDisplayName(distributor)).toBe("Dist One");
  });

  it("sorts customers and distributors together by display name", () => {
    const list = [distributor, customer, { display_name: "Alpha Traders", distributor_name: "Alpha Traders" }];
    expect(sortPartiesAlpha(list).map(partyDisplayName)).toEqual(["Alpha Traders", "Dist One", "Hotel One"]);
  });

  it("resolves the party from the matching lookup map", () => {
    expect(resolveParty({ customer_id: "c1" }, { c1: customer }, { d1: distributor })).toBe(customer);
    expect(resolveParty({ distributor_id: "d1" }, { c1: customer }, { d1: distributor })).toBe(distributor);
    expect(resolveParty({ party_type: "distributor", distributor_id: "missing" }, {}, {})).toBeUndefined();
  });

  it("computes distributor closing stock from distributor bills and bill returns", () => {
    const bills = [
      { id: "b1", distributor_id: "d1", items: [{ category: "Goli Fizz", crates: 2, loose: 0 }], returned_crates: 1, damaged_bottles: 2 },
      { id: "b2", customer_id: "c1", items: [{ category: "Goli Fizz", crates: 5, loose: 0 }] },
    ];
    expect(distributorClosingStock({ ...distributor, closing_stock_crates: 1, closing_stock_loose: 0 }, bills)).toEqual({ crates: 1, loose: 22 });
  });

  it("recognises a distributor hotel and uses the hotel as the bill-to party", () => {
    expect(isDistributorHotel(hotel)).toBe(true);
    expect(isDistributorParty(hotel)).toBe(true);
    expect(partyName(hotel)).toBe("Hotel Alpha");
    expect(
      resolveParty(
        { distributor_id: "d1", distributor_hotel_id: "h1" },
        { c1: customer },
        { d1: distributor },
        { h1: hotel }
      )
    ).toBe(hotel);
    expect(resolveParty({ distributor_id: "d1", distributor_hotel_id: "h1" }, {}, { d1: distributor })).toBe(distributor);
  });

  it("counts only that hotel's bills in its closing stock", () => {
    const bills = [
      { id: "b1", distributor_id: "d1", distributor_hotel_id: "h1", items: [{ category: "Goli Fizz", crates: 2, loose: 0 }], returned_crates: 1, damaged_bottles: 2 },
      { id: "b2", distributor_id: "d1", distributor_hotel_id: "h2", items: [{ category: "Goli Fizz", crates: 9, loose: 0 }] },
    ];
    expect(distributorClosingStock(hotel, bills)).toEqual({ crates: 0, loose: 22 });
  });
});
