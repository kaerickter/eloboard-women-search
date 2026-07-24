"use strict";

function normalizeBjListPlayerText(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  const match = text.match(/^(.*?)\s+([TZP])$/i);
  return match ? match[1].trim() : text;
}

module.exports = {
  normalizeBjListPlayerText,
};
