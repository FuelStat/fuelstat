// Bild-Uploads: Speicherort, Typprüfung am Inhalt, Fehlerbehandlung von multer.
// Aus backend/src/server.js ausgelagert (#110), Inhalt unverändert.
const fs = require('fs');
const multer = require('multer');
const path = require('path');
const { randomUUID } = require('crypto');
const media = require('../services/media');
const { UPLOAD_DIR } = require('../config');

// Upload-Verzeichnis erstellen falls nicht vorhanden
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  // Nie den Dateinamen des Uploaders übernehmen: Endung wird erst nach Prüfung des Inhalts vergeben
  filename: (req, file, cb) => {
    cb(null, `${randomUUID()}.upload`);
  }
});

// Bildtyp anhand des Dateiinhalts (Magic Bytes) bestimmen – der vom Client gesendete Typ ist nicht vertrauenswürdig
function detectImageType(buf) {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: '.jpg', mime: 'image/jpeg' };
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: '.png', mime: 'image/png' };
  if (buf.length >= 6 && ['GIF87a', 'GIF89a'].includes(buf.subarray(0, 6).toString('ascii'))) return { ext: '.gif', mime: 'image/gif' };
  if (buf.length >= 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return { ext: '.webp', mime: 'image/webp' };
  return null;
}

// Pfad einer hochgeladenen Datei immer selbst aus UPLOAD_DIR und dem von uns vergebenen Namen bilden
// (UUID + Endung, siehe storage oben), nie aus Angaben der Anfrage. Unerwartete Namen ergeben null.
function uploadPath(filename) {
  const name = path.basename(String(filename || ''));
  return /^[0-9a-f-]{36}\.(upload|jpg|png|gif|webp)$/.test(name) ? path.join(UPLOAD_DIR, name) : null;
}

// Datei zu einer gespeicherten Bild-URL (aus der Datenbank): nur der Dateiname zählt, nur einfache Namen
function storedMediaPath(url) {
  const name = path.basename(String(url || ''));
  return /^[\w-]+\.[a-z]{3,4}$/i.test(name) ? path.join(UPLOAD_DIR, name) : null;
}

function removeUpload(file) {
  const p = file && uploadPath(file.filename);
  return p ? fs.promises.unlink(p).catch(() => {}) : Promise.resolve();
}

// Nach multer: nur echte Bilder behalten und mit passender Endung speichern
async function verifyUploadedImage(req, res, next) {
  if (!req.file) return next();
  const source = uploadPath(req.file.filename);
  if (!source) return res.status(400).json({ error: 'invalid_image' });
  try {
    const fd = await fs.promises.open(source, 'r');
    const { buffer, bytesRead } = await fd.read(Buffer.alloc(16), 0, 16, 0);
    await fd.close();
    const type = detectImageType(buffer.subarray(0, bytesRead));
    if (!type) {
      await fs.promises.unlink(source).catch(() => {});
      return res.status(400).json({ error: 'invalid_image' });
    }
    // Verkleinern, nach EXIF drehen, als WebP ohne Metadaten (GPS) speichern; das Original wird nicht behalten (#103)
    const filename = path.basename(source).replace(/\.upload$/, '.webp');
    const target = path.join(UPLOAD_DIR, filename);
    let info;
    try {
      info = await media.optimizeImage(source, target, req.mediaArt || 'vehicle');
    } catch (e) {
      await fs.promises.unlink(target).catch(() => {});
      await fs.promises.unlink(source).catch(() => {});
      return res.status(400).json({ error: 'invalid_image' });
    }
    await fs.promises.unlink(source).catch(() => {});
    Object.assign(req.file, { filename, path: target, mimetype: 'image/webp', size: info.bytes });
    return next();
  } catch (e) {
    await fs.promises.unlink(source).catch(() => {});
    return res.status(500).json({ error: 'server_error' });
  }
}

const upload = multer({
  storage,
  limits: {
    fileSize: 20 * 1024 * 1024 // 20 MB
  },
  fileFilter: (req, file, cb) => {
    const allowedMimes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Nur JPEG, PNG, GIF und WebP Bilder sind erlaubt.'), false);
    }
  }
});

// Error Handler für multer (in app.js nach den Routen eingehängt)
function uploadErrorHandler(error, req, res, next) {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'file_too_large', message: 'Datei ist zu groß (max. 20 MB)' });
    }
    return res.status(400).json({ error: 'upload_error', detail: error.message });
  }
  if (error) {
    return res.status(400).json({ error: 'upload_error', detail: error.message });
  }
  next();
}

module.exports = { detectImageType, removeUpload, storage, storedMediaPath, upload, uploadErrorHandler, uploadPath, verifyUploadedImage };
