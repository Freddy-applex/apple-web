-- ═══════════════════════════════════════════════════════════════════════════
-- BLOQUE 4: Backend para Panel de Coordinación (Karina)
-- Ejecutar en: Supabase → SQL Editor
-- ═══════════════════════════════════════════════════════════════════════════
-- Este script:
-- 1. Crea función helper es_coordinador()
-- 2. Crea/ajusta RLS policies sobre tablas relevantes
-- 3. Crea función aprobar_inscripcion() — atómica
-- 4. Crea función rechazar_inscripcion() — atómica
-- ═══════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────────
-- PASO 1: Función helper es_coordinador (análoga a es_admin)
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.es_coordinador(user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 
    FROM public.perfiles 
    WHERE id = user_id 
      AND rol = 'coordinador'
  );
$$;

GRANT EXECUTE ON FUNCTION public.es_coordinador(uuid) TO authenticated, anon, service_role;


-- ───────────────────────────────────────────────────────────────────────────
-- PASO 2: RLS sobre inscripciones_pendientes
-- (Reactivamos RLS y creamos policies correctas para coord/admin)
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE public.inscripciones_pendientes ENABLE ROW LEVEL SECURITY;

-- Limpiar policies viejas si existen
DROP POLICY IF EXISTS "coord_admin_ven_pendientes" ON public.inscripciones_pendientes;
DROP POLICY IF EXISTS "coord_admin_actualizan_pendientes" ON public.inscripciones_pendientes;
DROP POLICY IF EXISTS "publico_crea_pendientes" ON public.inscripciones_pendientes;

-- Coordinadores y admins pueden VER todas las pendientes
CREATE POLICY "coord_admin_ven_pendientes"
ON public.inscripciones_pendientes FOR SELECT
TO authenticated
USING (
  public.es_admin(auth.uid()) OR public.es_coordinador(auth.uid())
);

-- Coordinadores y admins pueden ACTUALIZAR (aprobar/rechazar)
CREATE POLICY "coord_admin_actualizan_pendientes"
ON public.inscripciones_pendientes FOR UPDATE
TO authenticated
USING (
  public.es_admin(auth.uid()) OR public.es_coordinador(auth.uid())
)
WITH CHECK (
  public.es_admin(auth.uid()) OR public.es_coordinador(auth.uid())
);

-- Cualquiera puede CREAR una solicitud pendiente (página pública de registro)
CREATE POLICY "publico_crea_pendientes"
ON public.inscripciones_pendientes FOR INSERT
TO anon, authenticated
WITH CHECK (true);


-- ───────────────────────────────────────────────────────────────────────────
-- PASO 3: RLS sobre inscripciones (oficiales)
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE public.inscripciones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "alumno_ve_sus_inscripciones" ON public.inscripciones;
DROP POLICY IF EXISTS "coord_admin_ven_todas_inscripciones" ON public.inscripciones;
DROP POLICY IF EXISTS "coord_admin_crean_inscripciones" ON public.inscripciones;
DROP POLICY IF EXISTS "coord_admin_actualizan_inscripciones" ON public.inscripciones;

-- Cada alumno ve sus propias inscripciones
CREATE POLICY "alumno_ve_sus_inscripciones"
ON public.inscripciones FOR SELECT
TO authenticated
USING (alumno_id = auth.uid());

-- Coordinadores y admins ven TODAS las inscripciones
CREATE POLICY "coord_admin_ven_todas_inscripciones"
ON public.inscripciones FOR SELECT
TO authenticated
USING (
  public.es_admin(auth.uid()) OR public.es_coordinador(auth.uid())
);

-- Solo coordinadores y admins pueden CREAR inscripciones (vía función aprobar)
CREATE POLICY "coord_admin_crean_inscripciones"
ON public.inscripciones FOR INSERT
TO authenticated
WITH CHECK (
  public.es_admin(auth.uid()) OR public.es_coordinador(auth.uid())
);

-- Coordinadores y admins pueden actualizar inscripciones
CREATE POLICY "coord_admin_actualizan_inscripciones"
ON public.inscripciones FOR UPDATE
TO authenticated
USING (
  public.es_admin(auth.uid()) OR public.es_coordinador(auth.uid())
);


-- ───────────────────────────────────────────────────────────────────────────
-- PASO 4: RLS sobre cursos y cohortes (lectura pública para todos)
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE public.cursos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cohortes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "todos_ven_cursos" ON public.cursos;
DROP POLICY IF EXISTS "todos_ven_cohortes" ON public.cohortes;

-- Cursos visibles para todos (incluso anónimos, para landing pages)
CREATE POLICY "todos_ven_cursos"
ON public.cursos FOR SELECT
TO anon, authenticated
USING (true);

-- Cohortes visibles para todos
CREATE POLICY "todos_ven_cohortes"
ON public.cohortes FOR SELECT
TO anon, authenticated
USING (true);


