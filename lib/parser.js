const cheerio = require('cheerio');

/**
 * Best-effort parser for Wikipedia award-show pages.
 *
 * IMPORTANT: Wikipedia pages are written by humans and their table layout
 * is NOT perfectly consistent across award shows. This parser recognizes
 * two common layouts (see parseCategoryColumnTables / parseCategoryHeaderTables
 * below) which cover most Filmfare/Oscar/Emmy-style pages, but you should
 * spot-check the first few results in Strapi before trusting them blindly.
 * Categories/tables it can't confidently parse are simply skipped, so you
 * may need to add some entries manually.
 */

function cleanText(text) {
  return (text || '')
    .replace(/\[\d+\]/g, '') // remove [1] style citation markers
    .replace(/\u00a0/g, ' ') // non-breaking spaces
    .replace(/\s+/g, ' ')
    .trim();
}

// Extracts a table cell's text, joining multiple <li>/<br>-separated items
// with ", " instead of running them together with no separator at all
// (Wikipedia often lists e.g. multiple hosts this way).
function getCellText($, cell) {
  const $cell = $(cell);

  const liItems = $cell.find('li');
  if (liItems.length > 0) {
    return liItems
      .map((i, li) => cleanText($(li).text()))
      .get()
      .filter(Boolean)
      .join(', ');
  }

  const html = $cell.html() || '';
  const segments = html.split(/<br\s*\/?>/i);
  if (segments.length > 1) {
    return segments
      .map((seg) => cleanText(cheerio.load(`<div>${seg}</div>`)('div').text()))
      .filter(Boolean)
      .join(', ');
  }

  return cleanText($cell.text());
}

function parseInfobox($) {
  const info = {};
  $('table.infobox tr').each((i, row) => {
    const label = cleanText($(row).find('th').first().text());
    const valueCell = $(row).find('td').first();
    const value = valueCell.length ? getCellText($, valueCell) : '';
    if (label && value) info[label] = value;
  });
  return info;
}

// Splits "Rajkummar Rao – Badhaai Do as Shardul Thakur" into a name and a
// detail/subtitle part, on the first en-dash or hyphen surrounded by spaces.
function splitNameAndDetail(text) {
  const match = text.match(/^(.*?)\s[–-]\s(.*)$/);
  if (match) {
    return { name: cleanText(match[1]), detail: cleanText(match[2]) };
  }
  return { name: cleanText(text), detail: '' };
}

/**
 * Extracts a list of {text, isBold} "entries" from a single table cell.
 * Handles three common Wikipedia conventions, in order of preference:
 *   1. <li> list items
 *   2. <br>-separated lines
 *   3. semicolon-separated plain text (fallback)
 */
function extractEntries($, cell) {
  const $cell = $(cell);

  const liItems = $cell.find('li');
  if (liItems.length > 0) {
    return liItems
      .map((i, li) => ({
        text: cleanText($(li).text()),
        isBold: $(li).find('b, strong').length > 0
      }))
      .get()
      .filter((e) => e.text);
  }

  const html = $cell.html() || '';
  const segments = html.split(/<br\s*\/?>/i);
  if (segments.length > 1) {
    return segments
      .map((seg) => {
        const $seg = cheerio.load(`<div>${seg}</div>`);
        return {
          text: cleanText($seg('div').text()),
          isBold: $seg('div b, div strong').length > 0
        };
      })
      .filter((e) => e.text);
  }

  const rawText = cleanText($cell.text());
  if (rawText.includes(';')) {
    return rawText
      .split(';')
      .map((t) => ({ text: cleanText(t), isBold: false }))
      .filter((e) => e.text);
  }

  return rawText ? [{ text: rawText, isBold: $cell.find('b, strong').length > 0 }] : [];
}

function entriesToCategory(categoryName, entries) {
  // Normally there's one bold winner, but ties/shared wins mean sometimes
  // MULTIPLE entries in the same cell are bold (e.g. two actors sharing
  // Best Actor). Treat all bold entries as co-winners rather than only
  // keeping the first one and bumping the rest down to nominees.
  const boldEntries = entries.filter((e) => e.isBold);
  const winnerEntries = boldEntries.length > 0 ? boldEntries : [entries[0]];
  const nominees = entries.filter((e) => !winnerEntries.includes(e));

  const winners = winnerEntries.map((e) => splitNameAndDetail(e.text));
  const winnerTitle = winners.map((w) => w.name).join(' & ');
  const winnerSubTitle = winners
    .map((w) => w.detail)
    .filter(Boolean)
    .join(' / ');

  return {
    categoryName,
    winnerTitle,
    winnerSubTitle,
    NomineesList: nominees.map((n) => {
      const nom = splitNameAndDetail(n.text);
      return { name: nom.name, subTitle: nom.detail };
    })
  };
}

