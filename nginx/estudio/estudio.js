/* ============================================================================
   Latido — Estudio de Creadora (consola web). Vanilla JS, delegación por
   data-action (CSP estricto). Token propio en localStorage 'latido_studio_token'.
   ============================================================================ */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const BASE = '/api';
  const TOKEN_KEY = 'latido_studio_token';
  const tok = {
    get() { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } },
    set(t) { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch {} },
  };
  const state = { me: null, album: null, blocked: [], uploadAlbumId: null, uploadVisibility: null, uploadShowcase: false };

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const cop = (n) => '$' + Number(n || 0).toLocaleString('es-CO');
  const dt = (s) => { try { return new Date(s).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' }); } catch { return ''; } };
  const spin = () => '<div class="empty">Cargando…</div>';
  function qs(p) {
    if (!p) return '';
    const s = Object.entries(p).filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&');
    return s ? '?' + s : '';
  }
  let toastT;
  function toast(msg) { const t = $('toast'); if (!t) return; t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2600); }

  async function api(path, { method = 'GET', body } = {}) {
    const headers = {};
    if (body) headers['Content-Type'] = 'application/json';
    const t = tok.get(); if (t) headers['Authorization'] = 'Bearer ' + t;
    const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    let data = {}; try { data = await res.json(); } catch {}
    if (!res.ok) { const e = new Error((data && data.error) || ('http_' + res.status)); e.status = res.status; e.data = data; throw e; }
    return data;
  }
  function uploadToMinio(url, file, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', url); xhr.setRequestHeader('Content-Type', file.type);
      if (onProgress) xhr.upload.onprogress = (e) => onProgress(e.loaded / e.total);
      xhr.onload = () => (xhr.status < 300 ? resolve() : reject(new Error('upload_failed_' + xhr.status)));
      xhr.onerror = () => reject(new Error('upload_network_error'));
      xhr.send(file);
    });
  }

  /* ---------- Login ---------- */
  async function doLogin(e) {
    e.preventDefault();
    const email = $('email').value.trim(), pass = $('pass').value, totp = $('totp').value.trim();
    $('loginErr').textContent = '';
    try {
      const body = { identifier: email, password: pass };
      if (totp) body.totpCode = totp;
      const r = await api('/auth/login', { method: 'POST', body });
      tok.set(r.accessToken);
      const me = await api('/users/me');
      if (!['model', 'admin'].includes(me.role)) { tok.set(null); $('loginErr').textContent = 'Esta cuenta no es de creadora.'; return; }
      state.me = me; enterApp();
    } catch (err) {
      if (err.data?.error === 'totp_required' || err.data?.error === 'totp_invalid') {
        $('totp').classList.remove('hidden'); $('totp').focus();
        $('loginErr').textContent = err.data.error === 'totp_invalid' ? 'Código 2FA inválido.' : 'Ingresa tu código 2FA.';
      } else { $('loginErr').textContent = 'Correo o contraseña incorrectos.'; }
    }
  }
  function logout() { tok.set(null); state.me = null; disconnectSocket(); $('app').classList.add('hidden'); $('login').classList.remove('hidden'); }

  function enterApp() {
    $('login').classList.add('hidden'); $('app').classList.remove('hidden');
    $('whoName').textContent = state.me.displayName || state.me.email;
    const av = $('whoAv');
    if (state.me.avatarUrl) { av.style.backgroundImage = `url('${state.me.avatarUrl}')`; av.textContent = ''; }
    else { av.style.backgroundImage = ''; av.textContent = (state.me.displayName || 'C').trim()[0].toUpperCase(); }
    connectSocket();
    navigate('panel');
  }

  /* ---------- Navegación ---------- */
  const TITLES = { panel: 'Panel', envivo: 'En Vivo', contenido: 'Contenido', finanzas: 'Finanzas', perfil: 'Perfil' };
  const RENDER = {};
  function navigate(view) {
    document.querySelectorAll('.nav-item').forEach((n) => n.classList.toggle('on', n.dataset.nav === view));
    $('pageTitle').textContent = TITLES[view] || 'Estudio';
    (RENDER[view] || (() => {}))();
  }

  /* ---------- Panel ---------- */
  RENDER.panel = async function () {
    const c = $('content'); c.innerHTML = spin();
    try {
      const [s, earn] = await Promise.all([api('/studio/stats').catch(() => ({})), api('/studio/earnings').catch(() => ({}))]);
      c.innerHTML = `
        <div class="kpi-grid">
          <div class="card kpi"><div class="v">${s.photos ?? 0}</div><div class="l">Fotos publicadas</div></div>
          <div class="card kpi"><div class="v">${s.videos ?? 0}</div><div class="l">Videos publicados</div></div>
          <div class="card kpi"><div class="v">${s.active_subs ?? 0}</div><div class="l">Suscriptores</div></div>
          <div class="card kpi"><div class="v">${cop(earn.balance ?? 0)}</div><div class="l">Balance</div></div>
        </div>
        <div class="panel"><div class="panel-h">Acciones rápidas</div><div class="panel-b toolbar">
          <button class="btn btn-grad" data-action="go" data-arg="envivo">🔴 Iniciar transmisión</button>
          <button class="btn" data-action="go" data-arg="contenido">🖼️ Subir contenido</button>
          <button class="btn" data-action="go" data-arg="finanzas">💰 Ver finanzas</button>
          <button class="btn" data-action="go" data-arg="perfil">👤 Editar perfil</button>
        </div></div>`;
    } catch { c.innerHTML = '<div class="empty">Error al cargar el panel.</div>'; }
  };

  /* ---------- En Vivo ---------- */
  let lkRoom = null;
  RENDER.envivo = async function () {
    const c = $('content'); c.innerHTML = `
      <div class="live-stage">
        <div>
          <div class="live-video">
            <video id="liveSelf" autoplay playsinline muted></video>
            <div class="live-badge hidden" id="liveBadge">● EN VIVO</div>
          </div>
          <div class="toolbar" style="margin-top:14px">
            <button class="btn btn-grad" data-action="goLiveToggle" id="goLiveBtn">🔴 Ponerme en vivo</button>
            <span class="muted" style="align-self:center">👁 <b id="viewerCount">0</b> espectadores</span>
          </div>
          <p class="muted" style="font-size:.82rem">Al ponerte en vivo, tus suscriptores podrán verte, chatear y enviarte regalos. Requiere identidad verificada (KYC).</p>
        </div>
        <div class="live-side">
          <div class="card" style="padding:14px"><div class="section-title">Regalos recibidos</div><div class="gift-feed" id="giftFeed"><div class="muted" style="font-size:.82rem">Aún sin regalos.</div></div></div>
          <div class="live-chat"><div class="panel-h">Chat en vivo</div><div class="body" id="liveChat"><div class="muted">El chat se activa al transmitir.</div></div>
            <div class="priv-chat-in" style="padding:10px"><input id="liveChatInput" placeholder="Responde a tu audiencia…" /><button class="btn btn-grad btn-sm" data-action="liveSendChat">➤</button></div>
          </div>
        </div>
      </div>`;
    updateGoLiveBtn(!!lkRoom);
  };
  function updateGoLiveBtn(live) {
    const b = $('goLiveBtn'); if (b) { b.textContent = live ? '⏹ Terminar transmisión' : '🔴 Ponerme en vivo'; b.classList.toggle('btn-danger', live); }
    const badge = $('liveBadge'); if (badge) badge.classList.toggle('hidden', !live);
    const pill = $('livePill'), txt = $('livePillTxt');
    if (pill) pill.classList.toggle('on', live); if (txt) txt.textContent = live ? 'En vivo' : 'Desconectada';
  }
  function updateViewerCount() { /* actualizado por evento socket live:viewers */ }
  // Sala LiveKit para PUBLICAR: simulcast + captura 540p + tope de bitrate.
  // Reduce el "entrecortado": permite enviar una capa más baja a espectadores
  // con red débil (adaptiveStream la elige) y limita el uplink de la creadora.
  function lkPubRoom() {
    const P = LivekitClient.VideoPresets;
    return new LivekitClient.Room({
      adaptiveStream: true, dynacast: true,
      videoCaptureDefaults: { resolution: P.h540.resolution },
      publishDefaults: { simulcast: true, videoSimulcastLayers: [P.h180, P.h360], videoEncoding: P.h540.encoding, dtx: true, red: true },
    });
  }

  async function goLiveToggle() {
    if (lkRoom) { await stopLive(); return; }
    if (!window.LivekitClient) { toast('El módulo de video no cargó'); return; }
    try {
      const { url, token } = await api('/live/broadcast', { method: 'POST' });
      lkRoom = lkPubRoom();
      lkRoom.on(LivekitClient.RoomEvent.ParticipantConnected, updateViewerCount);
      lkRoom.on(LivekitClient.RoomEvent.Disconnected, () => { lkRoom = null; updateGoLiveBtn(false); });
      await lkRoom.connect(url, token);
      await lkRoom.localParticipant.enableCameraAndMicrophone();
      const cam = [...lkRoom.localParticipant.videoTrackPublications.values()][0];
      if (cam && cam.track && $('liveSelf')) cam.track.attach($('liveSelf'));
      if (socket) socket.emit('live:join', { modelId: state.me.id });
      updateGoLiveBtn(true); toast('¡Estás en vivo! 🔴');
    } catch (e) {
      toast(e.data?.error === 'kyc_required' ? 'Debes verificar tu identidad (KYC) primero' : e.data?.error === 'live_not_configured' ? 'El servidor de video no está configurado' : 'No se pudo iniciar la transmisión');
    }
  }
  async function stopLive() {
    try { await api('/live/stop', { method: 'POST' }); } catch {}
    if (lkRoom) { try { lkRoom.disconnect(); } catch {} lkRoom = null; }
    updateGoLiveBtn(false); toast('Transmisión finalizada');
  }
  async function toggleLive() { navigate('envivo'); setTimeout(goLiveToggle, 250); }
  function liveSendChat() {
    const i = $('liveChatInput'); const t = i && i.value.trim(); if (!t || !socket) return;
    socket.emit('live:chat', { modelId: state.me.id, text: t });
    liveChatAppend('Tú', t, true); i.value = '';
  }
  function liveChatAppend(who, text, mine) {
    const box = $('liveChat'); if (!box) return; if (box.querySelector('.muted')) box.innerHTML = '';
    const d = document.createElement('div'); d.style.cssText = 'padding:4px 0';
    d.innerHTML = `<b style="color:${mine ? '#ff7ab0' : '#7ad0ff'}">${esc(who)}:</b> ${esc(text)}`;
    box.appendChild(d); box.scrollTop = box.scrollHeight;
  }

  /* ---------- Contenido ---------- */
  RENDER.contenido = async function () {
    const c = $('content'); c.innerHTML = spin();
    try {
      const { items: albums } = await api('/studio/albums');
      c.innerHTML = `
        <div class="panel">
          <div class="panel-h">Subir contenido
            <span style="display:flex;gap:8px;align-items:center">
              <select class="field" id="upAlbum" style="width:auto;margin:0"><option value="">Sin colección</option>${albums.map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join('')}</select>
              <button class="btn btn-grad btn-sm" data-action="pickFile">Elegir archivo</button>
            </span>
          </div>
          <div class="panel-b">
            <div class="upload" data-action="pickFile"><div class="ic">⬆️</div><b>Toca para subir foto o video</b><div class="muted">Se publica para tus suscriptores</div></div>
            <div class="progress hidden" id="upProg"><div class="bar" id="upBar"></div></div>
          </div>
        </div>
        <div class="panel">
          <div class="panel-h">Colecciones <button class="btn btn-sm" data-action="newAlbum">+ Nueva</button></div>
          <div id="albumList">${albums.length ? albums.map((a) => `
            <div class="album-row" data-action="openAlbum" data-arg="${a.id}|${encodeURIComponent(a.name)}|${a.is_public}">
              <div class="album-ico">🗂️</div>
              <div style="flex:1"><b>${esc(a.name)}</b><div class="muted" style="font-size:.8rem">${a.item_count} elementos · ${a.is_public ? '👁️ Visible' : '🔒 Oculta'}</div></div>
            </div>`).join('') : '<div class="empty">Aún no tienes colecciones.</div>'}</div>
        </div>
        <div class="panel"><div class="panel-h">Todo el contenido</div><div class="panel-b"><div class="media-grid" id="allMedia">${spin()}</div></div></div>`;
      loadMedia('allMedia', {});
    } catch { c.innerHTML = '<div class="empty">Error al cargar contenido.</div>'; }
  };
  async function loadMedia(elId, params) {
    const el = $(elId); if (!el) return;
    try {
      const { items } = await api('/studio/content' + qs({ limit: 50, ...params }));
      el.innerHTML = items.length ? items.map(mediaCard).join('') : '<div class="empty" style="grid-column:1/-1">Sin contenido.</div>';
    } catch { el.innerHTML = '<div class="empty" style="grid-column:1/-1">Error.</div>'; }
  }
  function mediaCard(m) {
    const pub = m.status === 'published';
    const thumb = m.media_type === 'video' && m.url ? `<video class="thumb" src="${m.url}" muted preload="metadata"></video>` : (m.url ? `<img class="thumb" src="${m.url}" alt="" />` : `<div class="thumb" style="display:flex;align-items:center;justify-content:center;font-size:1.6rem">${m.media_type === 'video' ? '🎬' : '🖼️'}</div>`);
    const isPublic = m.visibility === 'public';
    const visBtn = m.media_type === 'photo'
      ? `<button class="btn btn-sm" data-action="toggleVis" data-arg="${m.id}|${m.visibility}" title="${isPublic ? 'Quitar de la vitrina' : 'Poner en la vitrina (sin blur)'}">${isPublic ? '🌐' : '🔒'}</button>` : '';
    return `<div class="media-card">${thumb}<div class="row"><span class="pill ${pub ? 'pub' : 'draft'}">${isPublic ? '🌐 VITRINA' : (pub ? 'VISIBLE' : 'OCULTO')}</span>
      <span style="display:flex;gap:6px">${visBtn}<button class="btn btn-sm" data-action="toggleItem" data-arg="${m.id}|${pub ? 'draft' : 'published'}">${pub ? '🙈' : '👁️'}</button>
      <button class="btn btn-sm" data-action="delItem" data-arg="${m.id}">🗑</button></span></div></div>`;
  }
  async function toggleVis(arg) {
    const [id, vis] = arg.split('|'); const next = vis === 'public' ? 'subscribers' : 'public';
    try { await api('/studio/content/' + id, { method: 'PATCH', body: { visibility: next } });
      toast(next === 'public' ? 'En la vitrina 🌐 (sin blur)' : 'Solo suscriptores 🔒');
      state.album ? loadMedia('albMedia', { album: state.album.id }) : loadMedia('allMedia', {});
    } catch { toast('Error'); }
  }
  async function openAlbum(arg) {
    const [id, nameEnc, isPublic] = arg.split('|'); state.album = { id, name: decodeURIComponent(nameEnc), pub: isPublic === 'true' };
    $('content').innerHTML = `
      <button class="btn btn-sm" data-action="go" data-arg="contenido">← Colecciones</button>
      <div class="panel" style="margin-top:14px"><div class="panel-h">${esc(state.album.name)}
        <span style="display:flex;gap:8px"><button class="btn btn-sm" data-action="albumVis">${state.album.pub ? '👁️ Visible' : '🔒 Oculta'}</button><button class="btn btn-danger btn-sm" data-action="delAlbum">🗑 Eliminar</button></span></div>
        <div class="panel-b"><div class="upload" data-action="pickFileAlbum"><div class="ic">⬆️</div><b>Subir a esta colección</b></div>
        <div class="progress hidden" id="upProg"><div class="bar" id="upBar"></div></div></div></div>
      <div class="panel"><div class="panel-b"><div class="media-grid" id="albMedia">${spin()}</div></div></div>`;
    loadMedia('albMedia', { album: id });
  }
  async function albumVis() {
    try { await api('/studio/albums/' + state.album.id, { method: 'PATCH', body: { isPublic: !state.album.pub } }); state.album.pub = !state.album.pub; toast(state.album.pub ? 'Colección visible' : 'Colección oculta'); openAlbum(`${state.album.id}|${encodeURIComponent(state.album.name)}|${state.album.pub}`); } catch { toast('Error'); }
  }
  async function delAlbum() { if (!confirm('¿Eliminar la colección? El contenido no se borra.')) return; try { await api('/studio/albums/' + state.album.id, { method: 'DELETE' }); toast('Colección eliminada'); navigate('contenido'); } catch { toast('Error'); } }
  async function newAlbum() { const name = prompt('Nombre de la colección:'); if (!name) return; try { await api('/studio/albums', { method: 'POST', body: { name, isPublic: true } }); toast('Colección creada ✓'); navigate('contenido'); } catch { toast('Error'); } }
  async function toggleItem(arg) { const [id, status] = arg.split('|'); try { await api('/studio/content/' + id, { method: 'PATCH', body: { status } }); toast(status === 'published' ? 'Visible ✓' : 'Oculto ✓'); state.album ? loadMedia('albMedia', { album: state.album.id }) : loadMedia('allMedia', {}); } catch { toast('Error'); } }
  async function delItem(id) { if (!confirm('¿Eliminar este contenido?')) return; try { await api('/studio/content/' + id, { method: 'DELETE' }); toast('Eliminado'); if ($('showcaseGrid')) loadShowcase(); state.album ? loadMedia('albMedia', { album: state.album.id }) : loadMedia('allMedia', {}); } catch { toast('Error'); } }

  /* ---------- Subida ---------- */
  function pickFile() { state.uploadAlbumId = ($('upAlbum') && $('upAlbum').value) || null; state.uploadVisibility = null; state.uploadShowcase = false; $('fileInput').click(); }
  function pickFileAlbum() { state.uploadAlbumId = state.album ? state.album.id : null; state.uploadVisibility = null; state.uploadShowcase = false; $('fileInput').click(); }
  function pickShowcase() { state.uploadAlbumId = null; state.uploadVisibility = 'public'; state.uploadShowcase = true; $('fileInput').click(); }
  function captureVideoPoster(file) {
    return new Promise((resolve) => {
      try { const v = document.createElement('video'); v.preload = 'metadata'; v.muted = true; v.src = URL.createObjectURL(file);
        const done = (b) => { try { URL.revokeObjectURL(v.src); } catch {} resolve(b); };
        v.onloadeddata = () => { try { v.currentTime = Math.min(1, (v.duration || 2) / 2); } catch { done(null); } };
        v.onseeked = () => { try { const cv = document.createElement('canvas'); cv.width = v.videoWidth || 640; cv.height = v.videoHeight || 360; cv.getContext('2d').drawImage(v, 0, 0, cv.width, cv.height); cv.toBlob(done, 'image/jpeg', 0.8); } catch { done(null); } };
        v.onerror = () => done(null); setTimeout(() => done(null), 8000);
      } catch { resolve(null); }
    });
  }
  async function onFileChosen() {
    const f = $('fileInput'); if (!f.files[0]) return; const file = f.files[0];
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm', 'video/quicktime'];
    if (!allowed.includes(file.type)) { toast('Tipo no permitido'); f.value = ''; return; }
    const isVideo = file.type.startsWith('video');
    if (state.uploadVisibility === 'public' && isVideo) { toast('La vitrina solo admite fotos'); f.value = ''; state.uploadShowcase = false; state.uploadVisibility = null; return; }
    const maxMB = isVideo ? 500 : 20;
    if (file.size > maxMB * 1024 * 1024) { toast(`Máximo ${maxMB} MB`); f.value = ''; return; }
    const prog = $('upProg'), bar = $('upBar'); if (prog) prog.classList.remove('hidden');
    try {
      let posterBlob = null; if (isVideo) posterBlob = await captureVideoPoster(file);
      const up = await api('/studio/content/upload-url', { method: 'POST', body: { contentType: file.type } });
      await uploadToMinio(up.uploadUrl || up.url, file, (p) => { if (bar) bar.style.width = (p * 100).toFixed(0) + '%'; });
      const meta = { mediaType: isVideo ? 'video' : 'photo', originalKey: up.key };
      if (state.uploadAlbumId) meta.albumId = state.uploadAlbumId;
      if (state.uploadVisibility) meta.visibility = state.uploadVisibility;
      if (isVideo && posterBlob) { try { const pu = await api('/studio/content/upload-url', { method: 'POST', body: { contentType: 'image/jpeg' } }); await uploadToMinio(pu.uploadUrl || pu.url, posterBlob); meta.posterKey = pu.key; } catch {} }
      try { await api('/studio/content', { method: 'POST', body: meta }); }
      catch (pe) {
        if (pe.data?.error === 'content_consent_required') {
          if (confirm('Para publicar declaras ser la titular del contenido y que todas las personas que aparecen son mayores de 18 años (cumplimiento 2257 / Ley 1581). ¿Aceptas?')) { await api('/studio/content-consent', { method: 'POST', body: { accept: true } }); await api('/studio/content', { method: 'POST', body: meta }); }
          else throw new Error('consentimiento requerido');
        } else if (pe.data?.error === 'kyc_required') { throw new Error('Debes verificar tu identidad primero'); }
        else throw pe;
      }
      if (prog) prog.classList.add('hidden'); if (bar) bar.style.width = '0';
      const wasShowcase = state.uploadShowcase; state.uploadShowcase = false; state.uploadVisibility = null;
      toast(wasShowcase ? 'Foto añadida a la vitrina ✓' : 'Contenido publicado ✓');
      if (wasShowcase) navigate('perfil');
      else state.album ? loadMedia('albMedia', { album: state.album.id }) : navigate('contenido');
    } catch (e) { if (prog) prog.classList.add('hidden'); state.uploadShowcase = false; state.uploadVisibility = null; toast('Error al subir: ' + (e.message || e.data?.error || '')); }
    f.value = '';
  }

  /* ---------- Foto de perfil (avatar) ---------- */
  function pickAvatar() { $('avatarInput').click(); }
  async function onAvatarChosen() {
    const f = $('avatarInput'); if (!f.files[0]) return; const file = f.files[0];
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { toast('Usa JPG, PNG o WebP'); f.value = ''; return; }
    if (file.size > 5 * 1024 * 1024) { toast('Máximo 5 MB'); f.value = ''; return; }
    try {
      const up = await api('/users/me/avatar-upload-url' + qs({ contentType: file.type }));
      await uploadToMinio(up.url, file);
      const res = await api('/users/me/avatar', { method: 'PATCH', body: { avatarKey: up.key } });
      state.me.avatarUrl = res.avatarUrl;
      const prev = $('avatarPreview'); if (prev && res.avatarUrl) { prev.style.backgroundImage = `url('${res.avatarUrl}')`; prev.textContent = ''; }
      const av = $('whoAv'); if (av && res.avatarUrl) { av.style.backgroundImage = `url('${res.avatarUrl}')`; av.textContent = ''; }
      toast('Foto de perfil actualizada ✓');
    } catch { toast('Error al subir la foto'); }
    f.value = '';
  }

  /* ---------- Finanzas ---------- */
  RENDER.finanzas = async function () {
    const c = $('content'); c.innerHTML = spin();
    try {
      const [earn, wallet] = await Promise.all([api('/studio/earnings').catch(() => ({})), api('/payments/wallet').catch(() => ({ earningsCop: 0, ledger: [] }))]);
      const months = (earn.monthly || []).map((m) => `<tr><td>${new Date(m.month).toLocaleDateString('es-CO', { year: 'numeric', month: 'long' })}</td><td>${cop(m.subs)}</td><td>${cop(m.ppv)}</td><td>${cop(m.gifts)}</td><td><b>${cop(m.total)}</b></td></tr>`).join('') || '<tr><td colspan="5" class="empty">Sin ingresos aún.</td></tr>';
      const ledger = (wallet.ledger || []).map((l) => `<tr><td>${esc(l.kind)}</td><td>${l.cop_delta ? cop(l.cop_delta) : (l.diamonds_delta + ' 💎')}</td><td class="muted">${esc(l.memo || '')}</td><td>${dt(l.created_at)}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">Sin movimientos.</td></tr>';
      c.innerHTML = `
        <div class="kpi-grid">
          <div class="card kpi"><div class="v">${cop(earn.balance || wallet.earningsCop || 0)}</div><div class="l">Balance disponible</div></div>
          <div class="card kpi"><div class="v">${cop((earn.monthly && earn.monthly[0] && earn.monthly[0].total) || 0)}</div><div class="l">Este mes</div></div>
        </div>
        <div class="panel"><div class="panel-h">Ingresos por mes</div><table><thead><tr><th>Mes</th><th>Suscripciones</th><th>PPV</th><th>Regalos</th><th>Total</th></tr></thead><tbody>${months}</tbody></table></div>
        <div class="panel"><div class="panel-h">Movimientos recientes</div><table><thead><tr><th>Tipo</th><th>Monto</th><th>Detalle</th><th>Fecha</th></tr></thead><tbody>${ledger}</tbody></table></div>
        <p class="muted" style="font-size:.82rem">El retiro de fondos (payouts) se habilita con la pasarela de pagos configurada.</p>`;
    } catch { c.innerHTML = '<div class="empty">Error al cargar finanzas.</div>'; }
  };

  /* ---------- Perfil ---------- */
  RENDER.perfil = async function () {
    const c = $('content'); c.innerHTML = spin();
    try {
      const me = await api('/users/me'); state.me = me;
      const settings = await api('/models/me/settings').catch(() => ({ blockedCountries: [], callPriceDiamonds: 0, monthlyPriceCop: 24900, acceptsCalls: true, headline: '' }));
      state.blocked = (settings.blockedCountries || []).slice();
      c.innerHTML = `
        <div class="panel"><div class="panel-h">Foto de perfil</div><div class="panel-b" style="display:flex;align-items:center;gap:16px">
          <div id="avatarPreview" class="avatar-lg" style="${me.avatarUrl ? `background-image:url('${me.avatarUrl}')` : ''}">${me.avatarUrl ? '' : esc((me.displayName || 'C')[0].toUpperCase())}</div>
          <div><button class="btn btn-grad btn-sm" data-action="pickAvatar">Cambiar foto</button>
            <div class="muted" style="font-size:.8rem;margin-top:6px">Se muestra en "Descubre creadoras" y "En vivo". JPG/PNG/WebP, máx 5 MB.</div></div>
        </div></div>
        <div class="panel"><div class="panel-h">Perfil público</div><div class="panel-b">
          <div class="detail-grid">
            <span class="lbl">Nombre visible</span><input class="field" id="pName" value="${esc(me.displayName || '')}" style="margin:0" />
            <span class="lbl">Ciudad</span><input class="field" id="pCity" value="${esc(me.city || '')}" style="margin:0" />
            <span class="lbl">Bio</span><textarea class="field" id="pBio" style="margin:0">${esc(me.bio || '')}</textarea>
          </div>
          <button class="btn btn-grad" style="margin-top:14px" data-action="saveProfile">Guardar perfil</button>
        </div></div>
        <div class="panel"><div class="panel-h">Configuración de creadora</div><div class="panel-b">
          <div class="detail-grid">
            <span class="lbl">Titular (headline)</span><input class="field" id="pHead" value="${esc(settings.headline || '')}" placeholder="Una frase que te describa" style="margin:0" />
            <span class="lbl">Precio suscripción/mes (COP)</span><input class="field" id="pPrice" type="number" min="0" value="${settings.monthlyPriceCop || ''}" placeholder="24900" style="margin:0" />
            <span class="lbl">Acepta privados</span><label style="display:flex;align-items:center;gap:8px"><input type="checkbox" id="pCalls" ${settings.acceptsCalls ? 'checked' : ''} /> Sí</label>
            <span class="lbl">Precio privado (💎/min)</span><input class="field" id="pCallPrice" type="number" min="0" value="${settings.callPriceDiamonds || ''}" placeholder="100" style="margin:0" />
          </div>
          <button class="btn btn-grad" style="margin-top:14px" data-action="saveCreator">Guardar configuración</button>
        </div></div>
        <div class="panel"><div class="panel-h">Vitrina promocional
            <button class="btn btn-grad btn-sm" data-action="pickShowcase">+ Agregar foto</button></div>
          <div class="panel-b">
            <p class="muted" style="font-size:.83rem;margin:0 0 12px">Estas fotos se muestran <b>sin blur</b> a cualquiera en tu perfil y portada, para promocionarte. El resto de tu contenido sigue protegido.</p>
            <div class="media-grid" id="showcaseGrid">${spin()}</div>
          </div></div>
        <div class="panel"><div class="panel-h">Seguridad</div><div class="panel-b">
          <div class="muted" style="font-size:.85rem">Verificación: <b>${me.role === 'admin' ? 'admin' : 'creadora'}</b> · 2FA: ${me.twoFactorEnabled ? '✔ activo' : 'inactivo'}</div>
        </div></div>
        <div class="panel"><div class="panel-h">Privacidad por país (geo-bloqueo)</div><div class="panel-b">
          <p class="muted" style="font-size:.83rem;margin:0 0 12px">Para los países que bloquees serás <b>completamente invisible</b>: no apareces en descubrimiento ni en vivo, ni pueden ver tu perfil, escribirte o pedir privado.</p>
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px">
            <select class="field" id="countrySel" style="width:auto;margin:0;min-width:220px">${countryOptions()}</select>
            <button class="btn btn-sm" data-action="addBlock">Agregar a la lista</button>
          </div>
          <div id="blockedChips" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">${renderBlockedChips()}</div>
          <button class="btn btn-grad" data-action="saveBlocked">Guardar países bloqueados</button>
        </div></div>`;
      loadShowcase();
    } catch { c.innerHTML = '<div class="empty">Error al cargar el perfil.</div>'; }
  };
  async function loadShowcase() {
    const el = $('showcaseGrid'); if (!el) return;
    try {
      const { items } = await api('/studio/content' + qs({ limit: 100 }));
      const pics = items.filter((m) => m.media_type === 'photo' && m.visibility === 'public');
      el.innerHTML = pics.length ? pics.map(showcaseCard).join('') : '<div class="empty" style="grid-column:1/-1">Aún no tienes fotos en la vitrina. Toca "+ Agregar foto".</div>';
    } catch { el.innerHTML = '<div class="empty" style="grid-column:1/-1">Error.</div>'; }
  }
  function showcaseCard(m) {
    const thumb = m.url ? `<img class="thumb" src="${m.url}" alt="" />` : `<div class="thumb" style="display:flex;align-items:center;justify-content:center;font-size:1.6rem">🖼️</div>`;
    return `<div class="media-card">${thumb}<div class="row"><span class="pill pub">🌐 EN VITRINA</span>
      <span style="display:flex;gap:6px"><button class="btn btn-sm" data-action="unshowcase" data-arg="${m.id}" title="Quitar de la vitrina">↩️</button>
      <button class="btn btn-sm" data-action="delItem" data-arg="${m.id}">🗑</button></span></div></div>`;
  }
  async function unshowcase(id) { try { await api('/studio/content/' + id, { method: 'PATCH', body: { visibility: 'subscribers' } }); toast('Quitada de la vitrina'); loadShowcase(); } catch { toast('Error'); } }
  async function saveProfile() {
    try { await api('/users/me', { method: 'PATCH', body: { displayName: $('pName').value.trim(), city: $('pCity').value.trim(), bio: $('pBio').value.trim() } }); toast('Perfil guardado ✓'); $('whoName').textContent = $('pName').value.trim(); } catch { toast('Error al guardar'); }
  }
  async function saveCreator() {
    const body = {}; const head = $('pHead').value.trim(); const price = $('pPrice').value; const cp = $('pCallPrice').value;
    if (head) body.headline = head; if (price) body.monthlyPriceCop = Number(price); body.acceptsCalls = $('pCalls').checked; if (cp !== '') body.callPriceDiamonds = Number(cp);
    try { await api('/models/me', { method: 'PATCH', body }); toast('Configuración guardada ✓'); } catch { toast('Error al guardar'); }
  }

  /* ---------- Geo-bloqueo por país ---------- */
  const COUNTRIES = [['CO','Colombia'],['US','Estados Unidos'],['MX','México'],['ES','España'],['AR','Argentina'],['PE','Perú'],['CL','Chile'],['EC','Ecuador'],['VE','Venezuela'],['BR','Brasil'],['PA','Panamá'],['CR','Costa Rica'],['GT','Guatemala'],['DO','Rep. Dominicana'],['BO','Bolivia'],['PY','Paraguay'],['UY','Uruguay'],['HN','Honduras'],['SV','El Salvador'],['NI','Nicaragua'],['PR','Puerto Rico'],['CA','Canadá'],['GB','Reino Unido'],['FR','Francia'],['DE','Alemania'],['IT','Italia'],['PT','Portugal'],['NL','Países Bajos'],['BE','Bélgica'],['CH','Suiza'],['SE','Suecia'],['NO','Noruega'],['DK','Dinamarca'],['IE','Irlanda'],['PL','Polonia'],['RU','Rusia'],['UA','Ucrania'],['TR','Turquía'],['AU','Australia'],['NZ','Nueva Zelanda'],['JP','Japón'],['CN','China'],['KR','Corea del Sur'],['IN','India'],['ID','Indonesia'],['PH','Filipinas'],['TH','Tailandia'],['VN','Vietnam'],['AE','Emiratos Árabes'],['SA','Arabia Saudita'],['ZA','Sudáfrica'],['NG','Nigeria'],['EG','Egipto'],['MA','Marruecos']];
  const countryName = (code) => (COUNTRIES.find((c) => c[0] === code) || [code, code])[1];
  const flagOf = (code) => { try { return code.toUpperCase().replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0))); } catch { return '🏳️'; } };
  function countryOptions() { return '<option value="">Elige un país…</option>' + COUNTRIES.map(([c, n]) => `<option value="${c}">${flagOf(c)} ${esc(n)} (${c})</option>`).join(''); }
  function renderBlockedChips() {
    const list = state.blocked || [];
    if (!list.length) return '<span class="muted" style="font-size:.82rem">No hay países bloqueados. Eres visible en todo el mundo.</span>';
    return list.map((c) => `<span class="chip-block">${flagOf(c)} ${esc(countryName(c))} <button data-action="removeBlock" data-arg="${c}" title="Quitar">✕</button></span>`).join('');
  }
  function refreshChips() { const el = $('blockedChips'); if (el) el.innerHTML = renderBlockedChips(); }
  function addBlock() { const sel = $('countrySel'); const code = sel && sel.value; if (!code) return; state.blocked = state.blocked || []; if (!state.blocked.includes(code)) { state.blocked.push(code); refreshChips(); } if (sel) sel.value = ''; }
  function removeBlock(code) { state.blocked = (state.blocked || []).filter((c) => c !== code); refreshChips(); }
  async function saveBlocked() { try { await api('/models/me', { method: 'PATCH', body: { blockedCountries: state.blocked || [] } }); toast((state.blocked || []).length ? `Bloqueo guardado (${state.blocked.length} país/es)` : 'Sin países bloqueados'); } catch { toast('Error al guardar'); } }

  /* ---------- Socket + salas privadas ---------- */
  let socket = null;
  function connectSocket() {
    if (socket || !window.io) return;
    try { socket = window.io({ auth: { token: tok.get() } }); } catch { return; }
    socket.on('live:gift', (g) => {
      const feed = $('giftFeed'); if (feed) { if (feed.querySelector('.muted')) feed.innerHTML = '';
        const d = document.createElement('div'); d.className = 'g'; d.innerHTML = `<span style="font-size:1.3rem">${g.emoji}</span> <b>${esc(g.name)}</b> <span class="muted">· 💎${g.cost}</span>`;
        feed.prepend(d); while (feed.children.length > 30) feed.removeChild(feed.lastChild); }
    });
    socket.on('live:chat', (m) => { if (m.fromUserId !== state.me?.id) liveChatAppend('Espectador', m.text, false); });
    socket.on('live:viewers', (v) => { const el = $('viewerCount'); if (el) el.textContent = v.count; });
    socket.on('private:incoming', ({ callId, fromName, price }) => {
      pendingInvite = { callId, price };
      $('inviteFan').textContent = fromName || 'Un fan'; $('inviteRate').textContent = price;
      $('privInvite').classList.remove('hidden');
      try { navigator.vibrate && navigator.vibrate(300); } catch {}
    });
    socket.on('private:ended', (d) => { teardownPrivateModel(); toast(d.reason === 'insufficient_funds' ? 'Privado terminado: el fan se quedó sin diamantes' : 'Sala privada finalizada'); });
    socket.on('private:chat', (m) => { if (m.from === state.me?.id) return; privChatAppend('Fan', m.text, false); });
    socket.on('private:gift', (g) => {
      const feed = $('privGiftFeed'); if (feed) { if (feed.querySelector('.muted')) feed.innerHTML = '';
        const d = document.createElement('div'); d.className = 'g'; d.innerHTML = `<span style="font-size:1.15rem">${g.emoji}</span> <b>${esc(g.name)}</b> <span class="muted">· 💎${g.cost}</span>`;
        feed.prepend(d); while (feed.children.length > 40) feed.removeChild(feed.lastChild); }
      privChatAppend('🎁', `te envió ${g.emoji} ${g.name}`, false);
    });
  }
  function disconnectSocket() { if (socket) { try { socket.disconnect(); } catch {} socket = null; } }

  let privModelRoom = null, pendingInvite = null, activePrivCall = null;
  let privCamM = true, privMicM = true, privTimerIntM = null, privStartM = 0;
  function privAccept() {
    if (!pendingInvite || !socket) return; const { callId } = pendingInvite;
    $('privInvite').classList.add('hidden');
    socket.emit('private:accept', { callId }, async (ack) => {
      if (ack && ack.ok) { activePrivCall = callId; await enterPrivateModel(ack.url, ack.token, pendingInvite.price); }
      else toast('No se pudo aceptar el privado');
      pendingInvite = null;
    });
  }
  function privDecline() { if (pendingInvite && socket) socket.emit('private:reject', { callId: pendingInvite.callId }); $('privInvite').classList.add('hidden'); pendingInvite = null; }
  async function enterPrivateModel(url, token, price) {
    if (!window.LivekitClient) { toast('El módulo de video no cargó'); return; }
    // Salir del show ABIERTO: dejar de transmitir en la sala pública antes de
    // entrar a la privada (la creadora no está en dos salas a la vez).
    if (lkRoom) { try { lkRoom.disconnect(); } catch {} lkRoom = null; updateGoLiveBtn(false); }
    try {
      privModelRoom = lkPubRoom();
      privModelRoom.on(LivekitClient.RoomEvent.TrackSubscribed, (track) => {
        if (track.kind === 'video' || track.kind === 'audio') track.attach($('privSelfVideo'));
        const ph = $('privWaitFan'); if (ph && track.kind === 'video') ph.style.display = 'none';
      });
      privModelRoom.on(LivekitClient.RoomEvent.Disconnected, () => { teardownPrivateModel(); });
      await privModelRoom.connect(url, token);
      privCamM = true; privMicM = true;
      await privModelRoom.localParticipant.enableCameraAndMicrophone();
      const cam = [...privModelRoom.localParticipant.videoTrackPublications.values()][0];
      if (cam && cam.track) cam.track.attach($('privFanVideo'));
      refreshPrivBtnsM();
      $('privRateM').textContent = (price != null ? price : '0');
      $('privChatFeed').innerHTML = '';
      $('privGiftFeed').innerHTML = '<div class="muted" style="font-size:.82rem">Sin regalos aún.</div>';
      const ph = $('privWaitFan'); if (ph) ph.style.display = '';
      $('privOverlay').classList.remove('hidden');
      startPrivTimerM(); toast('En sala privada 🔒');
    } catch { toast('No se pudo conectar la sala privada'); }
  }
  function refreshPrivBtnsM() { const c = $('privCamM'); if (c) c.textContent = privCamM ? '📷 Cámara: on' : '📷 Cámara: off'; const m = $('privMicM'); if (m) m.textContent = privMicM ? '🎤 Micro: on' : '🎤 Micro: off'; }
  async function privCamToggleM() { if (!privModelRoom) return; try { privCamM = !privCamM; await privModelRoom.localParticipant.setCameraEnabled(privCamM); if (privCamM) { const cam = [...privModelRoom.localParticipant.videoTrackPublications.values()][0]; if (cam && cam.track) cam.track.attach($('privFanVideo')); } refreshPrivBtnsM(); } catch { privCamM = !privCamM; } }
  async function privMicToggleM() { if (!privModelRoom) return; try { privMicM = !privMicM; await privModelRoom.localParticipant.setMicrophoneEnabled(privMicM); refreshPrivBtnsM(); } catch { privMicM = !privMicM; } }
  function privSendM() { const i = $('privChatInput'); const t = i && i.value.trim(); if (!t || !socket || !activePrivCall) return; socket.emit('private:chat', { callId: activePrivCall, text: t }, () => {}); privChatAppend('Tú', t, true); i.value = ''; }
  function privChatAppend(who, text, mine) { const box = $('privChatFeed'); if (!box) return; const d = document.createElement('div'); d.className = 'row'; d.innerHTML = `<b style="color:${mine ? '#ff7ab0' : '#7ad0ff'}">${esc(who)}:</b> ${esc(text)}`; box.appendChild(d); box.scrollTop = box.scrollHeight; while (box.children.length > 60) box.removeChild(box.firstChild); }
  function startPrivTimerM() { privStartM = Date.now(); if (privTimerIntM) clearInterval(privTimerIntM); const el = $('privTimerM'); const tick = () => { if (!el) return; const s = Math.floor((Date.now() - privStartM) / 1000); el.textContent = '⏱ ' + Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }; tick(); privTimerIntM = setInterval(tick, 1000); }
  function privEndM() { if (socket && activePrivCall) socket.emit('private:end', { callId: activePrivCall }); teardownPrivateModel(); }
  function teardownPrivateModel() { if (privModelRoom) { try { privModelRoom.disconnect(); } catch {} privModelRoom = null; } if (privTimerIntM) { clearInterval(privTimerIntM); privTimerIntM = null; } activePrivCall = null; const sv = $('privSelfVideo'); if (sv) sv.srcObject = null; const fv = $('privFanVideo'); if (fv) fv.srcObject = null; $('privOverlay').classList.add('hidden'); }

  /* ---------- Acciones ---------- */
  const ACT = {
    go: (a) => navigate(a), goLiveToggle, toggleLive, liveSendChat,
    pickFile, pickFileAlbum, pickShowcase, pickAvatar, newAlbum, openAlbum: (a) => openAlbum(a), albumVis, delAlbum,
    toggleItem: (a) => toggleItem(a), toggleVis: (a) => toggleVis(a), unshowcase: (a) => unshowcase(a), delItem: (a) => delItem(a),
    saveProfile, saveCreator, addBlock, removeBlock: (a) => removeBlock(a), saveBlocked,
    privAccept, privDecline, privCamM: privCamToggleM, privMicM: privMicToggleM, privSendM, privEndM,
  };
  document.addEventListener('click', (e) => {
    const nav = e.target.closest('[data-nav]'); if (nav) { navigate(nav.dataset.nav); return; }
    const el = e.target.closest('[data-action]'); if (el) { const fn = ACT[el.dataset.action]; if (fn) fn(el.dataset.arg, el); }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const id = document.activeElement && document.activeElement.id;
    if (id === 'privChatInput') { e.preventDefault(); privSendM(); }
    else if (id === 'liveChatInput') { e.preventDefault(); liveSendChat(); }
  });
  $('loginForm').addEventListener('submit', doLogin);
  $('logoutBtn').addEventListener('click', logout);
  $('fileInput').addEventListener('change', onFileChosen);
  $('avatarInput').addEventListener('change', onAvatarChosen);

  (async function boot() {
    if (tok.get()) { try { const me = await api('/users/me'); if (['model', 'admin'].includes(me.role)) { state.me = me; enterApp(); return; } } catch {} tok.set(null); }
  })();
})();
