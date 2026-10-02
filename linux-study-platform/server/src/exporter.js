'use strict';
/**
 * 打卡记录导出 · 三种格式，全部零第三方依赖
 * ─────────────────────────────────────────────────────────────────────
 *   csv   UTF-8 BOM + 逗号分隔（Excel / WPS / Numbers 打开均不乱码）
 *   xlsx  真正的 OOXML 工作簿：用 zlib 手工打包 ZIP，单元格用 inlineStr
 *   pdf   手工构造 PDF，中文使用 CID 字体 STSong-Light（无需嵌入字体文件）
 *
 * 三种格式内容一致：序号 / 打卡日期 / 学习内容 / 章节路径 / 难度 / 状态 / 记录时间
 */
const zlib = require('zlib');

const DIFF_CN = ['', '入门', '基础', '进阶', '高级'];
const STATUS_CN = { done: '已完成', revoked: '已撤销打卡' };

function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/* ═══════════════════════ 1. CSV ═══════════════════════ */

function toCsv(rows, meta) {
  const head = ['序号', '打卡日期', '学习内容', '章节路径', '难度', '状态', '记录时间'];
  const lines = [];
  if (meta && meta.title) lines.push(csvCell(meta.title));
  if (meta && meta.subtitle) lines.push(csvCell(meta.subtitle));
  if (lines.length) lines.push('');
  lines.push(head.map(csvCell).join(','));
  rows.forEach((r, i) => {
    lines.push([i + 1, r.date, r.title, r.path, r.difficulty, r.statusText, r.at]
      .map(csvCell).join(','));
  });
  const body = '\uFEFF' + lines.join('\r\n') + '\r\n';
  return Buffer.from(body, 'utf8');
}

/* ═══════════════════════ 2. XLSX ═══════════════════════ */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ CRC_TABLE[(c ^ buf[i]) & 0xFF];
  return (c ^ -1) >>> 0;
}

/** 极简 ZIP 打包器（deflate 压缩 + UTF-8 文件名） */
function zip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;

  files.forEach((f) => {
    const nameBuf = Buffer.from(f.name, 'utf8');
    const crc = crc32(f.data);
    const comp = zlib.deflateRawSync(f.data);
    const useDeflate = comp.length < f.data.length;
    const data = useDeflate ? comp : f.data;
    const method = useDeflate ? 8 : 0;

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0x0800, 6);        // 文件名用 UTF-8
    lh.writeUInt16LE(method, 8);
    lh.writeUInt16LE(0, 10);            // 时间
    lh.writeUInt16LE(0x21, 12);         // 日期 1980-01-01
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(data.length, 18);
    lh.writeUInt32LE(f.data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28);

    locals.push(lh, nameBuf, data);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt16LE(method, 10);
    ch.writeUInt16LE(0, 12);
    ch.writeUInt16LE(0x21, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(data.length, 20);
    ch.writeUInt32LE(f.data.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt16LE(0, 30);
    ch.writeUInt16LE(0, 32);
    ch.writeUInt16LE(0, 34);
    ch.writeUInt16LE(0, 36);
    ch.writeUInt32LE(0, 38);
    ch.writeUInt32LE(offset, 42);
    centrals.push(ch, nameBuf);

    offset += lh.length + nameBuf.length + data.length;
  });

  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([Buffer.concat(locals), centralBuf, eocd]);
}

function xmlEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
}

