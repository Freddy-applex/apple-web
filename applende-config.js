// ═══════════════════════════════════════════════════════════════
// APPLENDE Academia — Configuración central
// ═══════════════════════════════════════════════════════════════
// Este archivo contiene las credenciales y helpers de conexión.
// IMPORTANTE: La publishable key es PÚBLICA por diseño (Supabase la
// valida con Row Level Security). NO es un secreto.
// ═══════════════════════════════════════════════════════════════

const APPLENDE = {
  SUPABASE_URL: 'https://wdoqzsmwuvozhkclqbjk.supabase.co',
  SUPABASE_KEY: 'sb_publishable_YsQshZ_X8aAYIgevuRXESg_al83VtZw',
  
  WHATSAPP_NUMERO: '59164403290',
  WHATSAPP_NOMBRE: 'Arq. Freddy',
  EMAIL_CONTACTO: 'appleconstrucciones.c@gmail.com',
  
  TIPO_CAMBIO_USD: 6.96,
  
  IMAGENES_FALLBACK: {
    'tecnico': 'https://images.unsplash.com/photo-1503387762-592deb58ef4e?auto=format&fit=crop&w=800&q=75',
    'software': 'https://images.unsplash.com/photo-1545239351-1141bd82e8a6?auto=format&fit=crop&w=800&q=75',
    'legal': 'https://images.unsplash.com/photo-1450101499163-c8848c66ca85?auto=format&fit=crop&w=800&q=75'
  }
};

let _supabase = null;

function obtenerSupabase() {
  if (_supabase) return _supabase;
  
  if (typeof supabase === 'undefined' || !supabase.createClient) {
    console.error('[APPLENDE] La librería supabase-js no está cargada. Verificá el <script src="..."> en el HTML.');
    return null;
  }
  
  _supabase = supabase.createClient(APPLENDE.SUPABASE_URL, APPLENDE.SUPABASE_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false
    }
  });
  
  console.log('[APPLENDE] Cliente Supabase inicializado');
  return _supabase;
}

const APPLENDE_DB = {
  
  async listarCursos() {
    const sb = obtenerSupabase();
    if (!sb) return { data: null, error: new Error('Supabase no inicializado') };
    
    const { data, error } = await sb
      .from('v_catalogo_cursos')
      .select('*');
    
    if (error) console.error('[APPLENDE] Error al listar cursos:', error);
    return { data, error };
  },
  
  async obtenerCursoPorSlug(slug) {
    const sb = obtenerSupabase();
    if (!sb) return { data: null, error: new Error('Supabase no inicializado') };
    
    const { data, error } = await sb
      .from('v_catalogo_cursos')
      .select('*')
      .eq('slug', slug)
      .single();
    
    if (error) console.error('[APPLENDE] Error al obtener curso:', error);
    return { data, error };
  },
  
  async listarCohortesAbiertasDeCurso(cursoId) {
    const sb = obtenerSupabase();
    if (!sb) return { data: null, error: new Error('Supabase no inicializado') };
    
    const { data, error } = await sb
      .from('cohortes')
      .select('*')
      .eq('curso_id', cursoId)
      .in('estado', ['inscripciones_abiertas', 'en_curso'])
      .order('fecha_inicio', { ascending: true, nullsFirst: false });
    
    if (error) console.error('[APPLENDE] Error al listar cohortes:', error);
    return { data, error };
  },
  
  async crearInscripcion(datos) {
    const sb = obtenerSupabase();
    if (!sb) return { data: null, error: new Error('Supabase no inicializado') };
    
    const { data, error } = await sb
      .from('inscripciones')
      .insert([{
        alumno_id: datos.alumno_id,
        cohorte_id: datos.cohorte_id,
        curso_id: datos.curso_id,
        precio_pagado: datos.precio_pagado,
        moneda_pago: datos.moneda_pago || 'BOB',
        pais_alumno: datos.pais_alumno || 'BO',
        metodo_pago: datos.metodo_pago || 'qr_manual',
        estado_pago: 'pendiente',
        acceso_activo: false
      }])
      .select()
      .single();
    
    if (error) console.error('[APPLENDE] Error al crear inscripción:', error);
    return { data, error };
  }
};

const APPLENDE_UI = {
  
  formatearPrecio(precioBs, precioOriginalBs) {
    const precio = Math.round(precioBs);
    const original = precioOriginalBs ? Math.round(precioOriginalBs) : null;
    let pctDescuento = null;
    if (original && original > precio) {
      pctDescuento = Math.round(((original - precio) / original) * 100);
    }
    return { precio, original, pctDescuento };
  },
  
  formatearFechaCohorte(fechaISO) {
    if (!fechaISO) return null;
    const f = new Date(fechaISO);
    const fecha = f.toLocaleDateString('es-BO', { day: 'numeric', month: 'long', year: 'numeric' });
    const hora = f.toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' });
    return { fecha, hora, completo: fecha + ' · ' + hora };
  },
  
  imagenCursoFallback(categoriaSlug) {
    return APPLENDE.IMAGENES_FALLBACK[categoriaSlug] || APPLENDE.IMAGENES_FALLBACK['tecnico'];
  },
  
  estrellasRating(rating) {
    const r = Math.round(rating || 0);
    return '★'.repeat(r) + '☆'.repeat(5 - r);
  },
  
  iconoCategoria(slug) {
    const iconos = { 'tecnico': '🏗️', 'software': '💻', 'legal': '📋' };
    return iconos[slug] || '📚';
  },
  
  nombreCategoria(slug) {
    const nombres = {
      'tecnico': 'Construcción y Técnico',
      'software': 'Software de Diseño',
      'legal': 'Legal y Avalúos'
    };
    return nombres[slug] || 'General';
  }
};

window.APPLENDE = APPLENDE;
window.APPLENDE_DB = APPLENDE_DB;
window.APPLENDE_UI = APPLENDE_UI;
window.obtenerSupabase = obtenerSupabase;
