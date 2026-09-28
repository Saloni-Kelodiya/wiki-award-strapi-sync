const cheerio = require("cheerio");

function cleanText(value) {
  if (!value) return "";
  return String(value)
    .replace(/\[\d+\]/g, "")
    .replace(/\[citation needed\]/gi, "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getCellText($, el) {
  const values = [];
  $(el).find("li").each((_, li) => {
    const text = cleanText($(li).text());
    if (text) values.push(text);
  });
  if (values.length) return values.join(" ; ");
  const clone = $(el).clone();
  clone.find("br").replaceWith(" ");
  return cleanText(clone.text());
}

function parseInfobox($) {
  const infobox = {};
  $("table.infobox tr").each((_, row) => {
    const cells = $(row).find("th, td");
    if (cells.length < 2) return;
    const key = cleanText($(cells[0]).text()).toLowerCase();
    const value = cleanText($(cells[1]).text());
    if (key && value) infobox[key] = value;
  });
  return infobox;
}

function splitNameAndDetail(text) {
  const cleaned = cleanText(text);
  if (!cleaned) return { name: "", detail: "" };

  for (const separator of [" – ", " — ", " - ", " | "]) {
    if (cleaned.includes(separator)) {
      const parts = cleaned.split(separator);
      return {
        name: cleanText(parts[0]),
        detail: cleanText(parts.slice(1).join(separator)),
      };
    }
  }

  return { name: cleaned, detail: "" };
}

function extractEntries($, cell) {
  const entries = [];
  const listItems = $(cell).find("li");

  if (listItems.length) {
    listItems.each((_, li) => {
      const text = cleanText($(li).text());
      if (!text) return;

      entries.push({
        text,
        winner: $(li).find("b, strong").length > 0,
      });
    });
    return entries;
  }

  const clone = $(cell).clone();
  clone.find("br").replaceWith("\n");

  const lines = clone
    .text()
    .split("\n")
    .map(cleanText)
    .filter(Boolean);

  if (lines.length > 1) {
    return lines.map(text => ({
      text,
      winner: false,
    }));
  }

  const singleText = cleanText($(cell).text());

  if (!singleText) return [];

  return singleText
    .split(/\s*;\s*/)
    .map(cleanText)
    .filter(Boolean)
    .map(text => ({
      text,
      winner: false,
    }));
}

function isYearLike(text) {
  const value = cleanText(text);
  return /^(?:19|20)\d{2}(?:\s*[–-]\s*(?:19|20)\d{2})?$/.test(value);
}

const INVALID_CATEGORY_NAMES = new Set([
  "category",
  "award",
  "year",
  "date",
  "venue",
  "location",
  "host",
  "network",
  "country",
  "language",
  "references",
  "reference",
  "notes",
  "note",
  "source",
  "total",
  "nominations",
  "nomination",
  "wins",
  "win",
  "awards",
  "award count",
  "occupation",
  "born",
  "nationality",
  "years active",
  "website",
  "website url",
  "residence",
]);

function isValidCategoryName(name) {
  const value = cleanText(name);

  if (!value || value.length > 120 || isYearLike(value)) {
    return false;
  }

  return !INVALID_CATEGORY_NAMES.has(value.toLowerCase());
}

function isValidWinner(text) {
  const value = cleanText(text);

  if (!value || isYearLike(value)) {
    return false;
  }

  if (/^(no award|not awarded|none|n\/a|—|-)$/i.test(value)) {
    return false;
  }

  return true;
}

function entriesToCategory(categoryName, entries) {
  if (!isValidCategoryName(categoryName) || !entries.length) {
    return null;
  }

  const validEntries = entries.filter(entry =>
    isValidWinner(entry.text)
  );

  if (!validEntries.length) {
    return null;
  }

  const explicitWinners = validEntries.filter(entry => entry.winner);
  const winner = explicitWinners[0] || validEntries[0];

  const winnerData = splitNameAndDetail(winner.text);

  const nomineeList = validEntries
    .filter(entry => entry.text !== winner.text)
    .map(entry => {
      const data = splitNameAndDetail(entry.text);

      return {
        Name: data.name,
        SubTitle: data.detail || "",
      };
    });

  return {
    categoryName: cleanText(categoryName),
    categoryDescription: "",
    winnerTitle: winnerData.name,
    winnerSubTitle: winnerData.detail || "",
    nominees: nomineeList,
  };
}

function parseCategoryColumnTables($) {
  const categories = [];

  $("table.wikitable").each((_, table) => {
    const rows = $(table).find("tr");

    rows.each((_, row) => {
      const cells = $(row).children("th, td");

      if (cells.length < 2) return;

      const categoryName = cleanText($(cells[0]).text());

      if (!isValidCategoryName(categoryName)) return;

      const entries = [];

      cells.slice(1).each((_, cell) => {
        entries.push(...extractEntries($, cell));
      });

      const category = entriesToCategory(categoryName, entries);

      if (category) {
        categories.push(category);
      }
    });
  });

  return categories;
}

function parseCategoryBlockTables($) {
  const categories = [];

  $("table.wikitable").each((_, table) => {
    $(table).find("tr").each((_, row) => {
      const heading = $(row).find("th").first();

      if (!heading.length) return;

      const categoryName = cleanText(heading.text());

      if (!isValidCategoryName(categoryName)) return;

      const nextRow = $(row).next("tr");

      if (!nextRow.length) return;

      const entries = [];

      nextRow.find("td, th").each((_, cell) => {
        entries.push(...extractEntries($, cell));
      });

      const category = entriesToCategory(categoryName, entries);

      if (category) {
        categories.push(category);
      }
    });
  });

  return categories;
}

function parsePairedCategoryRows($) {
  const categories = [];

  $("table.wikitable").each((_, table) => {
    const rows = $(table).find("tr");

    rows.each((index, row) => {
      const categoryCell = $(row).children("th").first();

      if (!categoryCell.length) return;

      const categoryName = cleanText(categoryCell.text());

      if (!isValidCategoryName(categoryName)) return;

      const nextRow = rows.eq(index + 1);

      if (!nextRow.length) return;

      const entries = [];

      nextRow.find("td, th").each((_, cell) => {
        entries.push(...extractEntries($, cell));
      });

      const category = entriesToCategory(categoryName, entries);

      if (category) {
        categories.push(category);
      }
    });
  });

  return categories;
}

function parseCategoryHeaderTables($) {
  const categories = [];

  $("table.wikitable").each((_, table) => {
    const rows = $(table).find("tr");

    rows.each((index, row) => {
      const headers = $(row).children("th");

      if (!headers.length) return;

      const nextRow = rows.eq(index + 1);

      if (!nextRow.length) return;

      const values = nextRow.children("td, th");

      headers.each((headerIndex, header) => {
        const categoryName = cleanText($(header).text());

        if (!isValidCategoryName(categoryName)) return;

        const valueCell = values.eq(headerIndex);

        if (!valueCell.length) return;

        const entries = extractEntries($, valueCell);

        const category = entriesToCategory(
          categoryName,
          entries
        );

        if (category) {
          categories.push(category);
        }
      });
    });
  });

  return categories;
}

function parseFallbackAwardRows($) {
  const categories = [];

  $("table.wikitable").each((_, table) => {
    if ($(table).closest("table.infobox").length) {
      return;
    }

    const rows = $(table).find("tr");

    rows.each((_, row) => {
      const cells = $(row).children("td, th");

      if (cells.length < 2) return;

      const allHeaders = cells
        .toArray()
        .every(cell => $(cell).is("th"));

      if (allHeaders) return;

      const categoryName = cleanText($(cells[0]).text());

      if (!isValidCategoryName(categoryName)) return;

      const entries = [];

      cells.slice(1).each((_, cell) => {
        entries.push(...extractEntries($, cell));
      });

      const category = entriesToCategory(
        categoryName,
        entries
      );

      if (category) {
        categories.push(category);
      }
    });
  });

  return categories;
}

function deduplicateCategories(categories) {
  const map = new Map();

  for (const category of categories) {
    if (!category || !category.categoryName) continue;

    const key = category.categoryName
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();

    if (!map.has(key)) {
      map.set(key, category);
    }
  }

  return Array.from(map.values());
}

function scoreCategories(categories) {
  if (!categories.length) return 0;

  let score = 0;

  for (const category of categories) {
    score += 1;

    if (
      category.winnerTitle &&
      !isYearLike(category.winnerTitle)
    ) {
      score += 2;
    }

    if (category.nominees?.length) {
      score += 1;
    }
  }

  return score;
}

function parseCategories($) {
  const structured = deduplicateCategories([
    ...parseCategoryColumnTables($),
    ...parseCategoryBlockTables($),
    ...parsePairedCategoryRows($),
    ...parseCategoryHeaderTables($),
  ]);

  const fallback = deduplicateCategories(
    parseFallbackAwardRows($)
  );

  const structuredScore = scoreCategories(structured);
  const fallbackScore = scoreCategories(fallback);

  if (!structured.length && fallback.length) {
    console.log(
      "[Parser] Structured parsers found 0 valid categories. Using fallback."
    );

    return fallback;
  }

  if (
    fallback.length &&
    fallbackScore > structuredScore
  ) {
    console.log(
      "[Parser] Fallback produced a stronger result. Using fallback."
    );

    return fallback;
  }

  return structured;
}

module.exports = {
  cleanText,
  getCellText,
  parseInfobox,
  splitNameAndDetail,
  extractEntries,
  entriesToCategory,
  parseCategoryColumnTables,
  parseCategoryBlockTables,
  parsePairedCategoryRows,
  parseCategoryHeaderTables,
  parseFallbackAwardRows,
  parseCategories,
};