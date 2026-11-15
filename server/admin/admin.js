'use strict';
(function () {
  /* ---------- Tiện ích ---------- */
  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'text') el.textContent = v;
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked') el.checked = !!v;
      else el.setAttribute(k, v === true ? '' : v);
    });
    [].concat(kids || []).forEach(function (c) { if (c != null) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return el;
  }
  var $ = function (id) { return document.getElementById(id); };
  var clone = function (o) { return JSON.parse(JSON.stringify(o)); };
  var uid = 0;
  var nextId = function () { uid += 1; return 'f' + uid; };
  function toast(msg, bad) {
    var t = $('toast'); t.textContent = msg; t.className = 'toast' + (bad ? ' bad' : ''); t.hidden = false;
    clearTimeout(toast.timer); toast.timer = setTimeout(function () { t.hidden = true; }, 3500);
  }
  function api(method, url, body) {
    return fetch(url, {
      method: method, credentials: 'same-origin',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (r.status === 401 && url !== '/api/admin/login') { showLogin(); }
        if (!r.ok) throw new Error(j.error || 'Có lỗi xảy ra (' + r.status + ').');
        return j;
      });
    });
  }
  function fmtTime(s) {
    var d = new Date(s);
    return d.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  function busy(btn, p) { btn.disabled = true; return p.finally(function () { btn.disabled = false; }); }

  /* ---------- Đăng nhập ---------- */
  function showLogin() { $('app-view').hidden = true; $('login-view').hidden = false; $('lg-user').focus(); }
  function showApp(name) { $('login-view').hidden = true; $('app-view').hidden = false; $('who').textContent = name; route(); refreshBadges(); }
  $('login-form').addEventListener('submit', function (e) {
    e.preventDefault();
    $('lg-err').textContent = '';
    var btn = e.target.querySelector('button');
    busy(btn, api('POST', '/api/admin/login', { username: $('lg-user').value, password: $('lg-pass').value })
      .then(function (j) { $('lg-pass').value = ''; showApp(j.username); })
      .catch(function (err) { $('lg-err').textContent = err.message; }));
  });
  $('logout').addEventListener('click', function () { api('POST', '/api/admin/logout', {}).finally(showLogin); });

  /* ---------- Điều hướng ---------- */
  var TABS = ['van-don', 'khach-tk', 'khach-hang', 'ban-nhap', 'noi-dung', 'tai-khoan'];
  var loaders = {};
  function route() {
    var t = location.hash.slice(1).split('/')[0];
    if (TABS.indexOf(t) < 0) t = 'van-don';
    document.querySelectorAll('[data-panel]').forEach(function (p) { p.hidden = p.dataset.panel !== t; });
    document.querySelectorAll('.tabs a').forEach(function (a) { if (a.dataset.tab === t) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    if (loaders[t]) loaders[t]();
  }
  window.addEventListener('hashchange', function () { if (!$('app-view').hidden) route(); });
  function refreshBadges() {
    api('GET', '/api/admin/leads?status=new').then(function (j) { var n = j.items.length; $('badge-leads').hidden = !n; $('badge-leads').textContent = n; }).catch(function () {});
    api('GET', '/api/admin/orders?status=created').then(function (j) { var n = j.items.length; $('badge-orders').hidden = !n; $('badge-orders').textContent = n; }).catch(function () {});
    api('GET', '/api/admin/drafts?status=pending').then(function (j) { var n = j.items.length; $('badge-drafts').hidden = !n; $('badge-drafts').textContent = n; }).catch(function () {});
  }

  /* ---------- Khách hàng ---------- */
  var STATUS = { new: 'Mới', contacted: 'Đã liên hệ', quoted: 'Đã báo giá', won: 'Chốt đơn', lost: 'Không thành' };
  var LEAD_FIELDS = [['phone', 'Điện thoại'], ['email', 'Email'], ['company', 'Công ty'], ['direction', 'Chiều hàng'], ['cargo', 'Tên hàng'],
    ['weight', 'Trọng lượng'], ['volume', 'Số khối'], ['origin', 'Lấy hàng tại'], ['destination', 'Giao đến'], ['message', 'Lời nhắn']];
  loaders['khach-hang'] = function () {
    var box = $('leads');
    box.textContent = 'Đang tải…';
    api('GET', '/api/admin/leads' + ($('lead-filter').value ? '?status=' + $('lead-filter').value : '')).then(function (j) {
      var c = $('lead-counts'); c.textContent = '';
      Object.keys(STATUS).forEach(function (k) { c.appendChild(h('span', { class: 'chip st-' + k, text: STATUS[k] + ': ' + (j.counts[k] || 0) })); });
      box.textContent = '';
      if (!j.items.length) { box.appendChild(h('p', { class: 'empty', text: 'Chưa có yêu cầu nào. Khi khách gửi form ở trang Liên hệ, thông tin sẽ hiện ở đây.' })); return; }
      j.items.forEach(function (l) { box.appendChild(leadCard(l)); });
    }).catch(function (e) { box.textContent = e.message; });
  };
  $('lead-filter').addEventListener('change', loaders['khach-hang']);
  function leadCard(l) {
    var dl = h('dl');
    LEAD_FIELDS.forEach(function (f) { if (l[f[0]]) { dl.appendChild(h('dt', { text: f[1] })); dl.appendChild(h('dd', { text: l[f[0]] })); } });
    var sid = nextId(), nid = nextId();
    var sel = h('select', { id: sid }, Object.keys(STATUS).map(function (k) { return h('option', { value: k, text: STATUS[k] }); }));
    sel.value = l.status;
    var note = h('textarea', { id: nid, placeholder: 'Ví dụ: đã gọi, hẹn gửi báo giá thứ Hai' }); note.value = l.admin_note || '';
    var save = h('button', { class: 'btn primary small', type: 'button', text: 'Lưu' });
    save.addEventListener('click', function () {
      busy(save, api('PATCH', '/api/admin/leads/' + l.id, { status: sel.value, admin_note: note.value })
        .then(function () { toast('Đã lưu.'); refreshBadges(); }).catch(function (e) { toast(e.message, true); }));
    });
    var del = h('button', { class: 'btn danger small', type: 'button', text: 'Xóa' });
    var confirmBox = h('span', { hidden: true }, [
      'Xóa hẳn khách này? ',
      h('button', { class: 'btn danger small', type: 'button', text: 'Xóa', onclick: function () {
        api('DELETE', '/api/admin/leads/' + l.id).then(function () { toast('Đã xóa.'); loaders['khach-hang'](); refreshBadges(); }).catch(function (e) { toast(e.message, true); });
      } }),
      h('button', { class: 'btn ghost small', type: 'button', text: 'Không', onclick: function () { confirmBox.hidden = true; del.hidden = false; } })
    ]);
    del.addEventListener('click', function () { del.hidden = true; confirmBox.hidden = false; });
    return h('article', { class: 'lead' }, [
      h('div', null, [h('time', { datetime: l.created_at, text: fmtTime(l.created_at) }), h('h3', { text: l.name }), dl]),
      h('div', { class: 'side' }, [
        h('label', { for: sid, text: 'Trạng thái' }), sel,
        h('label', { for: nid, text: 'Ghi chú nội bộ' }), note,
        h('div', { class: 'actions' }, [save, del, confirmBox])
      ])
    ]);
  }

  /* ---------- Trình sửa nội dung theo cấu trúc ---------- */
  var TIER = { type: 'tiers' };
  var SCHEMAS = {
    contact: { title: 'Liên hệ', fields: [
      { k: 'company', label: 'Tên công ty', type: 'text' },
      { k: 'hotline', label: 'Hotline', type: 'text' },
      { k: 'zalo', label: 'Zalo', type: 'text' },
      { k: 'email', label: 'Email', type: 'text' },
      { k: 'address', label: 'Địa chỉ', type: 'textarea' },
      { k: 'hours', label: 'Giờ làm việc', type: 'text' }
    ] },
    services: { title: 'Dịch vụ', fields: [
      { k: 'items', label: 'Danh sách dịch vụ', type: 'list', itemLabel: 'dịch vụ', blank: { title: '', desc: '' }, fields: [
        { k: 'title', label: 'Tên dịch vụ', type: 'text' }, { k: 'desc', label: 'Mô tả', type: 'textarea' }] }
    ] },
    border: { title: 'Tình hình cửa khẩu', fields: [
      { row: [{ k: 'updated', label: 'Ngày cập nhật', type: 'text' }, { k: 'headline', label: 'Tiêu đề', type: 'text' }] },
      { k: 'lead', label: 'Đoạn mở đầu', type: 'textarea' },
      { k: 'stats', label: 'Số liệu nổi bật', type: 'list', itemLabel: 'số liệu', blank: { value: '', label: '', source: 1 }, fields: [
        { row: [{ k: 'value', label: 'Con số', type: 'text' }, { k: 'source', label: 'Nguồn số', type: 'number' }] }, { k: 'label', label: 'Diễn giải', type: 'textarea' }] },
      { k: 'trucks', label: 'Lượng xe qua Lạng Sơn', type: 'group', fields: [
        { k: 'title', label: 'Tiêu đề', type: 'text' },
        { row: [{ k: 'exportTrucks', label: 'Xe xuất', type: 'number' }, { k: 'importTrucks', label: 'Xe nhập', type: 'number' }, { k: 'source', label: 'Nguồn số', type: 'number' }] },
        { k: 'period', label: 'Khoảng thời gian', type: 'text' }] },
      { k: 'imports', label: 'Nhóm hàng nhập lớn nhất', type: 'group', fields: goodsFields() },
      { k: 'exports', label: 'Nhóm hàng xuất lớn nhất', type: 'group', fields: goodsFields() },
      { k: 'gates', label: 'Bảng cửa khẩu', type: 'list', itemLabel: 'cửa khẩu', blank: { name: '', zh: '', latest: '', note: '', source: 1 }, fields: [
        { row: [{ k: 'name', label: 'Tên cửa khẩu', type: 'text' }, { k: 'zh', label: 'Tên chữ Hán', type: 'text' }, { k: 'source', label: 'Nguồn số', type: 'number' }] },
        { k: 'latest', label: 'Số liệu gần nhất', type: 'textarea' }, { k: 'note', label: 'Điều chủ hàng cần biết', type: 'textarea' }] },
      { k: 'smartGate', label: 'Cửa khẩu thông minh Hữu Nghị', type: 'group', fields: [
        { row: [{ k: 'lanesOpen', label: 'Làn đang khai thác', type: 'number' }, { k: 'lanesTarget', label: 'Mục tiêu số làn', type: 'number' }, { k: 'source', label: 'Nguồn số', type: 'number' }] },
        { k: 'points', label: 'Các ý chính', type: 'strings', itemLabel: 'ý' }] },
      { k: 'tips', label: 'Lưu ý cho chủ hàng', type: 'strings', itemLabel: 'lưu ý' },
      { k: 'sources', label: 'Nguồn số liệu', type: 'list', itemLabel: 'nguồn', blank: { id: 1, label: '', url: 'https://' }, fields: [
        { row: [{ k: 'id', label: 'Số', type: 'number' }, { k: 'label', label: 'Tên nguồn, ngày', type: 'text' }] }, { k: 'url', label: 'Đường link', type: 'url' }] }
    ] },
    prices: { title: 'Bảng giá so sánh', fields: [
      { k: 'collected', label: 'Ngày thu thập', type: 'text' },
      { k: 'providers', label: 'Đơn vị vận chuyển', type: 'list', itemLabel: 'đơn vị', blank: { name: '', url: 'https://', date: '', note: '', kg: [], m3: [] }, fields: [
        { row: [{ k: 'name', label: 'Tên đơn vị', type: 'text' }, { k: 'date', label: 'Ngày bảng giá', type: 'text' }] },
        { k: 'url', label: 'Link bảng giá gốc', type: 'url' },
        { k: 'note', label: 'Ghi chú tuyến, phí', type: 'textarea' },
        { k: 'kg', label: 'Bậc giá theo kg (đ/kg)', type: 'tiers' },
        { k: 'm3', label: 'Bậc giá theo khối (đ/m³)', type: 'tiers' }] }
    ] },
    news: { title: 'Tin tức', fields: [
      { k: 'items', label: 'Tin tức biên giới', type: 'list', itemLabel: 'tin', newFirst: true, blank: { date: new Date().toISOString().slice(0, 10), title: '', summary: '', source: '', url: '' }, fields: [
        { row: [{ k: 'date', label: 'Ngày', type: 'date' }, { k: 'source', label: 'Nguồn', type: 'text' }] },
        { k: 'title', label: 'Tiêu đề', type: 'text' }, { k: 'summary', label: 'Tóm tắt', type: 'textarea' }, { k: 'url', label: 'Link bài gốc', type: 'url' }] }
    ] }
  };
  function goodsFields() {
    return [{ k: 'title', label: 'Tiêu đề', type: 'text' },
      { row: [{ k: 'note', label: 'Ghi chú đơn vị', type: 'text' }, { k: 'source', label: 'Nguồn số', type: 'number' }] },
      { k: 'items', label: 'Nhóm hàng', type: 'list', itemLabel: 'nhóm hàng', blank: { name: '', value: 0, change: '' }, fields: [
        { row: [{ k: 'name', label: 'Tên nhóm hàng', type: 'text' }, { k: 'value', label: 'Tỷ USD', type: 'number' }, { k: 'change', label: 'Tăng/giảm', type: 'text' }] }] }];
  }

  function renderFields(fields, obj) {
    return fields.map(function (f) {
      if (f.row) return h('div', { class: 'row' }, renderFields(f.row, obj));
      return renderField(f, obj);
    });
  }
  function renderField(f, obj) {
    var id = nextId();
    if (f.type === 'group') {
      if (!obj[f.k]) obj[f.k] = {};
      return h('fieldset', { class: 'group' }, [h('legend', { text: f.label })].concat(renderFields(f.fields, obj[f.k])));
    }
    if (f.type === 'list' || f.type === 'strings') return renderList(f, obj);
    if (f.type === 'tiers') return renderTiers(f, obj);
    var input;
    if (f.type === 'textarea') { input = h('textarea', { id: id }); input.value = obj[f.k] == null ? '' : obj[f.k]; }
    else {
      input = h('input', { id: id, type: f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : f.type === 'url' ? 'url' : 'text', step: f.type === 'number' ? 'any' : null });
      input.value = obj[f.k] == null ? '' : obj[f.k];
    }
    input.addEventListener('input', function () {
      obj[f.k] = f.type === 'number' ? (input.value === '' ? 0 : Number(input.value)) : input.value;
    });
    return h('div', { class: 'fld' }, [h('label', { for: id, text: f.label }), input]);
  }
  function renderList(f, obj) {
    if (!Array.isArray(obj[f.k])) obj[f.k] = [];
    var arr = obj[f.k];
    var wrap = h('fieldset', { class: 'group' });
    function draw() {
      wrap.textContent = '';
      wrap.appendChild(h('legend', { text: f.label + ' (' + arr.length + ')' }));
      arr.forEach(function (item, i) {
        var body;
        if (f.type === 'strings') {
          var id = nextId(), ta = h('textarea', { id: id, 'aria-label': f.itemLabel + ' ' + (i + 1) }); ta.value = item;
          ta.addEventListener('input', function () { arr[i] = ta.value; });
          body = [ta];
        } else body = renderFields(f.fields, item);
        var tools = h('div', { class: 'item-tools' }, [
          h('button', { class: 'btn ghost small', type: 'button', text: '↑ Lên', disabled: i === 0 ? true : null, onclick: function () { var t = arr[i - 1]; arr[i - 1] = arr[i]; arr[i] = t; draw(); } }),
          h('button', { class: 'btn ghost small', type: 'button', text: '↓ Xuống', disabled: i === arr.length - 1 ? true : null, onclick: function () { var t = arr[i + 1]; arr[i + 1] = arr[i]; arr[i] = t; draw(); } }),
          h('button', { class: 'btn danger small', type: 'button', text: 'Xóa ' + f.itemLabel, onclick: function () { arr.splice(i, 1); draw(); } })
        ]);
        wrap.appendChild(h('div', { class: 'item' }, body.concat([tools])));
      });
      wrap.appendChild(h('div', null, h('button', { class: 'btn small', type: 'button', text: '+ Thêm ' + f.itemLabel, onclick: function () {
        var blank = f.type === 'strings' ? '' : clone(f.blank);
        if (f.newFirst) arr.unshift(blank); else arr.push(blank);
        draw();
      } })));
    }
    draw();
    return wrap;
  }
  function renderTiers(f, obj) {
    if (!Array.isArray(obj[f.k])) obj[f.k] = [];
    var arr = obj[f.k], box = h('div', { class: 'fld' });
    function num(t, key, nullable, label) {
      var inp = h('input', { type: 'number', step: 'any', 'aria-label': label, placeholder: nullable ? 'trở lên' : '' });
      inp.value = t[key] == null ? '' : t[key];
      inp.addEventListener('input', function () { t[key] = inp.value === '' ? (nullable ? null : 0) : Number(inp.value); });
      return h('td', null, inp);
    }
    function draw() {
      box.textContent = '';
      box.appendChild(h('span', { class: 'list-title', text: f.label }));
      if (!arr.length) box.appendChild(h('p', { class: 'muted', text: 'Không công bố. Bấm Thêm bậc nếu đơn vị có bảng giá.' }));
      else {
        var rows = arr.map(function (t, i) {
          var cb = h('input', { type: 'checkbox', 'aria-label': 'Giá khởi điểm', checked: !!t.startsAt });
          cb.addEventListener('change', function () { if (cb.checked) t.startsAt = true; else delete t.startsAt; });
          return h('tr', null, [num(t, 'from', false, 'Từ'), num(t, 'to', true, 'Đến dưới'), num(t, 'hn', false, 'Giá Hà Nội'), num(t, 'hcm', false, 'Giá TP.HCM'), h('td', null, cb),
            h('td', null, h('button', { class: 'btn danger small', type: 'button', text: 'Xóa', onclick: function () { arr.splice(i, 1); draw(); } }))]);
        });
        box.appendChild(h('div', { class: 'tiers' }, h('table', null, [
          h('thead', null, h('tr', null, ['Từ', 'Đến dưới (trống = trở lên)', 'Giá về Hà Nội', 'Giá về TP.HCM', 'Giá "từ"', ''].map(function (t) { return h('th', { text: t }); }))),
          h('tbody', null, rows)])));
      }
      box.appendChild(h('div', null, h('button', { class: 'btn small', type: 'button', text: '+ Thêm bậc', onclick: function () {
        var last = arr[arr.length - 1];
        arr.push({ from: last && last.to != null ? last.to : 0, to: null, hn: 0, hcm: 0 }); draw();
      } })));
    }
    draw();
    return box;
  }

  /* ---------- Nội dung website ---------- */
  var current = null, currentKey = 'contact';
  loaders['noi-dung'] = function () {
    api('GET', '/api/admin/content').then(function (j) { current = j; drawSectionTabs(); openSection(currentKey); })
      .catch(function (e) { $('section-editor').textContent = e.message; });
  };
  function drawSectionTabs() {
    var tabs = $('section-tabs'); tabs.textContent = '';
    Object.keys(SCHEMAS).forEach(function (k) {
      tabs.appendChild(h('button', { type: 'button', role: 'tab', 'aria-selected': String(k === currentKey), text: SCHEMAS[k].title, onclick: function () { currentKey = k; drawSectionTabs(); openSection(k); } }));
    });
  }
  function openSection(key) {
    var ed = $('section-editor'); ed.textContent = '';
    var data = clone(current[key].data);
    var save = h('button', { class: 'btn primary', type: 'button', text: 'Lưu ' + SCHEMAS[key].title.toLowerCase() });
    var reset = h('button', { class: 'btn ghost', type: 'button', text: 'Bỏ thay đổi', onclick: function () { openSection(key); } });
    save.addEventListener('click', function () {
      busy(save, api('PUT', '/api/admin/content/' + key, { data: data }).then(function () {
        current[key] = { data: clone(data), updatedAt: new Date().toISOString(), updatedBy: $('who').textContent };
        toast('Đã lưu. Website cập nhật sau khoảng 1 phút.');
      }).catch(function (e) { toast(e.message, true); }));
    });
    var meta = current[key].updatedAt ? 'Sửa lần cuối ' + fmtTime(current[key].updatedAt) + (current[key].updatedBy ? ' bởi ' + current[key].updatedBy : '') : '';
    ed.appendChild(h('div', { class: 'editor' }, [h('p', { class: 'ed-meta', text: meta })].concat(renderFields(SCHEMAS[key].fields, data), [h('div', { class: 'savebar' }, [save, reset])])));
  }

  /* ---------- Bản nháp agent ---------- */
  function diff(a, b, path, out) {
    if (out.length > 200) return out;
    if (JSON.stringify(a) === JSON.stringify(b)) return out;
    if (a && b && typeof a === 'object' && typeof b === 'object') {
      var keys = Array.isArray(a) || Array.isArray(b) ? Array.from({ length: Math.max((a || []).length, (b || []).length) }, function (_, i) { return i; }) : Object.keys(Object.assign({}, a, b));
      keys.forEach(function (k) { diff(a ? a[k] : undefined, b ? b[k] : undefined, path.concat(k), out); });
      return out;
    }
    out.push({ path: path.join(' › '), from: a, to: b });
    return out;
  }
  var show = function (v) { return v === undefined ? '(không có)' : typeof v === 'object' ? JSON.stringify(v) : String(v); };
  var SECTION_NAMES = { border: 'Tình hình cửa khẩu', prices: 'Bảng giá so sánh', news: 'Tin tức' };
  loaders['ban-nhap'] = function () {
    var box = $('drafts'); box.textContent = 'Đang tải…';
    var st = $('draft-filter').value;
    Promise.all([api('GET', '/api/admin/drafts?status=' + st), api('GET', '/api/admin/content')]).then(function (r) {
      var items = r[0].items, content = r[1]; box.textContent = '';
      if (!items.length) { box.appendChild(h('p', { class: 'empty', text: st === 'pending' ? 'Không có bản nháp nào chờ duyệt.' : 'Chưa có bản nháp nào.' })); return; }
      items.forEach(function (d) { box.appendChild(draftCard(d, content[d.section] && content[d.section].data, st === 'pending')); });
    }).catch(function (e) { box.textContent = e.message; });
  };
  $('draft-filter').addEventListener('change', loaders['ban-nhap']);
  function draftCard(d, live, pending) {
    var data = clone(d.data);
    var changes = diff(live, d.data, [], []);
    var list = h('ul', { class: 'diff' }, changes.length ? changes.slice(0, 200).map(function (c) {
      return h('li', null, [h('code', { text: c.path }), h('br'), h('del', { text: show(c.from) }), ' → ', h('ins', { text: show(c.to) })]);
    }) : [h('li', { text: 'Không khác nội dung đang hiển thị.' })]);
    var srcs = (d.sources || []).map(function (s) { return h('li', null, h('a', { href: s.url, target: '_blank', rel: 'noopener', text: s.label || s.url })); });
    var kids = [
      h('div', { class: 'draft-head' }, [h('h2', { text: (SECTION_NAMES[d.section] || d.section) + ' · bản nháp #' + d.id }), h('time', { text: fmtTime(d.created_at) })]),
      d.note ? h('p', { class: 'note', text: d.note }) : null,
      srcs.length ? h('div', null, [h('h3', { text: 'Nguồn agent đã dùng' }), h('ul', null, srcs)]) : null,
      h('h3', { text: 'Thay đổi so với website (' + changes.length + ')' }), list
    ];
    if (pending) {
      var ed = h('details', null, [h('summary', { text: 'Sửa bản nháp trước khi duyệt' }), h('div', { class: 'editor' }, renderFields(SCHEMAS[d.section].fields, data))]);
      var ok = h('button', { class: 'btn primary', type: 'button', text: 'Duyệt và đăng lên web' });
      var no = h('button', { class: 'btn danger', type: 'button', text: 'Từ chối' });
      ok.addEventListener('click', function () {
        busy(ok, api('POST', '/api/admin/drafts/' + d.id + '/approve', { data: data }).then(function () { toast('Đã duyệt. Website cập nhật sau khoảng 1 phút.'); loaders['ban-nhap'](); refreshBadges(); }).catch(function (e) { toast(e.message, true); }));
      });
      no.addEventListener('click', function () {
        busy(no, api('POST', '/api/admin/drafts/' + d.id + '/reject', {}).then(function () { toast('Đã từ chối bản nháp.'); loaders['ban-nhap'](); refreshBadges(); }).catch(function (e) { toast(e.message, true); }));
      });
      kids.push(ed, h('div', { class: 'actions' }, [ok, no]));
    } else {
      kids.push(h('p', { class: 'muted', text: (d.status === 'approved' ? 'Đã duyệt' : 'Đã từ chối') + (d.reviewed_by ? ' bởi ' + d.reviewed_by : '') + (d.reviewed_at ? ', ' + fmtTime(d.reviewed_at) : '') }));
    }
    return h('article', { class: 'draft' }, kids);
  }

  /* ---------- Tài khoản ---------- */
  loaders['tai-khoan'] = function () {
    api('GET', '/api/admin/users').then(function (j) {
      var ul = $('users'); ul.textContent = '';
      j.items.forEach(function (u) {
        var me = u.username === $('who').textContent;
        ul.appendChild(h('li', null, [h('span', { text: u.username + (me ? ' (bạn)' : '') }), me ? null : h('button', { class: 'btn danger small', type: 'button', text: 'Xóa', onclick: function (e) {
          var b = e.target; if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = 'Bấm lần nữa để xóa'; return; }
          api('DELETE', '/api/admin/users/' + u.id).then(function () { toast('Đã xóa tài khoản.'); loaders['tai-khoan'](); }).catch(function (er) { toast(er.message, true); });
        } })]));
      });
    }).catch(function (e) { toast(e.message, true); });
  };
  $('pw-form').addEventListener('submit', function (e) {
    e.preventDefault();
    busy(e.target.querySelector('button'), api('POST', '/api/admin/password', { current: $('pw-cur').value, next: $('pw-new').value })
      .then(function () { $('pw-cur').value = ''; $('pw-new').value = ''; toast('Đã đổi mật khẩu.'); }).catch(function (er) { toast(er.message, true); }));
  });
  $('user-form').addEventListener('submit', function (e) {
    e.preventDefault();
    busy(e.target.querySelector('button'), api('POST', '/api/admin/users', { username: $('u-name').value.trim(), password: $('u-pass').value })
      .then(function () { $('u-name').value = ''; $('u-pass').value = ''; toast('Đã thêm tài khoản.'); loaders['tai-khoan'](); }).catch(function (er) { toast(er.message, true); }));
  });

  /* ---------- Vận đơn ---------- */
  var OST = [
    ['created', 'Đã tạo đơn'], ['received_cn', 'Nhập kho Bằng Tường'], ['at_hn', 'Về kho Hà Nội'],
    ['delivered', 'Đã nhận'], ['cancelled', 'Đã hủy']
  ];
  var OLABEL = {}; OST.forEach(function (s) { OLABEL[s[0]] = s[1]; });
  var OIDX = {}; OST.forEach(function (s, i) { OIDX[s[0]] = i; });
  function ost(st) { return h('span', { class: 'ost ost-' + st, text: OLABEL[st] || st }); }
  function nfmt(n, unit) { return n == null ? null : Number(n).toLocaleString('vi-VN', { maximumFractionDigits: 3 }) + ' ' + unit; }
  function statusSelect(id, current) {
    var sel = h('select', { id: id }, OST.filter(function (s) { return s[0] !== 'created'; }).map(function (s) { return h('option', { value: s[0], text: s[1] }); }));
    var next = OST[Math.min((OIDX[current] || 0) + 1, 3)][0];
    sel.value = current === 'delivered' || current === 'cancelled' ? current : next;
    return sel;
  }

  var oFilter = 'open', selected = {};
  var fsel = $('order-filter');
  [['open', 'Đang xử lý'], ['', 'Tất cả']].concat(OST).forEach(function (s) { fsel.appendChild(h('option', { value: s[0], text: s[1] })); });
  fsel.value = oFilter;
  fsel.addEventListener('change', function () { oFilter = fsel.value; loadOrders(); });
  $('order-search').addEventListener('submit', function (e) { e.preventDefault(); loadOrders(); });

  loaders['van-don'] = function () {
    var id = location.hash.split('/')[1];
    if (id) { $('orders-list').hidden = true; $('order-detail').hidden = false; orderDetail(id); }
    else { $('order-detail').hidden = true; $('orders-list').hidden = false; loadOrders(); }
  };
  function loadOrders() {
    var tb = $('orders');
    var q = [];
    if (oFilter) q.push('status=' + encodeURIComponent(oFilter));
    if ($('order-q').value.trim()) q.push('q=' + encodeURIComponent($('order-q').value.trim()));
    api('GET', '/api/admin/orders' + (q.length ? '?' + q.join('&') : '')).then(function (j) {
      var c = $('order-counts'); c.textContent = '';
      OST.forEach(function (s) {
        var n = j.counts[s[0]] || 0; if (!n && s[0] === 'cancelled') return;
        c.appendChild(h('button', { type: 'button', class: 'chip', 'aria-pressed': String(oFilter === s[0]), text: s[1] + ': ' + n, onclick: function () { oFilter = oFilter === s[0] ? 'open' : s[0]; fsel.value = oFilter; loadOrders(); } }));
      });
      selected = {}; $('ck-all').checked = false; drawBulk();
      tb.textContent = '';
      if (!j.items.length) { tb.appendChild(h('tr', null, h('td', { colspan: '7', class: 'muted', text: 'Không có vận đơn nào khớp.' }))); return; }
      j.items.forEach(function (o) {
        var ck = h('input', { type: 'checkbox', 'aria-label': 'Chọn ' + o.waybill });
        var tr = h('tr', null, [
          h('td', { class: 'ck' }, ck),
          h('td', null, [h('span', { class: 'wb', text: o.waybill }), h('small', { text: 'Mã đơn ' + o.order_code })]),
          h('td', null, [o.customer_name, h('small', { text: o.phone + (o.customer_company ? ' · ' + o.customer_company : '') })]),
          h('td', null, [o.item_name, o.brand ? h('small', { text: o.brand }) : null]),
          h('td', { text: [o.packages + ' kiện', nfmt(o.measured_weight != null ? o.measured_weight : o.weight, 'kg'), nfmt(o.measured_volume != null ? o.measured_volume : o.volume, 'm³')].filter(Boolean).join(' · ') }),
          h('td', null, ost(o.status)),
          h('td', null, h('small', { text: fmtTime(o.updated_at) }))
        ]);
        ck.addEventListener('click', function (e) { e.stopPropagation(); });
        ck.addEventListener('change', function () { if (ck.checked) selected[o.id] = o.waybill; else delete selected[o.id]; tr.classList.toggle('sel', ck.checked); drawBulk(); });
        tr.addEventListener('click', function () { location.hash = '#van-don/' + o.id; });
        tb.appendChild(tr);
      });
    }).catch(function (e) { tb.textContent = ''; tb.appendChild(h('tr', null, h('td', { colspan: '7', text: e.message }))); });
  }
  $('ck-all').addEventListener('change', function () {
    var on = this.checked;
    document.querySelectorAll('#orders input[type=checkbox]').forEach(function (c) { if (c.checked !== on) { c.checked = on; c.dispatchEvent(new Event('change')); } });
  });
  function drawBulk() {
    var ids = Object.keys(selected), bar = $('bulk-bar');
    bar.hidden = !ids.length; bar.textContent = '';
    if (!ids.length) return;
    var sel = h('select', { 'aria-label': 'Trạng thái mới' }, [h('option', { value: '', text: 'Chọn bước mới…' })].concat(OST.filter(function (s) { return s[0] !== 'created'; }).map(function (s) { return h('option', { value: s[0], text: s[1] }); })));
    var note = h('input', { maxlength: '1000', placeholder: 'Ghi chú cho khách (không bắt buộc)', 'aria-label': 'Ghi chú cho khách' });
    var go = h('button', { class: 'btn primary', type: 'button', text: 'Cập nhật ' + ids.length + ' đơn' });
    go.addEventListener('click', function () {
      if (!sel.value) return toast('Chọn bước mới cho các đơn.', true);
      busy(go, api('POST', '/api/admin/orders-bulk/events', { ids: ids.map(Number), status: sel.value, note: note.value })
        .then(function (j) { toast('Đã cập nhật ' + j.updated + ' đơn.'); loadOrders(); refreshBadges(); }).catch(function (e) { toast(e.message, true); }));
    });
    bar.appendChild(h('b', { text: 'Đã chọn ' + ids.length + ' đơn' }));
    [sel, note, go, h('button', { class: 'btn ghost', type: 'button', text: 'Bỏ chọn', onclick: function () { $('ck-all').checked = false; $('ck-all').dispatchEvent(new Event('change')); } })].forEach(function (x) { bar.appendChild(x); });
  }

  function orderDetail(id) {
    var box = $('order-detail');
    box.textContent = 'Đang tải…';
    api('GET', '/api/admin/orders/' + encodeURIComponent(id)).then(function (j) {
      var o = j.order;
      box.textContent = '';
      var back = h('a', { href: '#van-don', class: 'btn ghost small', text: '← Danh sách vận đơn' });

      // Cập nhật hành trình
      var sid = nextId(), nid = nextId();
      var sel = statusSelect(sid, o.status), note = h('textarea', { id: nid, maxlength: '1000', placeholder: 'Ví dụ: đã nhận đủ 8 kiện, kiện 3 móp góc. Khách đọc được ghi chú này.' });
      var add = h('button', { class: 'btn primary', type: 'button', text: 'Thêm bước vào hành trình' });
      add.addEventListener('click', function () {
        busy(add, api('POST', '/api/admin/orders/' + o.id + '/events', { status: sel.value, note: note.value })
          .then(function () { toast('Đã cập nhật hành trình.'); orderDetail(o.id); refreshBadges(); }).catch(function (e) { toast(e.message, true); }));
      });
      var addBox = h('div', { class: 'add-ev' }, [h('h3', { text: 'Cập nhật bước mới' }),
        h('label', { for: sid, text: 'Bước' }), sel,
        h('label', { for: nid, text: 'Ghi chú của nhân viên (khách đọc được)' }), note, h('div', { class: 'actions' }, add)]);

      var evs = h('ol', { class: 'evs' });
      j.events.slice().reverse().forEach(function (e) {
        var cust = e.created_by.indexOf('khách') === 0;
        var del = null;
        if (e.status !== 'created') {
          del = h('button', { class: 'btn ghost small', type: 'button', text: 'Xóa', title: 'Xóa bước cập nhật nhầm', onclick: function (ev) {
            var b = ev.target; if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = 'Bấm lần nữa'; return; }
            api('DELETE', '/api/admin/orders/' + o.id + '/events/' + e.id).then(function () { toast('Đã xóa bước.'); orderDetail(o.id); }).catch(function (er) { toast(er.message, true); });
          } });
        }
        evs.appendChild(h('li', { class: cust ? 'by-cust' : null }, [
          h('div', null, [h('b', { text: OLABEL[e.status] || e.status }), h('div', { class: 'ev-meta', text: [fmtTime(e.created_at), (cust ? 'Khách' : e.created_by)].filter(Boolean).join(' · ') }), e.note ? h('p', { text: e.note }) : null]),
          del
        ]));
      });

      // Cân đo thực tế
      var wid = nextId(), vid = nextId(), aid = nextId();
      var mw = h('input', { id: wid, type: 'number', step: 'any', min: '0', value: o.measured_weight == null ? '' : o.measured_weight });
      var mv = h('input', { id: vid, type: 'number', step: 'any', min: '0', value: o.measured_volume == null ? '' : o.measured_volume });
      var an = h('textarea', { id: aid, maxlength: '2000', placeholder: 'Chỉ nhân viên thấy' }); an.value = o.admin_note || '';
      var save = h('button', { class: 'btn primary small', type: 'button', text: 'Lưu cân đo' });
      save.addEventListener('click', function () {
        busy(save, api('PATCH', '/api/admin/orders/' + o.id, { measured_weight: mw.value, measured_volume: mv.value, admin_note: an.value })
          .then(function () { toast('Đã lưu.'); }).catch(function (e) { toast(e.message, true); }));
      });

      var info = h('dl', null, [
        h('dt', { text: 'Mã đơn hàng' }), h('dd', { text: o.order_code }),
        h('dt', { text: 'Tên hàng' }), h('dd', { text: o.item_name }),
        h('dt', { text: 'Nhãn hiệu' }), h('dd', { text: o.brand || '—' }),
        h('dt', { text: 'Số kiện' }), h('dd', { text: o.packages + ' kiện' }),
        h('dt', { text: 'Khách khai' }), h('dd', { text: [nfmt(o.weight, 'kg'), nfmt(o.volume, 'm³')].filter(Boolean).join(' · ') || 'Không khai' }),
        h('dt', { text: 'Ghi chú của khách' }), h('dd', { text: o.note || '—' }),
        h('dt', { text: 'Ngày tạo' }), h('dd', { text: fmtTime(o.created_at) }),
        o.received_at ? h('dt', { text: 'Khách nhận hàng' }) : null, o.received_at ? h('dd', { text: fmtTime(o.received_at) }) : null
      ]);
      box.appendChild(h('div', { class: 'panel-head' }, [h('div', null, [back, h('h1', { class: 'wb-big', text: o.waybill }), h('p', { class: 'muted' }, [ost(o.status)])])]));
      box.appendChild(h('div', { class: 'od' }, [
        h('div', { class: 'card' }, [
          h('h2', { text: 'Khách hàng' }),
          h('p', null, [h('b', { text: o.customer_name }), ' · ', h('a', { href: 'tel:' + o.phone, text: o.phone }), o.customer_company ? ' · ' + o.customer_company : '']),
          h('h2', { text: 'Thông tin đơn' }), info,
          h('h2', { text: 'Cân đo thực tế tại kho' }),
          h('div', { class: 'row' }, [h('div', { class: 'fld' }, [h('label', { for: wid, text: 'Số kg' }), mw]), h('div', { class: 'fld' }, [h('label', { for: vid, text: 'Số khối (m³)' }), mv])]),
          h('label', { for: aid, text: 'Ghi chú nội bộ' }), an, h('div', { class: 'actions' }, save)
        ]),
        h('div', { class: 'card' }, [addBox, h('h2', { text: 'Hành trình' }), evs.children.length ? evs : h('p', { class: 'muted', text: 'Chưa có bước nào.' })])
      ]));
    }).catch(function (e) { box.textContent = e.message; });
  }

  /* ---------- Tài khoản khách ---------- */
  loaders['khach-tk'] = function () {
    var box = $('customers');
    box.textContent = 'Đang tải…';
    var q = $('cust-q').value.trim();
    api('GET', '/api/admin/customers' + (q ? '?q=' + encodeURIComponent(q) : '')).then(function (j) {
      box.textContent = '';
      if (!j.items.length) { box.appendChild(h('p', { class: 'empty', text: q ? 'Không có khách nào khớp.' : 'Chưa có khách nào đăng ký tài khoản trên website.' })); return; }
      j.items.forEach(function (c) {
        var out = h('div');
        var reset = h('button', { class: 'btn ghost small', type: 'button', text: 'Cấp mật khẩu mới' });
        reset.addEventListener('click', function () {
          if (reset.dataset.sure !== '1') { reset.dataset.sure = '1'; reset.textContent = 'Bấm lần nữa để cấp'; return; }
          busy(reset, api('POST', '/api/admin/customers/' + c.id + '/reset-password', {}).then(function (r) {
            reset.dataset.sure = ''; reset.textContent = 'Cấp mật khẩu mới';
            out.textContent = '';
            out.appendChild(h('p', { class: 'muted', text: 'Mật khẩu mới (chỉ hiện một lần, báo cho khách rồi khách tự đổi):' }));
            out.appendChild(h('span', { class: 'temp-pw', text: r.password }));
          }).catch(function (e) { toast(e.message, true); }));
        });
        var lock = h('button', { class: 'btn small ' + (c.disabled ? 'ghost' : 'danger'), type: 'button', text: c.disabled ? 'Mở khóa' : 'Khóa tài khoản' });
        lock.addEventListener('click', function () {
          busy(lock, api('PATCH', '/api/admin/customers/' + c.id, { disabled: !c.disabled }).then(function () { toast(c.disabled ? 'Đã mở khóa.' : 'Đã khóa tài khoản.'); loaders['khach-tk'](); }).catch(function (e) { toast(e.message, true); }));
        });
        box.appendChild(h('article', { class: 'cust' }, [
          h('div', null, [
            h('h3', null, [c.name, c.disabled ? h('span', { class: 'locked', text: ' · Đã khóa' }) : null]),
            h('p', { class: 'muted', text: c.phone + (c.company ? ' · ' + c.company : '') + ' · ' + c.orders + ' đơn (' + c.open_orders + ' đang xử lý)' }),
            h('p', { class: 'muted', text: 'Đăng ký ' + fmtTime(c.created_at) + (c.last_login_at ? ' · đăng nhập gần nhất ' + fmtTime(c.last_login_at) : '') }),
            out
          ]),
          h('div', { class: 'actions' }, [h('a', { class: 'btn ghost small', href: '#van-don', text: 'Xem đơn', onclick: function () { $('order-q').value = c.phone; oFilter = ''; fsel.value = ''; } }), reset, lock])
        ]));
      });
    }).catch(function (e) { box.textContent = e.message; });
  };
  $('cust-search').addEventListener('submit', function (e) { e.preventDefault(); loaders['khach-tk'](); });


  /* ---------- Khởi động ---------- */
  api('GET', '/api/admin/me').then(function (j) { showApp(j.username); }).catch(showLogin);
})();
