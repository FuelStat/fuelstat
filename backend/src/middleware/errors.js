// Einheitliches Fehlerformat (#118): auch Fehler außerhalb der Routen kommen als JSON { error, message? }.
// - Anfragekörper kein gültiges JSON bzw. zu groß (express.json)
// - unbekannter Pfad unter /api (statt der HTML-Seite von Express)

// Vor uploadErrorHandler einhängen: Fehler von express.json() haben eine Typangabe (entity.*)
function bodyErrorHandler(error, req, res, next) {
  if (error && error.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'invalid_json', message: 'Der Anfragekörper ist kein gültiges JSON.' });
  }
  if (error && error.type === 'entity.too.large') {
    return res.status(413).json({ error: 'payload_too_large' });
  }
  if (error && typeof error.type === 'string' && error.type.startsWith('entity.')) {
    return res.status(400).json({ error: 'invalid_request_body' });
  }
  return next(error);
}

// Als letztes: kein Endpunkt passt
function notFound(req, res) {
  res.status(404).json({ error: 'not_found' });
}

module.exports = { bodyErrorHandler, notFound };
