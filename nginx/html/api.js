/* ==========================================================================
 *  Latido — Cliente API (capa de datos, sin lógica de interfaz)
 *  Mismo origen que la PWA (nginx proxica /api -> servicio api).
 * ======================================================================== */
(function (global) {
  const BASE = '/api';
  const TOKEN_KEY = 'latido_token';

  const Token = {
    get() { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } },
    set(t) { try { localStorage.setItem(TOKEN_KEY, t); } catch {} },
    clear() { try { localStorage.removeItem(TOKEN_KEY); } catch {} },
  };

  function qs(p) {
    if (!p) return '';
    const s = Object.entries(p)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v))
      .join('&');
    return s ? '?' + s : '';
  }

  async function request(path, { method = 'GET', body, auth = false } = {}) {
    const headers = {};
    if (body) headers['Content-Type'] = 'application/json';
    if (auth) { const t = Token.get(); if (t) headers['Authorization'] = 'Bearer ' + t; }
    const res = await fetch(BASE + path, {
      method, headers, body: body ? JSON.stringify(body) : undefined,
    });
    let data = {};
    try { data = await res.json(); } catch {}
    if (!res.ok) {
      const e = new Error((data && data.error) || ('http_' + res.status));
      e.status = res.status; e.data = data; throw e;
    }
    return data;
  }

  global.LatidoAPI = {
    token: Token,
    isAuthed() { return !!Token.get(); },

    // Descubrimiento
    listModels(params) { return request('/models' + qs(params), { auth: true }); },
    getModel(handle)   { return request('/models/' + encodeURIComponent(handle), { auth: true }); },

    // Contenido público de una creadora (galería). thumbUrl ya viene borroso/nítido.
    getModelContent(modelId, params) { return request('/content/model/' + modelId + qs(params), { auth: true }); },
    getModelAlbums(modelId)          { return request('/content/model/' + modelId + '/albums', { auth: true }); },
    getMediaUrl(id)                  { return request('/content/media/' + id + '/url', { auth: true }); },

    // Onboarding de creadora
    becomeModel(data) { return request('/models/me', { method: 'POST', body: data, auth: true }); },
    submitKyc(data)   { return request('/models/me/kyc', { method: 'POST', body: data, auth: true }); },

    // En vivo (LiveKit + regalos)
    liveNow()          { return request('/live/now', { auth: true }); },
    liveWatch(modelId) { return request('/live/watch', { method: 'POST', body: { modelId }, auth: true }); },
    liveGifts()        { return request('/live/gifts'); },

    // Pagos / billetera (Wompi)
    getPackages()      { return request('/payments/packages'); },
    getWallet()        { return request('/payments/wallet', { auth: true }); },
    checkout(body)     { return request('/payments/checkout', { method: 'POST', body, auth: true }); },
    getSubscriptions() { return request('/payments/subscriptions', { auth: true }); },
    cancelSubscription(modelId) { return request('/payments/subscriptions/cancel', { method: 'POST', body: { modelId }, auth: true }); },

    // Conversaciones (mensajería cifrada)
    listConversations() { return request('/conversations', { auth: true }); },
    getMessages(convId, params) { return request('/conversations/' + convId + '/messages' + qs(params), { auth: true }); },
    openConversation(otherId)   { return request('/conversations/with/' + otherId, { auth: true }); },
    sendMessage(otherId, message) { return request('/conversations/with/' + otherId + '/messages', { method: 'POST', body: { message }, auth: true }); },

    // Autenticación
    login(identifier, password, totpCode) {
      const body = { identifier, password };
      if (totpCode) body.totpCode = totpCode;
      return request('/auth/login', { method: 'POST', body });
    },
    register(d)                 { return request('/auth/register', { method: 'POST', body: d }); },
    loginGoogle(idToken, birthdate, dataConsent) {
      return request('/auth/google', { method: 'POST', body: { idToken, birthdate, dataConsent } });
    },
    refresh(refreshToken) { return request('/auth/refresh', { method: 'POST', body: { refreshToken } }); },
    logout(refreshToken)  { return request('/auth/logout',  { method: 'POST', body: { refreshToken }, auth: true }); },

    // Perfil propio
    getMe()             { return request('/users/me', { auth: true }); },
    updateMe(data)      { return request('/users/me', { method: 'PATCH', body: data, auth: true }); },
    changePassword(currentPassword, newPassword) {
      return request('/users/me/password', { method: 'POST', body: { currentPassword, newPassword }, auth: true });
    },
    getNotifications()  { return request('/users/me/notifications', { auth: true }); },
    markNotifRead(id)   { return request('/users/me/notifications/' + id + '/read', { method: 'PATCH', auth: true }); },
    getSessions()       { return request('/users/me/sessions', { auth: true }); },
    revokeSession(id)   { return request('/users/me/sessions/' + id, { method: 'DELETE', auth: true }); },

    // Admin
    adminDashboard()    { return request('/admin/dashboard', { auth: true }); },
    adminUsers(params)  { return request('/admin/users' + qs(params), { auth: true }); },
    adminUser(id)       { return request('/admin/users/' + id, { auth: true }); },
    adminSetStatus(id, status, reason) {
      return request('/admin/users/' + id + '/status', { method: 'PATCH', body: { status, reason }, auth: true });
    },
    adminSetRole(id, role) {
      return request('/admin/users/' + id + '/role', { method: 'PATCH', body: { role }, auth: true });
    },
    adminNotify(id, data) {
      return request('/admin/users/' + id + '/notify', { method: 'POST', body: data, auth: true });
    },
    adminKycQueue()     { return request('/admin/kyc/queue', { auth: true }); },
    adminKycDecision(id, decision, notes) {
      return request('/admin/kyc/' + id + '/decision', { method: 'POST', body: { decision, notes }, auth: true });
    },
    adminReports(status) { return request('/admin/reports' + qs({ status }), { auth: true }); },
    adminResolveReport(id, data) {
      return request('/admin/reports/' + id + '/resolve', { method: 'POST', body: data, auth: true });
    },
    adminAudit(params)  { return request('/admin/audit' + qs(params), { auth: true }); },
    adminSettings()     { return request('/admin/settings', { auth: true }); },
    adminSetSetting(key, value) {
      return request('/admin/settings/' + encodeURIComponent(key), { method: 'PUT', body: { value }, auth: true });
    },
    adminFlags()        { return request('/admin/flags', { auth: true }); },
    adminSetFlag(key, enabled, rolloutPct) {
      return request('/admin/flags/' + key, { method: 'PATCH', body: { enabled, rolloutPct }, auth: true });
    },
    adminPayouts(status) { return request('/admin/payouts' + qs({ status }), { auth: true }); },
    adminApprovePayout(id) {
      return request('/admin/payouts/' + id + '/approve', { method: 'POST', body: {}, auth: true });
    },

    // Avatar
    getAvatarUploadUrl(contentType) {
      return request('/users/me/avatar-upload-url' + qs({ contentType }), { auth: true });
    },
    updateAvatar(avatarKey) {
      return request('/users/me/avatar', { method: 'PATCH', body: { avatarKey }, auth: true });
    },

    // Claves E2E
    setPublicKey(jwk, keyVersion) {
      return request('/users/me/public-key', { method: 'POST', body: { jwk, keyVersion }, auth: true });
    },
    getPublicKey(userId) { return request('/users/' + userId + '/public-key', { auth: true }); },

    // Cierre de cuenta
    closeAccount(reason) {
      return request('/users/me/close-account', { method: 'POST', body: { reason, confirm: true }, auth: true });
    },
    cancelAccountClosure() {
      return request('/users/me/close-account', { method: 'DELETE', auth: true });
    },

    // Studio — finanzas y estadísticas
    studioEarnings() { return request('/studio/earnings', { auth: true }); },
    studioStats()    { return request('/studio/stats',    { auth: true }); },

    // Studio — contenido
    studioContent(params) { return request('/studio/content' + qs(params), { auth: true }); },
    studioUploadUrl(contentType) {
      return request('/studio/content/upload-url', { method: 'POST', body: { contentType }, auth: true });
    },
    studioPublishContent(data) {
      return request('/studio/content', { method: 'POST', body: data, auth: true });
    },
    studioUpdateContent(id, data) {
      return request('/studio/content/' + id, { method: 'PATCH', body: data, auth: true });
    },
    studioDeleteContent(id) {
      return request('/studio/content/' + id, { method: 'DELETE', auth: true });
    },
    studioContentUrl(id) { return request('/studio/content/' + id + '/url', { auth: true }); },

    // Studio — álbumes
    studioAlbums()           { return request('/studio/albums', { auth: true }); },
    studioCreateAlbum(data)  { return request('/studio/albums', { method: 'POST', body: data, auth: true }); },
    studioUpdateAlbum(id, d) { return request('/studio/albums/' + id, { method: 'PATCH', body: d, auth: true }); },
    studioDeleteAlbum(id)    { return request('/studio/albums/' + id, { method: 'DELETE', auth: true }); },

    // RTC
    rtcCredentials() { return request('/rtc/credentials', { auth: true }); },

    // Upload directo a MinIO (PUT presignado)
    async uploadToMinio(presignedUrl, file, onProgress) {
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', presignedUrl);
        xhr.setRequestHeader('Content-Type', file.type);
        if (onProgress) xhr.upload.onprogress = e => onProgress(e.loaded / e.total);
        xhr.onload  = () => (xhr.status < 300 ? resolve() : reject(new Error('upload_failed_' + xhr.status)));
        xhr.onerror = () => reject(new Error('upload_network_error'));
        xhr.send(file);
      });
    },
  };
})(window);
