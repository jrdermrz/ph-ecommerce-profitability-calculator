(() => {
  "use strict";

  const VAT_RATE = 0.12;

  function finiteNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function computeNetIncome(rawInputs) {
    const cod = Math.max(0, finiteNumber(rawInputs.cod));
    const codFeePercent = Math.min(100, Math.max(0, finiteNumber(rawInputs.codFeePercent)));
    const rtsPercent = Math.min(100, Math.max(0, finiteNumber(rawInputs.rtsPercent)));
    const cog = Math.max(0, finiteNumber(rawInputs.cog));
    const adSpend = Math.max(0, finiteNumber(rawInputs.adSpend));
    const orderQty = Math.max(0, Math.floor(finiteNumber(rawInputs.orderQty)));
    const shippingFee = Math.max(0, finiteNumber(rawInputs.shippingFee));

    const deliveredOrders = Math.floor(((100 - rtsPercent) / 100) * orderQty);
    const rtsOrders = Math.ceil((rtsPercent / 100) * orderQty);
    const roas = adSpend > 0 ? (cod * orderQty) / adSpend : null;
    const cpp = orderQty > 0 ? adSpend / orderQty : null;
    const grossReceivable = deliveredOrders * cod;
    const vat = adSpend * VAT_RATE;
    const totalCog = cog * orderQty;
    const baseShippingFees = shippingFee * orderQty;
    const codFee = deliveredOrders * ((codFeePercent / 100) * cod) * (1 + VAT_RATE);
    const netBeforeRts =
      grossReceivable - totalCog - vat - baseShippingFees - codFee - adSpend;
    const rtsInventoryAddBack = rtsOrders * cog;
    const netIncome = netBeforeRts + rtsInventoryAddBack;

    return {
      cod,
      codFeePercent,
      rtsPercent,
      cog,
      adSpend,
      orderQty,
      shippingFee,
      deliveredOrders,
      rtsOrders,
      roas,
      cpp,
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

  function normaliseHeader(value) {
    return String(value ?? "")
      .replace(/^\uFEFF/, "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
  }

  function normaliseItemName(value) {
    return String(value ?? "")
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
  }

  function rowValue(row, aliases) {
    for (const [key, value] of Object.entries(row ?? {})) {
      if (aliases.includes(normaliseHeader(key))) return value;
    }
    return "";
  }

  function parseAmount(value) {
    if (typeof value === "number") return Number.isFinite(value) ? value : NaN;
    const text = String(value ?? "").trim();
    if (!text) return NaN;
    const negative = /^\(.*\)$/.test(text);
    const parsed = Number(text.replace(/[^0-9.-]/g, ""));
    if (!Number.isFinite(parsed)) return NaN;
    return negative ? -Math.abs(parsed) : parsed;
  }

  function parsePercent(value) {
    const text = String(value ?? "").trim();
    const parsed = parseAmount(value);
    if (!Number.isFinite(parsed)) return NaN;
    if (!text.includes("%") && Math.abs(parsed) <= 1) return parsed * 100;
    return parsed;
  }

  function dateRank(value, sequence) {
    const timestamp = Date.parse(String(value ?? "").trim());
    return Number.isFinite(timestamp) ? timestamp : sequence;
  }

  function parseProductRows(rows) {
    return rows
      .map((row, sequence) => {
        const itemName = String(rowValue(row, ["itemname", "item", "productname"])).trim();
        const effectiveDate = String(
          rowValue(row, ["effectivedate", "updatedat", "date", "asofdate"]),
        ).trim();
        const rtsRate = parsePercent(
          rowValue(row, ["rtsrate", "rtspercent", "rtspercentage", "rts"]),
        );
        const cog = parseAmount(
          rowValue(row, ["cog", "cogs", "costofgoods", "productcost", "unitcost"]),
        );
        return {
          itemName,
          itemKey: normaliseItemName(itemName),
          effectiveDate,
          rtsRate,
          cog,
          sequence,
        };
      })
      .filter(
        (row) =>
          row.itemKey &&
          Number.isFinite(row.rtsRate) &&
          row.rtsRate >= 0 &&
          row.rtsRate <= 100 &&
          Number.isFinite(row.cog) &&
          row.cog >= 0,
      );
  }

  function parseDailyRows(rows) {
    return rows
      .map((row) => {
        const pageName = String(rowValue(row, ["pagename", "page"])).trim();
        const itemName = String(rowValue(row, ["itemname", "item", "productname"])).trim();
        return {
          date: String(rowValue(row, ["date"])).trim(),
          pageName,
          itemName,
          itemKey: normaliseItemName(itemName),
          cod: parseAmount(rowValue(row, ["cod", "codprice", "sellingprice"])),
          adSpend: parseAmount(rowValue(row, ["adspent", "adspend", "amountspent"])),
          orderQty: Math.floor(parseAmount(rowValue(row, ["orders", "orderquantity", "orderqty"]))),
        };
      })
      .filter(
        (row) =>
          row.pageName &&
          row.itemKey &&
          Number.isFinite(row.cod) &&
          row.cod >= 0 &&
          Number.isFinite(row.adSpend) &&
          row.adSpend >= 0 &&
          Number.isFinite(row.orderQty) &&
          row.orderQty > 0,
      );
  }

  function latestProductMap(records) {
    const latest = new Map();
    records.forEach((record, index) => {
      const candidate = { ...record, rank: dateRank(record.effectiveDate, index) };
      const current = latest.get(record.itemKey);
      if (!current || candidate.rank >= current.rank) latest.set(record.itemKey, candidate);
    });
    return latest;
  }

  function calculateDataSync(dailyRows, productRecords, settings) {
    const products = latestProductMap(productRecords);
    const pages = new Map();
    const unmatched = new Map();
    const matchedItemKeys = new Set();
    const totals = {
      adSpend: 0,
      orders: 0,
      netWithoutRts: 0,
      netWithRts: 0,
      matchedRows: 0,
    };

    for (const row of dailyRows) {
      const product = products.get(row.itemKey);
      if (!product) {
        unmatched.set(row.itemKey, row.itemName);
        continue;
      }

      const result = computeNetIncome({
        cod: row.cod,
        codFeePercent: settings.codFeePercent,
        rtsPercent: product.rtsRate,
        cog: product.cog,
        adSpend: row.adSpend,
        orderQty: row.orderQty,
        shippingFee: settings.shippingFee,
      });
      const page = pages.get(row.pageName) ?? {
        pageName: row.pageName,
        orders: 0,
        adSpend: 0,
        netWithoutRts: 0,
        netWithRts: 0,
      };

      page.orders += result.orderQty;
      page.adSpend += result.adSpend;
      page.netWithoutRts += result.netBeforeRts;
      page.netWithRts += result.netIncome;
      pages.set(row.pageName, page);

      totals.orders += result.orderQty;
      totals.adSpend += result.adSpend;
      totals.netWithoutRts += result.netBeforeRts;
      totals.netWithRts += result.netIncome;
      totals.matchedRows += 1;
      matchedItemKeys.add(row.itemKey);
    }

    const pageResults = Array.from(pages.values())
      .map((page) => ({
        ...page,
        netRatio: page.adSpend > 0 ? page.netWithoutRts / page.adSpend : null,
      }))
      .sort((a, b) => b.netWithoutRts - a.netWithoutRts || a.pageName.localeCompare(b.pageName));

    return {
      ...totals,
      matchedItems: matchedItemKeys.size,
      unmatchedItems: Array.from(unmatched.values()).sort((a, b) => a.localeCompare(b)),
      netRatio: totals.adSpend > 0 ? totals.netWithoutRts / totals.adSpend : null,
      pages: pageResults,
    };
  }

  window.NetIncomeCalculator = { VAT_RATE, computeNetIncome };
  window.DataSyncCalculator = {
    normaliseItemName,
    parseProductRows,
    parseDailyRows,
    latestProductMap,
    calculateDataSync,
  };

  if (typeof document === "undefined") return;

  const currency = new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const integer = new Intl.NumberFormat("en-PH", { maximumFractionDigits: 0 });
  const ratio = new Intl.NumberFormat("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  function money(value) {
    return currency.format(value).replace("PHP", "₱").replace(/\s+/g, "");
  }

  function signedMoney(value, sign) {
    return `${sign} ${money(Math.abs(value))}`;
  }

  function ratioText(value) {
    return value === null || !Number.isFinite(value) ? "1:—" : `1:${ratio.format(value)}`;
  }

  const form = document.getElementById("calculator-form");
  const inputs = {
    cod: document.getElementById("cod"),
    codFeePercent: document.getElementById("cod-fee"),
    rtsPercent: document.getElementById("rts"),
    cog: document.getElementById("cog"),
    adSpend: document.getElementById("ad-spend"),
    orderQty: document.getElementById("order-qty"),
    shippingFee: document.getElementById("shipping-fee"),
  };
  const outputs = {
    resultCard: document.getElementById("result-card"),
    statusChip: document.getElementById("status-chip"),
    netIncome: document.getElementById("net-income"),
    netIncludingRts: document.getElementById("net-including-rts"),
    netCaption: document.getElementById("net-caption"),
    roas: document.getElementById("roas"),
    cpp: document.getElementById("cpp"),
    deliveredOrders: document.getElementById("delivered-orders"),
    rtsOrders: document.getElementById("rts-orders"),
    grossReceivable: document.getElementById("gross-receivable"),
    totalCog: document.getElementById("total-cog"),
    adSpend: document.getElementById("ad-spend-output"),
    vat: document.getElementById("vat"),
    baseShippingFees: document.getElementById("base-sf"),
    codFee: document.getElementById("cod-fee-output"),
    netBeforeRts: document.getElementById("net-before-rts"),
    rtsInventoryAddBack: document.getElementById("rts-addback"),
  };

  function hasCompleteInputs() {
    return Object.values(inputs).every((input) => input.value !== "") &&
      finiteNumber(inputs.orderQty.value) > 0;
  }

  function readInputs() {
    return Object.fromEntries(Object.entries(inputs).map(([key, input]) => [key, input.value]));
  }

  function renderEmpty() {
    outputs.resultCard.classList.remove("is-positive", "is-negative");
    outputs.resultCard.classList.add("is-empty");
    outputs.statusChip.textContent = "Complete all inputs";
    outputs.netIncome.textContent = "₱—";
    outputs.netIncludingRts.textContent = "₱—";
    outputs.netCaption.textContent = "Enter all seven numbers to see the estimate.";
    outputs.roas.textContent = "—";
    outputs.cpp.textContent = "₱—";
    outputs.deliveredOrders.textContent = "—";
    outputs.rtsOrders.textContent = "—";
    outputs.grossReceivable.textContent = "₱—";
    outputs.totalCog.textContent = "− ₱—";
    outputs.adSpend.textContent = "− ₱—";
    outputs.vat.textContent = "− ₱—";
    outputs.baseShippingFees.textContent = "− ₱—";
    outputs.codFee.textContent = "− ₱—";
    outputs.netBeforeRts.textContent = "₱—";
    outputs.rtsInventoryAddBack.textContent = "+ ₱—";
  }

  function renderQuickCalculator() {
    if (!hasCompleteInputs()) {
      renderEmpty();
      return;
    }
    const result = computeNetIncome(readInputs());
    const isPositive = result.netBeforeRts >= 0;
    outputs.resultCard.classList.remove("is-empty", "is-positive", "is-negative");
    outputs.resultCard.classList.add(isPositive ? "is-positive" : "is-negative");
    outputs.statusChip.textContent = isPositive ? "Positive estimate" : "Possible loss";
    outputs.netIncome.textContent = money(result.netBeforeRts);
    outputs.netIncludingRts.textContent = money(result.netIncome);
    outputs.netCaption.textContent = isPositive
      ? "Estimated remainder after the listed costs, before the RTS inventory COG add-back."
      : "Estimated costs are higher than receivables for these inputs.";
    outputs.roas.textContent = result.roas === null ? "—" : `${ratio.format(result.roas)}×`;
    outputs.cpp.textContent = result.cpp === null ? "₱—" : money(result.cpp);
    outputs.deliveredOrders.textContent = integer.format(result.deliveredOrders);
    outputs.rtsOrders.textContent = integer.format(result.rtsOrders);
    outputs.grossReceivable.textContent = money(result.grossReceivable);
    outputs.totalCog.textContent = signedMoney(result.totalCog, "−");
    outputs.adSpend.textContent = signedMoney(result.adSpend, "−");
    outputs.vat.textContent = signedMoney(result.vat, "−");
    outputs.baseShippingFees.textContent = signedMoney(result.baseShippingFees, "−");
    outputs.codFee.textContent = signedMoney(result.codFee, "−");
    outputs.netBeforeRts.textContent = money(result.netBeforeRts);
    outputs.rtsInventoryAddBack.textContent = signedMoney(result.rtsInventoryAddBack, "+");
  }

  const sync = {
    productFile: document.getElementById("product-db-file"),
    dailyFile: document.getElementById("daily-data-file"),
    productStatus: document.getElementById("product-db-status"),
    dailyStatus: document.getElementById("daily-data-status"),
    codFee: document.getElementById("sync-cod-fee"),
    shippingFee: document.getElementById("sync-shipping-fee"),
    summary: document.getElementById("sync-summary"),
    status: document.getElementById("sync-status"),
    netWithoutRts: document.getElementById("sync-net-without-rts"),
    netWithRts: document.getElementById("sync-net-with-rts"),
    netRatio: document.getElementById("sync-net-ratio"),
    caption: document.getElementById("sync-caption"),
    totalAdSpend: document.getElementById("sync-total-ad-spend"),
    totalOrders: document.getElementById("sync-total-orders"),
    matchedItems: document.getElementById("sync-matched-items"),
    unmatchedCard: document.getElementById("unmatched-card"),
    unmatchedList: document.getElementById("unmatched-list"),
    pageSection: document.getElementById("page-net-section"),
    pageBody: document.getElementById("page-net-body"),
    pageCount: document.getElementById("page-net-count"),
  };
  let sharedProductRecords = [];
  let uploadedProductRecords = [];
  let dailyRows = [];

  function setFileStatus(element, message, type = "") {
    element.textContent = message;
    element.classList.toggle("is-ready", type === "ready");
    element.classList.toggle("is-error", type === "error");
  }

  async function workbookRows(file) {
    if (!window.XLSX) throw new Error("The Excel reader did not load. Refresh and try again.");
    const workbook = window.XLSX.read(await file.arrayBuffer(), { type: "array" });
    const rows = [];
    for (const sheetName of workbook.SheetNames) {
      rows.push(
        ...window.XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
          defval: "",
          raw: false,
        }),
      );
    }
    return rows;
  }

  function renderSyncEmpty(status, caption) {
    sync.summary.classList.remove("is-positive", "is-negative");
    sync.summary.classList.add("is-empty");
    sync.status.textContent = status;
    sync.netWithoutRts.textContent = "₱—";
    sync.netWithRts.textContent = "₱—";
    sync.netRatio.textContent = "1:—";
    sync.caption.textContent = caption;
    sync.totalAdSpend.textContent = "₱—";
    sync.totalOrders.textContent = "—";
    sync.matchedItems.textContent = "—";
    sync.pageSection.hidden = true;
  }

  function renderUnmatched(items) {
    sync.unmatchedList.replaceChildren();
    for (const item of items) {
      const li = document.createElement("li");
      li.textContent = item;
      sync.unmatchedList.append(li);
    }
    sync.unmatchedCard.hidden = items.length === 0;
  }

  function renderPageResults(pages) {
    sync.pageBody.replaceChildren();
    for (const page of pages) {
      const row = document.createElement("tr");
      const values = [
        page.pageName,
        integer.format(page.orders),
        money(page.adSpend),
        money(page.netWithoutRts),
        money(page.netWithRts),
        ratioText(page.netRatio),
      ];
      for (const value of values) {
        const cell = document.createElement("td");
        cell.textContent = value;
        row.append(cell);
      }
      sync.pageBody.append(row);
    }
    sync.pageCount.textContent = `${pages.length} page${pages.length === 1 ? "" : "s"}`;
    sync.pageSection.hidden = pages.length === 0;
  }

  function renderDataSync() {
    const productRecords = [...sharedProductRecords, ...uploadedProductRecords];
    const settingsComplete = sync.codFee.value !== "" && sync.shippingFee.value !== "";
    renderUnmatched([]);

    if (!productRecords.length) {
      renderSyncEmpty("Product database needed", "Add shared product records or upload an RTS + COG master file.");
      return;
    }
    if (!dailyRows.length) {
      renderSyncEmpty("Daily data needed", "Upload the daily performance file shown in your workflow.");
      return;
    }
    if (!settingsComplete) {
      renderSyncEmpty("Complete the settings", "Enter the COD fee and shipping fee used for this run.");
      return;
    }

    const result = calculateDataSync(dailyRows, productRecords, {
      codFeePercent: sync.codFee.value,
      shippingFee: sync.shippingFee.value,
    });
    renderUnmatched(result.unmatchedItems);
    sync.matchedItems.textContent = integer.format(result.matchedItems);

    if (result.unmatchedItems.length) {
      renderSyncEmpty(
        `${result.unmatchedItems.length} unmatched item${result.unmatchedItems.length === 1 ? "" : "s"}`,
        "Results stay locked until every Item Name has a matching RTS rate and COG record.",
      );
      sync.matchedItems.textContent = integer.format(result.matchedItems);
      return;
    }

    const isPositive = result.netWithoutRts >= 0;
    sync.summary.classList.remove("is-empty", "is-positive", "is-negative");
    sync.summary.classList.add(isPositive ? "is-positive" : "is-negative");
    sync.status.textContent = isPositive ? "Positive projection" : "Projected loss";
    sync.netWithoutRts.textContent = money(result.netWithoutRts);
    sync.netWithRts.textContent = money(result.netWithRts);
    sync.netRatio.textContent = ratioText(result.netRatio);
    sync.caption.textContent = `${result.matchedRows} daily row${result.matchedRows === 1 ? "" : "s"} matched to the latest product records.`;
    sync.totalAdSpend.textContent = money(result.adSpend);
    sync.totalOrders.textContent = integer.format(result.orders);
    sync.matchedItems.textContent = integer.format(result.matchedItems);
    renderPageResults(result.pages);
  }

  async function loadSharedProducts() {
    try {
      let payload = window.__PRODUCT_MASTER__;
      if (!payload) {
        const response = await fetch("./data/product-master.json", { cache: "no-store" });
        if (!response.ok) throw new Error("Shared product database could not be loaded.");
        payload = await response.json();
      }
      sharedProductRecords = parseProductRows(Array.isArray(payload.records) ? payload.records : []);
      if (sharedProductRecords.length) {
        setFileStatus(
          sync.productStatus,
          `${sharedProductRecords.length} shared product record${sharedProductRecords.length === 1 ? "" : "s"} loaded.`,
          "ready",
        );
      } else {
        setFileStatus(sync.productStatus, "Shared database is ready but currently has no product records.");
      }
    } catch (error) {
      setFileStatus(sync.productStatus, error.message, "error");
    }
    renderDataSync();
  }

  sync.productFile.addEventListener("change", async () => {
    const file = sync.productFile.files?.[0];
    if (!file) return;
    setFileStatus(sync.productStatus, "Reading product master…");
    try {
      uploadedProductRecords = parseProductRows(await workbookRows(file));
      if (!uploadedProductRecords.length) {
        throw new Error("No valid Effective Date, Item Name, RTS Rate, and COG rows were found.");
      }
      const latestCount = latestProductMap(uploadedProductRecords).size;
      setFileStatus(
        sync.productStatus,
        `${file.name}: ${uploadedProductRecords.length} records, ${latestCount} latest items ready.`,
        "ready",
      );
    } catch (error) {
      uploadedProductRecords = [];
      setFileStatus(sync.productStatus, error.message, "error");
    }
    renderDataSync();
  });

  sync.dailyFile.addEventListener("change", async () => {
    const file = sync.dailyFile.files?.[0];
    if (!file) return;
    setFileStatus(sync.dailyStatus, "Reading daily data…");
    try {
      dailyRows = parseDailyRows(await workbookRows(file));
      if (!dailyRows.length) {
        throw new Error("No valid Page Name, Item Name, COD, Adspent, and Orders rows were found.");
      }
      setFileStatus(
        sync.dailyStatus,
        `${file.name}: ${dailyRows.length} daily row${dailyRows.length === 1 ? "" : "s"} ready.`,
        "ready",
      );
    } catch (error) {
      dailyRows = [];
      setFileStatus(sync.dailyStatus, error.message, "error");
    }
    renderDataSync();
  });

  sync.codFee.addEventListener("input", renderDataSync);
  sync.shippingFee.addEventListener("input", renderDataSync);

  function showView(view) {
    for (const panel of document.querySelectorAll("[data-panel]")) {
      panel.hidden = panel.dataset.panel !== view;
    }
    for (const button of document.querySelectorAll(".switch-option")) {
      const active = button.dataset.view === view;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    }
    if (view === "quick") renderQuickCalculator();
    if (view === "upload") renderDataSync();
  }

  for (const input of Object.values(inputs)) input.addEventListener("input", renderQuickCalculator);
  for (const button of document.querySelectorAll("[data-view]")) {
    button.addEventListener("click", () => showView(button.dataset.view));
  }

  document.getElementById("sample-button").addEventListener("click", () => {
    inputs.cod.value = "899";
    inputs.orderQty.value = "100";
    inputs.cog.value = "210";
    inputs.adSpend.value = "12500";
    inputs.codFeePercent.value = "2.5";
    inputs.rtsPercent.value = "18";
    inputs.shippingFee.value = "40";
    renderQuickCalculator();
  });

  form.addEventListener("reset", () => window.setTimeout(renderQuickCalculator, 0));
  renderQuickCalculator();
  void loadSharedProducts();
})();
