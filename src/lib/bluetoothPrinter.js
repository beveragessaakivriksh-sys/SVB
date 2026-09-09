import { thermalContent, THERMAL_LIABILITY, THERMAL_WIDTH } from "./billUtils";
import { SUPPLIER } from "./constants";

const SERVICE_UUID = "000018f0-0000-1000-8000-00805f9b34fb";
const CHAR_UUID = "00002af1-0000-1000-8000-00805f9b34fb";

let bleChar = null;
let usbDevice = null;
let usbEndpointNumber = null;
const listeners = new Set();

export function onPrinterState(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function notify() { listeners.forEach((fn) => fn(getConnection())); }
export function getConnection() { return { ble: !!bleChar, usb: !!usbDevice }; }
export const isBleSupported = () => typeof navigator !== "undefined" && "bluetooth" in navigator;
export const isUsbSupported = () => typeof navigator !== "undefined" && "usb" in navigator;

function escPos(str) { return new TextEncoder().encode(str); }
function center(s, w) { s = String(s); if (s.length >= w) return s.slice(0, w); const pad = Math.floor((w - s.length) / 2); return " ".repeat(pad) + s + " ".repeat(Math.max(0, w - s.length - pad)); }
function padL(s, n) { return String(s).slice(0, n).padEnd(n); }
function padR(s, n) { return String(s).slice(0, n).padStart(n); }
function money(n) { return "Rs." + (Number(n) || 0).toFixed(2); }
function wrap(text, w) {
  const words = String(text).split(" ");
  const lines = []; let line = "";
  words.forEach((wd) => { if ((line + " " + wd).trim().length > w) { lines.push(line); line = wd; } else { line = (line + " " + wd).trim(); } });
  if (line) lines.push(line);
  return lines.join("\n");
}

function buildReceipt(bill, customer, { duplicate = false } = {}, ctx = {}) {
  const c = thermalContent(bill, customer, ctx);
  const W = THERMAL_WIDTH;
  const L = "-".repeat(W) + "\n";
  let s = "";
  s += "\x1B\x40";
  if (bill.has_gst) {
    s += "\x1B\x21\x30" + center(SUPPLIER.org_name, W) + "\n" + "\x1B\x21\x00";
    s += center(SUPPLIER.street_address, W) + "\n";
    s += center(`${SUPPLIER.city}, ${SUPPLIER.state} - ${SUPPLIER.zip}`, W) + "\n";
    s += center(`Ph: ${SUPPLIER.phone} | GSTIN: ${SUPPLIER.gstin}`, W) + "\n";
    s += L;
  }
  s += center(bill.has_gst ? "TAX INVOICE" : "INVOICE", W) + "\n";
  if (duplicate) s += center("** DUPLICATE COPY **", W) + "\n";
  s += L;
  s += padL("Hotel:", 7) + c.hotel.slice(0, W - 7) + "\n";
  s += padL("Invoice #:", 11) + c.invoiceNumber + "\n";
  s += padL("Date:", 7) + c.date + "\n";
  s += padL("Payment:", 9) + c.paymentStatus + (bill.payment_mode ? " / " + bill.payment_mode : "") + "\n";
  if (bill.has_gst && (bill.gstin || customer?.gstin)) s += padL("GSTIN:", 7) + (bill.gstin || customer.gstin) + "\n";
  s += L;
  s += padL("Item", 20) + padR("Cr", 4) + padR("Lo", 4) + padR("Rate", 8) + padR("Amount", 12) + "\n";
  s += L;
  c.items.forEach((it) => {
    s += padL(it.name, 20) + padR(String(it.crates), 4) + padR(String(it.loose), 4) + padR(it.rate.toFixed(0), 8) + padR(it.amount.toFixed(0), 12) + "\n";
  });
  s += L;
  s += padL("Subtotal", 36) + padR(money(c.subtotal), 12) + "\n";
  if (c.tax > 0) {
    s += padL("  CGST (20%)", 36) + padR(money(c.tax / 2), 12) + "\n";
    s += padL("  SGST (20%)", 36) + padR(money(c.tax / 2), 12) + "\n";
  }
  s += "\x1B\x21\x30" + padL("TOTAL", 36) + padR(money(c.total), 12) + "\n" + "\x1B\x21\x00";
  if (c.paid > 0 && c.paymentStatus === "pending") {
    s += padL("Partial Paid", 36) + padR(money(c.paid), 12) + "\n";
    s += padL("Balance Due", 36) + padR(money(c.balance), 12) + "\n";
  }
  s += L;
  s += padL("Empty Crates Collected", 30) + padR(String(c.emptyCrates), 18) + "\n";
  s += padL("Damaged Bottles", 30) + padR(String(Number(bill.damaged_bottles) || 0), 18) + "\n";
  s += padL("Previous Closing Stock", 30) + padR(`${c.previousStock.crates} cr + ${c.previousStock.loose} lo`, 18) + "\n";
  s += padL("Closing Stock (Hotel)", 30) + padR(`${c.closingStock.crates} cr + ${c.closingStock.loose} lo`, 18) + "\n";
  s += L;
  s += wrap(THERMAL_LIABILITY, W) + "\n";
  s += L;
  s += center("Thank you! Visit again.", W) + "\n";
  if (duplicate) { s += "\n\n\n\n" + center("Seal & Signature", W) + "\n\n"; }
  s += "\n\n";
  s += "\x1Dh\x50";
  return s;
}

export async function connectBlePrinter() {
  if (!isBleSupported()) throw new Error("Bluetooth printing is not supported on this browser/device.");
  if (bleChar) return bleChar;
  const device = await navigator.bluetooth.requestDevice({ filters: [{ services: [SERVICE_UUID] }], optionalServices: [SERVICE_UUID] });
  const server = await device.gatt.connect();
  const service = await server.getPrimaryService(SERVICE_UUID);
  const char = await service.getCharacteristic(CHAR_UUID);
  bleChar = char;
  notify();
  return char;
}
export const connectThermalPrinter = connectBlePrinter;

export function disconnectBle() {
  if (bleChar) { try { bleChar.service?.device?.gatt?.disconnect(); } catch {} bleChar = null; notify(); }
}

export async function connectUSBPrinter() {
  if (!isUsbSupported()) throw new Error("WebUSB is not supported on this browser. Use a Chromium-based browser on desktop/Android.");
  const device = await navigator.usb.requestDevice({ filters: [] });
  await device.open();
  const conf = device.configuration || device.configurations[0];
  const iface = conf.interfaces[0];
  await device.claimInterface(iface.interfaceNumber);
  const ep = iface.alternates[0].endpoints.find((e) => e.direction === "out");
  usbDevice = device;
  usbEndpointNumber = ep ? ep.endpointNumber : 1;
  navigator.usb.addEventListener("disconnect", onUsbDisconnect);
  notify();
  return device;
}

function onUsbDisconnect(e) { if (usbDevice === e.device) { usbDevice = null; usbEndpointNumber = null; notify(); } }
export function disconnectUSB() { if (usbDevice) { try { usbDevice.close(); } catch {} usbDevice = null; usbEndpointNumber = null; notify(); } }

export async function sendRawDataToPrinter(data, connectionType) {
  if (connectionType === "usb") {
    if (!usbDevice) throw new Error("USB printer not connected");
    const chunk = 512;
    for (let i = 0; i < data.length; i += chunk) {
      await usbDevice.transferOut(usbEndpointNumber, data.slice(i, i + chunk));
    }
  } else {
    if (!bleChar) throw new Error("Bluetooth printer not connected");
    // Small, universally-safe chunk size + a short pause between writes.
    // Some Android BLE stacks (older Android versions, certain OEM skins
    // like Funtouch OS) don't reliably negotiate a larger ATT MTU from a
    // web page, and/or drop bytes when writes arrive faster than the
    // printer's receive buffer drains — both show up as garbled or
    // incomplete thermal prints, even though the exact same data prints
    // fine on another phone/desktop with a more forgiving BLE stack.
    const chunk = 20;
    const canWriteWithoutResponse =
      typeof bleChar.writeValueWithoutResponse === "function" && bleChar.properties?.writeWithoutResponse;
    for (let i = 0; i < data.length; i += chunk) {
      const part = data.slice(i, i + chunk);
      if (canWriteWithoutResponse) {
        await bleChar.writeValueWithoutResponse(part);
      } else {
        await bleChar.writeValue(part);
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
}

export async function printThermal(bill, customer, opts = {}, ctx = {}) {
  const conn = opts.connectionType || (usbDevice ? "usb" : "ble");
  if (conn === "usb" && !usbDevice) await connectUSBPrinter();
  if (conn === "ble" && !bleChar) await connectBlePrinter();
  const data = escPos(buildReceipt(bill, customer, opts, ctx));
  await sendRawDataToPrinter(data, conn);
}

export { THERMAL_LIABILITY };