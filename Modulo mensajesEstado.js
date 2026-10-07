// ==========================================
// MODULO_MENSAJES_ESTADO.GS
// Fuente única de verdad para las explicaciones que acompañan a las
// notificaciones por correo según el estado de cada gestión.
//
// Estos textos son CONTENIDO editable, no configuración: por eso NO viven en
// CONFIG. Para cambiar el mensaje que ve el socio, editar SOLO este archivo.
//
// Textos revisados y confirmados por el administrador (julio 2026).
// ==========================================

var MENSAJES_ESTADO = {

  // ---- APELACIONES ------------------------------------------------------
  // Claves con los estados REALES de la hoja APELACIONES: la validación de
  // datos de la columna ESTADO permite 'Enviado', 'Aceptado', 'Aceptado-Obs'
  // y 'Rechazado'; el trigger verificarCambiosApelaciones maneja además
  // 'Pendiente', 'En revision' (sin tilde, minúscula) y 'Pagado' escritos
  // manualmente por la directiva.
  APELACIONES: {
    "Enviado": "Tu apelación fue recibida y está en revisión por el directorio. Te notificaremos por este medio apenas exista una resolución. No necesitas hacer nada por ahora.",
    "Pendiente": "Tu apelación fue recibida y está en revisión por el directorio. Te notificaremos por este medio apenas exista una resolución. No necesitas hacer nada por ahora.",
    "En revision": "Tu apelación está siendo revisada por el directorio. Te notificaremos por este medio apenas exista una resolución.",
    "Aceptado": "Tu apelación fue <strong>aceptada</strong>. La devolución del monto correspondiente se realiza los días <strong>jueves de cada semana</strong>. Si el jueves cae en festivo, se realizará el siguiente día hábil.",
    "Aceptado-Obs": "Tu apelación fue <strong>aceptada con observaciones</strong>. Revisa la observación indicada en este correo. La devolución del monto correspondiente se realiza los días <strong>jueves de cada semana</strong>; si el jueves cae en festivo, se realizará el siguiente día hábil.",
    "Rechazado": "Tu apelación fue <strong>rechazada</strong>. Si consideras que hubo un error o cuentas con nuevos antecedentes, puedes volver a presentarla corrigiendo o adjuntando la información faltante.",
    "Pagado": "La devolución de tu multa ya fue <strong>procesada</strong>. Puedes revisar el comprobante de pago incluido en este correo. No necesitas hacer nada más.",
    "_default": "El estado de tu apelación fue actualizado. Revisa el detalle en la aplicación sindical."
  },

  // ---- JUSTIFICACIONES --------------------------------------------------
  // Estados reales confirmados en la validación de datos de la hoja:
  // 'Enviado', 'Aceptado', 'Aceptado/Obs', 'Rechazado'.
  JUSTIFICACIONES: {
    "Enviado": "Tu justificación fue ingresada correctamente y está pendiente de revisión. Te avisaremos por este medio cuando sea evaluada.",
    "Aceptado": "Tu justificación fue <strong>aceptada</strong>. La inasistencia queda justificada y no se aplicará multa por este evento.",
    "Aceptado/Obs": "Tu justificación fue <strong>aceptada con observación</strong>. Es válida para esta ocasión, pero revisa la observación indicada para corregirla en futuras solicitudes.",
    "Rechazado": "Tu justificación fue <strong>rechazada</strong>. Puedes volver a enviarla corrigiendo el motivo del rechazo (revisa la observación) antes del cierre del período.",
    "_default":     "El estado de tu justificación fue actualizado. Revisa el detalle en la aplicación sindical."
  },

  // ---- PRESTAMOS --------------------------------------------------------
  // Estados: al procesar resultado, ACEPTADO -> 'Vigente', RECHAZADO -> 'Rechazado'.
  PRESTAMOS: {
    "Vigente": "Tu préstamo fue <strong>aprobado</strong> y se encuentra vigente. Las cuotas se descontarán mes a mes a través de tu liquidación de sueldo, y el depósito se realizará el <strong>viernes de la misma semana de la solicitud</strong>. Cualquier duda o consulta, contáctanos.",
    "Rechazado": "Tu solicitud de préstamo fue <strong>rechazada</strong>. Revisa la observación; puedes volver a postular una vez regularizada la situación indicada.",
    "Pagado": "Tu préstamo fue <strong>pagado en su totalidad</strong>. Ya no registra cuotas pendientes. Puedes revisar el comprobante en tu historial de préstamos dentro de la aplicación. ¡Gracias!",
    "_default":  "El estado de tu préstamo fue actualizado. Revisa el detalle en la aplicación sindical."
  },

  // ---- PERMISOS MEDICOS -------------------------------------------------
  // Permisos médicos NO tiene flujo aceptar/rechazar: solo confirmaciones de
  // registro. La explicación se inyecta en los correos al socio (ver PARTE 5).
  PERMISOS_MEDICOS: {
    "Solicitado": "Tu permiso médico fue registrado. Recuerda adjuntar el documento de respaldo desde el historial del módulo una vez realizada la atención médica.",
    "Solicitado con Documento":  "Tu permiso médico fue registrado junto con el documento de respaldo. No necesitas realizar ninguna acción adicional.",
    "Documento Adjuntado": "El documento de respaldo de tu permiso médico fue adjuntado correctamente.",
    "_default": "El estado de tu permiso médico fue actualizado. Revisa el detalle en la aplicación sindical."
  },

  // ---- DENUNCIAS --------------------------------------------------------
  // Denuncias NO tiene trigger de cambio de estado (no existe
  // verificarCambiosDenuncias). Solo hay correo de registro, que HOY ya trae un
  // bloque "¿Qué ocurre ahora con tu denuncia?" (variable mensajeProceso en
  // enviarDenunciaJefatura). Centralizamos ese texto aquí y lo inyectamos con el
  // mismo helper, para no mantener el texto duplicado (ver PARTE 5).
  DENUNCIAS: {
    "Enviado": "El Sindicato SLIM N°3 revisará tu caso junto a los representantes legales de la empresa en las reuniones mensuales realizadas <strong>entre el 10 y el 20 de cada mes</strong>. Si tu situación requiere atención inmediata por su urgencia o gravedad, el directorio gestionará las acciones necesarias a la brevedad. Para aportar antecedentes, <strong>responde directamente a este correo</strong>: así centralizamos toda la evidencia en un mismo hilo.",
    "_default": "El estado de tu denuncia fue actualizado. Revisa el detalle en la aplicación sindical."
  },

  // ---- BENEFICIO POR FALLECIMIENTO --------------------------------------
  // Notificación consolidada al socio (si tiene correo válido) + ADMIN en CC
  // — o al revés si el socio no tiene correo registrado. Sin DIRECTORIO ni
  // REPLEGAL: este documento contiene datos familiares/de herencia y su
  // acceso ya está restringido al directorio (ver Modulo socios.js). Escrito
  // en tercera persona porque el mismo cuerpo lo puede leer el socio o el
  // ADMIN según quién quede en "Para" (mismo criterio que PERMISOS_MEDICOS).
  FALLECIMIENTO: {
    "EN REVISION":   "El documento de designación de beneficiarios fue recibido y quedó pendiente de revisión por el directorio sindical.",
    "APROBADO":      "El documento de designación de beneficiarios fue <strong>validado</strong> por el directorio sindical. El sindicato mantiene una copia de respaldo.",
    "RECHAZADO":     "El documento de designación de beneficiarios fue <strong>rechazado</strong>. Revisa la observación indicada en este correo; el socio debe volver a subir el documento desde la aplicación.",
    "SIN DOCUMENTO": "El estado de la designación de beneficiarios fue restablecido a \"sin documento\".",
    "_default": "El estado del documento de designación de beneficiarios fue actualizado."
  }
};

