// ==========================================
// MODULO_JUSTIFICACIONES.GS — Procesamiento de justificaciones regionales
// ==========================================

// ==========================================
// SWITCH Y CONFIGURACIÓN
// ==========================================

/**
 * Obtiene el estado del switch de justificaciones con soporte multi-región
 */
function obtenerEstadoSwitchJustificaciones() {
  try {
    var cache = CacheService.getScriptCache();
    var cached = cache.get('justif_switch_state_v2');
    if (cached) {
      try { return JSON.parse(cached); } catch (e) {}
    }

    var ss = getSpreadsheet('JUSTIFICACIONES');
    var sheetConfig = ss.getSheetByName(CONFIG.HOJAS.CONFIG_JUSTIFICACIONES);

    // Crear hoja si no existe
    if (!sheetConfig) {
      sheetConfig = ss.insertSheet(CONFIG.HOJAS.CONFIG_JUSTIFICACIONES);
      sheetConfig.appendRow(["REGION","Habilitado","Fecha Limite","Fecha_Evento","Nombre_Actividad"]);
    } else {
      // Migrar formato antiguo si aplica
      var primeraFila = sheetConfig.getRange(1, 1, 1, 1).getValue();
      var primeraFilaStr = String(primeraFila).trim().toUpperCase();
      if (primeraFilaStr === "HABILITADO" || primeraFilaStr === "TRUE" || primeraFilaStr === "FALSE") {
        var datosAntiguos = sheetConfig.getDataRange().getValues();
        var filaAntiguaConfig = datosAntiguos.length > 1 ? datosAntiguos[1] : null;
        sheetConfig.clearContents();
        sheetConfig.appendRow(["REGION","Habilitado","Fecha Limite","Fecha_Evento","Nombre_Actividad"]);
        if (filaAntiguaConfig) {
          var habAnt = filaAntiguaConfig[0] === true || String(filaAntiguaConfig[0]).toLowerCase() === "true";
          if (habAnt) {
            sheetConfig.appendRow(["13. Región Metropolitana de Santiago", true, filaAntiguaConfig[1] || "", filaAntiguaConfig[2] || "", "Asamblea General"]);
          }
        }
        Logger.log("✅ CONFIG_JUSTIFICACIONES migrado a formato multi-región");
      }
    }

    var lastRow = sheetConfig.getLastRow();
    if (lastRow < 2) return { habilitado: false, fechaLimite: "", fechaEvento: null, configuraciones: [] };

    var data = sheetConfig.getRange(2, 1, lastRow - 1, 5).getValues();
    var configuraciones = [];
    var ahora = new Date();

    for (var i = 0; i < data.length; i++) {
      var region = String(data[i][0] || "").trim();
      var habilitado = (data[i][1] === true || String(data[i][1]).toLowerCase() === "true");
      var fechaLimiteRaw = data[i][2];
      var fechaEventoRaw = data[i][3];
      var nombreActividad = String(data[i][4] || "Asamblea").trim();

      if (!region) continue;

      var fechaLimiteValue = fechaLimiteRaw
        ? (fechaLimiteRaw instanceof Date ? fechaLimiteRaw.toISOString() : String(fechaLimiteRaw).trim())
        : "";
      var fechaEvento = (fechaEventoRaw && String(fechaEventoRaw).trim() !== "")
        ? (fechaEventoRaw instanceof Date
            ? Utilities.formatDate(fechaEventoRaw, Session.getScriptTimeZone(), "yyyy-MM-dd")
            : String(fechaEventoRaw).trim())
        : null;

      // Auto-deshabilitar si venció la fecha límite
      if (habilitado && fechaLimiteValue) {
        var limite = parsearFechaFlexible(fechaLimiteValue);
        if (limite !== null && ahora > limite) {
          sheetConfig.getRange(i + 2, 2).setValue(false);
          habilitado = false;
          Logger.log("⏰ Región " + region + " deshabilitada automáticamente por vencimiento de plazo");
        }
      }

      configuraciones.push({ region: region, habilitado: habilitado, fechaLimite: fechaLimiteValue, fechaEvento: fechaEvento, nombreActividad: nombreActividad });
    }

    var algunaHabilitada = configuraciones.some(function(c) { return c.habilitado; });
    var resultado = { habilitado: algunaHabilitada, configuraciones: configuraciones };

    try { cache.put('justif_switch_state_v2', JSON.stringify(resultado), 120); } catch (e) {}
    return resultado;

  } catch (e) {
    Logger.log('Error en obtenerEstadoSwitchJustificaciones: ' + e.toString());
    return { habilitado: false, fechaLimite: "", fechaEvento: null, configuraciones: [] };
  }
}

/**
 * Actualiza el switch de justificaciones para una región específica.
 * Solo ADMIN — el webapp es ANYONE_ANONYMOUS, misma razón que _toggleSwitchModulo.
 */
