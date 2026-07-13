"use client";

import { ChangeEvent, DragEvent, useMemo, useRef, useState } from "react";

type OrderRow = {
  status: string;
  sender: string;
  item: string;
};

type ProductMetric = {
  id: string;
  sender: string;
  product: string;
  delivered: number;
  rts: number;
  inTransit: number;
  deliveredRate: number;
  rtsRate: number;
  deliveryForecast: number;
  rtsForecast: number;
};

type ParsedFile = {
  name: string;
  rows: OrderRow[];
  sourceRows: number;
  sheetName: string;
};

const EXCEL_EXTENSIONS = [".xlsx", ".xls"];

function normaliseHeader(value: unknown) {
  return String(value ?? "")
    .replace(/^\uFEFF/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function normaliseKey(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function normaliseProductName(value: string) {
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
    .replace(
      /^\s*\d+\s*(?:pcs?|pieces?|packs?|sets?|bottles?|units?)\s+(?:of\s+)?/i,
      "",
    )
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

function classifyStatus(value: string): "delivered" | "rts" | "inTransit" | null {
  const status = value.toLocaleLowerCase().replace(/[_–—-]+/g, " ").replace(/\s+/g, " ").trim();

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

function computeMetrics(rows: OrderRow[]) {
  const groups = new Map<
    string,
    {
      sender: string;
      product: string;
      delivered: number;
      rts: number;
      inTransit: number;
    }
  >();

  for (const row of rows) {
    const bucket = classifyStatus(row.status);
    if (!bucket) continue;

    const sender = row.sender.trim();
    const product = normaliseProductName(row.item);
    if (!sender || !product) continue;

    const id = `${normaliseKey(sender)}::${normaliseKey(product)}`;
    const current = groups.get(id) ?? {
      sender,
      product,
      delivered: 0,
      rts: 0,
      inTransit: 0,
    };
    current[bucket] += 1;
    groups.set(id, current);
  }

  return Array.from(groups.entries())
    .map(([id, group]): ProductMetric => {
      const completed = group.delivered + group.rts;
      const deliveredRate = completed ? group.delivered / completed : 0;
      const rtsRate = completed ? group.rts / completed : 0;

      return {
        id,
        ...group,
        deliveredRate,
        rtsRate,
        deliveryForecast: deliveredRate * group.inTransit,
        rtsForecast: rtsRate * group.inTransit,
      };
    })
    .sort((a, b) => {
      const volumeA = a.delivered + a.rts + a.inTransit;
      const volumeB = b.delivered + b.rts + b.inTransit;
      return volumeB - volumeA || a.product.localeCompare(b.product);
    });
}

function formatPercent(value: number) {
  return new Intl.NumberFormat("en", {
    style: "percent",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value);
}

function formatForecast(value: number) {
  return new Intl.NumberFormat("en", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value);
}

export default function Home() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [parsedFile, setParsedFile] = useState<ParsedFile | null>(null);
  const [generated, setGenerated] = useState(false);
  const [selectedSender, setSelectedSender] = useState("all");
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [isReading, setIsReading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const metrics = useMemo(
    () => (parsedFile ? computeMetrics(parsedFile.rows) : []),
    [parsedFile],
  );

  const senders = useMemo(
    () =>
      Array.from(new Set(metrics.map((metric) => metric.sender))).sort((a, b) =>
        a.localeCompare(b),
      ),
    [metrics],
  );

  const filteredMetrics = useMemo(() => {
    const search = normaliseKey(query);
    return metrics.filter((metric) => {
      const matchesSender = selectedSender === "all" || metric.sender === selectedSender;
      const matchesSearch =
        !search ||
        normaliseKey(metric.product).includes(search) ||
        normaliseKey(metric.sender).includes(search);
      return matchesSender && matchesSearch;
    });
  }, [metrics, query, selectedSender]);

  const totals = useMemo(
    () =>
      metrics.reduce(
        (sum, item) => ({
          delivered: sum.delivered + item.delivered,
          rts: sum.rts + item.rts,
          inTransit: sum.inTransit + item.inTransit,
        }),
        { delivered: 0, rts: 0, inTransit: 0 },
      ),
    [metrics],
  );

  async function readExcelFile(file?: File) {
    if (!file) return;

    const extension = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
    if (!EXCEL_EXTENSIONS.includes(extension)) {
      setParsedFile(null);
      setGenerated(false);
      setError("Please upload an Excel file in .xlsx or .xls format.");
      if (inputRef.current) inputRef.current.value = "";
      return;
    }

    setIsReading(true);
    setError("");
    setGenerated(false);
    setSelectedSender("all");
    setQuery("");

    try {
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
      let matched:
        | {
            rows: OrderRow[];
            sourceRows: number;
            sheetName: string;
          }
        | undefined;

      for (const sheetName of workbook.SheetNames) {
        const worksheet = workbook.Sheets[sheetName];
        const rawRows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
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
        const dataRows = rawRows.slice(headerRowIndex + 1);
        const rows = dataRows
          .map((row) => ({
            status: String(row[statusIndex] ?? "").trim(),
            sender: String(row[senderIndex] ?? "").trim(),
            item: String(row[itemIndex] ?? "").trim(),
          }))
          .filter((row) => row.status || row.sender || row.item);

        matched = {
          rows,
          sourceRows: rows.length,
          sheetName,
        };
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

      setParsedFile({ name: file.name, ...matched });
    } catch (caught) {
      setParsedFile(null);
      setError(caught instanceof Error ? caught.message : "The Excel file could not be read.");
      if (inputRef.current) inputRef.current.value = "";
    } finally {
      setIsReading(false);
    }
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    void readExcelFile(event.target.files?.[0]);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    void readExcelFile(event.dataTransfer.files?.[0]);
  }

  function handleGenerate() {
    if (!parsedFile) return;
    if (!metrics.length) {
      setError(
        'No rows matched the statuses "Delivered", "RTS"/"Return to Sender", or "In Transit".',
      );
      return;
    }
    setError("");
    setGenerated(true);
    window.setTimeout(() => {
      document.getElementById("results")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  }

  return (
    <main>
      <header className="site-header">
        <a className="brand" href="#top" aria-label="FulfilRate home">
          <span className="brand-mark" aria-hidden="true">FR</span>
          <span>
            <strong>FulfilRate</strong>
            <small>Delivery intelligence</small>
          </span>
        </a>
        <span className="privacy-pill">
          <span className="privacy-dot" aria-hidden="true" />
          Your file stays on this device
        </span>
      </header>

      <section className="hero" id="top">
        <div className="eyebrow"><span /> E-commerce performance calculator</div>
        <h1>Know what will deliver.<br /><em>Before it does.</em></h1>
        <p className="hero-copy">
          Turn your order-status Excel export into sender-level product forecasts—clean,
          grouped, and ready for decisions.
        </p>

        <div
          className={`upload-card ${isDragging ? "is-dragging" : ""}`}
          onDragEnter={(event) => {
            event.preventDefault();
            setIsDragging(true);
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
        >
          <div className="upload-topline">
            <span className="step-number">01</span>
            <span>SELECT YOUR ORDER EXPORT</span>
          </div>

          <input
            ref={inputRef}
            id="excel-upload"
            type="file"
            accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
            onChange={handleFileChange}
            hidden
          />

          <div className="upload-action-row">
            <label className="upload-button" htmlFor="excel-upload">
              <span className="upload-arrow" aria-hidden="true">↑</span>
              UPLOAD FILE
            </label>
            <div className="file-copy" aria-live="polite">
              {isReading ? (
                <>
                  <strong>Reading workbook…</strong>
                  <span>Checking columns and order rows</span>
                </>
              ) : parsedFile ? (
                <>
                  <strong className="file-name">{parsedFile.name}</strong>
                  <span>
                    {parsedFile.sourceRows.toLocaleString()} rows · {parsedFile.sheetName} sheet
                  </span>
                </>
              ) : (
                <>
                  <strong>Choose a file or drop it here</strong>
                  <span>.XLSX or .XLS only · Required columns listed below</span>
                </>
              )}
            </div>
            {parsedFile && !isReading ? <span className="ready-badge">READY</span> : null}
          </div>

          <div className="required-columns">
            <span>REQUIRED COLUMNS</span>
            <ul>
              <li>Order Status</li>
              <li>Sender Name</li>
              <li>Item Name</li>
            </ul>
          </div>

          {error ? <p className="error-message" role="alert">{error}</p> : null}

          <button
            className="generate-button"
            type="button"
            disabled={!parsedFile || isReading}
            onClick={handleGenerate}
          >
            GENERATE
            <span aria-hidden="true">→</span>
          </button>
        </div>

        <div className="formula-strip" aria-label="Forecast formulas">
          <div>
            <span className="formula-icon delivery-icon" aria-hidden="true">D</span>
            <p><strong>DELIVERY FORECAST</strong><span>Delivered rate × In Transit</span></p>
          </div>
          <div>
            <span className="formula-icon rts-icon" aria-hidden="true">R</span>
            <p><strong>RTS FORECAST</strong><span>RTS rate × In Transit</span></p>
          </div>
          <p className="grouping-note">
            <strong>SMART PRODUCT GROUPING</strong>
            <span>“1x”, “2x”, and “Buy 1 Take 1” offers roll up to the same item.</span>
          </p>
        </div>
      </section>

      {generated ? (
        <section className="results-section" id="results">
          <div className="results-heading">
            <div>
              <span className="section-kicker">FORECAST REPORT</span>
              <h2>Product performance</h2>
              <p>
                Rates are based on completed orders: Delivered ÷ (Delivered + RTS).
              </p>
            </div>
            <div className="summary-cards" aria-label="Report summary">
              <div><span>SENDERS</span><strong>{senders.length}</strong></div>
              <div><span>PRODUCTS</span><strong>{new Set(metrics.map((item) => normaliseKey(item.product))).size}</strong></div>
              <div><span>IN TRANSIT</span><strong>{totals.inTransit.toLocaleString()}</strong></div>
            </div>
          </div>

          <div className="table-toolbar">
            <label>
              <span>Sender</span>
              <select value={selectedSender} onChange={(event) => setSelectedSender(event.target.value)}>
                <option value="all">All sender names</option>
                {senders.map((sender) => <option key={sender} value={sender}>{sender}</option>)}
              </select>
            </label>
            <label className="search-field">
              <span>Find product</span>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search product name"
              />
            </label>
            <p className="row-count">{filteredMetrics.length.toLocaleString()} product rows</p>
          </div>

          <div className="table-shell">
            <table>
              <thead>
                <tr>
                  <th>PRODUCT NAME</th>
                  <th>DELIVERED RATE</th>
                  <th className="rts-column">RTS RATE</th>
                  <th>DELIVERY FORECAST</th>
                  <th className="rts-column">RTS FORECAST</th>
                </tr>
              </thead>
              <tbody>
                {filteredMetrics.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <strong>{item.product}</strong>
                      <span className="sender-label">{item.sender}</span>
                    </td>
                    <td>
                      <strong>{formatPercent(item.deliveredRate)}</strong>
                      <span>{item.delivered.toLocaleString()} delivered</span>
                    </td>
                    <td className="rts-column">
                      <strong>{formatPercent(item.rtsRate)}</strong>
                      <span>{item.rts.toLocaleString()} RTS</span>
                    </td>
                    <td>
                      <strong>{formatForecast(item.deliveryForecast)}</strong>
                      <span>of {item.inTransit.toLocaleString()} in transit</span>
                    </td>
                    <td className="rts-column">
                      <strong>{formatForecast(item.rtsForecast)}</strong>
                      <span>of {item.inTransit.toLocaleString()} in transit</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!filteredMetrics.length ? (
              <div className="no-results">No products match the current filters.</div>
            ) : null}
          </div>
        </section>
      ) : null}

      <footer>
        <strong>FulfilRate</strong>
        <span>Private, browser-based order forecasting.</span>
      </footer>
    </main>
  );
}
