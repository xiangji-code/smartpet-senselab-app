import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const [inputPath, outputPath] = process.argv.slice(2);

if (!inputPath || !outputPath) {
  throw new Error('Usage: node export-markdown-pdf.mjs <input.md> <output.html>');
}

const markdown = await readFile(resolve(inputPath), 'utf8');
const html = markdownToHtml(markdown);
await writeFile(resolve(outputPath), documentHtml(html), 'utf8');

function markdownToHtml(source) {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const output = [];
  let paragraph = [];
  let code = [];
  let inCode = false;
  let list = null;
  let table = [];

  const flushParagraph = () => {
    if (paragraph.length) output.push(`<p>${inline(paragraph.join(' '))}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    output.push(`<${list.type}>${list.items.map((item) => `<li>${inline(item)}</li>`).join('')}</${list.type}>`);
    list = null;
  };
  const flushTable = () => {
    if (!table.length) return;
    const [header, divider, ...rows] = table;
    if (!divider?.includes('---')) {
      output.push(...table.map((row) => `<p>${inline(row)}</p>`));
    } else {
      const cells = (line) => line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => inline(cell.trim()));
      output.push(`<table><thead><tr>${cells(header).map((cell) => `<th>${cell}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${cells(row).map((cell) => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
    }
    table = [];
  };
  const flushAll = () => {
    flushParagraph();
    flushList();
    flushTable();
  };

  for (const line of lines) {
    if (line.startsWith('```')) {
      if (inCode) {
        output.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
        code = [];
      } else {
        flushAll();
      }
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      code.push(line);
      continue;
    }
    if (line.includes('|') && line.trim().startsWith('|')) {
      flushParagraph();
      flushList();
      table.push(line);
      continue;
    }
    if (table.length) flushTable();
    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      flushAll();
      output.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`);
      continue;
    }
    const bullet = line.match(/^[-*]\s+(.+)$/);
    const ordered = line.match(/^\d+\.\s+(.+)$/);
    if (bullet || ordered) {
      flushParagraph();
      const type = ordered ? 'ol' : 'ul';
      if (list?.type !== type) flushList();
      list ??= { type, items: [] };
      list.items.push((bullet ?? ordered)[1]);
      continue;
    }
    if (line.startsWith('> ')) {
      flushAll();
      output.push(`<blockquote>${inline(line.slice(2))}</blockquote>`);
      continue;
    }
    paragraph.push(line.trim());
  }
  flushAll();
  return output.join('\n');
}

function inline(value) {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

function escapeHtml(value) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function documentHtml(content) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>SmartPet BLE GATT 与数据传输协议 V1 草案</title>
<style>
  @page { size: A4; margin: 18mm 15mm; }
  * { box-sizing: border-box; }
  body { color: #17201d; font-family: "Microsoft YaHei", "Noto Sans CJK SC", Arial, sans-serif; font-size: 10pt; line-height: 1.55; }
  h1 { color: #0c6f55; font-size: 22pt; margin: 0 0 16pt; }
  h2 { color: #0c6f55; font-size: 15pt; border-bottom: 1px solid #b9d8ce; margin: 22pt 0 10pt; padding-bottom: 5pt; break-after: avoid; }
  h3 { color: #155f4d; font-size: 12pt; margin: 16pt 0 7pt; break-after: avoid; }
  h4 { font-size: 10.5pt; margin: 13pt 0 6pt; break-after: avoid; }
  p { margin: 0 0 8pt; }
  ul, ol { margin: 0 0 8pt; padding-left: 20pt; }
  li { margin: 2pt 0; }
  code { background: #edf5f2; border-radius: 2px; color: #075b45; font-family: Consolas, monospace; font-size: 9pt; padding: 1px 3px; }
  pre { background: #f2f6f4; border-left: 3px solid #2c9b78; font-family: Consolas, monospace; font-size: 8.5pt; line-height: 1.4; margin: 8pt 0 10pt; overflow-wrap: anywhere; padding: 8pt; white-space: pre-wrap; }
  pre code { background: transparent; color: #17201d; padding: 0; }
  table { border-collapse: collapse; font-size: 8.5pt; margin: 8pt 0 12pt; width: 100%; }
  thead { background: #ddf0e9; }
  th, td { border: 1px solid #b9d8ce; padding: 5pt; text-align: left; vertical-align: top; }
  th { color: #0a5f49; font-weight: 700; }
  tr { break-inside: avoid; }
  blockquote { background: #f2f6f4; border-left: 3px solid #2c9b78; margin: 8pt 0; padding: 8pt 10pt; }
  strong { color: #0a5f49; }
</style>
</head>
<body>${content}</body>
</html>`;
}
