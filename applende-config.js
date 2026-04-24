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
  
  BUCKET_CARNETS: 'carnets-estudiantes',
  
  IMAGENES_FALLBACK: {
    'tecnico': 'https://images.unsplash.com/photo-1503387762-592deb58ef4e?auto=format&fit=crop&w=800&q=75',
    'software': 'https://images.unsplash.com/photo-1545239351-1141bd82e8a6?auto=format&fit=crop&w=800&q=75',
    'legal': 'https://images.unsplash.com/photo-1450101499163-c8848c66ca85?auto=format&fit=crop&w=800&q=75',
    'economia-finanzas': 'https://images.unsplash.com/photo-1554224155-6726b3ff858f?auto=format&fit=crop&w=800&q=75',
    'hidrocarburos-energias': 'https://images.unsplash.com/photo-1466611653911-95081537e5b7?auto=format&fit=crop&w=800&q=75'
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
  
  // ─────────────────────────────────────────────────────
  // LECTURA DE CATÁLOGO
  // ─────────────────────────────────────────────────────
  
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
  
  // ─────────────────────────────────────────────────────
  // STORAGE: SUBIDA DE CARNET ESTUDIANTIL
  // ─────────────────────────────────────────────────────
  
  /**
   * Sube el carnet universitario del alumno a Supabase Storage.
   * @param {File} file - archivo (imagen o PDF)
   * @param {string} emailAlumno - se usa para nombrar el archivo
   * @returns {Promise<{url: string|null, error: Error|null}>}
   */
  async subirCarnetEstudiante(file, emailAlumno) {
    const sb = obtenerSupabase();
    if (!sb) return { url: null, error: new Error('Supabase no inicializado') };
    
    // Validaciones
    if (!file) return { url: null, error: new Error('No se seleccionó archivo') };
    if (file.size > 5 * 1024 * 1024) {
      return { url: null, error: new Error('El archivo supera los 5 MB permitidos') };
    }
    const tiposValidos = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    if (!tiposValidos.includes(file.type)) {
      return { url: null, error: new Error('Formato inválido. Subí JPG, PNG, WEBP o PDF') };
    }
    
    // Nombre del archivo: email-sanitizado + timestamp + extensión
    const emailSanit = emailAlumno.toLowerCase().replace(/[^a-z0-9]/g, '-');
    const timestamp = Date.now();
    const ext = file.name.split('.').pop().toLowerCase();
    const nombreArchivo = `${emailSanit}-${timestamp}.${ext}`;
    
    // Upload
    const { data, error } = await sb.storage
      .from(APPLENDE.BUCKET_CARNETS)
      .upload(nombreArchivo, file, {
        cacheControl: '3600',
        upsert: false
      });
    
    if (error) {
      console.error('[APPLENDE] Error al subir carnet:', error);
      return { url: null, error };
    }
    
    // El bucket es privado, guardamos el path (no URL pública)
    // Karina verá el carnet desde el dashboard con signed URL
    return { url: data.path, error: null };
  },
  
  // ─────────────────────────────────────────────────────
  // INSCRIPCIÓN
  // ─────────────────────────────────────────────────────
  
  /**
   * Crea una inscripción pendiente. Karina luego la aprueba manualmente
   * y el trigger se encarga de crear el usuario + perfil + inscripción real.
   * 
   * @param {Object} datos - datos del formulario
   * @param {string} datos.nombre_alumno
   * @param {string} datos.email_alumno
   * @param {string} datos.ci_alumno
   * @param {string} datos.whatsapp_alumno
   * @param {string} datos.ciudad_alumno
   * @param {string} datos.curso_id
   * @param {string} datos.cohorte_id
   * @param {number} datos.precio_cotizado
   * @param {string} datos.tipo_alumno - 'profesional' | 'estudiante'
   * @param {string|null} datos.url_documento_validacion - path del carnet en Storage
   * @param {string} datos.moneda - 'BOB' | 'USD' | 'PEN' (default BOB)
   */
  async crearInscripcionPendiente(datos) {
    const sb = obtenerSupabase();
    if (!sb) return { data: null, error: new Error('Supabase no inicializado') };
    
    const fila = {
      nombre_alumno: datos.nombre_alumno,
      email_alumno: datos.email_alumno.toLowerCase().trim(),
      ci_alumno: datos.ci_alumno,
      whatsapp_alumno: datos.whatsapp_alumno,
      ciudad_alumno: datos.ciudad_alumno,
      curso_id: datos.curso_id,
      cohorte_id: datos.cohorte_id,
      precio_cotizado: datos.precio_cotizado,
      moneda: datos.moneda || 'BOB',
      tipo_alumno: datos.tipo_alumno || 'profesional',
      url_documento_validacion: datos.url_documento_validacion || null,
      estado: 'pendiente_pago'
    };
    
    const { data, error } = await sb
      .from('inscripciones_pendientes')
      .insert([fila])
      .select()
      .single();
    
    if (error) console.error('[APPLENDE] Error al crear inscripción pendiente:', error);
    return { data, error };
  }
};