/**
 * Devuelve la explicación de texto plano/HTML para un módulo + estado.
 * @param {string} modulo  Clave de MENSAJES_ESTADO (ej. 'APELACIONES').
 * @param {string} estado  Valor de estado tal como aparece en la hoja.
 * @return {string} Texto HTML (puede ser cadena vacía si no aplica).
 */
function obtenerMensajeEstado(modulo, estado) {
  var mapa = MENSAJES_ESTADO[modulo];
  if (!mapa) return "";
  var clave = String(estado || "").trim();
  return mapa[clave] || mapa["_default"] || "";
}

/**
 * Envuelve la explicación en un bloque visual consistente (para inyectar en el
 * parámetro `mensaje` de enviarCorreoEstilizado). Devuelve "" si no hay texto,
 * de modo que sea seguro concatenarlo siempre.
 * @param {string} texto      Resultado de obtenerMensajeEstado().
 * @param {string} [colorTema] Color del encabezado del correo (ej. '#f59e0b').
 *        Si se pasa, el borde/fondo/texto del bloque se tiñen a juego con ese
 *        color en vez del verde fijo — usado por FALLECIMIENTO, donde cada
 *        estado tiene su propio color de encabezado. Omitirlo preserva
 *        exactamente el verde fijo que ya usan APELACIONES, JUSTIFICACIONES,
 *        PRESTAMOS, PERMISOS_MEDICOS y DENUNCIAS — no cambia sus correos.
 * @return {string} HTML del bloque, o "" si texto está vacío.
 */
function bloqueExplicacionEstado(texto, colorTema) {
  if (!texto) return "";
  var colorBorde = colorTema || '#00e84a';
  var colorFondo = colorTema ? _tintClaroDesdeColor(colorTema) : '#f0fdf4';
  var colorTexto = colorTema ? adjustColor(colorTema, -55) : '#166534';
  return '<div style="margin-top:16px;background:' + colorFondo + ';border-left:4px solid ' + colorBorde + ';' +
         'border-radius:0 8px 8px 0;padding:14px 16px;">' +
         '<p style="margin:0;color:' + colorTexto + ';font-size:13px;line-height:1.6;">' +
         '<strong>¿Qué significa esto?</strong><br>' + texto + '</p></div>';
}

/**
 * Mezcla un color hex hacia blanco (88%) para obtener un fondo muy claro del
 * mismo tono — usado por bloqueExplicacionEstado() cuando recibe colorTema.
 */
function _tintClaroDesdeColor(hexColor) {
  var num = parseInt(hexColor.replace('#', ''), 16);
  var R = (num >> 16) & 0xFF, G = (num >> 8) & 0xFF, B = num & 0xFF;
  var mezcla = 0.88;
  R = Math.round(R + (255 - R) * mezcla);
  G = Math.round(G + (255 - G) * mezcla);
  B = Math.round(B + (255 - B) * mezcla);
  return '#' + ((1 << 24) + (R << 16) + (G << 8) + B).toString(16).slice(1);
}
