'use strict';

// CSV export that opens correctly in Excel (UTF-8 BOM, CRLF) in every language.

function csvCell(value) {
  let s = value == null ? '' : String(value);
  // Spreadsheet formula injection: neutralise cells that start like a formula
  // (phone numbers such as +2010… are left alone).
  if (/^[=@]/.test(s) || /^[+-][^\d\s]/.test(s)) s = `'${s}`;
  return /[",\r\n;]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(header, rows) {
  return `\uFEFF${[header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

module.exports = { toCsv, csvCell };
