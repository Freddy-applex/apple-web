-- ═══════════════════════════════════════════════════════════════
-- FIX BLOQUE 4: Corrección de valores de estado
-- Los valores correctos del CHECK son:
--   pendiente_pago, confirmado, rechazado, expirado
-- (No 'aprobada' ni 'rechazada' como asumió el código original)
-- ═══════════════════════════════════════════════════════════════

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
  IF NOT (public.es_admin(auth.uid()) OR public.es_coordinador(auth.uid())) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Sin permisos');
  END IF;

  SELECT * INTO v_pendiente 
  FROM public.inscripciones_pendientes 
  WHERE id = pendiente_id AND estado = 'pendiente_pago';
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Solicitud no encontrada o ya procesada');
  END IF;

  SELECT u.id INTO v_perfil_id 
  FROM auth.users u WHERE u.email = v_pendiente.email_alumno;
  
  IF v_perfil_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'El alumno aún no tiene cuenta. Pídele que se registre con: ' || v_pendiente.email_alumno,
      'requiere_registro', true,
      'email_alumno', v_pendiente.email_alumno
    );
  END IF;

  INSERT INTO public.inscripciones (
    alumno_id, cohorte_id, curso_id,
    precio_pagado, moneda_pago, pais_alumno,
    estado_pago, acceso_activo, fecha_activacion
  ) VALUES (
    v_perfil_id, v_pendiente.cohorte_id, v_pendiente.curso_id,
    v_pendiente.precio_cotizado, COALESCE(v_pendiente.moneda, 'BOB'), 'BO',
    'confirmado', true, NOW()
  )
  RETURNING id INTO v_inscripcion_id;

  UPDATE public.inscripciones_pendientes
  SET 
    estado = 'confirmado',
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
  RETURN jsonb_build_object('success', false, 'error', SQLERRM, 'codigo_sql', SQLSTATE);
END;
$$;


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
  IF NOT (public.es_admin(auth.uid()) OR public.es_coordinador(auth.uid())) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Sin permisos');
  END IF;

  IF motivo IS NULL OR length(trim(motivo)) < 5 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Motivo debe tener al menos 5 caracteres');
  END IF;

  UPDATE public.inscripciones_pendientes
  SET 
    estado = 'rechazado',
    confirmado_por = auth.uid(),
    fecha_confirmacion = NOW(),
    notas_admin = '[RECHAZO] ' || motivo,
    actualizado_en = NOW()
  WHERE id = pendiente_id AND estado = 'pendiente_pago';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Solicitud no encontrada o ya procesada');
  END IF;

  RETURN jsonb_build_object('success', true, 'mensaje', 'Inscripción rechazada');
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;


-- Verificación
SELECT 
  proname AS funcion,
  '✅ Actualizada' AS estado
FROM pg_proc 
WHERE proname IN ('aprobar_inscripcion','rechazar_inscripcion');
