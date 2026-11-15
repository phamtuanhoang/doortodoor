'use strict';
/*
  Máy chủ doortodoor
  - Nội dung website (liên hệ, dịch vụ, cửa khẩu, bảng giá, tin tức) lưu trong Postgres
  - Khách hàng gửi form liên hệ -> bảng leads
  - Agent gửi bản nháp -> bảng drafts, admin duyệt mới hiện lên web
  - Trang quản trị tại /admin
  - Khách hàng, vận đơn, hành trình: customers.js

  Biến môi trường:
    DATABASE_URL       chuỗi kết nối Postgres (Railway tự cấp)
    SESSION_SECRET     chuỗi ngẫu nhiên để ký phiên đăng nhập
    ADMIN_USERNAME     tài khoản quản trị đầu tiên (chỉ dùng khi chưa có tài khoản nào)
    ADMIN_PASSWORD     mật khẩu tài khoản đầu tiên
    AGENT_TOKEN        mã để agent gửi bản nháp
    ALLOWED_ORIGINS    các địa chỉ website được gọi API, cách nhau bằng dấu phẩy
*/
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const DEFAULT_CONTENT = require('./default-content.json');
const mountCustomers = require('./customers');

const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || '';
const AGENT_TOKEN = process.env.AGENT_TOKEN || '';
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://doortodoor.com.vn,https://www.doortodoor.com.vn')
  .split(',').map(s => s.trim()).filter(Boolean);
const SECTIONS = ['contact', 'services', 'border', 'prices', 'news'];
const AGENT_SECTIONS = ['border', 'prices', 'news'];
const LEAD_STATUSES = ['new', 'contacted', 'quoted', 'won', 'lost'];
const SESSION_HOURS = 12;

