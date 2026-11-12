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
    return d.toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
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
  var TABS = ['khach-hang', 'ban-nhap', 'noi-dung', 'tai-khoan'];
  var loaders = {};
  function route() {
    var t = location.hash.slice(1);
    if (TABS.indexOf(t) < 0) t = 'khach-hang';
    document.querySelectorAll('[data-panel]').forEach(function (p) { p.hidden = p.dataset.panel !== t; });
    document.querySelectorAll('.tabs a').forEach(function (a) { if (a.dataset.tab === t) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    if (loaders[t]) loaders[t]();
  }
  window.addEventListener('hashchange', function () { if (!$('app-view').hidden) route(); });
  function refreshBadges() {
    api('GET', '/api/admin/leads?status=new').then(function (j) { var n = j.items.length; $('badge-leads').hidden = !n; $('badge-leads').textContent = n; }).catch(function () {});
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

  /* ---------- Khởi động ---------- */
  api('GET', '/api/admin/me').then(function (j) { showApp(j.username); }).catch(showLogin);
})();
