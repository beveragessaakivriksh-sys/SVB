import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Bluetooth, Usb, Copy, Printer, WifiOff, AlertTriangle } from "lucide-react";
import { thermalContent, THERMAL_LIABILITY } from "@/lib/billUtils";
import { SUPPLIER } from "@/lib/constants";
import {
  printThermal, connectBlePrinter, connectUSBPrinter, disconnectBle, disconnectUSB,
  getConnection, onPrinterState, isBleSupported, isUsbSupported,
} from "@/lib/bluetoothPrinter";

export default function ThermalPreview({ bill, customer, onPrintError, stockContext }) {
  const ctx = { bills: stockContext?.bills, crateEntries: stockContext?.crateEntries };
  const c = thermalContent(bill, customer, ctx);
  const [conn, setConn] = useState("ble");
  const [state, setState] = useState(getConnection());
  const [connecting, setConnecting] = useState(false);

  useEffect(() => onPrinterState(setState), []);

  const connect = async (type) => {
    setConnecting(true);
    try { if (type === "usb") await connectUSBPrinter(); else await connectBlePrinter(); }
    catch (e) { onPrintError?.(e); }
    finally { setConnecting(false); }
  };
  const disconnect = (type) => (type === "usb" ? disconnectUSB() : disconnectBle());
  const print = (dup) => printThermal(bill, customer, { duplicate: dup, connectionType: conn }, ctx).catch(onPrintError);

  const usbSupported = isUsbSupported();
  const bleSupported = isBleSupported();

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-primary/20 p-3">
        <div className="mb-2 text-xs font-semibold text-muted-foreground">Printer Connection</div>
        <div className="mb-2 flex gap-2">
          <button onClick={() => setConn("ble")} className={`flex-1 rounded-md border px-3 py-2 text-xs font-medium ${conn === "ble" ? "border-primary bg-primary/10 text-primary" : "border-input"}`}>Bluetooth (BLE)</button>
          <button onClick={() => setConn("usb")} className={`flex-1 rounded-md border px-3 py-2 text-xs font-medium ${conn === "usb" ? "border-primary bg-primary/10 text-primary" : "border-input"}`}>USB (Mini-USB)</button>
        </div>
        {conn === "usb" && !usbSupported && (
          <div className="mb-2 flex items-center gap-2 rounded-md bg-amber-50 p-2 text-[11px] text-amber-700"><AlertTriangle className="h-4 w-4 shrink-0" /> WebUSB is not supported on this browser. Use a Chromium-based browser on desktop/Android.</div>
        )}
        {conn === "ble" && !bleSupported && (
          <div className="mb-2 flex items-center gap-2 rounded-md bg-amber-50 p-2 text-[11px] text-amber-700"><AlertTriangle className="h-4 w-4 shrink-0" /> Bluetooth printing is not supported on this browser.</div>
        )}
        <div className="flex items-center gap-2">
          {conn === "usb" ? (
            state.usb ? (
              <Button variant="outline" size="sm" onClick={() => disconnect("usb")}><WifiOff className="h-4 w-4 mr-2" /> Disconnect USB</Button>
            ) : (
              <Button variant="outline" size="sm" disabled={connecting || !usbSupported} onClick={() => connect("usb")}><Usb className="h-4 w-4 mr-2" /> {connecting ? "Connecting…" : "Connect via USB"}</Button>
            )
          ) : state.ble ? (
            <Button variant="outline" size="sm" onClick={() => disconnect("ble")}><WifiOff className="h-4 w-4 mr-2" /> Disconnect BT</Button>
          ) : (
            <Button variant="outline" size="sm" disabled={connecting || !bleSupported} onClick={() => connect("ble")}><Bluetooth className="h-4 w-4 mr-2" /> {connecting ? "Connecting…" : "Connect Bluetooth"}</Button>
          )}
          <span className="text-[11px] text-muted-foreground">{conn === "usb" ? (state.usb ? "USB connected" : "USB not connected") : (state.ble ? "Bluetooth connected" : "Bluetooth not connected")}</span>
        </div>
      </div>

      <div className="mx-auto w-[288px] rounded-lg border border-primary/30 bg-white p-4 font-mono text-[11px] leading-relaxed text-neutral-800 shadow-sm">
        {bill.has_gst && (
          <>
            <div className="text-center text-[12px] font-bold">SAAKI VRIKSH FOODS AND BEVERAGES</div>
            <div className="text-center text-[10px]">{SUPPLIER.street_address}</div>
            <div className="text-center text-[10px]">{SUPPLIER.city}, {SUPPLIER.state} - {SUPPLIER.zip}</div>
            <div className="text-center text-[10px]">Ph: {SUPPLIER.phone} | GSTIN: {SUPPLIER.gstin}</div>
          </>
        )}
        <div className="my-1 border-t border-dashed border-primary/30" />
        <div className="text-center text-[11px] font-bold">{bill.has_gst ? "TAX INVOICE" : "INVOICE"}</div>
        <div>Hotel: {c.hotel}</div>
        <div>Invoice #: {c.invoiceNumber}</div>
        <div>Date: {c.date}</div>
        <div>Payment: <span className="capitalize">{c.paymentStatus}</span>{bill.payment_mode ? " / " + bill.payment_mode : ""}</div>
        {bill.has_gst && (bill.gstin || customer?.gstin) && <div>GSTIN: {bill.gstin || customer.gstin}</div>}
        <div className="my-1 border-t border-dashed border-primary/30" />
        <table className="w-full text-[10px]">
          <thead><tr><th className="text-left">Item</th><th className="text-right">Cr</th><th className="text-right">Lo</th><th className="text-right">Rate</th><th className="text-right">Amt</th></tr></thead>
          <tbody>
            {c.items.map((it, i) => (
              <tr key={i}><td>{it.name}</td><td className="text-right">{it.crates}</td><td className="text-right">{it.loose}</td><td className="text-right">{it.rate}</td><td className="text-right">{it.amount.toFixed(0)}</td></tr>
            ))}
          </tbody>
        </table>
        <div className="my-1 border-t border-dashed border-primary/30" />
        <div className="flex justify-between"><span>Subtotal</span><span>Rs. {c.subtotal.toFixed(2)}</span></div>
        {c.tax > 0 && <div className="flex justify-between"><span>CGST (20%)</span><span>Rs. {(c.tax / 2).toFixed(2)}</span></div>}
        {c.tax > 0 && <div className="flex justify-between"><span>SGST (20%)</span><span>Rs. {(c.tax / 2).toFixed(2)}</span></div>}
        <div className="flex justify-between font-bold"><span>TOTAL</span><span>Rs. {c.total.toFixed(2)}</span></div>
        {c.paid > 0 && c.paymentStatus === "pending" && (
          <>
            <div className="flex justify-between"><span>Partial Paid</span><span>Rs. {c.paid.toFixed(2)}</span></div>
            <div className="flex justify-between"><span>Balance Due</span><span>Rs. {c.balance.toFixed(2)}</span></div>
          </>
        )}
        <div className="my-1 border-t border-dashed border-primary/30" />
        <div className="flex justify-between"><span>Empty Crates Collected</span><span>{c.emptyCrates}</span></div>
        <div className="flex justify-between"><span>Damaged Bottles</span><span>{Number(bill.damaged_bottles) || 0}</span></div>
        <div className="flex justify-between"><span>Previous Closing Stock</span><span>{c.previousStock.crates} cr + {c.previousStock.loose} lo</span></div>
        <div className="flex justify-between"><span>Closing Stock (Hotel)</span><span>{c.closingStock.crates} cr + {c.closingStock.loose} lo</span></div>
        <div className="my-1 border-t border-dashed border-primary/30" />
        <div className="text-[10px] leading-snug">{THERMAL_LIABILITY}</div>
        <div className="mt-2 text-center font-bold text-primary">Thank you!.</div>
        <div className="mt-12 border-t border-dashed border-primary/30 pt-1 text-center text-[10px] text-muted-foreground">Seal &amp; Signature</div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" onClick={() => print(false)}><Printer className="h-4 w-4 mr-2" /> Original · {conn === "usb" ? "USB" : "BT"}</Button>
        <Button variant="outline" onClick={() => print(true)}><Copy className="h-4 w-4 mr-2" /> Duplicate · {conn === "usb" ? "USB" : "BT"}</Button>
      </div>
      <p className="text-[10px] text-center text-muted-foreground">3-inch thermal. Select a connection, connect the printer, then print original/duplicate.</p>
    </div>
  );
}