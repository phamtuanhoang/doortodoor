/* Bản đồ tuyến Bằng Tường – Hà Nội trên ảnh nền.
   Tọa độ lấy theo pixel trên ảnh rồi đổi sang kinh vĩ độ; tuyến đi bám các đường hiện trên ảnh, mang tính minh họa. */
(function () {
  var box = document.getElementById('route-map');
  if (!box) return;
  var mapEl = document.getElementById('map-canvas');
  var capEl = document.getElementById('map-cap'), playBtn = document.getElementById('map-play');
  var stepBtns = [].slice.call(box.querySelectorAll('.step-btn')), gateBtns = [].slice.call(box.querySelectorAll('.gate-chip'));
  var GATES = ['Puzhai – Tân Thanh', 'Bằng Tường – Hữu Nghị', 'Ái Điểm – Chi Ma'], VNG = ['Tân Thanh', 'Hữu Nghị', 'Chi Ma'];
  var CAP = { 0: 'Tuyến Bằng Tường – Hà Nội', 1: 'Bước 1 · Hàng tại nhà xưởng, kho, nhà cung cấp', 2: 'Bước 2 · Tập trung tại kho trung chuyển Bằng Tường', 5: 'Bước 5 · Vận chuyển về kho tại Hà Nội', 6: 'Bước 6 · Giao hàng cho khách' };

  function G(x, y) { return [105.85 + (x - 290) / 464, 21.03 + (724 - y) / 511]; }
  function L(a) { return a.map(function (p) { return G(p[0], p[1]); }); }
  var P = { xuong: G(985, 42), bt: G(707, 202), puzhai: G(683, 227), youyi: G(689, 239), aidian: G(853, 309), tt: G(676, 238), hn: G(685, 250), cm: G(837, 323), dd: G(682, 266), ls: G(713, 310), lb: G(784, 347), kho: G(290, 724), fitW: G(70, 640), fitE: G(610, 760), fitN: G(300, 520) };
  var SPOKES = L([[305, 530], [200, 560], [95, 620], [60, 715], [150, 762], [300, 764], [455, 760], [600, 690], [520, 600], [425, 540]]);
  var ROUTES = {
    a: [P.xuong].concat(L([[905, 105], [829, 159], [778, 179], [753, 190], [730, 197]]), [P.bt]),
    cn0: [P.bt].concat(L([[695, 221]]), [P.puzhai, P.tt]), cn1: [P.bt].concat(L([[695, 221]]), [P.youyi, P.hn]),
    cn2: [P.bt].concat(L([[713, 210], [736, 232], [758, 239], [782, 243], [800, 257], [816, 250], [842, 249], [853, 266], [864, 296]]), [P.aidian, P.cm]),
    vn0: [P.tt].concat(L([[672, 247]]), [P.dd]).concat(L([[703, 288]]), [P.ls]), vn1: [P.hn, P.dd].concat(L([[703, 288]]), [P.ls]),
    vn2: [P.cm].concat(L([[825, 345]]), [P.lb]).concat(L([[755, 331], [727, 309]]), [P.ls]),
    b: [P.ls].concat(L([[706, 340], [690, 362], [664, 386], [632, 408], [592, 450], [574, 462], [536, 492], [500, 528], [492, 548], [476, 576], [460, 602], [416, 616], [404, 640], [372, 660], [332, 700]]), [P.kho])
  };
  var LABELS = [
    { id: 'xuong', t: 'Nhà xưởng, kho, nhà cung cấp', s: [0, 1, 2], on: [1], side: -1 },
    { id: 'bt', t: 'Kho trung chuyển Bằng Tường', zh: '凭祥', s: [0, 1, 2, 3], on: [2] },
    { id: 'puzhai', t: 'Puzhai', zh: '浦寨', s: [3], g: 0, side: -1 },
    { id: 'youyi', t: 'Hữu Nghị Quan', zh: '友谊关', s: [3], g: 1, side: 1 },
    { id: 'aidian', t: 'Ái Điểm', zh: '爱店', s: [3], g: 2 },
    { id: 'tt', t: 'Tân Thanh', s: [0, 4], g: 0, dn: 1, side: -1 },
    { id: 'hn', t: 'Hữu Nghị', s: [0, 4], g: 1, dn: 1, side: 1 },
    { id: 'cm', t: 'Chi Ma', s: [0, 4], g: 2, dn: 1 },
    { id: 'ls', t: 'Lạng Sơn', s: [4, 5] },
    { id: 'kho', t: 'Kho tại Hà Nội', s: [0, 5, 6], on: [5, 6] }
  ];
  var FIT = { 0: ['xuong', 'kho', 'cm'], 1: ['xuong', 'bt'], 2: ['xuong', 'bt'], 3: ['bt', 'puzhai', 'aidian', 'tt', 'cm'], 4: ['tt', 'hn', 'cm', 'ls'], 5: ['hn', 'kho'], 6: ['fitW', 'fitE', 'fitN'] };
  var MOVE = 3200, reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var step = 0, gate = 1, auto = false, t0 = 0;

  function pathFor() { return step === 2 ? 'a' : step === 3 ? 'cn' + gate : step === 4 ? 'vn' + gate : step === 5 ? 'b' : null; }
  function order() { return ['a', 'cn' + gate, 'vn' + gate, 'b']; }
  function routeState(k) { var o = order(), i = o.indexOf(k), c = o.indexOf(pathFor()); return i < 0 ? 'off' : k === pathFor() ? 'cur' : (step === 6 || (c >= 0 && i < c)) ? 'done' : 'next'; }
  function isHot(l) { return (l.g === gate && (step === 3 || step === 4)) || !!(l.on && l.on.indexOf(step) >= 0); }
  function isShown(l) { return l.s.indexOf(step) >= 0; }
  function pointAt(r, e) {
    var len = [], sum = 0, i;
    for (i = 0; i < r.length - 1; i++) { var d = Math.hypot(r[i + 1][0] - r[i][0], r[i + 1][1] - r[i][1]); len.push(d); sum += d; }
    var left = e * sum;
    for (i = 0; i < len.length; i++) { if (left <= len[i] || i === len.length - 1) { var f = len[i] ? left / len[i] : 0; return [r[i][0] + (r[i + 1][0] - r[i][0]) * f, r[i][1] + (r[i + 1][1] - r[i][1]) * f]; } left -= len[i]; }
    return r[r.length - 1];
  }
  function bounds(ids) { var a = [1e9, 1e9, -1e9, -1e9]; ids.forEach(function (k) { var p = P[k]; a[0] = Math.min(a[0], p[0]); a[1] = Math.min(a[1], p[1]); a[2] = Math.max(a[2], p[0]); a[3] = Math.max(a[3], p[1]); }); return a; }

  var NS = 'http://www.w3.org/2000/svg', IW = 1161, IH = 772, A = IW / IH;
  function px(p) { return [290 + 464 * (p[0] - 105.85), 724 - 511 * (p[1] - 21.03)]; }
  function el(n, a, parent) { var e = document.createElementNS(NS, n); for (var k in a) e.setAttribute(k, a[k]); if (parent) parent.appendChild(e); return e; }
  var svg = el('svg', { 'class': 'route-svg', preserveAspectRatio: 'xMidYMid meet', 'aria-hidden': 'true' }, mapEl);
  el('image', { href: 'assets/map.jpg', x: 0, y: 0, width: IW, height: IH }, svg);
  var lines = {};
  Object.keys(ROUTES).forEach(function (k) { lines[k] = el('polyline', { points: ROUTES[k].map(function (p) { return px(p).join(','); }).join(' ') }, svg); });
  var pins = LABELS.map(function (l) {
    var c = px(P[l.id]), g = el('g', {}, svg), dot = el('circle', { cx: c[0], cy: c[1] }, g), t = el('text', {}, g);
    t.textContent = l.t + (l.zh ? ' ' + l.zh : ''); return { l: l, g: g, dot: dot, t: t, c: c };
  });
  var hub = px(P.kho), spokes = SPOKES.map(function (p) {
    var g = el('g', { 'class': 'spoke' }, svg); g.style.display = 'none';
    var e = px(p);
    return { g: g, e: e, line: el('line', { x1: hub[0], y1: hub[1], x2: hub[0], y2: hub[1] }, g), head: el('polygon', { points: '0,0 -11,5 -11,-5' }, g), a: Math.atan2(e[1] - hub[1], e[0] - hub[0]) * 180 / Math.PI };
  });
  var parcel = el('g', { 'class': 'route-box' }, svg);
  el('polygon', { points: '0,-13 13,-6 0,1 -13,-6', 'class': 'box-top' }, parcel);
  el('polygon', { points: '-13,-6 0,1 0,14 -13,7', 'class': 'box-left' }, parcel);
  el('polygon', { points: '13,-6 0,1 0,14 13,7', 'class': 'box-right' }, parcel);
  el('polygon', { points: '-7,-9.2 -3.5,-11 9.5,-4.2 6,-2.4', 'class': 'box-tape' }, parcel);
  var vb = [0, 0, IW, IH], want = vb.slice();
  function fit() {
    var b = bounds(FIT[step]), a = px([b[0], b[3]]), c = px([b[2], b[1]]);
    var w = Math.min(IW, Math.max(300, (c[0] - a[0]) * 1.3, (c[1] - a[1]) * 1.3 * A)), h = w / A;
    if (step === 0) { w = IW; h = IH; }
    var x = Math.max(0, Math.min(IW - w, (a[0] + c[0] - w) / 2)), y = Math.max(0, Math.min(IH - h, (a[1] + c[1] - h) / 2));
    want = [x, y, w, h];
    if (reduced) vb = want.slice();
  }
  function update() {
    Object.keys(lines).forEach(function (k) { lines[k].setAttribute('class', 'rt rt-' + routeState(k)); });
    pins.forEach(function (p) { p.g.style.display = isShown(p.l) ? '' : 'none'; p.g.setAttribute('class', isHot(p.l) ? 'pin hot' : 'pin'); });
    spokes.forEach(function (p) { p.g.style.display = step === 6 ? '' : 'none'; });
    fit();
  }
  function draw(pos) {
    var r = mapEl.getBoundingClientRect(); if (!r.width) return;
    var k = reduced ? 1 : .06; for (var i = 0; i < 4; i++) vb[i] += (want[i] - vb[i]) * k;
    svg.setAttribute('viewBox', vb.join(' '));
    var u = Math.max(vb[2] / r.width, vb[3] / r.height);
    pins.forEach(function (p) {
      var side = p.l.side || 0;
      p.dot.setAttribute('r', 5 * u);
      p.t.setAttribute('font-size', 13 * u); p.t.setAttribute('stroke-width', 4 * u);
      p.t.setAttribute('x', p.c[0] + side * 9 * u);
      p.t.setAttribute('y', p.c[1] + (p.l.dn ? 19 : -10) * u);
      p.t.setAttribute('text-anchor', side < 0 ? 'end' : side > 0 ? 'start' : 'middle');
    });
    spokes.forEach(function (p, i) {
      if (step !== 6) return;
      var e = reduced ? 1 : Math.max(0, Math.min(1, (performance.now() - t0 - i * 70) / 1300)); e = 1 - (1 - e) * (1 - e);
      var x = hub[0] + (p.e[0] - hub[0]) * e, y = hub[1] + (p.e[1] - hub[1]) * e;
      p.line.setAttribute('x2', x); p.line.setAttribute('y2', y);
      p.head.setAttribute('transform', 'translate(' + x + ',' + y + ') rotate(' + p.a + ') scale(' + (1.1 * u) + ')');
    });
    var q = px(pos); parcel.setAttribute('transform', 'translate(' + q[0] + ',' + q[1] + ') scale(' + (1.15 * u) + ')');
  }
  function ui() {
    capEl.textContent = step === 3 ? 'Bước 3 · Báo quan đầu Trung Quốc, qua cửa khẩu ' + GATES[gate] : step === 4 ? 'Bước 4 · Thông quan tại cửa khẩu ' + VNG[gate] : CAP[step];
    stepBtns.forEach(function (b) { if (+b.dataset.step === step) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current'); });
    gateBtns.forEach(function (b) { b.setAttribute('aria-pressed', String(+b.dataset.gate === gate)); });
    playBtn.textContent = auto ? 'Dừng tự chạy' : 'Tự chạy';
  }
  function go(s, g) { step = s; if (g !== undefined) gate = g; t0 = reduced ? -1e9 : performance.now(); ui(); update(); }
  var timer = null;
  function setAuto(on) {
    auto = on; clearInterval(timer);
    timer = on ? setInterval(function () { if (!document.hidden && box.offsetParent) { var n = step + 1; if (n > 6) { n = 1; gate = (gate + 1) % 3; } go(n); } }, 5200) : null;
    ui();
  }
  stepBtns.concat(gateBtns).forEach(function (b) { b.addEventListener('click', function () { setAuto(false); go(+b.dataset.step, b.dataset.gate === undefined ? undefined : +b.dataset.gate); }); });
  playBtn.addEventListener('click', function () { setAuto(!auto); });
  function frame() {
    requestAnimationFrame(frame);
    if (document.hidden || !box.offsetParent) return;
    var k = pathFor(), pos;
    if (k) { var e = Math.min(1, (performance.now() - t0) / MOVE); pos = pointAt(ROUTES[k], e * e * (3 - 2 * e)); }
    else pos = step === 0 ? P.bt : step === 6 ? P.kho : P.xuong;
    draw(pos);
  }
  go(0); setAuto(!reduced); requestAnimationFrame(frame);
})();
