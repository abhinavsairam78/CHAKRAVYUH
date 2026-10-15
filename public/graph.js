// Hand-rolled force-directed graph on a canvas (no libraries, works offline).
(function () {
  const css = getComputedStyle(document.documentElement);
  const COLORS = Object.fromEntries(['call', 'phone', 'upi', 'account', 'voice', 'script', 'honeytoken', 'url'].map((t) => [t, css.getPropertyValue(`--c-${t}`).trim()]));
  const TYPE_LABEL = { call: 'Call', phone: 'Phone number', upi: 'UPI ID', account: 'Bank account', voice: 'Voiceprint', script: 'Script pattern', honeytoken: 'Honeytoken', url: 'Link' };
  const SIZE = { call: 11, phone: 6, upi: 7, account: 7, voice: 6, script: 6, honeytoken: 7, url: 5 };

  const SERIES = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#9085e9', '#e66767', '#008300'];
  function ringColor(id, linked = true) {
    if (!id || !linked) return '#4b5563';
    let h = 0;
    for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return SERIES[h % SERIES.length];
  }

  class RingGraph {
    constructor(canvas, tooltip) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.tooltip = tooltip;
      this.nodes = new Map();
      this.edges = [];
      this.rings = [];
      this.alpha = 1;
      this.view = { x: 0, y: 0, k: 1 };
      this.pulses = new Map();
      this.hover = null;
      this.onSelect = null;
      new ResizeObserver(() => this.resize()).observe(canvas);
      this.resize();
      this.bind();
      // Physics on a timer (keeps settling even if the tab is in the background), drawing per frame.
      setInterval(() => this.tick(), 16);
      const loop = () => {
        this.draw();
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    }

    resize() {
      const dpr = window.devicePixelRatio || 1;
      const { width, height } = this.canvas.getBoundingClientRect();
      this.w = width;
      this.h = height;
      this.canvas.width = Math.round(width * dpr);
      this.canvas.height = Math.round(height * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    update(graph) {
      const next = new Map();
      const neighbors = new Map();
      for (const e of graph.edges) {
        if (!neighbors.has(e.target)) neighbors.set(e.target, []);
        if (!neighbors.has(e.source)) neighbors.set(e.source, []);
        neighbors.get(e.target).push(e.source);
        neighbors.get(e.source).push(e.target);
      }
      for (const n of graph.nodes) {
        const old = this.nodes.get(n.id);
        let x, y;
        if (old) ({ x, y } = old);
        else {
          const anchor = (neighbors.get(n.id) || []).map((id) => this.nodes.get(id)).find(Boolean);
          const a = Math.random() * Math.PI * 2;
          x = anchor ? anchor.x + Math.cos(a) * 40 : (Math.random() - 0.5) * 300;
          y = anchor ? anchor.y + Math.sin(a) * 40 : (Math.random() - 0.5) * 220;
        }
        next.set(n.id, { ...n, x, y, vx: old?.vx || 0, vy: old?.vy || 0, r: SIZE[n.type] + (n.type !== 'call' && n.callIds.length > 1 ? 3 : 0) });
      }
      this.nodes = next;
      this.edges = graph.edges.map((e) => ({ ...e, s: next.get(e.source), t: next.get(e.target) })).filter((e) => e.s && e.t);
      this.rings = graph.rings;
      // Each ring gets its own anchor so rings separate visually; unlinked calls sit on an outer orbit.
      this.anchors = new Map();
      const linked = graph.rings.filter((r) => r.linked), single = graph.rings.filter((r) => !r.linked);
      const cols = Math.max(1, Math.ceil(Math.sqrt(linked.length * 1.8)));
      const rows = Math.ceil(linked.length / cols);
      linked.forEach((r, i) => this.anchors.set(r.id, [((i % cols) - (cols - 1) / 2) * 360, (Math.floor(i / cols) - (rows - 1) / 2) * 300 - 40]));
      const perRow = Math.max(6, cols * 2);
      single.forEach((r, i) => this.anchors.set(r.id, [((i % perRow) - (Math.min(single.length, perRow) - 1) / 2) * 140, (rows / 2) * 300 + 40 + Math.floor(i / perRow) * 120]));
      this.linkedRings = new Set(linked.map((r) => r.id));
      this.alpha = Math.max(this.alpha, 0.8);
    }

    pulse(ids, ms = 7000) {
      const until = performance.now() + ms;
      for (const id of ids) this.pulses.set(id, until);
      this.alpha = Math.max(this.alpha, 0.4);
    }

    tick() {
      const nodes = [...this.nodes.values()];
      if (this.alpha < 0.01) return this.fit(nodes);
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j];
          let dx = b.x - a.x, dy = b.y - a.y;
          let d2 = Math.max(dx * dx + dy * dy, 25);
          if (d2 > 90000) continue;
          const f = Math.min(6, (a.type === 'call' && b.type === 'call' ? 2600 : 900) / d2);
          const d = Math.sqrt(d2);
          dx /= d; dy /= d;
          a.vx -= dx * f; a.vy -= dy * f;
          b.vx += dx * f; b.vy += dy * f;
        }
      }
      for (const e of this.edges) {
        const len = e.t.callIds.length > 1 ? 85 : 48;
        const dx = e.t.x - e.s.x, dy = e.t.y - e.s.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        const f = (d - len) * 0.035;
        e.s.vx += (dx / d) * f; e.s.vy += (dy / d) * f;
        e.t.vx -= (dx / d) * f; e.t.vy -= (dy / d) * f;
      }
      for (const n of nodes) {
        const [ax, ay] = this.anchors?.get(n.ring) || [0, 0];
        n.vx -= (n.x - ax) * 0.012; n.vy -= (n.y - ay) * 0.012;
        if (n === this.dragNode) continue;
        n.vx = Math.max(-20, Math.min(20, n.vx * 0.8));
        n.vy = Math.max(-20, Math.min(20, n.vy * 0.8));
        n.x += n.vx * this.alpha; n.y += n.vy * this.alpha;
      }
      this.alpha *= 0.992;
      this.fit(nodes);
    }

    fit(nodes) {
      if (this.userView || !nodes.length || this.w < 80 || this.h < 80) return;
      // Zoom to the selected ring, otherwise show everything.
      const focused = this.focus ? nodes.filter((n) => n.ring === this.focus) : [];
      if (focused.length) nodes = focused;
      const xs = nodes.map((n) => n.x), ys = nodes.map((n) => n.y);
      const [x0, x1, y0, y1] = [Math.min(...xs) - 50, Math.max(...xs) + 50, Math.min(...ys) - 85, Math.max(...ys) + 45];
      const k = Math.max(0.25, Math.min(focused.length ? 2.2 : 1.5, (this.w - 20) / Math.max(1, x1 - x0), (this.h - 20) / Math.max(1, y1 - y0)));
      this.view.k += (k - this.view.k) * 0.08;
      this.view.x += (-(x0 + x1) / 2 - this.view.x) * 0.08;
      this.view.y += (-(y0 + y1) / 2 - this.view.y) * 0.08;
    }

    toScreen(n) {
      return [this.w / 2 + (n.x + this.view.x) * this.view.k, this.h / 2 + (n.y + this.view.y) * this.view.k];
    }

    focusRing(id) {
      this.focus = id || null;
      this.userView = false;
    }

    draw() {
      const { ctx, w, h } = this;
      ctx.clearRect(0, 0, w, h);
      const now = performance.now();
      const k = this.view.k;

      // Ring halos
      for (const ring of this.rings) {
        if (!ring.linked) continue;
        const members = ring.callIds.map((id) => this.nodes.get(`call:${id}`)).filter(Boolean);
        if (!members.length) continue;
        const pts = [...this.nodes.values()].filter((n) => n.ring === ring.id).map((n) => this.toScreen(n));
        const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
        const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
        const dists = pts.map((p) => Math.hypot(p[0] - cx, p[1] - cy)).sort((a, b) => a - b);
        const r = dists[Math.floor((dists.length - 1) * 0.9)] + 24 * k;
        const color = ringColor(ring.id);
        ctx.globalAlpha = this.focus && this.focus !== ring.id ? 0.25 : 1;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = color + '12';
        ctx.fill();
        ctx.setLineDash([4, 6]);
        ctx.strokeStyle = color + '66';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = color;
        ctx.font = '600 12px "Segoe UI", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`${ring.id} · ${ring.callIds.length} calls`, cx, cy - r - 6);
        ctx.globalAlpha = 1;
      }

      // Edges
      for (const e of this.edges) {
        const [x1, y1] = this.toScreen(e.s);
        const [x2, y2] = this.toScreen(e.t);
        const shared = e.t.callIds.length > 1;
        ctx.globalAlpha = this.focus && e.s.ring !== this.focus ? 0.15 : 1;
        const hot = this.pulses.get(e.target) > now && this.pulses.get(e.source) > now;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.strokeStyle = hot ? '#ffd18a' : (COLORS[e.t.type] || '#888') + (shared ? 'aa' : '40');
        ctx.lineWidth = hot ? 2.5 : shared ? 1.6 : 1;
        if (e.t.type === 'voice' || e.t.type === 'script') ctx.setLineDash([5, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.globalAlpha = 1;

      // Nodes
      ctx.textAlign = 'center';
      for (const n of this.nodes.values()) {
        const [x, y] = this.toScreen(n);
        const r = n.r * Math.sqrt(k);
        const until = this.pulses.get(n.id);
        ctx.globalAlpha = this.focus && n.ring !== this.focus ? 0.2 : 1;
        if (until > now) {
          const p = (now % 1200) / 1200;
          ctx.beginPath();
          ctx.arc(x, y, r + 4 + p * 16, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(245,165,36,${0.8 * (1 - p)})`;
          ctx.lineWidth = 2;
          ctx.stroke();
        }
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        if (n.type === 'call') {
          ctx.fillStyle = n.channel === 'seed' ? '#1f2937' : '#334155';
          ctx.fill();
          ctx.lineWidth = 3;
          ctx.strokeStyle = ringColor(n.ring, this.linkedRings?.has(n.ring));
          ctx.stroke();
        } else {
          ctx.fillStyle = COLORS[n.type];
          ctx.fill();
          if (n.callIds.length > 1) {
            ctx.lineWidth = 2;
            ctx.strokeStyle = '#ffffffcc';
            ctx.stroke();
          }
        }
        const showLabel = this.hover === n || until > now || (this.focus ? n.ring === this.focus && (n.type === 'call' || n.callIds.length > 1) : n.type === 'call' && k > 0.75);
        if (showLabel) {
          ctx.font = n.type === 'call' ? '600 11.5px "Segoe UI", system-ui, sans-serif' : '11px Consolas, ui-monospace, monospace';
          ctx.fillStyle = n.type === 'call' ? '#e8eef5' : '#c6d2df';
          ctx.fillText(n.label, x, y + r + 13);
        }
      }
      ctx.globalAlpha = 1;
    }

    pick(mx, my) {
      let best = null, bestD = 14;
      for (const n of this.nodes.values()) {
        const [x, y] = this.toScreen(n);
        const d = Math.hypot(x - mx, y - my) - n.r;
        if (d < bestD) { best = n; bestD = d; }
      }
      return best;
    }

    bind() {
      const c = this.canvas;
      let drag = null;
      const pos = (e) => {
        const rect = c.getBoundingClientRect();
        return [e.clientX - rect.left, e.clientY - rect.top];
      };
      c.addEventListener('pointerdown', (e) => {
        const [mx, my] = pos(e);
        const node = this.pick(mx, my);
        drag = { mx, my, vx: this.view.x, vy: this.view.y, node, moved: false };
        this.dragNode = node;
        c.setPointerCapture(e.pointerId);
      });
      c.addEventListener('pointermove', (e) => {
        const [mx, my] = pos(e);
        if (drag) {
          if (Math.hypot(mx - drag.mx, my - drag.my) > 3) drag.moved = true;
          if (drag.node) {
            drag.node.x = (mx - this.w / 2) / this.view.k - this.view.x;
            drag.node.y = (my - this.h / 2) / this.view.k - this.view.y;
            this.alpha = Math.max(this.alpha, 0.3);
          } else {
            this.userView = true;
            this.view.x = drag.vx + (mx - drag.mx) / this.view.k;
            this.view.y = drag.vy + (my - drag.my) / this.view.k;
          }
          return;
        }
        const n = this.pick(mx, my);
        this.hover = n;
        if (!n) return (this.tooltip.hidden = true);
        this.tooltip.hidden = false;
        this.tooltip.style.left = `${Math.min(mx + 14, this.w - 290)}px`;
        this.tooltip.style.top = `${my + 14}px`;
        const calls = n.type === 'call' ? '' : `<span>Seen in ${n.callIds.join(', ')}</span>`;
        this.tooltip.innerHTML = `<b>${esc(TYPE_LABEL[n.type])}: ${esc(n.label)}</b><span>${esc(n.sub || '')}</span><br>${calls}`;
      });
      c.addEventListener('pointerup', () => {
        if (drag && !drag.moved && drag.node && this.onSelect) this.onSelect(drag.node);
        drag = null;
        this.dragNode = null;
      });
      c.addEventListener('dblclick', () => { this.userView = false; this.alpha = Math.max(this.alpha, 0.2); });
      c.addEventListener('pointerleave', () => { this.tooltip.hidden = true; this.hover = null; });
      c.addEventListener('wheel', (e) => {
        e.preventDefault();
        this.userView = true;
        this.view.k = Math.min(3, Math.max(0.4, this.view.k * (e.deltaY < 0 ? 1.1 : 0.9)));
      }, { passive: false });
    }
  }

  function esc(s) {
    return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  }

  window.RingGraph = RingGraph;
  window.ringColor = ringColor;
  window.NODE_COLORS = COLORS;
  window.TYPE_LABEL = TYPE_LABEL;
})();
