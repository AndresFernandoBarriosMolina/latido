/* ==========================================================================
 *  Latido — Lógica de la PWA (UI). Datos vía LatidoAPI (api.js).
 * ======================================================================== */

/* ---------- Config ---------- */
const GOOGLE_CLIENT_ID = ''; // pega aquí tu Client ID (ver GUIA-GOOGLE-OAUTH.md)
const grads = ['g1', 'g2', 'g3', 'g4', 'g5', 'g6'];

/* ---------- Estado ---------- */
let isAuthed = false;
let currentUser = null;       // datos del usuario autenticado (de /users/me)
let pendingHandle = null;
let currentFilter = 'all';
let currentTab = 'photos';
let isSubscribed = false;
let currentModel = null;
let authMode = 'login';
let profileDirty = false;
let admCurrentTab = 'dash';
let admCurrentUserId = null;

/* ---------- Helpers ---------- */
const $ = (id) => document.getElementById(id);
const val = (id) => ($(id) ? $(id).value.trim() : '');
function avatarLetter(name) { return ((name || '?').trim()[0] || '?').toUpperCase(); }
function seedFromId(id) { let h = 0; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; }
function gradFor(seed, i) { return grads[(((seed || 0) + i) % 6 + 6) % 6]; }
function fmtCop(n) { return Number(n || 0).toLocaleString('es-CO'); }
function dotClass(status) { return status === 'online' || status === 'live' ? 'on' : status === 'in_call' ? 'busy' : 'off'; }
function statusText(status) {
  return status === 'live' ? '🟢 En vivo' : status === 'online' ? 'En línea'
    : status === 'in_call' ? 'En llamada' : 'Desconectada';
}
function normModel(m) { return { ...m, _av: avatarLetter(m.displayName), _seed: seedFromId(m.id) }; }

let tT;
function toast(msg) {
  const t = $('toast'); if (!t) return;
  t.textContent = msg; t.classList.add('show');
  clearTimeout(tT); tT = setTimeout(() => t.classList.remove('show'), 2400);
}

/* ==========================================================================
 *  DESCUBRIMIENTO (galería)  — vía API
 * ======================================================================== */
async function renderLive() {
  try {
    const { items } = await LatidoAPI.listModels({ filter: 'live', limit: 12 });
    $('liveRow').innerHTML = items.map((m) => {
      const n = normModel(m);
      const ph = m.photoUrl
        ? `<div class="ph" style="background-image:url('${m.photoUrl}');background-size:cover;background-position:center"></div>`
        : `<div class="ph ${gradFor(n._seed, 0)}">${n._av}</div>`;
      return `<div class="live-story" data-act="watchLive" data-arg="${m.id}|${encodeURIComponent(m.displayName || 'En vivo')}">
        <div class="live-ring">${ph}<div class="live-tag">EN VIVO</div></div>
        <div class="live-name">${m.displayName}</div>
      </div>`;
    }).join('');
  } catch (e) { /* sección opcional */ }
}

let searchTimer;
function filterModels() { clearTimeout(searchTimer); searchTimer = setTimeout(renderGrid, 250); }

async function renderGrid() {
  const q = val('search');
  const apiFilter = currentFilter === 'on' ? 'online' : currentFilter; // chip 'on' -> 'online'
  const grid = $('mgrid'), empty = $('emptyState');
  try {
    const { items } = await LatidoAPI.listModels({ q, filter: apiFilter, limit: 40 });
    empty.style.display = items.length ? 'none' : 'block';
    grid.innerHTML = items.map((m) => {
      const n = normModel(m);
      const badge = m.isLive
        ? '<div class="badge-tl">🟢 EN VIVO</div>'
        : (m.status === 'online' ? '<div class="badge-tl" style="background:var(--grad-cool)">🟢 EN LÍNEA</div>' : '');
      const ph = m.photoUrl
        ? `<div class="ph" style="background-image:url('${m.photoUrl}');background-size:cover;background-position:center"></div>`
        : `<div class="ph ${gradFor(n._seed, 0)}">${n._av}</div>`;
      return `<div class="mcard" data-act="openModel" data-arg="${m.handle}">
        ${ph}
        <div class="grad"></div>
        ${badge}
        ${m.hasPremium ? '<div class="badge-tr">🔒</div>' : ''}
        <div class="meta">
          <div class="mname">${m.displayName}, ${m.age || ''} ${m.verified ? '<span class="verified">✔️</span>' : ''}</div>
          <div class="mstate"><span class="mini-dot ${dotClass(m.status)}"></span>${statusText(m.status)} · ${m.city || ''}</div>
        </div>
      </div>`;
    }).join('');
  } catch (e) {
    empty.style.display = 'block';
    empty.textContent = '⚠️ No se pudo cargar la galería (¿API arriba?).';
  }
}

/* ==========================================================================
 *  PERFIL DE MODELO  — vía API
 * ======================================================================== */
async function openModel(handle) {
  if (!isAuthed) { requireAuth(handle); return; }       // ver perfil exige cuenta
  try {
    const m = normModel(await LatidoAPI.getModel(handle));
    currentModel = m;
    $('mpName').innerHTML = `${m.displayName}, ${m.age || ''} ${m.verified ? '<span class="verified">✔️</span>' : ''}`;
    $('mpHandle').textContent = `@${m.handle} · ${m.city || ''} 📍`;
    if ($('stPhotos')) $('stPhotos').textContent = m.stats.photos;
    if ($('stVideos')) $('stVideos').textContent = m.stats.videos;
    if ($('mpBio')) $('mpBio').textContent = m.bio || '';
    const tags = document.querySelector('.mp-tags');
    if (tags) tags.innerHTML = (m.interests || []).map((t) => `<span>${t}</span>`).join('');
    $('subBtn').textContent = `Suscríbete · $${fmtCop(m.monthlyPriceCop)}/mes`;
    // Contenido real: thumbUrl ya viene borroso (no-sub) o nítido (sub/dueña).
    try { currentModel._items = (await LatidoAPI.getModelContent(m.id)).items || []; }
    catch { currentModel._items = []; }
    renderSlider(m); renderContent(); applySub();
    go('model'); buildMpSlider();
    document.querySelector('.screen').scrollTop = 0;
  } catch (e) { toast('No se pudo abrir el perfil'); }
}

/* Fotos de la "vitrina": públicas, sin blur (para slider/portada). */
function showcasePhotos() {
  const m = currentModel; if (!m) return [];
  return (m._items || []).filter((it) => it.type === 'photo' && it.visibility === 'public' && it.thumbUrl && !it.locked);
}

/* slider automático de cabecera */
let mpIdx = 0, mpTimer = null, mpCount = 5;
function buildMpSlider() {
  const m = currentModel; if (!m) return;
  const slides = $('mpSlides'), dots = $('mpDots');
  const pics = showcasePhotos();
  mpCount = Math.max(1, pics.length || 5);
  mpIdx = 0;
  slides.innerHTML = pics.length
    ? pics.map((it) => `<div class="mp-slide" style="background-image:url('${it.thumbUrl}');background-size:cover;background-position:center"></div>`).join('')
    : Array.from({ length: mpCount }).map((_, i) => `<div class="mp-slide ${gradFor(m._seed, i)}">${m._av}</div>`).join('');
  dots.innerHTML = Array.from({ length: mpCount }).map((_, i) => `<div class="mp-dot ${i === 0 ? 'on' : ''}"></div>`).join('');
  slides.style.transform = 'translateX(0)';
  startMpSlider();
}
function showMpSlide(i) {
  const slides = $('mpSlides'); if (!slides) return;
  mpIdx = (i + mpCount) % mpCount;
  slides.style.transform = 'translateX(-' + (mpIdx * 100) + '%)';
  document.querySelectorAll('#mpDots .mp-dot').forEach((d, j) => d.classList.toggle('on', j === mpIdx));
}
function startMpSlider() { stopMpSlider(); mpTimer = setInterval(() => showMpSlide(mpIdx + 1), 2800); }
function stopMpSlider() { if (mpTimer) { clearInterval(mpTimer); mpTimer = null; } }
function leaveModel() { stopMpSlider(); go('home'); }

