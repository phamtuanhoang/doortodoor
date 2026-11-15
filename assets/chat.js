/* Trợ lý chat AI ở góc phải dưới website. Máy chủ: POST /api/chat (server/chat.js).
   Chỉ hiện khi máy chủ đã bật trợ lý (đã gắn khóa API). Lịch sử lưu trong tab trình duyệt hiện tại. */
(function () {
  var API = (window.D2D_API || '').replace(/\/$/, '');
  if (!API) return;

  var GREETING = 'Chào anh/chị! Em là trợ lý của doortodoor. Em có thể giải đáp về vận chuyển hàng chính ngạch Trung Quốc – Việt Nam, tình hình cửa khẩu, tra cứu vận đơn, hoặc nhận yêu cầu báo giá để nhân viên liên hệ.';
  var SUGGEST = ['Gửi hàng từ Quảng Châu về Hà Nội thế nào?', 'Tình hình cửa khẩu Hữu Nghị hiện nay?', 'Tra cứu vận đơn của tôi', 'Tôi muốn nhận báo giá'];

  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k]; if (v == null || v === false) return;
      if (k === 'text') el.textContent = v; else if (k === 'class') el.className = v;
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v); else el.setAttribute(k, v);
    });
    (function add(k) { if (Array.isArray(k)) return k.forEach(add); if (k != null && k !== false) el.appendChild(typeof k === 'string' ? document.createTextNode(k) : k); })(kids);
    return el;
  }
  function svg(path, size) {
    var ns = 'http://www.w3.org/2000/svg', s = document.createElementNS(ns, 'svg');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', size); s.setAttribute('height', size); s.setAttribute('aria-hidden', 'true');
    var p = document.createElementNS(ns, 'path'); p.setAttribute('d', path); p.setAttribute('fill', 'none'); p.setAttribute('stroke', 'currentColor');
    p.setAttribute('stroke-width', '2'); p.setAttribute('stroke-linecap', 'round'); p.setAttribute('stroke-linejoin', 'round'); s.appendChild(p);
    return s;
  }
  var ICON_CHAT = 'M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.9A8 8 0 1 1 21 12z M8.5 12h.01 M12 12h.01 M15.5 12h.01';
  var ICON_X = 'M6 6l12 12 M18 6L6 18';
  var ICON_SEND = 'M4 12l16-8-6 16-2.5-6.5L4 12z';

  var store = {
    get: function (k) { try { return JSON.parse(sessionStorage.getItem(k)); } catch (e) { return null; } },
    set: function (k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };
  var state = store.get('d2d_chat') || { session: null, messages: [] };
  function save() { store.set('d2d_chat', { session: state.session, messages: state.messages.slice(-30) }); }

  /* ---------- Giao diện ---------- */
  var launcher = h('button', { class: 'chat-fab', type: 'button', 'aria-expanded': 'false', 'aria-controls': 'chat-panel', 'aria-label': 'Mở trợ lý hỏi đáp' },
    [svg(ICON_CHAT, 26), h('span', { class: 'chat-fab-label', text: 'Hỏi doortodoor' })]);
  var log = h('div', { class: 'chat-log', role: 'log', 'aria-live': 'polite' });
  var input = h('textarea', { id: 'chat-input', rows: '1', maxlength: '800', placeholder: 'Nhập câu hỏi…', 'aria-label': 'Câu hỏi của bạn' });
  var send = h('button', { class: 'chat-send', type: 'submit', 'aria-label': 'Gửi' }, svg(ICON_SEND, 20));
  var form = h('form', { class: 'chat-form' }, [input, send]);
  var close = h('button', { class: 'chat-close', type: 'button', 'aria-label': 'Đóng trợ lý' }, svg(ICON_X, 20));
  var panel = h('section', { class: 'chat-panel', id: 'chat-panel', role: 'dialog', 'aria-label': 'Trợ lý doortodoor', hidden: true }, [
    h('header', { class: 'chat-head' }, [
      h('span', { class: 'd2d small', 'aria-hidden': 'true' }, ['D', h('span', { text: '2' }), 'D']),
      h('div', null, [h('b', { text: 'Trợ lý doortodoor' }), h('small', { text: 'Trả lời tự động bằng AI · 24/7' })]),
      close
    ]),
    log,
    form,
    h('p', { class: 'chat-note', text: 'Trợ lý AI có thể nhầm. Giá và lịch trình chính xác do nhân viên xác nhận. Hội thoại được lưu để hỗ trợ bạn tốt hơn.' })
  ]);

  function bubble(role, text) {
    var b = h('div', { class: 'chat-msg ' + (role === 'user' ? 'me' : 'bot') });
    // In đậm **...**, giữ xuống dòng; không dùng innerHTML
    String(text).split(/(\*\*[^*]+\*\*)/g).forEach(function (part) {
      if (/^\*\*[^*]+\*\*$/.test(part)) b.appendChild(h('b', { text: part.slice(2, -2) }));
      else if (part) b.appendChild(document.createTextNode(part.replace(/^#+\s*/gm, '')));
    });
    return b;
  }
  function chips() {
    return h('div', { class: 'chat-chips' }, SUGGEST.map(function (s) {
      return h('button', { type: 'button', text: s, onclick: function () { ask(s); } });
    }));
  }
  function draw() {
    log.textContent = '';
    log.appendChild(bubble('assistant', GREETING));
    if (!state.messages.length) log.appendChild(chips());
    state.messages.forEach(function (m) { log.appendChild(bubble(m.role, m.content)); });
    log.scrollTop = log.scrollHeight;
  }
  var typing = h('div', { class: 'chat-msg bot typing', 'aria-label': 'Đang trả lời' }, [h('i'), h('i'), h('i')]);

  var busy = false;
  function ask(text) {
    text = String(text || '').trim();
    if (!text || busy) return;
    busy = true; send.disabled = true;
    state.messages.push({ role: 'user', content: text.slice(0, 800) }); save();
    input.value = ''; grow();
    draw(); log.appendChild(typing); log.scrollTop = log.scrollHeight;
    fetch(API + '/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session: state.session, messages: state.messages.slice(-16), page: location.hash.slice(1).split('/')[0] || 'trang-chu' })
    }).then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) {
      if (j.session) state.session = j.session;
      if (r.status === 429) return 'Anh/chị hỏi hơi nhanh, vui lòng đợi vài phút rồi hỏi tiếp, hoặc gọi hotline để được hỗ trợ ngay.';
      return j.reply || j.error || 'Xin lỗi, em chưa trả lời được. Anh/chị thử lại sau ít phút.';
    }); })
      .catch(function () { return 'Không kết nối được máy chủ. Anh/chị kiểm tra mạng rồi thử lại.'; })
      .then(function (reply) {
        state.messages.push({ role: 'assistant', content: reply }); save();
        busy = false; send.disabled = false; draw();
        if (!matchMedia('(pointer: coarse)').matches) input.focus();
      });
  }
  function grow() { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 120) + 'px'; }
  input.addEventListener('input', grow);
  input.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); ask(input.value); } });
  form.addEventListener('submit', function (e) { e.preventDefault(); ask(input.value); });

  function open() {
    panel.hidden = false; launcher.setAttribute('aria-expanded', 'true'); document.body.classList.add('chat-open');
    draw(); setTimeout(function () { input.focus(); }, 30);
  }
  function shut() { panel.hidden = true; launcher.setAttribute('aria-expanded', 'false'); document.body.classList.remove('chat-open'); launcher.focus(); }
  launcher.addEventListener('click', function () { if (panel.hidden) open(); else shut(); });
  close.addEventListener('click', shut);
  panel.addEventListener('keydown', function (e) { if (e.key === 'Escape') shut(); });

  // Chỉ hiện khi máy chủ đã bật trợ lý
  fetch(API + '/api/chat/status').then(function (r) { return r.json(); }).then(function (j) {
    if (!j.enabled) return;
    document.body.appendChild(panel); document.body.appendChild(launcher);
  }).catch(function () {});
})();
