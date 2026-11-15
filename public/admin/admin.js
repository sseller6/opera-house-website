/* Kooskia Opera House — Box Office admin app */
(function () {
  'use strict';

  const app = document.getElementById('app');
  let config = null;
  let shows = [];
  let dirty = false;

  const DEFAULT_NOTES = 'Bring your email receipt for admission.\nAll sales are final. No refunds.\nFor specific seating, call (208) 451-5152.';

  // ---------- helpers ----------
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (c) => '$' + (c / 100).toFixed(2).replace(/\.00$/, '');
  const money2 = (c) => '$' + (c / 100).toFixed(2);
  const parseDate = (ymd) => { const [y, m, d] = ymd.split('-').map(Number); return new Date(y, m - 1, d); };
  const fmtDate = (ymd, o = { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) => parseDate(ymd).toLocaleDateString('en-US', o);
  const fmtTime = (t) => { if (!t) return ''; const [h, m] = t.split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
  const fmtRange = (p) => p.end_time ? `${fmtTime(p.start_time)} – ${fmtTime(p.end_time)}` : fmtTime(p.start_time);
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  async function api(path, opts = {}) {
    const res = await fetch(path, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, ...opts });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && !path.endsWith('/login')) { renderLogin(); throw new Error('Please sign in.'); }
    if (!res.ok) { const e = new Error(data.error || 'Something went wrong.'); e.status = res.status; throw e; }
    return data;
  }

  let toastTimer;
  function toast(msg, isError = false) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className = 'show' + (isError ? ' error' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.className = ''; }, isError ? 6000 : 3500);
  }

  window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

  function topbar() {
    return `<header class="topbar"><div class="in">
      <a href="#/" style="display:flex;align-items:center;gap:12px;padding:0">
        <img src="/images/logo.jpg" alt="">
        <span class="title">Kooskia Opera House<small>Box Office</small></span>
      </a>
      <span class="spacer"></span>
      <a href="/" target="_blank" rel="noopener">View website ↗</a>
      <button class="link" id="logout">Sign out</button>
    </div></header>`;
  }
  function bindTopbar() {
    $('#logout').addEventListener('click', async () => {
      await fetch('/api/admin/logout', { method: 'POST' });
      dirty = false;
      renderLogin();
    });
  }

  // ---------- routing ----------
  async function route() {
    if (!config) return;
    const h = location.hash || '#/';
    let m;
    window.scrollTo(0, 0);
    try {
      if ((m = h.match(/^#\/show\/(new|\d+)$/))) return await renderEditor(m[1] === 'new' ? null : Number(m[1]));
      if ((m = h.match(/^#\/guests\/(\d+)$/))) return await renderGuests(Number(m[1]));
      return await renderDashboard();
    } catch (e) {
      if (e.message !== 'Please sign in.') toast(e.message, true);
    }
  }
  let lastHash = location.hash || '#/';
  window.addEventListener('hashchange', () => {
    if (dirty && !confirm('You have unsaved changes. Leave without saving?')) {
      history.replaceState(null, '', lastHash);
      return;
    }
    dirty = false;
    lastHash = location.hash || '#/';
    route();
  });

  async function boot() {
    try {
      config = await api('/api/admin/config');
      route();
    } catch (e) {
      if (e.message !== 'Please sign in.') app.innerHTML = `<div class="boot">Could not load: ${esc(e.message)}</div>`;
    }
  }

  // ---------- login ----------
  function renderLogin() {
    config = null;
    app.innerHTML = `
      <div class="login-wrap">
        <div class="login-card">
          <img src="/images/logo.jpg" alt="Kooskia Opera House">
          <h1>Box Office Sign-in</h1>
          <p>Manage shows, showtimes and ticket sales.</p>
          <form id="login-form">
            <div id="login-error"></div>
            <div class="field">
              <label for="pw">Password</label>
              <input type="password" id="pw" autocomplete="current-password" required autofocus>
            </div>
            <button class="btn btn-primary btn-lg" style="width:100%" type="submit">Sign In</button>
          </form>
          <p style="margin:18px 0 0;font-size:.9rem"><a href="/">← Back to website</a></p>
        </div>
      </div>`;
    $('#login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = $('button[type=submit]', e.target);
      btn.disabled = true; btn.textContent = 'Signing in…';
      try {
        await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ password: $('#pw').value }) });
        await boot();
      } catch (err) {
        $('#login-error').innerHTML = `<div class="form-error">${esc(err.message)}</div>`;
        btn.disabled = false; btn.textContent = 'Sign In';
        $('#pw').select();
      }
    });
  }

  // ---------- dashboard ----------
  function meter(sold, cap) {
    const pct = cap ? Math.min(100, Math.round((sold / cap) * 100)) : 0;
    return `<div class="meter ${sold >= cap && cap ? 'full' : ''}"><small>${sold} of ${cap} sold</small><div class="bar"><i style="width:${pct}%"></i></div></div>`;
  }
  function statusPill(p, show) {
    if (p.status === 'cancelled') return '<span class="pill red">Cancelled</span>';
    if (p.past) return '<span class="pill gray">Past</span>';
    if (p.status === 'paused') return '<span class="pill amber">Paused</span>';
    if (!show.published) return '<span class="pill gray">Hidden</span>';
    if (p.sold_regular + p.sold_premium >= show.regular_seats + show.premium_seats) return '<span class="pill red">Sold out</span>';
    return '<span class="pill green">On sale</span>';
  }
  function bannerHtml() {
    if (config.squareConfigured) {
      return config.squareEnvironment === 'sandbox'
        ? `<div class="banner info"><div><strong>Square test mode</strong>Payments use Square's sandbox. No real cards are charged. Switch to production before selling real tickets.</div></div>`
        : '';
    }
    if (config.demoPayments) {
      return `<div class="banner info"><div><strong>Demo mode</strong>Square isn't connected, so checkout is simulated and no money changes hands. Fine for trying things out, but turn it off before going live.</div></div>`;
    }
    return `<div class="banner warn"><div><strong>Online payments aren't connected yet</strong>Customers can see your shows but can't buy tickets online until Square is set up (see SETUP.md). You can still record box-office sales here.</div></div>`;
  }

  async function renderDashboard() {
    shows = await api('/api/admin/shows');
    const rows = [];
    const pastRows = [];
    for (const s of shows) for (const p of s.performances) (p.past ? pastRows : rows).push({ s, p });
    rows.sort((a, b) => (a.p.date + a.p.start_time).localeCompare(b.p.date + b.p.start_time));
    pastRows.sort((a, b) => (b.p.date + b.p.start_time).localeCompare(a.p.date + a.p.start_time));

    const live = rows.filter((r) => r.p.status !== 'cancelled');
    const sold = live.reduce((n, r) => n + r.p.sold_regular + r.p.sold_premium, 0);
    const revenue = live.reduce((n, r) => n + r.p.revenue_cents, 0);
    const remaining = live.reduce((n, r) => n + Math.max(0, r.s.regular_seats + r.s.premium_seats - r.p.sold_regular - r.p.sold_premium), 0);

    const perfRow = ({ s, p }) => `
      <tr class="${p.status === 'cancelled' ? 'muted' : ''}">
        <td><b>${esc(s.title)}</b></td>
        <td class="when"><b>${esc(fmtDate(p.date))}</b><span>${esc(fmtRange(p))}</span></td>
        <td>${meter(p.sold_premium, s.premium_seats)}</td>
        <td>${meter(p.sold_regular, s.regular_seats)}</td>
        <td class="num">${money2(p.revenue_cents)}</td>
        <td>${statusPill(p, s)}${p.held ? `<br><small class="hint">${p.held} being paid for now</small>` : ''}</td>
        <td class="num"><a class="btn btn-outline btn-sm" href="#/guests/${p.id}">Guest list</a></td>
      </tr>`;
    const tableHead = `<thead><tr><th>Show</th><th>Date &amp; time</th><th>Premium</th><th>Regular</th><th class="num">Sales</th><th>Status</th><th></th></tr></thead>`;

    app.innerHTML = topbar() + `
      <main class="container">
        ${bannerHtml()}
        <div class="page-head">
          <div><h1>Welcome back</h1><p>Here's how ticket sales are going.</p></div>
          <a class="btn btn-primary btn-lg" href="#/show/new">+ Add a New Show</a>
        </div>

        <div class="stats">
          <div class="stat"><b>${live.length}</b><span>Upcoming showtimes</span></div>
          <div class="stat"><b>${sold}</b><span>Tickets sold</span></div>
          <div class="stat"><b>${remaining}</b><span>Seats still available</span></div>
          <div class="stat"><b>${money(revenue)}</b><span>Upcoming ticket sales</span></div>
        </div>

        <section class="card">
          <div class="card-head"><h2>Upcoming showtimes</h2></div>
          ${rows.length ? `<div class="table-scroll"><table class="list">${tableHead}<tbody>${rows.map(perfRow).join('')}</tbody></table></div>`
            : `<div class="empty"><h3>No upcoming showtimes</h3><p>Add a new show, or add dates to an existing one.</p></div>`}
        </section>

        <section class="card">
          <div class="card-head"><h2>Your shows</h2><a class="btn btn-outline btn-sm" href="#/show/new">+ Add a New Show</a></div>
          ${shows.length ? `<div class="show-list">${shows.map((s) => {
            const up = s.performances.filter((p) => !p.past);
            const next = up[0];
            return `<div class="show-item">
              <div class="thumb" style="${s.image_url ? `background-image:url('${esc(s.image_url)}')` : ''}">${s.image_url ? '' : esc(s.title)}</div>
              <div>
                <h3>${esc(s.title)} ${s.published ? '<span class="pill green">On website</span>' : '<span class="pill gray">Hidden</span>'}</h3>
                <p>${up.length ? `${up.length} upcoming showtime${up.length > 1 ? 's' : ''} · next ${esc(fmtDate(next.date))} at ${esc(fmtTime(next.start_time))}` : 'No upcoming showtimes'}
                · Premium ${money(s.premium_price_cents)} / Regular ${money(s.regular_price_cents)}</p>
              </div>
              <div><a class="btn btn-primary btn-sm" href="#/show/${s.id}">Edit show</a></div>
            </div>`;
          }).join('')}</div>` : `<div class="empty"><h3>No shows yet</h3><p>Click <b>Add a New Show</b> to put your first show on the website.</p></div>`}
        </section>

        ${pastRows.length ? `<details class="box"><summary>Past showtimes (${pastRows.length})</summary><div><div class="table-scroll"><table class="list">${tableHead}<tbody>${pastRows.map(perfRow).join('')}</tbody></table></div></div></details>` : ''}
      </main>`;
    bindTopbar();
  }

  // ---------- show editor ----------
  async function renderEditor(id) {
    if (!shows.length || (id && !shows.find((s) => s.id === id))) shows = await api('/api/admin/shows');
    const existing = id ? shows.find((s) => s.id === id) : null;
    if (id && !existing) { toast('That show no longer exists.', true); location.hash = '#/'; return; }
    const max = config.maxSeats;

    const s = existing ? {
      ...existing,
      regular_price: (existing.regular_price_cents / 100).toFixed(2),
      premium_price: (existing.premium_price_cents / 100).toFixed(2),
    } : {
      title: '', subtitle: '', description: '', notes: DEFAULT_NOTES, image_id: null, image_url: null,
      regular_price: '15.00', premium_price: '20.00', premium_seats: 40, regular_seats: max - 40, published: true,
      performances: [{ date: '', start_time: '19:00', end_time: '21:00', status: 'on_sale' }],
    };
    let perfs = s.performances.map((p) => ({ ...p }));
    let imageId = s.image_id;

    app.innerHTML = topbar() + `
      <main class="container">
        <a class="back" href="#/">← Back to dashboard</a>
        <div class="page-head"><div><h1>${existing ? 'Edit show' : 'Add a new show'}</h1>
          <p>${existing ? 'Changes go live on the website as soon as you click Save.' : 'Fill this in, add your dates, and click Save. It goes on the website right away.'}</p></div></div>
        <form id="show-form" novalidate>
          <div id="form-error"></div>

          <section class="card">
            <h2>1. About the show</h2>
            <div class="field"><label for="title">Show name</label><input type="text" id="title" maxlength="120" value="${esc(s.title)}" placeholder="e.g. Annie" required></div>
            <div class="field"><label for="subtitle">Short tagline <small>(optional)</small></label><input type="text" id="subtitle" maxlength="200" value="${esc(s.subtitle)}" placeholder="e.g. The beloved musical, performed by our local cast"></div>
            <div class="field"><label for="description">Description <small>(optional, shown on the ticket page)</small></label><textarea id="description" maxlength="5000" placeholder="Tell people about the show: story, cast, whether dinner is included, age guidance…">${esc(s.description)}</textarea></div>
            <div class="field">
              <span class="label">Poster or photo <small>(optional)</small></span>
              <div class="poster">
                <div class="poster-preview" id="poster-preview">${s.image_url ? `<img src="${esc(s.image_url)}" alt="">` : 'No image yet'}</div>
                <div>
                  <label class="btn btn-outline" for="poster-file" style="cursor:pointer">Choose a picture…</label>
                  <input type="file" id="poster-file" accept="image/*" hidden>
                  <button type="button" class="btn btn-outline" id="poster-remove" ${s.image_url ? '' : 'hidden'}>Remove</button>
                  <p class="hint">A wide (landscape) picture looks best. Phone photos are fine; we shrink them for you.</p>
                </div>
              </div>
            </div>
          </section>

          <section class="card">
            <h2>2. Ticket prices &amp; seats</h2>
            <p class="hint" style="margin:-4px 0 16px">These apply to every showtime of this show. The hall holds up to ${max} seats per showtime.</p>
            <div class="row">
              <div class="field"><label for="premium_price">Premium ticket price</label><div class="money"><input type="number" id="premium_price" min="0" step="0.01" value="${esc(s.premium_price)}"></div></div>
              <div class="field"><label for="premium_seats">Premium seats per showtime</label><input type="number" id="premium_seats" min="0" max="${max}" step="1" value="${s.premium_seats}"></div>
            </div>
            <div class="row">
              <div class="field"><label for="regular_price">Regular ticket price</label><div class="money"><input type="number" id="regular_price" min="0" step="0.01" value="${esc(s.regular_price)}"></div></div>
              <div class="field"><label for="regular_seats">Regular seats per showtime</label><input type="number" id="regular_seats" min="0" max="${max}" step="1" value="${s.regular_seats}"></div>
            </div>
            <div class="seat-total" id="seat-total"></div>
          </section>

          <section class="card">
            <div class="card-head" style="margin-bottom:4px"><h2>3. Dates &amp; times</h2></div>
            <p class="hint" style="margin:0 0 6px">Add a row for each performance. Online sales close automatically when the show starts.</p>
            <table class="perf-table">
              <thead><tr><th>Date</th><th>Starts</th><th>Ends <small>(optional)</small></th><th>Online sales</th><th></th></tr></thead>
              <tbody id="perf-body"></tbody>
            </table>
            <button type="button" class="btn btn-outline" id="add-perf">+ Add another showtime</button>
          </section>

          <section class="card">
            <h2>4. Fine print &amp; visibility</h2>
            <div class="field"><label for="notes">Notes shown at checkout <small>(one per line)</small></label><textarea id="notes" maxlength="2000" style="min-height:96px">${esc(s.notes)}</textarea></div>
            <label class="check"><input type="checkbox" id="published" ${s.published ? 'checked' : ''}>
              <div><strong>Show on website</strong><span>Uncheck to hide this show from the public site without deleting it.</span></div></label>
          </section>

          <div class="sticky-actions">
            <button type="submit" class="btn btn-primary btn-lg" id="save-btn">Save show</button>
            <a class="btn btn-outline btn-lg" href="#/">Cancel</a>
            <span class="spacer"></span>
            ${existing ? '<button type="button" class="btn btn-danger" id="delete-btn">Delete show</button>' : ''}
          </div>
        </form>
      </main>`;
    bindTopbar();

    const form = $('#show-form');
    form.addEventListener('input', () => { dirty = true; });

    // Seat total indicator
    function updateSeats() {
      const total = (Number($('#premium_seats').value) || 0) + (Number($('#regular_seats').value) || 0);
      const el = $('#seat-total');
      el.className = 'seat-total' + (total > max || total < 1 ? ' bad' : '');
      el.textContent = total > max ? `${total} seats is more than the hall holds. Please keep it to ${max} or fewer.` : `${total} of ${max} seats per showtime`;
    }
    ['premium_seats', 'regular_seats'].forEach((x) => $('#' + x).addEventListener('input', updateSeats));
    updateSeats();

    // Showtimes
    const body = $('#perf-body');
    function renderPerfs() {
      body.innerHTML = perfs.map((p, i) => {
        const soldN = (p.sold_regular || 0) + (p.sold_premium || 0) + (p.held || 0);
        return `<tr data-i="${i}">
          <td data-l="Date"><input type="date" data-k="date" value="${esc(p.date)}" required></td>
          <td data-l="Starts"><input type="time" data-k="start_time" value="${esc(p.start_time)}" required></td>
          <td data-l="Ends"><input type="time" data-k="end_time" value="${esc(p.end_time)}"></td>
          <td data-l="Online sales"><select data-k="status">
              <option value="on_sale" ${p.status === 'on_sale' ? 'selected' : ''}>On sale</option>
              <option value="paused" ${p.status === 'paused' ? 'selected' : ''}>Paused (call to buy)</option>
              <option value="cancelled" ${p.status === 'cancelled' ? 'selected' : ''}>Cancelled</option>
            </select>${soldN ? `<span class="sold-note">${soldN} ticket${soldN > 1 ? 's' : ''} sold</span>` : ''}</td>
          <td class="full" style="text-align:right">${soldN
            ? '<span class="hint" title="This showtime has tickets sold. Set it to Cancelled instead.">Can\'t remove</span>'
            : `<button type="button" class="icon-btn" data-remove="${i}" aria-label="Remove this showtime" title="Remove">✕</button>`}</td>
        </tr>`;
      }).join('') || '<tr><td colspan="5" class="hint" style="padding:10px 0">No showtimes yet. Add one below.</td></tr>';
    }
    body.addEventListener('input', (e) => {
      const tr = e.target.closest('tr[data-i]');
      if (tr && e.target.dataset.k) perfs[Number(tr.dataset.i)][e.target.dataset.k] = e.target.value;
    });
    body.addEventListener('change', (e) => {
      const tr = e.target.closest('tr[data-i]');
      if (tr && e.target.dataset.k) { perfs[Number(tr.dataset.i)][e.target.dataset.k] = e.target.value; dirty = true; }
    });
    body.addEventListener('click', (e) => {
      const b = e.target.closest('[data-remove]');
      if (!b) return;
      perfs.splice(Number(b.dataset.remove), 1);
      dirty = true;
      renderPerfs();
    });
    $('#add-perf').addEventListener('click', () => {
      const last = perfs[perfs.length - 1];
      let date = '';
      if (last && last.date) { const d = parseDate(last.date); d.setDate(d.getDate() + 1); date = ymd(d); }
      perfs.push({ date, start_time: last ? last.start_time : '19:00', end_time: last ? last.end_time : '', status: 'on_sale' });
      dirty = true;
      renderPerfs();
      const inputs = $$('input[data-k="date"]', body);
      inputs[inputs.length - 1].focus();
    });
    renderPerfs();

    // Poster upload
    $('#poster-file').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const prev = $('#poster-preview');
      prev.textContent = 'Uploading…';
      try {
        const { mime, b64 } = await shrinkImage(file);
        const res = await api('/api/admin/images', { method: 'POST', body: JSON.stringify({ mime, data_b64: b64 }) });
        imageId = res.id;
        prev.innerHTML = `<img src="${esc(res.url)}" alt="">`;
        $('#poster-remove').hidden = false;
        dirty = true;
      } catch (err) {
        prev.textContent = 'Upload failed';
        toast(err.message || 'Could not use that picture.', true);
      }
      e.target.value = '';
    });
    $('#poster-remove').addEventListener('click', () => {
      imageId = null;
      $('#poster-preview').textContent = 'No image yet';
      $('#poster-remove').hidden = true;
      dirty = true;
    });

    // Save
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const errBox = $('#form-error');
      errBox.innerHTML = '';
      const problems = [];
      if (!$('#title').value.trim()) problems.push('Please enter a show name.');
      perfs.forEach((p, i) => { if (!p.date || !p.start_time) problems.push(`Showtime ${i + 1} needs a date and a start time.`); });
      const seatTotal = Number($('#premium_seats').value) + Number($('#regular_seats').value);
      if (seatTotal > max) problems.push(`Premium + regular seats can't be more than ${max}.`);
      if (problems.length) {
        errBox.innerHTML = `<div class="form-error">${problems.map(esc).join('<br>')}</div>`;
        errBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      const payload = {
        title: $('#title').value, subtitle: $('#subtitle').value, description: $('#description').value,
        notes: $('#notes').value, image_id: imageId,
        premium_price: $('#premium_price').value, regular_price: $('#regular_price').value,
        premium_seats: Number($('#premium_seats').value), regular_seats: Number($('#regular_seats').value),
        published: $('#published').checked,
        performances: perfs.map((p) => ({ id: p.id || null, date: p.date, start_time: p.start_time, end_time: p.end_time || '', status: p.status })),
      };
      const btn = $('#save-btn');
      btn.disabled = true; btn.textContent = 'Saving…';
      try {
        await api(existing ? `/api/admin/shows/${existing.id}` : '/api/admin/shows', {
          method: existing ? 'PUT' : 'POST', body: JSON.stringify(payload),
        });
        dirty = false;
        shows = [];
        toast(payload.published ? 'Saved! Your changes are live on the website.' : 'Saved. This show is hidden from the website.');
        location.hash = '#/';
      } catch (err) {
        errBox.innerHTML = `<div class="form-error">${esc(err.message)}</div>`;
        errBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
        btn.disabled = false; btn.textContent = 'Save show';
      }
    });

    const del = $('#delete-btn');
    if (del) del.addEventListener('click', async () => {
      if (!confirm(`Delete "${existing.title}" and all of its showtimes? This can't be undone.`)) return;
      try {
        await api(`/api/admin/shows/${existing.id}`, { method: 'DELETE' });
        dirty = false; shows = [];
        toast('Show deleted.');
        location.hash = '#/';
      } catch (err) { toast(err.message, true); }
    });
  }

  /** Resize a picture in the browser so uploads stay small (max 1400px, JPEG). */
  function shrinkImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const maxSide = 1400;
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        let q = 0.85, data = c.toDataURL('image/jpeg', q);
        while (data.length > 1_400_000 && q > 0.4) { q -= 0.1; data = c.toDataURL('image/jpeg', q); }
        resolve({ mime: 'image/jpeg', b64: data.split(',')[1] });
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file doesn\'t look like a picture we can use. Try a JPG or PNG.')); };
      img.src = url;
    });
  }

  // ---------- guest list ----------
  async function renderGuests(perfId) {
    const { performance: p, orders } = await api(`/api/admin/performances/${perfId}/orders`);
    const paid = orders.filter((o) => o.status === 'paid');
    const held = orders.filter((o) => o.status === 'pending');
    const cancelled = orders.filter((o) => o.status === 'cancelled');
    const soldP = paid.reduce((n, o) => n + o.premium_qty, 0);
    const soldR = paid.reduce((n, o) => n + o.regular_qty, 0);
    const seats = soldP + soldR;
    const checked = paid.filter((o) => o.checked_in).reduce((n, o) => n + o.premium_qty + o.regular_qty, 0);
    const revenue = paid.reduce((n, o) => n + o.total_cents, 0);
    const SRC = { online: 'Online', box_office: 'Box office', comp: 'Comp' };

    const seatText = (o) => [o.premium_qty ? `${o.premium_qty} Premium` : '', o.regular_qty ? `${o.regular_qty} Regular` : ''].filter(Boolean).join(', ');
    const row = (o) => `
      <tr class="${o.status !== 'paid' ? 'muted' : ''}" data-search="${esc((o.buyer_name + ' ' + o.buyer_email + ' ' + o.buyer_phone + ' ' + o.id).toLowerCase())}">
        <td>${o.status === 'paid' ? `<input type="checkbox" class="checkin" data-checkin="${esc(o.id)}" ${o.checked_in ? 'checked' : ''} aria-label="Checked in">` : ''}</td>
        <td><b>${esc(o.buyer_name || '(no name)')}</b>${o.note ? `<br><small class="hint">${esc(o.note)}</small>` : ''}</td>
        <td>${esc(seatText(o))}</td>
        <td><small>${esc(o.buyer_email)}${o.buyer_email && o.buyer_phone ? '<br>' : ''}${esc(o.buyer_phone)}</small></td>
        <td>${o.status === 'pending' ? '<span class="pill amber">Paying now</span>' : o.status === 'cancelled' ? '<span class="pill red">Cancelled</span>' : `<span class="pill gray">${SRC[o.source] || o.source}</span>`}</td>
        <td><small style="font-family:ui-monospace,Consolas,monospace">${esc(o.id)}</small></td>
        <td class="num">${money2(o.total_cents)}</td>
        <td class="num no-print">${o.status === 'paid' ? `<button class="btn btn-danger btn-sm" data-cancel="${esc(o.id)}">Cancel</button>` : ''}</td>
      </tr>`;

    app.innerHTML = topbar() + `
      <main class="container">
        <a class="back no-print" href="#/">← Back to dashboard</a>
        <div class="page-head">
          <div><h1>${esc(p.title)}</h1><p><b>${esc(fmtDate(p.date, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }))}</b> · ${esc(fmtRange(p))}${p.status === 'cancelled' ? ' · <span class="pill red">Cancelled</span>' : ''}</p></div>
          <div class="no-print" style="display:flex;gap:10px;flex-wrap:wrap">
            <button class="btn btn-outline" id="print-btn">Print guest list</button>
            <button class="btn btn-outline" id="csv-btn">Download spreadsheet</button>
          </div>
        </div>

        <div class="stats">
          <div class="stat"><b>${soldP} / ${p.premium_seats}</b><span>Premium seats sold</span></div>
          <div class="stat"><b>${soldR} / ${p.regular_seats}</b><span>Regular seats sold</span></div>
          <div class="stat"><b id="checked-stat">${checked} / ${seats}</b><span>Guests checked in</span></div>
          <div class="stat"><b>${money(revenue)}</b><span>Ticket sales</span></div>
        </div>

        <details class="box" id="sale-box">
          <summary>Record a box-office sale or free ticket</summary>
          <div>
            <p class="hint" style="margin-top:0">Use this for tickets sold at the door, over the phone, or given away. It takes those seats off the website so you never oversell.</p>
            <form id="sale-form">
              <div id="sale-error"></div>
              <div class="row">
                <div class="field"><label for="s-name">Guest name</label><input type="text" id="s-name" maxlength="100" required></div>
                <div class="field"><label for="s-phone">Phone <small>(optional)</small></label><input type="tel" id="s-phone" maxlength="40"></div>
              </div>
              <div class="row">
                <div class="field"><label for="s-premium">Premium seats</label><input type="number" id="s-premium" min="0" value="0"></div>
                <div class="field"><label for="s-regular">Regular seats</label><input type="number" id="s-regular" min="0" value="0"></div>
                <div class="field"><label for="s-source">Type</label><select id="s-source"><option value="box_office">Paid (cash, card, or check)</option><option value="comp">Free / complimentary</option></select></div>
              </div>
              <div class="field"><label for="s-note">Note <small>(optional)</small></label><input type="text" id="s-note" maxlength="500" placeholder="e.g. Paid cash, wants seats near the front"></div>
              <button class="btn btn-primary" type="submit">Add to guest list</button>
              <span class="hint" id="s-total" style="margin-left:10px"></span>
            </form>
          </div>
        </details>

        <section class="card">
          <div class="toolbar no-print">
            <input type="search" id="search" placeholder="Search by name, email, phone, or order #">
            <span class="hint">${paid.length} order${paid.length === 1 ? '' : 's'} · ${seats} guests</span>
          </div>
          ${orders.length ? `<div class="table-scroll"><table class="list">
            <thead><tr><th>In</th><th>Name</th><th>Seats</th><th>Contact</th><th>Type</th><th>Order #</th><th class="num">Paid</th><th class="no-print"></th></tr></thead>
            <tbody id="guest-body">${[...paid, ...held, ...cancelled].map(row).join('')}</tbody>
          </table></div>` : '<div class="empty"><h3>No tickets sold yet</h3><p>Orders will show up here as soon as people buy tickets.</p></div>'}
        </section>
      </main>`;
    bindTopbar();

    $('#print-btn').addEventListener('click', () => window.print());
    $('#csv-btn').addEventListener('click', () => {
      const lines = [['Name', 'Premium', 'Regular', 'Email', 'Phone', 'Type', 'Order #', 'Paid', 'Checked in', 'Note']];
      for (const o of paid) lines.push([o.buyer_name, o.premium_qty, o.regular_qty, o.buyer_email, o.buyer_phone, SRC[o.source] || o.source, o.id, (o.total_cents / 100).toFixed(2), o.checked_in ? 'Yes' : '', o.note]);
      const csv = lines.map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
      a.download = `guest-list-${p.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${p.date}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    });

    const search = $('#search');
    if (search) search.addEventListener('input', () => {
      const q = search.value.trim().toLowerCase();
      $$('#guest-body tr').forEach((tr) => { tr.hidden = q && !tr.dataset.search.includes(q); });
    });

    const gb = $('#guest-body');
    if (gb) {
      gb.addEventListener('change', async (e) => {
        const id = e.target.dataset.checkin;
        if (!id) return;
        try {
          await api(`/api/admin/orders/${id}`, { method: 'PATCH', body: JSON.stringify({ checked_in: e.target.checked }) });
          const o = paid.find((x) => x.id === id);
          o.checked_in = e.target.checked ? 1 : 0;
          const n = paid.filter((x) => x.checked_in).reduce((s, x) => s + x.premium_qty + x.regular_qty, 0);
          $('#checked-stat').textContent = `${n} / ${seats}`;
        } catch (err) { e.target.checked = !e.target.checked; toast(err.message, true); }
      });
      gb.addEventListener('click', async (e) => {
        const id = e.target.dataset.cancel;
        if (!id) return;
        const o = paid.find((x) => x.id === id);
        const extra = o.source === 'online' ? '\n\nThis does NOT refund their card. If you want to refund them, do that in your Square Dashboard.' : '';
        if (!confirm(`Cancel ${o.buyer_name}'s order and free up ${o.premium_qty + o.regular_qty} seat(s)?${extra}`)) return;
        try {
          await api(`/api/admin/orders/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'cancelled' }) });
          toast('Order cancelled. Those seats are available again.');
          renderGuests(perfId);
        } catch (err) { toast(err.message, true); }
      });
    }

    const saleTotal = () => {
      const pq = Number($('#s-premium').value) || 0, rq = Number($('#s-regular').value) || 0;
      const t = $('#s-source').value === 'comp' ? 0 : pq * p.premium_price_cents + rq * p.regular_price_cents;
      $('#s-total').textContent = pq + rq ? `Total to collect: ${money2(t)}` : '';
    };
    ['s-premium', 's-regular', 's-source'].forEach((x) => $('#' + x).addEventListener('input', saleTotal));
    $('#sale-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api(`/api/admin/performances/${perfId}/orders`, {
          method: 'POST',
          body: JSON.stringify({
            name: $('#s-name').value, phone: $('#s-phone').value, note: $('#s-note').value,
            premium: Number($('#s-premium').value) || 0, regular: Number($('#s-regular').value) || 0,
            source: $('#s-source').value,
          }),
        });
        toast('Added to the guest list.');
        await renderGuests(perfId);
        $('#sale-box').open = true;
      } catch (err) {
        $('#sale-error').innerHTML = `<div class="form-error">${esc(err.message)}</div>`;
      }
    });
  }

  boot();
})();
