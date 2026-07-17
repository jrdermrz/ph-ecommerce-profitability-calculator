(() => {
  "use strict";

  const BASE_SHIPPING_FEE = 40;
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

    const deliveredOrders = Math.floor(((100 - rtsPercent) / 100) * orderQty);
    const rtsOrders = Math.ceil((rtsPercent / 100) * orderQty);
    const roas = adSpend > 0 ? (cod * orderQty) / adSpend : null;
    const cpp = orderQty > 0 ? adSpend / orderQty : null;
    const grossReceivable = deliveredOrders * cod;
    const vat = adSpend * VAT_RATE;
    const totalCog = cog * orderQty;
    const baseShippingFees = BASE_SHIPPING_FEE * orderQty;
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

  window.NetIncomeCalculator = {
    BASE_SHIPPING_FEE,
    VAT_RATE,
    computeNetIncome,
  };

  if (typeof document === "undefined") return;

  const form = document.getElementById("calculator-form");
  const inputs = {
    item: document.getElementById("item"),
    cod: document.getElementById("cod"),
    orderQty: document.getElementById("order-qty"),
    cog: document.getElementById("cog"),
    adSpend: document.getElementById("ad-spend"),
    codFeePercent: document.getElementById("cod-fee"),
    rtsPercent: document.getElementById("rts"),
  };

  const outputs = {
    resultCard: document.getElementById("result-card"),
    statusChip: document.getElementById("status-chip"),
    productName: document.getElementById("product-name"),
    netIncome: document.getElementById("net-income"),
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

  function hasCompleteInputs() {
    return [
      inputs.cod,
      inputs.orderQty,
      inputs.cog,
      inputs.adSpend,
      inputs.codFeePercent,
      inputs.rtsPercent,
    ].every((input) => input.value !== "") && finiteNumber(inputs.orderQty.value) > 0;
  }

  function readInputs() {
    return {
      cod: inputs.cod.value,
      orderQty: inputs.orderQty.value,
      cog: inputs.cog.value,
      adSpend: inputs.adSpend.value,
      codFeePercent: inputs.codFeePercent.value,
      rtsPercent: inputs.rtsPercent.value,
    };
  }

  function renderEmpty() {
    outputs.resultCard.classList.remove("is-positive", "is-negative");
    outputs.resultCard.classList.add("is-empty");
    outputs.statusChip.textContent = "Kumpletuhin ang inputs";
    outputs.productName.textContent = inputs.item.value.trim() || "Your product";
    outputs.netIncome.textContent = "₱—";
    outputs.netCaption.textContent = "Ilagay ang anim na numbers para makita ang estimate.";
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

  function render() {
    outputs.productName.textContent = inputs.item.value.trim() || "Your product";
    if (!hasCompleteInputs()) {
      renderEmpty();
      return;
    }

    const result = computeNetIncome(readInputs());
    const isPositive = result.netIncome >= 0;
    outputs.resultCard.classList.remove("is-empty", "is-positive", "is-negative");
    outputs.resultCard.classList.add(isPositive ? "is-positive" : "is-negative");
    outputs.statusChip.textContent = isPositive ? "Positive estimate" : "Possible loss";
    outputs.netIncome.textContent = money(result.netIncome);
    outputs.netCaption.textContent = isPositive
      ? "Estimated na matitira matapos ang listed costs at RTS inventory recovery."
      : "Mas mataas ang estimated costs kaysa sa receivable para sa inputs na ito.";
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

  function showView(view) {
    for (const panel of document.querySelectorAll("[data-panel]")) {
      panel.hidden = panel.dataset.panel !== view;
    }
    for (const button of document.querySelectorAll(".switch-option")) {
      const active = button.dataset.view === view;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    }
    if (view === "quick") render();
  }

  for (const input of Object.values(inputs)) input.addEventListener("input", render);

  for (const button of document.querySelectorAll("[data-view]")) {
    button.addEventListener("click", () => showView(button.dataset.view));
  }

  document.getElementById("sample-button").addEventListener("click", () => {
    inputs.item.value = "Best-selling organizer";
    inputs.cod.value = "899";
    inputs.orderQty.value = "100";
    inputs.cog.value = "210";
    inputs.adSpend.value = "12500";
    inputs.codFeePercent.value = "2.5";
    inputs.rtsPercent.value = "18";
    render();
  });

  form.addEventListener("reset", () => window.setTimeout(render, 0));
  render();
})();
