/* ══════════════════════════════════════════════════════════════════════
   APPLENDE — Helper universal de autenticación v1.0
   ──────────────────────────────────────────────────────────────────────
   Uso: Incluir DESPUÉS de applende-config.js en cualquier página APPLENDE
   que necesite saber si hay sesión activa y a dónde redirigir al usuario.

   Expone en window.APPLENDE_AUTH:
     - obtenerSesion()          → { user, perfil, rol } o null
     - rutaDashboardPorRol(rol) → string de ruta (ej: '/alumno/dashboard.html')
     - cerrarSesion()           → hace logout y redirige a /login.html
     - iniciarNavAuth(selector) → actualiza un <div id="nav-auth"> con
                                  el botón correcto (login o mi-panel)
   ══════════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  // ─── Cliente Supabase (reutiliza el global) ─────────────────────────
  function obtenerSupabase() {
    if (window.APPLENDE && window.APPLENDE.supabase) {
      return window.APPLENDE.supabase;
    }
    console.warn('[APPLENDE_AUTH] APPLENDE.supabase no disponible');
    return null;
  }

  // ─── Mapa de rol → ruta del dashboard correspondiente ──────────────
  const RUTAS_DASHBOARD = {
    admin:        '/admin/dashboard.html',
    coordinador:  '/coordinador/dashboard.html',
    instructor:   '/alumno/dashboard.html', // fallback: usa alumno hasta tener su panel
    alumno:       '/alumno/dashboard.html'
  };

  function rutaDashboardPorRol(rol) {
    return RUTAS_DASHBOARD[rol] || RUTAS_DASHBOARD.alumno;
  }

  // ─── Obtener sesión actual + perfil con rol ────────────────────────
  async function obtenerSesion() {
    const sb = obtenerSupabase();
    if (!sb) return null;

    try {
      const { data: { session } } = await sb.auth.getSession();
      if (!session || !session.user) return null;

      const userId = session.user.id;

      // Intentar leer el perfil para obtener el rol
      const { data: perfil, error } = await sb
        .from('perfiles')
        .select('nombre, apellido, rol, avatar_url')
        .eq('id', userId)
        .maybeSingle();

      if (error) {
        console.warn('[APPLENDE_AUTH] Error leyendo perfil:', error);
        // Si no podemos leer perfil pero sí hay sesión, asumimos alumno
        return {
          user: session.user,
          perfil: null,
          rol: 'alumno'
        };
      }

      return {
        user: session.user,
        perfil: perfil,
        rol: (perfil && perfil.rol) ? perfil.rol : 'alumno'
      };
    } catch (e) {
      console.error('[APPLENDE_AUTH] Error obteniendo sesión:', e);
      return null;
    }
  }

  // ─── Cerrar sesión ─────────────────────────────────────────────────
  async function cerrarSesion(redirigirA) {
    const sb = obtenerSupabase();
    if (sb) {
      try {
        await sb.auth.signOut();
      } catch (e) {
        console.warn('[APPLENDE_AUTH] Error en signOut:', e);
      }
    }
    window.location.href = redirigirA || '/login.html';
  }

  // ─── Inicializar el nav con el botón adecuado ──────────────────────
  // Busca un elemento con id="nav-auth" y lo reemplaza con:
  //   - Sin sesión  → "🔐 Iniciar sesión"
  //   - Con sesión  → "👤 Mi panel" (va directo al dashboard del rol)
  async function iniciarNavAuth(selector) {
    const el = document.querySelector(selector || '#nav-auth');
    if (!el) return;

    const sesion = await obtenerSesion();

    if (!sesion) {
      // No hay sesión — botón de login
      el.innerHTML = `
        <a href="/login.html" class="nav-auth-btn nav-auth-login">
          <span class="nav-auth-icon">🔐</span>
          <span>Iniciar sesión</span>
        </a>
      `;
    } else {
      // Hay sesión — botón al dashboard + logout
      const ruta = rutaDashboardPorRol(sesion.rol);
      const nombrePersona = (sesion.perfil && sesion.perfil.nombre)
        ? sesion.perfil.nombre.split(' ')[0]
        : 'Mi cuenta';

      el.innerHTML = `
        <a href="${ruta}" class="nav-auth-btn nav-auth-panel">
          <span class="nav-auth-icon">👤</span>
          <span>Mi panel${nombrePersona !== 'Mi cuenta' ? ' · ' + nombrePersona : ''}</span>
        </a>
      `;
    }
  }

  // ─── Exportar a window ─────────────────────────────────────────────
  window.APPLENDE_AUTH = {
    obtenerSesion: obtenerSesion,
    rutaDashboardPorRol: rutaDashboardPorRol,
    cerrarSesion: cerrarSesion,
    iniciarNavAuth: iniciarNavAuth
  };

  // Auto-ejecutar en DOMContentLoaded si existe #nav-auth
  document.addEventListener('DOMContentLoaded', function () {
    if (document.querySelector('#nav-auth')) {
      iniciarNavAuth('#nav-auth');
    }
  });
})();