function actualizarSwitchJustificaciones(nuevoEstado, fechaLimite, fechaEvento, region, nombreActividad, rutSolicitante) {
  var verificacion = verificarRolUsuario(rutSolicitante, ['ADMIN']);
  if (!verificacion.autorizado) {
    Logger.log('⚠️ actualizarSwitchJustificaciones: intento no autorizado — RUT=' + rutSolicitante);
    return { success: false, message: "No autorizado." };
  }

  var lock = LockService.getScriptLock();
  if (lock.tryLock(30000)) {
    try {
      try { CacheService.getScriptCache().remove('justif_switch_state_v2'); } catch(e) {}

      var ss = getSpreadsheet('JUSTIFICACIONES');
      var sheetConfig = ss.getSheetByName(CONFIG.HOJAS.CONFIG_JUSTIFICACIONES);
      if (!sheetConfig) {
        sheetConfig = ss.insertSheet(CONFIG.HOJAS.CONFIG_JUSTIFICACIONES);
        sheetConfig.appendRow(["REGION","Habilitado","Fecha Limite","Fecha_Evento","Nombre_Actividad"]);
      }

      // Deshabilitar TODAS si no hay región específica
      if (!nuevoEstado && !region) {
        var lr = sheetConfig.getLastRow();
        if (lr >= 2) sheetConfig.getRange(2, 2, lr - 1, 1).setValue(false);
        return { success: true, message: "Todas las configuraciones deshabilitadas." };
      }

      var regionTarget = region ? String(region).trim() : "13. Región Metropolitana de Santiago";
      var nombreAct = (nombreActividad && String(nombreActividad).trim() !== "") ? String(nombreActividad).trim() : "Asamblea General";
      var valorEvento = (fechaEvento && String(fechaEvento).trim() !== "") ? String(fechaEvento).trim() : "";

      var lastRow = sheetConfig.getLastRow();
      var filaExistente = -1;
      if (lastRow >= 2) {
        var dataActual = sheetConfig.getRange(2, 1, lastRow - 1, 1).getValues();
        for (var i = 0; i < dataActual.length; i++) {
          if (String(dataActual[i][0]).trim() === regionTarget) { filaExistente = i + 2; break; }
        }
      }

      if (filaExistente > 0) {
        sheetConfig.getRange(filaExistente, 1, 1, 5).setValues([[regionTarget, nuevoEstado, fechaLimite || "", valorEvento, nombreAct]]);
      } else {
        sheetConfig.appendRow([regionTarget, nuevoEstado, fechaLimite || "", valorEvento, nombreAct]);
      }

      // Esta hoja guarda el estado VIGENTE: la línea de arriba SOBRESCRIBE la
      // fila de la región, así que la actividad anterior se pierde. El catálogo
      // (Modulo actividades.js) conserva una copia append-only de cada
      // actividad configurada, que es lo que después permite saber qué hubo
      // cada mes, no sólo qué hay ahora.
      //
      // Sólo al habilitar y con fecha de evento: apagar el switch no crea una
      // actividad, y sin fecha no hay identidad que registrar.
      // registrarActividadCatalogo() nunca lanza — si el catálogo falla, la
      // configuración de la justificación igual queda hecha.
      if (nuevoEstado && valorEvento) {
        registrarActividadCatalogo({
          nombre: nombreAct,
          region: regionTarget,
          fechaEvento: valorEvento,
          fechaLimite: fechaLimite || '',
          origen: 'JUSTIFICACIONES',
          registradoPor: rutSolicitante || 'ADMIN'
        });
      }

      return { success: true, message: "Configuración actualizada para " + regionTarget };
    } catch (e) {
      return { success: false, message: "Ocurrió un error interno. Por favor, intente más tarde o contacte al administrador." };
    } finally {
      lock.releaseLock();
    }
  } else {
    return { success: false, message: "Servidor ocupado." };
  }
}

/**
 * Elimina la configuración de una región específica. Solo ADMIN.
 */
function eliminarConfigRegionJustificaciones(region, rutSolicitante) {
  try {
    var verificacion = verificarRolUsuario(rutSolicitante, ['ADMIN']);
    if (!verificacion.autorizado) {
      Logger.log('⚠️ eliminarConfigRegionJustificaciones: intento no autorizado — RUT=' + rutSolicitante);
      return { success: false, message: "No autorizado." };
    }
    if (!region || String(region).trim() === "") return { success: false, message: "Debe indicar una región." };
    var regionTarget = String(region).trim();
    try { CacheService.getScriptCache().remove('justif_switch_state_v2'); } catch(e) {}
    var ss = getSpreadsheet('JUSTIFICACIONES');
    var sheetConfig = ss.getSheetByName(CONFIG.HOJAS.CONFIG_JUSTIFICACIONES);
    if (!sheetConfig) return { success: false, message: "Hoja de configuración no encontrada." };
    var lastRow = sheetConfig.getLastRow();
    if (lastRow < 2) return { success: false, message: "No hay configuraciones registradas." };
    // Se leen las 5 columnas, no sólo la región: si la fila se va a borrar, es
    // la última oportunidad de guardar la actividad en el catálogo. Esta hoja
    // es el dato más fiel que existe sobre las actividades del sindicato, y
    // hasta ahora desaparecía acá sin dejar rastro.
    var data = sheetConfig.getRange(2, 1, lastRow - 1, 5).getValues();
    for (var i = 0; i < data.length; i++) {
      if (String(data[i][0]).trim() === regionTarget) {
        // Antes de borrar. Nunca lanza: si el catálogo falla, la eliminación
        // igual procede — es lo que el admin pidió.
        if (data[i][3]) {
          registrarActividadCatalogo({
            nombre: String(data[i][4] || '').trim() || 'Asamblea',
            region: regionTarget,
            fechaEvento: data[i][3],
            fechaLimite: data[i][2],
            origen: 'JUSTIFICACIONES',
            registradoPor: rutSolicitante || 'ADMIN'
          });
        }

        sheetConfig.deleteRow(i + 2);
        return { success: true, message: 'Configuración de "' + regionTarget + '" eliminada.' };
      }
    }
    return { success: false, message: "No se encontró configuración para esa región." };
  } catch (e) {
    return { success: false, message: "Ocurrió un error interno. Por favor, intente más tarde o contacte al administrador." };
  }
}

