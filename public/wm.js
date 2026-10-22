// Tiny window manager: fixed (locked) windows, focus, minimize, close,
// taskbar buttons, and modal message boxes. Windows cannot be moved or resized.
const WM = (() => {
  const wins = new Map();
  let z = 10;
  let activeId = null;
  const layer = () => document.getElementById('windows');
  // layout size (unaffected by the low-res scale transform)
  const desk = () => { const d = document.getElementById('desktop'); return { width: d.offsetWidth, height: d.offsetHeight }; };

  function open(id, o = {}) {
    if (wins.has(id)) {
      const w = wins.get(id);
      if (o.title) setTitle(id, o.title);
      w.el.classList.remove('hidden');
      w.minimized = false;
      focus(id);
      return w;
    }
    const el = document.createElement('div');
    el.className = 'win' + (o.dialog ? ' dialog' : '');
    el.dataset.id = id;
    el.innerHTML = `
      <div class="titlebar">${ICONS[o.icon || 'chart'] || ''}<span class="title"></span>
        ${o.noClose ? '' : `<button class="tbtn close" data-wm="close" title="Close">${ICONS.close}</button>`}
      </div>
      <div class="body ${o.bodyClass || ''}"></div>
      `;
    el.querySelector('.title').textContent = o.title || id;
    (o.dialog ? document.getElementById('modal') : layer()).appendChild(el);

    const d = desk();
    const pos = { x: o.x, y: o.y, w: o.w || 420, h: o.h || 300 };
    if (o.center || pos.x === undefined) { pos.x = (d.width - pos.w) / 2; pos.y = Math.max(10, (d.height - pos.h) / 2 - 20); }
    Object.assign(el.style, { left: pos.x + 'px', top: pos.y + 'px', width: pos.w + 'px', height: pos.h + 'px' });

    const w = { id, el, body: el.querySelector('.body'), o, minimized: false, maxed: null };
    wins.set(id, w);

    el.addEventListener('mousedown', () => focus(id));
    el.querySelectorAll('[data-wm]').forEach((b) => b.addEventListener('click', (e) => {
      e.stopPropagation();
      const a = b.dataset.wm;
      if (a === 'close') close(id);
    }));
    clamp(w);
    focus(id);
    renderTasks();
    return w;
  }



  function clamp(w) {
    const d = desk();
    const r = w.el;
    if (r.offsetWidth > d.width) r.style.width = d.width - 4 + 'px';
    if (r.offsetHeight > d.height) r.style.height = d.height - 4 + 'px';
    r.style.left = Math.max(0, Math.min(d.width - Math.min(r.offsetWidth, 120), r.offsetLeft)) + 'px';
    r.style.top = Math.max(0, Math.min(d.height - 30, r.offsetTop)) + 'px';
  }



  function focus(id) {
    const w = wins.get(id);
    if (!w) return;
    activeId = id;
    w.el.style.zIndex = w.o.dialog ? 99999 : ++z;
    for (const x of wins.values()) x.el.classList.toggle('inactive', x.id !== id);
    renderTasks();
  }

  function minimize(id) {
    const w = wins.get(id);
    if (!w) return;
    w.minimized = true;
    w.el.classList.add('hidden');
    if (activeId === id) activeId = null;
    renderTasks();
  }

  function close(id) {
    const w = wins.get(id);
    if (!w) return;
    w.o.onClose?.();
    w.el.remove();
    wins.delete(id);
    if (w.o.dialog && !document.querySelector('#modal .win')) document.getElementById('modal').classList.add('hidden');
    renderTasks();
  }

  function setTitle(id, title) {
    const w = wins.get(id);
    if (!w || w.title === title) return;
    w.title = title;
    w.el.querySelector('.title').textContent = title;
    renderTasks();
  }

  function renderTasks() {} // the taskbar shows fixed quick-launch buttons instead of open windows

  // Message box. buttons: [{ label, primary, action, cls }]
  let dlgN = 0;
  function dialog({ title, icon = 'info', html, buttons = [{ label: 'OK', primary: true }], width = 380 }) {
    const id = 'dlg' + ++dlgN;
    document.getElementById('modal').classList.remove('hidden');
    const w = open(id, { title, icon, dialog: true, center: true, forcePos: true, w: width, h: 10 });
    w.el.style.height = 'auto';
    w.body.innerHTML = `${ICONS[icon] || ''}<div class="grow">${html}</div>`;
    const actions = document.createElement('div');
    actions.className = 'actions';
    for (const b of buttons) {
      const btn = document.createElement('button');
      btn.textContent = b.label;
      if (b.primary) btn.className = 'primary';
      if (b.cls) btn.classList.add(b.cls);
      btn.onclick = () => { if (b.action?.() === false) return; close(id); };
      actions.appendChild(btn);
    }
    w.el.appendChild(actions);
    const d = desk();
    w.el.style.top = Math.max(10, (d.height - w.el.offsetHeight) / 2 - 30) + 'px';
    w.el.querySelector('button.primary')?.focus();
    return id;
  }

  // put a window at a fixed spot (used to re-lay-out on screen resize)
  function place(id, p) {
    const w = wins.get(id);
    if (!w) return;
    Object.assign(w.el.style, { left: p.x + 'px', top: p.y + 'px', width: p.w + 'px', height: p.h + 'px' });
    w.o.onResize?.();
  }

  function recenter() {
    const d = desk();
    for (const w of wins.values()) {
      if (!w.o.center) continue;
      w.el.style.left = Math.max(0, (d.width - w.el.offsetWidth) / 2) + 'px';
      w.el.style.top = Math.max(10, (d.height - w.el.offsetHeight) / 2 - 20) + 'px';
    }
  }

  function closeAll(pred = () => true) { for (const id of [...wins.keys()]) if (pred(id, wins.get(id))) close(id); }
  return { open, close, minimize, focus, setTitle, dialog, closeAll, place, recenter, clampAll: () => { for (const w of wins.values()) clamp(w); },
    get: (id) => wins.get(id), isOpen: (id) => wins.has(id) };
})();
