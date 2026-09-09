// PrinterService.ts — cross-platform thermal printer service.
// Auto-detects environment: Capacitor (native Android/iOS), Web Bluetooth,
// Web Serial, or falls back to the system print dialog.
import { thermalContent, THERMAL_LIABILITY, THERMAL_WIDTH } from "./billUtils";

const SERVICE_UUID = "000018f0-0000-1000-8000-00805f9b34fb";
const CHAR_UUID = "00002af1-0000-1000-8000-00805f9b34fb";

export type PrinterType = "web_bluetooth" | "web_serial" | "capacitor" | "system";

export interface PrinterServiceOptions {
  type?: PrinterType;
  duplicate?: boolean;
  chunkSize?: number;
}

export function detectEnvironment(): PrinterType {
  const cap = (window as any)?.Capacitor;
  if (cap?.isNative || cap?.Platforms?.android || cap?.Platforms?.ios) return "capacitor";
  if (typeof navigator !== "undefined" && (navigator as any).bluetooth) return "web_bluetooth";
  if (typeof navigator !== "undefined" && (navigator as any).serial) return "web_serial";
  return "system";
}

function escPos(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

export function buildEscPosReceipt(bill: any, customer: any, { duplicate = false } = {}): Uint8Array {
  const c = thermalContent(bill, customer);
  const L = "-".repeat(THERMAL_WIDTH) + "\n";
  let s = "";
  s += "\x1B\x21\x30";
  s += `${c.hotel.slice(0, THERMAL_WIDTH)}\n`;
  s += "\x1B\x21\x00";
  s += `Invoice: ${c.invoiceNumber}\n`;
  s += `Date: ${c.date}\n`;
  s += `Payment: ${c.paymentStatus}\n`;
  s += L;
  s += L;
  c.items.forEach((it: any) => {
    s += `${(it.name || "").slice(0, THERMAL_WIDTH)}\n`;
    s += `  Cr:${it.crates} Lo:${it.loose} Rate:${it.rate} Amt:${it.amount.toFixed(2)}\n`;
  });
  s += L;
  s += `Subtotal: Rs. ${c.subtotal.toFixed(2)}\n`;
  if (c.tax) s += `Tax: Rs. ${c.tax.toFixed(2)}\n`;
  s += `Total Amount: Rs. ${c.total.toFixed(2)}\n`;
  if (c.paid > 0 && c.paymentStatus === "pending") {
    s += `Partial Paid: Rs. ${c.paid.toFixed(2)}\n`;
    s += `Balance Due: Rs. ${c.balance.toFixed(2)}\n`;
  }
  s += `Empty Crates Collected: ${c.emptyCrates}\n`;
  s += `Closing Stock: ${c.closingStock.crates} cr + ${c.closingStock.loose} loose\n`;
  s += L;
  s += `${THERMAL_LIABILITY}\n`;
  s += L;
  s += "Thankyou!\n";
  if (duplicate) {
    s += "\n\n\nSeal & Signature\n\n";
  }
  s += "\n\n";
  s += "\x1Dh\x50";
  return escPos(s);
}

let cachedBluetoothChar: any = null;
let cachedSerial: any = null;

async function connectWebBluetooth(): Promise<any> {
  if (cachedBluetoothChar) return cachedBluetoothChar;
  const device = await (navigator as any).bluetooth.requestDevice({
    filters: [{ services: [SERVICE_UUID] }],
    optionalServices: [SERVICE_UUID],
  });
  const server = await device.gatt.connect();
  const service = await server.getPrimaryService(SERVICE_UUID);
  const char = await service.getCharacteristic(CHAR_UUID);
  cachedBluetoothChar = char;
  return char;
}

async function connectWebSerial(): Promise<any> {
  if (cachedSerial) return cachedSerial;
  const port = await (navigator as any).serial.requestPort();
  await port.open({ baudRate: 9600 });
  const writer = port.writable.getWriter();
  cachedSerial = { writer, port };
  return cachedSerial;
}

async function connectCapacitor(): Promise<any> {
  const cap = (window as any)?.Capacitor;
  const ble = cap?.Plugins?.BluetoothLE;
  if (!ble) throw new Error("Capacitor Bluetooth LE plugin not available");
  await ble.initialize();
  const device = await ble.requestDevice({ services: [SERVICE_UUID] });
  await ble.connect({ deviceId: device.deviceId });
  return { ble, deviceId: device.deviceId };
}

async function sendBytes(bytes: Uint8Array, type: PrinterType, chunkSize = 180) {
  if (type === "web_bluetooth") {
    const char = await connectWebBluetooth();
    for (let i = 0; i < bytes.length; i += chunkSize) {
      await char.writeValue(bytes.slice(i, i + chunkSize));
    }
  } else if (type === "web_serial") {
    const { writer } = await connectWebSerial();
    for (let i = 0; i < bytes.length; i += chunkSize) {
      await writer.write(bytes.slice(i, i + chunkSize));
    }
  } else if (type === "capacitor") {
    const conn = await connectCapacitor();
    for (let i = 0; i < bytes.length; i += chunkSize) {
      await conn.ble.write({ deviceId: conn.deviceId, value: Array.from(bytes.slice(i, i + chunkSize)) });
    }
  } else {
    throw new Error("System printer does not support raw ESC/POS; use printViaSystemDialog");
  }
}

export const PrinterService = {
  detectEnvironment,

  async print(bill: any, customer: any, opts: PrinterServiceOptions = {}) {
    const type = opts.type || detectEnvironment();
    if (type === "system") {
      this.printViaSystemDialog(bill, customer);
      return;
    }
    const bytes = buildEscPosReceipt(bill, customer, { duplicate: !!opts.duplicate });
    await sendBytes(bytes, type, opts.chunkSize);
  },

  printViaSystemDialog(bill: any, customer: any) {
    const c = thermalContent(bill, customer);
    const w = window.open("", "_blank", "width=380,height=720");
    if (!w) {
      alert("Please allow pop-ups to print.");
      return;
    }
    const rows = c.items
      .map((it: any) => `<tr><td>${it.name}</td><td style="text-align:center">${it.crates}</td><td style="text-align:center">${it.loose}</td><td style="text-align:right">${it.rate}</td><td style="text-align:right">${it.amount.toFixed(2)}</td></tr>`)
      .join("");
    const partial = c.paid > 0 && c.paymentStatus === "pending"
      ? `<div>Partial Paid: Rs. ${c.paid.toFixed(2)}</div><div><b>Balance Due: Rs. ${c.balance.toFixed(2)}</b></div>`
      : "";
    w.document.write(
      `<html><head><title>${c.invoiceNumber}</title><style>body{font-family:monospace;padding:10px;font-size:12px;width:3in}h3{text-align:center;margin:4px 0}table{width:100%}th{font-size:10px}hr{border:none;border-top:1px dashed #000}</style></head><body>` +
        `<h3>${c.hotel}</h3>Invoice: ${c.invoiceNumber}<br/>Date: ${c.date}<br/>Payment: ${c.paymentStatus}<hr/>` +
        `<table><thead><tr><th style="text-align:left">Product</th><th>Cr</th><th>Lo</th><th>Rate</th><th>Amt</th></tr></thead><tbody>${rows}</tbody></table><hr/>` +
        `<div>Subtotal: Rs. ${c.subtotal.toFixed(2)}</div>` +
        (c.tax ? `<div>Tax: Rs. ${c.tax.toFixed(2)}</div>` : "") +
        `<b>Total: Rs. ${c.total.toFixed(2)}</b><br/>` +
        partial +
        `<div>Empty Crates: ${c.emptyCrates}</div>` +
        `<div>Closing Stock: ${c.closingStock.crates} cr + ${c.closingStock.loose} loose</div>` +
        `<small>${THERMAL_LIABILITY}</small></body></html>`
    );
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 400);
  },

  async disconnect() {
    try {
      cachedBluetoothChar = null;
      if (cachedSerial) {
        await cachedSerial.writer.close();
        await cachedSerial.port.close();
        cachedSerial = null;
      }
    } catch {
      /* ignore */
    }
  },
};

export default PrinterService;