function tryVideoCall() {
  if (!isSubscribed) {
    toast('🔒 Suscríbete a ' + (currentModel ? currentModel.displayName : 'esta modelo') + ' para videollamada');
    const sc = $('subCard'); if (sc) sc.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  startCall(currentModel.displayName + ', ' + (currentModel.age || ''), currentModel._av);
}

function renderSlider(m) {
  const el = $('slider'); if (!el) return;
  const pics = showcasePhotos();
  el.innerHTML = pics.length
    ? pics.map((it, i) => `<div class="slide" data-act="cellOpenShowcase" data-arg="${i}" style="background-image:url('${it.thumbUrl}');background-size:cover;background-position:center;cursor:pointer"></div>`).join('')
    : Array.from({ length: 5 }).map((_, i) => `<div class="slide ${gradFor(m._seed, i)}">📷<div class="cnt">${i + 1}/5</div></div>`).join('');
}
let galleryItems = [];
function renderContent() {
  const m = currentModel; if (!m) return;
  const wantVideo = currentTab === 'videos';
  const items = (m._items || []).filter((it) => (it.type === 'video') === wantVideo);
  galleryItems = items;
  const grid = $('cgrid'); if (!grid) return;
  if (!items.length) { grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;color:var(--muted);padding:30px">Sin ${wantVideo ? 'videos' : 'fotos'} aún</div>`; return; }
  grid.innerHTML = items.map((it, i) => {
    const bg = it.thumbUrl ? `background-image:url('${it.thumbUrl}');background-size:cover;background-position:center` : '';
    return `<div class="cell" data-act="cellOpen" data-arg="${i}" style="${bg};position:relative;cursor:pointer">
      ${it.type === 'video' ? '<div class="vbadge">▶</div>' : ''}
      ${it.locked ? '<div class="lockblur"><div class="lk">🔒</div><small>Suscríbete</small></div>' : ''}
    </div>`;
  }).join('');
}
/* ---- Lightbox / visor ---- */
let lbIndex = 0;
function openLightbox(i) {
  if (!galleryItems.length) return;
  lbIndex = Math.max(0, Math.min(galleryItems.length - 1, Number(i) || 0));
  renderLightbox();
  const lb = $('lightbox'); if (lb) lb.style.display = 'flex';
}
function closeLightbox() { const lb = $('lightbox'); if (lb) lb.style.display = 'none'; if ($('lbStage')) $('lbStage').innerHTML = ''; }
function lbPrev() { if (!galleryItems.length) return; lbIndex = (lbIndex - 1 + galleryItems.length) % galleryItems.length; renderLightbox(); }
function lbNext() { if (!galleryItems.length) return; lbIndex = (lbIndex + 1) % galleryItems.length; renderLightbox(); }
function renderLightbox() {
  const it = galleryItems[lbIndex]; if (!it) return;
  const stage = $('lbStage'); if (!stage) return;
  const st = 'max-width:94vw;max-height:80vh;border-radius:12px;user-select:none';
  if (it.locked) {
    stage.innerHTML = `<div style="position:relative;display:inline-block"><img src="${it.thumbUrl}" alt="" style="${st}" draggable="false" />
      <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;background:rgba(0,0,0,.25);border-radius:12px">
        <div style="font-size:2rem">🔒</div><button class="btn btn-grad" data-act="subscribe">Suscríbete para ver</button></div></div>`;
  } else if (it.type === 'video') {
    stage.innerHTML = `<video src="${it.thumbUrl}" controls autoplay playsinline controlslist="nodownload" style="${st};background:#000"></video>`;
  } else {
    const wm = currentUser ? ('ID ' + String(currentUser.id).slice(0, 8) + ' · Latido') : 'Latido';
    stage.innerHTML = `<div style="position:relative;display:inline-block"><img src="${it.thumbUrl}" alt="" style="${st}" draggable="false" />
      <div style="position:absolute;bottom:10px;right:12px;color:rgba(255,255,255,.55);font-size:.7rem;pointer-events:none;text-shadow:0 1px 3px #000">${wm}</div></div>`;
  }
  if ($('lbCounter')) $('lbCounter').textContent = `${lbIndex + 1} / ${galleryItems.length}`;
}
function cellOpen(i) {
  const wantVideo = currentTab === 'videos';
  galleryItems = (currentModel && currentModel._items || []).filter((it) => (it.type === 'video') === wantVideo);
  openLightbox(i);
}
function cellOpenShowcase(i) { galleryItems = showcasePhotos(); openLightbox(i); }
function switchTab(t) { currentTab = t; document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('on', x.dataset.t === t)); renderContent(); }

function setSub(v) {
  isSubscribed = v;
  if ($('tFree')) $('tFree').classList.toggle('on', !v);
  if ($('tSub')) $('tSub').classList.toggle('on', v);
  applySub(); renderContent();
}
function applySub() {
  if ($('subCard')) $('subCard').style.display = isSubscribed ? 'none' : 'block';
  if ($('lockBanner')) $('lockBanner').style.display = isSubscribed ? 'none' : 'block';
  const acts = document.querySelector('.mp-actions'); if (acts) acts.style.display = isSubscribed ? 'none' : 'flex';
  const vc = $('vcBtn'), vl = $('vcLabel');
  if (vc && vl) { vc.classList.toggle('locked', !isSubscribed); vl.textContent = isSubscribed ? 'Videollamada' : 'Videollamada 🔒'; }
}

/* ==========================================================================
 *  BILLETERA / PAGOS (Wompi Web Checkout)
 * ======================================================================== */
async function renderWallet() {
  try {
    const [wallet, pk] = await Promise.all([LatidoAPI.getWallet(), LatidoAPI.getPackages()]);
    if ($('walletBalance')) $('walletBalance').textContent = fmtCop(wallet.diamonds || 0);
    if (currentUser) { currentUser.diamonds = wallet.diamonds; updateAuthUI(); }
    const packs = pk.items || [];
    if ($('packList')) $('packList').innerHTML = packs.length ? packs.map((p, i) => {
      const total = (p.diamonds || 0) + (p.bonus_diamonds || 0);
      const bonus = p.bonus_diamonds ? ` +${p.bonus_diamonds} bonus` : '';
      return `<div class="pack${i === 1 ? ' best' : ''}" data-act="buyPackage" data-arg="${p.id}">
        <div class="picon">${i === 2 ? '👑' : '💎'}</div>
        <div class="pmeta"><b>${fmtCop(total)} diamantes</b><div>${fmtCop(p.diamonds)}${bonus}</div></div>
        <div class="pprice">$${fmtCop(p.price_cop)}</div></div>`;
    }).join('') : '<div style="color:var(--muted);padding:20px;text-align:center">Sin paquetes.</div>';
    const led = wallet.ledger || [];
    if ($('ledgerList')) $('ledgerList').innerHTML = led.length ? led.map(ledgerRow).join('') : '<div style="color:var(--muted);padding:16px;text-align:center">Sin movimientos aún.</div>';
    renderSubs();
  } catch (e) { if ($('packList')) $('packList').innerHTML = '<div style="color:var(--muted);padding:20px;text-align:center">No se pudo cargar la billetera.</div>'; }
}
function ledgerRow(l) {
  const amt = l.diamonds_delta ? `${l.diamonds_delta > 0 ? '+' : ''}${fmtCop(l.diamonds_delta)} 💎` : (l.cop_delta ? `$${fmtCop(l.cop_delta)}` : '');
  return `<div class="crow" style="justify-content:space-between"><div><b>${escapeHtml(l.memo || l.kind || '')}</b>
    <div style="font-size:.72rem;color:var(--muted)">${fmtTime(l.created_at)}</div></div><div style="font-weight:700">${amt}</div></div>`;
}
async function renderSubs() {
  if (!$('subsList')) return;
  try {
    const { items } = await LatidoAPI.getSubscriptions();
    $('subsList').innerHTML = items.length ? items.map((s) => `<div class="crow" style="justify-content:space-between">
      <div><b>${escapeHtml(s.model_name || s.handle || 'Creadora')}</b>
      <div style="font-size:.72rem;color:var(--muted)">${s.status === 'active' ? 'Activa' : 'Pendiente'} · hasta ${new Date(s.current_period_end).toLocaleDateString('es-CO')}</div></div>
      ${s.status === 'active' && s.auto_renew ? `<button class="btn btn-ghost btn-sm" data-act="cancelSub" data-arg="${s.model_id}">Cancelar</button>` : (s.status === 'active' ? '<span style="font-size:.72rem;color:var(--muted)">No renovará</span>' : '')}
    </div>`).join('') : '<div style="color:var(--muted);padding:16px;text-align:center">No tienes suscripciones.</div>';
  } catch { $('subsList').innerHTML = ''; }
}
async function cancelSub(modelId) {
  if (!confirm('¿Cancelar la renovación automática? Mantendrás el acceso hasta el fin del período.')) return;
  try { await LatidoAPI.cancelSubscription(modelId); toast('Renovación cancelada'); renderSubs(); } catch { toast('No se pudo cancelar'); }
}
async function buyPackage(packageId) {
  try { toast('Preparando pago seguro…'); const co = await LatidoAPI.checkout({ purpose: 'topup', packageId }); startWompiCheckout(co); }
  catch (e) { toast('No se pudo iniciar el pago'); }
}
function startWompiCheckout(co) {
  if (!co || !co.publicKey) { toast('La pasarela de pago aún no está configurada (faltan llaves de Wompi).'); return; }
  const f = $('wompiForm'); if (!f) return;
  f.action = co.checkoutUrl; f.method = 'GET';
  const fields = { 'public-key': co.publicKey, 'currency': co.currency, 'amount-in-cents': co.amountInCents, 'reference': co.reference, 'signature:integrity': co.signature, 'redirect-url': co.redirectUrl };
  if (currentUser && currentUser.email) fields['customer-data:email'] = currentUser.email;
  f.innerHTML = Object.entries(fields).map(([k, v]) => `<input type="hidden" name="${k}" value="${String(v).replace(/"/g, '&quot;')}">`).join('');
  toast('Redirigiendo al pago seguro de Wompi…');
  setTimeout(() => f.submit(), 300);
}
async function subscribe() {
  if (!currentModel || !currentModel.id) { setSub(true); return; }
  try {
    const co = await LatidoAPI.checkout({ purpose: 'subscription', modelId: currentModel.id });
    if (!co.publicKey) { toast('Pasarela no configurada — activando en modo prueba ⭐'); setSub(true); return; }
    startWompiCheckout(co);
  } catch (e) { toast('No se pudo iniciar la suscripción'); }
}
function handlePaymentReturn() {
  try {
    const u = new URL(location.href);
    if (u.searchParams.get('payment') === 'return') {
      toast('Verificando tu pago… tu saldo se actualizará al confirmarse.');
      history.replaceState({}, '', location.pathname);
      if (isAuthed) go('wallet');
    }
  } catch {}
}
function escapeHtml(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function fmtTime(ts) { try { return new Date(ts).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch { return ''; } }

/* ==========================================================================
 *  AUTENTICACIÓN  — vía API
 * ======================================================================== */
function requireAuth(handle) { pendingHandle = (typeof handle === 'string') ? handle : null; resetAuthForm(); go('login'); }
function updateAuthUI() {
  if ($('loginBtn')) $('loginBtn').style.display = isAuthed ? 'none' : '';
  if ($('coins')) $('coins').style.display = isAuthed ? 'flex' : 'none';
  const navAdmin = $('navAdmin');
  if (navAdmin) navAdmin.style.display = (currentUser && currentUser.role === 'admin') ? 'flex' : 'none';
  if (isAuthed && currentUser) {
    const d = currentUser.diamonds || 0;
    const coinsEl = $('coins');
    if (coinsEl) coinsEl.innerHTML = `💎 <b>${d.toLocaleString('es-CO')}</b>`;
  }
}
function resetAuthForm() { authMode = 'login'; applyAuthMode(); }
function toggleAuthMode() { authMode = authMode === 'login' ? 'register' : 'login'; applyAuthMode(); }
function applyAuthMode() {
  const reg = authMode === 'register';
  const show = (id, on) => { const el = $(id); if (el) el.style.display = on ? '' : 'none'; };
  show('authName', reg); show('authBirth', reg); show('authConsentRow', reg);
  if ($('btnPrimary')) $('btnPrimary').textContent = reg ? 'Crear cuenta' : 'Iniciar sesión';
  if ($('authToggle')) $('authToggle').textContent = reg ? '¿Ya tienes cuenta? Inicia sesión' : '¿No tienes cuenta? Regístrate';
  if ($('loginSub')) $('loginSub').textContent = reg
    ? 'Crea tu cuenta para ver perfiles, chatear y hacer videollamadas.'
    : 'Inicia sesión para ver perfiles, chatear y hacer videollamadas.';
}

async function submitAuth() {
  const email = val('authEmail'), pass = val('authPass');
  if (!email || !pass) { toast('Completa correo y contraseña'); return; }
  try {
    let resp;
    if (authMode === 'register') {
      const name = val('authName'), birth = val('authBirth');
      const consent = $('authConsent') && $('authConsent').checked;
      if (!name) { toast('Escribe tu nombre'); return; }
      if (!birth) { toast('Indica tu fecha de nacimiento'); return; }
      if (!consent) { toast('Debes ser mayor de 18 y aceptar la política'); return; }
      resp = await LatidoAPI.register({ email, password: pass, displayName: name, birthdate: birth, dataConsent: true });
    } else {
      try { resp = await LatidoAPI.login(email, pass); }
      catch (le) {
        if (le.data?.error === 'totp_required' || le.data?.error === 'totp_invalid') {
          const code = prompt('Ingresa tu código de verificación (2FA):');
          if (!code) { toast('Código 2FA requerido'); return; }
          resp = await LatidoAPI.login(email, pass, code.trim());
        } else throw le;
      }
    }
    LatidoAPI.token.set(resp.accessToken);
    if (resp.refreshToken) try { localStorage.setItem('latido_refresh', resp.refreshToken); } catch {}
    onAuthed();
  } catch (e) {
    const map = {
      underage: 'Debes ser mayor de 18 años',
      already_exists: 'La cuenta ya existe, inicia sesión',
      bad_credentials: 'Correo o contraseña incorrectos',
      invalid: 'Revisa los datos ingresados',
    };
    toast(map[e.data && e.data.error] || map[e.message] || 'No se pudo autenticar');
  }
}

function loginGoogle() {
  if (!GOOGLE_CLIENT_ID || !(window.google && google.accounts)) {
    toast('Google aún no está configurado (ver GUIA-GOOGLE-OAUTH.md)');
    return;
  }
  google.accounts.id.initialize({
    client_id: GOOGLE_CLIENT_ID,
    callback: async (resp) => {
      try {
        const r = await LatidoAPI.loginGoogle(resp.credential, '2000-01-01', true);
        LatidoAPI.token.set(r.accessToken); onAuthed();
      } catch (e) { toast('No se pudo iniciar con Google'); }
    },
  });
  google.accounts.id.prompt();
}

async function onAuthed() {
  isAuthed = true;
  try {
    currentUser = await LatidoAPI.getMe();
  } catch { currentUser = null; }
  updateAuthUI();
  connectSocket();
  // Inicializar E2E — genera keypair si no existe y registra la pública en servidor
  if (currentUser && window.LatidoCrypto) {
    LatidoCrypto.initCrypto(currentUser.id).then(({ publicJwk }) => {
      LatidoAPI.setPublicKey(publicJwk).catch(() => {});
    }).catch(() => {});
  }
  renderLive(); renderGrid();
  if (pendingHandle) { const h = pendingHandle; pendingHandle = null; openModel(h); }
  else go('home');
}

async function profileLogout() {
  try { await LatidoAPI.logout(localStorage.getItem('latido_refresh')); } catch {}
  LatidoAPI.token.clear();
  localStorage.removeItem('latido_refresh');
  isAuthed = false; currentUser = null;
  disconnectSocket();
  updateAuthUI(); go('home'); toast('Sesión cerrada');
}
function logout() { profileLogout(); }

/* ==========================================================================
 *  NAVEGACIÓN
 * ======================================================================== */
const GATED = ['wallet', 'chats', 'profile', 'model', 'thread', 'studio', 'admin'];
function go(v) {
  if (!isAuthed && GATED.includes(v)) { requireAuth(); return; }
  if (v === 'admin' && (!currentUser || currentUser.role !== 'admin')) { toast('Acceso restringido'); return; }
  currentView = v;
  document.querySelectorAll('.view').forEach((x) => x.classList.remove('active'));
  $(v).classList.add('active');
  if (v !== 'model') stopMpSlider();
  const onApp = v !== 'login' && v !== 'thread';
  $('nav').style.display = onApp ? 'flex' : 'none';
  $('demoToggle').style.display = (v === 'model') ? 'flex' : 'none';
  document.querySelectorAll('.nav button[data-v]').forEach((b) => b.classList.toggle('on', b.dataset.v === v));
  document.querySelector('.screen').scrollTop = 0;
  if (v === 'profile') loadProfile();
  if (v === 'admin')   admTab('dash');
  if (v === 'studio')  loadStudio();
  if (v === 'wallet')  renderWallet();
  if (v === 'chats')   loadConversations();
}

/* ==========================================================================
 *  VIDEOLLAMADA (demo de interfaz)
 * ======================================================================== */
function startCall(name, av) {
  if (!isAuthed) { requireAuth(); return; }
  const c = $('call');
  c.querySelector('#callName').textContent = name || (currentModel ? currentModel.displayName + ', ' + (currentModel.age || '') : 'Llamada');
  c.querySelector('#callAv').textContent = av || (currentModel ? currentModel._av : 'L');
  c.querySelector('#remoteVideo').style.background = 'linear-gradient(160deg,#3a1660,#120821)';
  spawnWatermark(); c.classList.add('active');
}
function endCall() { $('call').classList.remove('active'); $('drawer').classList.remove('up'); }
function toggleDrawer() { $('drawer').classList.toggle('up'); }
function sendGift(emoji, cost) {
  const z = $('flyzone'), g = document.createElement('div');
  g.className = 'gift-fly'; g.textContent = emoji; z.appendChild(g); setTimeout(() => g.remove(), 2400);
  toggleDrawer(); toast(`Enviaste ${emoji} (💎${cost})`);
}
function spawnWatermark() {
  const v = $('remoteVideo');
  v.querySelectorAll('.watermark').forEach((x) => x.remove());
  [[18, 140], [60, 300], [30, 520], [65, 640]].forEach((p) => {
    const w = document.createElement('div'); w.className = 'watermark';
    w.style.left = p[0] + '%'; w.style.top = p[1] + 'px'; w.textContent = 'ID:USR-2841 · Latido'; v.appendChild(w);
  });
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) console.log('App en segundo plano: en producción se pausaría/difuminaría el video.');
});

/* ==========================================================================
 *  CHATS reales (API + Socket.io, cifrado en reposo)
 * ======================================================================== */
let socket = null, convList = [], activeConv = null, activeOther = null;
async function loadConversations() {
  const el = $('clist'); if (!el) return;
  if (!isAuthed) { el.innerHTML = '<div style="text-align:center;color:var(--muted);padding:40px">Inicia sesión para ver tus chats.</div>'; return; }
  el.innerHTML = '<div style="text-align:center;color:var(--muted);padding:30px">Cargando…</div>';
  try {
    const { items } = await LatidoAPI.listConversations();
    convList = items || [];
    if (!convList.length) { el.innerHTML = '<div style="text-align:center;color:var(--muted);padding:40px">Aún no tienes conversaciones.<br>Abre el perfil de una creadora y escríbele.</div>'; return; }
    el.innerHTML = convList.map((c) => {
      const seed = seedFromId(c.otherId); const last = c.lastMessage ? escapeHtml(c.lastMessage.slice(0, 48)) : 'Conversación iniciada';
      return `<div class="crow" data-act="openConv" data-arg="${c.id}|${c.otherId}|${encodeURIComponent(c.otherName || 'Usuario')}|${seed}">
        <div class="cav ${gradFor(seed, 0)}">${avatarLetter(c.otherName)}</div>
        <div class="cmid"><div class="cn">${escapeHtml(c.otherName || 'Usuario')}</div><div class="cp">${last}</div></div>
        <div class="cend"><div class="ct">${c.lastAt ? fmtTime(c.lastAt) : ''}</div></div>
      </div>`;
    }).join('');
  } catch { el.innerHTML = '<div style="text-align:center;color:var(--muted);padding:40px">No se pudieron cargar los chats.</div>'; }
}
function renderChats() { loadConversations(); }
async function openConv(arg) {
  const [convId, otherId, nameEnc, seed] = String(arg).split('|');
  activeConv = convId; activeOther = otherId;
  $('thAv').textContent = avatarLetter(decodeURIComponent(nameEnc)); $('thAv').className = 'tav ' + gradFor(Number(seed) || 0, 0);
  $('thName').textContent = decodeURIComponent(nameEnc || 'Chat');
  go('thread'); await loadThread();
}
async function chatWithCurrentModel() {
  if (!isAuthed) { requireAuth(); return; }
  if (!currentModel || !currentModel.id) { toast('Abre primero un perfil'); return; }
  try {
    const { conversationId } = await LatidoAPI.openConversation(currentModel.id);
    activeConv = conversationId; activeOther = currentModel.id;
    $('thAv').textContent = currentModel._av; $('thAv').className = 'tav ' + gradFor(currentModel._seed, 0);
    $('thName').textContent = currentModel.displayName;
    go('thread'); await loadThread();
  } catch (e) { toast(e.data?.error === 'not_available' ? 'No disponible' : 'No se pudo abrir el chat'); }
}
async function loadThread() {
  const b = $('thBody'); if (!b) return; b.innerHTML = '';
  try {
    const { items } = await LatidoAPI.getMessages(activeConv, { limit: 60 });
    (items || []).forEach((m) => appendBubble(m));
    b.scrollTop = b.scrollHeight;
  } catch { b.innerHTML = '<div style="text-align:center;color:var(--muted);padding:20px">No se pudo cargar la conversación.</div>'; }
}
function appendBubble(m) {
  const b = $('thBody'); if (!b) return;
  const mine = m.senderId === (currentUser && currentUser.id) || m.fromUserId === (currentUser && currentUser.id);
  const d = document.createElement('div'); d.className = 'bub ' + (mine ? 'me' : 'them');
  d.innerHTML = escapeHtml(m.message || m.body || '') + `<div class="tm">${fmtTime(m.createdAt || m.at || Date.now())}</div>`;
  b.appendChild(d); b.scrollTop = b.scrollHeight;
}
function sendMsg() {
  const i = $('msgInput'), v = i.value.trim(); if (!v || !activeOther) return;
  if (socket) socket.emit('chat:message', { toUserId: activeOther, message: v }, (ack) => {
    if (ack && ack.error) toast(ack.error === 'blocked' ? 'No disponible' : 'No se pudo enviar');
  });
  appendBubble({ senderId: currentUser && currentUser.id, message: v, createdAt: Date.now() });
  i.value = '';
}

// Conecta el WebSocket con el JWT; entrega mensajes/eventos en vivo.
function connectSocket() {
  if (socket || !window.io || !LatidoAPI.isAuthed()) return;
  socket = window.io({ auth: { token: LatidoAPI.token.get() }, transports: ['websocket', 'polling'] });
  socket.on('chat:message', (m) => {
    if (m.conversationId && m.conversationId === activeConv) appendBubble({ senderId: m.fromUserId, message: m.message, createdAt: m.createdAt });
    else toast('💬 Nuevo mensaje');
    if (currentView === 'chats') loadConversations();
  });
  socket.on('live:chat', (m) => { if (currentLiveModel && m.fromUserId !== (currentUser && currentUser.id)) appendLiveChat('Espectador', m.text, false); });
  socket.on('live:gift', (g) => { if (currentLiveModel) { flyGift(g.emoji); appendLiveChat('🎁', `envió ${g.emoji} ${g.name}`, false); } });
  socket.on('live:viewers', (v) => { const el = $('liveViewers'); if (el && currentLiveModel) el.textContent = '👁 ' + v.count; });
  socket.on('private:accepted', (d) => { privateCallId = d.callId; enterPrivate(d.url, d.token, d.price); });
  socket.on('private:rejected', () => toast('La creadora rechazó el privado'));
  socket.on('private:ended', (d) => { toast(d.reason === 'insufficient_funds' ? 'Privado terminado: sin diamantes' : 'Sala privada finalizada'); teardownPrivate(); });
  socket.on('private:billed', (d) => { if (currentUser) { currentUser.diamonds = d.remaining; updateAuthUI(); } });
  socket.on('private:chat', (m) => { if (privateCallId && m.from !== (currentUser && currentUser.id)) appendLiveChat('Creadora', m.text, false); });
  socket.on('private:gift', (g) => { if (privateCallId) { flyGift(g.emoji); appendLiveChat('🎁', `enviaste ${g.emoji} ${g.name}`, true); } });
  socket.on('connect_error', () => {});
}
function disconnectSocket() { if (socket) { try { socket.disconnect(); } catch {} socket = null; } }

var currentView = 'home';

/* ==========================================================================
 *  EN VIVO (espectador) — LiveKit subscribe + regalos + chat
 * ======================================================================== */
let liveViewRoom = null, currentLiveModel = null, liveGiftsCache = null;
async function watchLive(arg) {
  if (!isAuthed) { requireAuth(); return; }
  const [modelId, nameEnc] = String(arg).split('|');
  const name = decodeURIComponent(nameEnc || 'Transmisión');
  if (!window.LivekitClient) { toast('El módulo de video no cargó'); return; }
  try {
    const { url, token } = await LatidoAPI.liveWatch(modelId);
    currentLiveModel = modelId;
    $('liveModelName').textContent = name; $('liveChatBox').innerHTML = ''; $('liveViewers').textContent = '👁 0';
    $('live').style.display = 'flex';
    liveViewRoom = new LivekitClient.Room({ adaptiveStream: true });
    liveViewRoom.on(LivekitClient.RoomEvent.TrackSubscribed, (track) => { if (track.kind === 'video' || track.kind === 'audio') track.attach($('liveRemote')); });
    await liveViewRoom.connect(url, token);
    if (socket) socket.emit('live:join', { modelId });
    renderLiveGiftBar();
  } catch (e) {
    $('live').style.display = 'none';
    toast(e.data?.error === 'not_live' ? 'La creadora ya no está en vivo' : e.data?.error === 'model_not_found' ? 'No disponible' : 'No se pudo unir a la transmisión');
  }
}
function leaveLive() {
  if (privateCallId) { endPrivate(); return; }
  if (liveViewRoom) { try { liveViewRoom.disconnect(); } catch {} liveViewRoom = null; }
  if (socket && currentLiveModel) socket.emit('live:leave', { modelId: currentLiveModel });
  currentLiveModel = null; const r = $('liveRemote'); if (r) r.srcObject = null; $('live').style.display = 'none';
}
async function renderLiveGiftBar() {
  const bar = $('liveGiftBar'); if (!bar) return;
  try {
    if (!liveGiftsCache) liveGiftsCache = (await LatidoAPI.liveGifts()).items;
    bar.innerHTML = liveGiftsCache.map((g) => `<button data-act="liveGift" data-arg="${g.id}" style="flex-shrink:0;background:rgba(255,255,255,.14);border:none;border-radius:12px;padding:8px 12px;color:#fff;cursor:pointer;text-align:center">
      <div style="font-size:1.3rem">${g.emoji}</div><div style="font-size:.68rem">💎${g.cost_diamonds}</div></button>`).join('');
  } catch {}
}
function liveGift(giftId) {
  if (!socket) return;
  if (privateCallId) { socket.emit('private:gift', { callId: privateCallId, giftId }, (ack) => { if (ack && ack.ok) { if (currentUser) { currentUser.diamonds = ack.diamonds; updateAuthUI(); } } else toast(ack && ack.error === 'insufficient_diamonds' ? 'No tienes suficientes 💎' : 'No se pudo enviar'); }); return; }
  if (!currentLiveModel) return;
  socket.emit('live:gift', { modelId: currentLiveModel, giftId }, (ack) => {
    if (ack && ack.ok) { if (currentUser) { currentUser.diamonds = ack.diamonds; updateAuthUI(); } }
    else toast(ack && ack.error === 'insufficient_diamonds' ? 'No tienes suficientes 💎' : 'No se pudo enviar el regalo');
  });
}
function liveSendChat() {
  const i = $('liveChatInput'); const t = i.value.trim(); if (!t || !socket) return;
  if (privateCallId) { socket.emit('private:chat', { callId: privateCallId, text: t }, () => {}); appendLiveChat(currentUser ? currentUser.displayName : 'Tú', t, true); i.value = ''; return; }
  if (!currentLiveModel) return;
  socket.emit('live:chat', { modelId: currentLiveModel, text: t });
  appendLiveChat(currentUser ? currentUser.displayName : 'Tú', t, true); i.value = '';
}
function appendLiveChat(who, text, mine) {
  const box = $('liveChatBox'); if (!box) return;
  const d = document.createElement('div'); d.style.cssText = 'background:rgba(0,0,0,.45);color:#fff;padding:6px 10px;border-radius:12px;font-size:.82rem;width:fit-content;max-width:100%';
  d.innerHTML = `<b style="color:${mine ? '#ff7ab0' : '#7ad0ff'}">${escapeHtml(who)}:</b> ${escapeHtml(text)}`;
  box.appendChild(d); box.scrollTop = box.scrollHeight; while (box.children.length > 40) box.removeChild(box.firstChild);
}
function flyGift(emoji) {
  const z = $('liveFly'); if (!z) return;
  const g = document.createElement('div'); g.textContent = emoji;
  g.style.cssText = `position:absolute;bottom:0;left:${10 + (seedFromId(String(galleryItems.length + Date.now() % 100)) % 70)}%;font-size:2.4rem;transition:transform 2.4s ease-out, opacity 2.4s;`;
  z.appendChild(g); requestAnimationFrame(() => { g.style.transform = 'translateY(-260px) scale(1.4)'; g.style.opacity = '0'; }); setTimeout(() => g.remove(), 2500);
}

/* ---- Sala privada (lado espectador) ---- */
let privateRoom = null, privateCallId = null, privCamOn = false, privMicOn = false, privTimerInt = null, privStartTs = 0;
function requestPrivate() {
  if (!socket || !currentLiveModel) return;
  socket.emit('private:request', { modelId: currentLiveModel }, (ack) => {
    if (ack && ack.ok) { toast('Solicitud de privado enviada… espera a la creadora'); return; }
    if (ack && ack.error === 'insufficient_diamonds') { toast(`Necesitas ${ack.price}💎 para el privado. Recarga en Billetera 💎`); setTimeout(() => { leaveLive(); go('wallet'); }, 1400); }
    else toast(ack && ack.error === 'calls_disabled' ? 'La creadora no acepta privados' : 'No se pudo solicitar');
  });
}
async function enterPrivate(url, token, price) {
  if (!window.LivekitClient) return;
  $('live').style.display = 'flex';
  try {
    privateRoom = new LivekitClient.Room({ adaptiveStream: true });
    privateRoom.on(LivekitClient.RoomEvent.TrackSubscribed, (track) => { if (track.kind === 'video' || track.kind === 'audio') track.attach($('liveRemote')); });
    privateRoom.on(LivekitClient.RoomEvent.Disconnected, () => { teardownPrivate(); });
    await privateRoom.connect(url, token);
    privCamOn = false; privMicOn = false; refreshPrivToggleBtns();
    if ($('liveBadge')) $('liveBadge').style.display = 'none';
    if ($('privBadge')) $('privBadge').style.display = '';
    if ($('privRate')) $('privRate').textContent = (price != null ? price : '0');
    if ($('livePrivControls')) $('livePrivControls').style.display = 'flex';
    if ($('liveChatBox')) { $('liveChatBox').style.bottom = '212px'; $('liveChatBox').style.zIndex = '4'; }
    if ($('liveFly')) $('liveFly').style.bottom = '212px';
    if ($('livePrivSelf')) $('livePrivSelf').style.bottom = '212px';
    const pb = $('privBtn'); if (pb) { pb.textContent = '⏹ Salir privado'; pb.setAttribute('data-act', 'endPrivate'); }
    startPrivTimer(); toast('🔒 Sala privada iniciada');
  } catch (e) { toast('No se pudo entrar al privado'); }
}
function refreshPrivToggleBtns() {
  const cb = $('livCamBtn'); if (cb) { cb.textContent = privCamOn ? '📷 Cámara: on' : '📷 Cámara: off'; cb.style.background = privCamOn ? 'var(--grad)' : 'rgba(255,255,255,.15)'; }
  const mb = $('livMicBtn'); if (mb) { mb.textContent = privMicOn ? '🎤 Micro: on' : '🎤 Micro: off'; mb.style.background = privMicOn ? 'var(--grad)' : 'rgba(255,255,255,.15)'; }
}
async function liveTogglePrivCam() {
  if (!privateRoom) return;
  try { privCamOn = !privCamOn; await privateRoom.localParticipant.setCameraEnabled(privCamOn);
    const sv = $('livePrivSelf');
    if (privCamOn) { const cam = [...privateRoom.localParticipant.videoTrackPublications.values()][0]; if (cam && cam.track && sv) { cam.track.attach(sv); sv.style.display = ''; } }
    else if (sv) { sv.srcObject = null; sv.style.display = 'none'; }
    refreshPrivToggleBtns();
  } catch { privCamOn = !privCamOn; toast('No se pudo cambiar la cámara'); }
}
async function liveTogglePrivMic() {
  if (!privateRoom) return;
  try { privMicOn = !privMicOn; await privateRoom.localParticipant.setMicrophoneEnabled(privMicOn); refreshPrivToggleBtns(); } catch { privMicOn = !privMicOn; }
}
function startPrivTimer() {
  privStartTs = Date.now(); const el = $('privTimer'); if (el) el.style.display = '';
  if (privTimerInt) clearInterval(privTimerInt);
  const tick = () => { if (!el) return; const s = Math.floor((Date.now() - privStartTs) / 1000); el.textContent = '⏱ ' + Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  tick(); privTimerInt = setInterval(tick, 1000);
}
function endPrivate() { if (socket && privateCallId) socket.emit('private:end', { callId: privateCallId }); teardownPrivate(); }
function teardownPrivate() {
  if (privateRoom) { try { privateRoom.disconnect(); } catch {} privateRoom = null; }
  privateCallId = null; privCamOn = false; privMicOn = false;
  if (privTimerInt) { clearInterval(privTimerInt); privTimerInt = null; }
  const sv = $('livePrivSelf'); if (sv) { sv.srcObject = null; sv.style.display = 'none'; sv.style.bottom = '150px'; }
  if ($('livePrivControls')) $('livePrivControls').style.display = 'none';
  if ($('privBadge')) $('privBadge').style.display = 'none';
  if ($('privTimer')) $('privTimer').style.display = 'none';
  if ($('liveBadge')) $('liveBadge').style.display = currentLiveModel ? '' : 'none';
  if ($('liveChatBox')) { $('liveChatBox').style.bottom = '140px'; $('liveChatBox').style.zIndex = '2'; }
  if ($('liveFly')) $('liveFly').style.bottom = '150px';
  const pb = $('privBtn'); if (pb) { pb.textContent = '💎 Privado'; pb.setAttribute('data-act', 'requestPrivate'); }
  if (!liveViewRoom) { const r = $('liveRemote'); if (r) r.srcObject = null; $('live').style.display = 'none'; }
}

/* ==========================================================================
 *  ESTUDIO DE CREADORA — conectado a API
 * ======================================================================== */
let studioMainTab = 'content';  // 'content' | 'albums'
let studioContentFilter = 'all';

async function loadStudio() {
  const c = $('studio'); if (!c) return;
  c.innerHTML = `<div class="topbar"><div class="logo">Estudio</div></div><div style="padding:30px;text-align:center;color:var(--muted)">Cargando…</div>`;
  let me = currentUser; try { me = await LatidoAPI.getMe(); currentUser = me; } catch {}
  const wrap = (inner) => `<div class="topbar"><div class="logo">Estudio de creadora</div></div><div style="padding:22px;max-width:460px;margin:0 auto">${inner}</div>`;
  if (me && (me.role === 'model' || me.role === 'admin')) {
    c.innerHTML = wrap(`<div style="background:var(--bg-2,#171019);border:1px solid var(--border-2,#2a1f2e);border-radius:16px;padding:24px;text-align:center">
      <div style="font-size:2rem">🎬</div><h3 style="margin:8px 0">Ya eres creadora</h3>
      <p style="color:var(--muted);font-size:.88rem">Gestiona tu contenido, transmisiones en vivo, salas privadas y finanzas en tu consola web.</p>
      <a class="btn btn-grad" href="/estudio/" style="display:inline-block;margin-top:12px;text-decoration:none;padding:12px 20px;border-radius:12px">Abrir mi Estudio →</a></div>`);
    return;
  }
  c.innerHTML = wrap(`<div style="background:var(--bg-2,#171019);border:1px solid var(--border-2,#2a1f2e);border-radius:16px;padding:24px">
    <div style="font-size:2rem;text-align:center">✨</div><h3 style="margin:8px 0;text-align:center">Conviértete en creadora</h3>
    <p style="color:var(--muted);font-size:.86rem">Elige tu nombre de usuario público (handle). Podrás publicar contenido, transmitir en vivo y recibir regalos y suscripciones.</p>
    <label class="lbl">Handle (solo letras, números y _)</label>
    <input class="field" id="bcHandle" placeholder="ej: valentina23" />
    <button class="btn btn-grad" data-act="becomeCreator" style="width:100%;margin-top:10px">Crear mi perfil de creadora</button>
  </div>`);
}
async function becomeCreator() {
  const handle = ($('bcHandle') && $('bcHandle').value.trim().toLowerCase()) || '';
  if (!/^[a-z0-9_]{3,30}$/.test(handle)) { toast('Handle inválido (3-30, letras/números/_)'); return; }
  try {
    const r = await LatidoAPI.becomeModel({ handle });
    if (r.accessToken) { LatidoAPI.token.set(r.accessToken); currentUser = await LatidoAPI.getMe().catch(() => currentUser); }
    renderKycForm();
  } catch (e) { toast(e.data?.error === 'handle_taken' ? 'Ese handle ya está tomado' : 'No se pudo crear el perfil'); }
}
function renderKycForm() {
  const c = $('studio'); if (!c) return;
  c.innerHTML = `<div class="topbar"><div class="logo">Verifica tu identidad</div></div><div style="padding:22px;max-width:460px;margin:0 auto">
    <div style="background:var(--bg-2,#171019);border:1px solid var(--border-2,#2a1f2e);border-radius:16px;padding:24px">
      <div style="font-size:2rem;text-align:center">🪪</div><h3 style="margin:8px 0;text-align:center">Verificación (KYC)</h3>
      <p style="color:var(--muted);font-size:.84rem">Obligatorio para publicar y transmitir (mayoría de edad, cumplimiento 2257 / Ley 1581).</p>
      <label class="lbl">Nombre completo</label><input class="field" id="kycName" placeholder="Como en tu documento" />
      <label class="lbl">Tipo de documento</label>
      <select class="field" id="kycType"><option value="cc">Cédula de ciudadanía</option><option value="ce">Cédula de extranjería</option><option value="passport">Pasaporte</option></select>
      <label class="lbl">Número de documento</label><input class="field" id="kycNum" placeholder="Número" />
      <button class="btn btn-grad" data-act="submitKyc" style="width:100%;margin-top:10px">Enviar verificación</button>
    </div></div>`;
}
async function submitKyc() {
  const fullName = ($('kycName') && $('kycName').value.trim()) || '';
  const documentType = ($('kycType') && $('kycType').value) || 'cc';
  const documentNumber = ($('kycNum') && $('kycNum').value.trim()) || '';
  if (fullName.length < 3 || documentNumber.length < 5) { toast('Completa nombre y documento'); return; }
  try {
    const r = await LatidoAPI.submitKyc({ fullName, documentType, documentNumber });
    if (r.status === 'approved') { toast('¡Identidad verificada! ✓'); loadStudio(); }
    else if (r.status === 'rejected') { toast('Verificación rechazada: ' + (r.reason || '')); }
    else { toast('Verificación en revisión'); loadStudio(); }
  } catch (e) { toast(e.data?.error === 'kyc_already_submitted' ? 'Ya enviaste tu verificación' : 'No se pudo enviar (revisa el documento)'); }
}
async function loadStudioLegacy() {
  await Promise.all([loadStudioEarnings(), loadStudioStats(), loadStudioContent()]);
}

async function loadStudioEarnings() {
  try {
    const d = await LatidoAPI.studioEarnings();
    const month = (d.monthly && d.monthly[0]) || {};
    const total = Number(month.total || 0);
    if ($('stEarnings')) $('stEarnings').textContent = '$' + fmtCop(total);
    if ($('stBalance'))  $('stBalance').textContent  = 'Balance disponible: $' + fmtCop(d.balance);
  } catch {}
}

async function loadStudioStats() {
  try {
    const s = await LatidoAPI.studioStats();
    if ($('stSubs'))    $('stSubs').textContent    = s.active_subs || 0;
    if ($('stPhotos2')) $('stPhotos2').textContent = s.photos || 0;
    if ($('stVideos2')) $('stVideos2').textContent = s.videos || 0;
    if ($('stRating'))  $('stRating').textContent  = Number(s.rating || 0).toFixed(1) + '★';
  } catch {}
}

async function loadStudioContent(filter) {
  if (filter) studioContentFilter = filter;
  const el = $('studioList'); if (!el) return;
  el.innerHTML = '<div style="text-align:center;color:var(--muted);padding:30px">Cargando…</div>';
  try {
    const params = { limit: 30 };
    if (studioContentFilter && studioContentFilter !== 'all') params.type = studioContentFilter;
    const { items } = await LatidoAPI.studioContent(params);
    if (!items.length) { el.innerHTML = '<div style="text-align:center;color:var(--muted);padding:30px">Sin contenido aún</div>'; return; }
    el.innerHTML = items.map((c, i) => {
      const ic = c.media_type === 'video' ? '🎬' : '🖼️';
      const pill = c.status === 'published' ? '<span class="pill pub">PUBLICADO</span>' : '<span class="pill draft">BORRADOR</span>';
      const info = `${c.views_count || 0} vistas · ${c.likes_count || 0} likes${c.album_name ? ' · 📁 '+c.album_name : ''}`;
      return `<div class="content-row">
        <div class="cthumb ${gradFor(i, i)}">${ic}</div>
        <div class="cinfo"><b>${c.caption || (c.media_type === 'video' ? 'Video' : 'Foto')}</b><div>${info}</div>
          <div style="font-size:.68rem;color:var(--muted)">${new Date(c.created_at).toLocaleDateString('es-CO')}</div></div>
        <div style="display:flex;flex-direction:column;gap:4px;align-items:flex-end">
          ${pill}
          <button class="btn btn-ghost btn-sm" style="padding:4px 8px;font-size:.7rem" data-act="studioDeleteContent" data-arg="${c.id}">🗑</button>
        </div>
      </div>`;
    }).join('');
  } catch { el.innerHTML = '<div style="text-align:center;color:var(--muted);padding:30px">Error al cargar</div>'; }
}

async function studioDeleteContent(id) {
  if (!confirm('¿Eliminar este contenido?')) return;
  try { await LatidoAPI.studioDeleteContent(id); toast('Eliminado ✓'); loadStudioContent(); }
  catch { toast('Error al eliminar'); }
}

async function loadStudioAlbums() {
  const el = $('studioAlbumList'); if (!el) return;
  el.innerHTML = '<div style="text-align:center;color:var(--muted);padding:30px">Cargando…</div>';
  try {
    const { items } = await LatidoAPI.studioAlbums();
    if (!items.length) { el.innerHTML = '<div style="text-align:center;color:var(--muted);padding:30px">Sin álbumes. Crea uno.</div>'; return; }
    el.innerHTML = items.map(a => `
      <div class="content-row">
        <div class="cthumb g4">🗂️</div>
        <div class="cinfo"><b>${a.name}</b><div>${a.item_count} elementos · ${a.is_public ? 'Público' : 'Privado'}</div></div>
        <div style="display:flex;gap:6px">
          <button class="btn btn-ghost btn-sm" data-act="studioEditAlbum" data-arg="${a.id}|${encodeURIComponent(a.name)}|${encodeURIComponent(a.description||'')}|${a.is_public}">✏️</button>
          <button class="btn btn-ghost btn-sm" data-act="studioDeleteAlbum" data-arg="${a.id}">🗑</button>
        </div>
      </div>`).join('');
  } catch { el.innerHTML = '<div style="text-align:center;color:var(--muted);padding:30px">Error</div>'; }
}

function studioTab(a, btn) {
  studioMainTab = a;
  document.querySelectorAll('#studio > .seg > button').forEach(b => b.classList.remove('on'));
  if (btn) btn.classList.add('on');
  const cp = $('studioContentPanel'), ap = $('studioAlbumsPanel');
  if (cp) cp.style.display = a === 'content' ? '' : 'none';
  if (ap) ap.style.display = a === 'albums'  ? '' : 'none';
  if (a === 'albums') loadStudioAlbums();
  else loadStudioContent();
}

function studioFilter(a, btn) {
  document.querySelectorAll('#studioContentPanel > .seg > button').forEach(b => b.classList.remove('on'));
  if (btn) btn.classList.add('on');
  loadStudioContent(a);
}

function studioNewAlbum() {
  const mid = $('albumModalId'); if (mid) mid.value = '';
  const mt = $('albumModalTitle'); if (mt) mt.textContent = 'Nuevo álbum';
  const mn = $('albumName'); if (mn) mn.value = '';
  const md = $('albumDesc'); if (md) md.value = '';
  const mp = $('albumPublic'); if (mp) mp.checked = true;
  const m = $('albumModal'); if (m) m.style.display = 'flex';
}

function studioEditAlbum(arg) {
  const [id, name, desc, pub] = arg.split('|');
  $('albumModalId').value = id;
  $('albumModalTitle').textContent = 'Editar álbum';
  $('albumName').value = decodeURIComponent(name);
  $('albumDesc').value = decodeURIComponent(desc);
  $('albumPublic').checked = pub === 'true';
  const m = $('albumModal'); if (m) m.style.display = 'flex';
}

function hideAlbumModal() { const m = $('albumModal'); if (m) m.style.display = 'none'; }

async function submitAlbum() {
  const name = val('albumName');
  if (!name) { toast('El nombre es obligatorio'); return; }
  const data = {
    name,
    description: $('albumDesc')?.value?.trim() || undefined,
    isPublic: $('albumPublic')?.checked !== false,
  };
  const id = val('albumModalId');
  try {
    if (id) { await LatidoAPI.studioUpdateAlbum(id, data); toast('Álbum actualizado ✓'); }
    else    { await LatidoAPI.studioCreateAlbum(data);      toast('Álbum creado ✓'); }
    hideAlbumModal(); loadStudioAlbums();
  } catch { toast('Error al guardar álbum'); }
}

async function studioDeleteAlbum(id) {
  if (!confirm('¿Eliminar álbum? El contenido no se borrará.')) return;
  try { await LatidoAPI.studioDeleteAlbum(id); toast('Álbum eliminado ✓'); loadStudioAlbums(); }
  catch { toast('Error'); }
}

// Subida de contenido al studio
function triggerStudioPick() { const f = $('studioFileInput'); if (f) f.click(); }

async function studioFileSelected() {
  const f = $('studioFileInput'); if (!f || !f.files[0]) return;
  const file = f.files[0];
  const allowed = ['image/jpeg','image/png','image/webp','video/mp4','video/webm','video/quicktime'];
  if (!allowed.includes(file.type)) { toast('Tipo de archivo no permitido'); return; }
  const maxMB = file.type.startsWith('video') ? 500 : 20;
  if (file.size > maxMB * 1024 * 1024) { toast(`Máximo ${maxMB} MB`); return; }

  const prog = $('studioUploadProgress'), bar = $('studioProgressBar'), txt = $('studioProgressTxt');
  if (prog) prog.style.display = '';

  try {
    const { uploadUrl, key } = await LatidoAPI.studioUploadUrl(file.type);
    await LatidoAPI.uploadToMinio(uploadUrl, file, (pct) => {
      if (bar) bar.style.width = (pct * 100).toFixed(0) + '%';
      if (txt) txt.textContent = (pct * 100).toFixed(0) + '%';
    });
    await LatidoAPI.studioPublishContent({ mediaType: file.type.startsWith('video') ? 'video' : 'photo', originalKey: key });
    if (prog) prog.style.display = 'none';
    if (bar) bar.style.width = '0%';
    f.value = '';
    toast('Contenido publicado ✓'); loadStudioContent();
  } catch (e) {
    if (prog) prog.style.display = 'none';
    toast('Error al subir: ' + (e.message || 'desconocido'));
  }
}

/* ==========================================================================
 *  AVATAR — subida directa a MinIO
 * ======================================================================== */
function triggerAvatarPick() { const f = $('avatarFileInput'); if (f) f.click(); }

async function avatarFileSelected() {
  const f = $('avatarFileInput'); if (!f || !f.files[0]) return;
  const file = f.files[0];
  if (!['image/jpeg','image/png','image/webp'].includes(file.type)) { toast('Solo JPG, PNG o WebP'); return; }
  if (file.size > 5 * 1024 * 1024) { toast('Máximo 5 MB'); return; }
  const prog = $('avatarUploadProgress'), pct = $('avatarPct');
  if (prog) prog.style.display = '';
  try {
    const { url, key } = await LatidoAPI.getAvatarUploadUrl(file.type);
    await LatidoAPI.uploadToMinio(url, file, (p) => { if (pct) pct.textContent = (p * 100).toFixed(0) + '%'; });
    const { avatarUrl } = await LatidoAPI.updateAvatar(key);
    // Actualizar avatar en pantalla
    const av = $('profileAv');
    if (av && avatarUrl) {
      av.style.backgroundImage = `url(${avatarUrl})`;
      av.style.backgroundSize = 'cover';
      av.style.backgroundPosition = 'center';
      const ltr = $('profileAvLetter');
      if (ltr) ltr.textContent = '';
    }
    if (prog) prog.style.display = 'none';
    if (currentUser) currentUser.avatarKey = key;
    f.value = '';
    toast('Foto actualizada ✓');
  } catch (e) {
    if (prog) prog.style.display = 'none';
    toast('Error al subir foto');
  }
}

/* ==========================================================================
 *  CIERRE DE CUENTA
 * ======================================================================== */
function showClosureModal() {
  const m = $('closureModal'); if (m) m.style.display = 'flex';
  if ($('closureReason')) $('closureReason').value = '';
  if ($('closureConfirm')) $('closureConfirm').checked = false;
}
function hideClosureModal() { const m = $('closureModal'); if (m) m.style.display = 'none'; }

async function submitClosure() {
  const reason  = $('closureReason')?.value?.trim();
  const confirm = $('closureConfirm')?.checked;
  if (!reason || reason.length < 5) { toast('Indica el motivo del cierre (mínimo 5 caracteres)'); return; }
  if (!confirm) { toast('Debes marcar que entiendes la eliminación permanente'); return; }
  try {
    const r = await LatidoAPI.closeAccount(reason);
    hideClosureModal();
    const sched = new Date(r.scheduledAt).toLocaleDateString('es-CO');
    toast(`Cuenta en proceso de cierre. Eliminación: ${sched}`);
    if (currentUser) currentUser.status = 'pending_deletion';
    // Actualizar UI de seguridad
    const cs = $('closureStatus');
    if (cs) { cs.style.display = ''; cs.textContent = `⚠️ Cuenta pendiente de eliminación el ${sched}. Puedes cancelar antes de esa fecha.`; }
    if ($('btnCloseAccount')) $('btnCloseAccount').style.display = 'none';
    if ($('btnCancelClosure')) $('btnCancelClosure').style.display = '';
  } catch (e) {
    const msg = { no_pending_request_or_expired: 'No hay solicitud pendiente' };
    toast(msg[e.data?.error] || 'Error al cerrar cuenta');
  }
}

async function cancelClosure() {
  try {
    await LatidoAPI.cancelAccountClosure();
    toast('Cierre de cuenta cancelado ✓');
    if (currentUser) currentUser.status = 'active';
    const cs = $('closureStatus'); if (cs) cs.style.display = 'none';
    if ($('btnCloseAccount'))  $('btnCloseAccount').style.display = '';
    if ($('btnCancelClosure')) $('btnCancelClosure').style.display = 'none';
  } catch { toast('Error al cancelar'); }
}

/* ==========================================================================
 *  PERFIL PROPIO — conectado a API
 * ======================================================================== */
async function loadProfile() {
  try {
    currentUser = await LatidoAPI.getMe();
    const u = currentUser;
    const av = $('profileAv'), nm = $('profileName'), em = $('profileEmail'), bg = $('profileBadges');
    if (av) {
      const ltr = $('profileAvLetter');
      if (u.avatarUrl) {
        av.style.backgroundImage = `url(${u.avatarUrl})`;
        av.style.backgroundSize  = 'cover';
        av.style.backgroundPosition = 'center';
        if (ltr) ltr.textContent = '';
      } else {
        av.style.backgroundImage = '';
        if (ltr) ltr.textContent = avatarLetter(u.displayName);
      }
    }
    if (nm) nm.textContent = u.displayName || '—';
    if (em) em.textContent = u.email || u.phone || '';
    if (bg) {
      const badges = [];
      if (u.isVerified) badges.push('<span class="status-badge active">✔ Verificado</span>');
      badges.push(`<span class="role-badge">${u.role}</span>`);
      badges.push(`<span class="status-badge ${u.status}">${u.status}</span>`);
      bg.innerHTML = badges.join('');
    }
    if ($('pfName'))      $('pfName').value      = u.displayName || '';
    if ($('pfCity'))      $('pfCity').value      = u.city || '';
    if ($('pfBio'))       $('pfBio').value       = u.bio || '';
    if ($('pfInterests')) $('pfInterests').value = (u.interests || []).join(', ');
    // Mostrar estado de cierre de cuenta si aplica
    const isPendingDel = u.status === 'pending_deletion';
    const cs = $('closureStatus');
    if (cs) { cs.style.display = isPendingDel ? '' : 'none'; cs.textContent = isPendingDel ? '⚠️ Cuenta pendiente de eliminación. Tienes 15 días para cancelar.' : ''; }
    if ($('btnCloseAccount'))  $('btnCloseAccount').style.display  = isPendingDel ? 'none' : '';
    if ($('btnCancelClosure')) $('btnCancelClosure').style.display = isPendingDel ? '' : 'none';
  } catch (e) { toast('No se pudo cargar el perfil'); }
}

async function saveProfile() {
  try {
    const data = {};
    const name = val('pfName'), city = val('pfCity'), bio = $('pfBio') ? $('pfBio').value.trim() : '';
    const interests = val('pfInterests').split(',').map(s => s.trim()).filter(Boolean);
    if (name) data.displayName = name;
    if (city !== undefined) data.city = city;
    data.bio = bio;
    data.interests = interests;
    await LatidoAPI.updateMe(data);
    currentUser = null; // invalidar cache
    toast('Perfil guardado ✓');
  } catch (e) { toast('Error al guardar'); }
}

function profileTab(tab) {
  document.querySelectorAll('.profile-tab').forEach(t => t.classList.toggle('on', t.dataset.arg === tab));
  ['edit','security','notifs'].forEach(k => {
    const el = $(`pf${k.charAt(0).toUpperCase() + k.slice(1)}`);
    if (el) el.classList.toggle('hidden', k !== tab);
  });
  if (tab === 'security') loadSessions();
  if (tab === 'notifs')   loadNotifs();
}

async function changePassword() {
  const cur = $('pwCurrent')?.value?.trim();
  const nw  = $('pwNew')?.value?.trim();
  const cf  = $('pwConfirm')?.value?.trim();
  if (!cur || !nw) { toast('Completa todos los campos'); return; }
  if (nw !== cf)   { toast('Las contraseñas no coinciden'); return; }
  if (nw.length < 10) { toast('Mínimo 10 caracteres'); return; }
  try {
    await LatidoAPI.changePassword(cur, nw);
    $('pwCurrent').value = ''; $('pwNew').value = ''; $('pwConfirm').value = '';
    toast('Contraseña actualizada ✓ Vuelve a iniciar sesión');
    setTimeout(() => profileLogout(), 2000);
  } catch (e) {
    const msg = { bad_credentials: 'Contraseña actual incorrecta', no_password_auth: 'Cuenta sin contraseña (usa Google)' };
    toast(msg[e.data?.error] || 'Error al cambiar contraseña');
  }
}

async function loadSessions() {
  const el = $('sessionsList'); if (!el) return;
  el.innerHTML = '<div style="color:var(--muted);font-size:.8rem;padding:10px 0">Cargando…</div>';
  try {
    const { items } = await LatidoAPI.getSessions();
    if (!items.length) { el.innerHTML = '<div style="color:var(--muted);font-size:.8rem;padding:10px 0">Sin sesiones activas</div>'; return; }
    el.innerHTML = items.map(s => `
      <div class="srow">
        <div><div class="sk">📱 ${(s.device_label || s.user_agent || 'Dispositivo').slice(0,40)}</div>
          <div class="sv">${s.ip || ''} · ${new Date(s.created_at).toLocaleDateString('es-CO')}</div></div>
        <button class="btn btn-ghost btn-sm" style="padding:6px 10px" data-act="revokeSession" data-arg="${s.id}">Cerrar</button>
      </div>`).join('');
  } catch { el.innerHTML = '<div style="color:var(--muted);font-size:.8rem;padding:10px 0">No disponible</div>'; }
}

async function revokeSession(id) {
  try { await LatidoAPI.revokeSession(id); toast('Sesión cerrada'); loadSessions(); }
  catch { toast('Error'); }
}

async function loadNotifs() {
  const el = $('notifsList'); if (!el) return;
  el.innerHTML = '<div style="text-align:center;color:var(--muted);padding:30px">Cargando…</div>';
  try {
    const { items } = await LatidoAPI.getNotifications();
    if (!items.length) { el.innerHTML = '<div style="text-align:center;color:var(--muted);padding:30px">Sin notificaciones</div>'; return; }
    el.innerHTML = items.map(n => `
      <div class="srow" style="align-items:flex-start;gap:12px;padding:12px 0">
        <div style="flex:1">
          <div class="sk" style="font-weight:700">${n.title || n.type}</div>
          <div class="sv">${n.body || ''}</div>
          <div class="sv" style="font-size:.7rem">${new Date(n.created_at).toLocaleString('es-CO')}</div>
        </div>
        ${!n.read_at ? `<button class="btn btn-ghost btn-sm" style="padding:5px 9px;flex-shrink:0" data-act="markNotif" data-arg="${n.id}">✓</button>` : ''}
      </div>`).join('');
  } catch { el.innerHTML = '<div style="text-align:center;color:var(--muted);padding:30px">No disponible</div>'; }
}

async function markNotif(id) {
  try { await LatidoAPI.markNotifRead(id); loadNotifs(); }
  catch { toast('Error'); }
}

/* ==========================================================================
 *  ADMIN PANEL
 * ======================================================================== */
function fmtCop2(n) { return '$' + Number(n || 0).toLocaleString('es-CO'); }

function admTab(tab) {
  admCurrentTab = tab;
  document.querySelectorAll('.adm-tab').forEach(t => t.classList.toggle('on', t.dataset.arg === tab));
  const panels = { dash: 'admDash', users: 'admUsers', kyc: 'admKyc', reports: 'admReports', audit: 'admAudit', settings: 'admSettings' };
  Object.entries(panels).forEach(([k, id]) => { const el = $(id); if (el) el.style.display = k === tab ? '' : 'none'; });
  if ($('admUserDetail')) $('admUserDetail').style.display = 'none';
  if (tab === 'dash')     loadAdmDashboard();
  if (tab === 'users')    loadAdmUsers();
  if (tab === 'kyc')      loadAdmKyc();
  if (tab === 'reports')  loadAdmReports();
  if (tab === 'audit')    loadAdmAudit();
  if (tab === 'settings') loadAdmSettings();
}

async function loadAdmDashboard() {
  try {
    const d = await LatidoAPI.adminDashboard();
    const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
    set('kpiUsers', d.users);
    set('kpiModels', d.models);
    set('kpiSubs', d.activeSubscriptions);
    set('kpiRev', fmtCop2(d.monthRevenueCop));
    set('kpiKyc', d.pendingKyc);
    set('kpiReports', d.openReports);
  } catch { toast('Error cargando dashboard'); }
}

async function loadAdmUsers(q) {
  const list = $('admUserList'); if (!list) return;
  list.innerHTML = '<div style="color:var(--muted);padding:16px 20px">Cargando…</div>';
  try {
    const params = { limit: 30 };
    if (q) params.q = q;
    const { items } = await LatidoAPI.adminUsers(params);
    list.innerHTML = items.map(u => `
      <div class="adm-row" data-act="admOpenUser" data-arg="${u.id}">
        <div class="adm-av ${gradFor(seedFromId(u.id), 0)}">${avatarLetter(u.display_name || u.email)}</div>
        <div class="adm-mid">
          <b>${u.display_name || '(sin nombre)'}</b>
          <span>${u.email || u.phone || ''} · ${u.city || ''}</span>
        </div>
        <div class="adm-end">
          <span class="role-badge">${u.role}</span><br>
          <span class="status-badge ${u.status}" style="margin-top:4px;display:inline-block">${u.status}</span>
        </div>
      </div>`).join('') || '<div style="color:var(--muted);padding:16px 20px">Sin resultados</div>';
  } catch { list.innerHTML = '<div style="color:var(--muted);padding:16px 20px">Error</div>'; }
}

async function admOpenUser(id) {
  admCurrentUserId = id;
  if ($('admUsers'))     $('admUsers').style.display = 'none';
  if ($('admUserDetail'))$('admUserDetail').style.display = '';
  const av = $('duAv'), nm = $('duName'), bg = $('duBadges'), rows = $('duRows'), acts = $('duActions');
  if (nm) nm.textContent = 'Cargando…';
  try {
    const u = await LatidoAPI.adminUser(id);
    if (av) av.textContent = avatarLetter(u.display_name || u.email);
    if (nm) nm.textContent = u.display_name || u.email || id;
    if (bg) bg.innerHTML = `<span class="role-badge">${u.role}</span> <span class="status-badge ${u.status}">${u.status}</span> ${u.is_verified ? '<span class="status-badge active">✔ Verificado</span>' : ''}`;
    if (rows) rows.innerHTML = [
      ['Email', u.email || '—'],
      ['Teléfono', u.phone || '—'],
      ['Ciudad', u.city || '—'],
      ['Registro', u.created_at ? new Date(u.created_at).toLocaleDateString('es-CO') : '—'],
      ['Último acceso', u.last_seen_at ? new Date(u.last_seen_at).toLocaleString('es-CO') : '—'],
      ['Diamantes', (u.diamonds || 0).toLocaleString('es-CO')],
      ['Total pagado', fmtCop2(u.total_paid_cop)],
      ['Suscripciones activas', u.active_subs || 0],
    ].map(([k,v]) => `<div class="detail-row"><span class="dk">${k}</span><span class="dv">${v}</span></div>`).join('');
    if (acts) {
      const isActive = u.status === 'active';
      acts.innerHTML = `
        <button class="btn btn-ok" data-act="admSetStatus" data-arg="${id}|active">✓ Activar</button>
        <button class="btn btn-warn" data-act="admSetStatus" data-arg="${id}|suspended">⏸ Suspender</button>
        <button class="btn btn-danger" data-act="admSetStatus" data-arg="${id}|banned">🚫 Banear</button>
        <button class="btn btn-ghost" data-act="admSetRole" data-arg="${id}|moderator">🛡 Hacer moderador</button>`;
    }
  } catch { if (nm) nm.textContent = 'Error al cargar'; }
}

function admBackToUsers() {
  if ($('admUserDetail')) $('admUserDetail').style.display = 'none';
  if ($('admUsers'))      $('admUsers').style.display = '';
}

async function admSetStatus(arg) {
  const [id, status] = arg.split('|');
  if (!confirm(`¿${status} este usuario?`)) return;
  try {
    await LatidoAPI.adminSetStatus(id, status);
    toast(`Estado cambiado a: ${status}`);
    admOpenUser(id);
  } catch { toast('Error'); }
}

async function admSetRole(arg) {
  const [id, role] = arg.split('|');
  if (!confirm(`¿Asignar rol ${role}?`)) return;
  try {
    await LatidoAPI.adminSetRole(id, role);
    toast(`Rol cambiado a: ${role}`);
    admOpenUser(id);
  } catch { toast('Error'); }
}

async function loadAdmKyc() {
  const list = $('kycList'); if (!list) return;
  list.innerHTML = '<div style="color:var(--muted);padding:16px 20px">Cargando…</div>';
  try {
    const { items } = await LatidoAPI.adminKycQueue();
    if (!items.length) { list.innerHTML = '<div style="color:var(--muted);padding:16px 20px">Cola vacía ✓</div>'; return; }
    list.innerHTML = items.map(k => `
      <div class="kyc-row">
        <div class="adm-av g3">${avatarLetter(k.display_name || k.full_name)}</div>
        <div style="flex:1">
          <b>${k.display_name || k.full_name}</b>
          <div style="font-size:.75rem;color:var(--muted)">${k.email} · ${k.document_type || '—'} · ${k.full_name}</div>
          <div style="font-size:.72rem;color:var(--muted)">Enviado: ${new Date(k.submitted_at).toLocaleDateString('es-CO')} · Face: ${k.face_match_score ?? 'N/A'}</div>
          <div class="kyc-btns">
            <button class="kyc-approve" data-act="admKycDecide" data-arg="${k.id}|approve">✓ Aprobar</button>
            <button class="kyc-reject"  data-act="admKycDecide" data-arg="${k.id}|reject">✗ Rechazar</button>
          </div>
        </div>
        <span class="kyc-status ${k.status}">${k.status}</span>
      </div>`).join('');
  } catch { list.innerHTML = '<div style="color:var(--muted);padding:16px 20px">Error</div>'; }
}

async function admKycDecide(arg) {
  const [id, decision] = arg.split('|');
  const notes = decision === 'reject' ? (prompt('Motivo del rechazo (opcional):') || '') : '';
  try {
    await LatidoAPI.adminKycDecision(id, decision, notes);
    toast(decision === 'approve' ? 'KYC aprobado ✓' : 'KYC rechazado');
    loadAdmKyc();
  } catch { toast('Error'); }
}

async function loadAdmReports() {
  const list = $('reportsList'); if (!list) return;
  list.innerHTML = '<div style="color:var(--muted);padding:16px 20px">Cargando…</div>';
  try {
    const { items } = await LatidoAPI.adminReports('open');
    if (!items.length) { list.innerHTML = '<div style="color:var(--muted);padding:16px 20px">Sin reportes abiertos ✓</div>'; return; }
    list.innerHTML = items.map(r => `
      <div class="adm-row" style="cursor:default;flex-direction:column;align-items:flex-start;gap:6px">
        <div style="display:flex;width:100%;align-items:center;gap:10px">
          <div style="flex:1"><b>${r.reason}</b><div style="font-size:.75rem;color:var(--muted)">${r.details || ''} · ${new Date(r.created_at).toLocaleDateString('es-CO')}</div></div>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-ghost btn-sm" data-act="admResolve" data-arg="${r.id}|warn">Advertir</button>
          <button class="btn btn-warn btn-sm"  data-act="admResolve" data-arg="${r.id}|suspend">Suspender</button>
          <button class="btn btn-danger btn-sm" data-act="admResolve" data-arg="${r.id}|ban">Banear</button>
          <button class="btn btn-ok btn-sm"    data-act="admResolve" data-arg="${r.id}|dismiss">Descartar</button>
        </div>
      </div>`).join('');
  } catch { list.innerHTML = '<div style="color:var(--muted);padding:16px 20px">Error</div>'; }
}

async function admResolve(arg) {
  const [id, action] = arg.split('|');
  const resolution = action === 'dismiss' ? 'Descartado por admin' : prompt('Resolución:') || action;
  try {
    await LatidoAPI.adminResolveReport(id, { resolution, action: action === 'dismiss' ? null : action });
    toast('Reporte resuelto');
    loadAdmReports();
  } catch { toast('Error'); }
}

async function loadAdmAudit() {
  const list = $('auditList'); if (!list) return;
  list.innerHTML = '<div style="color:var(--muted);padding:16px 20px">Cargando…</div>';
  try {
    const { items } = await LatidoAPI.adminAudit({ limit: 40 });
    list.innerHTML = items.map(a => `
      <div class="adm-row" style="cursor:default">
        <div class="adm-mid">
          <b>${a.action}</b>
          <span>${a.actor_name || 'sistema'} · ${a.entity || ''} · ${a.ip || ''}</span>
          <span>${new Date(a.created_at).toLocaleString('es-CO')}</span>
        </div>
      </div>`).join('') || '<div style="color:var(--muted);padding:16px 20px">Sin registros</div>';
  } catch { list.innerHTML = '<div style="color:var(--muted);padding:16px 20px">Error</div>'; }
}

async function loadAdmSettings() {
  const fl = $('flagsList'), sl = $('settingsList');
  if (fl) fl.innerHTML = '<div style="color:var(--muted);padding:8px 20px">Cargando…</div>';
  if (sl) sl.innerHTML = '<div style="color:var(--muted);padding:8px 20px">Cargando…</div>';
  try {
    const [flags, settings] = await Promise.all([LatidoAPI.adminFlags(), LatidoAPI.adminSettings()]);
    if (fl) fl.innerHTML = flags.items.map(f => `
      <div class="srow" style="padding:12px 20px">
        <div><div class="sk">${f.key}</div><div class="sv">Rollout: ${f.rollout_pct}%</div></div>
        <button class="toggle ${f.enabled ? 'on' : ''}" data-act="admToggleFlag" data-arg="${f.key}|${f.enabled}"></button>
      </div>`).join('') || '<div style="color:var(--muted);padding:8px 20px">Sin flags</div>';
    if (sl) sl.innerHTML = settings.items.map(s => `
      <div class="srow" style="padding:12px 20px">
        <div><div class="sk">${s.key}</div><div class="sv">${s.description || ''}</div></div>
        <span class="sv">${JSON.stringify(s.value)}</span>
      </div>`).join('') || '<div style="color:var(--muted);padding:8px 20px">Sin configuración</div>';
  } catch { toast('Error cargando configuración'); }
}

async function admToggleFlag(arg) {
  const [key, cur] = arg.split('|');
  const enabled = cur === 'true' ? false : true;
  try { await LatidoAPI.adminSetFlag(key, enabled, 100); toast(`Flag ${key}: ${enabled ? 'ON' : 'OFF'}`); loadAdmSettings(); }
  catch { toast('Error'); }
}

/* ==========================================================================
 *  TEMA claro/oscuro
 * ======================================================================== */
function applyTheme(light) {
  document.body.classList.toggle('light', light);
  if ($('themeBtn')) $('themeBtn').textContent = light ? '☀️' : '🌙';
  if ($('themeBtnP')) $('themeBtnP').textContent = light ? '☀️ Modo claro' : '🌙 Modo oscuro';
  try { localStorage.setItem('latido-theme', light ? 'light' : 'dark'); } catch {}
}
function toggleTheme() { applyTheme(!document.body.classList.contains('light')); }

/* ==========================================================================
 *  DELEGACIÓN DE EVENTOS (sin handlers inline — compatible con CSP estricto)
 * ======================================================================== */
const ACTIONS = {
  go: (a) => go(a),
  openModel: (a) => openModel(a),
  openConv: (a) => openConv(a),
  chatModel: () => chatWithCurrentModel(),
  leaveModel: () => leaveModel(),
  startCall: () => startCall(),
  tryVideoCall: () => tryVideoCall(),
  toggleTheme: () => toggleTheme(),
  requireAuth: () => requireAuth(),
  loginGoogle: () => loginGoogle(),
  submitAuth: () => submitAuth(),
  toggleAuthMode: () => toggleAuthMode(),
  setSub: (a) => setSub(a === 'true'),
  subscribe: () => subscribe(),
  switchTab: (a) => switchTab(a),
  gift: (a) => { const [e, c] = String(a).split('|'); sendGift(e, Number(c)); },
  toggleDrawer: () => toggleDrawer(),
  endCall: () => endCall(),
  sendMsg: () => sendMsg(),
  mute: (a, el) => el.classList.toggle('off'),
  toast: (a) => toast(a),
  // Galería / lightbox
  cellOpen: (a) => cellOpen(a),
  cellOpenShowcase: (a) => cellOpenShowcase(a),
  closeLightbox: () => closeLightbox(),
  lbPrev: () => lbPrev(),
  lbNext: () => lbNext(),
  // Billetera
  buyPackage: (a) => buyPackage(a),
  cancelSub: (a) => cancelSub(a),
  // En vivo + salas privadas (espectador)
  watchLive: (a) => watchLive(a),
  leaveLive: () => leaveLive(),
  liveGift: (a) => liveGift(a),
  liveSendChat: () => liveSendChat(),
  requestPrivate: () => requestPrivate(),
  endPrivate: () => endPrivate(),
  liveTogglePrivCam: () => liveTogglePrivCam(),
  liveTogglePrivMic: () => liveTogglePrivMic(),
  // Onboarding de creadora
  becomeCreator: () => becomeCreator(),
  submitKyc: () => submitKyc(),
  // Perfil
  profileLogout: () => profileLogout(),
  profileTab: (a) => profileTab(a),
  saveProfile: () => saveProfile(),
  changePassword: () => changePassword(),
  revokeSession: (a) => revokeSession(a),
  markNotif: (a) => markNotif(a),
  // Avatar
  triggerAvatarPick: () => triggerAvatarPick(),
  avatarFileSelected: () => avatarFileSelected(),
  // Cierre de cuenta
  showClosureModal: () => showClosureModal(),
  hideClosureModal: () => hideClosureModal(),
  submitClosure: () => submitClosure(),
  cancelClosure: () => cancelClosure(),
  // Studio
  studioTab: (a, el) => studioTab(a, el),
  studioFilter: (a, el) => studioFilter(a, el),
  studioDeleteContent: (a) => studioDeleteContent(a),
  studioNewAlbum: () => studioNewAlbum(),
  studioEditAlbum: (a) => studioEditAlbum(a),
  hideAlbumModal: () => hideAlbumModal(),
  submitAlbum: () => submitAlbum(),
  studioDeleteAlbum: (a) => studioDeleteAlbum(a),
  triggerStudioPick: () => triggerStudioPick(),
  studioFileSelected: () => studioFileSelected(),
  // Admin
  admTab: (a) => admTab(a),
  admOpenUser: (a) => admOpenUser(a),
  admBackToUsers: () => admBackToUsers(),
  admSetStatus: (a) => admSetStatus(a),
  admSetRole: (a) => admSetRole(a),
  admKycDecide: (a) => admKycDecide(a),
  admResolve: (a) => admResolve(a),
  admToggleFlag: (a) => admToggleFlag(a),
};
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-act]'); if (!t) return;
  const fn = ACTIONS[t.dataset.act];
  if (fn) fn(t.dataset.arg, t);
});

