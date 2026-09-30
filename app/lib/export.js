'use strict';
// CSV and Excel (.xlsx) export without any library.
// CSV: UTF-8 with BOM. Romanian: ';' separator and decimal comma (opens correctly in Romanian-locale Excel);
// English: ',' separator and decimal dot (see csvStyle). Formula-injection guard on text cells.
// XLSX: a minimal OOXML workbook written by hand (zip via node:zlib), real numbers, bold frozen header row.
const zlib = require('node:zlib');

/** columns: [{key, header, type?: 'number'|'text', width?}] ; rows: objects */
const RO_CSV = { delimiter: ';', decimal: ',' };
const EN_CSV = { delimiter: ',', decimal: '.' };
/** CSV conventions of a language (what that language's Excel expects). */
const csvStyle = (lang) => (lang === 'en' ? EN_CSV : RO_CSV);

function csvCell(v, type, style) {
  const st = style || RO_CSV;
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'number' || type === 'number') {
    const n = Number(v);
    return Number.isFinite(n) ? (st.decimal === ',' ? String(n).replace('.', ',') : String(n)) : '';
  }
  let s = String(v);
  // spreadsheet formula injection: text starting with = + - @ (or tab / CR) is prefixed with an apostrophe
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  if (s.includes(st.delimiter) || /["\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function toCsv(columns, rows, style) {
  const st = style || RO_CSV;
  const lines = [columns.map((c) => csvCell(c.header, undefined, st)).join(st.delimiter)];
  for (const r of rows) lines.push(columns.map((c) => csvCell(r[c.key], c.type, st)).join(st.delimiter));
  return '﻿' + lines.join('\r\n') + '\r\n';
}

// ---------- xlsx ----------

const xmlEsc = (s) => String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function colName(i) {
  let n = i + 1, s = '';
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

function sheetXml(columns, rows) {
  const widths = columns.map((c) => {
    let w = String(c.header).length;
    for (const r of rows.slice(0, 200)) w = Math.max(w, String(r[c.key] === null || r[c.key] === undefined ? '' : r[c.key]).length);
    return Math.min(60, Math.max(8, w + 2));
  });
  const cell = (ref, v, type, style) => {
    if (v === null || v === undefined || v === '') return '';
    const s = style ? ` s="${style}"` : '';
    if (typeof v === 'number' || type === 'number') {
      const n = Number(v);
      return Number.isFinite(n) ? `<c r="${ref}"${s}><v>${n}</v></c>` : '';
    }
    return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${xmlEsc(v)}</t></is></c>`;
  };
  let xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">';
  xml += '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>';
  xml += '<cols>' + widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('') + '</cols><sheetData>';
  xml += '<row r="1">' + columns.map((c, i) => cell(colName(i) + '1', c.header, 'text', 1)).join('') + '</row>';
  rows.forEach((r, ri) => {
    xml += `<row r="${ri + 2}">` + columns.map((c, ci) => cell(colName(ci) + (ri + 2), r[c.key], c.type, 0)).join('') + '</row>';
  });
  xml += '</sheetData>';
  if (columns.length) xml += `<autoFilter ref="A1:${colName(columns.length - 1)}${rows.length + 1}"/>`;
  return xml + '</worksheet>';
}

const safeSheetName = (n, i) => (String(n).replace(/[\[\]:*?/\\]/g, ' ').trim().slice(0, 31) || `Foaie${i + 1}`);

function crc32(buf) {
  if (zlib.crc32) return zlib.crc32(buf);
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Minimal zip writer (deflate). files: [{name, data: Buffer|string}] */
function zip(files, when) {
  const d = when || new Date();
  const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  const parts = [], central = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const raw = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data, 'utf8');
    const comp = zlib.deflateRawSync(raw);
    const crc = crc32(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8);
    local.writeUInt16LE(dosTime, 10); local.writeUInt16LE(dosDate, 12); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
    parts.push(local, name, comp);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(0x0800, 8); cd.writeUInt16LE(8, 10);
    cd.writeUInt16LE(dosTime, 12); cd.writeUInt16LE(dosDate, 14); cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(comp.length, 20); cd.writeUInt32LE(raw.length, 24);
    cd.writeUInt16LE(name.length, 28); cd.writeUInt32LE(offset, 42);
    central.push(cd, name);
    offset += 30 + name.length + comp.length;
  }
  const cdBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cdBuf.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cdBuf, end]);
}

/** sheets: [{name, columns, rows}] -> Buffer of an .xlsx workbook */
function toXlsx(sheets) {
  const names = sheets.map((s, i) => safeSheetName(s.name, i));
  const files = [
    { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>` },
    { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${xmlEsc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: 'xl/styles.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>' },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s.columns, s.rows) })),
  ];
  return zip(files);
}

/** Read a zip written by zip() (used by the tests to open the workbook again). */
function unzip(buf) {
  const out = {};
  let end = buf.length - 22;
  while (end >= 0 && buf.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error('not a zip');
  const n = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  for (let i = 0; i < n; i++) {
    const method = buf.readUInt16LE(p + 10), crc = buf.readUInt32LE(p + 16), csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    const lnlen = buf.readUInt16LE(off + 26), lxlen = buf.readUInt16LE(off + 28);
    const data = buf.subarray(off + 30 + lnlen + lxlen, off + 30 + lnlen + lxlen + csize);
    const raw = method === 8 ? zlib.inflateRawSync(data) : data;
    if (crc32(raw) !== crc) throw new Error('crc mismatch ' + name);
    out[name] = raw;
    p += 46 + nlen + xlen + clen;
  }
  return out;
}

module.exports = { toCsv, toXlsx, csvCell, csvStyle, zip, unzip, colName };
