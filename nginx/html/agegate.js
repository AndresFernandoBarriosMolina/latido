/* Gate de edad 18+ para contenido adulto.
   Se ejecuta en <head>: si el visitante ya confirmó, oculta el gate antes de
   pintar (sin parpadeo). Si no, muestra el gate y espera su confirmación.
   Cumple CSP script-src 'self' (archivo propio, sin inline). */
(function () {
  var KEY = 'cs_age_ok_v1';
  try {
    if (localStorage.getItem(KEY) === '1') {
      document.documentElement.setAttribute('data-age', 'ok');
      return;
    }
  } catch (e) { /* almacenamiento bloqueado: se muestra el gate igual */ }

  document.addEventListener('DOMContentLoaded', function () {
    var gate = document.getElementById('ageGate');
    if (!gate) return;
    // Bloquea el scroll del fondo mientras el gate está visible.
    try { document.body.style.overflow = 'hidden'; } catch (e) {}
    var enter = document.getElementById('ageEnter');
    var leave = document.getElementById('ageLeave');
    if (enter) enter.addEventListener('click', function () {
      try { localStorage.setItem(KEY, '1'); } catch (e) {}
      document.documentElement.setAttribute('data-age', 'ok');
      gate.style.display = 'none';
      try { document.body.style.overflow = ''; } catch (e) {}
    });
    if (leave) leave.addEventListener('click', function () {
      window.location.href = 'https://www.google.com';
    });
  });
})();