if (!process.env.DATABASE_URL) { console.error('Thiếu DATABASE_URL'); process.exit(1); }
if (SESSION_SECRET.length < 32) { console.error('SESSION_SECRET phải dài ít nhất 32 ký tự'); process.exit(1); }

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: /localhost|127\.0\.0\.1|\.railway\.internal/.test(process.env.DATABASE_URL) ? false : { rejectUnauthorized: false }
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admins (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS content (
      key TEXT PRIMARY KEY,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_by TEXT
    );
    CREATE TABLE IF NOT EXISTS drafts (
      id SERIAL PRIMARY KEY,
      section TEXT NOT NULL,
      data JSONB NOT NULL,
      note TEXT,
      sources JSONB,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      reviewed_at TIMESTAMPTZ,
      reviewed_by TEXT
    );
    CREATE TABLE IF NOT EXISTS leads (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      email TEXT,
      company TEXT,
      direction TEXT,
      cargo TEXT,
      weight TEXT,
      volume TEXT,
      origin TEXT,
      destination TEXT,
      message TEXT,
      consent BOOLEAN NOT NULL,
      status TEXT NOT NULL DEFAULT 'new',
      admin_note TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS leads_created_idx ON leads (created_at DESC);
    CREATE INDEX IF NOT EXISTS drafts_status_idx ON drafts (status, created_at DESC);
  `);
  for (const key of SECTIONS) {
    await pool.query(
      'INSERT INTO content (key, data, updated_by) VALUES ($1, $2, $3) ON CONFLICT (key) DO NOTHING',
      [key, DEFAULT_CONTENT[key], 'mặc định']
    );
  }
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM admins');
  if (rows[0].n === 0) {
    const u = (process.env.ADMIN_USERNAME || '').trim();
    const p = process.env.ADMIN_PASSWORD || '';
    if (!u || p.length < 10) {
      console.warn('Chưa có tài khoản quản trị. Đặt ADMIN_USERNAME và ADMIN_PASSWORD (ít nhất 10 ký tự) rồi khởi động lại.');
    } else {
      await pool.query('INSERT INTO admins (username, password_hash) VALUES ($1, $2)', [u, await bcrypt.hash(p, 12)]);
      console.log('Đã tạo tài khoản quản trị đầu tiên:', u);
    }
  }
}

/* ---------- Phiên đăng nhập: cookie ký HMAC ---------- */
const b64u = buf => Buffer.from(buf).toString('base64url');
function sign(payload) {
  const body = b64u(JSON.stringify(payload));
  const mac = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
  return body + '.' + mac;
}
function verify(token) {
  if (!token || typeof token !== 'string' || token.indexOf('.') < 0) return null;
  const [body, mac] = token.split('.');
  const expect = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
  const a = Buffer.from(mac || ''), b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    return p.exp > Date.now() ? p : null;
  } catch { return null; }
}
function readCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}
function setSession(res, req, payload) {
  const secure = req.secure ? '; Secure' : '';
  const maxAge = payload ? SESSION_HOURS * 3600 : 0;
  const value = payload ? encodeURIComponent(sign(payload)) : '';
  res.setHeader('Set-Cookie', `d2d_admin=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure}`);
}

/* ---------- Giới hạn tần suất đơn giản theo IP ---------- */
function rateLimit({ windowMs, max }) {
  const hits = new Map();
  setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (v.reset < now) hits.delete(k); }, windowMs).unref();
  return (req, res, next) => {
    const now = Date.now(), k = req.ip;
    const h = hits.get(k) && hits.get(k).reset > now ? hits.get(k) : { n: 0, reset: now + windowMs };
    h.n += 1; hits.set(k, h);
    if (h.n > max) return res.status(429).json({ error: 'Bạn gửi quá nhiều lần. Vui lòng thử lại sau ít phút.' });
    next();
  };
}

/* ---------- Kiểm tra dữ liệu nội dung ---------- */
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
const isStr = (v, max = 2000) => typeof v === 'string' && v.length <= max;
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const isUrl = v => typeof v === 'string' && /^https?:\/\/[^\s<>"']+$/.test(v) && v.length <= 600;
const arr = (v, max, fn) => Array.isArray(v) && v.length <= max && v.every(fn);
function tier(t) {
  return isObj(t) && isNum(t.from) && (t.to === null || isNum(t.to)) && isNum(t.hn) && isNum(t.hcm) &&
    (t.startsAt === undefined || typeof t.startsAt === 'boolean');
}
const VALIDATORS = {
  contact: d => isObj(d) && ['company', 'hotline', 'zalo', 'email', 'address', 'hours'].every(k => d[k] === undefined || isStr(d[k], 300)),
  services: d => isObj(d) && arr(d.items, 20, i => isObj(i) && isStr(i.title, 120) && isStr(i.desc, 500)),
  border: d => isObj(d) && isStr(d.updated, 40) && isStr(d.headline, 200) && isStr(d.lead, 800) &&
    arr(d.stats, 8, s => isObj(s) && isStr(s.value, 30) && isStr(s.label, 300)) &&
    isObj(d.trucks) && isNum(d.trucks.exportTrucks) && isNum(d.trucks.importTrucks) &&
    ['imports', 'exports'].every(k => isObj(d[k]) && arr(d[k].items, 12, i => isObj(i) && isStr(i.name, 120) && isNum(i.value) && isStr(i.change || '', 20))) &&
    arr(d.gates, 15, g => isObj(g) && isStr(g.name, 80) && isStr(g.latest || '', 300) && isStr(g.note || '', 400)) &&
    isObj(d.smartGate) && isNum(d.smartGate.lanesOpen) && isNum(d.smartGate.lanesTarget) && arr(d.smartGate.points, 10, p => isStr(p, 500)) &&
    arr(d.tips, 10, t => isStr(t, 500)) &&
    arr(d.sources, 30, s => isObj(s) && isNum(s.id) && isStr(s.label, 200) && isUrl(s.url)),
  prices: d => isObj(d) && isStr(d.collected, 40) &&
    arr(d.providers, 15, p => isObj(p) && isStr(p.name, 80) && isUrl(p.url) && isStr(p.date || '', 60) && isStr(p.note || '', 400) &&
      arr(p.kg || [], 12, tier) && arr(p.m3 || [], 12, tier)),
  news: d => isObj(d) && arr(d.items, 50, n => isObj(n) && /^\d{4}-\d{2}-\d{2}$/.test(n.date) && isStr(n.title, 200) && isStr(n.summary, 800) && isStr(n.source || '', 100) && (n.url === '' || n.url === undefined || isUrl(n.url)))
};
function validSection(key, data) {
  return SECTIONS.includes(key) && VALIDATORS[key](data) && JSON.stringify(data).length < 200000;
}

/* ---------- Ứng dụng ---------- */
const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});

// CORS cho các API công khai mà website gọi
function publicCors(req, res, next) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Max-Age', '86400');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
}

app.get('/healthz', (req, res) => res.json({ ok: true }));

app.get('/api/content', publicCors, async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT key, data, updated_at FROM content');
    const out = { updatedAt: {} };
    for (const r of rows) { out[r.key] = r.data; out.updatedAt[r.key] = r.updated_at; }
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.json(out);
  } catch (e) { next(e); }
});

const leadLimit = rateLimit({ windowMs: 10 * 60 * 1000, max: 5 });
app.options('/api/leads', publicCors);
app.post('/api/leads', publicCors, express.json({ limit: '20kb' }), leadLimit, async (req, res, next) => {
  try {
    const b = req.body || {};
    if (b.website) return res.json({ ok: true }); // ô bẫy chống spam
    const s = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
    const lead = {
      name: s(b.name, 120), phone: s(b.phone, 30), email: s(b.email, 160), company: s(b.company, 160),
      direction: s(b.direction, 40), cargo: s(b.cargo, 300), weight: s(b.weight, 60), volume: s(b.volume, 60),
      origin: s(b.origin, 160), destination: s(b.destination, 160), message: s(b.message, 2000)
    };
    if (!lead.name) return res.status(400).json({ error: 'Vui lòng nhập họ tên.' });
    if (!/^[+\d][\d\s.\-()]{7,20}$/.test(lead.phone)) return res.status(400).json({ error: 'Số điện thoại chưa đúng. Ví dụ: 0912 345 678.' });
    if (lead.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.email)) return res.status(400).json({ error: 'Email chưa đúng định dạng.' });
    if (b.consent !== true) return res.status(400).json({ error: 'Vui lòng đồng ý để chúng tôi dùng thông tin này liên hệ báo giá.' });
    const cols = Object.keys(lead);
    await pool.query(
      `INSERT INTO leads (${cols.join(',')}, consent) VALUES (${cols.map((_, i) => '$' + (i + 1)).join(',')}, true)`,
      cols.map(c => lead[c] || null)
    );
    res.status(201).json({ ok: true });
  } catch (e) { next(e); }
});

/* ---------- Agent gửi bản nháp ---------- */
function agentAuth(req, res, next) {
  const h = req.headers.authorization || '';
  const tok = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!AGENT_TOKEN || AGENT_TOKEN.length < 24) return res.status(503).json({ error: 'Chưa cấu hình AGENT_TOKEN.' });
  const a = Buffer.from(tok), b = Buffer.from(AGENT_TOKEN);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(401).json({ error: 'Sai mã agent.' });
  next();
}
app.post('/api/agent/drafts', express.json({ limit: '250kb' }), agentAuth, async (req, res, next) => {
  try {
    const { section, data, note, sources } = req.body || {};
    if (!AGENT_SECTIONS.includes(section)) return res.status(400).json({ error: 'section phải là border, prices hoặc news.' });
    if (!validSection(section, data)) return res.status(400).json({ error: `Dữ liệu ${section} sai cấu trúc. Giữ nguyên cấu trúc lấy từ GET /api/content.` });
    if (note !== undefined && !isStr(note, 4000)) return res.status(400).json({ error: 'note quá dài.' });
    if (sources !== undefined && !arr(sources, 40, s => isObj(s) && isUrl(s.url) && isStr(s.label || '', 200))) {
      return res.status(400).json({ error: 'sources phải là danh sách {label, url}.' });
    }
    const { rows } = await pool.query(
      'INSERT INTO drafts (section, data, note, sources) VALUES ($1, $2, $3, $4) RETURNING id',
      [section, data, note || null, sources ? JSON.stringify(sources) : null]
    );
    res.status(201).json({ ok: true, id: rows[0].id });
  } catch (e) { next(e); }
});

/* ---------- Quản trị ---------- */
const adminJson = express.json({ limit: '250kb' });
function sameOrigin(req, res, next) {
  if (req.method === 'GET') return next();
  const origin = req.headers.origin;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  if (origin && new URL(origin).host !== host) return res.status(403).json({ error: 'Yêu cầu không hợp lệ.' });
  if (!req.is('application/json') && req.method !== 'DELETE') return res.status(415).json({ error: 'Yêu cầu không hợp lệ.' });
  next();
}
function requireAdmin(req, res, next) {
  const s = verify(readCookie(req, 'd2d_admin'));
  if (!s) return res.status(401).json({ error: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.' });
  req.admin = s;
  next();
}
const admin = express.Router();
admin.use(sameOrigin);

const loginLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 10 });
admin.post('/login', loginLimit, adminJson, async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    if (!isStr(username, 80) || !isStr(password, 200)) return res.status(400).json({ error: 'Nhập tài khoản và mật khẩu.' });
    const { rows } = await pool.query('SELECT id, username, password_hash FROM admins WHERE username = $1', [username.trim()]);
    const ok = rows[0] && await bcrypt.compare(password, rows[0].password_hash);
    if (!ok) return res.status(401).json({ error: 'Sai tài khoản hoặc mật khẩu.' });
    setSession(res, req, { uid: rows[0].id, u: rows[0].username, exp: Date.now() + SESSION_HOURS * 3600 * 1000 });
    res.json({ ok: true, username: rows[0].username });
  } catch (e) { next(e); }
});
admin.post('/logout', (req, res) => { setSession(res, req, null); res.json({ ok: true }); });
admin.get('/me', requireAdmin, (req, res) => res.json({ username: req.admin.u }));

admin.get('/content', requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT key, data, updated_at, updated_by FROM content');
    res.json(Object.fromEntries(rows.map(r => [r.key, { data: r.data, updatedAt: r.updated_at, updatedBy: r.updated_by }])));
  } catch (e) { next(e); }
});
admin.put('/content/:key', requireAdmin, adminJson, async (req, res, next) => {
  try {
    const key = req.params.key, data = req.body && req.body.data;
    if (!validSection(key, data)) return res.status(400).json({ error: 'Dữ liệu chưa hợp lệ. Kiểm tra các ô số và đường link (phải bắt đầu bằng https://).' });
    await pool.query('UPDATE content SET data = $2, updated_at = now(), updated_by = $3 WHERE key = $1', [key, data, req.admin.u]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

admin.get('/leads', requireAdmin, async (req, res, next) => {
  try {
    const st = LEAD_STATUSES.includes(req.query.status) ? req.query.status : null;
    const { rows } = await pool.query(
      `SELECT * FROM leads ${st ? 'WHERE status = $1' : ''} ORDER BY created_at DESC LIMIT 500`, st ? [st] : []
    );
    const counts = await pool.query('SELECT status, count(*)::int AS n FROM leads GROUP BY status');
    res.json({ items: rows, counts: Object.fromEntries(counts.rows.map(r => [r.status, r.n])) });
  } catch (e) { next(e); }
});
admin.patch('/leads/:id', requireAdmin, adminJson, async (req, res, next) => {
  try {
    const { status, admin_note } = req.body || {};
    if (status !== undefined && !LEAD_STATUSES.includes(status)) return res.status(400).json({ error: 'Trạng thái không hợp lệ.' });
    if (admin_note !== undefined && !isStr(admin_note, 2000)) return res.status(400).json({ error: 'Ghi chú quá dài.' });
    await pool.query(
      'UPDATE leads SET status = COALESCE($2, status), admin_note = COALESCE($3, admin_note) WHERE id = $1',
      [Number(req.params.id), status ?? null, admin_note ?? null]
    );
    res.json({ ok: true });
  } catch (e) { next(e); }
});
admin.delete('/leads/:id', requireAdmin, async (req, res, next) => {
  try { await pool.query('DELETE FROM leads WHERE id = $1', [Number(req.params.id)]); res.json({ ok: true }); }
  catch (e) { next(e); }
});
admin.get('/leads.csv', requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM leads ORDER BY created_at DESC');
    const cols = ['id', 'created_at', 'status', 'name', 'phone', 'email', 'company', 'direction', 'cargo', 'weight', 'volume', 'origin', 'destination', 'message', 'admin_note'];
    const esc = v => {
      let s = v instanceof Date ? v.toISOString() : (v == null ? '' : String(v));
      if (/^[=+\-@]/.test(s)) s = "'" + s; // chống chèn công thức khi mở bằng Excel
      return '"' + s.replace(/"/g, '""') + '"';
    };
    const csv = '﻿' + [cols.join(','), ...rows.map(r => cols.map(c => esc(r[c])).join(','))].join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="khach-hang-doortodoor.csv"');
    res.send(csv);
  } catch (e) { next(e); }
});

admin.get('/drafts', requireAdmin, async (req, res, next) => {
  try {
    const st = ['pending', 'approved', 'rejected'].includes(req.query.status) ? req.query.status : 'pending';
    const { rows } = await pool.query('SELECT * FROM drafts WHERE status = $1 ORDER BY created_at DESC LIMIT 100', [st]);
    res.json({ items: rows });
  } catch (e) { next(e); }
});
admin.post('/drafts/:id/approve', requireAdmin, adminJson, async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query("SELECT * FROM drafts WHERE id = $1 AND status = 'pending' FOR UPDATE", [Number(req.params.id)]);
    if (!rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Bản nháp không còn chờ duyệt.' }); }
    const data = req.body && req.body.data !== undefined ? req.body.data : rows[0].data;
    if (!validSection(rows[0].section, data)) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Dữ liệu chưa hợp lệ.' }); }
    await client.query('UPDATE content SET data = $2, updated_at = now(), updated_by = $3 WHERE key = $1', [rows[0].section, data, req.admin.u + ' (duyệt nháp agent)']);
    await client.query("UPDATE drafts SET status = 'approved', reviewed_at = now(), reviewed_by = $2, data = $3 WHERE id = $1", [rows[0].id, req.admin.u, data]);
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); next(e); }
  finally { client.release(); }
});
admin.post('/drafts/:id/reject', requireAdmin, adminJson, async (req, res, next) => {
  try {
    await pool.query("UPDATE drafts SET status = 'rejected', reviewed_at = now(), reviewed_by = $2 WHERE id = $1 AND status = 'pending'", [Number(req.params.id), req.admin.u]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

admin.get('/users', requireAdmin, async (req, res, next) => {
  try { const { rows } = await pool.query('SELECT id, username, created_at FROM admins ORDER BY id'); res.json({ items: rows }); }
  catch (e) { next(e); }
});
admin.post('/users', requireAdmin, adminJson, async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    if (!isStr(username, 60) || !/^[a-zA-Z0-9._-]{3,60}$/.test(username)) return res.status(400).json({ error: 'Tên đăng nhập 3–60 ký tự, chỉ gồm chữ không dấu, số, dấu chấm, gạch.' });
    if (!isStr(password, 200) || password.length < 10) return res.status(400).json({ error: 'Mật khẩu cần ít nhất 10 ký tự.' });
    await pool.query('INSERT INTO admins (username, password_hash) VALUES ($1, $2)', [username, await bcrypt.hash(password, 12)]);
    res.status(201).json({ ok: true });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Tên đăng nhập đã tồn tại.' });
    next(e);
  }
});
admin.delete('/users/:id', requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (id === req.admin.uid) return res.status(400).json({ error: 'Không thể tự xóa tài khoản đang đăng nhập.' });
    await pool.query('DELETE FROM admins WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});
admin.post('/password', requireAdmin, adminJson, async (req, res, next) => {
  try {
    const { current, next: nw } = req.body || {};
    if (!isStr(nw, 200) || nw.length < 10) return res.status(400).json({ error: 'Mật khẩu mới cần ít nhất 10 ký tự.' });
    const { rows } = await pool.query('SELECT password_hash FROM admins WHERE id = $1', [req.admin.uid]);
    if (!rows[0] || !(await bcrypt.compare(String(current || ''), rows[0].password_hash))) return res.status(401).json({ error: 'Mật khẩu hiện tại chưa đúng.' });
    await pool.query('UPDATE admins SET password_hash = $2 WHERE id = $1', [req.admin.uid, await bcrypt.hash(nw, 12)]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});
app.use('/api/admin', admin);

/* ---------- Khách hàng, vận đơn, tra cứu (customers.js) ---------- */
const customers = mountCustomers({ app, admin, pool, requireAdmin, rateLimit, ALLOWED_ORIGINS, SESSION_SECRET });

/* ---------- Trang quản trị ---------- */
app.use('/admin', express.static(path.join(__dirname, 'admin'), {
  setHeaders: res => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; frame-ancestors 'none'");
  }
}));
app.get('/', (req, res) => res.redirect('/admin/'));

app.use((err, req, res, next) => {
  console.error(err);
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Dữ liệu gửi lên không đọc được.' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Dữ liệu quá lớn.' });
  res.status(500).json({ error: 'Máy chủ gặp lỗi. Vui lòng thử lại.' });
});

initDb()
  .then(() => customers.initTables())
  .then(() => app.listen(PORT, () => console.log('doortodoor server chạy ở cổng', PORT)))
  .catch(e => { console.error('Không khởi tạo được cơ sở dữ liệu', e); process.exit(1); });
