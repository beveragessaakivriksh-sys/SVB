import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";

// Searchable hotel dropdown: tap to open, type to narrow the list, pick one.
// `value` is a customer id, or "all" for no hotel filter.
export default function HotelCombobox({ customers = [], value, onChange, allLabel = "All hotels" }) {
  const [open, setOpen] = useState(false);
  const labelOf = (c) => c.display_name || c.customer_name;
  const selected = customers.find((c) => c.id === value);

  const pick = (id) => {
    onChange(id);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" role="combobox" aria-expanded={open} className="w-full justify-between font-normal">
          <span className="truncate">{selected ? labelOf(selected) : allLabel}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] min-w-[220px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Type hotel name…" />
          <CommandList>
            <CommandEmpty>No hotel found.</CommandEmpty>
            <CommandGroup>
              <CommandItem value="all hotels" onSelect={() => pick("all")}>
                <Check className={cn("mr-2 h-4 w-4", value === "all" ? "opacity-100" : "opacity-0")} />
                {allLabel}
              </CommandItem>
              {customers.map((c) => (
                <CommandItem key={c.id} value={`${labelOf(c)} ${c.customer_name}`} onSelect={() => pick(c.id)}>
                  <Check className={cn("mr-2 h-4 w-4", value === c.id ? "opacity-100" : "opacity-0")} />
                  {labelOf(c)}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
