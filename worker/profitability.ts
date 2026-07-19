export const VAT_RATE = 0.12;
export const DATA_SYNC_SETTINGS = Object.freeze({ codFeePercent: 1, shippingFee: 41 });

export type DailyRow = {
  date: string;
  pageName: string;
  itemName: string;
  itemKey: string;
  adAccount: string;
  cpp: number | null;
  cpm: string;
  cod: number;
  adSpend: number;
  orderQty: number;
  budget: number | null;
  spentPercent: number | null;
};

export type ProductRecord = {
  itemName: string;
  itemKey: string;
  effectiveDate: string;
  rtsRate: number;
  cog: number;
};

export function normaliseItemName(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function parseCsvRows(csv: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index];
    if (quoted) {
      if (character === '"' && csv[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        value += character;
      }
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === ",") {
      row.push(value);
      value = "";
    } else if (character === "\n") {
      row.push(value.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      value = "";
    } else value += character;
  }
  if (value || row.length) {
    row.push(value.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows;
}

function productNumber(value: unknown) {
  const parsed = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : NaN;
}

export function parseProductMasterCsv(csv: string): ProductRecord[] {
  const rows = parseCsvRows(csv);
  const headers = (rows.shift() ?? []).map((header) => header.toLowerCase().replace(/[^a-z0-9]/g, ""));
  const column = (aliases: string[]) => headers.findIndex((header) => aliases.includes(header));
  const effectiveDateColumn = column(["effectivedate", "date", "asofdate"]);
  const itemNameColumn = column(["itemname", "item", "productname"]);
  const rtsRateColumn = column(["rtsrate", "rtspercent", "rtspercentage", "rts"]);
  const cogColumn = column(["cog", "cogs", "costofgoods", "productcost", "unitcost"]);
  if (itemNameColumn < 0 || rtsRateColumn < 0 || cogColumn < 0) {
    throw new Error("Product_Master must include Item Name, RTS Rate, and COG columns.");
  }

  const latest = new Map<string, { record: ProductRecord; rank: number }>();
  rows.forEach((values, sequence) => {
    const itemName = String(values[itemNameColumn] ?? "").trim();
    const itemKey = normaliseItemName(itemName);
    const rtsText = String(values[rtsRateColumn] ?? "").trim();
    let rtsRate = productNumber(rtsText);
    if (!rtsText.includes("%") && Math.abs(rtsRate) <= 1) rtsRate *= 100;
    const cog = productNumber(values[cogColumn]);
    const effectiveDate = effectiveDateColumn >= 0 ? String(values[effectiveDateColumn] ?? "").trim() : "";
    if (!itemKey || !Number.isFinite(rtsRate) || rtsRate < 0 || rtsRate > 100 || !Number.isFinite(cog) || cog < 0) return;
    const timestamp = Date.parse(effectiveDate);
    const rank = Number.isFinite(timestamp) ? timestamp : sequence;
    const current = latest.get(itemKey);
    const record = { itemName, itemKey, effectiveDate, rtsRate, cog };
    if (!current || rank >= current.rank) latest.set(itemKey, { record, rank });
  });
  return Array.from(latest.values(), (entry) => entry.record);
}

function finiteNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function optionalNumber(value: unknown) {
  if (value === null || value === "" || typeof value === "undefined") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function computeNetIncome(rawInputs: {
  cod: unknown;
  codFeePercent: unknown;
  rtsPercent: unknown;
  cog: unknown;
  adSpend: unknown;
  orderQty: unknown;
  shippingFee: unknown;
}) {
  const cod = Math.max(0, finiteNumber(rawInputs.cod));
  const codFeePercent = Math.min(100, Math.max(0, finiteNumber(rawInputs.codFeePercent)));
  const rtsPercent = Math.min(100, Math.max(0, finiteNumber(rawInputs.rtsPercent)));
  const cog = Math.max(0, finiteNumber(rawInputs.cog));
  const adSpend = Math.max(0, finiteNumber(rawInputs.adSpend));
  const orderQty = Math.max(0, Math.floor(finiteNumber(rawInputs.orderQty)));
  const shippingFee = Math.max(0, finiteNumber(rawInputs.shippingFee));
  const deliveredOrders = Math.floor(((100 - rtsPercent) / 100) * orderQty);
  const rtsOrders = Math.ceil((rtsPercent / 100) * orderQty);
  const grossReceivable = deliveredOrders * cod;
  const vat = adSpend * VAT_RATE;
  const totalCog = cog * orderQty;
  const baseShippingFees = shippingFee * orderQty;
  const codFee = deliveredOrders * ((codFeePercent / 100) * cod) * (1 + VAT_RATE);
  const netBeforeRts = grossReceivable - totalCog - vat - baseShippingFees - codFee - adSpend;
  const rtsInventoryAddBack = rtsOrders * cog;
  const netIncome = netBeforeRts + rtsInventoryAddBack;
  const roas = adSpend > 0 ? (cod * orderQty) / adSpend : null;
  return {
    cod,
    codFeePercent,
    rtsPercent,
    cog,
    orderQty,
    adSpend,
    deliveredOrders,
    rtsOrders,
    roas,
    grossReceivable,
    vat,
    totalCog,
    baseShippingFees,
    codFee,
    netBeforeRts,
    rtsInventoryAddBack,
    netIncome,
  };
}

export function validateDailyRows(value: unknown): DailyRow[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 5000).map((raw) => {
    const row = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const itemName = String(row.itemName ?? "").trim();
    const pageName = String(row.pageName ?? "").trim();
    const cod = Number(row.cod);
    const adSpend = Number(row.adSpend);
    const orderQty = Math.floor(Number(row.orderQty));
    return {
      date: String(row.date ?? "").trim(),
      pageName,
      itemName,
      itemKey: normaliseItemName(itemName),
      adAccount: String(row.adAccount ?? "").trim(),
      cpp: optionalNumber(row.cpp),
      cpm: String(row.cpm ?? "").trim(),
      cod,
      adSpend,
      orderQty,
      budget: optionalNumber(row.budget),
      spentPercent: optionalNumber(row.spentPercent),
    };
  }).filter((row) => row.pageName && row.itemKey && Number.isFinite(row.cod) && row.cod >= 0 && Number.isFinite(row.adSpend) && row.adSpend >= 0 && Number.isFinite(row.orderQty) && row.orderQty > 0);
}

export function calculateDataSync(dailyRows: DailyRow[], productRecords: ProductRecord[]) {
  const products = new Map(productRecords.map((product) => [product.itemKey, product]));
  const pages = new Map<string, {
    pageName: string;
    itemName: string;
    cod: number | null;
    codFeePercent: number;
    rtsRate: number | null;
    cog: number | null;
    orders: number;
    adSpend: number;
    potentialRevenue: number;
    grossReceivable: number;
    vat: number;
    totalCog: number;
    baseShippingFees: number;
    codFee: number;
    rtsInventoryCog: number;
    netWithoutRts: number;
    netWithRts: number;
  }>();
  const unmatched = new Map<string, string>();
  const matchedItemKeys = new Set<string>();
  const rowResults: Array<{ row: DailyRow; product: ProductRecord | null; netWithoutRts: number | null; netWithRts: number | null }> = [];
  let matchedRows = 0;

  for (const row of dailyRows) {
    const product = products.get(row.itemKey) ?? null;
    if (!product) {
      unmatched.set(row.itemKey, row.itemName);
      rowResults.push({ row, product: null, netWithoutRts: null, netWithRts: null });
      continue;
    }
    const result = computeNetIncome({ cod: row.cod, codFeePercent: DATA_SYNC_SETTINGS.codFeePercent, rtsPercent: product.rtsRate, cog: product.cog, adSpend: row.adSpend, orderQty: row.orderQty, shippingFee: DATA_SYNC_SETTINGS.shippingFee });
    const page = pages.get(row.pageName) ?? {
      pageName: row.pageName,
      itemName: product.itemName,
      cod: row.cod,
      codFeePercent: DATA_SYNC_SETTINGS.codFeePercent,
      rtsRate: product.rtsRate,
      cog: product.cog,
      orders: 0,
      adSpend: 0,
      potentialRevenue: 0,
      grossReceivable: 0,
      vat: 0,
      totalCog: 0,
      baseShippingFees: 0,
      codFee: 0,
      rtsInventoryCog: 0,
      netWithoutRts: 0,
      netWithRts: 0,
    };
    if (page.itemName !== product.itemName) page.itemName = "Multiple items";
    if (page.cod !== row.cod) page.cod = null;
    if (page.rtsRate !== product.rtsRate) page.rtsRate = null;
    if (page.cog !== product.cog) page.cog = null;
    page.orders += result.orderQty;
    page.adSpend += result.adSpend;
    page.potentialRevenue += result.cod * result.orderQty;
    page.grossReceivable += result.grossReceivable;
    page.vat += result.vat;
    page.totalCog += result.totalCog;
    page.baseShippingFees += result.baseShippingFees;
    page.codFee += result.codFee;
    page.rtsInventoryCog += result.rtsInventoryAddBack;
    page.netWithoutRts += result.netBeforeRts;
    page.netWithRts += result.netIncome;
    pages.set(row.pageName, page);
    matchedRows += 1;
    matchedItemKeys.add(row.itemKey);
    rowResults.push({ row, product, netWithoutRts: result.netBeforeRts, netWithRts: result.netIncome });
  }

  // Map keeps the first-seen insertion order, so the breakdown mirrors the upload.
  const pageResults = Array.from(pages.values()).map((page) => ({
    ...page,
    roas: page.adSpend > 0 ? page.potentialRevenue / page.adSpend : null,
    netRatio: page.adSpend > 0 ? page.netWithoutRts / page.adSpend : null,
  }));
  // Headline results are deliberately the sum of the visible per-page breakdown.
  const totals = pageResults.reduce(
    (sum, page) => ({
      adSpend: sum.adSpend + page.adSpend,
      orders: sum.orders + page.orders,
      netWithoutRts: sum.netWithoutRts + page.netWithoutRts,
      netWithRts: sum.netWithRts + page.netWithRts,
    }),
    { adSpend: 0, orders: 0, netWithoutRts: 0, netWithRts: 0 },
  );
  return {
    ...totals,
    matchedRows,
    matchedItems: matchedItemKeys.size,
    unmatchedItems: Array.from(unmatched.values()).sort((a, b) => a.localeCompare(b)),
    netRatio: totals.adSpend > 0 ? totals.netWithoutRts / totals.adSpend : null,
    pages: pageResults,
    rowResults,
  };
}