// ==========================================
// VALIDACIONES DE DISPONIBILIDAD
// ==========================================

/**
 * Obtiene la info de actividad para la región del usuario
 */
function obtenerInfoActividadPorRegion(rut) {
  try {
    var usuario = obtenerUsuarioPorRut(rut);
    if (!usuario.encontrado) return { habilitado: false, sinConfiguracion: true, mensaje: "Usuario no encontrado." };

    var regionUsuario = String(usuario.region || "").trim();
    if (!regionUsuario) return { habilitado: false, sinRegion: true, mensaje: "No tienes una región asignada en el sistema. Por favor actualiza tu región en Mis Datos." };

    var estadoSwitch = obtenerEstadoSwitchJustificaciones();
    var configuraciones = estadoSwitch.configuraciones || [];

    if (configuraciones.length === 0) return { habilitado: false, sinConfiguracion: true, regionUsuario: regionUsuario, mensaje: "El módulo de justificaciones no está activo en este momento. Consulta con tu delegado sindical." };

    // Comparación normalizada: ignorar espacios extras y diferencias de mayúsculas
    var regionUsuarioNorm = regionUsuario.trim().toLowerCase();
    var configRegion = null;
    for (var i = 0; i < configuraciones.length; i++) {
      var regionConfigNorm = String(configuraciones[i].region || "").trim().toLowerCase();
      if (regionConfigNorm === regionUsuarioNorm) {
        configRegion = configuraciones[i];
        break;
      }
    }

    if (!configRegion) return { habilitado: false, regionNoConfigurada: true, regionUsuario: regionUsuario, mensaje: "No hay una actividad programada para tu región (" + regionUsuario + ") en este momento.\n\nSi crees que se trata de un error, comunícate con tu delegado sindical. Si tu región registrada no corresponde, la directiva puede corregirla." };

    if (!configRegion.habilitado) return { habilitado: false, vencido: true, regionUsuario: regionUsuario, nombreActividad: configRegion.nombreActividad, fechaEvento: configRegion.fechaEvento, mensaje: 'El plazo para justificaciones de la actividad "' + configRegion.nombreActividad + '" ha vencido para tu región.' };

    return { habilitado: true, regionUsuario: regionUsuario, nombreActividad: configRegion.nombreActividad, fechaLimite: configRegion.fechaLimite, fechaEvento: configRegion.fechaEvento };

  } catch (e) {
    Logger.log("Error en obtenerInfoActividadPorRegion: " + e.toString());
    return { habilitado: false, sinConfiguracion: true, mensaje: "Error al verificar configuración: " + e.message };
  }
}

/**
 * Verifica si el usuario ya tiene justificación para la actividad activa de su región
 */
function verificarJustificacionActividad(rut) {
  try {
    var infoActividad = obtenerInfoActividadPorRegion(rut);
    if (!infoActividad.habilitado) return { tieneJustificacion: false, sinActividad: true };

    var codigoActividad = null;
    if (infoActividad.fechaEvento && infoActividad.nombreActividad) {
      codigoActividad = infoActividad.fechaEvento + "_" + infoActividad.nombreActividad;
    } else if (infoActividad.fechaEvento) {
      codigoActividad = generarCodigoAsambleaEvento(infoActividad.fechaEvento);
    }

    if (!codigoActividad) return { tieneJustificacion: false };

    SpreadsheetApp.flush();
    var sheet = getSheet('JUSTIFICACIONES', 'JUSTIFICACIONES');
    var data = sheet.getDataRange().getValues();
    var COL = CONFIG.COLUMNAS.JUSTIFICACIONES;
    var rutLimpio = cleanRut(rut);

    for (var i = 1; i < data.length; i++) {
      var filaRut = cleanRut(String(data[i][COL.RUT]));
      var filaAsamblea = String(data[i][COL.ASAMBLEA] || "").trim();
      var filaEstado = String(data[i][COL.ESTADO] || "").trim();
      if (filaRut === rutLimpio && filaAsamblea === codigoActividad && filaEstado !== "Rechazado") {
        return { tieneJustificacion: true, estado: filaEstado, codigoActividad: codigoActividad, nombreActividad: infoActividad.nombreActividad, idJustificacion: String(data[i][COL.ID]) };
      }
    }
    return { tieneJustificacion: false, codigoActividad: codigoActividad };
  } catch (e) {
    return { tieneJustificacion: false, error: "Ocurrió un error interno. Por favor, intente más tarde o contacte al administrador." };
  }
}

/**
 * Verifica disponibilidad del módulo de justificaciones para un RUT dado
 */
function verificarDisponibilidadJustificaciones(rut) {
  if (rut) {
    var infoActividad = obtenerInfoActividadPorRegion(rut);
    return {
      habilitado: infoActividad.habilitado,
      mensaje: infoActividad.habilitado ? "" : (infoActividad.mensaje || "Módulo deshabilitado para tu región."),
      regionNoConfigurada: infoActividad.regionNoConfigurada || false,
      sinRegion: infoActividad.sinRegion || false,
      vencido: infoActividad.vencido || false
    };
  }
  var estadoSwitch = obtenerEstadoSwitchJustificaciones();
  if (!estadoSwitch.habilitado) return { habilitado: false, mensaje: "Módulo de justificaciones temporalmente deshabilitado.\nConsulte con la directiva." };
  return { habilitado: true };
}

