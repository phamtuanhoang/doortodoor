'use strict';
/*
  Module khách hàng doortodoor
  - Khách đăng ký / đăng nhập bằng số điện thoại + mật khẩu
  - Khách tạo vận đơn (hàng Trung Quốc về Việt Nam), xem hành trình, xác nhận đã nhận hàng
  - Nhân viên (tài khoản quản trị) cập nhật hành trình, cân đo thực tế, hỗ trợ đặt lại mật khẩu khách
  - Tra cứu công khai theo mã vận đơn (chỉ trạng thái, không lộ thông tin khách)

  Website (doortodoor.com.vn) và máy chủ (railway.app) khác tên miền, nên phiên của khách
  dùng mã Bearer lưu ở trình duyệt thay vì cookie. Mã được ký bằng khóa riêng tách từ SESSION_SECRET,
  nên không thể dùng mã khách để vào trang quản trị.
*/
const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');

const STATUSES = [
  ['created', 'Đã tạo đơn'],
  ['received_cn', 'Nhập kho Bằng Tường'],
  ['at_hn', 'Về kho Hà Nội'],
  ['delivered', 'Đã nhận hàng'],
  ['cancelled', 'Đã hủy']
];
const STATUS_KEYS = STATUSES.map(s => s[0]);
const STAFF_STATUSES = STATUS_KEYS.filter(s => s !== 'created');
const CONFIRMABLE = ['at_hn'];
// Các bước cũ (bản 8 bước) được gộp vào 4 bước khi máy chủ khởi động
const LEGACY = { cn_export: 'received_cn', vn_customs: 'received_cn', in_transit: 'received_cn', delivering: 'at_hn' };
const TOKEN_DAYS = 30;

