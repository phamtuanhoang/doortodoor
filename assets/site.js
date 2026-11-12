/* Nội dung website lấy từ máy chủ doortodoor (trang admin cập nhật).
   Máy chủ không phản hồi thì dùng bản sao assets/content.json để trang vẫn hiển thị đủ. */
(function () {
  var API = (window.D2D_API || '').replace(/\/$/, '');

  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'text') el.textContent = v; else if (k === 'class') el.className = v; else el.setAttribute(k, v);
    });
    [].concat(kids || []).forEach(function (c) { if (c != null) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return el;
  }
  function slots(name) { return [].slice.call(document.querySelectorAll('[data-render="' + name + '"]')); }
  function fill(name, build) { slots(name).forEach(function (el) { el.textContent = ''; var out = build(); [].concat(out).forEach(function (n) { if (n != null) el.appendChild(typeof n === 'string' ? document.createTextNode(n) : n); }); }); }
  function safeUrl(u) { return /^https?:\/\//.test(u || '') ? u : null; }
  function sup(n) { return n ? h('sup', null, h('a', { href: '#nguon-' + n, 'aria-label': 'Nguồn ' + n, text: String(n) })) : null; }
  var fmtNum = function (n) { return Number(n).toLocaleString('vi-VN'); };
  function fmtDate(iso) { var p = (iso || '').split('-'); return p.length === 3 ? +p[2] + '/' + +p[1] + '/' + p[0] : iso; }

  /* ---------- Dựng các mục từ nội dung ---------- */
  function render(c) {
    var svcs = (c.services && c.services.items) || [];
    function svcCard(s, i) { return h('article', { class: 'svc' }, [h('span', { class: 'eyebrow', text: 'Dịch vụ ' + String(i + 1).padStart(2, '0') }), h('h3', { text: s.title }), h('p', { text: s.desc })]); }
    fill('services-short', function () { return svcs.slice(0, 6).map(svcCard); });
    fill('services-full', function () { return svcs.map(svcCard); });

    var b = c.border || {};
    fill('border-updated', function () { return 'Tình hình biên giới · cập nhật ' + (b.updated || ''); });
    fill('border-headline', function () { return b.headline || ''; });
    fill('border-lead', function () { return b.lead || ''; });
    fill('border-stats', function () {
      return (b.stats || []).map(function (s) { return h('div', { class: 'stat' }, [h('b', { text: s.value }), h('span', null, [s.label, sup(s.source)])]); });
    });
    fill('border-trucks', function () {
      var t = b.trucks; if (!t) return [];
      var total = t.exportTrucks + t.importTrucks, xp = total ? Math.round(t.exportTrucks / total * 1000) / 10 : 0;
      var bar = h('div', { class: 'split-bar', role: 'img', 'aria-label': t.period + ': ' + fmtNum(t.exportTrucks) + ' xe xuất khẩu, ' + fmtNum(t.importTrucks) + ' xe nhập khẩu' }, [h('i', { class: 'x' }), h('i', { class: 'n' })]);
      bar.children[0].style.width = xp + '%'; bar.children[1].style.width = (100 - xp) + '%';
      return [h('h3', null, [t.title, sup(t.source)]), bar, h('div', { class: 'legend num' }, [
        keyed('Xuất khẩu: ' + fmtNum(t.exportTrucks) + ' xe (' + Math.round(xp) + '%)', 'var(--logo)'),
        keyed('Nhập khẩu: ' + fmtNum(t.importTrucks) + ' xe (' + Math.round(100 - xp) + '%)', 'var(--rust-fill)'),
        h('span', { class: 'period', text: 'Tổng ' + fmtNum(total) + ' xe, ' + t.period })])];
    });
    var maxV = Math.max.apply(null, [].concat((b.imports && b.imports.items) || [], (b.exports && b.exports.items) || []).map(function (i) { return i.value; }).concat([1]));
    ['imports', 'exports'].forEach(function (k) {
      fill('border-' + k, function () {
        var g = b[k]; if (!g) return [];
        var color = k === 'imports' ? 'var(--rust-fill)' : 'var(--logo)';
        return [h('h3', { text: g.title }), h('ul', { class: 'rows num' }, (g.items || []).map(function (i) {
          var bar = h('div', { class: 'b' }); bar.style.width = Math.max(1, i.value / maxV * 100) + '%'; bar.style.setProperty('--k', color);
          return h('li', null, [h('div', { class: 't' }, [i.name, h('em', null, [h('b', { text: String(i.value).replace('.', ',') }), i.change ? ' · ' + i.change : ''])]), bar]);
        })), h('p', { class: 'note' }, [g.note + (k === 'imports' ? ' Hai biểu đồ cùng tỷ lệ.' : ''), sup(g.source)])];
      });
    });
    fill('border-gates', function () {
      return (b.gates || []).map(function (g) {
        return h('tr', null, [h('td', null, [g.name, g.zh ? h('span', { class: 'zh', text: g.zh }) : null]), h('td', null, [g.latest, sup(g.source)]), h('td', { text: g.note })]);
      });
    });
    fill('border-smart', function () {
      var s = b.smartGate; if (!s) return [];
      var lanes = h('div', { class: 'lanes', role: 'img', 'aria-label': s.lanesOpen + ' làn đang khai thác, mục tiêu ' + s.lanesTarget + ' làn' });
      lanes.style.gridTemplateColumns = 'repeat(' + Math.max(1, s.lanesTarget) + ',minmax(0,1fr))';
      for (var i = 0; i < s.lanesTarget; i++) lanes.appendChild(h('i', { class: i < s.lanesOpen ? null : 'todo' }));
      return [h('div', null, [h('h2', { text: 'Cửa khẩu thông minh Hữu Nghị' }), lanes, h('p', { class: 'eyebrow num', text: s.lanesOpen + ' làn đang khai thác · mục tiêu ' + s.lanesTarget + ' làn' })]),
        h('div', null, h('ul', { class: 'bul' }, (s.points || []).map(function (p, i, a) { return h('li', null, [p, i === a.length - 1 ? sup(s.source) : null]); })))];
    });
    fill('border-tips', function () {
      return [h('h3', { text: 'Điều này có nghĩa gì với lô hàng của bạn' }), h('ul', { class: 'bul' }, (b.tips || []).map(function (t) { return h('li', { text: t }); }))];
    });
    fill('border-sources', function () {
      return [h('p', { class: 'eyebrow', text: 'Nguồn số liệu' }), h('ol', null, (b.sources || []).map(function (s) {
        return h('li', { id: 'nguon-' + s.id, value: String(s.id) }, safeUrl(s.url) ? h('a', { href: s.url, target: '_blank', rel: 'noopener', text: s.label }) : s.label);
      }))];
    });

    var news = ((c.news && c.news.items) || []).slice().sort(function (a, z) { return a.date < z.date ? 1 : -1; });
    function link(n) { return safeUrl(n.url) ? h('a', { href: n.url, target: '_blank', rel: 'noopener', text: 'Đọc bài gốc' + (n.source ? ' trên ' + n.source : '') }) : (n.source ? h('span', { class: 'note', text: 'Nguồn: ' + n.source }) : null); }
    fill('news-short', function () {
      if (!news.length) return h('p', { class: 'empty', text: 'Chưa có tin mới.' });
      return news.slice(0, 3).map(function (n) { return h('article', { class: 'news-card' }, [h('time', { datetime: n.date, text: fmtDate(n.date) }), h('h3', { text: n.title }), h('p', { text: n.summary }), link(n)]); });
    });
    fill('news-full', function () {
      if (!news.length) return h('p', { class: 'empty', text: 'Chưa có tin mới.' });
      return news.map(function (n) { return h('article', { class: 'news-item' }, [h('time', { datetime: n.date, text: fmtDate(n.date) }), h('div', null, [h('h3', { text: n.title }), h('p', { text: n.summary }), link(n)])]); });
    });

    var ct = c.contact || {};
    function val(v, kind) {
      if (!v) return h('span', { class: 'pending', text: 'Đang cập nhật' });
      if (kind === 'tel') return h('a', { href: 'tel:' + v.replace(/[^\d+]/g, ''), text: v });
      if (kind === 'mail') return h('a', { href: 'mailto:' + v, text: v });
      return v;
    }
    fill('contact', function () {
      return [h('h2', { text: 'Liên hệ trực tiếp' }), h('dl', null, [
        h('div', null, [h('dt', { text: 'Hotline' }), h('dd', null, val(ct.hotline, 'tel'))]),
        h('div', null, [h('dt', { text: 'Zalo' }), h('dd', null, val(ct.zalo))]),
        h('div', null, [h('dt', { text: 'Email' }), h('dd', null, val(ct.email, 'mail'))]),
        h('div', null, [h('dt', { text: 'Địa chỉ' }), h('dd', null, val(ct.address))]),
        ct.hours ? h('div', null, [h('dt', { text: 'Giờ làm việc' }), h('dd', { text: ct.hours })]) : null
      ])];
    });
    fill('footer-contact', function () { return [ct.hotline ? 'Hotline ' + ct.hotline : null, ct.hotline && ct.email ? ' · ' : null, ct.email || null].filter(Boolean).join(''); });

    prices = (c.prices && c.prices.providers) || [];
    fill('prices-collected', function () { return 'So sánh cước · thu thập ngày ' + ((c.prices && c.prices.collected) || ''); });
    renderPrices();
  }
  function keyed(text, color) { var s = h('span', { class: 'key', text: text }); s.style.setProperty('--k', color); return s; }

  /* ---------- So sánh cước ---------- */
  var prices = [];
  var fmtVnd = function (n) { return Math.round(n).toLocaleString('vi-VN') + ' đ'; };
  function cell(tiers, qty, dest, unit) {
    if (!tiers || !tiers.length) return h('span', { class: 'na', text: 'Không công bố' });
    if (!(qty > 0)) return h('span', { class: 'na', text: 'Chưa nhập' });
    var t = tiers.filter(function (r) { return qty >= r.from && (r.to == null || qty < r.to); })[0];
    if (!t) return h('span', { class: 'na', text: 'Ngoài bảng giá, cần liên hệ' });
    var p = t[dest], tu = t.startsAt ? 'từ ' : '';
    return [h('b', { text: tu + fmtVnd(p * qty) }), h('small', { text: tu + fmtVnd(p) + '/' + unit })];
  }
  function renderPrices() {
    var body = document.getElementById('compare-body'); if (!body) return;
    var kg = parseFloat(document.getElementById('kg').value), m3 = parseFloat(document.getElementById('m3').value), dest = document.getElementById('noi-giao').value;
    body.textContent = '';
    prices.forEach(function (d) {
      body.appendChild(h('tr', null, [h('td', { text: d.name }), h('td', { class: 'num' }, cell(d.kg, kg, dest, 'kg')), h('td', { class: 'num' }, cell(d.m3, m3, dest, 'm³')), h('td', { text: d.note || '' }),
        h('td', null, [safeUrl(d.url) ? h('a', { href: d.url, target: '_blank', rel: 'noopener', text: 'Xem bảng giá' }) : null, h('small', { text: d.date || '' })])]));
    });
  }
  ['kg', 'm3', 'noi-giao'].forEach(function (id) { var el = document.getElementById(id); el.addEventListener('input', renderPrices); el.addEventListener('change', renderPrices); });
  document.getElementById('calc').addEventListener('submit', function (e) { e.preventDefault(); });

  /* ---------- Tải nội dung ---------- */
  function loadFallback() { return fetch('assets/content.json').then(function (r) { return r.json(); }); }
  var source = API ? fetch(API + '/api/content').then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }).catch(loadFallback) : loadFallback();
  source.then(render).catch(function () {});

  /* ---------- Điều hướng ---------- */
  var views = [].slice.call(document.querySelectorAll('[data-view]'));
  var links = [].slice.call(document.querySelectorAll('.menu a'));
  var menu = document.getElementById('menu'), menuBtn = document.getElementById('menu-btn');
  function route() {
    var hash = location.hash.slice(1), isSource = hash.indexOf('nguon-') === 0;
    var v = isSource ? 'cua-khau' : (views.some(function (s) { return s.dataset.view === hash; }) ? hash : 'trang-chu');
    views.forEach(function (s) { s.hidden = s.dataset.view !== v; });
    links.forEach(function (a) { if (a.getAttribute('href') === '#' + v && !a.classList.contains('menu-cta')) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    menu.classList.remove('open'); menuBtn.setAttribute('aria-expanded', 'false');
    if (isSource) { var t = document.getElementById(hash); if (t) t.scrollIntoView(); } else window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', route);
  menuBtn.addEventListener('click', function () { var o = menu.classList.toggle('open'); menuBtn.setAttribute('aria-expanded', String(o)); });
  route();

  /* ---------- Nút "Tìm hiểu hành trình lô hàng" ---------- */
  var jBtn = document.getElementById('journey-btn'), jSec = document.getElementById('hanh-trinh'), jClose = document.getElementById('journey-close');
  function journey(open) {
    jSec.hidden = !open; jBtn.setAttribute('aria-expanded', String(open));
    if (open) jSec.scrollIntoView({ block: 'start' }); else jBtn.focus();
  }
  if (jBtn && jSec) {
    jBtn.addEventListener('click', function () { journey(jSec.hidden); });
    if (jClose) jClose.addEventListener('click', function () { journey(false); });
  }

  /* ---------- Form liên hệ ---------- */
  var form = document.getElementById('lead-form'), msg = document.getElementById('l-msg'), btn = document.getElementById('l-submit');
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    msg.className = 'form-msg'; msg.textContent = '';
    var data = {};
    ['name', 'phone', 'email', 'company', 'direction', 'cargo', 'weight', 'volume', 'origin', 'destination', 'message', 'website'].forEach(function (k) { data[k] = (form.elements[k].value || '').trim(); });
    data.consent = form.elements.consent.checked;
    var bad = function (t, el) { msg.className = 'form-msg bad'; msg.textContent = t; if (el) el.focus(); };
    if (!data.name) return bad('Vui lòng nhập họ tên.', form.elements.name);
    if (!/^[+\d][\d\s.\-()]{7,20}$/.test(data.phone)) return bad('Số điện thoại chưa đúng. Ví dụ: 0912 345 678.', form.elements.phone);
    if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) return bad('Email chưa đúng định dạng.', form.elements.email);
    if (!data.consent) return bad('Vui lòng đánh dấu đồng ý để chúng tôi liên hệ báo giá.', form.elements.consent);
    if (!API) return bad('Form đang bảo trì. Vui lòng liên hệ trực tiếp qua hotline hoặc Zalo.');
    btn.disabled = true; btn.textContent = 'Đang gửi…';
    fetch(API + '/api/leads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.error || 'Chưa gửi được.'); }); })
      .then(function () {
        form.reset();
        msg.className = 'form-msg ok';
        msg.textContent = 'Đã gửi. Chúng tôi sẽ liên hệ lại với bạn trong giờ làm việc.';
      })
      .catch(function (err) { bad((err && err.message && err.message !== 'Failed to fetch' ? err.message : 'Chưa gửi được do lỗi kết nối.') + ' Bạn thử lại, hoặc liên hệ qua hotline.'); })
      .finally(function () { btn.disabled = false; btn.textContent = 'Gửi yêu cầu'; });
  });
})();
