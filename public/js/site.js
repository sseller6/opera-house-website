/* Kooskia Opera House — public site behavior */
(function () {
  'use strict';

  const PHONE = '(208) 451-5152';
  const MAX_PER_ORDER = 20;

  // ---------- small helpers ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (cents) => '$' + (cents % 100 === 0 ? (cents / 100).toFixed(0) : (cents / 100).toFixed(2));
  const money2 = (cents) => '$' + (cents / 100).toFixed(2);

  function parseDate(ymd) {
    const [y, m, d] = ymd.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  function fmtTime(hhmm) {
    if (!hhmm) return '';
    const [h, m] = hhmm.split(':').map(Number);
    return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
  }
  function fmtTimeRange(p) {
    return p.end_time ? `${fmtTime(p.start_time)} – ${fmtTime(p.end_time)}` : fmtTime(p.start_time);
  }
  function fmtDate(ymd, opts = { weekday: 'short', month: 'short', day: 'numeric' }) {
    return parseDate(ymd).toLocaleDateString('en-US', opts);
  }
  function fmtDateRange(perfs) {
    if (!perfs.length) return '';
    const a = parseDate(perfs[0].date), b = parseDate(perfs[perfs.length - 1].date);
    const md = { month: 'short', day: 'numeric' };
    if (a.getTime() === b.getTime()) return a.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    if (a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()) {
      return `${a.toLocaleDateString('en-US', md)} – ${b.getDate()}, ${b.getFullYear()}`;
    }
    return `${a.toLocaleDateString('en-US', md)} – ${b.toLocaleDateString('en-US', md)}, ${b.getFullYear()}`;
  }
  async function api(path, opts = {}) {
    const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(data.error || 'Something went wrong.'); e.status = res.status; e.data = data; throw e; }
    return data;
  }

  const ICON = {
    cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>',
    ticket: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2z"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  };

  // ---------- global chrome ----------
  function initChrome() {
    const header = $('.site-header');
    if (header && header.classList.contains('over-hero')) {
      const onScroll = () => header.classList.toggle('scrolled', window.scrollY > 40);
      onScroll();
      window.addEventListener('scroll', onScroll, { passive: true });
    }
    const toggle = $('.nav-toggle'), links = $('#nav-links');
    if (toggle && links) {
      toggle.addEventListener('click', () => {
        const open = links.classList.toggle('open');
        toggle.setAttribute('aria-expanded', String(open));
        if (open && header) header.classList.add('scrolled');
      });
      links.addEventListener('click', (e) => { if (e.target.closest('a')) links.classList.remove('open'); });
    }
    $$('[data-year]').forEach((el) => { el.textContent = new Date().getFullYear(); });

    // Reveal-on-scroll
    const els = $$('.reveal');
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver((entries) => entries.forEach((en) => {
        if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
      }), { threshold: 0.12 });
      els.forEach((el) => io.observe(el));
    } else els.forEach((el) => el.classList.add('in'));

    // Gallery lightbox
    const lb = $('.lightbox');
    if (lb) {
      const img = $('img', lb);
      const close = () => { lb.classList.remove('open'); document.body.style.overflow = ''; };
      $$('[data-gallery] button').forEach((btn) => btn.addEventListener('click', () => {
        const src = $('img', btn);
        img.src = src.currentSrc || src.src; img.alt = src.alt;
        lb.classList.add('open'); document.body.style.overflow = 'hidden';
        $('.lightbox-close', lb).focus();
      }));
      lb.addEventListener('click', (e) => { if (e.target === lb || e.target.closest('.lightbox-close')) close(); });
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && lb.classList.contains('open')) close(); });
    }
  }

  // ---------- show lists (home + shows page) ----------
  function showCard(show) {
    const perfs = show.performances;
    const live = perfs.filter((p) => p.status === 'on_sale');
    const totalLeft = live.reduce((n, p) => n + p.available.regular + p.available.premium, 0);
    let badge = '';
    if (!live.length && perfs.some((p) => p.status === 'sold_out')) badge = '<span class="badge badge-red">Sold Out</span>';
    else if (live.length && totalLeft <= 25) badge = '<span class="badge badge-gold">Selling Fast</span>';
    const minPrice = Math.min(show.prices.regular, show.prices.premium);
    const img = show.image_url
      ? `<img src="${esc(show.image_url)}" alt="${esc(show.title)} poster" loading="lazy">`
      : `<div class="placeholder">${esc(show.title)}</div>`;
    const chips = perfs.slice(0, 8).map((p) => {
      const label = `${fmtDate(p.date)} · ${fmtTime(p.start_time)}`;
      return p.status === 'on_sale'
        ? `<a class="date-chip" href="/tickets.html?show=${show.id}&amp;performance=${p.id}">${esc(label)}</a>`
        : `<span class="date-chip off" title="${p.status === 'sold_out' ? 'Sold out' : p.status === 'cancelled' ? 'Cancelled' : 'Not on sale online'}">${esc(label)}</span>`;
    }).join('') + (perfs.length > 8 ? `<span class="date-chip">+${perfs.length - 8} more</span>` : '');

    return `
      <article class="show-card">
        <div class="show-card-img">${img}${badge}</div>
        <div class="show-card-body">
          <h3>${esc(show.title)}</h3>
          ${show.subtitle ? `<p class="show-card-sub">${esc(show.subtitle)}</p>` : ''}
          <div class="show-meta">
            <span>${ICON.cal}${esc(fmtDateRange(perfs))}</span>
            <span>${ICON.ticket}From ${money(minPrice)}</span>
          </div>
          <div class="date-chips">${chips}</div>
          <a class="btn btn-primary" href="/tickets.html?show=${show.id}">${live.length ? 'Get Tickets' : 'View Details'}</a>
        </div>
      </article>`;
  }

  async function initShowLists() {
    const lists = $$('[data-shows]');
    if (!lists.length) return;
    let shows;
    try {
      shows = await api('/api/shows');
    } catch {
      lists.forEach((el) => { el.outerHTML = `<div class="empty-state"><h3>We couldn't load the show list</h3><p>Please refresh the page, or call us at ${PHONE}.</p></div>`; });
      return;
    }
    lists.forEach((el) => {
      const limit = Number(el.dataset.limit) || Infinity;
      if (!shows.length) {
        el.outerHTML = `<div class="empty-state"><h3>New shows coming soon</h3><p>There aren't any shows on sale right now. Check back soon, or follow <strong>Kooskia Opera House</strong> on Facebook for announcements.</p><a class="btn btn-outline" href="/visit.html#contact">Contact Us</a></div>`;
        return;
      }
      el.innerHTML = shows.slice(0, limit).map(showCard).join('');
    });
  }

  // ---------- tickets page ----------
  async function initTickets() {
    const app = $('#ticket-app');
    const params = new URLSearchParams(location.search);
    const showId = params.get('show');
    if (!showId) { location.replace('/shows.html'); return; }

    let show;
    try {
      show = await api(`/api/shows/${encodeURIComponent(showId)}`);
    } catch (e) {
      app.innerHTML = `<div class="empty-state"><h3>${e.status === 404 ? 'This show is no longer on sale' : 'We couldn\'t load this show'}</h3><p>Take a look at what else is playing, or call us at ${PHONE}.</p><a class="btn btn-primary" href="/shows.html">See All Shows</a></div>`;
      return;
    }

    app.innerHTML = '';
    app.appendChild($('#ticket-template').content.cloneNode(true));
    document.title = `${show.title} Tickets | Kooskia Opera House`;

    $$('[data-f="title"]', app).forEach((el) => { el.textContent = show.title; });
    $('[data-f="subtitle"]', app).textContent = show.subtitle || '';
    $('[data-f="description"]', app).textContent = show.description || '';
    const img = $('[data-f="image"]', app);
    if (show.image_url) { img.src = show.image_url; img.alt = `${show.title} poster`; }
    else { img.closest('.show-header').classList.add('no-img'); img.remove(); }
    if (show.notes) {
      $('#policy-list').innerHTML = show.notes.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => `<li>${esc(l)}</li>`).join('');
    }

    const state = { perf: null, qty: { premium: 0, regular: 0 } };
    const form = $('#ticket-form');
    const btn = $('#checkout-btn');
    const alertBox = $('#form-alert');
    const showAlert = (msg, kind = 'error') => {
      alertBox.innerHTML = msg ? `<div class="alert alert-${kind}" role="alert">${esc(msg)}</div>` : '';
      if (msg) alertBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };

    // Step 1: showtimes
    const grid = $('#time-grid');
    function renderTimes() {
      grid.innerHTML = show.performances.map((p) => {
        const left = p.available.regular + p.available.premium;
        let avail, cls = '';
        if (p.status === 'cancelled') { avail = 'Cancelled'; cls = 'none'; }
        else if (p.status === 'paused') { avail = `Call ${PHONE}`; cls = 'none'; }
        else if (p.status === 'sold_out' || left === 0) { avail = 'Sold out'; cls = 'none'; }
        else if (left <= 15) { avail = `Only ${left} seats left`; cls = 'low'; }
        else avail = `${left} seats available`;
        const disabled = p.status !== 'on_sale' || left === 0;
        return `<div class="time-option">
          <input type="radio" name="performance" id="perf-${p.id}" value="${p.id}" ${disabled ? 'disabled' : ''} ${state.perf && state.perf.id === p.id ? 'checked' : ''}>
          <label for="perf-${p.id}">
            <span class="t-date">${esc(fmtDate(p.date, { weekday: 'long', month: 'long', day: 'numeric' }))}</span>
            <span class="t-time">${esc(fmtTimeRange(p))}</span>
            <span class="t-avail ${cls}">${esc(avail)}</span>
          </label></div>`;
      }).join('');
    }
    grid.addEventListener('change', (e) => {
      if (e.target.name !== 'performance') return;
      state.perf = show.performances.find((p) => String(p.id) === e.target.value);
      showAlert('');
      update();
    });

    // Step 2: seat steppers
    $$('.seat-row', app).forEach((row) => {
      const tier = row.dataset.tier;
      $('[data-price]', row).textContent = money(show.prices[tier]);
      $('[data-inc]', row).addEventListener('click', () => { state.qty[tier]++; update(); });
      $('[data-dec]', row).addEventListener('click', () => { state.qty[tier] = Math.max(0, state.qty[tier] - 1); update(); });
    });

    // Step 3: details
    ['f-name', 'f-email'].forEach((id) => $('#' + id).addEventListener('input', update));

    function emailOk(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()); }

    function update() {
      const perf = state.perf;
      const total = state.qty.premium + state.qty.regular;
      $('#step-seats').classList.toggle('disabled', !perf);
      $('#step-info').classList.toggle('disabled', !perf || total === 0);

      $$('.seat-row', app).forEach((row) => {
        const tier = row.dataset.tier;
        const avail = perf ? perf.available[tier] : 0;
        if (state.qty[tier] > avail) state.qty[tier] = avail;
        const totalNow = state.qty.premium + state.qty.regular;
        $('[data-qty]', row).textContent = state.qty[tier];
        $('[data-dec]', row).disabled = state.qty[tier] === 0;
        $('[data-inc]', row).disabled = !perf || state.qty[tier] >= avail || totalNow >= MAX_PER_ORDER;
        const left = $('[data-left]', row);
        if (!perf) { left.textContent = ''; left.className = 'seat-left'; }
        else if (avail === 0) { left.textContent = 'Sold out'; left.className = 'seat-left none'; }
        else if (avail <= 10) { left.textContent = `Only ${avail} left`; left.className = 'seat-left low'; }
        else { left.textContent = `${avail} available`; left.className = 'seat-left'; }
      });

      // Summary
      $('#s-when').textContent = perf ? `${fmtDate(perf.date, { weekday: 'long', month: 'long', day: 'numeric' })} · ${fmtTime(perf.start_time)}` : 'Choose a showtime';
      const lines = [];
      if (state.qty.premium) lines.push([`Premium × ${state.qty.premium}`, state.qty.premium * show.prices.premium]);
      if (state.qty.regular) lines.push([`Regular × ${state.qty.regular}`, state.qty.regular * show.prices.regular]);
      $('#s-lines').innerHTML = lines.length
        ? lines.map(([l, c]) => `<div class="summary-line"><span>${esc(l)}</span><span>${money2(c)}</span></div>`).join('')
        : '<div class="summary-line muted">No seats selected yet</div>';
      const sum = lines.reduce((n, [, c]) => n + c, 0);
      $('#s-total').textContent = money2(sum);

      const ready = perf && (state.qty.premium + state.qty.regular) > 0 && $('#f-name').value.trim() && emailOk($('#f-email').value);
      btn.disabled = !ready;
      btn.textContent = sum ? `Continue to Payment · ${money2(sum)}` : 'Continue to Payment';
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (btn.disabled) return;
      if (!$('#f-name').value.trim()) return showAlert('Please enter your name.');
      if (!emailOk($('#f-email').value)) return showAlert('Please enter a valid email address so we can send your receipt.');
      btn.disabled = true;
      btn.textContent = 'Holding your seats…';
      try {
        const res = await api('/api/checkout', {
          method: 'POST',
          body: JSON.stringify({
            performanceId: state.perf.id,
            premium: state.qty.premium,
            regular: state.qty.regular,
            name: $('#f-name').value.trim(),
            email: $('#f-email').value.trim(),
            phone: $('#f-phone').value.trim(),
          }),
        });
        btn.textContent = 'Opening secure checkout…';
        window.location.href = res.checkoutUrl;
      } catch (err) {
        if (err.data && err.data.available && state.perf) {
          state.perf.available = err.data.available;
          renderTimes();
        }
        showAlert(err.message);
        update();
      }
    });

    // Preselect a showtime from the URL, or if there's only one choice.
    const wanted = params.get('performance');
    const onSale = show.performances.filter((p) => p.status === 'on_sale');
    state.perf = show.performances.find((p) => String(p.id) === wanted && p.status === 'on_sale') || (onSale.length === 1 ? onSale[0] : null);
    renderTimes();
    update();
    if (!onSale.length) showAlert(`Online sales aren't available for this show right now. Please call ${PHONE}.`, 'info');

    // Coming back from Square with the browser's Back button: re-enable the button.
    window.addEventListener('pageshow', (e) => { if (e.persisted) update(); });
  }

  // ---------- confirmation page ----------
  async function initConfirmation() {
    const app = $('#confirm-app');
    const id = new URLSearchParams(location.search).get('order');
    const fail = (title, msg, icon = ICON.x) => {
      app.innerHTML = `<div class="confirm-top"><div class="confirm-icon">${icon}</div><h1>${esc(title)}</h1><p>${msg}</p></div>
        <div class="confirm-body" style="text-align:center"><a class="btn btn-primary" href="/shows.html">Back to Shows</a></div>`;
    };
    if (!id) return fail('Order not found', 'We couldn\'t find an order number in this link.');

    for (let attempt = 0; attempt < 12; attempt++) {
      let order;
      try {
        order = await api(`/api/orders/${encodeURIComponent(id)}`);
      } catch (e) {
        if (e.status === 404) return fail('Order not found', `We couldn't find that order. If you were charged, please call ${PHONE}.`);
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      if (order.status === 'paid') return renderPaid(order);
      if (order.status === 'expired' || order.status === 'cancelled') {
        return fail('This order wasn\'t completed', 'No payment was received, so your seats were released. You can start a new order any time.');
      }
      await new Promise((r) => setTimeout(r, 2500));
    }
    fail('Almost there…', `We're still waiting for Square to confirm your payment. If you completed payment, your email receipt is your ticket. Refresh this page in a minute, or call ${PHONE} with order <strong class="order-code">${esc(id)}</strong>.`, ICON.clock);

    function renderPaid(o) {
      const seats = [];
      if (o.premium_qty) seats.push(`${o.premium_qty} Premium`);
      if (o.regular_qty) seats.push(`${o.regular_qty} Regular`);
      app.innerHTML = `
        <div class="confirm-top">
          <div class="confirm-icon">${ICON.check}</div>
          <h1>You're all set!</h1>
          <p>Thank you, ${esc(o.buyer_name.split(' ')[0])}. We can't wait to see you at the show.</p>
        </div>
        <div class="confirm-body">
          ${o.demo ? '<div class="alert alert-info">Demo mode: no real payment was taken.</div>' : ''}
          <div class="ticket-stub">
            <dl>
              <dt>Show</dt><dd>${esc(o.title)}</dd>
              <dt>Date</dt><dd>${esc(fmtDate(o.date, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }))}</dd>
              <dt>Time</dt><dd>${esc(fmtTimeRange(o))}</dd>
              <dt>Seats</dt><dd>${esc(seats.join(' + '))}</dd>
              <dt>Total</dt><dd>${money2(o.total_cents)}</dd>
              <dt>Order #</dt><dd class="order-code">${esc(o.id)}</dd>
            </dl>
          </div>
          <p><strong>What's next:</strong> Square has emailed your receipt to <strong>${esc(o.buyer_email)}</strong>. Bring that receipt (on your phone or printed) for admission. Your name will also be on our guest list at the door.</p>
          <p style="color:var(--muted)">Doors open 30 minutes before the show. For specific seating, call ${PHONE}.</p>
          <p style="margin-top:24px;display:flex;gap:12px;flex-wrap:wrap">
            <button class="btn btn-outline" onclick="window.print()">Print this page</button>
            <a class="btn btn-primary" href="/visit.html">Directions &amp; Parking</a>
          </p>
        </div>`;
    }
  }

  // ---------- boot ----------
  document.addEventListener('DOMContentLoaded', () => {
    initChrome();
    const page = document.body.dataset.page;
    if (page === 'home' || page === 'shows') initShowLists();
    if (page === 'tickets') initTickets();
    if (page === 'confirmation') initConfirmation();
  });
})();