/**
 * Valida si el usuario puede enviar una justificación (por evento o por mes)
 */
function validarJustificacionMesActual(rut) {
  try {
    SpreadsheetApp.flush();
    var sheet = getSheet('JUSTIFICACIONES', 'JUSTIFICACIONES');
    var data = sheet.getDataRange().getValues();
    var COL = CONFIG.COLUMNAS.JUSTIFICACIONES;
    var hoy = new Date();

    var infoActividad = obtenerInfoActividadPorRegion(rut);
    var fechaEvento = (infoActividad.habilitado && infoActividad.fechaEvento) ? infoActividad.fechaEvento : null;
    var codigoEventoActivo = null;
    if (fechaEvento && infoActividad.nombreActividad) {
      codigoEventoActivo = fechaEvento + "_" + infoActividad.nombreActividad;
    } else if (fechaEvento) {
      codigoEventoActivo = generarCodigoAsambleaEvento(fechaEvento);
    }

    Logger.log("Validando justificacion | Region: " + (infoActividad.regionUsuario || "?") + " | Evento: " + (codigoEventoActivo || "Sin evento (modo mes)"));

    // ── MODO A: Validación por evento específico ──
    if (codigoEventoActivo) {
      var justificacionesDelEvento = [];
      for (var i = 1; i < data.length; i++) {
        if (cleanRut(data[i][COL.RUT]) === cleanRut(rut) && String(data[i][COL.ASAMBLEA] || "").trim() === codigoEventoActivo) {
          var fechaEv = parsearFechaFlexible(data[i][COL.FECHA]);
          justificacionesDelEvento.push({ id: data[i][COL.ID], estado: data[i][COL.ESTADO], tipo: data[i][COL.MOTIVO], fecha: fechaEv !== null ? Utilities.formatDate(fechaEv, Session.getScriptTimeZone(), "dd/MM/yyyy") : "", asamblea: data[i][COL.ASAMBLEA] });
        }
      }
      if (justificacionesDelEvento.length === 0) return { permitido: true, mensaje: "Puede enviar la justificación", justificacionExistente: null };
      var todasRechazadasA = justificacionesDelEvento.every(function(j) { return j.estado === 'Rechazado'; });
      if (todasRechazadasA) return { permitido: true, mensaje: "Puede reintentar (anterior rechazada)", justificacionExistente: justificacionesDelEvento[0] };
      var justEnviada = justificacionesDelEvento.find(function(j) { return j.estado === 'Enviado'; });
      var justAceptada = justificacionesDelEvento.find(function(j) { return j.estado === 'Aceptado' || j.estado === 'Aceptado/Obs'; });
      if (justEnviada) return { permitido: false, mensaje: "Ya tienes una justificación pendiente para el evento " + codigoEventoActivo, justificacionExistente: justEnviada, tipoBloqueo: 'enviada', codigoEvento: codigoEventoActivo };
      if (justAceptada) return { permitido: false, mensaje: "Ya tienes una justificación aceptada para el evento " + codigoEventoActivo, justificacionExistente: justAceptada, tipoBloqueo: 'aceptada', codigoEvento: codigoEventoActivo };
      return { permitido: false, mensaje: "Ya existe una justificación para el evento " + codigoEventoActivo, justificacionExistente: justificacionesDelEvento[0], tipoBloqueo: 'enviada', codigoEvento: codigoEventoActivo };
    }

    // ── MODO B: Fallback — validación por mes calendario ──
    var mesActual = hoy.getMonth(), yearActual = hoy.getFullYear();
    var justificacionesDelMes = [];
    for (var j = 1; j < data.length; j++) {
      var filaFecha = parsearFechaFlexible(data[j][COL.FECHA]);
      if (filaFecha === null) continue;
      if (cleanRut(data[j][COL.RUT]) === cleanRut(rut) && filaFecha.getMonth() === mesActual && filaFecha.getFullYear() === yearActual) {
        justificacionesDelMes.push({ id: data[j][COL.ID], estado: data[j][COL.ESTADO], tipo: data[j][COL.MOTIVO], fecha: Utilities.formatDate(filaFecha, Session.getScriptTimeZone(), "dd/MM/yyyy"), asamblea: data[j][COL.ASAMBLEA] || "" });
      }
    }
    if (justificacionesDelMes.length === 0) return { permitido: true, mensaje: "Puede enviar la justificación", justificacionExistente: null };
    var nombreMes = hoy.toLocaleString('es-CL', { month: 'long', year: 'numeric' });
    var todasRechazadasB = justificacionesDelMes.every(function(j) { return j.estado === 'Rechazado'; });
    if (todasRechazadasB) return { permitido: true, mensaje: "Puede reintentar (anterior rechazada)", justificacionExistente: justificacionesDelMes[0] };
    var hayEnviada = justificacionesDelMes.some(function(j) { return j.estado === 'Enviado'; });
    var hayAceptada = justificacionesDelMes.some(function(j) { return j.estado === 'Aceptado' || j.estado === 'Aceptado/Obs'; });
    if (hayEnviada) return { permitido: false, mensaje: "Ya tienes una justificación pendiente para " + nombreMes, justificacionExistente: justificacionesDelMes.find(function(j) { return j.estado === 'Enviado'; }), tipoBloqueo: 'enviada' };
    if (hayAceptada) return { permitido: false, mensaje: "Ya tienes una justificación aceptada para " + nombreMes, justificacionExistente: justificacionesDelMes.find(function(j) { return j.estado === 'Aceptado' || j.estado === 'Aceptado/Obs'; }), tipoBloqueo: 'aceptada' };
    return { permitido: false, mensaje: "Límite de justificaciones alcanzado para " + nombreMes, justificacionExistente: justificacionesDelMes[0], tipoBloqueo: 'enviada' };

  } catch (error) {
    Logger.log('Error en validarJustificacionMesActual: ' + error.toString());
    return { permitido: false, mensaje: "Error al validar: " + error.message, justificacionExistente: null };
  }
}