module.exports = function mountCustomers({ app, admin, pool, requireAdmin, rateLimit, ALLOWED_ORIGINS, SESSION_SECRET, captcha }) {
  /* ---------- Bảng dữ liệu ---------- */
  async function initTables() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS customers (
        id SERIAL PRIMARY KEY,
        phone TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        company TEXT,
        password_hash TEXT NOT NULL,
        token_version INT NOT NULL DEFAULT 1,
        disabled BOOLEAN NOT NULL DEFAULT false,
        consent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_login_at TIMESTAMPTZ
      );
      CREATE TABLE IF NOT EXISTS orders (
        id SERIAL PRIMARY KEY,
        waybill TEXT UNIQUE NOT NULL,
        customer_id INT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
        order_code TEXT NOT NULL,
        packages INT NOT NULL,
        volume NUMERIC(12,3),
        weight NUMERIC(12,2),
        item_name TEXT NOT NULL,
        brand TEXT,
        note TEXT,
        measured_volume NUMERIC(12,3),
        measured_weight NUMERIC(12,2),
        admin_note TEXT,
        status TEXT NOT NULL DEFAULT 'created',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        received_at TIMESTAMPTZ
      );
      CREATE TABLE IF NOT EXISTS order_events (
        id SERIAL PRIMARY KEY,
        order_id INT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        status TEXT NOT NULL,
        note TEXT,
        location TEXT,
        created_by TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS orders_customer_idx ON orders (customer_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS orders_status_idx ON orders (status, updated_at DESC);
      CREATE INDEX IF NOT EXISTS events_order_idx ON order_events (order_id, created_at);
    `);
    // Tài khoản do nhân viên tạo có thể dùng tên đăng nhập thay cho số điện thoại
    await pool.query('ALTER TABLE customers ADD COLUMN IF NOT EXISTS username TEXT UNIQUE');
    await pool.query('ALTER TABLE customers ALTER COLUMN phone DROP NOT NULL');
    await pool.query('ALTER TABLE customers ADD COLUMN IF NOT EXISTS email TEXT UNIQUE');
    for (const [from, to] of Object.entries(LEGACY)) {
      await pool.query('UPDATE orders SET status = $2 WHERE status = $1', [from, to]);
      await pool.query('UPDATE order_events SET status = $2 WHERE status = $1', [from, to]);
    }
  }

  /* ---------- Mã đăng nhập của khách ---------- */
  const KEY = crypto.createHmac('sha256', SESSION_SECRET).update('d2d-customer-token-v1').digest();
  function issue(c) {
    const body = Buffer.from(JSON.stringify({ cid: c.id, v: c.token_version, exp: Date.now() + TOKEN_DAYS * 864e5 })).toString('base64url');
    return body + '.' + crypto.createHmac('sha256', KEY).update(body).digest('base64url');
  }
  function read(tok) {
    if (typeof tok !== 'string' || tok.split('.').length !== 2) return null;
    const [body, mac] = tok.split('.');
    const a = Buffer.from(mac), b = Buffer.from(crypto.createHmac('sha256', KEY).update(body).digest('base64url'));
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    try { const p = JSON.parse(Buffer.from(body, 'base64url').toString()); return p.exp > Date.now() ? p : null; } catch { return null; }
  }
  async function requireCustomer(req, res, next) {
    try {
      const h = req.headers.authorization || '';
      const p = read(h.startsWith('Bearer ') ? h.slice(7) : '');
      if (!p) return res.status(401).json({ error: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.' });
      const { rows } = await pool.query('SELECT id, phone, email, username, name, company, token_version, disabled, created_at FROM customers WHERE id = $1', [p.cid]);
      const c = rows[0];
      if (!c || c.token_version !== p.v) return res.status(401).json({ error: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.' });
      if (c.disabled) return res.status(403).json({ error: 'Tài khoản đang bị khóa. Vui lòng liên hệ doortodoor.' });
      req.customer = c;
      next();
    } catch (e) { next(e); }
  }

  /* ---------- Tiện ích ---------- */
  function normPhone(v) {
    let s = String(v || '').replace(/[\s.\-()]/g, '');
    if (s.startsWith('+84')) s = '0' + s.slice(3);
    else if (/^84\d{9}$/.test(s)) s = '0' + s.slice(2);
    return /^0[35789]\d{8}$/.test(s) ? s : null;
  }
  const normUser = v => { const s = String(v || '').trim().toLowerCase(); return /^[a-z][a-z0-9._-]{2,39}$/.test(s) ? s : null; };
  const normEmail = v => { const s = String(v || '').trim().toLowerCase(); return s.length <= 160 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s) ? s : null; };
  const loginId = c => c.phone || c.email || c.username;
  // Mật khẩu khách: ít nhất 8 ký tự, có ít nhất 1 ký tự đặc biệt
  const PW_RULE = 'Mật khẩu cần ít nhất 8 ký tự, trong đó có ít nhất 1 ký tự đặc biệt (ví dụ ! @ # $ % - _).';
  const strongPw = pw => typeof pw === 'string' && pw.length >= 8 && pw.length <= 200 && /[^A-Za-z0-9]/.test(pw);
  function whichId(raw) { // số điện thoại, email hoặc tên đăng nhập
    const phone = normPhone(raw); if (phone) return { col: 'phone', val: phone };
    if (String(raw || '').indexOf('@') >= 0) { const e = normEmail(raw); return e ? { col: 'email', val: e } : null; }
    const u = normUser(raw); return u ? { col: 'username', val: u } : null;
  }
  const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  function optNum(v, max) {
    if (v === undefined || v === null || v === '') return { ok: true, val: null };
    const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
    return Number.isFinite(n) && n >= 0 && n <= max ? { ok: true, val: n } : { ok: false };
  }
  const ALPH = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  function newWaybill(at) {
    const d = new Date((at ? at.getTime() : Date.now()) + 7 * 3600e3); // giờ Việt Nam
    const ymd = String(d.getUTCFullYear()).slice(2) + String(d.getUTCMonth() + 1).padStart(2, '0') + String(d.getUTCDate()).padStart(2, '0');
    let r = ''; const bytes = crypto.randomBytes(5);
    for (const x of bytes) r += ALPH[x % 32];
    return 'D2D-' + ymd + '-' + r;
  }
  const normWaybill = v => String(v || '').trim().toUpperCase().replace(/\s+/g, '');
  function orderInput(b) {
    const o = {
      order_code: str(b.order_code, 120), item_name: str(b.item_name, 300), brand: str(b.brand, 160), note: str(b.note, 1000)
    };
    const pk = Number(b.packages);
    if (!o.order_code) return { error: 'Vui lòng nhập mã đơn hàng.' };
    if (!Number.isInteger(pk) || pk < 1 || pk > 100000) return { error: 'Số kiện phải là số nguyên từ 1 trở lên.' };
    if (!o.item_name) return { error: 'Vui lòng nhập tên hàng.' };
    const vol = optNum(b.volume, 100000), wt = optNum(b.weight, 10000000);
    if (!vol.ok) return { error: 'Số khối (m³) chưa đúng.' };
    if (!wt.ok) return { error: 'Số kg chưa đúng.' };
    return { order: { ...o, packages: pk, volume: vol.val, weight: wt.val } };
  }
  const num = v => (v == null ? null : Number(v));
  function publicOrder(o) {
    return {
      waybill: o.waybill, order_code: o.order_code, packages: o.packages, volume: num(o.volume), weight: num(o.weight),
      item_name: o.item_name, brand: o.brand, note: o.note, measured_volume: num(o.measured_volume), measured_weight: num(o.measured_weight),
      status: o.status, created_at: o.created_at, updated_at: o.updated_at, received_at: o.received_at
    };
  }
  const publicEvent = e => ({ status: e.status, note: e.note, created_at: e.created_at, by_customer: e.created_by.startsWith('khách') });
  function failLimiter(max, windowMs) { // đếm số lần sai mật khẩu theo số điện thoại
    const m = new Map();
    setInterval(() => { const now = Date.now(); for (const [k, v] of m) if (v.reset < now) m.delete(k); }, windowMs).unref();
    return {
      blocked: k => { const v = m.get(k); return v && v.reset > Date.now() && v.n >= max; },
      fail: k => { const now = Date.now(); const v = m.get(k) && m.get(k).reset > now ? m.get(k) : { n: 0, reset: now + windowMs }; v.n += 1; m.set(k, v); },
      clear: k => m.delete(k)
    };
  }

  /* ---------- CORS cho website gọi API khách ---------- */
  function cors(req, res, next) {
    const origin = req.headers.origin;
    if (origin && ALLOWED_ORIGINS.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Access-Control-Max-Age', '86400');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    res.setHeader('Cache-Control', 'no-store');
    next();
  }
  const json = express.json({ limit: '20kb' });

  /* ---------- API khách ---------- */
  const cr = express.Router();
  cr.use(cors);

  const registerLimit = rateLimit({ windowMs: 60 * 60 * 1000, max: 8 });
  cr.post('/register', registerLimit, json, captcha.require, async (req, res, next) => {
    try {
      const b = req.body || {};
      const raw = b.contact !== undefined ? b.contact : (b.email || b.phone);
      const id = whichId(raw), name = str(b.name, 120), company = str(b.company, 160);
      const pw = typeof b.password === 'string' ? b.password : '';
      if (!id || id.col === 'username') return res.status(400).json({ error: String(raw || '').indexOf('@') >= 0 ? 'Email chưa đúng định dạng.' : 'Nhập số di động Việt Nam 10 số (ví dụ 0912 345 678) hoặc địa chỉ email.' });
      if (!name) return res.status(400).json({ error: 'Vui lòng nhập họ tên.' });
      if (!strongPw(pw)) return res.status(400).json({ error: PW_RULE });
      if (b.consent !== true) return res.status(400).json({ error: 'Vui lòng đồng ý để doortodoor lưu thông tin phục vụ vận chuyển.' });
      const { rows } = await pool.query(
        `INSERT INTO customers (${id.col}, name, company, password_hash) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING RETURNING id, phone, email, username, name, company, token_version`,
        [id.val, name, company || null, await bcrypt.hash(pw, 10)]
      );
      if (!rows[0]) return res.status(409).json({ error: (id.col === 'email' ? 'Email' : 'Số điện thoại') + ' này đã có tài khoản. Bạn đăng nhập, hoặc liên hệ doortodoor nếu quên mật khẩu.' });
      const c = rows[0];
      res.status(201).json({ token: issue(c), customer: { phone: c.phone, email: c.email, username: c.username, name: c.name, company: c.company } });
    } catch (e) { next(e); }
  });

  const loginLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 15 });
  const phoneFails = failLimiter(8, 15 * 60 * 1000);
  cr.post('/login', loginLimit, json, captcha.require, async (req, res, next) => {
    try {
      const b = req.body || {};
      const raw = b.login !== undefined ? b.login : b.phone;
      const id = whichId(raw), pw = typeof b.password === 'string' ? b.password : '';
      const key = id && id.val;
      if (!key || !pw) return res.status(400).json({ error: 'Nhập email, số điện thoại hoặc tên đăng nhập, và mật khẩu.' });
      if (phoneFails.blocked(key)) return res.status(429).json({ error: 'Sai mật khẩu nhiều lần. Vui lòng thử lại sau 15 phút.' });
      const { rows } = await pool.query(`SELECT * FROM customers WHERE ${id.col} = $1`, [key]);
      const c = rows[0];
      if (!c || !(await bcrypt.compare(pw, c.password_hash))) { phoneFails.fail(key); return res.status(401).json({ error: 'Sai tài khoản hoặc mật khẩu.' }); }
      if (c.disabled) return res.status(403).json({ error: 'Tài khoản đang bị khóa. Vui lòng liên hệ doortodoor.' });
      phoneFails.clear(key);
      await pool.query('UPDATE customers SET last_login_at = now() WHERE id = $1', [c.id]);
      res.json({ token: issue(c), customer: { phone: c.phone, email: c.email, username: c.username, name: c.name, company: c.company } });
    } catch (e) { next(e); }
  });

  cr.get('/me', requireCustomer, (req, res) => {
    const c = req.customer;
    res.json({ phone: c.phone, email: c.email, username: c.username, name: c.name, company: c.company, created_at: c.created_at });
  });
  cr.patch('/me', requireCustomer, json, async (req, res, next) => {
    try {
      const name = str((req.body || {}).name, 120), company = str((req.body || {}).company, 160);
      if (!name) return res.status(400).json({ error: 'Vui lòng nhập họ tên.' });
      await pool.query('UPDATE customers SET name = $2, company = $3 WHERE id = $1', [req.customer.id, name, company || null]);
      res.json({ ok: true });
    } catch (e) { next(e); }
  });
  cr.post('/password', requireCustomer, json, async (req, res, next) => {
    try {
      const { current, next: nw } = req.body || {};
      if (!strongPw(nw)) return res.status(400).json({ error: PW_RULE });
      const { rows } = await pool.query('SELECT password_hash, token_version FROM customers WHERE id = $1', [req.customer.id]);
      if (!(await bcrypt.compare(String(current || ''), rows[0].password_hash))) return res.status(401).json({ error: 'Mật khẩu hiện tại chưa đúng.' });
      const r = await pool.query('UPDATE customers SET password_hash = $2, token_version = token_version + 1 WHERE id = $1 RETURNING id, token_version',
        [req.customer.id, await bcrypt.hash(nw, 10)]);
      res.json({ ok: true, token: issue(r.rows[0]) }); // các thiết bị khác bị đăng xuất
    } catch (e) { next(e); }
  });

  async function ownOrder(req, res) {
    const { rows } = await pool.query('SELECT * FROM orders WHERE waybill = $1 AND customer_id = $2', [normWaybill(req.params.waybill), req.customer.id]);
    if (!rows[0]) { res.status(404).json({ error: 'Không tìm thấy vận đơn.' }); return null; }
    return rows[0];
  }
  async function events(orderId) {
    const { rows } = await pool.query('SELECT * FROM order_events WHERE order_id = $1 ORDER BY created_at, id', [orderId]);
    return rows;
  }

  cr.get('/orders', requireCustomer, async (req, res, next) => {
    try {
      const { rows } = await pool.query('SELECT * FROM orders WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 300', [req.customer.id]);
      res.json({ items: rows.map(publicOrder) });
    } catch (e) { next(e); }
  });
  const createLimit = rateLimit({ windowMs: 60 * 60 * 1000, max: 60 });
  cr.post('/orders', requireCustomer, createLimit, json, async (req, res, next) => {
    const client = await pool.connect();
    try {
      const v = orderInput(req.body || {});
      if (v.error) return res.status(400).json({ error: v.error });
      const o = v.order;
      await client.query('BEGIN');
      let row;
      for (let i = 0; i < 5 && !row; i++) {
        const r = await client.query(
          `INSERT INTO orders (waybill, customer_id, order_code, packages, volume, weight, item_name, brand, note)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (waybill) DO NOTHING RETURNING *`,
          [newWaybill(), req.customer.id, o.order_code, o.packages, o.volume, o.weight, o.item_name, o.brand || null, o.note || null]
        );
        row = r.rows[0];
      }
      if (!row) throw new Error('Không tạo được mã vận đơn');
      await client.query('INSERT INTO order_events (order_id, status, created_by) VALUES ($1, $2, $3)', [row.id, 'created', 'khách ' + loginId(req.customer)]);
      await client.query('COMMIT');
      res.status(201).json({ order: publicOrder(row) });
    } catch (e) { await client.query('ROLLBACK').catch(() => {}); next(e); }
    finally { client.release(); }
  });
  cr.get('/orders/:waybill', requireCustomer, async (req, res, next) => {
    try {
      const o = await ownOrder(req, res); if (!o) return;
      res.json({ order: publicOrder(o), events: (await events(o.id)).map(publicEvent) });
    } catch (e) { next(e); }
  });
  cr.patch('/orders/:waybill', requireCustomer, json, async (req, res, next) => {
    try {
      const o = await ownOrder(req, res); if (!o) return;
      if (o.status !== 'created') return res.status(409).json({ error: 'Hàng đã được doortodoor tiếp nhận nên không sửa được nữa. Vui lòng liên hệ nhân viên phụ trách.' });
      const v = orderInput(req.body || {});
      if (v.error) return res.status(400).json({ error: v.error });
      const n = v.order;
      await pool.query('UPDATE orders SET order_code=$2, packages=$3, volume=$4, weight=$5, item_name=$6, brand=$7, note=$8, updated_at=now() WHERE id=$1',
        [o.id, n.order_code, n.packages, n.volume, n.weight, n.item_name, n.brand || null, n.note || null]);
      res.json({ ok: true });
    } catch (e) { next(e); }
  });
  cr.post('/orders/:waybill/cancel', requireCustomer, async (req, res, next) => {
    try {
      const o = await ownOrder(req, res); if (!o) return;
      if (o.status !== 'created') return res.status(409).json({ error: 'Hàng đã được doortodoor tiếp nhận nên không hủy trên web được. Vui lòng liên hệ nhân viên phụ trách.' });
      await pool.query("UPDATE orders SET status='cancelled', updated_at=now() WHERE id=$1", [o.id]);
      await pool.query('INSERT INTO order_events (order_id, status, note, created_by) VALUES ($1, $2, $3, $4)', [o.id, 'cancelled', 'Khách hủy đơn', 'khách ' + loginId(req.customer)]);
      res.json({ ok: true });
    } catch (e) { next(e); }
  });
  cr.post('/orders/:waybill/confirm', requireCustomer, async (req, res, next) => {
    try {
      const o = await ownOrder(req, res); if (!o) return;
      if (o.status === 'delivered') return res.json({ ok: true });
      if (!CONFIRMABLE.includes(o.status)) return res.status(409).json({ error: 'Hàng chưa về kho Hà Nội nên chưa xác nhận được.' });
      await pool.query("UPDATE orders SET status='delivered', received_at=now(), updated_at=now() WHERE id=$1", [o.id]);
      await pool.query('INSERT INTO order_events (order_id, status, note, created_by) VALUES ($1, $2, $3, $4)', [o.id, 'delivered', 'Khách xác nhận đã nhận hàng', 'khách ' + loginId(req.customer)]);
      res.json({ ok: true });
    } catch (e) { next(e); }
  });
  app.use('/api/customer', cr);

  /* ---------- Tra cứu công khai theo mã vận đơn ---------- */
  const trackLimit = rateLimit({ windowMs: 60 * 1000, max: 20 });
  app.options('/api/track/:waybill', cors);
  app.get('/api/track/:waybill', cors, trackLimit, async (req, res, next) => {
    try {
      const wb = normWaybill(req.params.waybill);
      if (!/^D2D-\d{6}-[A-Z0-9]{5}$/.test(wb)) return res.status(400).json({ error: 'Mã vận đơn có dạng D2D-261115-K7Q3M.' });
      const { rows } = await pool.query('SELECT id, waybill, packages, status, created_at, updated_at FROM orders WHERE waybill = $1', [wb]);
      if (!rows[0]) return res.status(404).json({ error: 'Không tìm thấy vận đơn này. Kiểm tra lại mã.' });
      const ev = await events(rows[0].id);
      res.json({ waybill: rows[0].waybill, packages: rows[0].packages, status: rows[0].status, created_at: rows[0].created_at, updated_at: rows[0].updated_at,
        events: ev.map(e => ({ status: e.status, created_at: e.created_at })) });
    } catch (e) { next(e); }
  });

  /* ---------- Quản trị: đơn hàng và khách ---------- */
  const aj = express.json({ limit: '20kb' });
  admin.get('/orders', requireAdmin, async (req, res, next) => {
    try {
      const st = STATUS_KEYS.includes(req.query.status) ? req.query.status : null;
      const q = str(req.query.q, 80);
      const where = [], params = [];
      if (st) { params.push(st); where.push(`o.status = $${params.length}`); }
      else if (req.query.status === 'open') where.push("o.status NOT IN ('delivered','cancelled')");
      if (q) {
        params.push('%' + q.replace(/[%_\\]/g, '\\$&') + '%');
        const p = `$${params.length}`;
        where.push(`(o.waybill ILIKE ${p} OR o.order_code ILIKE ${p} OR o.item_name ILIKE ${p} OR o.brand ILIKE ${p} OR c.phone ILIKE ${p} OR c.email ILIKE ${p} OR c.username ILIKE ${p} OR c.name ILIKE ${p})`);
      }
      const { rows } = await pool.query(
        `SELECT o.*, COALESCE(c.phone, c.email, c.username) AS phone, c.name AS customer_name, c.company AS customer_company
         FROM orders o JOIN customers c ON c.id = o.customer_id
         ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY o.updated_at DESC LIMIT 300`, params);
      const counts = await pool.query('SELECT status, count(*)::int AS n FROM orders GROUP BY status');
      res.json({ items: rows, counts: Object.fromEntries(counts.rows.map(r => [r.status, r.n])) });
    } catch (e) { next(e); }
  });
  async function adminOrder(id) {
    const { rows } = await pool.query(
      `SELECT o.*, COALESCE(c.phone, c.email, c.username) AS phone, c.phone AS real_phone, c.name AS customer_name, c.company AS customer_company, c.id AS cid
       FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.id = $1`, [Number(id)]);
    return rows[0];
  }
  admin.get('/orders/:id', requireAdmin, async (req, res, next) => {
    try {
      const o = await adminOrder(req.params.id);
      if (!o) return res.status(404).json({ error: 'Không tìm thấy đơn.' });
      res.json({ order: o, events: await events(o.id) });
    } catch (e) { next(e); }
  });
  admin.post('/orders/:id/events', requireAdmin, aj, async (req, res, next) => {
    try {
      const o = await adminOrder(req.params.id);
      if (!o) return res.status(404).json({ error: 'Không tìm thấy đơn.' });
      const b = req.body || {};
      if (!STAFF_STATUSES.includes(b.status)) return res.status(400).json({ error: 'Chọn trạng thái.' });
      const note = str(b.note, 1000);
      await pool.query('INSERT INTO order_events (order_id, status, note, created_by) VALUES ($1,$2,$3,$4)',
        [o.id, b.status, note || null, req.admin.u]);
      await syncStatus(o.id);
      res.status(201).json({ ok: true });
    } catch (e) { next(e); }
  });
  admin.post('/orders-bulk/events', requireAdmin, aj, async (req, res, next) => { // một xe chở nhiều đơn: cập nhật cùng lúc
    const client = await pool.connect();
    try {
      const b = req.body || {};
      const ids = Array.isArray(b.ids) ? [...new Set(b.ids.map(Number).filter(Number.isInteger))] : [];
      if (!ids.length || ids.length > 300) return res.status(400).json({ error: 'Chọn từ 1 đến 300 đơn.' });
      if (!STAFF_STATUSES.includes(b.status)) return res.status(400).json({ error: 'Chọn trạng thái.' });
      const note = str(b.note, 1000) || null;
      await client.query('BEGIN');
      const r = await client.query(
        `INSERT INTO order_events (order_id, status, note, created_by)
         SELECT id, $2, $3, $4 FROM orders WHERE id = ANY($1::int[]) RETURNING order_id`,
        [ids, b.status, note, req.admin.u]);
      await client.query(
        `UPDATE orders SET status = $2, updated_at = now(),
           received_at = CASE WHEN $2 = 'delivered' THEN COALESCE(received_at, now()) ELSE NULL END
         WHERE id = ANY($1::int[])`, [ids, b.status]);
      await client.query('COMMIT');
      res.json({ ok: true, updated: r.rowCount });
    } catch (e) { await client.query('ROLLBACK').catch(() => {}); next(e); }
    finally { client.release(); }
  });
  admin.delete('/orders/:id/events/:eid', requireAdmin, async (req, res, next) => {
    try {
      const r = await pool.query("DELETE FROM order_events WHERE id = $1 AND order_id = $2 AND status <> 'created' RETURNING id", [Number(req.params.eid), Number(req.params.id)]);
      if (!r.rows[0]) return res.status(404).json({ error: 'Không xóa được bước này.' });
      await syncStatus(Number(req.params.id));
      res.json({ ok: true });
    } catch (e) { next(e); }
  });
  async function syncStatus(orderId) { // trạng thái đơn = bước mới nhất trong hành trình
    const { rows } = await pool.query('SELECT status, created_at FROM order_events WHERE order_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1', [orderId]);
    const st = rows[0] ? rows[0].status : 'created';
    await pool.query('UPDATE orders SET status = $2, received_at = CASE WHEN $2 = \'delivered\' THEN COALESCE(received_at, $3) ELSE NULL END, updated_at = now() WHERE id = $1',
      [orderId, st, rows[0] ? rows[0].created_at : null]);
  }
  admin.patch('/orders/:id', requireAdmin, aj, async (req, res, next) => {
    try {
      const b = req.body || {};
      const mv = optNum(b.measured_volume, 100000), mw = optNum(b.measured_weight, 10000000);
      if (!mv.ok || !mw.ok) return res.status(400).json({ error: 'Số cân đo chưa đúng.' });
      const r = await pool.query('UPDATE orders SET measured_volume = $2, measured_weight = $3, admin_note = $4, updated_at = now() WHERE id = $1 RETURNING id',
        [Number(req.params.id), mv.val, mw.val, str(b.admin_note, 2000) || null]);
      if (!r.rows[0]) return res.status(404).json({ error: 'Không tìm thấy đơn.' });
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  admin.get('/customers', requireAdmin, async (req, res, next) => {
    try {
      const q = str(req.query.q, 80);
      const params = [];
      let where = '';
      if (q) { params.push('%' + q.replace(/[%_\\]/g, '\\$&') + '%'); where = 'WHERE c.phone ILIKE $1 OR c.email ILIKE $1 OR c.username ILIKE $1 OR c.name ILIKE $1 OR c.company ILIKE $1'; }
      const { rows } = await pool.query(
        `SELECT c.id, c.phone, c.email, c.username, c.name, c.company, c.disabled, c.created_at, c.last_login_at,
           count(o.id)::int AS orders, count(o.id) FILTER (WHERE o.status NOT IN ('delivered','cancelled'))::int AS open_orders
         FROM customers c LEFT JOIN orders o ON o.customer_id = c.id ${where}
         GROUP BY c.id ORDER BY c.created_at DESC LIMIT 300`, params);
      res.json({ items: rows });
    } catch (e) { next(e); }
  });
  admin.post('/customers', requireAdmin, aj, async (req, res, next) => { // nhân viên tạo tài khoản cho khách
    try {
      const b = req.body || {};
      const phone = b.phone ? normPhone(b.phone) : null, user = b.username ? normUser(b.username) : null, email = b.email ? normEmail(b.email) : null;
      const name = str(b.name, 120) || user || phone || email, company = str(b.company, 160), pw = typeof b.password === 'string' ? b.password : '';
      if (b.phone && !phone) return res.status(400).json({ error: 'Số điện thoại chưa đúng (số di động Việt Nam 10 số).' });
      if (b.email && !email) return res.status(400).json({ error: 'Email chưa đúng định dạng.' });
      if (b.username && !user) return res.status(400).json({ error: 'Tên đăng nhập 3–40 ký tự, bắt đầu bằng chữ, chỉ gồm chữ không dấu, số, dấu chấm, gạch.' });
      if (!phone && !user && !email) return res.status(400).json({ error: 'Nhập tên đăng nhập, số điện thoại hoặc email.' });
      if (!strongPw(pw)) return res.status(400).json({ error: PW_RULE });
      const { rows } = await pool.query(
        'INSERT INTO customers (phone, email, username, name, company, password_hash) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
        [phone, email, user, name, company || null, await bcrypt.hash(pw, 10)]);
      res.status(201).json({ ok: true, id: rows[0].id });
    } catch (e) {
      if (e.code === '23505') return res.status(409).json({ error: 'Số điện thoại, email hoặc tên đăng nhập này đã có tài khoản.' });
      next(e);
    }
  });
  admin.post('/orders', requireAdmin, aj, async (req, res, next) => { // nhân viên tạo vận đơn thay khách
    const client = await pool.connect();
    try {
      const b = req.body || {};
      const cid = Number(b.customer_id);
      const v = orderInput(b);
      if (v.error) return res.status(400).json({ error: v.error });
      const st = b.status || 'created';
      if (!STATUS_KEYS.includes(st)) return res.status(400).json({ error: 'Trạng thái không hợp lệ.' });
      let at = null;
      if (b.date) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date)) return res.status(400).json({ error: 'Ngày dạng YYYY-MM-DD.' });
        at = new Date(b.date + 'T09:00:00+07:00');
        if (isNaN(at) || at > new Date()) return res.status(400).json({ error: 'Ngày chưa đúng.' });
      }
      const c = await client.query('SELECT id FROM customers WHERE id = $1', [cid]);
      if (!c.rows[0]) return res.status(404).json({ error: 'Không tìm thấy khách.' });
      const o = v.order;
      await client.query('BEGIN');
      let row;
      for (let i = 0; i < 5 && !row; i++) {
        const r = await client.query(
          `INSERT INTO orders (waybill, customer_id, order_code, packages, volume, weight, item_name, brand, note, status, created_at, received_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, COALESCE($11, now()), CASE WHEN $10 = 'delivered' THEN now() END) ON CONFLICT (waybill) DO NOTHING RETURNING *`,
          [newWaybill(at), cid, o.order_code, o.packages, o.volume, o.weight, o.item_name, o.brand || null, o.note || null, st, at]);
        row = r.rows[0];
      }
      if (!row) throw new Error('Không tạo được mã vận đơn');
      await client.query('INSERT INTO order_events (order_id, status, note, created_by, created_at) VALUES ($1, $2, $3, $4, COALESCE($5, now()))',
        [row.id, 'created', 'Nhân viên tạo đơn', req.admin.u, at]);
      if (st !== 'created') {
        await client.query('INSERT INTO order_events (order_id, status, note, created_by) VALUES ($1, $2, $3, $4)',
          [row.id, st, str(b.status_note, 1000) || null, req.admin.u]);
      }
      await client.query('COMMIT');
      res.status(201).json({ ok: true, id: row.id, waybill: row.waybill });
    } catch (e) { await client.query('ROLLBACK').catch(() => {}); next(e); }
    finally { client.release(); }
  });
  admin.post('/customers/:id/reset-password', requireAdmin, async (req, res, next) => {
    try {
      let pw = ''; for (const x of crypto.randomBytes(8)) pw += ALPH[x % 32].toLowerCase();
      pw = pw.slice(0, 4) + '-' + pw.slice(4); // có ký tự đặc biệt theo quy định mật khẩu
      const r = await pool.query('UPDATE customers SET password_hash = $2, token_version = token_version + 1 WHERE id = $1 RETURNING phone',
        [Number(req.params.id), await bcrypt.hash(pw, 10)]);
      if (!r.rows[0]) return res.status(404).json({ error: 'Không tìm thấy khách.' });
      res.json({ ok: true, password: pw });
    } catch (e) { next(e); }
  });
  admin.patch('/customers/:id', requireAdmin, aj, async (req, res, next) => {
    try {
      if (typeof (req.body || {}).disabled !== 'boolean') return res.status(400).json({ error: 'Yêu cầu không hợp lệ.' });
      await pool.query('UPDATE customers SET disabled = $2, token_version = token_version + CASE WHEN $2 THEN 1 ELSE 0 END WHERE id = $1', [Number(req.params.id), req.body.disabled]);
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  return { initTables, STATUSES };
};
