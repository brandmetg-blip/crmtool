// brandsettings.js — Settings → Brands. A wall of brands; open one to see and
// add the products promoted for it.

import { state, forceEmit, uid, byId } from '../state.js';
import { el } from '../ui.js';
import { brands, saveBrands, brandById, productsOf, looseProducts, brandArt, brandOf } from '../brands.js';
import { openProductEditor } from './accounts.js';

const pagesOn = p => state.db.accounts.filter(a => a.productId === p.id).length;
const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');

export function brandsPanel() {
  const open = state.settingsBrand && brandById(state.settingsBrand);
  return open ? brandDetail(open) : brandWall();
}

// ---------------------------------------------------------------------------
function brandWall() {
  const wrap = el('div', { class: 'col', style: 'gap:22px' });

  const grid = el('div', { class: 'brand-grid' });
  brands().forEach(b => {
    const list = productsOf(b.id);
    const pages = list.reduce((n, p) => n + pagesOn(p), 0);
    grid.appendChild(el('button', {
      class: 'brand-tile', type: 'button', onclick: () => { state.settingsBrand = b.id; forceEmit(); }
    },
      el('span', { class: 'brand-art' }, brandArt(b)),
      el('span', { class: 'brand-meta' },
        el('b', null, b.name || 'Untitled'),
        el('span', null, plural(list.length, 'product') + ' · ' + plural(pages, 'page')))));
  });
  grid.appendChild(el('button', {
    class: 'brand-tile add', type: 'button', onclick: async () => {
      const name = prompt('Name of the new brand:');
      if (!name || !name.trim()) return;
      const b = { id: uid('b'), name: name.trim(), logoUrl: '', coverUrl: '' };
      await saveBrands(brands().concat([b]));
      state.settingsBrand = b.id;
      forceEmit();
    }
  }, el('span', { class: 'plus' }, '+'), 'Add brand'));
  wrap.appendChild(grid);

  const loose = looseProducts();
  if (loose.length) {
    wrap.appendChild(el('div', { class: 'col', style: 'gap:10px' },
      el('div', null,
        el('b', { style: 'font-size:14px' }, 'Products without a brand'),
        el('div', { class: 'hint' }, 'Pick a brand for each one so it shows up when you mass add.')),
      el('div', { class: 'col', style: 'gap:7px' }, loose.map(p => el('div', { class: 'card row wrap', style: 'padding:9px 12px;gap:10px' },
        el('b', { style: 'font-size:13px;flex:1;min-width:140px' }, p.name || 'Untitled'),
        el('span', { class: 'hint' }, plural(pagesOn(p), 'page')),
        brandPicker(p),
        el('button', { class: 'btn small', onclick: () => openProductEditor(p) }, 'Edit'))))));
  }
  return wrap;
}

function brandPicker(p) {
  const sel = el('select', {
    class: 'input', style: 'width:auto;min-width:170px;height:32px', onchange: async e => {
      const { mutate } = await import('../app.js');
      mutate('products', p.id, x => x.brandId = e.target.value);
    }
  }, [el('option', { value: '' }, 'Choose brand…')].concat(brands().map(b => el('option', { value: b.id }, b.name))));
  sel.value = p.brandId || '';
  return sel;
}

// ---------------------------------------------------------------------------
function brandDetail(b) {
  const update = async fn => {
    await saveBrands(brands().map(x => x.id === b.id ? fn({ ...x }) : x));
    forceEmit();
  };
  const upload = (label, key) => {
    const input = el('input', {
      type: 'file', accept: 'image/*', style: 'display:none', onchange: async e => {
        const file = e.target.files && e.target.files[0]; if (!file) return;
        try {
          const { store } = await import('../app.js');
          const url = await store.uploadImage(file);
          await update(x => { x[key] = url; if (key === 'coverUrl') delete x.coverFit; return x; });
        } catch (err) { alert('Image upload failed — try again.\n' + (err.message || '')); }
      }
    });
    return el('label', { class: 'btn small', style: 'cursor:pointer' }, label, input);
  };

  const wrap = el('div', { class: 'col', style: 'gap:18px' });
  wrap.appendChild(el('div', { class: 'brand-hero' },
    el('span', { class: 'brand-art' }, brandArt(b)),
    el('button', { class: 'btn small brand-back', onclick: () => { state.settingsBrand = null; forceEmit(); } }, '‹ All brands')));

  wrap.appendChild(el('div', { class: 'row wrap', style: 'gap:9px' },
    el('input', {
      class: 'input', style: 'flex:1;min-width:200px;font-weight:700', value: b.name, placeholder: 'Brand name',
      onchange: e => update(x => { x.name = e.target.value.trim() || x.name; return x; }),
    }),
    upload('Change logo', 'logoUrl'),
    upload('Change picture', 'coverUrl'),
    el('button', {
      class: 'btn small danger', onclick: async () => {
        const list = productsOf(b.id);
        if (!confirm('Delete the brand “' + b.name + '”?' + (list.length ? '\n\nIts ' + plural(list.length, 'product') + ' stay, with no brand set.' : ''))) return;
        const { save } = await import('../app.js');
        list.forEach(p => { p.brandId = ''; save('products', p); });
        state.settingsBrand = null;
        await saveBrands(brands().filter(x => x.id !== b.id));
        forceEmit();
      }
    }, 'Delete brand')));

  const list = productsOf(b.id);
  wrap.appendChild(el('div', null,
    el('b', { style: 'font-size:15px' }, 'Products'),
    el('div', { class: 'hint' }, list.length
      ? 'What we promote for ' + b.name + '. Open one for its photo, concepts and captions.'
      : 'Add what we promote for ' + b.name + '. Pages then pick one of these, and mass add can target it.')));

  const grid = el('div', { class: 'product-grid' });
  list.forEach(p => grid.appendChild(el('button', {
    class: 'product-tile', type: 'button', onclick: () => openProductEditor(p)
  },
    el('span', { class: 'product-pic' }, p.imageUrl
      ? el('img', { src: p.imageUrl, alt: '', loading: 'lazy' })
      : (b.logoUrl ? el('img', { class: 'fallback', src: b.logoUrl, alt: '', loading: 'lazy' }) : null)),
    el('b', null, p.name || 'Untitled'),
    el('span', { class: 'hint' }, plural(pagesOn(p), 'page')))));
  grid.appendChild(el('button', {
    class: 'product-tile add', type: 'button', onclick: async () => {
      const name = prompt('Name of the new ' + b.name + ' product:');
      if (!name || !name.trim()) return;
      const { save } = await import('../app.js');
      const p = { id: uid('pr'), name: name.trim(), brandId: b.id, createdAt: Date.now() };
      save('products', p);
      openProductEditor(byId(state.db.products, p.id));
    }
  }, el('span', { class: 'plus' }, '+'), 'Add product'));
  wrap.appendChild(grid);

  const loose = looseProducts();
  if (loose.length) {
    wrap.appendChild(el('div', { class: 'row wrap', style: 'gap:9px' },
      el('span', { class: 'hint' }, 'Or move an existing product here:'),
      el('select', {
        class: 'input', style: 'width:auto;min-width:200px;height:32px', onchange: async e => {
          if (!e.target.value) return;
          const { mutate } = await import('../app.js');
          mutate('products', e.target.value, x => x.brandId = b.id);
        }
      }, [el('option', { value: '' }, 'Choose a product…')].concat(loose.map(p => el('option', { value: p.id }, p.name))))));
  }
  return wrap;
}

export { brandOf };
