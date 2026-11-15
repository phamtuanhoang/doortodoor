'use strict';
/*
  Captcha tự sinh (không cần tài khoản Google/Cloudflare).
  Máy chủ vẽ ảnh SVG 5 ký tự bằng đường nét (không có chữ thật trong mã SVG) và trả về một mã ký HMAC.
  Mã chỉ dùng được một lần, hết hạn sau 5 phút. Không lưu gì vào cơ sở dữ liệu.
*/
const crypto = require('crypto');
const svgCaptcha = require('svg-captcha');

const TTL = 5 * 60 * 1000;
const INKS = ['#4F2E16', '#7A3A12', '#2A1A0E', '#8C4A1C', '#5B3A1E'];

module.exports = function makeCaptcha(SESSION_SECRET) {
  const KEY = crypto.createHmac('sha256', SESSION_SECRET).update('d2d-captcha-v1').digest();
  const used = new Map(); // mã đã dùng -> hạn
  setInterval(() => { const now = Date.now(); for (const [k, exp] of used) if (exp < now) used.delete(k); }, 60 * 1000).unref();
  const mac = s => crypto.createHmac('sha256', KEY).update(s).digest('base64url');

  function create() {
    const c = svgCaptcha.create({ size: 5, noise: 3, charPreset: 'ABCDEFGHJKMNPQRSTUVWXYZ23456789', background: '#FFFDF8', width: 160, height: 54, fontSize: 58 });
    const svg = c.data
      .replace(/fill="#(?!FFFDF8)[0-9a-fA-F]{3,6}"/g, () => 'fill="' + INKS[crypto.randomInt(INKS.length)] + '"')
      .replace(/stroke="#[0-9a-fA-F]{3,6}"/g, 'stroke="#C8561B" stroke-opacity="0.7"');
    const n = crypto.randomBytes(12).toString('base64url'), exp = Date.now() + TTL;
    const body = Buffer.from(JSON.stringify({ n, exp, h: mac(n + ':' + c.text.toUpperCase()) })).toString('base64url');
    return { token: body + '.' + mac(body), image: 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64') };
  }

  function check(token, answer) {
    if (typeof token !== 'string' || typeof answer !== 'string' || token.split('.').length !== 2) return false;
    const [body, sig] = token.split('.');
    const a = Buffer.from(sig), b = Buffer.from(mac(body));
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
    let p; try { p = JSON.parse(Buffer.from(body, 'base64url').toString()); } catch { return false; }
    if (!p || p.exp < Date.now() || used.has(p.n)) return false;
    used.set(p.n, p.exp); // mỗi ảnh chỉ được thử một lần
    const want = Buffer.from(p.h), got = Buffer.from(mac(p.n + ':' + answer.trim().toUpperCase().replace(/\s+/g, '')));
    return want.length === got.length && crypto.timingSafeEqual(want, got);
  }

  // Middleware: yêu cầu captcha đúng trong body (captcha_token, captcha)
  function require_(req, res, next) {
    const b = req.body || {};
    if (!check(b.captcha_token, b.captcha)) return res.status(400).json({ error: 'Mã xác nhận chưa đúng hoặc đã hết hạn. Vui lòng nhập mã mới.', captcha: true });
    next();
  }

  return { create, check, require: require_ };
};
