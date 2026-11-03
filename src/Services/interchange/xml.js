// Minimal XML reader/writer for the interchange formats (FCPXML, FCP7 XML). Pure JS: runs in the app and in Node tests.

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENT[e] ?? m));
export const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Parse XML text into { name, attrs, children, text } nodes. Returns the root element. */
export function parseXml(src) {
  const root = { name: '#doc', attrs: {}, children: [], text: '' }; const stack = [root];
  let i = 0; const n = src.length;
  while (i < n) {
    const lt = src.indexOf('<', i);
    const textEnd = lt < 0 ? n : lt;
    if (textEnd > i) { const t = src.slice(i, textEnd); stack[stack.length - 1].text += decode(t); }
    if (lt < 0) break;
    if (src.startsWith('<!--', lt)) { const e = src.indexOf('-->', lt); i = e < 0 ? n : e + 3; continue; }
    if (src.startsWith('<![CDATA[', lt)) { const e = src.indexOf(']]>', lt); stack[stack.length - 1].text += src.slice(lt + 9, e < 0 ? n : e); i = e < 0 ? n : e + 3; continue; }
    if (src.startsWith('<?', lt)) { const e = src.indexOf('?>', lt); i = e < 0 ? n : e + 2; continue; }
    if (src.startsWith('<!', lt)) { // DOCTYPE (may contain [ ... ])
      let j = lt + 2, depth = 0; while (j < n && !(src[j] === '>' && depth === 0)) { if (src[j] === '[') depth++; else if (src[j] === ']') depth--; j++; }
      i = j + 1; continue;
    }
    if (src[lt + 1] === '/') { const e = src.indexOf('>', lt); const name = src.slice(lt + 2, e).trim(); while (stack.length > 1) { const top = stack.pop(); if (top.name === name) break; } i = e + 1; continue; }
    // start tag
    let j = lt + 1; while (j < n && !/[\s/>]/.test(src[j])) j++;
    const node = { name: src.slice(lt + 1, j), attrs: {}, children: [], text: '' };
    const re = /\s*([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)')|\s*(\/?)>/y; re.lastIndex = j;
    let selfClose = false;
    for (;;) {
      const m = re.exec(src); if (!m) throw new Error(`XML: malformed tag <${node.name}> at ${lt}`);
      if (m[1]) node.attrs[m[1]] = decode(m[3] ?? m[4] ?? ''); else { selfClose = m[5] === '/'; break; }
    }
    i = re.lastIndex;
    stack[stack.length - 1].children.push(node);
    if (!selfClose) stack.push(node);
  }
  const top = root.children[0]; if (!top) throw new Error('XML: no root element');
  return top;
}
export const kids = (node, name) => (node?.children || []).filter((c) => !name || c.name === name);
export const kid = (node, name) => (node?.children || []).find((c) => c.name === name) || null;
/** Text of a (nested) child path: txt(node, 'rate', 'timebase') */
export const txt = (node, ...path) => { let cur = node; for (const p of path) cur = kid(cur, p); return cur ? cur.text.trim() : ''; };
/** Depth-first search for elements by name. */
export function findAll(node, name, out = []) { for (const c of node?.children || []) { if (c.name === name) out.push(c); findAll(c, name, out); } return out; }

/** Tiny builder: el('name', { attr }, ...children) -> { xml }. String/number children are text (escaped); pretty-printed. */
export function el(name, attrs, ...children) {
  const a = Object.entries(attrs || {}).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => ` ${k}="${esc(v)}"`).join('');
  const list = children.flat(Infinity).filter((c) => c !== undefined && c !== null && c !== false);
  if (!list.length) return { xml: `<${name}${a}/>` };
  if (list.every((c) => typeof c !== 'object')) return { xml: `<${name}${a}>${esc(list.join(''))}</${name}>` };
  const inner = list.map((c) => (typeof c === 'object' ? c.xml : esc(c))).join('\n').split('\n').map((l) => `  ${l}`).join('\n');
  return { xml: `<${name}${a}>\n${inner}\n</${name}>` };
}
