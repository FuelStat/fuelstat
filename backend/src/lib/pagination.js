// Seitenweises Laden für alle Listen-Endpunkte (#160).
//
// Anfrage: ?page=1&per_page=25 (limit ist ein Alias für per_page). Ohne Angabe: Seite 1 mit DEFAULT_PER_PAGE
// Einträgen; mehr als MAX_PER_PAGE werden auf MAX_PER_PAGE begrenzt (die Antwort nennt die tatsächliche Größe).
// Antwort: { data: [...], pagination: { current_page, per_page, total, total_pages, has_more } }
//
// Die Abfragen sortieren immer eindeutig (zuletzt nach id), damit beim Blättern nichts doppelt kommt oder fehlt.

const DEFAULT_PER_PAGE = 25;
const MAX_PER_PAGE = 100;

const positiveInt = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 ? n : null;
};

/**
 * Seite und Größe aus der Anfrage.
 * @returns {{ page: number, perPage: number, limit: number, offset: number } | { error: string }}
 */
function parsePagination(query = {}, { defaultPerPage = DEFAULT_PER_PAGE, maxPerPage = MAX_PER_PAGE } = {}) {
  const rawPage = query.page;
  const rawPer = query.per_page ?? query.limit;
  const page = rawPage === undefined || rawPage === '' ? 1 : positiveInt(rawPage);
  const per = rawPer === undefined || rawPer === '' ? defaultPerPage : positiveInt(rawPer);
  if (page === null) return { error: 'invalid_page' };
  if (per === null) return { error: 'invalid_per_page' };
  const perPage = Math.min(per, maxPerPage);
  return { page, perPage, limit: perPage, offset: (page - 1) * perPage };
}

/** Antwort mit Seitenangaben */
function paginated(data, total, { page, perPage }) {
  const totalNumber = Number(total) || 0;
  return {
    data,
    pagination: {
      current_page: page,
      per_page: perPage,
      total: totalNumber,
      total_pages: Math.max(1, Math.ceil(totalNumber / perPage)),
      has_more: page * perPage < totalNumber
    }
  };
}

/**
 * Seitenangaben aus der Anfrage lesen und bei ungültigen Werten mit 400 antworten.
 * @returns {object|null} null, wenn bereits geantwortet wurde
 */
function pageOrReply(req, res, options) {
  const p = parsePagination(req.query, options);
  if (p.error) {
    res.status(400).json({ error: p.error });
    return null;
  }
  return p;
}

/**
 * Eine fertig sortierte Liste (z. B. aus einem Service) als Seite ausliefern – für kurze Listen, die ohnehin ganz
 * berechnet werden (Medien, Einladungen, Tokens).
 */
function pageOfArray(list, p) {
  return paginated(list.slice(p.offset, p.offset + p.perPage), list.length, p);
}

/**
 * Eine Seite per SQL laden: sql ohne LIMIT/OFFSET (mit eindeutigem ORDER BY), countSql liefert die Spalte total
 * mit denselben Parametern.
 */
async function queryPage(db, { sql, countSql, params = [] }, p) {
  const n = params.length;
  const [rows, count] = await Promise.all([
    db.query(sql + ' LIMIT $' + (n + 1) + ' OFFSET $' + (n + 2), [...params, p.limit, p.offset]),
    db.query(countSql, params)
  ]);
  return paginated(rows.rows, count.rows[0]?.total ?? 0, p);
}

module.exports = { DEFAULT_PER_PAGE, MAX_PER_PAGE, parsePagination, paginated, pageOrReply, pageOfArray, queryPage };
