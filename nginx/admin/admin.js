/* ============================================================================
   Latido — Consola de Administración (web independiente). Vanilla JS, delegación
   por data-action (CSP estricto). Token propio 'latido_admin_token'.
   ============================================================================ */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const BASE = '/api';
  const TOKEN_KEY = 'latido_admin_token';
  const tok = { get() { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } }, set(t) { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch {} } };
  const state = { me: null, activeUser: null };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const cop = (n) => '$' + Number(n || 0).toLocaleString('es-CO');
  const num = (n) => Number(n || 0).toLocaleString('es-CO');
  const dt = (s) => { try { return new Date(s).toLocaleString('es-CO', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };
  const spin = () => '<div class="empty">Cargando…</div>';
  const letter = (n) => ((n || '?').trim()[0] || '?').toUpperCase();
  function qs(p) { if (!p) return ''; const s = Object.entries(p).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&'); return s ? '?' + s : ''; }
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
      if (!['admin', 'moderator'].includes(me.role)) { tok.set(null); $('loginErr').textContent = 'Acceso restringido a personal autorizado.'; return; }
      state.me = me; enterApp();
    } catch (err) {
      if (err.data?.error === 'totp_required' || err.data?.error === 'totp_invalid') { $('totp').classList.remove('hidden'); $('totp').focus(); $('loginErr').textContent = err.data.error === 'totp_invalid' ? 'Código 2FA inválido.' : 'Ingresa tu código 2FA.'; }
      else $('loginErr').textContent = 'Credenciales incorrectas.';
    }
  }
  function logout() { tok.set(null); state.me = null; $('app').classList.add('hidden'); $('login').classList.remove('hidden'); }
  function enterApp() {
    $('login').classList.add('hidden'); $('app').classList.remove('hidden');
    $('whoName').textContent = state.me.displayName || state.me.email; $('whoRole').textContent = state.me.role;
    navigate('dashboard');
  }

  /* ---------- Navegación ---------- */
  const TITLES = { dashboard: 'Dashboard', finanzas: 'Finanzas', usuarios: 'Usuarios', kyc: 'Verificaciones KYC', reportes: 'Reportes', moderacion: 'Moderación de conversaciones', config: 'Configuración', auditoria: 'Auditoría' };
  const RENDER = {};
  function navigate(v) {
    document.querySelectorAll('.nav-item').forEach((n) => n.classList.toggle('on', n.dataset.nav === v));
    $('pageTitle').textContent = TITLES[v] || 'Admin';
    (RENDER[v] || (() => {}))();
  }

  /* ---------- Dashboard ---------- */
  RENDER.dashboard = async function () {
    const c = $('content'); c.innerHTML = spin();
    try {
      const d = await api('/admin/dashboard');
      const cards = [];
      const push = (l, v) => cards.push(`<div class="card kpi"><div class="v">${v}</div><div class="l">${esc(l)}</div></div>`);
      // Renderiza de forma robusta los escalares que devuelva el backend.
      const LABELS = { users: 'Usuarios', total_users: 'Usuarios', models: 'Creadoras', total_models: 'Creadoras', active_subs: 'Suscripciones activas', subscriptions: 'Suscripciones', revenue_cop: 'Ingresos (COP)', revenueCop: 'Ingresos (COP)', pending_kyc: 'KYC pendientes', open_reports: 'Reportes abiertos', online: 'En línea', live: 'En vivo', payouts_pending: 'Payouts pendientes' };
      Object.entries(d || {}).forEach(([k, v]) => { if (typeof v === 'number') push(LABELS[k] || k, /cop|revenue/i.test(k) ? cop(v) : num(v)); });
      if (!cards.length) push('Datos', '—');
      c.innerHTML = `<div class="kpi-grid">${cards.join('')}</div>
        <div class="panel"><div class="panel-h">Resumen</div><div class="panel-b"><pre style="margin:0;white-space:pre-wrap;font-size:.8rem;color:var(--muted)">${esc(JSON.stringify(d, null, 2))}</pre></div></div>`;
    } catch (e) { c.innerHTML = `<div class="empty">Error al cargar el dashboard (${esc(e.message)}).</div>`; }
  };

  /* ---------- Finanzas (payouts) ---------- */
  RENDER.finanzas = async function () {
    const c = $('content'); c.innerHTML = spin();
    try {
      const { items } = await api('/admin/payouts' + qs({ status: 'pending' }));
      const rows = (items || []).map((p) => `<tr>
        <td>${esc(p.model_name || p.handle || p.user_id)}</td>
        <td>${cop(p.amount_cop)}</td>
        <td>${esc(p.method || '—')}</td>
        <td><span class="badge b-pending">${esc(p.status)}</span></td>
        <td><button class="btn btn-ok btn-sm" data-action="approvePayout" data-arg="${p.id}">Aprobar</button></td>
      </tr>`).join('') || '<tr><td colspan="5" class="empty">Sin payouts pendientes.</td></tr>';
      c.innerHTML = `<div class="panel"><div class="panel-h">Solicitudes de retiro (payouts) pendientes</div>
        <table><thead><tr><th>Creadora</th><th>Monto</th><th>Método</th><th>Estado</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
        <p class="muted" style="font-size:.82rem">Aprobar un payout descuenta del balance de la creadora y lo marca como pagado (audita la acción).</p>`;
    } catch (e) { c.innerHTML = `<div class="empty">Error al cargar finanzas (${esc(e.message)}).</div>`; }
  };
  async function approvePayout(id) {
    if (!confirm('¿Aprobar este retiro? Esta acción queda auditada.')) return;
    try { await api('/admin/payouts/' + id + '/approve', { method: 'POST', body: {} }); toast('Payout aprobado ✓'); RENDER.finanzas(); }
    catch { toast('Error al aprobar'); }
  }

  /* ---------- Usuarios ---------- */
  RENDER.usuarios = async function () {
    const c = $('content');
    c.innerHTML = `<div class="toolbar"><input class="field search" id="uq" type="search" placeholder="Buscar por nombre, correo o handle…" style="margin:0" /></div>
      <div class="panel" id="userPanel"><div class="panel-b">${spin()}</div></div>`;
    const uq = $('uq'); let t;
    uq.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => loadUsers(uq.value.trim()), 300); });
    loadUsers('');
  };
  async function loadUsers(q) {
    const el = $('userPanel'); if (!el) return; el.innerHTML = `<div class="panel-b">${spin()}</div>`;
    try {
      const { items } = await api('/admin/users' + qs({ q, limit: 50 }));
      const rows = (items || []).map((u) => `<tr class="link" data-action="openUser" data-arg="${u.id}">
        <td><b>${esc(u.display_name || u.email || '—')}</b></td>
        <td class="muted">${esc(u.email || u.phone || '')}</td>
        <td>${esc(u.role)}</td>
        <td><span class="badge b-${esc(u.status)}">${esc(u.status)}</span></td>
        <td class="muted">${dt(u.created_at)}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">Sin resultados.</td></tr>';
      el.innerHTML = `<table><thead><tr><th>Nombre</th><th>Contacto</th><th>Rol</th><th>Estado</th><th>Registro</th></tr></thead><tbody>${rows}</tbody></table>`;
    } catch (e) { el.innerHTML = `<div class="empty">Error (${esc(e.message)}).</div>`; }
  }
  async function openUser(id) {
    const c = $('content'); c.innerHTML = spin();
    try {
      const u = await api('/admin/users/' + id); state.activeUser = u;
      const roleOpts = ['user', 'model', 'moderator', 'admin'].map((r) => `<option value="${r}" ${u.role === r ? 'selected' : ''}>${r}</option>`).join('');
      c.innerHTML = `<button class="btn btn-sm" data-action="go" data-arg="usuarios">← Usuarios</button>
        <div class="panel" style="margin-top:14px"><div class="panel-h"><span>${esc(u.display_name || u.email)}</span><span class="badge b-${esc(u.status)}">${esc(u.status)}</span></div>
          <div class="panel-b">
            <div class="row" style="border:none;padding:0 0 14px"><div class="av">${letter(u.display_name || u.email)}</div>
              <div><div><b>${esc(u.display_name || '—')}</b></div><div class="muted">${esc(u.email || u.phone || '')} · ${esc(u.role)} · id ${esc(String(u.id).slice(0, 8))}</div></div></div>
            <div class="toolbar">
              <select class="field" id="roleSel" style="width:auto;margin:0">${roleOpts}</select>
              <button class="btn btn-sm" data-action="setRole" data-arg="${u.id}">Cambiar rol</button>
              <button class="btn btn-ok btn-sm" data-action="setStatus" data-arg="${u.id}|active">Activar</button>
              <button class="btn btn-warn btn-sm" data-action="setStatus" data-arg="${u.id}|suspended">Suspender</button>
              <button class="btn btn-danger btn-sm" data-action="setStatus" data-arg="${u.id}|banned">Banear</button>
            </div>
            <div class="toolbar"><input class="field" id="notifMsg" placeholder="Enviar notificación al usuario…" style="flex:1;margin:0" /><button class="btn btn-sm" data-action="notifyUser" data-arg="${u.id}">Enviar</button></div>
          </div></div>`;
    } catch (e) { c.innerHTML = `<div class="empty">Error (${esc(e.message)}).</div>`; }
  }
  async function setStatus(arg) {
    const [id, status] = arg.split('|'); const reason = prompt(`Motivo para "${status}" (queda auditado):`) || '';
    try { await api('/admin/users/' + id + '/status', { method: 'PATCH', body: { status, reason } }); toast('Estado actualizado ✓'); openUser(id); }
    catch { toast('Error'); }
  }
  async function setRole(id) {
    const role = $('roleSel') && $('roleSel').value; if (!role) return;
    if (!confirm(`¿Asignar rol "${role}"?`)) return;
    try { await api('/admin/users/' + id + '/role', { method: 'PATCH', body: { role } }); toast('Rol actualizado ✓'); openUser(id); }
    catch { toast('Error'); }
  }
  async function notifyUser(id) {
    const msg = $('notifMsg') && $('notifMsg').value.trim(); if (!msg) return;
    try { await api('/admin/users/' + id + '/notify', { method: 'POST', body: { title: 'Mensaje de administración', body: msg } }); toast('Notificación enviada ✓'); $('notifMsg').value = ''; }
    catch { toast('Error'); }
  }

  /* ---------- KYC ---------- */
  RENDER.kyc = async function () {
    const c = $('content'); c.innerHTML = spin();
    try {
      const { items } = await api('/admin/kyc/queue');
      const rows = (items || []).map((k) => `<div class="row">
        <div class="av">${letter(k.display_name || k.full_name)}</div>
        <div style="flex:1"><b>${esc(k.display_name || k.full_name)}</b>
          <div class="muted" style="font-size:.8rem">${esc(k.email || '')} · ${esc(k.document_type || '—')} · ${esc(k.full_name || '')}</div>
          <div class="muted" style="font-size:.75rem">Enviado ${dt(k.submitted_at)} · face: ${k.face_match_score ?? 'N/A'}</div></div>
        <span class="badge b-${esc(k.status)}">${esc(k.status)}</span>
        <div style="display:flex;gap:6px"><button class="btn btn-ok btn-sm" data-action="kycDecide" data-arg="${k.id}|approve">✓ Aprobar</button>
          <button class="btn btn-danger btn-sm" data-action="kycDecide" data-arg="${k.id}|reject">✗ Rechazar</button></div>
      </div>`).join('') || '<div class="empty">Cola de KYC vacía ✓</div>';
      c.innerHTML = `<div class="panel"><div class="panel-h">Verificaciones pendientes</div>${rows}</div>`;
    } catch (e) { c.innerHTML = `<div class="empty">Error (${esc(e.message)}).</div>`; }
  };
  async function kycDecide(arg) {
    const [id, decision] = arg.split('|'); const notes = decision === 'reject' ? (prompt('Motivo del rechazo:') || '') : '';
    try { await api('/admin/kyc/' + id + '/decision', { method: 'POST', body: { decision, notes } }); toast(decision === 'approve' ? 'KYC aprobado ✓' : 'KYC rechazado'); RENDER.kyc(); }
    catch { toast('Error'); }
  }

  /* ---------- Reportes ---------- */
  RENDER.reportes = async function () {
    const c = $('content'); c.innerHTML = spin();
    try {
      const { items } = await api('/admin/reports' + qs({ status: 'open' }));
      const rows = (items || []).map((r) => `<div class="row" style="flex-direction:column;align-items:flex-start;gap:8px">
        <div><b>${esc(r.reason)}</b><div class="muted" style="font-size:.8rem">${esc(r.details || '')} · ${dt(r.created_at)}</div></div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button class="btn btn-sm" data-action="resolveReport" data-arg="${r.id}|warn">Advertir</button>
          <button class="btn btn-warn btn-sm" data-action="resolveReport" data-arg="${r.id}|suspend">Suspender</button>
          <button class="btn btn-danger btn-sm" data-action="resolveReport" data-arg="${r.id}|ban">Banear</button>
          <button class="btn btn-sm" data-action="resolveReport" data-arg="${r.id}|dismiss">Descartar</button>
        </div></div>`).join('') || '<div class="empty">Sin reportes abiertos ✓</div>';
      c.innerHTML = `<div class="panel"><div class="panel-h">Reportes abiertos</div>${rows}</div>`;
    } catch (e) { c.innerHTML = `<div class="empty">Error (${esc(e.message)}).</div>`; }
  };
  async function resolveReport(arg) {
    const [id, action] = arg.split('|'); const resolution = action === 'dismiss' ? 'Descartado por admin' : (prompt('Resolución:') || action);
    try { await api('/admin/reports/' + id + '/resolve', { method: 'POST', body: { resolution, action: action === 'dismiss' ? null : action } }); toast('Reporte resuelto ✓'); RENDER.reportes(); }
    catch { toast('Error'); }
  }

  /* ---------- Moderación de conversaciones ---------- */
  RENDER.moderacion = function () {
    const c = $('content');
    c.innerHTML = `<div class="panel"><div class="panel-h">Moderación de conversaciones (auditado)</div><div class="panel-b">
      <p class="muted" style="font-size:.83rem">La lectura de mensajes queda registrada en auditoría con el motivo. Busca un usuario y abre una conversación con un motivo justificado.</p>
      <div class="toolbar"><input class="field search" id="modUq" type="search" placeholder="Buscar usuario…" style="margin:0" /></div>
      <div id="modUsers"></div></div></div>
      <div class="panel hidden" id="modConvPanel"><div class="panel-h">Conversaciones</div><div id="modConvs"></div></div>
      <div class="panel hidden" id="modMsgPanel"><div class="panel-h">Mensajes</div><div class="panel-b" id="modMsgs"></div></div>`;
    const uq = $('modUq'); let t;
    uq.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => modSearchUsers(uq.value.trim()), 300); });
  };
  async function modSearchUsers(q) {
    const el = $('modUsers'); if (!el || !q) { if (el) el.innerHTML = ''; return; }
    try {
      const { items } = await api('/admin/users' + qs({ q, limit: 15 }));
      el.innerHTML = (items || []).map((u) => `<div class="row link" data-action="modUserConvs" data-arg="${u.id}|${encodeURIComponent(u.display_name || u.email || '')}">
        <div class="av">${letter(u.display_name || u.email)}</div><div style="flex:1"><b>${esc(u.display_name || u.email)}</b><div class="muted" style="font-size:.8rem">${esc(u.role)} · ${esc(u.email || '')}</div></div></div>`).join('') || '<div class="empty">Sin resultados.</div>';
    } catch { el.innerHTML = '<div class="empty">Error.</div>'; }
  }
  async function modUserConvs(arg) {
    const [id, nameEnc] = arg.split('|'); $('modConvPanel').classList.remove('hidden'); $('modConvs').innerHTML = spin();
    $('modMsgPanel').classList.add('hidden');
    try {
      const { items } = await api('/admin/users/' + id + '/conversations');
      $('modConvs').innerHTML = (items || []).map((cv) => `<div class="row link" data-action="modReadConv" data-arg="${cv.id}">
        <div style="flex:1"><b>${esc(decodeURIComponent(nameEnc))} ↔ ${esc(cv.other_name || cv.otherName || 'usuario')}</b>
        <div class="muted" style="font-size:.8rem">${cv.message_count ?? ''} mensajes · ${dt(cv.updated_at || cv.last_at)}</div></div></div>`).join('') || '<div class="empty">Sin conversaciones.</div>';
    } catch (e) { $('modConvs').innerHTML = `<div class="empty">Error (${esc(e.message)}).</div>`; }
  }
  async function modReadConv(id) {
    const reason = prompt('Motivo de la lectura (obligatorio, queda auditado):');
    if (!reason) { toast('Motivo requerido'); return; }
    $('modMsgPanel').classList.remove('hidden'); $('modMsgs').innerHTML = spin();
    try {
      const { items } = await api('/admin/conversations/' + id + '/messages' + qs({ reason }));
      $('modMsgs').innerHTML = (items || []).map((m) => `<div style="padding:6px 0;border-bottom:1px solid var(--border)">
        <b style="font-size:.8rem">${esc(String(m.sender_id || m.senderId || '').slice(0, 8))}</b>
        <span class="muted" style="font-size:.72rem"> · ${dt(m.created_at || m.createdAt)}</span>
        <div>${esc(m.body || m.message || '')}</div></div>`).join('') || '<div class="empty">Sin mensajes.</div>';
      toast('Lectura registrada en auditoría');
    } catch (e) { $('modMsgs').innerHTML = `<div class="empty">Error (${esc(e.message)}).</div>`; }
  }

  /* ---------- Configuración ---------- */
  RENDER.config = async function () {
    const c = $('content'); c.innerHTML = spin();
    try {
      const [flags, settings] = await Promise.all([api('/admin/flags'), api('/admin/settings')]);
      const fl = (flags.items || []).map((f) => `<div class="srow"><div><div class="sk">${esc(f.key)}</div><div class="sv">Rollout: ${f.rollout_pct ?? 100}%</div></div>
        <button class="toggle ${f.enabled ? 'on' : ''}" data-action="toggleFlag" data-arg="${f.key}|${f.enabled}"></button></div>`).join('') || '<div class="empty">Sin flags.</div>';
      const st = (settings.items || []).map((s) => `<div class="srow"><div><div class="sk">${esc(s.key)}</div><div class="sv">${esc(s.description || '')}</div></div>
        <span class="sv">${esc(JSON.stringify(s.value))}</span></div>`).join('') || '<div class="empty">Sin configuración.</div>';
      c.innerHTML = `<div class="panel"><div class="panel-h">Feature flags</div>${fl}</div>
        <div class="panel"><div class="panel-h">Configuración del sistema</div>${st}</div>`;
    } catch (e) { c.innerHTML = `<div class="empty">Error (${esc(e.message)}).</div>`; }
  };
  async function toggleFlag(arg) {
    const [key, cur] = arg.split('|'); const enabled = cur !== 'true';
    try { await api('/admin/flags/' + key, { method: 'PATCH', body: { enabled, rolloutPct: 100 } }); toast(`Flag ${key}: ${enabled ? 'ON' : 'OFF'}`); RENDER.config(); }
    catch { toast('Error'); }
  }

  /* ---------- Auditoría ---------- */
  RENDER.auditoria = async function () {
    const c = $('content'); c.innerHTML = spin();
    try {
      const { items } = await api('/admin/audit' + qs({ limit: 60 }));
      const rows = (items || []).map((a) => `<tr><td><b>${esc(a.action)}</b></td><td>${esc(a.actor_name || 'sistema')}</td>
        <td class="muted">${esc(a.entity || '')} ${esc(a.ip || '')}</td><td class="muted">${dt(a.created_at)}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">Sin registros.</td></tr>';
      c.innerHTML = `<div class="panel"><div class="panel-h">Registro de auditoría</div><table><thead><tr><th>Acción</th><th>Actor</th><th>Detalle</th><th>Fecha</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    } catch (e) { c.innerHTML = `<div class="empty">Error (${esc(e.message)}).</div>`; }
  };

  /* ---------- Acciones + arranque ---------- */
  const ACT = {
    go: (a) => navigate(a),
    approvePayout: (a) => approvePayout(a),
    openUser: (a) => openUser(a), setStatus: (a) => setStatus(a), setRole: (a) => setRole(a), notifyUser: (a) => notifyUser(a),
    kycDecide: (a) => kycDecide(a), resolveReport: (a) => resolveReport(a), toggleFlag: (a) => toggleFlag(a),
    modUserConvs: (a) => modUserConvs(a), modReadConv: (a) => modReadConv(a),
  };
  document.addEventListener('click', (e) => {
    const nav = e.target.closest('[data-nav]'); if (nav) { navigate(nav.dataset.nav); return; }
    const el = e.target.closest('[data-action]'); if (el) { const fn = ACT[el.dataset.action]; if (fn) fn(el.dataset.arg, el); }
  });
  $('loginForm').addEventListener('submit', doLogin);
  $('logoutBtn').addEventListener('click', logout);

  (async function boot() {
    if (tok.get()) { try { const me = await api('/users/me'); if (['admin', 'moderator'].includes(me.role)) { state.me = me; enterApp(); return; } } catch {} tok.set(null); }
  })();
})();