/* ==========================================================================
 *  ARRANQUE
 * ======================================================================== */
(function init() {
  try { if (localStorage.getItem('latido-theme') === 'light') applyTheme(true); } catch {}
  // filtros de la galería
  $('filters').addEventListener('click', (e) => {
    const c = e.target.closest('.chip'); if (!c) return;
    document.querySelectorAll('#filters .chip').forEach((x) => x.classList.remove('on'));
    c.classList.add('on'); currentFilter = c.dataset.f; renderGrid();
  });
  // entradas de texto (antes eran oninput/onkeydown inline)
  const sb = $('search'); if (sb) sb.addEventListener('input', filterModels);
  const mi = $('msgInput'); if (mi) mi.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendMsg(); });
  let admSearchTimer;
  const aq = $('admUserQ');
  if (aq) aq.addEventListener('input', () => { clearTimeout(admSearchTimer); admSearchTimer = setTimeout(() => loadAdmUsers(aq.value.trim()), 300); });
  // File inputs (no pueden tener data-act por cambio no click)
  const af = $('avatarFileInput');
  if (af) af.addEventListener('change', () => avatarFileSelected());
  const sf = $('studioFileInput');
  if (sf) sf.addEventListener('change', () => studioFileSelected());
  // sesión persistida
  isAuthed = LatidoAPI.isAuthed();
  updateAuthUI();
  applyAuthMode();
  // galería pública primero (estilo Tinder/Sugo)
  renderLive(); renderGrid(); renderChats();
  go('home');
})();
