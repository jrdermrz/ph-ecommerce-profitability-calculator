(() => {
  "use strict";

  const excelExtensions = [".xlsx", ".xls"];
  const fileInput = document.getElementById("excel-upload");
  const uploadCard = document.getElementById("upload-card");
  const fileCopy = document.getElementById("file-copy");
  const readyBadge = document.getElementById("ready-badge");
  const errorMessage = document.getElementById("error-message");
  const generateButton = document.getElementById("generate-button");
  const resultsSection = document.getElementById("results");
  const senderFilter = document.getElementById("sender-filter");
  const productSearch = document.getElementById("product-search");
  const resultsBody = document.getElementById("results-body");
  const noResults = document.getElementById("no-results");
  const rowCount = document.getElementById("row-count");

  let parsedFile = null;
  let metrics = [];

  function normaliseHeader(value) {
    return String(value ?? "")
      .replace(/^\uFEFF/, "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
  }

  function normaliseKey(value) {
    return value
      .normalize("NFKC")
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
  }

  function normaliseProductName(value) {
    const original = value.normalize("NFKC").replace(/\s+/g, " ").trim();
    let cleaned = original
      .replace(
        /\([^)]*(?:buy\s*\d+|take\s*\d+|get\s*\d+|free|qty|quantity|pack\s+of\s+\d+|\d+\s*[x×])[^)]*\)/gi,
        " ",
      )
      .replace(/\bbuy\s*\d+\s*(?:take|get)\s*\d+(?:\s*free)?\b/gi, " ")
      .replace(/\bb\s*\d+\s*t\s*\d+\b/gi, " ")
      .replace(/^\s*(?:qty|quantity)\s*[:\-]?\s*\d+\s*(?:[x×]\s*)?/i, "")
      .replace(/^\s*\d+\s*[x×]\s*/i, "")
      .replace(/^\s*[x×]\s*\d+\s*/i, "")
      .replace(/^\s*\d+\s*(?:pcs?|pieces?|packs?|sets?|bottles?|units?)\s+(?:of\s+)?/i, "")
      .replace(
        /\s*[-–—|:/]?\s*(?:\d+\s*[x×]|[x×]\s*\d+|\d+\s*(?:pcs?|pieces?|packs?|sets?|bottles?|units?))\s*$/i,
        "",
      )
      .replace(/^\s*(?:free|promo|offer)\s*[-–—|:/]?\s*/i, "")
      .replace(/\s*[-–—|:/]\s*(?:free|promo|offer)\s*$/i, "")
      .replace(/^[\s\-–—|:/]+|[\s\-–—|:/]+$/g, "")
      .replace(/\s+/g, " ")
      .trim();

    if (!cleaned) cleaned = original;
    return cleaned;
  }

  function classifyStatus(value) {
    const status = value
      .toLocaleLowerCase()
      .replace(/[_–—-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (/\bdelivered\b/.test(status)) return "delivered";
    if (
      /\brts\b/.test(status) ||
      /\brto\b/.test(status) ||
      /return(?:ed)?\s+to\s+sender/.test(status) ||
      /^return(?:ed)?$/.test(status)
    ) {
      return "rts";
    }
    if (/\bin\s+transit\b/.test(status) || status === "transit") return "inTransit";
    return null;
  }

  function computeMetrics(rows) {
    const groups = new Map();

    for (const row of rows) {
      const bucket = classifyStatus(row.status);
      if (!bucket) continue;
      const sender = row.sender.trim();
      const product = normaliseProductName(row.item);
      if (!sender || !product) continue;

      const id = `${normaliseKey(sender)}::${normaliseKey(product)}`;
      const current = groups.get(id) ?? {
        id,
        sender,
        product,
        delivered: 0,
        rts: 0,
        inTransit: 0,
      };
      current[bucket] += 1;
      groups.set(id, current);
    }

    return Array.from(groups.values())
      .map((group) => {
        const completed = group.delivered + group.rts;
        const deliveredRate = completed ? group.delivered / completed : 0;
        const rtsRate = completed ? group.rts / completed : 0;
        return {
          ...group,
          deliveredRate,
          rtsRate,
          deliveryForecast: deliveredRate * group.inTransit,
          rtsForecast: rtsRate * group.inTransit,
        };
      })
      .sort((a, b) => {
        const aVolume = a.delivered + a.rts + a.inTransit;
        const bVolume = b.delivered + b.rts + b.inTransit;
        return bVolume - aVolume || a.product.localeCompare(b.product);
      });
  }

  function formatPercent(value) {
    return new Intl.NumberFormat("en", {
      style: "percent",
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }).format(value);
  }

  function formatForecast(value) {
    return new Intl.NumberFormat("en", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }).format(value);
  }

  function setError(message = "") {
    errorMessage.textContent = message;
    errorMessage.hidden = !message;
  }

  function setFileCopy(title, detail) {
    fileCopy.replaceChildren();
    const strong = document.createElement("strong");
    const span = document.createElement("span");
    strong.className = "file-name";
    strong.textContent = title;
    span.textContent = detail;
    fileCopy.append(strong, span);
  }

  async function readExcelFile(file) {
    if (!file) return;
    const extension = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
    if (!excelExtensions.includes(extension)) {
      parsedFile = null;
      metrics = [];
      generateButton.disabled = true;
      readyBadge.hidden = true;
      fileInput.value = "";
      setError("Please upload an Excel file in .xlsx or .xls format.");
      return;
    }

    setError();
    setFileCopy("Reading workbook…", "Checking columns and order rows");
    generateButton.disabled = true;
    readyBadge.hidden = true;
    resultsSection.hidden = true;

    try {
      if (!window.XLSX) throw new Error("The Excel reader is still loading. Please try again.");
      const workbook = window.XLSX.read(await file.arrayBuffer(), { type: "array" });
      let matched;

      for (const sheetName of workbook.SheetNames) {
        const worksheet = workbook.Sheets[sheetName];
        const rawRows = window.XLSX.utils.sheet_to_json(worksheet, {
          header: 1,
          defval: "",
          raw: false,
        });
        const headerRowIndex = rawRows.slice(0, 25).findIndex((row) => {
          const headers = row.map(normaliseHeader);
          return (
            headers.includes("orderstatus") &&
            headers.includes("sendername") &&
            headers.includes("itemname")
          );
        });
        if (headerRowIndex === -1) continue;

        const headers = rawRows[headerRowIndex].map(normaliseHeader);
        const statusIndex = headers.indexOf("orderstatus");
        const senderIndex = headers.indexOf("sendername");
        const itemIndex = headers.indexOf("itemname");
        const rows = rawRows
          .slice(headerRowIndex + 1)
          .map((row) => ({
            status: String(row[statusIndex] ?? "").trim(),
            sender: String(row[senderIndex] ?? "").trim(),
            item: String(row[itemIndex] ?? "").trim(),
          }))
          .filter((row) => row.status || row.sender || row.item);
        matched = { rows, sourceRows: rows.length, sheetName };
        break;
      }

      if (!matched) {
        throw new Error(
          'No sheet contains all three required columns: "Order Status", "Sender Name", and "Item Name".',
        );
      }
      if (!matched.rows.length) {
        throw new Error("The required columns were found, but there are no order rows to process.");
      }

      parsedFile = { name: file.name, ...matched };
      metrics = computeMetrics(parsedFile.rows);
      setFileCopy(
        parsedFile.name,
        `${parsedFile.sourceRows.toLocaleString()} rows · ${parsedFile.sheetName} sheet`,
      );
      readyBadge.hidden = false;
      generateButton.disabled = false;
    } catch (error) {
      parsedFile = null;
      metrics = [];
      fileInput.value = "";
      setFileCopy("Choose a file or drop it here", ".XLSX or .XLS only · Required columns listed below");
      setError(error instanceof Error ? error.message : "The Excel file could not be read.");
    }
  }

  function appendCell(row, primary, secondary, className = "") {
    const cell = document.createElement("td");
    if (className) cell.className = className;
    const strong = document.createElement("strong");
    const span = document.createElement("span");
    strong.textContent = primary;
    span.textContent = secondary;
    cell.append(strong, span);
    row.appendChild(cell);
  }

  function renderRows() {
    const selectedSender = senderFilter.value;
    const query = normaliseKey(productSearch.value);
    const filtered = metrics.filter((item) => {
      const senderMatches = selectedSender === "all" || item.sender === selectedSender;
      const queryMatches =
        !query ||
        normaliseKey(item.product).includes(query) ||
        normaliseKey(item.sender).includes(query);
      return senderMatches && queryMatches;
    });

    resultsBody.replaceChildren();
    for (const item of filtered) {
      const row = document.createElement("tr");
      const productCell = document.createElement("td");
      const product = document.createElement("strong");
      const sender = document.createElement("span");
      product.textContent = item.product;
      sender.className = "sender-label";
      sender.textContent = item.sender;
      productCell.append(product, sender);
      row.appendChild(productCell);
      appendCell(row, formatPercent(item.deliveredRate), `${item.delivered.toLocaleString()} delivered`);
      appendCell(row, formatPercent(item.rtsRate), `${item.rts.toLocaleString()} RTS`, "rts-column");
      appendCell(
        row,
        formatForecast(item.deliveryForecast),
        `of ${item.inTransit.toLocaleString()} in transit`,
      );
      appendCell(
        row,
        formatForecast(item.rtsForecast),
        `of ${item.inTransit.toLocaleString()} in transit`,
        "rts-column",
      );
      resultsBody.appendChild(row);
    }

    rowCount.textContent = `${filtered.length.toLocaleString()} product rows`;
    noResults.hidden = filtered.length > 0;
  }

  function renderReport() {
    if (!metrics.length) {
      setError('No rows matched the statuses "Delivered", "RTS"/"Return to Sender", or "In Transit".');
      return;
    }

    const senders = Array.from(new Set(metrics.map((item) => item.sender))).sort((a, b) =>
      a.localeCompare(b),
    );
    const products = new Set(metrics.map((item) => normaliseKey(item.product)));
    const transit = metrics.reduce((sum, item) => sum + item.inTransit, 0);

    senderFilter.replaceChildren();
    const allOption = document.createElement("option");
    allOption.value = "all";
    allOption.textContent = "All sender names";
    senderFilter.appendChild(allOption);
    for (const sender of senders) {
      const option = document.createElement("option");
      option.value = sender;
      option.textContent = sender;
      senderFilter.appendChild(option);
    }

    document.getElementById("sender-total").textContent = senders.length.toLocaleString();
    document.getElementById("product-total").textContent = products.size.toLocaleString();
    document.getElementById("transit-total").textContent = transit.toLocaleString();
    productSearch.value = "";
    resultsSection.hidden = false;
    setError();
    renderRows();
    window.setTimeout(() => resultsSection.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }

  fileInput.addEventListener("change", () => readExcelFile(fileInput.files?.[0]));
  generateButton.addEventListener("click", renderReport);
  senderFilter.addEventListener("change", renderRows);
  productSearch.addEventListener("input", renderRows);

  uploadCard.addEventListener("dragenter", (event) => {
    event.preventDefault();
    uploadCard.classList.add("is-dragging");
  });
  uploadCard.addEventListener("dragover", (event) => event.preventDefault());
  uploadCard.addEventListener("dragleave", () => uploadCard.classList.remove("is-dragging"));
  uploadCard.addEventListener("drop", (event) => {
    event.preventDefault();
    uploadCard.classList.remove("is-dragging");
    readExcelFile(event.dataTransfer?.files?.[0]);
  });
})();