// ==========================================
// CRUD JUSTIFICACIONES
// ==========================================

/**
 * Envía una justificación al sistema
 */
function enviarJustificacion(rutGestor, tipo, motivo, archivoData, rutBeneficiario) {
  _ensureConfig();
  if (!CONFIG || !CONFIG.CARPETAS) return { success: false, message: 'Error de configuración del sistema. Contacta al administrador.' };
  var CARPETA_ID = CONFIG.CARPETAS.JUSTIFICACIONES;

  var rutParaVerif = rutBeneficiario ? rutBeneficiario : rutGestor;
  var disp = verificarDisponibilidadJustificaciones(rutParaVerif);
  if (!disp.habilitado) return { success: false, message: disp.mensaje || "Módulo de justificaciones no disponible para tu región." };

  var lock = LockService.getScriptLock();
  if (lock.tryLock(30000)) {
    try {
      var sheetJustif = getSheet('JUSTIFICACIONES', 'JUSTIFICACIONES');
      var COL_JUST = CONFIG.COLUMNAS.JUSTIFICACIONES;

      var gestor = obtenerUsuarioPorRut(rutGestor);
      if (!gestor.encontrado) return { success: false, message: "Error de sesión." };

      var rutTarget = rutBeneficiario ? cleanRut(rutBeneficiario) : cleanRut(rutGestor);
      var esGestionDirigente = rutTarget !== cleanRut(rutGestor);
      var beneficiario;

      if (!esGestionDirigente) {
        beneficiario = gestor;
      } else {
        beneficiario = obtenerUsuarioPorRut(rutBeneficiario);
        if (!beneficiario.encontrado) return { success: false, message: "RUT del socio no encontrado." };
      }

      var validacion = validarJustificacionMesActual(beneficiario.rut);
      if (!validacion.permitido) {
        return { success: false, message: validacion.mensaje, tipoError: 'restriccion_mes', justificacionExistente: validacion.justificacionExistente, tipoBloqueo: validacion.tipoBloqueo, codigoEvento: validacion.codigoEvento || null };
      }

      var validacionCorreos = validarCorreosParaPermisos(
        { rut: beneficiario.rut, nombre: beneficiario.nombre, correo: beneficiario.correo },
        esGestionDirigente ? { rut: gestor.rut, nombre: gestor.nombre, correo: gestor.correo } : null,
        esGestionDirigente
      );

      var idUnico = Utilities.getUuid();
      var fileUrl = "Sin archivo";
      var alertaPermisos = null;

      if (archivoData && archivoData.base64) {
        var nombreArchivo = "JUSTIF-" + idUnico + "-" + cleanRut(beneficiario.rut);
        var resultadoSubida = subirArchivoConPermisos(archivoData, CARPETA_ID, nombreArchivo, validacionCorreos.correosParaPermisos, []);
        if (!resultadoSubida.success) return { success: false, message: resultadoSubida.mensajeError };
        fileUrl = resultadoSubida.url;
        if (resultadoSubida.fileId) {
          compartirArchivoConRol(resultadoSubida.fileId, 'ADMIN',      'leer');
          compartirArchivoConRol(resultadoSubida.fileId, 'DIRIGENTE',  'leer');
          compartirArchivoConRol(resultadoSubida.fileId, 'DIRECTORIO', 'leer');
        }
        alertaPermisos = generarAlertaPermisos(validacionCorreos, resultadoSubida);
      } else {
        alertaPermisos = generarAlertaPermisos(validacionCorreos, null);
      }

      var fechaHoy = new Date();
      var infoActividadParaRegistro = obtenerInfoActividadPorRegion(beneficiario.rut);
      var codigoAsamblea;
      if (infoActividadParaRegistro.habilitado && infoActividadParaRegistro.fechaEvento) {
        codigoAsamblea = infoActividadParaRegistro.fechaEvento + "_" + (infoActividadParaRegistro.nombreActividad || "Asamblea");
      } else {
        codigoAsamblea = generarCodigoAsamblea(fechaHoy);
      }

      var gestion = "Socio", nomDirigente = "", correoDirigente = "";
      if (esGestionDirigente) { gestion = "Dirigente"; nomDirigente = gestor.nombre; correoDirigente = gestor.correo; }

      var newRow = [];
      newRow[COL_JUST.ID]             = idUnico;
      newRow[COL_JUST.FECHA]          = fechaHoy;
      newRow[COL_JUST.RUT]            = beneficiario.rut;
      newRow[COL_JUST.NOMBRE]         = beneficiario.nombre;
      newRow[COL_JUST.REGION]         = beneficiario.region;
      newRow[COL_JUST.MOTIVO]         = tipo;
      newRow[COL_JUST.ARGUMENTO]      = motivo;
      newRow[COL_JUST.RESPALDO]       = fileUrl;
      newRow[COL_JUST.ESTADO]         = "Enviado";
      newRow[COL_JUST.OBSERVACION]    = "";
      newRow[COL_JUST.NOTIFICACION]   = "Enviado";
      newRow[COL_JUST.ASAMBLEA]       = codigoAsamblea;
      newRow[COL_JUST.GESTION]        = gestion;
      newRow[COL_JUST.DIRIGENTE]      = nomDirigente;
      newRow[COL_JUST.CORREO_DIRIGENTE] = correoDirigente;
      sheetJustif.appendRow(newRow);

      // Agregar validación de datos en celda ESTADO
      var lastRow = sheetJustif.getLastRow();
      var rule = SpreadsheetApp.newDataValidation()
        .requireValueInList(['Enviado','Aceptado','Aceptado/Obs','Rechazado'], true)
        .setAllowInvalid(false).build();
      sheetJustif.getRange(lastRow, COL_JUST.ESTADO + 1).setDataValidation(rule);

      // Correo al socio (si gestiona por sí mismo)
      if (!esGestionDirigente && esCorreoValido(beneficiario.correo)) {
        var respaldoDisplay = (fileUrl && fileUrl.includes("http"))
          ? '<a href="' + fileUrl + '" style="color:#ea580c;text-decoration:none;font-weight:bold;">Ver Documento Adjunto</a>'
          : "";
        enviarCorreoEstilizado(
          beneficiario.correo,
          "Justificación Ingresada - Sindicato SLIM n°3",
          "Comprobante de Justificación",
          "Hola <strong>" + beneficiario.nombre + "</strong>, tu justificación ha sido ingresada correctamente en el sistema. A continuación los detalles registrados:",
          { "FECHA": Utilities.formatDate(fechaHoy, Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm"), "RUT": formatRutServer(beneficiario.rut), "NOMBRE": beneficiario.nombre, "REGION": beneficiario.region, "MOTIVO": tipo, "ARGUMENTO": motivo, "RESPALDO": respaldoDisplay, "OBSERVACION": "", "ASAMBLEA": codigoAsamblea, "GESTION": gestion, "DIRIGENTE": nomDirigente },
          "#ea580c"
        );
      }

      // Correo de respaldo al dirigente
      if (esGestionDirigente && esCorreoValido(correoDirigente) && correoDirigente !== beneficiario.correo) {
        var respaldoDirigente = (fileUrl && fileUrl.includes("http"))
          ? '<a href="' + fileUrl + '" style="color:#475569;text-decoration:none;font-weight:bold;">Ver Documento Adjunto</a>'
          : "";
        enviarCorreoEstilizado(
          correoDirigente,
          "Respaldo Gestión Justificación - Sindicato SLIM n°3",
          "Gestión Realizada",
          "Has ingresado exitosamente una justificación para el socio <strong>" + beneficiario.nombre + "</strong>.",
          { "FECHA": Utilities.formatDate(fechaHoy, Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm"), "RUT": formatRutServer(beneficiario.rut), "NOMBRE": beneficiario.nombre, "REGION": beneficiario.region, "MOTIVO": tipo, "ARGUMENTO": motivo, "RESPALDO": respaldoDirigente, "OBSERVACION": "", "ASAMBLEA": codigoAsamblea, "GESTION": gestion, "DIRIGENTE": nomDirigente },
          "#475569"
        );
      }

      // Copia al socio cuando el dirigente gestiona en su nombre
      if (esGestionDirigente && esCorreoValido(beneficiario.correo)) {
        var respaldoSocio = (fileUrl && fileUrl.includes("http"))
          ? '<a href="' + fileUrl + '" style="color:#ea580c;text-decoration:none;font-weight:bold;">Ver Documento Adjunto</a>'
          : "";
        enviarCorreoEstilizado(
          beneficiario.correo,
          "Justificación Ingresada - Sindicato SLIM n°3",
          "Comprobante de Justificación",
          "Hola <strong>" + beneficiario.nombre + "</strong>, un dirigente ha ingresado una justificación a tu nombre. A continuación los detalles registrados:",
          { "FECHA": Utilities.formatDate(fechaHoy, Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm"), "RUT": formatRutServer(beneficiario.rut), "NOMBRE": beneficiario.nombre, "REGION": beneficiario.region, "MOTIVO": tipo, "ARGUMENTO": motivo, "RESPALDO": respaldoSocio, "OBSERVACION": "", "ASAMBLEA": codigoAsamblea, "GESTION": gestion, "DIRIGENTE": nomDirigente },
          "#ea580c"
        );
      }

      var respuesta = { success: true, message: "Justificación enviada exitosamente." };
      if (alertaPermisos && alertaPermisos.mostrarAlerta) {
        respuesta.mostrarAlerta = true;
        respuesta.tipoAlerta = alertaPermisos.tipoAlerta;
        respuesta.mensajeAlerta = alertaPermisos.mensajeAlerta;
      }
      return respuesta;

    } catch (e) {
      Logger.log("Error en enviarJustificacion: " + e.toString());
      return { success: false, message: "Ocurrió un error interno. Por favor, intente más tarde o contacte al administrador." };
    } finally {
      lock.releaseLock();
    }
  } else {
    return { success: false, message: "Servidor ocupado." };
  }
}

/**
 * Elimina una justificación en estado "Enviado" con respaldo histórico
 * en la hoja "Registros-eliminados" del mismo spreadsheet.
 *
 * @param {string} idJustif - ID de la justificación a eliminar
 * @param {string} rutSolicitante - RUT de quien ejecuta la eliminación.
 *        Obligatorio: solo el titular del registro o un rol gestor
 *        (DIRIGENTE/DIRECTORIO/ADMIN) pueden eliminarlo. Se registra además en
 *        la hoja de respaldo junto a la marca temporal.
 */
function eliminarJustificacion(idJustif, rutSolicitante) {
  _ensureConfig();
  var lock = LockService.getScriptLock();
  if (lock.tryLock(30000)) {
    try {
      var ss = getSpreadsheet('JUSTIFICACIONES');
      var sheet = getSheet('JUSTIFICACIONES', 'JUSTIFICACIONES');
      if (!sheet) return { success: false, message: "No se encontró la hoja de justificaciones." };

      var data = sheet.getDataRange().getValues();
      var COL = CONFIG.COLUMNAS.JUSTIFICACIONES;
      var estadoSwitch = obtenerEstadoSwitchJustificaciones();

      for (var i = 1; i < data.length; i++) {
        if (String(data[i][COL.ID]) === String(idJustif)) {
          // Autorización antes que cualquier regla de negocio: quien no puede
          // eliminar tampoco debe enterarse del estado del registro.
          var permiso = _autorizarEliminacionRegistro(rutSolicitante, data[i][COL.RUT]);
          if (!permiso.autorizado) {
            Logger.log('⚠️ eliminarJustificacion: intento no autorizado — id=' + idJustif +
                       ', rut=' + rutSolicitante + ' (' + permiso.motivo + ')');
            return { success: false, message: MENSAJE_ELIMINACION_NO_AUTORIZADA };
          }

          var estado = String(data[i][COL.ESTADO]);
          if (!estadoSwitch.habilitado && estado === "Enviado") {
            return { success: false, message: "El plazo para agregar o modificar información ha vencido. Si al final del mes aparece con multa puede realizar la apelación." };
          }
          if (estado !== "Enviado") return { success: false, message: "No se puede eliminar." };

          if (!respaldarRegistroEliminado(ss, sheet, data[i].slice(), rutSolicitante)) {
            return { success: false, message: "No se pudo respaldar el registro. La justificación no fue eliminada." };
          }

          sheet.deleteRow(i + 1);
          return { success: true, message: "Eliminado." };
        }
      }
      return { success: false, message: "No encontrado." };
    } catch (e) {
      return { success: false, message: "Ocurrió un error interno. Por favor, intente más tarde o contacte al administrador." };
    } finally {
      lock.releaseLock();
    }
  } else {
    return { success: false, message: "Ocupado." };
  }
}

/**
 * Obtiene el historial de justificaciones de un usuario
 */
function obtenerHistorialJustificaciones(rutInput) {
  try {
    var sheet = getSheet('JUSTIFICACIONES', 'JUSTIFICACIONES');
    var COL = CONFIG.COLUMNAS.JUSTIFICACIONES;
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return { success: true, registros: [] };
    var lastCol = sheet.getLastColumn();
    var data = sheet.getRange(2, 1, lastRow - 1, lastCol).getDisplayValues();
    var rutLimpio = cleanRut(rutInput);
    var registros = [];
    for (var i = 0; i < data.length; i++) {
      var row = data[i];
      if (cleanRut(row[COL.RUT]) === rutLimpio) {
        registros.push({ id: row[COL.ID], fecha: formatearFechaConHora(row[COL.FECHA]), tipo: row[COL.MOTIVO], motivo: row[COL.ARGUMENTO], url: row[COL.RESPALDO], estado: row[COL.ESTADO], obs: row[COL.OBSERVACION], asamblea: row[COL.ASAMBLEA], gestion: row[COL.GESTION], nomDirigente: row[COL.DIRIGENTE] });
      }
    }
    registros.reverse();
    return { success: true, registros: registros };
  } catch (e) {
    Logger.log("❌ Error en obtenerHistorialJustificaciones: " + e.toString());
    return { success: false, message: "Ocurrió un error interno. Por favor, intente más tarde o contacte al administrador." };
  }
}

// ==========================================
// TRIGGER — VERIFICAR CAMBIOS EN JUSTIFICACIONES
// ==========================================

/**
 * Trigger: cada 8 horas. Detecta cambios de estado y notifica al usuario.
 * NOTA: Esta es la versión correcta con getSheet(). La versión duplicada con
 * getActiveSpreadsheet() que estaba al final del Code.gs original fue eliminada.
 */
function verificarCambiosJustificaciones(e) {
  if (activadorFueraDeProduccion_(e, 'verificarCambiosJustificaciones')) return;
  try {
    var sheet = getSheet('JUSTIFICACIONES', 'JUSTIFICACIONES');
    if (!sheet) { console.error("❌ No se pudo acceder a la hoja de justificaciones"); return; }

    var data = sheet.getDataRange().getValues();
    var COL = CONFIG.COLUMNAS.JUSTIFICACIONES;

    // Mapa RUT→correo construido una sola vez (antes se releía la hoja
    // USUARIOS completa dentro del loop por cada registro con cambio).
    var mapaCorreos = null;
    function correoDeRut(rutUsuario) {
      if (mapaCorreos === null) {
        mapaCorreos = {};
        var sheetUsers = getSheet('USUARIOS', 'USUARIOS');
        if (!sheetUsers) { console.error("❌ No se pudo acceder a la hoja de usuarios"); return ""; }
        var dataUsers = sheetUsers.getDataRange().getDisplayValues();
        var COL_USER = CONFIG.COLUMNAS.USUARIOS;
        for (var u = 1; u < dataUsers.length; u++) {
          var rutU = cleanRut(dataUsers[u][COL_USER.RUT]);
          if (rutU) mapaCorreos[rutU] = dataUsers[u][COL_USER.CORREO] || "";
        }
      }
      return mapaCorreos[cleanRut(rutUsuario)] || "";
    }

    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      var idRegistro   = String(row[COL.ID]);
      var estadoActual = String(row[COL.ESTADO]).trim();
      var estadoNotif  = String(row[COL.NOTIFICACION]).trim();
      var nombre       = row[COL.NOMBRE];
      var tipo         = row[COL.MOTIVO];
      var obs          = row[COL.OBSERVACION];
      var asamblea     = row[COL.ASAMBLEA];
      var fechaSolicitud = row[COL.FECHA];
      var asambleaActual = row[COL.ASAMBLEA];

      if (fechaSolicitud && !asambleaActual) {
        var fechaCodigo = parsearFechaFlexible(fechaSolicitud);
        if (fechaCodigo !== null) {
          var codigoAsamblea = generarCodigoAsamblea(fechaCodigo);
          sheet.getRange(i + 1, COL.ASAMBLEA + 1).setValue(codigoAsamblea);
        }
      }

      if (estadoActual !== estadoNotif) {
        // Mismo criterio que verificarCambiosApelaciones(): el flag NOTIFICACION
        // se graba y se confirma con flush() ANTES de enviar. Si se escribiera
        // después y ese setValue fallara, el correo ya habría salido y el trigger
        // de cada 8h lo reenviaría al socio en cada ejecución.
        sheet.getRange(i + 1, COL.NOTIFICACION + 1).setValue(estadoActual);
        SpreadsheetApp.flush();

        var correoUsuario = correoDeRut(row[COL.RUT]);

        if (correoUsuario && correoUsuario.includes("@")) {
          var color = "#ea580c", titulo = "Actualización de Justificación";
          if (estadoActual.includes("Aceptado")) { color = "#15803d"; titulo = "Justificación Aceptada"; }
          else if (estadoActual.includes("Rechazado")) { color = "#b91c1c"; titulo = "Justificación Rechazada"; }

          enviarCorreoEstilizado(
            correoUsuario,
            titulo + " - Sindicato SLIM n°3",
            titulo,
            // Mensaje base + explicación breve según el estado (fuente: Modulo mensajesEstado.js)
            "Hola " + nombre + ", el estado de tu justificación cambió a <strong>" + estadoActual + "</strong>." +
              bloqueExplicacionEstado(obtenerMensajeEstado('JUSTIFICACIONES', estadoActual)),
            { "ID": idRegistro, "Tipo": tipo, "Nuevo Estado": estadoActual, "Observación": obs || "Sin observaciones", "Asamblea": asamblea || "Pendiente asignación" },
            color
          );
        }
      }
    }
  } catch (e) {
    console.error("❌ Error verificando justificaciones: " + e.toString());
  }
}

/**
 * Corrige permisos de archivos de justificaciones existentes.
 * Ejecutar manualmente una sola vez.
 */
function corregirPermisosJustificacionesExistentes() {
  try {
    var sheet = getSheet('JUSTIFICACIONES', 'JUSTIFICACIONES');
    var data = sheet.getDataRange().getValues();
    var COL = CONFIG.COLUMNAS.JUSTIFICACIONES;
    var archivosCorregidos = 0, errores = 0;

    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      var gestion = String(row[COL.GESTION]);
      var urlArchivo = String(row[COL.RESPALDO]);
      var correoDirigente = String(row[COL.CORREO_DIRIGENTE]);
      var correoSocio = obtenerCorreoDeRut(row[COL.RUT]);

      if (gestion === "Dirigente" && urlArchivo.includes("drive.google.com") && correoDirigente && correoDirigente.includes("@")) {
        try {
          var fileId = extraerFileIdDeDriveUrl(urlArchivo);
          if (fileId) {
            var file = DriveApp.getFileById(fileId);
            var viewers = file.getViewers();
            var tieneDirigente = viewers.some(function(v) { return v.getEmail() === correoDirigente; });
            var tieneSocio = viewers.some(function(v) { return v.getEmail() === correoSocio; });
            var cambios = [];
            // Siempre por otorgarPermisoSilencioso_ (Global.js): nunca addViewer,
            // que no soporta suprimir el correo nativo "se compartió un archivo contigo".
            if (!tieneDirigente) {
              otorgarPermisoSilencioso_(fileId, correoDirigente, 'reader');
              cambios.push("dirigente: " + correoDirigente);
            }
            if (correoSocio && correoSocio.includes("@") && !tieneSocio) {
              otorgarPermisoSilencioso_(fileId, correoSocio, 'reader');
              cambios.push("socio: " + correoSocio);
            }
            if (cambios.length > 0) { archivosCorregidos++; Logger.log('✅ Fila ' + (i + 1) + ' - Permisos otorgados: ' + cambios.join(', ')); }
          }
        } catch (fileErr) { errores++; Logger.log('⚠️ Error en fila ' + (i + 1) + ': ' + fileErr.toString()); }
      }
    }

    Logger.log('📊 RESUMEN: ✅ Archivos corregidos: ' + archivosCorregidos + ' | ⚠️ Errores: ' + errores);
    return { success: true, archivosCorregidos: archivosCorregidos, errores: errores };
  } catch (error) {
    Logger.log('❌ Error: ' + error.message);
    return { success: false, message: error.message };
  }
}

