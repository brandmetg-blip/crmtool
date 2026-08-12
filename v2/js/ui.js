// ============================================================================
// ui.js — tiny DOM helpers. el(tag, attrs, ...children) builds elements;
// no virtual DOM, no framework, nothing to fight with.
// ============================================================================

export function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') node[k.toLowerCase()] = v;
    else if (k === 'class') node.className = v;
    else if (k === 'style') node.style.cssText = v;
    else if (k === 'value') node.value = v;
    else if (k === 'checked') node.checked = !!v;
    else if (k === 'html') node.innerHTML = v; // trusted, app-authored markup only (icons)
    else node.setAttribute(k, v === true ? '' : v);
  }
  const add = c => {
    if (c == null || c === false) return;
    if (Array.isArray(c)) { c.forEach(add); return; }
    node.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  };
  children.forEach(add);
  return node;
}

// Transient "Copied ✓" feedback on a button, then restore.
export function copyText(text, btn) {
  const done = () => {
    if (!btn) return;
    const old = btn.textContent; btn.textContent = 'Copied ✓'; btn.classList.add('ok');
    setTimeout(() => { btn.textContent = old; btn.classList.remove('ok'); }, 1400);
  };
  const t = (text || '').trim();
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(done).catch(() => { legacyCopy(t); done(); });
  else { legacyCopy(t); done(); }
}
function legacyCopy(text) {
  try {
    const ta = document.createElement('textarea'); ta.value = text; ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta); ta.focus(); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
  } catch (e) {}
}

export function initial(name) { return (name || '?').trim().charAt(0).toUpperCase() || '?'; }

// Deterministic accent color per name (avatars without images).
const PALETTE = ['#34e08a', '#5b8def', '#9a7bff', '#f0b341', '#e879b9', '#5bd5ef', '#f97b5a', '#6ee7b7'];
export function nameColor(name) {
  let h = 0; for (const ch of (name || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export function avatar(item, size) {
  const s = size || 36;
  if (item && item.avatarUrl) {
    return el('span', { class: 'avatar', style: `width:${s}px;height:${s}px;background-image:url(${JSON.stringify(item.avatarUrl)});` });
  }
  const name = (item && item.name) || '?';
  const c = nameColor(name);
  return el('span', { class: 'avatar', style: `width:${s}px;height:${s}px;background:${c}22;border-color:${c}55;color:${c};font-size:${Math.round(s * 0.42)}px` }, initial(name));
}
