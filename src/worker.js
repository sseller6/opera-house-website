// Kooskia Opera House — website backend (Cloudflare Worker).
//
// Static pages in /public are served automatically. This file only handles /api/*:
//   Public:  list shows, start a ticket checkout, check an order, receive Square webhooks
//   Admin:   log in, add/edit shows and showtimes, see sales, record box-office sales
//
// Payments go through Square's hosted checkout: for every order we create a one-time
// Square payment link for exactly the tickets chosen, so nothing has to be set up in
// Square by hand. Seats are held for HOLD_MINUTES while the buyer pays.

const ORDER_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const SQUARE_VERSION = '2025-01-23';
const COOKIE = 'koh_admin';
const SESSION_DAYS = 30;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      return await route(request, env, url, ctx);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message, ...err.extra }, err.status);
      console.error(err && err.stack ? err.stack : err);
      return json({ error: 'Something went wrong on our end. Please try again.' }, 500);
    }
  },

  // Cron trigger: release abandoned seat holds and catch any payments we missed.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(releaseExpiredHolds(env));
  },
};

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

async function route(req, env, url, ctx) {
  const p = url.pathname;
  const m = req.method;
  let match;

  // ----- Public -----
  if (p === '/api/shows' && m === 'GET') return json(await listPublicShows(env));
  if ((match = p.match(/^\/api\/shows\/(\d+)$/)) && m === 'GET') {
    const show = (await listPublicShows(env, Number(match[1])))[0];
    if (!show) throw new HttpError(404, 'That show could not be found.');
    return json(show);
  }
  if (p === '/api/checkout' && m === 'POST') return json(await startCheckout(req, env, url));
  if ((match = p.match(/^\/api\/orders\/([A-Z0-9-]{6,20})$/)) && m === 'GET') {
    return json(await getPublicOrder(env, match[1]));
  }
  if ((match = p.match(/^\/api\/images\/(\d+)$/)) && m === 'GET') return serveImage(env, Number(match[1]));
  if (p === '/api/square/webhook' && m === 'POST') return squareWebhook(req, env, url);
  if ((match = p.match(/^\/api\/demo-pay\/([A-Z0-9-]{6,20})$/)) && m === 'GET') return demoPay(env, url, match[1]);

  // ----- Admin auth -----
  if (p === '/api/admin/login' && m === 'POST') return adminLogin(req, env);
  if (p === '/api/admin/logout' && m === 'POST') {
    return json({ ok: true }, 200, { 'Set-Cookie': `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0` });
  }

  // Everything below requires an admin session.
  if (p.startsWith('/api/admin/')) {
    if (!(await isAdmin(req, env))) throw new HttpError(401, 'Please sign in.');
    if (m !== 'GET') {
      const origin = req.headers.get('Origin');
      if (origin && origin !== url.origin) throw new HttpError(403, 'Request blocked.');
    }

    if (p === '/api/admin/config' && m === 'GET') {
      return json({
        maxSeats: maxSeats(env),
        maxPerOrder: maxPerOrder(env),
        squareConfigured: squareConfigured(env),
        squareEnvironment: env.SQUARE_ENVIRONMENT || 'production',
        demoPayments: demoPayments(env),
        timezone: tz(env),
      });
    }
    if (p === '/api/admin/shows' && m === 'GET') return json(await listAdminShows(env));
    if (p === '/api/admin/shows' && m === 'POST') return json(await saveShow(req, env, null));
    if ((match = p.match(/^\/api\/admin\/shows\/(\d+)$/))) {
      if (m === 'PUT') return json(await saveShow(req, env, Number(match[1])));
      if (m === 'DELETE') return json(await deleteShow(env, Number(match[1])));
    }
    if ((match = p.match(/^\/api\/admin\/performances\/(\d+)\/orders$/))) {
      if (m === 'GET') return json(await listPerformanceOrders(env, Number(match[1])));
      if (m === 'POST') return json(await addManualOrder(req, env, Number(match[1])));
    }
    if ((match = p.match(/^\/api\/admin\/orders\/([A-Z0-9-]{6,20})$/)) && m === 'PATCH') {
      return json(await updateOrder(req, env, match[1]));
    }
    if (p === '/api/admin/images' && m === 'POST') return json(await uploadImage(req, env));
  }

  throw new HttpError(404, 'Not found.');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}

