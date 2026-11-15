/* Khu vực khách hàng: đăng ký / đăng nhập bằng số điện thoại, tạo vận đơn, theo dõi hành trình,
   xác nhận đã nhận hàng; và trang tra cứu vận đơn công khai.
   Phiên đăng nhập là mã Bearer do máy chủ cấp, lưu ở trình duyệt của khách. */
(function () {
  var API = (window.D2D_API || '').replace(/\/$/, '');
  var root = document.getElementById('acct-root');
  var trackRoot = document.getElementById('track-result');
  if (!root) return;

  var STEPS = [
    ['created', 'Đã tạo đơn', 'Bạn đã tạo vận đơn trên website'],
    ['received_cn', 'Nhập kho Bằng Tường', 'Kho doortodoor tại Bằng Tường nhận hàng'],
    ['at_hn', 'Về kho Hà Nội', 'Hàng qua cửa khẩu, về kho Hà Nội'],
    ['delivered', 'Đã nhận', 'Bạn xác nhận đã nhận đủ hàng']
  ];
  var LABEL = { cancelled: 'Đã hủy' };
  STEPS.forEach(function (s) { LABEL[s[0]] = s[1]; });
  var IDX = {}; STEPS.forEach(function (s, i) { IDX[s[0]] = i; });

  /* ---------- Tiện ích ---------- */
  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'text') el.textContent = v;
      else if (k === 'class') el.className = v;
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    });
    (function add(k) {
      if (Array.isArray(k)) return k.forEach(add);
      if (k != null && k !== false) el.appendChild(typeof k === 'string' ? document.createTextNode(k) : k);
    })(kids);
    return el;
  }
  function mount(el, kids) { el.textContent = ''; [].concat(kids).forEach(function (k) { if (k) el.appendChild(k); }); }
  function fmtTime(iso) {
    if (!iso) return '';
    try { return new Date(iso).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' }); }
    catch (e) { return iso; }
  }
  function fmtN(n, unit) { return n == null ? null : Number(n).toLocaleString('vi-VN', { maximumFractionDigits: 3 }) + ' ' + unit; }
  var store = { // localStorage có thể bị chặn (chế độ riêng tư): giữ bản trong bộ nhớ
    mem: null,
    get: function () { try { return localStorage.getItem('d2d_c') || this.mem; } catch (e) { return this.mem; } },
    set: function (v) { this.mem = v; try { if (v) localStorage.setItem('d2d_c', v); else localStorage.removeItem('d2d_c'); } catch (e) {} }
  };
  var me = null;

  function api(method, path, body, auth) {
    if (!API) return Promise.reject(new Error('Hệ thống đang bảo trì. Vui lòng thử lại sau.'));
    var headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (auth !== false && store.get()) headers.Authorization = 'Bearer ' + store.get();
    return fetch(API + path, { method: method, headers: headers, body: body === undefined ? undefined : JSON.stringify(body) })
      .catch(function () { throw new Error('Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.'); })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (r.status === 401 && auth !== false && path.indexOf('/login') < 0) { store.set(null); me = null; updateNav(); }
          if (!r.ok) { var e = new Error(j.error || 'Có lỗi xảy ra, vui lòng thử lại.'); e.status = r.status; throw e; }
          return j;
        });
      });
  }
  function msgEl() { return h('p', { class: 'form-msg', role: 'status', 'aria-live': 'polite' }); }
  function say(el, text, ok) { el.className = 'form-msg ' + (ok ? 'ok' : 'bad'); el.textContent = text; }
  function busy(btn, p, label) {
    var old = btn.textContent; btn.disabled = true; btn.textContent = label || 'Đang xử lý…';
    return p.finally(function () { btn.disabled = false; btn.textContent = old; });
  }
  function field(id, label, input, hint, req) {
    input.id = id;
    return h('div', { class: 'f' }, [h('label', { for: id }, [label, req ? h('span', { class: 'req', text: ' *' }) : null]), input, hint ? h('small', { class: 'hint', text: hint }) : null]);
  }
  function badge(st) { return h('span', { class: 'st st-' + st, text: LABEL[st] || st }); }

  /* ---------- Menu: "Đăng nhập" hoặc "Đơn hàng của tôi" ---------- */
  var navLink = document.getElementById('nav-account');
  function updateNav() { if (navLink) navLink.textContent = store.get() ? 'Đơn hàng của tôi' : 'Đăng nhập'; }
  updateNav();

  /* ---------- Thanh hành trình ---------- */
  function timeline(order, events, withNotes) {
    var byStatus = {};
    events.forEach(function (e) { (byStatus[e.status] = byStatus[e.status] || []).push(e); });
    var cur = order.status === 'delivered' ? STEPS.length : (IDX[order.status] != null ? IDX[order.status] : -1);
    if (order.status === 'cancelled') {
      var c = (byStatus.cancelled || [])[0];
      return h('div', { class: 'cancelled-box' }, [h('b', { text: 'Vận đơn đã hủy' }), c ? h('span', { text: ' · ' + fmtTime(c.created_at) }) : null, c && withNotes && c.note ? h('p', { text: c.note }) : null]);
    }
    return h('ol', { class: 'tl', 'aria-label': 'Hành trình đơn hàng' }, STEPS.map(function (s, i) {
      var evs = byStatus[s[0]] || [];
      var state = i < cur ? 'done' : i === cur ? 'now' : 'todo';
      return h('li', { class: 'tl-' + state, 'aria-current': state === 'now' ? 'step' : null }, [
        h('span', { class: 'tl-dot', 'aria-hidden': 'true' }),
        h('div', { class: 'tl-body' }, [
          h('b', { text: s[1] }),
          evs.length ? null : h('span', { class: 'tl-sub', text: state === 'todo' ? s[2] : '' }),
          evs.map(function (e) {
            return h('div', { class: 'tl-ev' }, [
              h('time', { datetime: e.created_at, text: fmtTime(e.created_at) }),
              withNotes && e.note ? h('p', { text: e.note }) : null
            ]);
          })
        ])
      ]);
    }));
  }

  /* ---------- Đăng nhập / đăng ký ---------- */
  function authPage(mode) {
    var isReg = mode === 'dang-ky';
    var tabs = h('div', { class: 'seg', role: 'tablist' }, [
      h('a', { href: '#tai-khoan', role: 'tab', 'aria-selected': String(!isReg), text: 'Đăng nhập' }),
      h('a', { href: '#tai-khoan/dang-ky', role: 'tab', 'aria-selected': String(isReg), text: 'Tạo tài khoản' })
    ]);
    var phone = h('input', { type: isReg ? 'tel' : 'text', autocomplete: isReg ? 'tel' : 'username', autocapitalize: 'none', spellcheck: 'false', inputmode: isReg ? 'tel' : null, maxlength: '40', placeholder: '0912 345 678', required: true });
    var pw = h('input', { type: 'password', autocomplete: isReg ? 'new-password' : 'current-password', maxlength: '200', required: true });
    var name = h('input', { autocomplete: 'name', maxlength: '120' });
    var company = h('input', { autocomplete: 'organization', maxlength: '160' });
    var consent = h('input', { type: 'checkbox', id: 'c-consent' });
    var msg = msgEl();
    var btn = h('button', { class: 'btn btn-main', type: 'submit', text: isReg ? 'Tạo tài khoản' : 'Đăng nhập' });
    var form = h('form', { class: 'acct-card', novalidate: true }, [
      tabs,
      isReg ? field('c-name', 'Họ tên', name, null, true) : null,
      field('c-phone', isReg ? 'Số điện thoại' : 'Số điện thoại hoặc tên đăng nhập', phone, isReg ? 'Số này dùng để đăng nhập và để nhân viên liên hệ khi giao hàng.' : null, true),
      field('c-pw', 'Mật khẩu', pw, isReg ? 'Ít nhất 6 ký tự.' : null, true),
      isReg ? field('c-company', 'Công ty / cửa hàng', company) : null,
      isReg ? h('div', { class: 'f consent' }, [consent, h('label', { for: 'c-consent', text: 'Tôi đồng ý để doortodoor lưu số điện thoại, họ tên và thông tin đơn hàng để vận chuyển và liên hệ giao hàng.' })]) : null,
      h('div', { class: 'form-foot' }, [btn, msg]),
      isReg ? null : h('p', { class: 'hint', text: 'Quên mật khẩu? Liên hệ hotline doortodoor, nhân viên sẽ cấp lại mật khẩu mới cho bạn.' })
    ]);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var body = { phone: phone.value, password: pw.value };
      if (isReg) {
        if (!name.value.trim()) return say(msg, 'Vui lòng nhập họ tên.'), name.focus();
        if (pw.value.length < 6) return say(msg, 'Mật khẩu cần ít nhất 6 ký tự.'), pw.focus();
        if (!consent.checked) return say(msg, 'Vui lòng đánh dấu đồng ý để tạo tài khoản.'), consent.focus();
        body.name = name.value; body.company = company.value; body.consent = true;
      }
      busy(btn, api('POST', '/api/customer/' + (isReg ? 'register' : 'login'), body, false).then(function (r) {
        store.set(r.token); me = r.customer; updateNav();
        if (location.hash === '#tai-khoan') render(); else location.hash = '#tai-khoan';
      }).catch(function (err) { say(msg, err.message); }));
    });
    return [head('Khách hàng', isReg ? 'Tạo tài khoản để gửi vận đơn' : 'Đăng nhập để theo dõi đơn hàng',
      'Tạo vận đơn cho hàng từ Trung Quốc về Việt Nam và xem hàng đang ở đâu trên hành trình.'),
      h('section', { class: 'sec acct' }, h('div', { class: 'wrap acct-auth' }, [form, h('aside', { class: 'acct-why' }, [
        h('h2', { text: 'Tài khoản giúp bạn' }),
        h('ul', { class: 'bul' }, [
          h('li', { text: 'Tạo mã vận đơn cho từng lô hàng gửi về kho Bằng Tường.' }),
          h('li', { text: 'Xem hàng đã tới bước nào: nhập kho Bằng Tường, về kho Hà Nội, đã nhận.' }),
          h('li', { text: 'Xác nhận đã nhận hàng ngay trên điện thoại.' })
        ])
      ])]))];
  }
  function head(eyebrow, title, lead, extra) {
    return h('section', { class: 'page-head' }, h('div', { class: 'wrap' }, [h('p', { class: 'eyebrow', text: eyebrow }), h('h1', { text: title }), lead ? h('p', { class: 'lead', text: lead }) : null, extra || null]));
  }

  /* ---------- Danh sách đơn: lọc, tìm kiếm, xem dạng lưới / danh sách, phân trang ---------- */
  var filter = 'open', query = '', page = 1;
  var view = (function () { try { return localStorage.getItem('d2d_view') || 'grid'; } catch (e) { return 'grid'; } })();
  var PAGE_SIZE = { grid: 12, list: 20 };
  function fold(t) { return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd'); }
  function listPage() {
    var box = h('div', null, h('p', { class: 'empty', text: 'Đang tải đơn hàng…' }));
    var pager = h('nav', { class: 'pager', 'aria-label': 'Phân trang' });
    var who = h('div', { class: 'acct-who' }, [
      h('span', { text: me ? whoText(me) : '' }),
      h('a', { href: '#tai-khoan/thong-tin', text: 'Thông tin tài khoản' }),
      h('button', { class: 'linkish', type: 'button', text: 'Đăng xuất', onclick: logout })
    ]);
    var chips = h('div', { class: 'filters', role: 'group', 'aria-label': 'Lọc đơn hàng' });
    var search = h('input', { type: 'search', id: 'order-search', placeholder: 'Tìm mã vận đơn, mã đơn hàng, tên hàng…', autocomplete: 'off', value: query });
    search.addEventListener('input', function () { query = search.value; page = 1; draw(); });
    var views = h('div', { class: 'view-toggle', role: 'group', 'aria-label': 'Kiểu hiển thị' }, [['grid', 'Lưới'], ['list', 'Danh sách']].map(function (v) {
      return h('button', { type: 'button', 'data-v': v[0], 'aria-pressed': String(view === v[0]), onclick: function () {
        if (view === v[0]) return;
        var first = (page - 1) * PAGE_SIZE[view]; // giữ đơn đang xem ở trang mới
        view = v[0]; try { localStorage.setItem('d2d_view', view); } catch (e) {}
        page = Math.floor(first / PAGE_SIZE[view]) + 1;
        [].forEach.call(views.children, function (b) { b.setAttribute('aria-pressed', String(b.dataset.v === view)); });
        draw();
      } }, [icon(v[0]), h('span', { text: v[1] })]);
    }));
    var all = [];
    function draw(scroll) {
      var q = fold(query.trim());
      var found = q ? all.filter(function (o) { return fold([o.waybill, o.order_code, o.item_name, o.brand, o.note].join(' ')).indexOf(q) >= 0; }) : all;
      mount(chips, [['open', 'Đang vận chuyển'], ['delivered', 'Đã nhận'], ['all', 'Tất cả']].map(function (f) {
        var n = found.filter(function (o) { return match(o, f[0]); }).length;
        return h('button', { type: 'button', class: 'fchip', 'aria-pressed': String(filter === f[0]), text: f[1] + ' (' + n + ')', onclick: function () { filter = f[0]; page = 1; draw(); } });
      }));
      mount(pager, []);
      if (!all.length) return mount(box, h('div', { class: 'empty-box' }, [h('h3', { text: 'Bạn chưa có vận đơn nào' }), h('p', { text: 'Tạo vận đơn khi bạn chuẩn bị gửi hàng về kho Bằng Tường. Ghi mã vận đơn lên kiện hàng để kho nhận đúng.' }), h('a', { class: 'btn btn-main', href: '#tai-khoan/tao-don', text: 'Tạo vận đơn đầu tiên' })]));
      var rows = found.filter(function (o) { return match(o, filter); });
      if (!rows.length) return mount(box, h('p', { class: 'empty', text: q ? 'Không tìm thấy đơn nào khớp "' + query.trim() + '".' : 'Không có đơn nào trong mục này.' }));
      var size = PAGE_SIZE[view], pages = Math.ceil(rows.length / size);
      page = Math.min(Math.max(1, page), pages);
      var slice = rows.slice((page - 1) * size, page * size);
      mount(box, view === 'grid' ? h('div', { class: 'orders' }, slice.map(card)) : listTable(slice));
      mount(pager, pagerKids(rows.length, size, pages));
      if (scroll) box.scrollIntoView({ block: 'start' });
    }
    function pagerKids(total, size, pages) {
      var info = h('p', { class: 'pager-info', text: 'Hiển thị ' + ((page - 1) * size + 1) + '–' + Math.min(page * size, total) + ' trên ' + total + ' đơn' });
      if (pages < 2) return info;
      function go(n) { page = n; draw(true); }
      var nums = [], last = 0;
      for (var n = 1; n <= pages; n++) {
        if (pages <= 7 || n === 1 || n === pages || Math.abs(n - page) <= 1) {
          if (n - last > 1) nums.push(h('span', { class: 'pg-gap', text: '…', 'aria-hidden': 'true' }));
          nums.push(h('button', { type: 'button', class: 'pg', 'aria-current': n === page ? 'page' : null, 'aria-label': 'Trang ' + n, text: String(n), onclick: (function (k) { return function () { go(k); }; })(n) }));
          last = n;
        }
      }
      return [info, h('div', { class: 'pg-row' }, [
        h('button', { type: 'button', class: 'pg pg-step', disabled: page === 1, text: '‹ Trước', onclick: function () { go(page - 1); } })
      ].concat(nums, [h('button', { type: 'button', class: 'pg pg-step', disabled: page === pages, text: 'Sau ›', onclick: function () { go(page + 1); } })]))];
    }
    function match(o, f) { return f === 'all' || (f === 'delivered' ? o.status === 'delivered' : o.status !== 'delivered' && o.status !== 'cancelled'); }
    api('GET', '/api/customer/orders').then(function (r) { all = r.items; if (!all.some(function (o) { return match(o, filter); }) && all.length) filter = 'all'; draw(); })
      .catch(function (e) { if (e.status === 401) return render(); mount(box, h('p', { class: 'form-msg bad', text: e.message })); });
    api('GET', '/api/customer/me').then(function (c) { me = c; who.firstChild.textContent = whoText(c); }).catch(function () {});
    return [head('Đơn hàng của tôi', 'Vận đơn của bạn', null, who),
      h('section', { class: 'sec acct' }, h('div', { class: 'wrap' }, [
        h('div', { class: 'list-bar' }, [chips, h('a', { class: 'btn btn-main', href: '#tai-khoan/tao-don', text: '+ Tạo vận đơn mới' })]),
        h('div', { class: 'list-tools' }, [h('div', { class: 'search-box' }, [h('label', { for: 'order-search', class: 'sr', text: 'Tìm đơn hàng' }), search]), views]),
        box, pager
      ]))];
  }
  function whoText(c) { var id = c.phone || c.username; return c.name && c.name !== id ? c.name + ' · ' + id : id; }
  function icon(kind) {
    var ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 16 16'); svg.setAttribute('aria-hidden', 'true');
    (kind === 'grid' ? [[1, 1, 6, 6], [9, 1, 6, 6], [1, 9, 6, 6], [9, 9, 6, 6]] : [[1, 2, 14, 2.4], [1, 6.8, 14, 2.4], [1, 11.6, 14, 2.4]]).forEach(function (r) {
      var e = document.createElementNS(ns, 'rect'); e.setAttribute('x', r[0]); e.setAttribute('y', r[1]); e.setAttribute('width', r[2]); e.setAttribute('height', r[3]); e.setAttribute('rx', '1'); svg.appendChild(e);
    });
    return svg;
  }
  function listTable(rows) {
    return h('div', { class: 'olist-box' }, h('table', { class: 'olist' }, [
      h('thead', null, h('tr', null, ['Mã vận đơn', 'Mã đơn hàng', 'Tên hàng', 'Kiện', 'Trạng thái', 'Ngày tạo'].map(function (t) { return h('th', { scope: 'col', text: t }); }))),
      h('tbody', null, rows.map(function (o) {
        var href = '#tai-khoan/don/' + o.waybill;
        var tr = h('tr', null, [
          h('td', { class: 'c-wb' }, h('a', { href: href, class: 'wb-no', text: o.waybill })),
          h('td', { class: 'c-code', 'data-l': 'Mã đơn', text: o.order_code }),
          h('td', { class: 'c-item', text: o.item_name + (o.brand ? ' · ' + o.brand : '') }),
          h('td', { class: 'c-pk num', 'data-l': 'Kiện', text: String(o.packages) }),
          h('td', { class: 'c-st' }, badge(o.status)),
          h('td', { class: 'c-date num', text: fmtDay(o.created_at) })
        ]);
        tr.addEventListener('click', function (e) { if (e.target.tagName !== 'A') location.hash = href; });
        return tr;
      }))
    ]));
  }
  function fmtDay(iso) { try { return new Date(iso).toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric' }); } catch (e) { return ''; } }
  function card(o) {
    var i = IDX[o.status], pct = o.status === 'cancelled' ? 0 : Math.round(((i || 0) / (STEPS.length - 1)) * 100);
    var bar = h('span', { class: 'mini-bar', 'aria-hidden': 'true' }, h('i'));
    bar.firstChild.style.width = pct + '%';
    var meta = [o.packages + ' kiện', fmtN(o.measured_weight != null ? o.measured_weight : o.weight, 'kg'), fmtN(o.measured_volume != null ? o.measured_volume : o.volume, 'm³')].filter(Boolean).join(' · ');
    return h('a', { class: 'order-card', href: '#tai-khoan/don/' + o.waybill }, [
      h('div', { class: 'oc-top' }, [h('span', { class: 'wb-no', text: o.waybill }), badge(o.status)]),
      h('b', { class: 'oc-item', text: o.item_name + (o.brand ? ' · ' + o.brand : '') }),
      h('span', { class: 'oc-meta', text: 'Mã đơn ' + o.order_code + ' · ' + meta }),
      bar,
      h('span', { class: 'oc-time', text: 'Cập nhật ' + fmtTime(o.updated_at) })
    ]);
  }
  function logout() { store.set(null); me = null; updateNav(); if (location.hash === '#tai-khoan') render(); else location.hash = '#tai-khoan'; }

  /* ---------- Tạo / sửa vận đơn ---------- */
  function formPage(existing) {
    var o = existing || {};
    var inp = {
      order_code: h('input', { maxlength: '120', placeholder: 'Ví dụ: mã đơn Taobao, 1688 hoặc mã của nhà cung cấp', value: o.order_code || '' }),
      packages: h('input', { type: 'number', min: '1', step: '1', inputmode: 'numeric', value: o.packages || '' }),
      weight: h('input', { type: 'number', min: '0', step: 'any', inputmode: 'decimal', value: o.weight != null ? o.weight : '' }),
      volume: h('input', { type: 'number', min: '0', step: 'any', inputmode: 'decimal', value: o.volume != null ? o.volume : '' }),
      item_name: h('input', { maxlength: '300', placeholder: 'Ví dụ: vải cotton, phụ kiện may', value: o.item_name || '' }),
      brand: h('input', { maxlength: '160', placeholder: 'Ghi "Không nhãn hiệu" nếu hàng không có', value: o.brand || '' }),
      note: h('textarea', { maxlength: '1000', rows: '3', placeholder: 'Mã tracking nội địa Trung Quốc, yêu cầu đóng gói, người nhận…' })
    };
    inp.note.value = o.note || '';
    var msg = msgEl();
    var btn = h('button', { class: 'btn btn-main', type: 'submit', text: existing ? 'Lưu thay đổi' : 'Tạo vận đơn' });
    var form = h('form', { class: 'acct-card order-form', novalidate: true }, [
      h('div', { class: 'form-sec' }, h('span', { class: 'eyebrow', text: 'Thông tin đơn hàng' })),
      field('o-code', 'Mã đơn hàng', inp.order_code, null, true),
      field('o-pk', 'Số kiện', inp.packages, null, true),
      field('o-item', 'Tên hàng', inp.item_name, null, true),
      field('o-brand', 'Nhãn hiệu', inp.brand),
      h('div', { class: 'form-sec' }, h('span', { class: 'eyebrow', text: 'Kích thước (không bắt buộc)' })),
      field('o-kg', 'Số kg', inp.weight, 'Kho sẽ cân lại khi nhận hàng.'),
      field('o-m3', 'Số khối (m³)', inp.volume, 'Kho sẽ đo lại khi nhận hàng.'),
      h('div', { class: 'f wide' }, [h('label', { for: 'o-note', text: 'Ghi chú' }), (inp.note.id = 'o-note', inp.note)]),
      h('div', { class: 'wide form-foot' }, [btn, h('a', { class: 'btn btn-line', href: existing ? '#tai-khoan/don/' + o.waybill : '#tai-khoan', text: 'Hủy bỏ' }), msg])
    ]);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var body = {}; Object.keys(inp).forEach(function (k) { body[k] = inp[k].value.trim(); });
      if (!body.order_code) return say(msg, 'Vui lòng nhập mã đơn hàng.'), inp.order_code.focus();
      if (!(parseInt(body.packages, 10) >= 1)) return say(msg, 'Số kiện phải từ 1 trở lên.'), inp.packages.focus();
      if (!body.item_name) return say(msg, 'Vui lòng nhập tên hàng.'), inp.item_name.focus();
      body.packages = parseInt(body.packages, 10);
      var p = existing ? api('PATCH', '/api/customer/orders/' + o.waybill, body).then(function () { return o.waybill; })
        : api('POST', '/api/customer/orders', body).then(function (r) { return r.order.waybill; });
      busy(btn, p.then(function (wb) { justCreated = existing ? null : wb; location.hash = '#tai-khoan/don/' + wb; }).catch(function (err) { say(msg, err.message); }), 'Đang lưu…');
    });
    return [head(existing ? 'Vận đơn ' + o.waybill : 'Đơn hàng của tôi', existing ? 'Sửa vận đơn' : 'Tạo vận đơn mới',
      existing ? 'Bạn sửa được cho tới khi kho Bằng Tường nhận hàng.' : 'Điền thông tin lô hàng. Sau khi tạo, bạn nhận mã vận đơn để ghi lên kiện hàng.'),
      h('section', { class: 'sec acct' }, h('div', { class: 'wrap narrow' }, form))];
  }

  /* ---------- Chi tiết vận đơn ---------- */
  var justCreated = null;
  function detailPage(wb, editMode) {
    var box = h('div', null, h('p', { class: 'empty', text: 'Đang tải vận đơn…' }));
    var wrapEl = h('section', { class: 'sec acct' }, h('div', { class: 'wrap' }, box));
    var headEl = head('Vận đơn ' + wb, 'Chi tiết vận đơn');
    api('GET', '/api/customer/orders/' + encodeURIComponent(wb)).then(function (r) {
      if (editMode) {
        if (r.order.status !== 'created') { location.hash = '#tai-khoan/don/' + wb; return; }
        var f = formPage(r.order); headEl.replaceWith(f[0]); wrapEl.replaceWith(f[1]); return;
      }
      mount(box, detail(r.order, r.events));
    }).catch(function (e) { if (e.status === 401) return render(); mount(box, [h('p', { class: 'form-msg bad', text: e.message }), h('a', { href: '#tai-khoan', text: '← Về danh sách đơn' })]); });
    return [headEl, wrapEl];
  }
  function detail(o, events) {
    var fresh = justCreated === o.waybill; justCreated = null;
    var msg = msgEl();
    var actions = h('div', { class: 'od-actions' });
    if (o.status === 'at_hn') {
      var ask = h('div', { class: 'confirm-ask', hidden: true }, [
        h('p', { text: 'Bạn đã nhận đủ ' + o.packages + ' kiện, hàng nguyên vẹn?' }),
        h('div', { class: 'cta' }, [
          h('button', { class: 'btn btn-main', type: 'button', text: 'Đúng, đã nhận đủ', onclick: function (e) {
            busy(e.target, api('POST', '/api/customer/orders/' + o.waybill + '/confirm', {}).then(render).catch(function (err) { say(msg, err.message); }), 'Đang gửi…');
          } }),
          h('button', { class: 'btn btn-line', type: 'button', text: 'Chưa', onclick: function () { ask.hidden = true; main.hidden = false; main.focus(); } })
        ]),
        h('p', { class: 'hint', text: 'Thiếu kiện hoặc hàng hư hỏng? Đừng xác nhận, hãy gọi hotline doortodoor ngay để được xử lý.' })
      ]);
      var main = h('button', { class: 'btn btn-main btn-big', type: 'button', text: 'Xác nhận đã nhận hàng', onclick: function () { main.hidden = true; ask.hidden = false; ask.querySelector('button').focus(); } });
      actions.appendChild(h('div', { class: 'confirm-box' }, [h('b', { text: 'Hàng đã về kho Hà Nội' }), h('p', { text: 'Khi nhận được hàng, bạn bấm xác nhận để hoàn tất đơn.' }), main, ask]));
    }
    if (o.status === 'created') {
      var cancelAsk = h('span', { class: 'cancel-ask', hidden: true }, [
        'Hủy vận đơn này? ',
        h('button', { class: 'btn btn-line danger', type: 'button', text: 'Hủy vận đơn', onclick: function (e) {
          busy(e.target, api('POST', '/api/customer/orders/' + o.waybill + '/cancel', {}).then(render).catch(function (err) { say(msg, err.message); }));
        } }),
        h('button', { class: 'linkish', type: 'button', text: 'Không', onclick: function () { cancelAsk.hidden = true; cancelBtn.hidden = false; } })
      ]);
      var cancelBtn = h('button', { class: 'linkish danger', type: 'button', text: 'Hủy vận đơn', onclick: function () { cancelBtn.hidden = true; cancelAsk.hidden = false; } });
      actions.appendChild(h('div', { class: 'cta' }, [h('a', { class: 'btn btn-line', href: '#tai-khoan/sua/' + o.waybill, text: 'Sửa thông tin' }), cancelBtn, cancelAsk]));
    }
    actions.appendChild(msg);

    var kg = o.measured_weight != null ? fmtN(o.measured_weight, 'kg') + ' (kho cân)' : fmtN(o.weight, 'kg');
    var m3 = o.measured_volume != null ? fmtN(o.measured_volume, 'm³') + ' (kho đo)' : fmtN(o.volume, 'm³');
    var copyBtn = h('button', { class: 'linkish', type: 'button', text: 'Sao chép mã', onclick: function () {
      var done = function () { copyBtn.textContent = 'Đã sao chép'; setTimeout(function () { copyBtn.textContent = 'Sao chép mã'; }, 1800); };
      try { navigator.clipboard.writeText(o.waybill).then(done, function () {}); } catch (e) {}
    } });
    return [
      h('a', { class: 'back', href: '#tai-khoan', text: '← Tất cả vận đơn' }),
      fresh ? h('div', { class: 'notice ok' }, [h('b', { text: 'Đã tạo vận đơn.' }), ' Ghi mã ', h('b', { class: 'mono', text: o.waybill }), ' lên từng kiện hàng (hoặc gửi mã cho nhà cung cấp ghi giúp) để kho Bằng Tường nhận đúng hàng của bạn.']) : null,
      h('div', { class: 'od-grid' }, [
        h('article', { class: 'ticket' }, [
          h('div', { class: 'wb-head' }, [h('span', { class: 'd2d small' }, ['D', h('span', { text: '2' }), 'D']), badge(o.status)]),
          h('div', { class: 'ticket-no' }, [h('span', { class: 'eyebrow', text: 'Mã vận đơn' }), h('b', { class: 'mono', text: o.waybill }), copyBtn]),
          h('dl', { class: 'wb-grid' }, [
            dli('Mã đơn hàng', o.order_code), dli('Số kiện', o.packages + ' kiện'),
            dli('Tên hàng', o.item_name), dli('Nhãn hiệu', o.brand || 'Không ghi'),
            dli('Trọng lượng', kg || 'Chưa có'), dli('Số khối', m3 || 'Chưa có'),
            o.note ? dli('Ghi chú', o.note, true) : null,
            dli('Ngày tạo', fmtTime(o.created_at)), o.received_at ? dli('Ngày nhận hàng', fmtTime(o.received_at)) : dli('Cập nhật', fmtTime(o.updated_at))
          ]),
          h('div', { class: 'wb-foot', 'aria-hidden': 'true' }, [h('span', { class: 'barcode' }), h('span', { class: 'wb-code', text: 'DOORTODOOR.COM.VN' })])
        ]),
        h('div', { class: 'od-side' }, [actions, h('h2', { text: 'Hành trình' }), timeline(o, events, true)])
      ])
    ];
  }
  function dli(k, v, wide) { return h('div', { class: wide ? 'wb-wide' : null }, [h('dt', { text: k }), h('dd', { text: String(v) })]); }

  /* ---------- Thông tin tài khoản ---------- */
  function profilePage() {
    var name = h('input', { autocomplete: 'name', maxlength: '120', value: (me && me.name) || '' });
    var company = h('input', { autocomplete: 'organization', maxlength: '160', value: (me && me.company) || '' });
    var m1 = msgEl(), b1 = h('button', { class: 'btn btn-main', type: 'submit', text: 'Lưu thông tin' });
    var f1 = h('form', { class: 'acct-card', novalidate: true }, [h('h2', { text: 'Thông tin' }), h('p', { class: 'hint', text: 'Tài khoản đăng nhập: ' + ((me && (me.phone || me.username)) || '') }),
      field('p-name', 'Họ tên', name, null, true), field('p-company', 'Công ty / cửa hàng', company), h('div', { class: 'form-foot' }, [b1, m1])]);
    f1.addEventListener('submit', function (e) {
      e.preventDefault();
      busy(b1, api('PATCH', '/api/customer/me', { name: name.value, company: company.value }).then(function () { me.name = name.value.trim(); me.company = company.value.trim(); say(m1, 'Đã lưu.', true); }).catch(function (err) { say(m1, err.message); }));
    });
    var cur = h('input', { type: 'password', autocomplete: 'current-password' }), nw = h('input', { type: 'password', autocomplete: 'new-password' });
    var m2 = msgEl(), b2 = h('button', { class: 'btn btn-main', type: 'submit', text: 'Đổi mật khẩu' });
    var f2 = h('form', { class: 'acct-card', novalidate: true }, [h('h2', { text: 'Đổi mật khẩu' }),
      field('p-cur', 'Mật khẩu hiện tại', cur), field('p-new', 'Mật khẩu mới', nw, 'Ít nhất 6 ký tự. Các thiết bị khác đang đăng nhập sẽ bị đăng xuất.'), h('div', { class: 'form-foot' }, [b2, m2])]);
    f2.addEventListener('submit', function (e) {
      e.preventDefault();
      if (nw.value.length < 6) return say(m2, 'Mật khẩu mới cần ít nhất 6 ký tự.');
      busy(b2, api('POST', '/api/customer/password', { current: cur.value, next: nw.value }).then(function (r) { store.set(r.token); f2.reset(); say(m2, 'Đã đổi mật khẩu.', true); }).catch(function (err) { say(m2, err.message); }));
    });
    if (!me) api('GET', '/api/customer/me').then(function (c) { me = c; render(); }).catch(function () {});
    return [head('Đơn hàng của tôi', 'Thông tin tài khoản', null, h('div', { class: 'acct-who' }, [h('a', { href: '#tai-khoan', text: '← Về danh sách đơn' }), h('button', { class: 'linkish', type: 'button', text: 'Đăng xuất', onclick: logout })])),
      h('section', { class: 'sec acct' }, h('div', { class: 'wrap two-col' }, [f1, f2]))];
  }

  /* ---------- Tra cứu công khai ---------- */
  var trackForm = document.getElementById('track-form');
  if (trackForm) trackForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var v = document.getElementById('track-input').value.trim().toUpperCase().replace(/\s+/g, '');
    if (v) location.hash = '#tra-cuu/' + v;
  });
  function track(wb) {
    var input = document.getElementById('track-input');
    if (!wb) { mount(trackRoot, []); return; }
    input.value = wb;
    mount(trackRoot, h('p', { class: 'empty', text: 'Đang tra cứu…' }));
    api('GET', '/api/track/' + encodeURIComponent(wb), undefined, false).then(function (r) {
      mount(trackRoot, h('div', { class: 'track-box' }, [
        h('div', { class: 'oc-top' }, [h('span', { class: 'wb-no', text: r.waybill }), badge(r.status)]),
        h('p', { class: 'hint', text: r.packages + ' kiện · cập nhật ' + fmtTime(r.updated_at) }),
        timeline(r, r.events, false),
        h('p', { class: 'hint', text: 'Chủ hàng đăng nhập để xem chi tiết và ghi chú của nhân viên.' })
      ]));
    }).catch(function (err) { mount(trackRoot, h('p', { class: 'form-msg bad', text: err.message })); });
  }

  /* ---------- Điều hướng trong khu vực khách ---------- */
  function render() {
    var parts = location.hash.slice(1).split('/');
    if (parts[0] === 'tra-cuu') return track(decodeURIComponent(parts[1] || ''));
    if (parts[0] !== 'tai-khoan') return;
    var page;
    if (!store.get()) page = authPage(parts[1]);
    else if (parts[1] === 'tao-don') page = formPage(null);
    else if (parts[1] === 'don' && parts[2]) page = detailPage(decodeURIComponent(parts[2]));
    else if (parts[1] === 'sua' && parts[2]) page = detailPage(decodeURIComponent(parts[2]), true);
    else if (parts[1] === 'thong-tin') page = profilePage();
    else page = listPage();
    mount(root, page);
    var h1 = root.querySelector('h1'); if (h1 && document.activeElement && document.activeElement !== document.body) { h1.setAttribute('tabindex', '-1'); h1.focus({ preventScroll: true }); }
  }
  window.addEventListener('hashchange', render);
  render();
})();