-- ───────────────────────────────────────────────────────────────────────────
-- PASO 5: Función aprobar_inscripcion — atómica
-- Convierte una solicitud pendiente en inscripción oficial
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.aprobar_inscripcion(
  pendiente_id uuid,
  notas_internas text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pendiente RECORD;
  v_inscripcion_id uuid;
  v_perfil_id uuid;
BEGIN
  -- Validar permisos
  IF NOT (public.es_admin(auth.uid()) OR public.es_coordinador(auth.uid())) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Sin permisos para aprobar inscripciones'
    );
  END IF;

  -- Obtener datos de la solicitud pendiente
  SELECT * INTO v_pendiente 
  FROM public.inscripciones_pendientes 
  WHERE id = pendiente_id 
    AND estado IN ('pendiente_pago', 'pendiente');
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Solicitud no encontrada o ya procesada'
    );
  END IF;

  -- Buscar si el alumno ya tiene cuenta (por email)
  SELECT u.id INTO v_perfil_id 
  FROM auth.users u 
  WHERE u.email = v_pendiente.email_alumno;
  
  -- Si no tiene cuenta, devolver error informativo
  IF v_perfil_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'El alumno aún no tiene cuenta. Pídele que se registre con: ' || v_pendiente.email_alumno,
      'requiere_registro', true,
      'email_alumno', v_pendiente.email_alumno
    );
  END IF;

  -- Crear inscripción oficial
  INSERT INTO public.inscripciones (
    alumno_id, cohorte_id, curso_id,
    precio_pagado, moneda_pago, pais_alumno,
    estado_pago, acceso_activo, fecha_activacion
  ) VALUES (
    v_perfil_id, 
    v_pendiente.cohorte_id, 
    v_pendiente.curso_id,
    v_pendiente.precio_cotizado, 
    COALESCE(v_pendiente.moneda, 'BOB'), 
    'BO',
    'confirmado', 
    true, 
    NOW()
  )
  RETURNING id INTO v_inscripcion_id;

  -- Marcar pendiente como aprobada y linkear
  UPDATE public.inscripciones_pendientes
  SET 
    estado = 'aprobada',
    confirmado_por = auth.uid(),
    fecha_confirmacion = NOW(),
    inscripcion_id = v_inscripcion_id,
    notas_admin = COALESCE(notas_internas, notas_admin),
    actualizado_en = NOW()
  WHERE id = pendiente_id;

  RETURN jsonb_build_object(
    'success', true,
    'inscripcion_id', v_inscripcion_id,
    'mensaje', 'Inscripción aprobada correctamente'
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', SQLERRM,
    'codigo_sql', SQLSTATE
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.aprobar_inscripcion(uuid, text) TO authenticated;


-- ───────────────────────────────────────────────────────────────────────────
-- PASO 6: Función rechazar_inscripcion — atómica
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rechazar_inscripcion(
  pendiente_id uuid,
  motivo text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Validar permisos
  IF NOT (public.es_admin(auth.uid()) OR public.es_coordinador(auth.uid())) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Sin permisos para rechazar inscripciones'
    );
  END IF;

  -- Validar motivo
  IF motivo IS NULL OR length(trim(motivo)) < 5 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Debes escribir un motivo de al menos 5 caracteres'
    );
  END IF;

  -- Marcar como rechazada
  UPDATE public.inscripciones_pendientes
  SET 
    estado = 'rechazada',
    confirmado_por = auth.uid(),
    fecha_confirmacion = NOW(),
    notas_admin = '[RECHAZO] ' || motivo,
    actualizado_en = NOW()
  WHERE id = pendiente_id 
    AND estado IN ('pendiente_pago', 'pendiente');

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Solicitud no encontrada o ya procesada'
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'mensaje', 'Inscripción rechazada'
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', SQLERRM
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.rechazar_inscripcion(uuid, text) TO authenticated;


-- ───────────────────────────────────────────────────────────────────────────
-- VERIFICACIÓN FINAL
-- ───────────────────────────────────────────────────────────────────────────
SELECT 
  'es_coordinador' AS funcion, 
  CASE WHEN public.es_coordinador(auth.uid()) THEN '✅ Tú eres coordinador' ELSE '⚠️ Tú no eres coordinador (probablemente eres admin)' END AS resultado
UNION ALL
SELECT 'es_admin', 
  CASE WHEN public.es_admin(auth.uid()) THEN '✅ Tú eres admin' ELSE '⚠️ Tú no eres admin' END
UNION ALL
SELECT 'aprobar_inscripcion', '✅ Función creada' 
  FROM pg_proc WHERE proname = 'aprobar_inscripcion'
UNION ALL
SELECT 'rechazar_inscripcion', '✅ Función creada' 
  FROM pg_proc WHERE proname = 'rechazar_inscripcion';

-- Listar policies activas en las tablas clave
SELECT 
  tablename,
  policyname,
  cmd AS comando
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('inscripciones_pendientes', 'inscripciones', 'cursos', 'cohortes')
ORDER BY tablename, policyname;