async function readJson(req) {
  try {
    return await req.json();
  } catch {
    throw new HttpError(400, 'Invalid request.');
  }
}

const maxSeats = (env) => Number(env.MAX_SEATS_PER_SHOW || 140);
const maxPerOrder = (env) => Number(env.MAX_TICKETS_PER_ORDER || 20);
const holdMs = (env) => Number(env.HOLD_MINUTES || 20) * 60 * 1000;
const tz = (env) => env.TIMEZONE || 'America/Los_Angeles';
const squareConfigured = (env) => Boolean(env.SQUARE_ACCESS_TOKEN && env.SQUARE_LOCATION_ID);
const demoPayments = (env) => !squareConfigured(env) && String(env.DEMO_PAYMENTS) === 'true';

function str(v, max, field, { required = false } = {}) {
  const s = typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim();
  if (required && !s) throw new HttpError(400, `${field} is required.`);
  if (s.length > max) throw new HttpError(400, `${field} is too long (max ${max} characters).`);
  return s;
}

function int(v, field, { min = 0, max = 1e9 } = {}) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `${field} must be a whole number between ${min} and ${max}.`);
  return n;
}

function dollarsToCents(v, field) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 10000) throw new HttpError(400, `${field} must be a dollar amount.`);
  return Math.round(n * 100);
}

/** Current date/time at the theatre, as 'YYYY-MM-DD' and 'HH:MM'. */
function theatreNow(env) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: tz(env), year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date()).map((x) => [x.type, x.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

function isUpcoming(perf, now) {
  return perf.date > now.date || (perf.date === now.date && perf.start_time > now.time);
}

function formatShowtime(perf) {
  const [y, mo, d] = perf.date.split('-').map(Number);
  const dateLabel = new Date(Date.UTC(y, mo - 1, d)).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  });
  return `${dateLabel} at ${formatTime(perf.start_time)}`;
}

function formatTime(hhmm) {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

function newOrderId() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  let s = '';
  for (const b of bytes) s += ORDER_ALPHABET[b % ORDER_ALPHABET.length];
  return `KOH-${s}`;
}