function colName(n) {
  let s = '';
  n += 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function toXlsx(rows, meta) {
  const head = ['序号', '打卡日期', '学习内容', '章节路径', '难度', '状态', '记录时间'];
  const sheet = [];
  let r = 0;

  function pushRow(cells, opts) {
    const o = opts || {};
    const cs = cells.map((v, ci) => {
      const ref = colName(ci) + (r + 1);
      if (v == null || v === '') return '';
      if (o.header) {
        return '<c r="' + ref + '" s="1" t="inlineStr"><is><t>' + xmlEsc(v) + '</t></is></c>';
      }
      if (typeof v === 'number') return '<c r="' + ref + '" s="2"><v>' + v + '</v></c>';
      return '<c r="' + ref + '" s="3" t="inlineStr"><is><t xml:space="preserve">' + xmlEsc(v) + '</t></is></c>';
    }).join('');
    sheet.push('<row r="' + (r + 1) + '">' + cs + '</row>');
    r++;
  }

  if (meta && meta.title) pushRow([meta.title]);
  if (meta && meta.subtitle) pushRow([meta.subtitle]);
  if (meta && meta.title) pushRow([]);
  pushRow(head, { header: true });
  rows.forEach((x, i) => {
    pushRow([i + 1, x.date, x.title, x.path, x.difficulty, x.statusText, x.at]);
  });

  const sheetXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<sheetPr><outlinePr/></sheetPr>' +
    '<cols>' +
    '<col min="1" max="1" width="6" customWidth="1"/>' +
    '<col min="2" max="2" width="13" customWidth="1"/>' +
    '<col min="3" max="3" width="34" customWidth="1"/>' +
    '<col min="4" max="4" width="42" customWidth="1"/>' +
    '<col min="5" max="5" width="9" customWidth="1"/>' +
    '<col min="6" max="6" width="15" customWidth="1"/>' +
    '<col min="7" max="7" width="20" customWidth="1"/>' +
    '</cols>' +
    '<sheetData>' + sheet.join('') + '</sheetData></worksheet>';

  const stylesXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<fonts count="3">' +
    '<font><sz val="11"/><name val="\u5b8b\u4f53"/></font>' +
    '<font><b/><sz val="11"/><name val="\u5b8b\u4f53"/></font>' +
    '<font><sz val="11"/><name val="\u5b8b\u4f53"/></font>' +
    '</fonts>' +
    '<fills count="3">' +
    '<fill><patternFill patternType="none"/></fill>' +
    '<fill><patternFill patternType="gray125"/></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FFEDF3FA"/><bgColor indexed="64"/></patternFill></fill>' +
    '</fills>' +
    '<borders count="2">' +
    '<border><left/><right/><top/><bottom/><diagonal/></border>' +
    '<border><left style="thin"><color rgb="FFB9C7DA"/></left><right style="thin"><color rgb="FFB9C7DA"/></right>' +
    '<top style="thin"><color rgb="FFB9C7DA"/></top><bottom style="thin"><color rgb="FFB9C7DA"/></bottom><diagonal/></border>' +
    '</borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="4">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' +
    '<xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' +
    '<xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>' +
    '</cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>';

  const workbookXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"' +
    ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<sheets><sheet name="打卡记录" sheetId="1" r:id="rId1"/></sheets></workbook>';

  const wbRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    '</Relationships>';

  const rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '</Relationships>';

  const contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    '</Types>';

  return zip([
    { name: '[Content_Types].xml', data: Buffer.from(contentTypes, 'utf8') },
    { name: '_rels/.rels', data: Buffer.from(rels, 'utf8') },
    { name: 'xl/workbook.xml', data: Buffer.from(workbookXml, 'utf8') },
    { name: 'xl/_rels/workbook.xml.rels', data: Buffer.from(wbRels, 'utf8') },
    { name: 'xl/styles.xml', data: Buffer.from(stylesXml, 'utf8') },
    { name: 'xl/worksheets/sheet1.xml', data: Buffer.from(sheetXml, 'utf8') },
  ]);
}

/* ═══════════════════════ 3. PDF ═══════════════════════ */

/** 估算字符串在给定字号下的显示宽度（中文按 1 字宽，西文按 0.52 字宽） */
function textWidth(s, size) {
  let w = 0;
  for (const ch of String(s)) {
    if (/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(ch)) w += size;
    else if (ch === ' ') w += size * 0.28;
    else w += size * 0.52;
  }
  return w;
}

/** 按可用宽度人工折行 */
function wrap(text, size, maxWidth) {
  const s = String(text == null ? '' : text);
  if (!s) return [''];
  const out = [];
  let line = '';
  for (const ch of s) {
    if (textWidth(line + ch, size) > maxWidth && line) {
      out.push(line);
      line = ch;
    } else {
      line += ch;
    }
  }
  if (line) out.push(line);
  return out;
}

/** UTF-16BE 十六进制串（PDF CID 字体的中文写法） */
function hexText(s) {
  const b = Buffer.from(String(s), 'utf16le');
  // 转成大端
  for (let i = 0; i < b.length; i += 2) { const t = b[i]; b[i] = b[i + 1]; b[i + 1] = t; }
  return '<' + b.toString('hex').toUpperCase() + '>';
}

function pdfEsc(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function toPdf(rows, meta) {
  const PW = 595, PH = 842;          // A4
  const ML = 46, MR = 46, MT = 52, MB = 48;
  const usable = PW - ML - MR;
  const SZ = 10.5, LH = 17;

  const title = (meta && meta.title) || '打卡记录';
  const subtitle = (meta && meta.subtitle) || '';
  const head = ['序号', '打卡日期', '学习内容', '章节路径', '难度', '状态'];
  const colW = [34, 74, 150, 175, 40, 122];   // 合计 595
  const colX = [];
  let acc = ML;
  colW.forEach((w) => { colX.push(acc); acc += w; });

  /* 逐页生成内容流 */
  const pages = [];
  let ops = [];
  let y = 0;

  function newPage() {
    ops = [];
    y = PH - MT;
    // 页眉标题
    ops.push('BT /F2 ' + (SZ + 4) + ' Tf ' + ML + ' ' + y + ' Td ' + hexText(title) + ' Tj ET');
    y -= 20;
    if (subtitle) {
      ops.push('BT /F1 ' + (SZ - 1.5) + ' Tf 0.35 0.4 0.48 rg ' + ML + ' ' + y + ' Td ' +
        hexText(subtitle) + ' Tj ET 0 0 0 rg');
      y -= 16;
    }
    // 表头
    ops.push('0.92 0.95 0.98 rg ' + ML + ' ' + (y - 5) + ' ' + usable + ' 20 re f 0 0 0 rg');
    head.forEach((h, i) => {
      ops.push('BT /F2 ' + SZ + ' Tf ' + (colX[i] + 4) + ' ' + y + ' Td ' + hexText(h) + ' Tj ET');
    });
    y -= 24;
    ops.push('0.72 0.78 0.85 RG 0.6 w ' + ML + ' ' + (y + 12) + ' m ' + (PW - MR) + ' ' + (y + 12) + ' l S');
    pages.push(ops);
  }
  newPage();

  rows.forEach((r, idx) => {
    const cells = [
      String(idx + 1),
      String(r.date || ''),
      String(r.title || ''),
      String(r.path || ''),
      String(r.difficulty || ''),
      String(r.statusText || ''),
    ];
    // 每个单元格折行，行高取最大行数
    const wrapped = cells.map((c, i) => wrap(c, SZ, colW[i] - 8));
    const lines = Math.max.apply(null, wrapped.map((w) => w.length));

    if (y - lines * LH < MB) newPage();

    for (let li = 0; li < lines; li++) {
      for (let ci = 0; ci < cells.length; ci++) {
        const t = wrapped[ci][li];
        if (!t) continue;
        ops.push('BT /F1 ' + SZ + ' Tf ' + (colX[ci] + 4) + ' ' + y + ' Td ' + hexText(t) + ' Tj ET');
      }
      y -= LH;
    }
    y -= 2;
    ops.push('0.85 0.88 0.92 RG 0.4 w ' + ML + ' ' + (y + 11) + ' m ' + (PW - MR) + ' ' + (y + 11) + ' l S');
  });

  // 页脚页码
  pages.forEach((p, i) => {
    p.push('BT /F1 8.5 Tf 0.45 0.5 0.58 rg ' + ML + ' 30 Td ' +
      hexText('第 ' + (i + 1) + ' / ' + pages.length + ' 页　·　共 ' + rows.length + ' 条记录') +
      ' Tj ET 0 0 0 rg');
  });

  /* 组装 PDF 对象 */
  const objects = [];
  const pageObjIds = pages.map((_, i) => 6 + i * 2);

  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = '<< /Type /Pages /Kids [' + pageObjIds.map((id) => id + ' 0 R').join(' ') +
    '] /Count ' + pages.length + ' >>';
  objects[3] = '<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light' +
    ' /Encoding /UniGB-UCS2-H /DescendantFonts [4 0 R] >>';
  objects[4] = '<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light' +
    ' /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 2 >>' +
    ' /FontDescriptor 5 0 R /DW 1000 >>';
  objects[5] = '<< /Type /FontDescriptor /FontName /STSong-Light /Flags 4' +
    ' /FontBBox [-25 -254 1000 880] /ItalicAngle 0 /Ascent 880 /Descent -120' +
    ' /CapHeight 880 /StemV 93 >>';

  pages.forEach((p, i) => {
    const pid = pageObjIds[i];
    const cid = pid + 1;
    const stream = p.join('\n');
    objects[pid] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + PW + ' ' + PH + ']' +
      ' /Resources << /Font << /F1 3 0 R /F2 3 0 R >> >> /Contents ' + cid + ' 0 R >>';
    objects[cid] = { stream: Buffer.from(stream, 'latin1') };
  });

  // 序列化
  const parts = [];
  const offsets = [];
  let pos = 0;
  const header = Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'latin1');
  parts.push(header); pos += header.length;

  const maxId = Math.max.apply(null, Object.keys(objects).map(Number));
  const xref = new Array(maxId + 1).fill(0);

  for (let id = 1; id <= maxId; id++) {
    const obj = objects[id];
    if (!obj) continue;
    xref[id] = pos;
    let chunk;
    if (typeof obj === 'string') {
      chunk = Buffer.from(id + ' 0 obj\n' + obj + '\nendobj\n', 'latin1');
    } else {
      const head2 = Buffer.from(id + ' 0 obj\n<< /Length ' + obj.stream.length + ' >>\nstream\n', 'latin1');
      const tail = Buffer.from('\nendstream\nendobj\n', 'latin1');
      chunk = Buffer.concat([head2, obj.stream, tail]);
    }
    parts.push(chunk); pos += chunk.length;
  }

  const xrefPos = pos;
  let xrefStr = 'xref\n0 ' + (maxId + 1) + '\n0000000000 65535 f \n';
  for (let id = 1; id <= maxId; id++) {
    xrefStr += String(xref[id]).padStart(10, '0') + ' 00000 n \n';
  }
  xrefStr += 'trailer\n<< /Size ' + (maxId + 1) + ' /Root 1 0 R >>\nstartxref\n' + xrefPos + '\n%%EOF\n';
  parts.push(Buffer.from(xrefStr, 'latin1'));

  return Buffer.concat(parts);
}

/* ═══════════════════════ 统一入口 ═══════════════════════ */

const FORMATS = {
  csv: { mime: 'text/csv; charset=utf-8', ext: 'csv', label: 'CSV' },
  xlsx: { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext: 'xlsx', label: 'Excel' },
  pdf: { mime: 'application/pdf', ext: 'pdf', label: 'PDF' },
};

/**
 * 生成导出文件
 * @param {'csv'|'xlsx'|'pdf'} format
 * @param {Array} rows [{date,title,path,difficulty,statusText,at}]
 * @param {object} meta { title, subtitle, filename }
 * @returns {{buffer:Buffer, mime:string, filename:string}}
 */
function build(format, rows, meta) {
  const f = String(format || 'csv').toLowerCase();
  const spec = FORMATS[f];
  if (!spec) {
    const e = new Error('不支持的导出格式：' + format + '（可选 csv / xlsx / pdf）');
    e.status = 400; e.code = 'BAD_FORMAT';
    throw e;
  }
  const buffer = f === 'csv' ? toCsv(rows, meta)
    : f === 'xlsx' ? toXlsx(rows, meta)
      : toPdf(rows, meta);
  const base = (meta && meta.filename) || ('打卡记录-' + new Date().toISOString().slice(0, 10));
  return {
    buffer,
    mime: spec.mime,
    filename: base + '.' + spec.ext,
    format: f,
    label: spec.label,
  };
}

module.exports = { build, FORMATS, toCsv, toXlsx, toPdf };
