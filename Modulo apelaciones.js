// ==========================================
// MODULO_APELACIONES.GS — Apelaciones de multa
// ==========================================

/**
 * Verifica si la fecha seleccionada está dentro del rango permitido para apelar
 */
function verificarDisponibilidadApelaciones(mesApelacion) {
  try {
    var hoy = new Date();
    var diaActual = hoy.getDate();
    var partes = mesApelacion.split("-");
    var yearSel  = parseInt(partes[0]);
    var monthSel = parseInt(partes[1]) - 1;
    var fechaSeleccionada = new Date(yearSel, monthSel, 1);
    fechaSeleccionada.setHours(0, 0, 0, 0);

    var limiteInferior = new Date(2026, 0, 1);
    limiteInferior.setHours(0, 0, 0, 0);
    if (fechaSeleccionada < limiteInferior) {
      return { habilitado: false, mensaje: "No se pueden apelar meses anteriores a Enero 2026." };
    }

    var mesActual  = hoy.getMonth(), yearActual = hoy.getFullYear();
    if (yearSel === yearActual && monthSel === mesActual) {
      if (diaActual < 25) return { habilitado: false, mensaje: "Las apelaciones del mes en curso solo están disponibles a partir del día 25." };
    }

    var fechaHoy = new Date(yearActual, mesActual, 1);
    fechaHoy.setHours(0, 0, 0, 0);
    if (fechaSeleccionada > fechaHoy) return { habilitado: false, mensaje: "No se pueden apelar meses futuros." };

    return { habilitado: true };
  } catch (e) {
    return { habilitado: false, mensaje: "Ocurrió un error interno. Por favor, intente más tarde o contacte al administrador." };
  }
}

/**
 * Envía una apelación de multa
 */