async function hmac(keyText, message, encoding = 'hex') {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(keyText), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
  if (encoding === 'base64') return btoa(String.fromCharCode(...sig));
  return [...sig].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Seats that count as "taken": paid orders plus unexpired holds.
const TAKEN_SQL = `(status = 'paid' OR (status = 'pending' AND hold_expires_at > ?))`;

async function takenByPerformance(env) {
  const { results } = await env.DB.prepare(
    `SELECT performance_id,
            COALESCE(SUM(regular_qty), 0) AS regular,
            COALESCE(SUM(premium_qty), 0) AS premium
       FROM orders WHERE ${TAKEN_SQL} GROUP BY performance_id`,
  ).bind(Date.now()).all();
  const map = new Map();
  for (const r of results) map.set(r.performance_id, { regular: r.regular, premium: r.premium });
  return map;
}

// ---------------------------------------------------------------------------
// Public: shows
// ---------------------------------------------------------------------------

async function listPublicShows(env, onlyId = null) {
  const now = theatreNow(env);
  const shows = (await env.DB.prepare(
    `SELECT * FROM shows WHERE published = 1 ${onlyId ? 'AND id = ?' : ''}`,
  ).bind(...(onlyId ? [onlyId] : [])).all()).results;
  if (!shows.length) return [];

  const perfs = (await env.DB.prepare(
    `SELECT * FROM performances ORDER BY date, start_time`,
  ).all()).results;
  const taken = await takenByPerformance(env);

  const out = [];
  for (const s of shows) {
    const upcoming = perfs.filter((pf) => pf.show_id === s.id && isUpcoming(pf, now));
    if (!upcoming.length) continue;
    out.push({
      id: s.id,
      title: s.title,
      subtitle: s.subtitle,
      description: s.description,
      notes: s.notes,
      image_url: s.image_id ? `/api/images/${s.image_id}` : null,
      prices: { regular: s.regular_price_cents, premium: s.premium_price_cents },
      performances: upcoming.map((pf) => {
        const t = taken.get(pf.id) || { regular: 0, premium: 0 };
        const available = {
          regular: Math.max(0, s.regular_seats - t.regular),
          premium: Math.max(0, s.premium_seats - t.premium),
        };
        const soldOut = available.regular + available.premium === 0;
        return {
          id: pf.id,
          date: pf.date,
          start_time: pf.start_time,
          end_time: pf.end_time,
          status: pf.status === 'on_sale' && soldOut ? 'sold_out' : pf.status,
          available,
        };
      }),
    });
  }
  out.sort((a, b) => (a.performances[0].date + a.performances[0].start_time).localeCompare(b.performances[0].date + b.performances[0].start_time));
  return out;
}

async function serveImage(env, id) {
  const row = await env.DB.prepare(`SELECT mime, data_b64 FROM images WHERE id = ?`).bind(id).first();
  if (!row) return new Response('Not found', { status: 404 });
  const bin = atob(row.data_b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Response(bytes, {
    headers: { 'Content-Type': row.mime, 'Cache-Control': 'public, max-age=31536000, immutable' },
  });
}

// ---------------------------------------------------------------------------
// Public: checkout
// ---------------------------------------------------------------------------

async function startCheckout(req, env, url) {
  const body = await readJson(req);
  const performanceId = int(body.performanceId, 'Showtime', { min: 1 });
  const regular = int(body.regular ?? 0, 'Regular tickets', { max: maxPerOrder(env) });
  const premium = int(body.premium ?? 0, 'Premium tickets', { max: maxPerOrder(env) });
  const name = str(body.name, 100, 'Name', { required: true });
  const email = str(body.email, 200, 'Email', { required: true });
  const phone = str(body.phone, 40, 'Phone');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Please enter a valid email address.');
  if (regular + premium < 1) throw new HttpError(400, 'Please choose at least one ticket.');
  if (regular + premium > maxPerOrder(env)) {
    throw new HttpError(400, `You can buy up to ${maxPerOrder(env)} tickets per order. For larger groups, please call us.`);
  }

  if (!squareConfigured(env) && !demoPayments(env)) {
    throw new HttpError(503, 'Online ticket sales are not open yet. Please call us to reserve seats.');
  }

  const perf = await env.DB.prepare(
    `SELECT p.*, s.title, s.published, s.regular_price_cents, s.premium_price_cents, s.regular_seats, s.premium_seats
       FROM performances p JOIN shows s ON s.id = p.show_id WHERE p.id = ?`,
  ).bind(performanceId).first();
  if (!perf || !perf.published) throw new HttpError(404, 'That showtime could not be found.');
  if (perf.status === 'cancelled') throw new HttpError(409, 'Sorry, this showtime has been cancelled.');
  if (perf.status !== 'on_sale') throw new HttpError(409, 'Online sales for this showtime are paused. Please call us.');
  if (!isUpcoming(perf, theatreNow(env))) throw new HttpError(409, 'Online sales for this showtime have closed.');

  const orderId = newOrderId();
  const now = Date.now();
  const total = regular * perf.regular_price_cents + premium * perf.premium_price_cents;

  const ok = await insertOrderIfSeats(env, {
    id: orderId, performanceId, regular, premium, total, name, email, phone,
    status: 'pending', source: 'online', note: '', holdUntil: now + holdMs(env), now,
    regularCap: perf.regular_seats, premiumCap: perf.premium_seats,
  });
  if (!ok) {
    const t = (await takenByPerformance(env)).get(performanceId) || { regular: 0, premium: 0 };
    throw new HttpError(409, 'Sorry, there are not enough seats left for that selection.', {
      available: {
        regular: Math.max(0, perf.regular_seats - t.regular),
        premium: Math.max(0, perf.premium_seats - t.premium),
      },
    });
  }

  if (demoPayments(env)) return { orderId, checkoutUrl: `/api/demo-pay/${orderId}` };

  try {
    const lineItems = [];
    const when = formatShowtime(perf);
    if (premium) lineItems.push(squareLine(`${perf.title} — Premium Seat`, when, premium, perf.premium_price_cents));
    if (regular) lineItems.push(squareLine(`${perf.title} — Regular Seat`, when, regular, perf.regular_price_cents));

    const res = await squareFetch(env, 'POST', '/v2/online-checkout/payment-links', {
      idempotency_key: orderId,
      description: `${perf.title} — ${when}`,
      order: {
        location_id: env.SQUARE_LOCATION_ID,
        reference_id: orderId,
        line_items: lineItems,
        metadata: { koh_order: orderId },
      },
      checkout_options: {
        redirect_url: `${url.origin}/confirmation.html?order=${orderId}`,
        ask_for_shipping_address: false,
        allow_tipping: false,
      },
      pre_populated_data: { buyer_email: email },
      payment_note: `${orderId} — ${name}`,
    });
    const link = res.payment_link;
    await env.DB.prepare(
      `UPDATE orders SET square_order_id = ?, square_payment_link_id = ? WHERE id = ?`,
    ).bind(link.order_id, link.id, orderId).run();
    return { orderId, checkoutUrl: link.url };
  } catch (err) {
    console.error('Square checkout failed', err);
    await env.DB.prepare(`UPDATE orders SET status = 'cancelled' WHERE id = ?`).bind(orderId).run();
    throw new HttpError(502, 'We could not reach our payment provider. Please try again in a minute, or call us.');
  }
}

function squareLine(name, note, qty, cents) {
  return {
    name,
    note,
    quantity: String(qty),
    base_price_money: { amount: cents, currency: 'USD' },
  };
}

/**
 * Inserts an order only if enough seats remain — in a single SQL statement, so two
 * people buying the last seats at the same moment can never both succeed.
 */
async function insertOrderIfSeats(env, o) {
  const res = await env.DB.prepare(
    `INSERT INTO orders (id, performance_id, regular_qty, premium_qty, total_cents, buyer_name, buyer_email,
                         buyer_phone, status, source, note, hold_expires_at, created_at, paid_at)
     SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14
      WHERE (SELECT COALESCE(SUM(regular_qty), 0) FROM orders
              WHERE performance_id = ?2 AND (status = 'paid' OR (status = 'pending' AND hold_expires_at > ?13))) + ?3 <= ?15
        AND (SELECT COALESCE(SUM(premium_qty), 0) FROM orders
              WHERE performance_id = ?2 AND (status = 'paid' OR (status = 'pending' AND hold_expires_at > ?13))) + ?4 <= ?16`,
  ).bind(
    o.id, o.performanceId, o.regular, o.premium, o.total, o.name, o.email, o.phone,
    o.status, o.source, o.note, o.holdUntil, o.now, o.status === 'paid' ? o.now : null,
    o.regularCap, o.premiumCap,
  ).run();
  return res.meta.changes === 1;
}

async function getPublicOrder(env, id) {
  let order = await env.DB.prepare(
    `SELECT o.*, p.date, p.start_time, p.end_time, s.title
       FROM orders o JOIN performances p ON p.id = o.performance_id JOIN shows s ON s.id = p.show_id
      WHERE o.id = ?`,
  ).bind(id).first();
  if (!order) throw new HttpError(404, 'Order not found.');

  // If the buyer lands here before Square's webhook arrives, ask Square directly.
  if (order.status === 'pending' && order.square_order_id && squareConfigured(env)) {
    const check = await checkSquareOrderPaid(env, order.square_order_id).catch(() => null);
    if (check && check.paid) {
      await markPaid(env, order.id, check.paymentId);
      order = { ...order, status: 'paid' };
    }
  }

  return {
    id: order.id,
    status: order.status,
    title: order.title,
    date: order.date,
    start_time: order.start_time,
    end_time: order.end_time,
    regular_qty: order.regular_qty,
    premium_qty: order.premium_qty,
    total_cents: order.total_cents,
    buyer_name: order.buyer_name,
    buyer_email: order.buyer_email,
    demo: demoPayments(env),
  };
}

async function markPaid(env, orderId, paymentId = null) {
  await env.DB.prepare(
    `UPDATE orders SET status = 'paid', paid_at = ?, square_payment_id = COALESCE(?, square_payment_id)
      WHERE id = ? AND status IN ('pending', 'expired')`,
  ).bind(Date.now(), paymentId, orderId).run();
}

async function demoPay(env, url, id) {
  if (!demoPayments(env)) throw new HttpError(404, 'Not found.');
  await markPaid(env, id, 'DEMO');
  return Response.redirect(`${url.origin}/confirmation.html?order=${id}`, 302);
}

// ---------------------------------------------------------------------------
// Square
// ---------------------------------------------------------------------------

function squareBase(env) {
  return env.SQUARE_ENVIRONMENT === 'sandbox' ? 'https://connect.squareupsandbox.com' : 'https://connect.squareup.com';
}

async function squareFetch(env, method, path, body) {
  const res = await fetch(squareBase(env) + path, {
    method,
    headers: {
      Authorization: `Bearer ${env.SQUARE_ACCESS_TOKEN}`,
      'Square-Version': SQUARE_VERSION,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`Square ${method} ${path} → ${res.status}: ${JSON.stringify(data.errors || data)}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

async function checkSquareOrderPaid(env, squareOrderId) {
  const { order } = await squareFetch(env, 'GET', `/v2/orders/${encodeURIComponent(squareOrderId)}`);
  const tenders = order.tenders || [];
  const due = order.net_amount_due_money ? order.net_amount_due_money.amount : null;
  const paid = order.state === 'COMPLETED' || (tenders.length > 0 && due === 0);
  return { paid, paymentId: tenders[0] ? tenders[0].payment_id || tenders[0].id : null };
}

async function squareWebhook(req, env, url) {
  const raw = await req.text();
  if (!env.SQUARE_WEBHOOK_SIGNATURE_KEY) return new Response('Webhook not configured', { status: 503 });
  const notificationUrl = env.SQUARE_WEBHOOK_URL || `${url.origin}/api/square/webhook`;
  const expected = await hmac(env.SQUARE_WEBHOOK_SIGNATURE_KEY, notificationUrl + raw, 'base64');
  const given = req.headers.get('x-square-hmacsha256-signature') || '';
  if (!safeEqual(expected, given)) return new Response('Invalid signature', { status: 403 });

  let event;
  try { event = JSON.parse(raw); } catch { return new Response('Bad JSON', { status: 400 }); }

  const payment = event && event.data && event.data.object && event.data.object.payment;
  if (payment && payment.status === 'COMPLETED' && payment.order_id) {
    const order = await env.DB.prepare(`SELECT id FROM orders WHERE square_order_id = ?`).bind(payment.order_id).first();
    if (order) await markPaid(env, order.id, payment.id);
  }
  return new Response('OK');
}

async function releaseExpiredHolds(env) {
  const { results } = await env.DB.prepare(
    `SELECT * FROM orders WHERE status = 'pending' AND hold_expires_at < ? LIMIT 50`,
  ).bind(Date.now()).all();

  for (const o of results) {
    try {
      if (o.square_order_id && squareConfigured(env)) {
        const check = await checkSquareOrderPaid(env, o.square_order_id);
        if (check.paid) {
          await markPaid(env, o.id, check.paymentId);
          continue;
        }
        // Kill the payment link so it can't be paid after the seats are released.
        if (o.square_payment_link_id) {
          await squareFetch(env, 'DELETE', `/v2/online-checkout/payment-links/${encodeURIComponent(o.square_payment_link_id)}`)
            .catch((e) => { if (e.status !== 404) throw e; });
        }
      }
      await env.DB.prepare(`UPDATE orders SET status = 'expired' WHERE id = ? AND status = 'pending'`).bind(o.id).run();
    } catch (err) {
      console.error('Failed to release hold', o.id, err);
    }
  }
}

// ---------------------------------------------------------------------------
// Admin: auth
// ---------------------------------------------------------------------------

const sessionKey = (env) => `${env.ADMIN_PASSWORD}|koh-admin-session`;

async function adminLogin(req, env) {
  if (!env.ADMIN_PASSWORD) throw new HttpError(500, 'The admin password has not been set up yet. See SETUP.md.');
  const body = await readJson(req);
  const given = typeof body.password === 'string' ? body.password : '';
  // Compare HMACs so the comparison takes the same time regardless of input.
  const a = await hmac('koh-login', given);
  const b = await hmac('koh-login', env.ADMIN_PASSWORD);
  if (!safeEqual(a, b)) {
    await new Promise((r) => setTimeout(r, 800));
    throw new HttpError(401, 'That password is not correct.');
  }
  const exp = Date.now() + SESSION_DAYS * 86400000;
  const sig = await hmac(sessionKey(env), String(exp));
  return json({ ok: true }, 200, {
    'Set-Cookie': `${COOKIE}=${exp}.${sig}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_DAYS * 86400}`,
  });
}

async function isAdmin(req, env) {
  if (!env.ADMIN_PASSWORD) return false;
  const cookie = req.headers.get('Cookie') || '';
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE}=(\\d+)\\.([a-f0-9]{64})`));
  if (!m) return false;
  if (Number(m[1]) < Date.now()) return false;
  return safeEqual(m[2], await hmac(sessionKey(env), m[1]));
}

// ---------------------------------------------------------------------------
// Admin: shows & showtimes
// ---------------------------------------------------------------------------

async function listAdminShows(env) {
  const shows = (await env.DB.prepare(`SELECT * FROM shows ORDER BY id DESC`).all()).results;
  const perfs = (await env.DB.prepare(`SELECT * FROM performances ORDER BY date, start_time`).all()).results;
  const stats = (await env.DB.prepare(
    `SELECT performance_id,
            SUM(CASE WHEN status = 'paid' THEN regular_qty ELSE 0 END) AS sold_regular,
            SUM(CASE WHEN status = 'paid' THEN premium_qty ELSE 0 END) AS sold_premium,
            SUM(CASE WHEN status = 'pending' AND hold_expires_at > ?1 THEN regular_qty + premium_qty ELSE 0 END) AS held,
            SUM(CASE WHEN status = 'paid' THEN total_cents ELSE 0 END) AS revenue_cents,
            SUM(CASE WHEN status = 'paid' AND checked_in = 1 THEN regular_qty + premium_qty ELSE 0 END) AS checked_in,
            SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) AS paid_orders
       FROM orders GROUP BY performance_id`,
  ).bind(Date.now()).all()).results;
  const statMap = new Map(stats.map((s) => [s.performance_id, s]));
  const now = theatreNow(env);

  return shows.map((s) => ({
    ...s,
    published: Boolean(s.published),
    image_url: s.image_id ? `/api/images/${s.image_id}` : null,
    performances: perfs.filter((p) => p.show_id === s.id).map((p) => {
      const st = statMap.get(p.id) || {};
      return {
        ...p,
        past: !isUpcoming(p, now),
        sold_regular: st.sold_regular || 0,
        sold_premium: st.sold_premium || 0,
        held: st.held || 0,
        revenue_cents: st.revenue_cents || 0,
        checked_in: st.checked_in || 0,
        paid_orders: st.paid_orders || 0,
      };
    }),
  }));
}

async function saveShow(req, env, id) {
  const b = await readJson(req);
  const show = {
    title: str(b.title, 120, 'Show name', { required: true }),
    subtitle: str(b.subtitle, 200, 'Tagline'),
    description: str(b.description, 5000, 'Description'),
    notes: str(b.notes, 2000, 'Notes'),
    image_id: b.image_id == null || b.image_id === '' ? null : int(b.image_id, 'Image', { min: 1 }),
    regular_price_cents: dollarsToCents(b.regular_price, 'Regular price'),
    premium_price_cents: dollarsToCents(b.premium_price, 'Premium price'),
    regular_seats: int(b.regular_seats, 'Regular seats', { max: maxSeats(env) }),
    premium_seats: int(b.premium_seats, 'Premium seats', { max: maxSeats(env) }),
    published: b.published ? 1 : 0,
  };
  if (show.regular_seats + show.premium_seats > maxSeats(env)) {
    throw new HttpError(400, `Regular + premium seats can't be more than ${maxSeats(env)} in total.`);
  }
  if (show.regular_seats + show.premium_seats < 1) throw new HttpError(400, 'Please set at least one seat.');

  const perfsIn = Array.isArray(b.performances) ? b.performances : [];
  if (perfsIn.length > 100) throw new HttpError(400, 'Too many showtimes.');
  const perfs = perfsIn.map((p, i) => {
    const date = str(p.date, 10, `Showtime ${i + 1} date`, { required: true });
    const start = str(p.start_time, 5, `Showtime ${i + 1} start time`, { required: true });
    const end = str(p.end_time, 5, `Showtime ${i + 1} end time`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(400, `Showtime ${i + 1} has an invalid date.`);
    if (!/^\d{2}:\d{2}$/.test(start)) throw new HttpError(400, `Showtime ${i + 1} has an invalid start time.`);
    if (end && !/^\d{2}:\d{2}$/.test(end)) throw new HttpError(400, `Showtime ${i + 1} has an invalid end time.`);
    const status = ['on_sale', 'paused', 'cancelled'].includes(p.status) ? p.status : 'on_sale';
    return { id: p.id ? int(p.id, 'Showtime id', { min: 1 }) : null, date, start_time: start, end_time: end, status };
  });

  if (id) {
    const existing = await env.DB.prepare(`SELECT id FROM shows WHERE id = ?`).bind(id).first();
    if (!existing) throw new HttpError(404, 'Show not found.');
  }

  // Showtimes removed in the editor must have no ticket sales.
  const existingPerfs = id
    ? (await env.DB.prepare(`SELECT id FROM performances WHERE show_id = ?`).bind(id).all()).results.map((r) => r.id)
    : [];
  const keepIds = new Set(perfs.filter((p) => p.id).map((p) => p.id));
  for (const pid of keepIds) {
    if (!existingPerfs.includes(pid)) throw new HttpError(400, 'A showtime in this form belongs to a different show. Please reload the page.');
  }
  const removeIds = existingPerfs.filter((pid) => !keepIds.has(pid));
  for (const pid of removeIds) {
    const sold = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM orders WHERE performance_id = ? AND ${TAKEN_SQL}`,
    ).bind(pid, Date.now()).first();
    if (sold.n > 0) {
      throw new HttpError(409, 'One of the showtimes you removed already has tickets sold. Set it to "Cancelled" instead of deleting it.');
    }
  }

  const stmts = [];
  let showId = id;
  if (id) {
    stmts.push(env.DB.prepare(
      `UPDATE shows SET title=?, subtitle=?, description=?, notes=?, image_id=?, regular_price_cents=?,
              premium_price_cents=?, regular_seats=?, premium_seats=?, published=? WHERE id=?`,
    ).bind(show.title, show.subtitle, show.description, show.notes, show.image_id, show.regular_price_cents,
      show.premium_price_cents, show.regular_seats, show.premium_seats, show.published, id));
  } else {
    const r = await env.DB.prepare(
      `INSERT INTO shows (title, subtitle, description, notes, image_id, regular_price_cents, premium_price_cents,
                          regular_seats, premium_seats, published, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(show.title, show.subtitle, show.description, show.notes, show.image_id, show.regular_price_cents,
      show.premium_price_cents, show.regular_seats, show.premium_seats, show.published, Date.now()).run();
    showId = r.meta.last_row_id;
  }

  for (const pid of removeIds) {
    stmts.push(env.DB.prepare(`DELETE FROM orders WHERE performance_id = ? AND status IN ('expired','cancelled','pending')`).bind(pid));
    stmts.push(env.DB.prepare(`DELETE FROM performances WHERE id = ?`).bind(pid));
  }
  for (const p of perfs) {
    if (p.id) {
      stmts.push(env.DB.prepare(`UPDATE performances SET date=?, start_time=?, end_time=?, status=? WHERE id=? AND show_id=?`)
        .bind(p.date, p.start_time, p.end_time, p.status, p.id, showId));
    } else {
      stmts.push(env.DB.prepare(`INSERT INTO performances (show_id, date, start_time, end_time, status) VALUES (?,?,?,?,?)`)
        .bind(showId, p.date, p.start_time, p.end_time, p.status));
    }
  }
  if (stmts.length) await env.DB.batch(stmts);
  return { ok: true, id: showId };
}

async function deleteShow(env, id) {
  const paid = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM orders o JOIN performances p ON p.id = o.performance_id
      WHERE p.show_id = ? AND (o.status = 'paid' OR (o.status = 'pending' AND o.hold_expires_at > ?))`,
  ).bind(id, Date.now()).first();
  if (paid.n > 0) {
    throw new HttpError(409, 'This show has ticket sales, so it can\'t be deleted. Uncheck "Show on website" to hide it instead.');
  }
  const show = await env.DB.prepare(`SELECT image_id FROM shows WHERE id = ?`).bind(id).first();
  if (!show) throw new HttpError(404, 'Show not found.');
  const stmts = [
    env.DB.prepare(`DELETE FROM orders WHERE performance_id IN (SELECT id FROM performances WHERE show_id = ?)`).bind(id),
    env.DB.prepare(`DELETE FROM performances WHERE show_id = ?`).bind(id),
    env.DB.prepare(`DELETE FROM shows WHERE id = ?`).bind(id),
  ];
  if (show.image_id) {
    stmts.push(env.DB.prepare(`DELETE FROM images WHERE id = ? AND NOT EXISTS (SELECT 1 FROM shows WHERE image_id = ?)`)
      .bind(show.image_id, show.image_id));
  }
  await env.DB.batch(stmts);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Admin: orders / guest list
// ---------------------------------------------------------------------------

async function listPerformanceOrders(env, perfId) {
  const perf = await env.DB.prepare(
    `SELECT p.*, s.title, s.regular_seats, s.premium_seats, s.regular_price_cents, s.premium_price_cents
       FROM performances p JOIN shows s ON s.id = p.show_id WHERE p.id = ?`,
  ).bind(perfId).first();
  if (!perf) throw new HttpError(404, 'Showtime not found.');
  const { results } = await env.DB.prepare(
    `SELECT id, regular_qty, premium_qty, total_cents, buyer_name, buyer_email, buyer_phone, status, source,
            note, created_at, paid_at, checked_in, hold_expires_at
       FROM orders
      WHERE performance_id = ?1 AND (status IN ('paid','cancelled') OR (status = 'pending' AND hold_expires_at > ?2))
      ORDER BY status = 'paid' DESC, buyer_name COLLATE NOCASE`,
  ).bind(perfId, Date.now()).all();
  return { performance: perf, orders: results };
}

async function addManualOrder(req, env, perfId) {
  const b = await readJson(req);
  const perf = await env.DB.prepare(
    `SELECT p.*, s.regular_seats, s.premium_seats, s.regular_price_cents, s.premium_price_cents
       FROM performances p JOIN shows s ON s.id = p.show_id WHERE p.id = ?`,
  ).bind(perfId).first();
  if (!perf) throw new HttpError(404, 'Showtime not found.');

  const regular = int(b.regular ?? 0, 'Regular seats', { max: maxSeats(env) });
  const premium = int(b.premium ?? 0, 'Premium seats', { max: maxSeats(env) });
  if (regular + premium < 1) throw new HttpError(400, 'Enter at least one seat.');
  const source = b.source === 'comp' ? 'comp' : 'box_office';
  const total = source === 'comp' ? 0 : regular * perf.regular_price_cents + premium * perf.premium_price_cents;
  const now = Date.now();

  const ok = await insertOrderIfSeats(env, {
    id: newOrderId(), performanceId: perfId, regular, premium, total,
    name: str(b.name, 100, 'Name', { required: true }),
    email: str(b.email, 200, 'Email'),
    phone: str(b.phone, 40, 'Phone'),
    status: 'paid', source, note: str(b.note, 500, 'Note'), holdUntil: null, now,
    regularCap: perf.regular_seats, premiumCap: perf.premium_seats,
  });
  if (!ok) throw new HttpError(409, 'Not enough seats left for that many tickets.');
  return { ok: true };
}

async function updateOrder(req, env, id) {
  const b = await readJson(req);
  const order = await env.DB.prepare(`SELECT * FROM orders WHERE id = ?`).bind(id).first();
  if (!order) throw new HttpError(404, 'Order not found.');
  if (typeof b.checked_in === 'boolean') {
    await env.DB.prepare(`UPDATE orders SET checked_in = ? WHERE id = ?`).bind(b.checked_in ? 1 : 0, id).run();
  }
  if (b.status === 'cancelled' && order.status !== 'cancelled') {
    await env.DB.prepare(`UPDATE orders SET status = 'cancelled' WHERE id = ?`).bind(id).run();
  }
  return { ok: true };
}

async function uploadImage(req, env) {
  const b = await readJson(req);
  const mime = ['image/jpeg', 'image/png', 'image/webp'].includes(b.mime) ? b.mime : null;
  if (!mime) throw new HttpError(400, 'Please upload a JPG, PNG, or WebP image.');
  const data = typeof b.data_b64 === 'string' ? b.data_b64 : '';
  if (!data || !/^[A-Za-z0-9+/=]+$/.test(data)) throw new HttpError(400, 'Invalid image.');
  if (data.length > 1_500_000) throw new HttpError(400, 'That image is too large. Please use a smaller picture.');
  const r = await env.DB.prepare(`INSERT INTO images (mime, data_b64, created_at) VALUES (?,?,?)`)
    .bind(mime, data, Date.now()).run();
  return { id: r.meta.last_row_id, url: `/api/images/${r.meta.last_row_id}` };
}
