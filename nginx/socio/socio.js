/* ============================================================================
   Latido — Portal del Socio. Vanilla JS, delegación por data-action (CSP estricto).
   Token propio 'latido_socio_token'. Solo lectura financiera + KYC + auditoría.
   ============================================================================ */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const BASE = '/api';
  const TOKEN_KEY = 'latido_socio_token';
  const tok = { get() { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } }, set(t) { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch {} } };
  const state = { me: null };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const cop = (n) => '$' + Number(n || 0).toLocaleString('es-CO');
  const num = (n) => Number(n || 0).toLocaleString('es-CO');
  const dt = (s) => { try { return new Date(s).toLocaleString('es-CO', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };
  const spin = () => '<div class="empty">Cargando…</div>';
  let toastT; function toast(m) { const t = $('toast'); if (!t) return; t.textContent = m; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2800); }

  async function api(path, { method = 'GET', body } = {}) {
    const headers = {}; if (body) headers['Content-Type'] = 'application/json';
    const t = tok.get(); if (t) headers['Authorization'] = 'Bearer ' + t;
    const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    let data = {}; try { data = await res.json(); } catch {}
    if (!res.ok) { const e = new Error((data && data.error) || ('http_' + res.status)); e.status = res.status; e.data = data; throw e; }
    return data;
  }

  /* ---------- Login ---------- */
  async function doLogin(e) {
    e.preventDefault();
    const email = $('email').value.trim(), pass = $('pass').value, totp = $('totp').value.trim();
    $('loginErr').textContent = '';
    try {
      const body = { identifier: email, password: pass }; if (totp) body.totpCode = totp;
      const r = await api('/auth/login', { method: 'POST', body });
      tok.set(r.accessToken);
      const me = await api('/users/me');
      if (!['partner', 'admin'].includes(me.role)) { tok.set(null); $('loginErr').textContent = 'Acceso restringido a socios autorizados.'; return; }
      state.me = me; enterApp();
    } catch (err) {
      if (err.data?.error === 'totp_required' || err.data?.error === 'totp_invalid') { $('totp').classList.remove('hidden'); $('totp').focus(); $('loginErr').textContent = err.data.error === 'totp_invalid' ? 'Código 2FA inválido.' : 'Ingresa tu código 2FA.'; }
      else if (err.data?.error === 'rate_limited' || err.data?.error === 'account_locked') $('loginErr').textContent = 'Demasiados intentos. Espera un momento.';
      else $('loginErr').textContent = 'Credenciales incorrectas.';
    }
  }
  function logout() { tok.set(null); state.me = null; $('app').classList.add('hidden'); $('login').classList.remove('hidden'); }
  function enterApp() {
    $('login').classList.add('hidden'); $('app').classList.remove('hidden');
    $('whoName').textContent = state.me.displayName || state.me.email; $('whoRole').textContent = state.me.role === 'admin' ? 'admin' : 'socio';
    navigate('panel');
  }

  /* ---------- Navegación ---------- */
  const TITLES = { panel: 'Panel del socio', finanzas: 'Finanzas y distribución', movimientos: 'Mis movimientos', kyc: 'Verificaciones KYC', auditoria: 'Auditoría' };
  const RENDER = {};
  function navigate(v) {
    document.querySelectorAll('.nav-item').forEach((n) => n.classList.toggle('on', n.dataset.nav === v));
    $('pageTitle').textContent = TITLES[v] || 'Socio';
    (RENDER[v] || (() => {}))();
  }

  let cache = null;
  async function loadDash(force) { if (!cache || force) cache = await api('/partner/dashboard'); return cache; }

  /* ---------- Panel ---------- */
  RENDER.panel = async function () {
    const c = $('content'); c.innerHTML = spin();
    try {
      const d = await loadDash(true); const me = d.me; const f = d.finance; const t = f.totals || {};
      const miPct = me ? (me.shareBps / 100).toFixed(2) + '%' : '—';
      c.innerHTML = `
      <div class="kpi-grid">
        <div class="kpi"><div class="v">${me ? cop(me.balanceCop) : '—'}</div><div class="l">Mi saldo (por consignar)</div></div>
        <div class="kpi"><div class="v">${miPct}</div><div class="l">Mi participación (peso)</div></div>
        <div class="kpi"><div class="v">${cop(t.gross)}</div><div class="l">Ingresos brutos (total)</div></div>
        <div class="kpi"><div class="v">${cop(t.partners)}</div><div class="l">Repartido a socios</div></div>
        <div class="kpi"><div class="v">${cop(f.egresos.modelPayoutsPaidCop + f.egresos.partnerSettledCop)}</div><div class="l">Egresos (pagos realizados)</div></div>
        <div class="kpi"><div class="v">${num(t.n)}</div><div class="l">Transacciones</div></div>
      </div>
      <div class="panel"><div class="panel-h">Estado del sistema</div>
        <div class="srow"><div class="sk">Usuarios / Creadoras</div><span class="sv">${num(d.system.counts.users)} · ${num(d.system.counts.models)}</span></div>
        <div class="srow"><div class="sk">En vivo ahora / Llamadas activas</div><span class="sv">${num(d.system.counts.liveNow)} · ${num(d.system.counts.activeCalls)}</span></div>
        <div class="srow"><div class="sk">KYC pendientes</div><span class="sv">${num(d.system.counts.pendingKyc)}</span></div>
        <div class="srow"><div class="sk">Base de datos / Redis</div><span class="sv"><span class="pill ok">OK</span> ${d.system.db.latencyMs ?? '—'}ms · Redis ${d.system.redis.ok ? '<span class="pill ok">OK</span>' : '<span class="pill bad">FALLA</span>'}</span></div>
      </div>`;
    } catch (e) { c.innerHTML = `<div class="empty">Error (${esc(e.message)}).</div>`; }
  };

  /* ---------- Finanzas ---------- */
  RENDER.finanzas = async function () {
    const c = $('content'); c.innerHTML = spin();
    try {
      const d = await loadDash(); const f = d.finance; const t = f.totals || {};
      c.innerHTML = `
      <div class="kpi-grid">
        <div class="kpi"><div class="v">${cop(t.gross)}</div><div class="l">Bruto total (ingresos)</div></div>
        <div class="kpi"><div class="v">${cop(t.model)}</div><div class="l">A modelos</div></div>
        <div class="kpi"><div class="v">${cop(t.platform)}</div><div class="l">Plataforma</div></div>
        <div class="kpi"><div class="v">${cop(t.admin)}</div><div class="l">Administrador</div></div>
        <div class="kpi"><div class="v">${cop(t.partners)}</div><div class="l">Socios</div></div>
      </div>
      <div class="panel"><div class="panel-h">Egresos (pagos realizados)</div>
        <div class="srow"><div class="sk">Pagado a modelos (payouts)</div><span class="sv">${cop(f.egresos.modelPayoutsPaidCop)}</span></div>
        <div class="srow"><div class="sk">Consignado a socios</div><span class="sv">${cop(f.egresos.partnerSettledCop)}</span></div>
      </div>
      <div class="panel"><div class="panel-h">Participación por socio</div>
        <table><thead><tr><th>Socio</th><th>Peso</th><th>Saldo</th><th>Ganado (total)</th><th>Estado</th></tr></thead><tbody>
        ${(f.partners || []).map((p) => `<tr><td>${esc(p.name)}</td><td>${p.share_bps} <span class="muted">(${(p.share_bps / 100).toFixed(2)}%)</span></td><td><b>${cop(p.balance_cop)}</b></td><td class="muted">${cop(p.total_earned_cop)}</td><td>${p.is_active ? '<span class="pill ok">Activo</span>' : '<span class="pill bad">Inactivo</span>'}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">Sin socios.</td></tr>'}
        </tbody></table></div>
      <div class="panel"><div class="panel-h">Por fuente</div>
        ${(f.bySource || []).map((s) => `<div class="srow"><div class="sk">${esc(s.source)}</div><span class="sv">${cop(s.gross)} bruto · plataforma ${cop(s.platform)} · ${num(s.n)} tx</span></div>`).join('') || '<div class="empty">Sin ingresos aún.</div>'}
      </div>
      <div class="panel"><div class="panel-h">Últimos movimientos</div>
        <table><thead><tr><th>Fuente</th><th>Bruto</th><th>Modelo</th><th>Admin</th><th>Socios</th><th>Fecha</th></tr></thead><tbody>
        ${(f.recent || []).map((e) => `<tr><td>${esc(e.source)}</td><td>${cop(e.gross_cop)}</td><td>${cop(e.model_cop)}</td><td>${cop(e.admin_cop)}</td><td>${cop(e.partners_cop)}</td><td class="muted">${dt(e.created_at)}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">Sin movimientos.</td></tr>'}
        </tbody></table></div>`;
    } catch (e) { c.innerHTML = `<div class="empty">Error (${esc(e.message)}).</div>`; }
  };

  /* ---------- Mis movimientos ---------- */
  RENDER.movimientos = async function () {
    const c = $('content'); c.innerHTML = spin();
    try {
      const { items } = await api('/partner/ledger');
      const rows = (items || []).map((m) => `<tr><td>${Number(m.amount_cop) < 0 ? '⬇️ Consignación' : '⬆️ Ingreso'}</td>
        <td style="color:${Number(m.amount_cop) < 0 ? 'var(--danger)' : 'var(--ok)'}"><b>${cop(m.amount_cop)}</b></td>
        <td class="muted">${cop(m.balance_cop)}</td><td class="muted">${esc(m.memo || '')}</td><td class="muted">${dt(m.created_at)}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">Aún no tienes movimientos.</td></tr>';
      c.innerHTML = `<div class="panel"><div class="panel-h">Mis movimientos (participación)</div>
        <table><thead><tr><th>Tipo</th><th>Monto</th><th>Saldo</th><th>Detalle</th><th>Fecha</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    } catch (e) { c.innerHTML = `<div class="empty">Error (${esc(e.message)}).</div>`; }
  };

  /* ---------- KYC ---------- */
  RENDER.kyc = async function () {
    const c = $('content'); c.innerHTML = spin();
    try {
      const { items } = await api('/partner/kyc/queue');
      const rows = (items || []).map((k) => `<div class="srow"><div style="flex:1"><div class="sk">${esc(k.full_name || 'Sin nombre')}</div><div class="sv">${esc(k.document_type || '')} · ${esc(k.status)} · ${dt(k.submitted_at)}</div></div>
        <div style="display:flex;gap:6px"><button class="btn btn-ok btn-sm" data-action="kycDecide" data-arg="${k.id}|approve">✓ Aprobar</button>
        <button class="btn btn-danger btn-sm" data-action="kycDecide" data-arg="${k.id}|reject">✗ Rechazar</button></div></div>`).join('') || '<div class="empty">Sin verificaciones pendientes.</div>';
      c.innerHTML = `<div class="panel"><div class="panel-h">Verificaciones KYC pendientes</div>${rows}</div>`;
    } catch (e) { c.innerHTML = `<div class="empty">Error (${esc(e.message)}).</div>`; }
  };
  async function kycDecide(arg) {
    const [id, decision] = arg.split('|');
    if (!confirm(`¿${decision === 'approve' ? 'Aprobar' : 'Rechazar'} esta verificación?`)) return;
    try { await api('/partner/kyc/' + id + '/decision', { method: 'POST', body: { decision } }); toast('KYC ' + (decision === 'approve' ? 'aprobado ✓' : 'rechazado')); RENDER.kyc(); }
    catch { toast('Error'); }
  }

  /* ---------- Auditoría ---------- */
  RENDER.auditoria = async function () {
    const c = $('content'); c.innerHTML = spin();
    try {
      const { items } = await api('/partner/audit?limit=80');
      const rows = (items || []).map((a) => `<tr><td><b>${esc(a.action)}</b></td><td>${esc(a.actor_name || 'sistema')}</td>
        <td class="muted">${esc(a.entity || '')} ${esc(a.ip || '')}</td><td class="muted">${dt(a.created_at)}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">Sin registros.</td></tr>';
      c.innerHTML = `<div class="panel"><div class="panel-h">Registro de auditoría</div><table><thead><tr><th>Acción</th><th>Actor</th><th>Detalle</th><th>Fecha</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    } catch (e) { c.innerHTML = `<div class="empty">Error (${esc(e.message)}).</div>`; }
  };

  /* ---------- Acciones + arranque ---------- */
  const ACT = { go: (a) => navigate(a), kycDecide: (a) => kycDecide(a) };
  document.addEventListener('click', (e) => {
    const nav = e.target.closest('[data-nav]'); if (nav) { navigate(nav.dataset.nav); return; }
    const el = e.target.closest('[data-action]'); if (el) { const fn = ACT[el.dataset.action]; if (fn) fn(el.dataset.arg, el); }
  });
  $('loginForm').addEventListener('submit', doLogin);
  $('logoutBtn').addEventListener('click', logout);

  (async function boot() {
    if (tok.get()) { try { const me = await api('/users/me'); if (['partner', 'admin'].includes(me.role)) { state.me = me; enterApp(); return; } } catch {} tok.set(null); }
  })();
})();
