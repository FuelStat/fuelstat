// Routen: /files/:name
// Aus backend/src/server.js ausgelagert (#110), Inhalt unverändert.
const express = require('express');
const media = require('../services/media');
const { UPLOAD_DIR } = require('../config');
const { fileLimiter } = require('../middleware/rateLimits');

const router = express.Router();

// Bilder nur mit gültiger Signatur ausliefern; kein öffentliches /uploads mehr.
// Eigene, großzügige Grenze statt der allgemeinen: eine Seite lädt mehrere Bilder.
// nosniff + CSP verhindern, dass Browser eine Datei als HTML/Skript ausführen.
router.get('/files/:name', fileLimiter, (req, res) => {
  const name = String(req.params.name || '');
  if (!media.verify(name, req.query.exp, req.query.sig)) return res.status(404).end();
  const datei = media.filePath(UPLOAD_DIR, name);
  const restSekunden = Math.max(0, Number(req.query.exp) - Math.floor(Date.now() / 1000));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; sandbox");
  // Nur der Browser darf zwischenspeichern (bis zum Ablauf der Adresse), Cloudflare & Co. nicht
  res.setHeader('Cache-Control', `private, max-age=${restSekunden}, immutable`);
  res.sendFile(datei, { dotfiles: 'deny', cacheControl: false }, (err) => {
    if (err && !res.headersSent) res.status(404).end();
  });
});

module.exports = router;