function enviarApelacion(rutGestor, mesApelacion, tipoMotivo, detalleMotivo, archivoComprobante, archivoLiquidacion, rutBeneficiario) {
  _ensureConfig();
  if (!CONFIG || !CONFIG.CARPETAS) return { success: false, message: 'Error de configuración del sistema. Contacta al administrador.' };
  var CARPETA_COMPROBANTES_ID = CONFIG.CARPETAS.APELACIONES_COMPROBANTES;
  var CARPETA_LIQUIDACIONES_ID = CONFIG.CARPETAS.APELACIONES_LIQUIDACIONES;

  var validacion = verificarDisponibilidadApelaciones(mesApelacion);
  if (!validacion.habilitado) return { success: false, message: validacion.mensaje };

  var lock = LockService.getScriptLock();
  if (lock.tryLock(30000)) {
    try {
      var sheetApelaciones = getSheet('APELACIONES', 'APELACIONES');
      var COL_APEL = CONFIG.COLUMNAS.APELACIONES;

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

      // Verificar apelaciones existentes bloqueantes
      var dataApelaciones = sheetApelaciones.getDataRange().getDisplayValues();
      for (var i = 1; i < dataApelaciones.length; i++) {
        var row = dataApelaciones[i];
        var estadoActual = String(row[COL_APEL.ESTADO]);
        if (cleanRut(row[COL_APEL.RUT]) === cleanRut(beneficiario.rut) &&
            row[COL_APEL.MES_APELACION] === mesApelacion &&
            ["Enviado","Aceptado","Aceptado-Obs"].indexOf(estadoActual) !== -1) {
          var mensajeError = estadoActual === "Enviado"
            ? "Ya tienes una apelación pendiente para este mes. Verifica el estado en tu historial."
            : "Este mes ya fue resuelto favorablemente. Verifica los detalles en tu historial.";
          return { success: false, message: mensajeError };
        }
      }

      if (!archivoLiquidacion || !archivoLiquidacion.base64) {
        return { success: false, message: "La liquidación de sueldo es obligatoria." };
      }

      var validacionCorreos = validarCorreosParaPermisos(
        { rut: beneficiario.rut, nombre: beneficiario.nombre, correo: beneficiario.correo },
        esGestionDirigente ? { rut: gestor.rut, nombre: gestor.nombre, correo: gestor.correo } : null,
        esGestionDirigente
      );

      var idUnico = Utilities.getUuid();
      var urlComprobante = "";
      var urlLiquidacion = "";
      var alertaPermisosGlobal = { mostrarAlerta: false, detalles: [] };

      // Subir comprobante (opcional)
      if (archivoComprobante && archivoComprobante.base64) {
        var resultadoComp = subirArchivoConPermisos(archivoComprobante, CARPETA_COMPROBANTES_ID, "APEL-COMP-" + idUnico + "-" + cleanRut(beneficiario.rut), validacionCorreos.correosParaPermisos, []);
        if (resultadoComp.success) {
          urlComprobante = resultadoComp.url;
          if (resultadoComp.fileId) {
            compartirArchivoConRol(resultadoComp.fileId, 'ADMIN',      'leer');
            compartirArchivoConRol(resultadoComp.fileId, 'DIRIGENTE',  'leer');
            compartirArchivoConRol(resultadoComp.fileId, 'DIRECTORIO', 'leer');
          }
          if (resultadoComp.permisosError && resultadoComp.permisosError.length > 0) {
            alertaPermisosGlobal.mostrarAlerta = true;
            resultadoComp.permisosError.forEach(function(err) { alertaPermisosGlobal.detalles.push("Comprobante: No se pudo dar acceso a " + err.nombre); });
          }
        }
      }

      // Subir liquidación (obligatoria)
      var resultadoLiq = subirArchivoConPermisos(archivoLiquidacion, CARPETA_LIQUIDACIONES_ID, "APEL-LIQ-" + idUnico + "-" + cleanRut(beneficiario.rut), validacionCorreos.correosParaPermisos, []);
      if (!resultadoLiq.success) return { success: false, message: "Error al subir la liquidación: " + resultadoLiq.mensajeError };
      urlLiquidacion = resultadoLiq.url;
      if (resultadoLiq.fileId) {
        compartirArchivoConRol(resultadoLiq.fileId, 'ADMIN',      'leer');
        compartirArchivoConRol(resultadoLiq.fileId, 'DIRIGENTE',  'leer');
        compartirArchivoConRol(resultadoLiq.fileId, 'DIRECTORIO', 'leer');
      }

      if (resultadoLiq.permisosError && resultadoLiq.permisosError.length > 0) {
        alertaPermisosGlobal.mostrarAlerta = true;
        resultadoLiq.permisosError.forEach(function(err) { alertaPermisosGlobal.detalles.push("Liquidación: No se pudo dar acceso a " + err.nombre); });
      }

      if (validacionCorreos.alertas && validacionCorreos.alertas.length > 0) {
        alertaPermisosGlobal.mostrarAlerta = true;
        validacionCorreos.alertas.forEach(function(a) { alertaPermisosGlobal.detalles.push(a.mensaje); });
      }

      // Guardar en BD
      var fechaHoy = new Date();
      var gestion = "Socio", nomDirigente = "", correoDirigente = "";
      if (esGestionDirigente) { gestion = "Dirigente"; nomDirigente = gestor.nombre; correoDirigente = gestor.correo; }

      var newRow = [];
      newRow[COL_APEL.ID]                      = idUnico;
      newRow[COL_APEL.FECHA_SOLICITUD]          = fechaHoy;
      newRow[COL_APEL.RUT]                      = beneficiario.rut;
      newRow[COL_APEL.NOMBRE]                   = beneficiario.nombre;
      newRow[COL_APEL.CORREO]                   = beneficiario.correo;
      newRow[COL_APEL.MES_APELACION]            = mesApelacion;
      newRow[COL_APEL.TIPO_MOTIVO]              = tipoMotivo;
      newRow[COL_APEL.DETALLE_MOTIVO]           = detalleMotivo || "";
      newRow[COL_APEL.URL_COMPROBANTE]          = urlComprobante;
      newRow[COL_APEL.URL_LIQUIDACION]          = urlLiquidacion;
      newRow[COL_APEL.ESTADO]                   = "Enviado";
      newRow[COL_APEL.OBSERVACION]              = "";
      newRow[COL_APEL.NOTIFICADO]               = "Enviado";
      newRow[COL_APEL.GESTION]                  = gestion;
      newRow[COL_APEL.NOMBRE_DIRIGENTE]         = nomDirigente;
      newRow[COL_APEL.CORREO_DIRIGENTE]         = correoDirigente;
      newRow[COL_APEL.URL_COMPROBANTE_DEVOLUCION] = "";
      sheetApelaciones.appendRow(newRow);

      // Forzar formato texto en celda MES_APELACION
      var lastRowApel = sheetApelaciones.getLastRow();
      sheetApelaciones.getRange(lastRowApel, COL_APEL.MES_APELACION + 1).setNumberFormat('@STRING@').setValue(mesApelacion);

      // Validación de datos en celda ESTADO.
      // La lista debe cubrir todos los estados que verificarCambiosApelaciones()
      // sabe notificar; con setAllowInvalid(false) un estado ausente aquí no se
      // puede seleccionar en la planilla y su correo nunca llegaría a enviarse.
      var rule = SpreadsheetApp.newDataValidation()
        .requireValueInList(['Enviado','Aceptado','Aceptado-Obs','Rechazado','Pagado'], true)
        .setAllowInvalid(false).build();
      sheetApelaciones.getRange(sheetApelaciones.getLastRow(), COL_APEL.ESTADO + 1).setDataValidation(rule);

      // Formatear nombre del mes
      var fechaMes = new Date(mesApelacion + "-02");
      var nombreMes = fechaMes.toLocaleString('es-CL', { month: 'long', year: 'numeric' });
      nombreMes = nombreMes.charAt(0).toUpperCase() + nombreMes.slice(1);

      // Correo al beneficiario (solo si gestiona por sí mismo)
      if (!esGestionDirigente && esCorreoValido(beneficiario.correo)) {
        var linkComprobanteSocio = (urlComprobante && urlComprobante.includes("http")) ? '<a href="' + urlComprobante + '" style="color:#dc2626;text-decoration:none;font-weight:bold;">Ver Comprobante</a>' : "";
        var linkLiquidacionSocio = (urlLiquidacion && urlLiquidacion.includes("http")) ? '<a href="' + urlLiquidacion + '" style="color:#dc2626;text-decoration:none;font-weight:bold;">Ver Liquidación</a>' : "";
        enviarCorreoEstilizado(beneficiario.correo, "Apelación Ingresada - Sindicato SLIM n°3", "Comprobante de Apelación",
          "Hola <strong>" + beneficiario.nombre + "</strong>, hemos recibido correctamente tu apelación de multa. A continuación los detalles registrados:",
          { "FECHA SOLICITUD": Utilities.formatDate(fechaHoy, Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm"), "RUT": formatRutServer(beneficiario.rut), "NOMBRE": beneficiario.nombre, "MES APELACION": nombreMes, "TIPO MOTIVO": tipoMotivo, "DETALLE MOTIVO": detalleMotivo || "", "URL COMPROBANTE": linkComprobanteSocio, "URL LIQUIDACIÓN": linkLiquidacionSocio, "OBSERVACIÓN": "", "GESTIÓN": gestion, "NOMBRE DIRIGENTE": nomDirigente || "" },
          "#1d4ed8");
      }

      // Correo al dirigente
      if (esGestionDirigente && esCorreoValido(correoDirigente) && correoDirigente !== beneficiario.correo) {
        var linkComprobanteDirigente = (urlComprobante && urlComprobante.includes("http")) ? '<a href="' + urlComprobante + '" style="color:#475569;text-decoration:none;font-weight:bold;">Ver Comprobante</a>' : "";
        var linkLiquidacionDirigente = (urlLiquidacion && urlLiquidacion.includes("http")) ? '<a href="' + urlLiquidacion + '" style="color:#475569;text-decoration:none;font-weight:bold;">Ver Liquidación</a>' : "";
        enviarCorreoEstilizado(correoDirigente, "Respaldo Gestión Apelación - Sindicato SLIM n°3", "Gestión Realizada",
          "Has ingresado exitosamente una apelación para el socio <strong>" + beneficiario.nombre + "</strong>.",
          { "FECHA SOLICITUD": Utilities.formatDate(fechaHoy, Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm"), "RUT": formatRutServer(beneficiario.rut), "NOMBRE": beneficiario.nombre, "MES APELACION": nombreMes, "TIPO MOTIVO": tipoMotivo, "DETALLE MOTIVO": detalleMotivo || "", "URL COMPROBANTE": linkComprobanteDirigente, "URL LIQUIDACIÓN": linkLiquidacionDirigente, "OBSERVACIÓN": "", "GESTIÓN": gestion, "NOMBRE DIRIGENTE": nomDirigente },
          "#475569");
      }

      // Copia al socio cuando el dirigente gestiona en su nombre
      if (esGestionDirigente && esCorreoValido(beneficiario.correo)) {
        var linkComprobanteCopiaSocio = (urlComprobante && urlComprobante.includes("http")) ? '<a href="' + urlComprobante + '" style="color:#dc2626;text-decoration:none;font-weight:bold;">Ver Comprobante</a>' : "";
        var linkLiquidacionCopiaSocio = (urlLiquidacion && urlLiquidacion.includes("http")) ? '<a href="' + urlLiquidacion + '" style="color:#dc2626;text-decoration:none;font-weight:bold;">Ver Liquidación</a>' : "";
        enviarCorreoEstilizado(beneficiario.correo, "Apelación Ingresada - Sindicato SLIM n°3", "Comprobante de Apelación",
          "Hola <strong>" + beneficiario.nombre + "</strong>, un dirigente ha ingresado una apelación de multa a tu nombre. A continuación los detalles registrados:",
          { "FECHA SOLICITUD": Utilities.formatDate(fechaHoy, Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm"), "RUT": formatRutServer(beneficiario.rut), "NOMBRE": beneficiario.nombre, "MES APELACION": nombreMes, "TIPO MOTIVO": tipoMotivo, "DETALLE MOTIVO": detalleMotivo || "", "URL COMPROBANTE": linkComprobanteCopiaSocio, "URL LIQUIDACIÓN": linkLiquidacionCopiaSocio, "OBSERVACIÓN": "", "GESTIÓN": gestion, "NOMBRE DIRIGENTE": nomDirigente },
          "#1d4ed8");
      }

      var respuesta = { success: true, message: "Apelación enviada exitosamente." };
      if (alertaPermisosGlobal.mostrarAlerta && alertaPermisosGlobal.detalles.length > 0) {
        respuesta.mostrarAlerta = true;
        respuesta.tipoAlerta = validacionCorreos.alertaBeneficiario ? 'warning' : 'info';
        respuesta.mensajeAlerta = alertaPermisosGlobal.detalles.join('\n\n');
      }
      return respuesta;

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
 * Obtiene el historial de apelaciones de un usuario
 */
function obtenerHistorialApelaciones(rutInput) {
  try {
    var sheet = getSheet('APELACIONES', 'APELACIONES');
    var COL = CONFIG.COLUMNAS.APELACIONES;
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return { success: true, registros: [] };
    var lastCol = sheet.getLastColumn();
    var data = sheet.getRange(2, 1, lastRow - 1, lastCol).getDisplayValues();
    var rutLimpio = cleanRut(rutInput);
    var registros = [];
    for (var i = 0; i < data.length; i++) {
      var row = data[i];
      if (cleanRut(row[COL.RUT]) === rutLimpio) {
        registros.push({ id: row[COL.ID], fecha: formatearFechaConHora(row[COL.FECHA_SOLICITUD]), mesApelacion: row[COL.MES_APELACION], tipoMotivo: row[COL.TIPO_MOTIVO], detalleMotivo: row[COL.DETALLE_MOTIVO], urlComprobante: row[COL.URL_COMPROBANTE], urlLiquidacion: row[COL.URL_LIQUIDACION], estado: row[COL.ESTADO], obs: row[COL.OBSERVACION], gestion: row[COL.GESTION], nomDirigente: row[COL.NOMBRE_DIRIGENTE], urlComprobanteDevolucion: row[COL.URL_COMPROBANTE_DEVOLUCION] || "" });
      }
    }
    registros.reverse();
    return { success: true, registros: registros };
  } catch (e) {
    Logger.log("❌ Error en obtenerHistorialApelaciones: " + e.toString());
    return { success: false, message: "Ocurrió un error interno. Por favor, intente más tarde o contacte al administrador." };
  }
}

/**
 * Elimina una apelación en estado "Enviado" o "Rechazado" con respaldo
 * histórico en la hoja "Registros-eliminados" del mismo spreadsheet.
 *
 * @param {string} idApelacion - ID de la apelación a eliminar
 * @param {string} rutSolicitante - RUT de quien ejecuta la eliminación.
 *        Obligatorio: solo el titular del registro o un rol gestor
 *        (DIRIGENTE/DIRECTORIO/ADMIN) pueden eliminarlo. Se registra además en
 *        la hoja de respaldo junto a la marca temporal.
 */
function eliminarApelacion(idApelacion, rutSolicitante) {
  _ensureConfig();
  var lock = LockService.getScriptLock();
  if (lock.tryLock(30000)) {
    try {
      var ss = getSpreadsheet('APELACIONES');
      var sheet = getSheet('APELACIONES', 'APELACIONES');
      if (!sheet) return { success: false, message: "No se encontró la hoja de apelaciones." };

      var data = sheet.getDataRange().getValues();
      var COL = CONFIG.COLUMNAS.APELACIONES;
      for (var i = 1; i < data.length; i++) {
        if (String(data[i][COL.ID]) === String(idApelacion)) {
          // Autorización antes que cualquier regla de negocio: quien no puede
          // eliminar tampoco debe enterarse del estado del registro.
          var permiso = _autorizarEliminacionRegistro(rutSolicitante, data[i][COL.RUT]);
          if (!permiso.autorizado) {
            Logger.log('⚠️ eliminarApelacion: intento no autorizado — id=' + idApelacion +
                       ', rut=' + rutSolicitante + ' (' + permiso.motivo + ')');
            return { success: false, message: MENSAJE_ELIMINACION_NO_AUTORIZADA };
          }

          var estado = String(data[i][COL.ESTADO]);
          if (estado !== "Enviado" && estado !== "Rechazado") {
            return { success: false, message: "Solo se pueden eliminar apelaciones en estado 'Enviado' o 'Rechazado'." };
          }

          if (!respaldarRegistroEliminado(ss, sheet, data[i].slice(), rutSolicitante)) {
            return { success: false, message: "No se pudo respaldar el registro. La apelación no fue eliminada." };
          }

          sheet.deleteRow(i + 1);
          return { success: true, message: "Apelación eliminada correctamente." };
        }
      }
      return { success: false, message: "Apelación no encontrada." };
    } catch (e) {
      return { success: false, message: "Ocurrió un error interno. Por favor, intente más tarde o contacte al administrador." };
    } finally {
      lock.releaseLock();
    }
  } else {
    return { success: false, message: "Servidor ocupado." };
  }
}

// ==========================================
// TRIGGER — VERIFICAR CAMBIOS EN APELACIONES
// ==========================================

/**
 * Trigger: cada 8 horas. Detecta cambios de estado y notifica al usuario.
 */
function verificarCambiosApelaciones(e) {
  if (activadorFueraDeProduccion_(e, 'verificarCambiosApelaciones')) return;
  try {
    var sheet = getSheet('APELACIONES', 'APELACIONES');
    if (!sheet) { console.error("❌ No se pudo acceder a la hoja de apelaciones"); return; }

    var data = sheet.getDataRange().getDisplayValues();
    var COL = CONFIG.COLUMNAS.APELACIONES;

    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      var idRegistro   = String(row[COL.ID]);
      // .trim() defensivo: evita que espacios invisibles en la celda ESTADO
      // rompan silenciosamente la comparación === contra los strings exactos
      // de estado (Pagado, Aceptado-Obs, etc.) más abajo en esta función.
      var estadoActual = String(row[COL.ESTADO]).trim();
      // Mismo .trim() defensivo que ESTADO: si NOTIFICADO quedó con espacios
      // (edición manual), la comparación fallaría y se reenviaría el correo.
      var estadoNotif  = String(row[COL.NOTIFICADO]).trim();
      var correo       = row[COL.CORREO];
      var nombre       = row[COL.NOMBRE];
      var mesApelRaw   = row[COL.MES_APELACION];
      var mesApel      = (mesApelRaw instanceof Date) ? Utilities.formatDate(mesApelRaw, "GMT", "yyyy-MM") : String(mesApelRaw);
      var tipoMotivo   = row[COL.TIPO_MOTIVO];
      var obs          = row[COL.OBSERVACION];
      var urlDevolucion= row[COL.URL_COMPROBANTE_DEVOLUCION];

      if (estadoActual !== estadoNotif) {
        // El flag NOTIFICADO se graba ANTES de enviar el correo, y se fuerza el
        // commit con flush(). enviarCorreoEstilizado() nunca lanza (traga sus
        // propios errores), así que el único punto de falla real de este bloque
        // es este setValue: si se escribiera después y fallara (rango protegido,
        // error transitorio de Sheets), el correo ya habría salido y el trigger
        // de cada 8h lo reenviaría al socio indefinidamente.
        sheet.getRange(i + 1, COL.NOTIFICADO + 1).setValue(estadoActual);
        SpreadsheetApp.flush();

        if (correo && correo.includes("@")) {
          var color = "#374151", titulo = "Actualizacion de Apelacion", mensajeEstado = "El estado de tu apelacion ha sido actualizado.";

          if (estadoActual === "Enviado" || estadoActual === "Pendiente") {
            color = "#b45309"; titulo = "Apelacion Recibida"; mensajeEstado = "Tu apelacion ha sido registrada y se encuentra en espera de revision por la directiva.";
          } else if (estadoActual === "En revision") {
            color = "#1d4ed8"; titulo = "Apelacion en Revision"; mensajeEstado = "Tu apelacion esta siendo revisada activamente por la directiva del sindicato.";
          } else if (estadoActual === "Aceptado-Obs") {
            color = "#0369a1"; titulo = "Apelacion Aceptada con Observaciones"; mensajeEstado = "Tu apelacion ha sido aceptada por la directiva, pero incluye observaciones importantes. Revisa el detalle a continuacion.";
          } else if (estadoActual.includes("Aceptado")) {
            color = "#15803d"; titulo = "Apelacion Aceptada"; mensajeEstado = "Tu apelacion ha sido aceptada por la directiva. Pronto recibiras mas informacion.";
          } else if (estadoActual.includes("Rechazado")) {
            color = "#b91c1c"; titulo = "Apelacion Rechazada"; mensajeEstado = "Tu apelacion fue revisada por la directiva y ha sido rechazada. Revisa la observacion para mas detalles.";
          } else if (estadoActual === "Pagado") {
            color = "#065f46"; titulo = "Devolucion de Multa Procesada"; mensajeEstado = "La devolucion de tu multa ha sido procesada exitosamente. Puedes revisar el comprobante de pago a continuacion.";
          }

          var partesMes = mesApel.split("-");
          var añoMes = parseInt(partesMes[0]), numMes = parseInt(partesMes[1]) - 1;
          var fechaMes = new Date(añoMes, numMes, 15, 12, 0, 0);
          var nombreMes = fechaMes.toLocaleString('es-CL', { month: 'long', year: 'numeric' });

          var linkDevolucion = (estadoActual === "Pagado" && urlDevolucion && String(urlDevolucion).includes("http"))
            ? '<a href="' + urlDevolucion + '" style="display:inline-block;background-color:#065f46;color:#ffffff;text-decoration:none;font-weight:bold;padding:10px 22px;border-radius:6px;font-size:14px;">Ver Comprobante de Pago</a>'
            : "";

          var datosCorreoApelacion = { "ID": idRegistro, "MES APELADO": nombreMes.toUpperCase(), "MOTIVO": tipoMotivo, "NUEVO ESTADO": estadoActual, "OBSERVACION": obs || "Sin observaciones" };
          if (estadoActual === "Pagado" && linkDevolucion) datosCorreoApelacion["COMPROBANTE DE PAGO"] = linkDevolucion;

          // Texto base + explicación breve según el estado (fuente: Modulo mensajesEstado.js)
          enviarCorreoEstilizado(correo, titulo + " - Sindicato SLIM n°3", titulo,
            "Hola <strong>" + nombre + "</strong>, " + mensajeEstado +
              bloqueExplicacionEstado(obtenerMensajeEstado('APELACIONES', estadoActual)),
            datosCorreoApelacion, color);
        }
      }
    }
  } catch (e) {
    console.error("❌ Error verificando apelaciones: " + e.toString());
  }
}

// ==========================================
// TRIGGER — PERMISOS COMPROBANTES DEVOLUCIÓN
// ==========================================

function appendLogPermisoDevolucion(sheet, fila, correo, resultado, colLog) {
  var timestamp = Utilities.formatDate(new Date(), "America/Santiago", "dd/MM/yyyy HH:mm");
  var nuevaLinea = timestamp + " | " + correo + " | " + resultado;
  try {
    var logActual = String(sheet.getRange(fila, colLog).getValue() || "");
    sheet.getRange(fila, colLog).setValue(logActual ? (logActual + "\n" + nuevaLinea) : nuevaLinea);
  } catch (logErr) {
    console.warn("⚠️ No se pudo escribir log fila " + fila + ": " + logErr.toString());
  }
}

/**
 * true si el correo (ya en forma canónica) figura entre lectores o editores
 * del archivo. Se compara con _normalizarCorreoParaComparar (Modulo
 * permisosArchivos.js): una mayúscula, un espacio o un punto de Gmail en la
 * columna CORREO no pueden hacer creer que el socio no tiene acceso — eso es
 * lo que hacía reintentar el mismo otorgamiento una y otra vez.
 */
function _correoTieneAccesoArchivo(file, correoCanonico) {
  var coincide = function(u) {
    return _normalizarCorreoParaComparar(u.getEmail()) === correoCanonico;
  };
  return file.getViewers().some(coincide) || file.getEditors().some(coincide);
}

/**
 * Trigger: cada 1 hora. Otorga permisos de lectura a los comprobantes de devolución.
 *
 * Tres resguardos contra el correo repetido "Elemento compartido contigo"
 * (socias con decenas de avisos por el mismo comprobante, jul–sep 2026):
 *   1. Candado de entorno: sólo corre como activador en PRODUCCIÓN.
 *   2. Acceso comparado en forma canónica, lectores y editores.
 *   3. Varias filas de un mismo socio suelen apuntar al MISMO comprobante (una
 *      devolución que cubre varios meses): dentro de una corrida, el par
 *      archivo + correo se resuelve una sola vez y las demás filas se marcan OK.
 * Y el otorgamiento pasa siempre por otorgarPermisoSilencioso_ (Global.js).
 */
function procesarPermisosComprobantesDevolucion(e) {
  if (activadorFueraDeProduccion_(e, 'procesarPermisosComprobantesDevolucion')) return;
  _ensureConfig();

  var tiempoInicio = new Date().getTime();
  var LIMITE_MS = 25 * 60 * 1000;

  try {
    var sheet = getSheet('APELACIONES', 'APELACIONES');
    if (!sheet) { console.error("❌ No se pudo acceder a la hoja de apelaciones"); return; }

    var data = sheet.getDataRange().getValues();
    var COL = CONFIG.COLUMNAS.APELACIONES;
    var procesados = 0, omitidos = 0, erroresTransitorios = 0;
    var resueltosEnEstaCorrida = {}; // "fileId|correoCanónico" → true

    var marcar = function(fila, estado, correo, detalleLog) {
      sheet.getRange(fila, COL.PERMISO_DEVOLUCION + 1).setValue(estado);
      appendLogPermisoDevolucion(sheet, fila, correo, detalleLog, COL.LOG_PERMISOS + 1);
    };

    for (var i = 1; i < data.length; i++) {
      if (new Date().getTime() - tiempoInicio > LIMITE_MS) {
        console.warn("⏱️ Límite de tiempo alcanzado. Procesados: " + procesados);
        break;
      }

      var row = data[i];
      var urlComprobanteDevolucion = String(row[COL.URL_COMPROBANTE_DEVOLUCION] || "");
      var correoUsuario = String(row[COL.CORREO] || "").trim();
      var permisoDevolucion = row.length > COL.PERMISO_DEVOLUCION ? String(row[COL.PERMISO_DEVOLUCION] || "").trim().toUpperCase() : "";

      if (permisoDevolucion === "OK" || permisoDevolucion === "ERROR_PERMANENTE") { omitidos++; continue; }
      if (!urlComprobanteDevolucion || !urlComprobanteDevolucion.includes("drive.google.com")) continue;

      var correoCanonico = _normalizarCorreoParaComparar(correoUsuario);
      if (!correoCanonico) continue;

      try {
        var fileId = extraerFileIdDeDriveUrl(urlComprobanteDevolucion);
        if (!fileId) continue;

        var clave = fileId + "|" + correoCanonico;
        if (resueltosEnEstaCorrida[clave]) {
          marcar(i + 1, "OK", correoUsuario, "MISMO_COMPROBANTE_YA_RESUELTO -> OK");
          procesados++; continue;
        }

        var file = DriveApp.getFileById(fileId);

        if (_correoTieneAccesoArchivo(file, correoCanonico)) {
          resueltosEnEstaCorrida[clave] = true;
          marcar(i + 1, "OK", correoUsuario, "YA_TENIA_ACCESO -> OK");
          procesados++; continue;
        }

        var permisoOtorgado = false, errorPermanente = false;

        // Hasta 3 intentos, todos silenciosos: nunca addViewer(), que no puede
        // suprimir el correo nativo de Drive.
        var esperas = [0, 1000, 2000];
        for (var intento = 0; intento < esperas.length && !permisoOtorgado && !errorPermanente; intento++) {
          if (esperas[intento]) Utilities.sleep(esperas[intento]);
          try {
            otorgarPermisoSilencioso_(fileId, correoUsuario, 'reader');
            permisoOtorgado = true;
          } catch (apiError) {
            var apiErrorStr = apiError.toString();
            if (esErrorSinCuentaGoogle(apiError) || apiErrorStr.includes("Bad Request") ||
                apiErrorStr.includes("Invalid argument") || apiErrorStr.includes("No puedes compartir")) {
              errorPermanente = true;
            }
          }
        }

        if (permisoOtorgado) {
          resueltosEnEstaCorrida[clave] = true;
          marcar(i + 1, "OK", correoUsuario, "PERMISO_OTORGADO -> OK");
          procesados++;
        } else if (errorPermanente) {
          marcar(i + 1, "ERROR_PERMANENTE", correoUsuario, "ERROR_PERMANENTE (Drive rechaza correo)");
          procesados++;
        } else {
          try {
            if (_correoTieneAccesoArchivo(file, correoCanonico)) {
              resueltosEnEstaCorrida[clave] = true;
              marcar(i + 1, "OK", correoUsuario, "ACCESO_VERIFICADO_POST_INTENTO -> OK");
              procesados++;
            } else {
              var intentosPrevios = permisoDevolucion.startsWith("REINTENTO_") ? (parseInt(permisoDevolucion.replace("REINTENTO_", "")) || 0) : 0;
              intentosPrevios++;
              if (intentosPrevios >= 5) {
                marcar(i + 1, "ERROR_PERMANENTE", correoUsuario, "MAX_REINTENTOS (5/5) -> ERROR_PERMANENTE");
                procesados++;
              } else {
                marcar(i + 1, "REINTENTO_" + intentosPrevios, correoUsuario, "REINTENTO_" + intentosPrevios + "/5");
                erroresTransitorios++;
              }
            }
          } catch (verifErr) { erroresTransitorios++; }
        }

      } catch (fileErr) { erroresTransitorios++; }
    }

    console.log("📊 procesarPermisosComprobantesDevolucion: Procesados=" + procesados + " | Omitidos=" + omitidos + " | Errores transitorios=" + erroresTransitorios);
  } catch (e) {
    console.error("❌ Error en procesarPermisosComprobantesDevolucion: " + e.toString());
  }
}

// ==========================================
// SWITCH MÓDULO APELACIONES
// ==========================================

function obtenerEstadoSwitchApelaciones() {
  return _switchHabilitado('apelaciones_habilitado');
}

// Solo ADMIN (validado en _toggleSwitchModulo).
function toggleSwitchApelaciones(estado, rutSolicitante) {
  return _toggleSwitchModulo('apelaciones_habilitado', estado, rutSolicitante);
}