const STATS_HEADER_RE = /^(nominations?|awards?|wins?|film|rank)$/i;

// Style A: a table with an explicit "Category"/"Award" column, and a
// separate winner/awardee column (e.g. National Film Awards style:
// "Award | Film | Language | Awardee(s) | Cash prize").
function parseCategoryColumnTables($) {
  const categories = [];

  $('table.wikitable').each((i, table) => {
    const $table = $(table);
    const headerCells = $table
      .find('tr')
      .eq(0)
      .find('th')
      .map((j, el) => cleanText($(el).text()))
      .get();

    const catIdx = headerCells.findIndex((h) => /^(categor(y|ies)|award)$/i.test(h));
    if (catIdx === -1) return;

    // Prefer a dedicated "Awardee(s)/Winner/Recipient" column as the
    // winner; otherwise fall back to the column right next to the
    // category column.
    const winnerIdx = headerCells.findIndex((h) => /^(awardee|winner|recipient|nominee)/i.test(h));
    const filmIdx = headerCells.findIndex((h) => /^film$/i.test(h));

    $table
      .find('tr')
      .slice(1)
      .each((j, row) => {
        // Wikipedia often marks the leading "category name" cell of a data
        // row as a <th scope="row"> rather than a <td> (a row header), so
        // we must include both — using td-only would silently shift every
        // column over by one.
        const $cells = $(row).find('td, th');
        if ($cells.length === 0) return;

        const categoryName = cleanText($cells.eq(catIdx).text());
        // Skip rows with no category name — usually a rowspan-continuation
        // row for a shared award, which we can't reliably realign here.
        if (!categoryName) return;

        let winnerCellIdx = winnerIdx !== -1 ? winnerIdx : catIdx === 0 ? 1 : 0;
        if (winnerCellIdx >= $cells.length) winnerCellIdx = $cells.length - 1;

        const winnerCell = $cells.get(winnerCellIdx);
        const entries = extractEntries($, winnerCell);
        if (entries.length === 0) return;

        const category = entriesToCategory(categoryName, entries);

        // If there's a separate "Film" column (common in acting
        // categories), use it as the subtitle when we don't already have
        // one from the winner cell itself.
        if (filmIdx !== -1 && filmIdx !== winnerCellIdx && !category.winnerSubTitle) {
          const filmText = cleanText($cells.eq(filmIdx).text());
          if (filmText) category.winnerSubTitle = filmText;
        }

        categories.push(category);
      });
  });

  return categories;
}

// Oscar-style results tables place each award category and its nested
// winner/nominee list inside a separate table cell.
function parseCategoryBlockTables($) {
  const categories = [];

  $('table.wikitable td').each((i, cell) => {
    const $cell = $(cell);
    const $heading = $cell.children('div').first();
    const $winnerList = $cell.children('ul').first();
    if (!$heading.find('b, strong').length || !$winnerList.length) return;

    const categoryName = cleanText($heading.text());
    const $winnerItem = $winnerList.children('li').first();
    if (!categoryName || !$winnerItem.length) return;

    const $winnerContent = $winnerItem.clone();
    $winnerContent.children('ul').remove();
    const winner = splitNameAndDetail(cleanText($winnerContent.text()).replace(/\s*[‡*]+\s*$/, ''));
    if (!winner.name) return;

    const nominees = $winnerItem
      .children('ul')
      .first()
      .children('li')
      .map((j, nominee) => splitNameAndDetail(cleanText($(nominee).text())))
      .get()
      .filter((nominee) => nominee.name)
      .map((nominee) => ({ name: nominee.name, subTitle: nominee.detail }));

    categories.push({
      categoryName,
      winnerTitle: winner.name,
      winnerSubTitle: winner.detail,
      NomineesList: nominees
    });
  });

  return categories;
}

function isHeaderRow($, row) {
  const $cells = $(row).children();
  if ($cells.length < 2 || $cells.length > 6) return false;
  return $cells.toArray().every((c) => c.tagName && c.tagName.toLowerCase() === 'th');
}

