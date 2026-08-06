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
  const TITLES = { dashboard: 'Dashboard', ingresos: 'Ingresos y distribución', socios: 'Socios', finanzas: 'Finanzas', envivo: 'En vivo (monitoreo)', usuarios: 'Usuarios', kyc: 'Verificaciones KYC', reportes: 'Reportes', moderacion: 'Moderación de conversaciones', sistema: 'Sistema (monitoreo técnico)', config: 'Configuración', auditoria: 'Auditoría' };
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
      const { items } = await api('/admin/payouts' + qs({ status: 'requested' }));
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
      const [u, subs, pays] = await Promise.all([
        api('/admin/users/' + id),
        api('/admin/users/' + id + '/subscriptions').catch(() => ({ asSubscriber: [], asModel: [] })),
        api('/admin/users/' + id + '/payments').catch(() => ({ items: [] })),
      ]);
      state.activeUser = u;
      const roleOpts = ['user', 'model', 'moderator', 'admin', 'partner'].map((r) => `<option value="${r}" ${u.role === r ? 'selected' : ''}>${r}</option>`).join('');
      const deleted = u.deleted_at ? '<span class="pill bad">CUENTA ELIMINADA</span>' : '';
      const subsFan = (subs.asSubscriber || []).map((s) => `<tr><td>${esc(s.model_name || '—')}</td><td><span class="badge">${esc(s.status)}</span></td><td>${cop(s.price_cop)}</td><td class="muted">${dt(s.current_period_end)}</td><td>${s.status === 'active' ? `<button class="btn btn-danger btn-sm" data-action="cancelSub" data-arg="${s.id}|${u.id}">Cancelar</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">No está suscrito a ninguna creadora.</td></tr>';
      const subsModel = (subs.asModel || []).map((s) => `<tr><td>${esc(s.subscriber_name || '—')}</td><td><span class="badge">${esc(s.status)}</span></td><td>${cop(s.price_cop)}</td><td class="muted">${dt(s.current_period_end)}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">No tiene suscriptores.</td></tr>';
      const payRows = (pays.items || []).map((p) => `<tr><td>${esc(p.purpose)}</td><td>${cop(p.amount_cop)}</td><td class="muted">${esc(p.method || '')}</td><td><span class="badge">${esc(p.status)}</span></td><td class="muted">${dt(p.created_at)}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">Sin pagos registrados.</td></tr>';
      const isModel = u.role === 'model';
      c.innerHTML = `<button class="btn btn-sm" data-action="go" data-arg="usuarios">← Usuarios</button>
        <div class="panel" style="margin-top:14px"><div class="panel-h"><span>${esc(u.display_name || u.email)} ${deleted}</span><span class="badge b-${esc(u.status)}">${esc(u.status)}</span></div>
          <div class="panel-b">
            <div class="row" style="border:none;padding:0 0 12px"><div class="av">${letter(u.display_name || u.email)}</div>
              <div><div><b>${esc(u.display_name || '—')}</b></div><div class="muted">${esc(u.email || u.phone || '')} · rol <b>${esc(u.role)}</b> · id ${esc(String(u.id).slice(0, 8))} · registro ${dt(u.created_at)}</div></div></div>
            <div class="toolbar">
              <select class="field" id="roleSel" style="width:auto;margin:0">${roleOpts}</select>
              <button class="btn btn-sm" data-action="setRole" data-arg="${u.id}">Cambiar rol</button>
              <button class="btn btn-ok btn-sm" data-action="setStatus" data-arg="${u.id}|active">Activar</button>
              <button class="btn btn-warn btn-sm" data-action="setStatus" data-arg="${u.id}|suspended">Suspender</button>
              <button class="btn btn-danger btn-sm" data-action="setStatus" data-arg="${u.id}|banned">Banear</button>
            </div>
            <div class="toolbar" style="margin-top:8px"><input class="field" id="notifMsg" placeholder="Enviar notificación al usuario…" style="flex:1;margin:0" /><button class="btn btn-sm" data-action="notifyUser" data-arg="${u.id}">Enviar</button></div>
          </div></div>

        <div class="panel"><div class="panel-h">Billetera</div><div class="panel-b">
          <div class="kpi-grid" style="margin-bottom:14px">
            <div class="kpi"><div class="v">${num(u.diamonds || 0)} 💎</div><div class="l">Saldo (diamantes)</div></div>
            <div class="kpi"><div class="v">${cop(u.earnings_cop)}</div><div class="l">Ganancias (COP)</div></div>
            <div class="kpi"><div class="v">${cop(u.total_paid_cop)}</div><div class="l">Total pagado</div></div>
          </div>
          <div class="muted" style="font-size:.78rem;margin-bottom:6px">Ajuste manual (usa negativos para descontar). Queda auditado.</div>
          <div class="form-row">
            <input class="field" id="wDia" type="number" placeholder="Δ diamantes (ej. 100 o -50)" />
            <input class="field" id="wEarn" type="number" placeholder="Δ ganancias COP (ej. 5000 o -1000)" />
          </div>
          <div class="form-row"><input class="field" id="wMemo" placeholder="Motivo del ajuste (PQRS/reclamación)" /></div>
          <button class="btn btn-primary btn-sm" data-action="adjustWallet" data-arg="${u.id}">Aplicar ajuste</button>
        </div></div>

        <div class="panel"><div class="panel-h">Suscripciones (como fan)</div>
          <table><thead><tr><th>Creadora</th><th>Estado</th><th>Precio</th><th>Vence</th><th></th></tr></thead><tbody>${subsFan}</tbody></table></div>

        ${isModel ? `<div class="panel"><div class="panel-h">Suscriptores (${num(u.active_subscribers || 0)} activos)</div>
          <table><thead><tr><th>Fan</th><th>Estado</th><th>Precio</th><th>Vence</th></tr></thead><tbody>${subsModel}</tbody></table></div>` : ''}

        <div class="panel"><div class="panel-h">Historial de pagos</div>
          <table><thead><tr><th>Concepto</th><th>Monto</th><th>Método</th><th>Estado</th><th>Fecha</th></tr></thead><tbody>${payRows}</tbody></table></div>

        <div class="panel" style="border-color:var(--danger)"><div class="panel-h" style="color:var(--danger)">Zona peligrosa</div><div class="panel-b">
          <div class="muted" style="font-size:.82rem;margin-bottom:10px">Eliminar la cuenta anonimiza sus datos personales (Habeas Data), la desactiva y cancela sus suscripciones. Los registros financieros se conservan para contabilidad. Acción auditada.</div>
          <button class="btn btn-danger btn-sm" data-action="deleteUser" data-arg="${u.id}" ${u.deleted_at ? 'disabled' : ''}>🗑 Eliminar cuenta</button>
        </div></div>`;
    } catch (e) { c.innerHTML = `<div class="empty">Error (${esc(e.message)}).</div>`; }
  }
  async function adjustWallet(id) {
    const d = Number($('wDia') && $('wDia').value) || 0;
    const e = Number($('wEarn') && $('wEarn').value) || 0;
    const memo = ($('wMemo') && $('wMemo').value.trim()) || '';
    if (!d && !e) { toast('Indica un ajuste de 💎 o de ganancias'); return; }
    if (!confirm(`¿Aplicar ajuste?  Δ💎 ${d} · Δ COP ${e}`)) return;
    try { const r = await api('/admin/users/' + id + '/wallet', { method: 'POST', body: { diamondsDelta: d, earningsDelta: e, memo } }); toast('Billetera actualizada ✓'); openUser(id); }
    catch (err) { toast(err.data?.error === 'would_go_negative' ? 'El saldo no puede quedar negativo' : 'Error'); }
  }
  async function cancelSub(arg) {
    const [subId, userId] = arg.split('|');
    if (!confirm('¿Cancelar esta suscripción?')) return;
    try { await api('/admin/subscriptions/' + subId + '/cancel', { method: 'POST', body: {} }); toast('Suscripción cancelada ✓'); openUser(userId); }
    catch { toast('Error'); }
  }
  async function deleteUser(id) {
    if (!confirm('¿ELIMINAR esta cuenta? Se anonimizan sus datos y se desactiva. Esta acción no se revierte fácilmente.')) return;
    if (!confirm('Confirma una vez más: se eliminará (anonimizará) la cuenta.')) return;
    try { await api('/admin/users/' + id, { method: 'DELETE' }); toast('Cuenta eliminada ✓'); navigate('usuarios'); }
    catch (e) { toast(e.data?.error === 'cannot_delete_admin' ? 'No se puede eliminar un admin' : 'Error'); }
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

  /* ---------- Ingresos y distribución ---------- */
  RENDER.ingresos = async function () {
    const c = $('content'); c.innerHTML = spin();
    try {
      const r = await api('/admin/revenue'); const t = r.totals || {};
      c.innerHTML = `
      <div class="kpi-grid">
        <div class="kpi"><div class="v">${cop(t.gross)}</div><div class="l">Bruto total</div></div>
        <div class="kpi"><div class="v">${cop(t.model)}</div><div class="l">A modelos</div></div>
        <div class="kpi"><div class="v">${cop(t.platform)}</div><div class="l">Plataforma</div></div>
        <div class="kpi"><div class="v">${cop(r.adminAccumulatedCop)}</div><div class="l">Tu ingreso (admin)</div></div>
        <div class="kpi"><div class="v">${cop(t.partners)}</div><div class="l">A socios</div></div>
        <div class="kpi"><div class="v">${num(t.n)}</div><div class="l">Transacciones</div></div>
      </div>
      <div class="panel"><div class="panel-h">Saldos de socios (por consignar)</div>
        <table><thead><tr><th>Socio</th><th>Saldo</th><th>Ganado (total)</th><th>Peso</th></tr></thead><tbody>
        ${(r.partners || []).map((p) => `<tr><td>${esc(p.name)} ${p.is_active ? '' : '<span class="muted">(inactivo)</span>'}</td><td><b>${cop(p.balance_cop)}</b></td><td class="muted">${cop(p.total_earned_cop)}</td><td class="muted">${p.share_bps}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">Sin socios.</td></tr>'}
        </tbody></table></div>
      <div class="panel"><div class="panel-h">Por fuente</div>
        ${(r.bySource || []).map((s) => `<div class="srow"><div class="sk">${esc(s.source)}</div><span class="sv">${cop(s.gross)} bruto · plataforma ${cop(s.platform)} · ${num(s.n)} tx</span></div>`).join('') || '<div class="empty">Sin ingresos aún.</div>'}
      </div>
      <div class="panel"><div class="panel-h">Últimos movimientos</div>
        <table><thead><tr><th>Fuente</th><th>Bruto</th><th>Modelo</th><th>Admin</th><th>Socios</th><th>Fecha</th></tr></thead><tbody>
        ${(r.recent || []).map((e) => `<tr><td>${esc(e.source)}</td><td>${cop(e.gross_cop)}</td><td>${cop(e.model_cop)}</td><td>${cop(e.admin_cop)}</td><td>${cop(e.partners_cop)}</td><td class="muted">${dt(e.created_at)}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">Sin movimientos.</td></tr>'}
        </tbody></table></div>`;
    } catch (e) { c.innerHTML = `<div class="empty">Error (${esc(e.message)}).</div>`; }
  };

  /* ---------- Socios ---------- */
  RENDER.socios = async function () {
    const c = $('content'); c.innerHTML = spin();
    try {
      const { items } = await api('/admin/partners');
      const rows = (items || []).map((p) => `<tr>
        <td><b>${esc(p.name)}</b>${p.email ? `<div class="muted" style="font-size:.72rem">${esc(p.email)}</div>` : ''}</td>
        <td>${p.share_bps} <span class="muted">(${(p.share_bps / 100).toFixed(2)}%)</span></td>
        <td><b>${cop(p.balance_cop)}</b></td><td class="muted">${cop(p.total_earned_cop)}</td>
        <td>${p.is_active ? '<span class="pill ok">Activo</span>' : '<span class="pill bad">Inactivo</span>'}</td>
        <td style="display:flex;gap:6px;flex-wrap:wrap">
          <button class="btn btn-sm" data-action="editPartner" data-arg="${p.id}">Editar</button>
          <button class="btn btn-sm" data-action="partnerAccess" data-arg="${p.id}|${p.email || ''}">${p.has_access ? '🔑 Cambiar acceso' : '🔑 Dar acceso'}</button>
          <button class="btn btn-sm" data-action="settlePartner" data-arg="${p.id}|${p.balance_cop}">Consignar</button>
          <button class="btn btn-sm" data-action="togglePartner" data-arg="${p.id}|${p.is_active}">${p.is_active ? 'Desactivar' : 'Activar'}</button>
        </td></tr>`).join('') || '<tr><td colspan="6" class="empty">Sin socios registrados.</td></tr>';
      c.innerHTML = `
      <div class="panel"><div class="panel-h">Registrar socio</div>
        <div class="panel-b">
          <div class="form-row"><input class="field" id="pName" placeholder="Nombre" /><input class="field" id="pEmail" placeholder="Correo (opcional)" /></div>
          <div class="form-row"><input class="field" id="pDoc" placeholder="Documento (opcional)" /><input class="field" id="pShare" type="number" placeholder="Peso de participación (ej. 5000)" /></div>
          <div class="form-row"><input class="field" id="pPass" type="password" placeholder="Contraseña de acceso al portal /socio (opcional, mín. 8)" /></div>
          <div class="muted" style="font-size:.78rem;margin:4px 0 12px">El "peso" define cómo se reparte entre socios el pool que queda tras tu comisión de administrador (ej.: 6000 y 4000 → 60% y 40%). Si pones <b>correo + contraseña</b>, el socio podrá entrar a <b>camstudio.tech/socio/</b>.</div>
          <button class="btn btn-primary" data-action="savePartner">Registrar socio</button>
        </div>
      </div>
      <div class="panel"><div class="panel-h">Socios</div>
        <table><thead><tr><th>Socio</th><th>Peso</th><th>Saldo</th><th>Ganado</th><th>Estado</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
    } catch (e) { c.innerHTML = `<div class="empty">Error (${esc(e.message)}).</div>`; }
  };
  async function savePartner() {
    const name = $('pName').value.trim(); if (!name) { toast('El nombre es requerido'); return; }
    const pass = $('pPass').value;
    const body = { name, email: $('pEmail').value.trim(), document: $('pDoc').value.trim(), shareBps: Number($('pShare').value) || 0 };
    if (pass) { if (pass.length < 8) { toast('La contraseña debe tener al menos 8 caracteres'); return; } body.password = pass; }
    try { await api('/admin/partners', { method: 'POST', body }); toast('Socio registrado ✓'); RENDER.socios(); }
    catch (e) { toast(e.data?.error === 'email_in_use' ? 'Ese correo ya está en uso' : 'Error: ' + e.message); }
  }
  async function partnerAccess(arg) {
    const [id, curEmail] = arg.split('|');
    const email = prompt('Correo de acceso del socio:', curEmail || ''); if (!email) return;
    const password = prompt('Contraseña (mín. 8 caracteres):'); if (!password) return;
    if (password.length < 8) { toast('La contraseña debe tener al menos 8 caracteres'); return; }
    try { await api('/admin/partners/' + id + '/access', { method: 'POST', body: { email, password } }); toast('Acceso configurado ✓ (portal /socio/)'); RENDER.socios(); }
    catch (e) { toast(e.data?.error === 'email_in_use' ? 'Ese correo ya está en uso' : 'Error'); }
  }
  async function editPartner(id) {
    const name = prompt('Nombre del socio (dejar vacío para no cambiar):');
    const share = prompt('Peso de participación (bps, ej. 5000; vacío = no cambiar):');
    const body = {}; if (name) body.name = name; if (share !== null && share !== '') body.shareBps = Number(share) || 0;
    if (!Object.keys(body).length) return;
    try { await api('/admin/partners/' + id, { method: 'PATCH', body }); toast('Actualizado ✓'); RENDER.socios(); } catch { toast('Error'); }
  }
  async function settlePartner(arg) {
    const [id, bal] = arg.split('|'); if (Number(bal) <= 0) { toast('Sin saldo por consignar'); return; }
    if (!confirm(`¿Registrar la consignación de ${cop(bal)} a este socio y poner su saldo en 0?`)) return;
    try { const r = await api('/admin/partners/' + id + '/settle', { method: 'POST', body: {} }); toast('Consignado ' + cop(r.settledCop) + ' ✓'); RENDER.socios(); } catch { toast('Error'); }
  }
  async function togglePartner(arg) {
    const [id, active] = arg.split('|');
    try { await api('/admin/partners/' + id, { method: 'PATCH', body: { isActive: active !== 'true' } }); toast('Actualizado ✓'); RENDER.socios(); } catch { toast('Error'); }
  }

  /* ---------- En vivo (monitoreo + ingreso invisible) ---------- */
  let lkLoading = null;
  function ensureLivekit() {
    if (window.LivekitClient) return Promise.resolve();
    if (lkLoading) return lkLoading;
    lkLoading = new Promise((resolve, reject) => { const s = document.createElement('script'); s.src = '/estudio/livekit-client.umd.min.js?v=1'; s.onload = resolve; s.onerror = reject; document.head.appendChild(s); });
    return lkLoading;
  }
  RENDER.envivo = async function () {
    const c = $('content'); c.innerHTML = spin();
    try {
      const [rooms, flags] = await Promise.all([api('/admin/live/rooms'), api('/admin/flags')]);
      const ghostOn = (flags.items || []).some((f) => f.key === 'admin_ghost_join' && f.enabled);
      const liveR = (rooms.live || []).map((r) => `<tr><td>${esc(r.display_name || r.handle || '')} <span class="muted">@${esc(r.handle || '')}</span></td><td class="muted">Directo</td><td><button class="btn btn-sm" data-action="ghostJoin" data-arg="${r.room}" ${ghostOn ? '' : 'disabled'}>Entrar invisible</button></td></tr>`).join('');
      const privR = (rooms.private || []).map((r) => `<tr><td class="muted">${esc(String(r.model_id).slice(0, 8))} ⇄ ${esc(String(r.caller_id).slice(0, 8))}</td><td class="muted">Privado</td><td><button class="btn btn-sm" data-action="ghostJoin" data-arg="${r.room}" ${ghostOn ? '' : 'disabled'}>Entrar invisible</button></td></tr>`).join('');
      const rows = (liveR + privR) || '<tr><td colspan="3" class="empty">No hay salas activas ahora.</td></tr>';
      c.innerHTML = `
      <div class="panel"><div class="panel-h">Ingreso invisible — FASE DE PRUEBAS <button class="toggle ${ghostOn ? 'on' : ''}" data-action="toggleFlag" data-arg="admin_ghost_join|${ghostOn}"></button></div>
        <div class="panel-b"><div class="muted" style="font-size:.82rem">${ghostOn ? '✅ Activado: puedes entrar a cualquier sala de forma INVISIBLE (la modelo y el fan no te ven, no publicas cámara/audio, no interfieres). ⚠️ Apágalo antes de salir a producción.' : '⚠️ Apagado. Actívalo con el interruptor para poder entrar de forma invisible a las salas.'}</div></div>
      </div>
      <div class="panel"><div class="panel-h">Salas activas <button class="btn btn-sm" data-action="go" data-arg="envivo">↻ Refrescar</button></div>
        <table><thead><tr><th>Sala</th><th>Tipo</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
      <div id="ghostBox"></div>`;
    } catch (e) { c.innerHTML = `<div class="empty">Error (${esc(e.message)}).</div>`; }
  };
  async function ghostJoin(room) {
    try {
      const r = await api('/admin/live/ghost-token', { method: 'POST', body: { room } });
      $('ghostBox').innerHTML = `<div class="panel"><div class="panel-h">Conectado (invisible) · ${esc(room)}</div>
        <video id="ghostVideo" autoplay playsinline style="width:100%;max-height:60vh;background:#000;border-radius:10px"></video>
        <div class="muted" style="font-size:.78rem;margin-top:6px">Eres invisible para la modelo y el fan. Token válido 2h.</div></div>`;
      await ensureLivekit();
      const rm = new LivekitClient.Room({ adaptiveStream: true });
      rm.on(LivekitClient.RoomEvent.TrackSubscribed, (track) => { if (track.kind === 'video' || track.kind === 'audio') track.attach($('ghostVideo')); });
      await rm.connect(r.url, r.token);
      toast('Conectado invisible ✓');
    } catch (e) { toast(e.data?.error === 'ghost_join_disabled' ? 'Activa el ingreso invisible primero' : 'Error: ' + (e.message || '')); }
  }

  /* ---------- Sistema (monitoreo técnico) ---------- */
  RENDER.sistema = async function () {
    const c = $('content'); c.innerHTML = spin();
    try {
      const s = await api('/admin/system'); const badge = (ok) => `<span class="pill ${ok ? 'ok' : 'bad'}">${ok ? 'OK' : 'FALLA'}</span>`;
      c.innerHTML = `
      <div class="kpi-grid">
        <div class="kpi"><div class="v">${num(s.counts.users)}</div><div class="l">Usuarios</div></div>
        <div class="kpi"><div class="v">${num(s.counts.models)}</div><div class="l">Creadoras</div></div>
        <div class="kpi"><div class="v">${num(s.counts.liveNow)}</div><div class="l">En vivo ahora</div></div>
        <div class="kpi"><div class="v">${num(s.counts.activeCalls)}</div><div class="l">Llamadas activas</div></div>
        <div class="kpi"><div class="v">${num(s.counts.pendingKyc)}</div><div class="l">KYC pendientes</div></div>
        <div class="kpi"><div class="v">${num(s.counts.pendingPayouts)}</div><div class="l">Payouts pendientes</div></div>
      </div>
      <div class="panel"><div class="panel-h">Servicios</div>
        <div class="srow"><div class="sk">Base de datos</div><span class="sv">${badge(s.services.db.ok)} ${s.services.db.latencyMs ?? '—'}ms · ${esc(s.services.db.version || '')}</span></div>
        <div class="srow"><div class="sk">Redis</div><span class="sv">${badge(s.services.redis.ok)} ${s.services.redis.latencyMs ?? '—'}ms</span></div>
        <div class="srow"><div class="sk">LiveKit (video)</div><span class="sv">${badge(s.services.livekit.configured)} ${esc(s.services.livekit.url || '')}</span></div>
        <div class="srow"><div class="sk">Wompi (pagos)</div><span class="sv">${badge(s.services.wompi.configured)} ${s.services.wompi.configured ? '' : '(sin llaves reales)'}</span></div>
      </div>
      <div class="panel"><div class="panel-h">Proceso <button class="btn btn-sm" data-action="go" data-arg="sistema">↻ Refrescar</button></div>
        <div class="srow"><div class="sk">Uptime</div><span class="sv">${Math.floor(s.process.uptimeSec / 60)} min</span></div>
        <div class="srow"><div class="sk">Node / entorno</div><span class="sv">${esc(s.process.node)} · ${esc(s.process.env)}</span></div>
        <div class="srow"><div class="sk">Memoria (RSS)</div><span class="sv">${num(s.process.memRssMB)} MB</span></div>
        <div class="srow"><div class="sk">Hora del servidor</div><span class="sv">${dt(s.time)}</span></div>
      </div>`;
    } catch (e) { c.innerHTML = `<div class="empty">Error (${esc(e.message)}).</div>`; }
  };

  /* ---------- Configuración (editable) ---------- */
  const SETTING_LABELS = {
    model_revenue_share_bps: 'Ingreso para la modelo (bps · 7000 = 70%)',
    admin_share_bps: 'Comisión del administrador / sostenibilidad (bps · 500 = 5% del restante)',
    diamond_price_cop: 'Precio del diamante (COP)',
    min_payout_cop: 'Retiro mínimo (COP)',
    payout_fee_bps: 'Comisión de retiro (bps)',
    payout_fee_fixed_cop: 'Comisión fija por retiro (COP)',
    tax_withholding_bps: 'Retención de impuestos (bps)',
    signup_bonus_diamonds: 'Bono de bienvenida (💎)',
    min_call_price_diamonds: 'Precio mínimo de privado (💎/min)',
    max_call_price_diamonds: 'Precio máximo de privado (💎/min)',
    platform_name: 'Nombre del sitio',
    support_email: 'Correo de soporte',
  };
  const FLAG_LABELS = {
    admin_ghost_join: 'Ingreso invisible del administrador (solo pruebas)',
    maintenance_mode: 'Modo mantenimiento',
  };
  RENDER.config = async function () {
    const c = $('content'); c.innerHTML = spin();
    try {
      const [flags, settings] = await Promise.all([api('/admin/flags'), api('/admin/settings')]);
      const descByKey = {}; (settings.items || []).forEach((s) => { if (s.key.indexOf('flag_desc_') === 0) descByKey[s.key.slice(10)] = s.value; });
      const fl = (flags.items || []).map((f) => `<div class="srow"><div style="flex:1"><div class="sk">${esc(FLAG_LABELS[f.key] || f.key)}</div><div class="sv">${esc(descByKey[f.key] || '')}</div></div>
        <button class="toggle ${f.enabled ? 'on' : ''}" data-action="toggleFlag" data-arg="${f.key}|${f.enabled}"></button></div>`).join('') || '<div class="empty">Sin flags.</div>';
      const items = (settings.items || []).filter((s) => s.key.indexOf('flag_desc_') !== 0);
      const st = items.map((s) => {
        const isNum = typeof s.value === 'number';
        const v = isNum ? s.value : (typeof s.value === 'string' ? s.value : JSON.stringify(s.value));
        return `<div class="srow"><div style="flex:1"><div class="sk">${esc(SETTING_LABELS[s.key] || s.key)}</div><div class="sv">${esc(s.description || '')}</div></div>
          <div style="display:flex;gap:6px;align-items:center">
            <input class="field" style="width:160px;margin:0;padding:7px 10px" id="set_${esc(s.key)}" value="${esc(v)}" data-type="${isNum ? 'number' : 'string'}" ${isNum ? 'type="number"' : ''}/>
            <button class="btn btn-sm" data-action="saveSetting" data-arg="${esc(s.key)}">Guardar</button>
          </div></div>`;
      }).join('') || '<div class="empty">Sin configuración.</div>';
      c.innerHTML = `<div class="panel"><div class="panel-h">Parámetros del sistema</div>${st}</div>
        <div class="panel"><div class="panel-h">Feature flags</div>${fl}</div>`;
    } catch (e) { c.innerHTML = `<div class="empty">Error (${esc(e.message)}).</div>`; }
  };
  async function saveSetting(key) {
    const inp = $('set_' + key); if (!inp) return;
    let value = inp.value;
    if (inp.dataset.type === 'number') { value = Number(value); if (!Number.isFinite(value)) { toast('Valor numérico inválido'); return; } }
    try { await api('/admin/settings/' + encodeURIComponent(key), { method: 'PUT', body: { value } }); toast('Guardado ✓'); } catch { toast('Error'); }
  }
  async function toggleFlag(arg) {
    const [key, cur] = arg.split('|'); const enabled = cur !== 'true';
    try { await api('/admin/flags/' + key, { method: 'PATCH', body: { enabled, rolloutPct: 100 } }); toast(`Flag ${key}: ${enabled ? 'ON' : 'OFF'}`); navigate(document.querySelector('.nav-item.on')?.dataset.nav || 'config'); }
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
    adjustWallet: (a) => adjustWallet(a), cancelSub: (a) => cancelSub(a), deleteUser: (a) => deleteUser(a),
    kycDecide: (a) => kycDecide(a), resolveReport: (a) => resolveReport(a), toggleFlag: (a) => toggleFlag(a),
    modUserConvs: (a) => modUserConvs(a), modReadConv: (a) => modReadConv(a),
    savePartner: () => savePartner(), editPartner: (a) => editPartner(a), settlePartner: (a) => settlePartner(a), togglePartner: (a) => togglePartner(a), partnerAccess: (a) => partnerAccess(a),
    saveSetting: (a) => saveSetting(a), ghostJoin: (a) => ghostJoin(a),
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