const APPLENDE_UI = {
  
  /**
   * Formatea precio simple (profesional) con descuento opcional.
   */
  formatearPrecio(precioBs, precioOriginalBs) {
    const precio = Math.round(precioBs);
    const original = precioOriginalBs ? Math.round(precioOriginalBs) : null;
    let pctDescuento = null;
    if (original && original > precio) {
      pctDescuento = Math.round(((original - precio) / original) * 100);
    }
    return { precio, original, pctDescuento };
  },
  
  /**
   * Formatea precios duales: profesional + estudiante.
   * Si el curso no tiene precio estudiantil, retorna solo el profesional.
   */
  formatearPreciosDuales(precioBs, precioEstudianteBs, precioOriginalBs) {
    const profesional = this.formatearPrecio(precioBs, precioOriginalBs);
    
    if (!precioEstudianteBs || precioEstudianteBs <= 0) {
      return { profesional, estudiante: null, tieneEstudiante: false };
    }
    
    const estudiante = {
      precio: Math.round(precioEstudianteBs),
      pctDescuentoVsProfesional: Math.round(((precioBs - precioEstudianteBs) / precioBs) * 100)
    };
    
    return { profesional, estudiante, tieneEstudiante: true };
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
    const iconos = { 
      'tecnico': '🏗️', 
      'software': '💻', 
      'legal': '📋',
      'economia-finanzas': '💰',
      'hidrocarburos-energias': '⛽'
    };
    return iconos[slug] || '📚';
  },
  
  nombreCategoria(slug) {
    const nombres = {
      'tecnico': 'Construcción y Técnico',
      'software': 'Software de Diseño',
      'legal': 'Legal y Avalúos',
      'economia-finanzas': 'Economía y Finanzas',
      'hidrocarburos-energias': 'Hidrocarburos y Energías'
    };
    return nombres[slug] || 'General';
  },
  
  /**
   * Valida que un archivo sea una imagen o PDF aceptable para carnet.
   */
  validarArchivoCarnet(file) {
    if (!file) return { valido: false, error: 'Seleccioná un archivo' };
    
    const tiposValidos = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    if (!tiposValidos.includes(file.type)) {
      return { valido: false, error: 'Formato inválido. Subí JPG, PNG, WEBP o PDF' };
    }
    
    if (file.size > 5 * 1024 * 1024) {
      return { valido: false, error: 'El archivo pesa más de 5 MB. Achicá la imagen' };
    }
    
    return { valido: true, error: null };
  }
};

window.APPLENDE = APPLENDE;
window.APPLENDE_DB = APPLENDE_DB;
window.APPLENDE_UI = APPLENDE_UI;
window.obtenerSupabase = obtenerSupabase;