function categoryHeadingFromCell($, cell) {
  const $heading = $(cell).children('div').first();
  if (!$heading.length || !$heading.find('b, strong').length) return '';
  return cleanText($heading.text());
}

// Some award pages place bold category labels in one row and the matching
// nominee lists in the next row, aligned by table-cell position.
function parsePairedCategoryRows($) {
  const categories = [];

  $('table.wikitable').each((i, table) => {
    const rows = $(table).find('tr').toArray();

    for (let rowIndex = 0; rowIndex < rows.length - 1; rowIndex += 1) {
      const headingCells = $(rows[rowIndex]).children('th, td').toArray();
      const headings = headingCells.map((cell) => categoryHeadingFromCell($, cell));
      if (!headings.some(Boolean)) continue;

      const dataCells = $(rows[rowIndex + 1]).children('th, td').toArray();
      if (dataCells.length !== headingCells.length) continue;

      for (const [cellIndex, categoryName] of headings.entries()) {
        if (!categoryName || !$(dataCells[cellIndex]).children('ul').length) continue;
        const entries = extractEntries($, dataCells[cellIndex]);
        if (entries.length === 0) continue;
        categories.push(entriesToCategory(categoryName, entries));
      }
    }
  });

  return categories;
}

function isDataRow($, row) {
  const $cells = $(row).children();
  if ($cells.length === 0) return false;
  // A data row just needs at least one <td> — Wikipedia sometimes marks
  // the leading "name" cell as a <th scope="row"> even in what is
  // otherwise a data row.
  return $cells.toArray().some((c) => c.tagName && c.tagName.toLowerCase() === 'td');
}

/**
 * Style B (the most common one on Wikipedia): a table where each column
 * header IS the category name itself (e.g. "Best Actor | Best Actress"),
 * and the cell below each header holds the winner (usually bold, listed
 * first) followed by the other nominees.
 *
 * Crucially, a single <table> often contains MANY such header/data row
 * PAIRS stacked on top of each other (e.g. "Best Editing | Best Production
 * Design | Best Choreography" followed by its data row, then immediately
 * "Best Cinematography | Best Sound Design | Best Background Score"
 * followed by ITS data row, all inside the same table). So instead of
 * only looking at row 0/row 1, we scan every row and treat any row made
 * entirely of <th> cells as a new category-header row, pairing it with
 * the row right after it (if that row is made entirely of <td> cells).
 */
function parseCategoryHeaderTables($) {
  const categories = [];

  $('table.wikitable').each((i, table) => {
    const rows = $(table).find('tr').toArray();
    let idx = 0;

    while (idx < rows.length) {
      const row = rows[idx];

      if (isHeaderRow($, row)) {
        const headers = $(row)
          .children('th')
          .map((j, el) => cleanText($(el).text()))
          .get();

        const looksLikeStatsTable = headers.some((h) => STATS_HEADER_RE.test(h));
        const isCategoryColumnStyle = /^(categor(y|ies)|award)$/i.test(headers[0] || '');
        const isNonAwardTable = headers.some((h) => /^(name(?:\(s\))?|role|performed)$/i.test(h));

        const nextRow = rows[idx + 1];
        if (!looksLikeStatsTable && !isCategoryColumnStyle && !isNonAwardTable && nextRow && isDataRow($, nextRow)) {
          const cells = $(nextRow).children('td').get();

          headers.forEach((categoryName, hIdx) => {
            if (!categoryName) return;
            const cell = cells[hIdx];
            if (!cell) return;

            const entries = extractEntries($, cell);
            if (entries.length === 0) return;

            categories.push(entriesToCategory(categoryName, entries));
          });

          idx += 2; // consumed both the header row and its data row
          continue;
        }
      }

      idx += 1;
    }
  });

  return categories;
}

function parseCategories($) {
  const fromCategoryBlocks = parseCategoryBlockTables($);
  const fromPairedRows = parsePairedCategoryRows($);
  const fromColumnStyle = parseCategoryColumnTables($);
  const fromHeaderStyle = parseCategoryHeaderTables($);

  // Merge, de-duplicating by categoryName (case-insensitive, first wins).
  const seen = new Set();
  const merged = [];
  for (const cat of [...fromCategoryBlocks, ...fromPairedRows, ...fromColumnStyle, ...fromHeaderStyle]) {
    const key = cat.categoryName.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(cat);
  }
  return merged;
}

module.exports = { cleanText, parseInfobox, parseCategories };
