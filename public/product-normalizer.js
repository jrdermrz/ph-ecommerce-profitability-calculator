(() => {
  "use strict";

  const variantLabel =
    "colou?r|size|variant|variation|flavou?r|scent|shade|style|design|model|type|capacity|option";
  const variantValue =
    "black|white|blue|red|green|yellow|orange|purple|violet|pink|brown|gray|grey|beige|cream|gold|silver|clear|transparent|assorted|random|navy|teal|maroon|small|medium|large|extra\\s+small|extra\\s+large|xs|s|m|l|xl|xxl|xxxl|\\d+(?:\\.\\d+)?\\s*(?:ml|l|g|kg|oz|cm|mm|m|inches?|inch|pcs?|pieces?|packs?|sets?|bottles?|units?)";
  const fingerprintIgnoredWords = new Set([
    "buy",
    "take",
    "get",
    "free",
    "promo",
    "offer",
    "qty",
    "quantity",
    "x",
    "pc",
    "pcs",
    "piece",
    "pieces",
    "pack",
    "packs",
    "set",
    "sets",
    "bottle",
    "bottles",
    "unit",
    "units",
    "with",
    "w",
    "big",
    "trap",
    "premium",
    "pro",
    "multipurpose",
    "black",
    "white",
    "blue",
    "red",
    "green",
    "yellow",
    "orange",
    "peach",
    "purple",
    "violet",
    "pink",
    "brown",
    "gray",
    "grey",
    "beige",
    "cream",
    "gold",
    "silver",
    "clear",
    "transparent",
    "assorted",
    "random",
    "navy",
    "teal",
    "maroon",
    "small",
    "medium",
    "large",
    "xs",
    "xl",
    "xxl",
    "xxxl",
  ]);
  const fingerprintAliases = new Map([
    ["mice", "mouse"],
    ["deo", "deodorizer"],
    ["colour", "color"],
  ]);

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
      .replace(
        /(?:^|[\s,;|:/\-\u2013\u2014])(?:\d+\s*[x\u00d7]?\s*)?buy\s*\d+\s*(?:take|get)\s*\d+\s*[x\u00d7]?(?:\s*free)?/gi,
        " ",
      )
      .replace(/\bb\s*\d+\s*t\s*\d+\b/gi, " ")
      .replace(/^\s*(?:qty|quantity)\s*[:\-]?\s*\d+\s*(?:[x\u00d7]\s*)?/i, "")
      .replace(/^\s*\d+\s*[x\u00d7]+\s*/i, "")
      .replace(/^\s*[x\u00d7]\s*\d+\s*/i, "")
      .replace(/^\s*\d+\s*(?:pcs?|pieces?|packs?|sets?|bottles?|units?)\s*(?:of\s+)?/i, "")
      .replace(/^\s*(?:pcs?|pieces?|packs?|sets?|bottles?|units?)\s+/i, "")
      .replace(/^\s*[x\u00d7]+\s*/i, "")
      .replace(/^\s*\d+\s+(?=[\p{L}])/u, "")
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

  function singulariseToken(value) {
    const token = fingerprintAliases.get(value) ?? value;
    if (token.length > 4 && token.endsWith("ies")) return `${token.slice(0, -3)}y`;
    if (token.length > 4 && token.endsWith("es") && /(boxes|dishes|watches|brushes)$/.test(token)) {
      return token.slice(0, -2);
    }
    if (token.length > 4 && token.endsWith("s") && !/(ss|us|is)$/.test(token)) {
      return token.slice(0, -1);
    }
    return token;
  }

  function collapseRepeatedTokens(tokens) {
    for (let size = 1; size <= Math.floor(tokens.length / 2); size += 1) {
      let repeated = true;
      for (let index = 0; index < tokens.length; index += 1) {
        if (tokens[index] !== tokens[index % size]) {
          repeated = false;
          break;
        }
      }
      if (repeated) return tokens.slice(0, size);
    }
    return tokens;
  }

  function collapseRepeatedCompact(value) {
    for (let size = 4; size <= Math.floor(value.length / 2); size += 1) {
      if (value.length % size !== 0) continue;
      const prefix = value.slice(0, size);
      if (prefix.repeat(value.length / size) === value) return prefix;
    }
    return value;
  }

  function productFingerprint(value) {
    let cleaned = normaliseProductName(value)
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .toLocaleLowerCase()
      .replace(/\(?\d+(?:\.\d+)?\s*m\s*[x\u00d7]\s*\d+(?:\.\d+)?\s*m?\)?/gi, " ")
      .replace(/\d+\s*(?:[x\u00d7]+|pcs?|pieces?|packs?|sets?|bottles?|units?)/gi, " ")
      .replace(
        /(?:^|[\s,;|:/\-\u2013\u2014])(?:\d+\s*[x\u00d7]?\s*)?buy\s*\d+\s*(?:take|get)\s*\d+\s*[x\u00d7]?(?:\s*free)?/gi,
        " ",
      )
      .replace(/[^a-z0-9]+/g, " ")
      .trim();

    const tokens = collapseRepeatedTokens(
      cleaned
        .split(/\s+/)
        .map(singulariseToken)
        .filter((token) => token && !/^\d+$/.test(token) && !fingerprintIgnoredWords.has(token)),
    );
    if (!tokens.length) return normaliseKey(value).replace(/\s+/g, "");

    const compact = collapseRepeatedCompact(tokens.join(""));
    if (compact !== tokens.join("")) return compact;
    cleaned = tokens.join(" ");
    return cleaned;
  }

  function damerauLevenshtein(left, right) {
    const rows = left.length + 1;
    const cols = right.length + 1;
    const matrix = Array.from({ length: rows }, () => Array(cols).fill(0));
    for (let row = 0; row < rows; row += 1) matrix[row][0] = row;
    for (let col = 0; col < cols; col += 1) matrix[0][col] = col;

    for (let row = 1; row < rows; row += 1) {
      for (let col = 1; col < cols; col += 1) {
        const cost = left[row - 1] === right[col - 1] ? 0 : 1;
        matrix[row][col] = Math.min(
          matrix[row - 1][col] + 1,
          matrix[row][col - 1] + 1,
          matrix[row - 1][col - 1] + cost,
        );
        if (
          row > 1 &&
          col > 1 &&
          left[row - 1] === right[col - 2] &&
          left[row - 2] === right[col - 1]
        ) {
          matrix[row][col] = Math.min(matrix[row][col], matrix[row - 2][col - 2] + cost);
        }
      }
    }
    return matrix[left.length][right.length];
  }

  function productsAreEquivalent(leftFingerprint, rightFingerprint) {
    if (!leftFingerprint || !rightFingerprint) return false;
    const leftCompact = leftFingerprint.replace(/\s+/g, "");
    const rightCompact = rightFingerprint.replace(/\s+/g, "");
    if (leftCompact === rightCompact) return true;

    const [shortText, longText] =
      leftCompact.length <= rightCompact.length
        ? [leftFingerprint, rightFingerprint]
        : [rightFingerprint, leftFingerprint];
    const shortCompact = shortText.replace(/\s+/g, "");
    const longCompact = longText.replace(/\s+/g, "");
    const shortTokens = shortText.split(/\s+/).filter(Boolean);
    const longTokens = longText.split(/\s+/).filter(Boolean);
    const lengthRatio = shortCompact.length / longCompact.length;

    if (
      longCompact.startsWith(shortCompact) &&
      shortCompact.length >= 8 &&
      (shortTokens.length >= 3 || (shortTokens.length >= 2 && lengthRatio >= 0.72))
    ) {
      return true;
    }

    if (shortTokens.length >= 3) {
      const longTokenSet = new Set(longTokens);
      if (shortTokens.every((token) => longTokenSet.has(token))) return true;
    }

    const longestLength = Math.max(leftCompact.length, rightCompact.length);
    const allowedDistance = longestLength >= 20 ? 2 : 1;
    return (
      Math.abs(leftCompact.length - rightCompact.length) <= allowedDistance &&
      damerauLevenshtein(leftCompact, rightCompact) <= allowedDistance
    );
  }

  window.RTSProductNormalizer = Object.freeze({
    normaliseProductName,
    productFingerprint,
    productsAreEquivalent,
  });
})();
