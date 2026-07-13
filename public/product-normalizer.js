(() => {
  "use strict";

  const variantLabel =
    "colou?r|size|variant|variation|flavou?r|scent|shade|style|design|model|type|capacity|option";
  const variantValue =
    "black|white|blue|red|green|yellow|orange|purple|violet|pink|brown|gray|grey|beige|cream|gold|silver|clear|transparent|assorted|random|navy|teal|maroon|small|medium|large|extra\\s+small|extra\\s+large|xs|s|m|l|xl|xxl|xxxl|\\d+(?:\\.\\d+)?\\s*(?:ml|l|g|kg|oz|cm|mm|m|inches?|inch|pcs?|pieces?|packs?|sets?|bottles?|units?)";

  function normaliseKey(value) {
    return String(value ?? "")
      .normalize("NFKC")
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
  }

  function trimSeparators(value) {
    return value
      .replace(/^[\s\-\u2013\u2014|:/]+|[\s\-\u2013\u2014|:/]+$/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function isVariantOrOfferNote(value) {
    const note = String(value ?? "").trim();
    if (!note) return false;
    if (/\b(?:buy\s*\d+|take\s*\d+|get\s*\d+|free|promo|offer|qty|quantity|pack\s+of\s+\d+)\b/i.test(note)) {
      return true;
    }
    if (/\b\d+\s*[x\u00d7]\b/i.test(note)) return true;
    if (new RegExp(`\\b(?:${variantLabel})\\b\\s*[:=]?`, "i").test(note)) return true;
    return new RegExp(`^(?:${variantValue})(?:\\s*[,/]\\s*(?:${variantValue}))*$`, "i").test(note);
  }

  function stripRepeatedQuantitySuffix(value) {
    const patterns = [
      /\s*[-\u2013\u2014|:/]\s*\d+\s*[x\u00d7]\s*/gi,
      /\s+\d+\s*[x\u00d7]\s+/gi,
    ];
    let earliest = null;

    for (const pattern of patterns) {
      const match = pattern.exec(value);
      if (match && match.index > 0 && (!earliest || match.index < earliest.index)) {
        earliest = match;
      }
    }
    if (!earliest) return value;

    const prefix = trimSeparators(value.slice(0, earliest.index));
    const suffix = value.slice(earliest.index + earliest[0].length);
    const prefixKey = normaliseKey(prefix);
    const suffixKey = normaliseKey(suffix);
    return prefixKey.length >= 3 && suffixKey.includes(prefixKey) ? prefix : value;
  }

  function normaliseProductName(value) {
    const original = String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
    if (!original) return "";

    let cleaned = original
      .replace(/\(([^)]*)\)/g, (full, note) => (isVariantOrOfferNote(note) ? " " : full))
      .replace(/\[([^\]]*)\]/g, (full, note) => (isVariantOrOfferNote(note) ? " " : full))
      .replace(/\bbuy\s*\d+\s*(?:take|get)\s*\d+(?:\s*free)?\b/gi, " ")
      .replace(/\bb\s*\d+\s*t\s*\d+\b/gi, " ")
      .replace(/^\s*(?:qty|quantity)\s*[:\-]?\s*\d+\s*(?:[x\u00d7]\s*)?/i, "")
      .replace(/^\s*\d+\s*[x\u00d7]\s*/i, "")
      .replace(/^\s*[x\u00d7]\s*\d+\s*/i, "")
      .replace(/^\s*\d+\s*(?:pcs?|pieces?|packs?|sets?|bottles?|units?)\s+(?:of\s+)?/i, "")
      .replace(/\s+/g, " ")
      .trim();

    cleaned = stripRepeatedQuantitySuffix(cleaned);

    const explicitVariantSeparator = new RegExp(
      `(?:\\s*[:|]\\s*|\\s+[-\\u2013\\u2014]\\s+)(?:${variantLabel})\\s*(?:[:=]\\s*)?`,
      "i",
    );
    const explicitVariantWithoutSeparator = new RegExp(`\\s+(?:${variantLabel})\\s*[:=]`, "i");
    const separatorIndex = cleaned.search(explicitVariantSeparator);
    const labelIndex = cleaned.search(explicitVariantWithoutSeparator);
    const variantIndex = [separatorIndex, labelIndex]
      .filter((index) => index > 0)
      .sort((a, b) => a - b)[0];
    if (variantIndex !== undefined) cleaned = cleaned.slice(0, variantIndex);

    const bareVariantSuffix = new RegExp(
      `^(.+?)\\s*[-\\u2013\\u2014|:]\\s*(?:\\d+\\s*[x\\u00d7]\\s*)?(?:${variantValue})(?:\\s*[,/]\\s*(?:${variantValue}))*$`,
      "i",
    );
    const bareVariantMatch = cleaned.match(bareVariantSuffix);
    if (bareVariantMatch) cleaned = bareVariantMatch[1];

    cleaned = cleaned
      .replace(
        /\s*[-\u2013\u2014|:/]?\s*(?:\d+\s*[x\u00d7]|[x\u00d7]\s*\d+|\d+\s*(?:pcs?|pieces?|packs?|sets?|bottles?|units?))\s*$/i,
        "",
      )
      .replace(/^\s*(?:free|promo|offer)\s*[-\u2013\u2014|:/]?\s*/i, "")
      .replace(/\s*[-\u2013\u2014|:/]\s*(?:free|promo|offer)\s*$/i, "");

    cleaned = trimSeparators(cleaned);
    return cleaned || original;
  }

  window.RTSProductNormalizer = Object.freeze({ normaliseProductName });
})();
