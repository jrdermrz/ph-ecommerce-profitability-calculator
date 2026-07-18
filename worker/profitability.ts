export const VAT_RATE = 0.12;
export const DATA_SYNC_SETTINGS = Object.freeze({ codFeePercent: 1, shippingFee: 37.5 });

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
  const netIncome = netBeforeRts + rtsOrders * cog;
  return { orderQty, adSpend, netBeforeRts, netIncome };
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
  const pages = new Map<string, { pageName: string; orders: number; adSpend: number; netWithoutRts: number; netWithRts: number }>();
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
    const page = pages.get(row.pageName) ?? { pageName: row.pageName, orders: 0, adSpend: 0, netWithoutRts: 0, netWithRts: 0 };
    page.orders += result.orderQty;
    page.adSpend += result.adSpend;
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
