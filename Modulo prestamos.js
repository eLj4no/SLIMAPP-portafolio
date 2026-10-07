// ==========================================
// MODULO_PRESTAMOS.GS — Lógica completa de préstamos
// ==========================================

/**
 * Devuelve si el módulo de Préstamos está habilitado (switch panel admin).
 * Mismo flag ('prestamos_habilitado') que ya usa obtenerEstadosSwitchDashboard()
 * en Global.js, para no crear una fuente de verdad paralela.
 */
function obtenerEstadoSwitchPrestamos() {
  return _switchHabilitado('prestamos_habilitado');
}

/**
 * Habilita/deshabilita el módulo de Préstamos desde el panel admin.
 * Solo ADMIN (validado en _toggleSwitchModulo).
 */
function toggleSwitchPrestamos(estado, rutSolicitante) {
  return _toggleSwitchModulo('prestamos_habilitado', estado, rutSolicitante);
}

/**
 * El "Préstamo de Emergencia" pasó a llamarse "Préstamo Personal" (sep-2026).
 * Las solicitudes nuevas se guardan como "Personal - Opción X", pero las filas
 * antiguas de BD_PRESTAMOS siguen diciendo "Emergencia - Opción X" y no se
 * reescriben: son registro histórico. Estas dos funciones son el único lugar
 * que sabe que ambos nombres son el mismo préstamo.
 *
 * nombreTipoPrestamo: el texto que se le muestra a quien sea (pantalla o
 * correo). Solo cambia la palabra; la opción y el resto quedan intactos.
 */
function nombreTipoPrestamo(tipo) {
  return String(tipo || '').replace(/^\s*Emergencia\b/i, 'Personal');
}

/**
 * Familia del préstamo para la regla "uno a la vez": "Personal" (incluye los
 * antiguos de Emergencia) o "Vacaciones". Sin esto, un socio con un préstamo
 * de Emergencia aún vigente podría pedir un Personal encima.
 */
function _familiaPrestamo(tipo) {
  return nombreTipoPrestamo(tipo).split(' - ')[0].trim();
}

/**
 * Bloque HTML con las condiciones del beneficio, redactado en tono imperativo
 * para el socio. Se inyecta dentro del mensaje del correo de solicitud ingresada
 * (mismo patrón de bloque embebido que bloqueExplicacionEstado en
 * Modulo mensajesEstado.js). Es CONTENIDO, no configuración: se mantiene en el
 * código para poder editarlo directamente.
 */
function _bloqueCondicionesPrestamo() {
  return '<div style="margin-top:20px;background:#eff6ff;border-left:4px solid #2563eb;' +
         'border-radius:0 8px 8px 0;padding:16px 18px;">' +
         '<p style="margin:0 0 10px 0;color:#1e3a8a;font-size:14px;font-weight:700;">' +
         'Condiciones importantes de tu solicitud</p>' +
         '<ul style="margin:0;padding-left:18px;color:#1e40af;font-size:13px;line-height:1.7;">' +
         '<li><strong>Ten presente los plazos de envío:</strong> Las solicitudes se envían a la empresa ' +
         'los <strong>días lunes a las 16:30 hrs</strong>. Si ingresaste tu solicitud después de ese ' +
         'horario, considérala para el ciclo de la semana siguiente.</li>' +
         '<li><strong>Verifica que cumples los requisitos:</strong> La empresa analiza cada solicitud y ' +
         'confirma que tengas más de un año de antigüedad y que no mantengas otro préstamo del mismo tipo ' +
         'en curso. Una vez pagado, puedes solicitar uno nuevo.</li>' +
         '<li><strong>Considera los tiempos de depósito:</strong> En caso de ser aprobada, ten en cuenta ' +
         'que la empresa está realizando los depósitos entre <strong>7 y 10 días hábiles</strong> desde el inicio del ciclo.</li>' +
         '</ul></div>';
}

/**
 * Crea una solicitud de préstamo
 */
function crearSolicitudPrestamo(rutGestor, tipo, cuotas, medioPago, rutBeneficiario, comprobanteData, autorizacionDT) {
  var lock = LockService.getScriptLock();
  if (lock.tryLock(30000)) {
    try {
      var sheetPrestamos= getSheet('PRESTAMOS', 'PRESTAMOS');
      var COL_PRES = CONFIG.COLUMNAS.PRESTAMOS;

      // Validación server-side de la autorización de uso de datos para
      // denuncia ante la DT. Nunca confiar solo en el checkbox del
      // frontend: si llega falso, ausente o manipulado, se rechaza aquí.
      if (autorizacionDT !== true) {
        return { success: false, message: "Debes autorizar el uso de tus datos para continuar con la solicitud." };
      }

      // 1. Identificar al Gestor (lookup indexado con caché, igual que
      // apelaciones/justificaciones — evita escanear toda la hoja USUARIOS)
      var rutLimpioGestor = cleanRut(rutGestor);
      var gestor = obtenerUsuarioPorRut(rutGestor);
      if (!gestor.encontrado) return { success: false, message: "Error de sesión." };

      // 2. Identificar al Beneficiario
      var rutTarget = rutBeneficiario ? cleanRut(rutBeneficiario) : rutLimpioGestor;
      var esGestionDirigente = (rutTarget !== rutLimpioGestor);
      var beneficiario;

      if (!esGestionDirigente) {
        beneficiario = gestor;
      } else {
        beneficiario = obtenerUsuarioPorRut(rutBeneficiario);
        if (!beneficiario.encontrado) return { success: false, message: "RUT del socio no encontrado." };
      }

      // 3. Validar préstamos activos del mismo tipo base
      var dataPrestamos = sheetPrestamos.getDataRange().getDisplayValues();
      var tipoBaseNuevo = _familiaPrestamo(tipo);

      for (var k = 1; k < dataPrestamos.length; k++) {
        var row = dataPrestamos[k];
        var rowRut   = cleanRut(row[COL_PRES.RUT]);
        var rowEstado= row[COL_PRES.ESTADO];
        var tipoBaseExistente = _familiaPrestamo(row[COL_PRES.TIPO]);

        if (rowRut === cleanRut(beneficiario.rut) &&
            ["Solicitado","Enviado","Vigente"].indexOf(rowEstado) !== -1 &&
            tipoBaseExistente === tipoBaseNuevo) {
          var nombrePrestamo = (tipoBaseNuevo === 'Personal') ? 'Préstamo Personal' : 'préstamo de ' + tipoBaseNuevo;
          return {
            success: false,
            message: 'Tienes un ' + nombrePrestamo + ' en estado "' + rowEstado + '". Podrás solicitar uno nuevo apenas ese préstamo esté Pagado o Rechazado.'
          };
        }
      }

      // 4. Calcular monto
      var montoTexto = "$0";
      if (_familiaPrestamo(tipo) === 'Personal') {
        montoTexto = (tipo.includes('Opcion B') || tipo.includes('Opción B')) ? "$400.000" : "$300.000";
      } else if (tipo.includes('Vacaciones')) {
        montoTexto = (tipo.includes('Opcion B') || tipo.includes('Opción B')) ? "$300.000" : "$200.000";
      }

      // 5. Calcular fechas
      var fechaSolicitud = new Date();
      var diaSolicitud = fechaSolicitud.getDate();
      var idUnico = Utilities.getUuid();
      var fechaInicioPago = new Date(fechaSolicitud);

      if (diaSolicitud > 24) fechaInicioPago.setMonth(fechaInicioPago.getMonth() + 1);

      var fechaTermino = new Date(fechaInicioPago);
      var numCuotas = parseInt(cuotas);
      if (!isNaN(numCuotas)) {
        fechaTermino.setMonth(fechaTermino.getMonth() + numCuotas);
        fechaTermino = new Date(fechaTermino.getFullYear(), fechaTermino.getMonth() + 1, 0);
      }

      var gestion       = esGestionDirigente ? "Dirigente" : "Socio";
      var nomDirigente  = esGestionDirigente ? gestor.nombre : "";
      var correoDirigente = esGestionDirigente ? gestor.correo : "";

      // 5.5. Subir comprobante (obligatorio para Vacaciones)
      var urlComprobanteVac = "";
      if (tipo.includes('Vacaciones')) {
        if (!comprobanteData || !comprobanteData.base64) {
          return { success: false, message: "Debes adjuntar tu solicitud de vacaciones para este tipo de préstamo." };
        }
        try {
          var carpetaVac = CONFIG.CARPETAS.PRESTAMOS_VACACIONES;
          if (carpetaVac) {
            var nombreArch = 'CompVac_' + beneficiario.rut + '_' + Utilities.formatDate(fechaSolicitud, Session.getScriptTimeZone(), 'yyyyMMddHHmm');
            var correosVac = [];
            if (esCorreoValido(beneficiario.correo)) correosVac.push({ correo: beneficiario.correo, tipo: 'beneficiario', nombre: beneficiario.nombre });
            // El gestor no va acá: lo cubre el reparto por rol de más abajo, con
            // su cuenta institucional de CUENTAS_VALIDAS. Ver la nota en
            // validarCorreosParaPermisos() (Global.js) — el acceso a documentos
            // de terceros se ata al cargo, no al Gmail personal del dirigente.
            var resSubida = subirArchivoConPermisos(comprobanteData, carpetaVac, nombreArch, correosVac, []);
            if (resSubida.success) {
              urlComprobanteVac = resSubida.url;
              // REPLEGAL queda FUERA del reparto por Drive: sus casillas no son
              // cuentas Google y todo permiso silencioso hacia ellas es rechazado.
              // Reciben el comprobante adjunto por correo (más abajo).
              ['DIRIGENTE', 'DIRECTORIO', 'ADMIN'].forEach(function(rol) {
                compartirArchivoConRol(resSubida.fileId, rol, 'leer');
              });
            } else {
              Logger.log('⚠️ Error al subir comprobante vacaciones: ' + resSubida.mensajeError);
            }
          } else {
            Logger.log('⚠️ PRESTAMOS_VACACIONES no configurado en CONFIG_CARPETAS. Ejecuta inicializarConfiguracion().');
          }
        } catch (eUpload) { Logger.log('⚠️ Excepción subiendo comprobante vacaciones: ' + eUpload); }
      }

      // 6. Guardar en BD
      var newRow = [];
      newRow[COL_PRES.ID]                          = idUnico;
      newRow[COL_PRES.FECHA]                       = fechaSolicitud;
      newRow[COL_PRES.RUT]                         = beneficiario.rut;
      newRow[COL_PRES.NOMBRE]                      = beneficiario.nombre;
      newRow[COL_PRES.CORREO]                      = beneficiario.correo;
      newRow[COL_PRES.TIPO]                        = tipo;
      newRow[COL_PRES.MONTO]                       = "'" + montoTexto;
      newRow[COL_PRES.CUOTAS]                      = cuotas;
      newRow[COL_PRES.URL_COMPROBANTE_VACACIONES]  = urlComprobanteVac;
      newRow[COL_PRES.MEDIO_PAGO]                  = medioPago;
      newRow[COL_PRES.ESTADO]                      = "Solicitado";
      newRow[COL_PRES.FECHA_TERMINO]               = fechaTermino;
      newRow[COL_PRES.GESTION]                     = gestion;
      newRow[COL_PRES.NOMBRE_DIRIGENTE]            = nomDirigente;
      newRow[COL_PRES.CORREO_DIRIGENTE]            = correoDirigente;
      newRow[COL_PRES.INFORME]                     = "";
      // Evidencia de consentimiento: se guarda la marca de tiempo generada
      // por el propio servidor (no la del cliente), para que quede como
      // respaldo confiable ante una eventual denuncia ante la DT.
      // La guarda !== undefined evita el fallo silencioso de escribir en
      // newRow[undefined] si el entorno todavía no corrió
      // _configurarPropiedadesPrestamosAutorizacionDT() (config_local.js).
      if (COL_PRES.AUTORIZACION_DT !== undefined && COL_PRES.AUTORIZACION_DT_FECHA !== undefined) {
        newRow[COL_PRES.AUTORIZACION_DT]           = "Sí";
        newRow[COL_PRES.AUTORIZACION_DT_FECHA]     = fechaSolicitud;
      } else {
        Logger.log('⚠️ CONFIG.COLUMNAS.PRESTAMOS sin AUTORIZACION_DT/AUTORIZACION_DT_FECHA: ' +
                   'la solicitud se guardó SIN la evidencia de consentimiento. ' +
                   'Ejecuta _configurarPropiedadesPrestamosAutorizacionDT() en el editor GAS.');
      }
      sheetPrestamos.appendRow(newRow);

      // 7. Enviar correos
      if (esCorreoValido(beneficiario.correo)) {
        // El saludo cambia según quién hizo la gestión:
        //  - a nombre propio: se le habla al socio como autor de la solicitud.
        //  - gestión de un dirigente: se conserva el "a tu nombre" (no fue él quien la ingresó).
        var saludoBeneficiario = esGestionDirigente
          ? "Hola <strong>" + beneficiario.nombre + "</strong>, se ha ingresado una solicitud de préstamo a tu nombre."
          : "Hola <strong>" + beneficiario.nombre + "</strong>, has realizado correctamente una solicitud de préstamo.";

        enviarCorreoEstilizado(
          beneficiario.correo,
          "Solicitud de Préstamo - Sindicato SLIM n°3",
          "Solicitud de Préstamo Ingresada",
          saludoBeneficiario + " Revisa a continuación el detalle y las condiciones de este beneficio." +
            _bloqueCondicionesPrestamo(),
          {
            "FECHA SOLICITUD": Utilities.formatDate(fechaSolicitud, Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm"),
            "RUT": formatRutServer(beneficiario.rut),
            "NOMBRE": beneficiario.nombre,
            "TIPO PRÉSTAMO": tipo,
            "MONTO": montoTexto,
            "CUOTAS": cuotas,
            "MEDIO PAGO": medioPago,
            "FECHA TÉRMINO": Utilities.formatDate(fechaTermino, Session.getScriptTimeZone(), "dd/MM/yyyy"),
            "GESTION": gestion,
            "NOMBRE DIRIGENTE": nomDirigente || ""
          },
          "#2563eb"
        );
      }

      if (esGestionDirigente && esCorreoValido(correoDirigente) && correoDirigente !== beneficiario.correo) {
        enviarCorreoEstilizado(
          gestor.correo,
          "Respaldo Gestión Préstamo - Sindicato SLIM n°3",
          "Solicitud de Préstamo Creada",
          "Has ingresado una solicitud de préstamo para el socio <strong>" + beneficiario.nombre + "</strong>.",
          {
            "FECHA SOLICITUD": Utilities.formatDate(fechaSolicitud, Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm"),
            "RUT SOCIO": formatRutServer(beneficiario.rut),
            "NOMBRE SOCIO": beneficiario.nombre,
            "TIPO PRÉSTAMO": tipo,
            "MONTO": montoTexto,
            "CUOTAS": cuotas,
            "FECHA TÉRMINO": Utilities.formatDate(fechaTermino, Session.getScriptTimeZone(), "dd/MM/yyyy"),
            "GESTION": "Dirigente"
          },
          "#475569"
        );
      }

      // Comprobante de vacaciones para REPLEGAL, adjunto.
      //
      // Este módulo es el caso distinto de los cuatro: REPLEGAL no recibía
      // ninguna notificación de préstamos, sólo el permiso de Drive sobre el
      // comprobante — y ese permiso nunca se pudo otorgar, porque sus casillas
      // no son cuentas Google. En la práctica llevaban desde siempre sin ver
      // ningún comprobante de vacaciones. Acá el correo es nuevo, no un
      // complemento de otro que ya existía.
      if (urlComprobanteVac) {
        enviarDocumentosARepLegalAdjuntos(
          [urlComprobanteVac],
          "Comprobante de Vacaciones — Solicitud de Préstamo — Sindicato SLIM n°3",
          "Comprobante de Vacaciones",
          "Se adjunta el comprobante de aprobación de vacaciones que respalda la solicitud de préstamo de <strong>" + beneficiario.nombre + "</strong>.",
          {
            "FECHA SOLICITUD": Utilities.formatDate(fechaSolicitud, Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm"),
            "RUT": formatRutServer(beneficiario.rut),
            "NOMBRE": beneficiario.nombre,
            "TIPO PRÉSTAMO": tipo,
            "MONTO": montoTexto,
            "CUOTAS": cuotas,
            "GESTION": gestion,
            "NOMBRE DIRIGENTE": nomDirigente || ""
          },
          "#2563eb"
        );
      }

      return { success: true, message: "Solicitud creada exitosamente." };

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
 * Sincronización automática: Validación → BD → Notificación
 * Trigger: diario a las 8 AM
 */
function procesarValidacionPrestamos(e) {
  if (activadorFueraDeProduccion_(e, 'procesarValidacionPrestamos')) return;
  var lock = LockService.getScriptLock();
  if (lock.tryLock(60000)) {
    try {
      var ss = getSpreadsheet('PRESTAMOS');
      var sheetValidacion = ss.getSheetByName(CONFIG.HOJAS.VALIDACION_PRESTAMOS);
      var sheetBD = getSheet('PRESTAMOS', 'PRESTAMOS');

      if (!sheetValidacion) {
        console.warn("⚠️ La hoja 'Validación-Prestamos' no existe. Creándola...");
        var nuevaHoja = ss.insertSheet(CONFIG.HOJAS.VALIDACION_PRESTAMOS);
        nuevaHoja.appendRow(["ID","Fecha","RUT","Nombre","Validación","Observación","Nombre Informe"]);
        return;
      }
      if (!sheetBD) { console.error("❌ No se encontró la hoja BD_PRESTAMOS."); return; }

      var dataValidacion = sheetValidacion.getDataRange().getValues();
      var dataBD = sheetBD.getDataRange().getValues();
      var COL_BD = CONFIG.COLUMNAS.PRESTAMOS;
      var VAL_COL = { ID: 0, VALIDACION: 4, OBS: 5 };
      var COL_INFORME = COL_BD.INFORME;
      var procesadosCount = 0;

      for (var i = 1; i < dataValidacion.length; i++) {
        var idSolicitud = String(dataValidacion[i][VAL_COL.ID]).trim();
        var resultadoValidacion = String(dataValidacion[i][VAL_COL.VALIDACION]).toUpperCase().trim();
        var observacionAdmin = String(dataValidacion[i][VAL_COL.OBS]);

        if (!idSolicitud || (resultadoValidacion !== "ACEPTADO" && resultadoValidacion !== "RECHAZADO")) continue;

        for (var j = 1; j < dataBD.length; j++) {
          var idBD = String(dataBD[j][COL_BD.ID]).trim();
          var informeEnviado = String(dataBD[j][COL_INFORME]);

          if (idBD !== idSolicitud) continue;
          if (informeEnviado === "OK") { console.log('ℹ️ ID ' + idSolicitud + ': Ya procesado.'); continue; }

          var nuevoEstado = resultadoValidacion === "ACEPTADO" ? "Vigente" : "Rechazado";
          var tituloCorreo = resultadoValidacion === "ACEPTADO" ? "Solicitud Aprobada" : "Solicitud Rechazada";
          var colorCorreo  = resultadoValidacion === "ACEPTADO" ? "#15803d" : "#b91c1c";
          var mensajeIntro = resultadoValidacion === "ACEPTADO"
            ? "Nos complace informarte que tu solicitud de préstamo ha sido <strong>APROBADA</strong> por la empresa."
            : "Te informamos que tu solicitud de préstamo ha sido <strong>RECHAZADA</strong> por la empresa.";

          sheetBD.getRange(j + 1, COL_BD.ESTADO + 1).setValue(nuevoEstado);

          var correoUsuario = dataBD[j][COL_BD.CORREO];
          var nombreUsuario = dataBD[j][COL_BD.NOMBRE];

          if (esCorreoValido(correoUsuario)) {
            var fechaTerminoStr = "S/D";
            var fechaTerminoRaw = dataBD[j][COL_BD.FECHA_TERMINO];
            if (fechaTerminoRaw) {
              try {
                var ftObj = new Date(fechaTerminoRaw);
                if (!isNaN(ftObj.getTime())) fechaTerminoStr = Utilities.formatDate(ftObj, Session.getScriptTimeZone(), "dd/MM/yyyy");
              } catch (e) {}
            }

            enviarCorreoEstilizado(
              correoUsuario,
              "Resultado Solicitud Préstamo - Sindicato SLIM n°3",
              tituloCorreo,
              // Mensaje base + explicación breve según el estado (fuente: Modulo mensajesEstado.js)
              "Hola <strong>" + nombreUsuario + "</strong>, " + mensajeIntro +
                bloqueExplicacionEstado(obtenerMensajeEstado('PRESTAMOS', nuevoEstado)),
              {
                "FECHA SOLICITUD": Utilities.formatDate(new Date(dataBD[j][COL_BD.FECHA]), Session.getScriptTimeZone(), "dd/MM/yyyy"),
                "RUT": formatRutServer(dataBD[j][COL_BD.RUT]),
                "NOMBRE": nombreUsuario,
                "TIPO PRÉSTAMO": nombreTipoPrestamo(dataBD[j][COL_BD.TIPO]),
                "MONTO": dataBD[j][COL_BD.MONTO] || "$0",
                "ESTADO": nuevoEstado.toUpperCase(),
                "FECHA TÉRMINO": fechaTerminoStr,
                "OBSERVACIÓN": observacionAdmin || "Sin observaciones",
                "RESULTADO": resultadoValidacion
              },
              colorCorreo
            );
            sheetBD.getRange(j + 1, COL_INFORME + 1).setValue("OK");
            procesadosCount++;
          } else {
            sheetBD.getRange(j + 1, COL_INFORME + 1).setValue("ERROR_NO_MAIL");
          }
          break;
        }
      }

      console.log(procesadosCount > 0
        ? '✅ Resumen final: ' + procesadosCount + ' solicitudes nuevas procesadas.'
        : 'ℹ️ No hay solicitudes nuevas para procesar.');

    } catch (e) {
      console.error("❌ Error en procesarValidacionPrestamos: " + e.toString());
    } finally {
      lock.releaseLock();
    }
  }
}

/**
 * Obtiene el historial de préstamos de un usuario
 */
function obtenerHistorialPrestamos(rutInput) {
  try {
    var sheet = getSheet('PRESTAMOS', 'PRESTAMOS');
    var COL = CONFIG.COLUMNAS.PRESTAMOS;

    if (!sheet) return { success: false, message: "Hoja no encontrada" };
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return { success: true, registros: [] };

    var lastCol = sheet.getLastColumn();
    var data = sheet.getRange(2, 1, lastRow - 1, lastCol).getDisplayValues();
    var rutLimpio = cleanRut(rutInput);
    var registros = [];

    for (var i = 0; i < data.length; i++) {
      var row = data[i];
      if (!row[COL.RUT]) continue;
      if (cleanRut(row[COL.RUT]) !== rutLimpio) continue;

      registros.push({
        id:                        row[COL.ID]                        || "",
        fecha:                     formatearFechaConHora(row[COL.FECHA]) || "",
        tipo:                      nombreTipoPrestamo(row[COL.TIPO])  || "Préstamo",
        monto:                     row[COL.MONTO]                     || "$0",
        cuotas:                    row[COL.CUOTAS]                    || "S/D",
        medio:                     row[COL.MEDIO_PAGO]                || "S/D",
        estado:                    row[COL.ESTADO]                    || "Solicitado",
        observacion:               row[COL.OBSERVACION]               || "",
        fechaTermino:              formatearFechaSinHora(row[COL.FECHA_TERMINO]),
        gestion:                   row[COL.GESTION]                   || "Socio",
        nomDirigente:              row[COL.NOMBRE_DIRIGENTE]          || "",
        urlComprobanteVacaciones:  row[COL.URL_COMPROBANTE_VACACIONES] || ""
      });
    }

    registros.reverse();
    return { success: true, registros: registros };

  } catch (e) {
    Logger.log('❌ ERROR en obtenerHistorialPrestamos: ' + e.toString());
    return { success: false, message: "Ocurrió un error interno. Por favor, intente más tarde o contacte al administrador." };
  }
}

/**
 * Elimina una solicitud de préstamo con respaldo histórico.
 * Para préstamos de vacaciones: elimina el archivo Drive adjunto y omite la URL del respaldo.
 *
 * @param {string} idSolicitud - ID de la solicitud a eliminar
 * @param {string} rutSolicitante - RUT de quien ejecuta la eliminación.
 *        Obligatorio: solo el titular del registro o un rol gestor
 *        (DIRIGENTE/DIRECTORIO/ADMIN) pueden eliminarlo. Se registra además en
 *        la hoja de respaldo junto a la marca temporal.
 */
function eliminarSolicitud(idSolicitud, rutSolicitante) {
  _ensureConfig();
  var lock = LockService.getScriptLock();
  if (lock.tryLock(30000)) {
    try {
      var ss    = getSpreadsheet('PRESTAMOS');
      var sheet = getSheet('PRESTAMOS', 'PRESTAMOS');
      if (!sheet) return { success: false, message: "No se encontró la hoja de préstamos." };

      var data = sheet.getDataRange().getValues();
      var COL  = CONFIG.COLUMNAS.PRESTAMOS;

      for (var i = 1; i < data.length; i++) {
        if (String(data[i][COL.ID]) !== String(idSolicitud)) continue;

        // Autorización antes que cualquier regla de negocio: quien no puede
        // eliminar tampoco debe enterarse del estado del registro.
        var permiso = _autorizarEliminacionRegistro(rutSolicitante, data[i][COL.RUT]);
        if (!permiso.autorizado) {
          Logger.log('⚠️ eliminarSolicitud: intento no autorizado — id=' + idSolicitud +
                     ', rut=' + rutSolicitante + ' (' + permiso.motivo + ')');
          return { success: false, message: MENSAJE_ELIMINACION_NO_AUTORIZADA };
        }

        var sheetEliminados = ss.getSheetByName(HOJA_REGISTROS_ELIMINADOS);
        if (!sheetEliminados) return { success: false, message: "Error crítico: No existe la hoja de respaldo." };

        // La fila de respaldo CONSERVA la URL del comprobante de vacaciones.
        // Antes se vaciaba, y era coherente mientras el archivo se mandaba a la
        // papelera: guardar un enlace muerto no servía de nada. Ahora que el
        // archivo se conserva (ver más abajo), vaciarla dejaría el respaldo sin
        // puntero al documento que sigue existiendo, y el archivo quedaría fuera
        // del alcance de la reconciliación de permisos por no tener URL que leer.
        var rowBackup = data[i].slice();

        // Trazabilidad de la eliminación: cuándo y quién. Son las únicas
        // columnas de la hoja de respaldo que no existen en BD_PRESTAMOS —
        // la fila copiada por sí sola no puede responder ninguna de las dos.
        // La fecha es la del servidor, nunca la del cliente. Guarda
        // !== undefined por si el entorno aún no corrió
        // _configurarRegistrosEliminadosPrestamos().
        var COL_ELIM = CONFIG.COLUMNAS.PRESTAMOS_ELIMINADOS || {};
        if (COL_ELIM.FECHA_ELIMINACION !== undefined) {
          var autor = _identificarAutorEliminacion(rutSolicitante);
          rowBackup[COL_ELIM.FECHA_ELIMINACION]    = new Date();
          rowBackup[COL_ELIM.ELIMINADO_POR_RUT]    = autor.rut;
          rowBackup[COL_ELIM.ELIMINADO_POR_NOMBRE] = autor.nombre;
          rowBackup[COL_ELIM.ELIMINADO_POR_ROL]    = autor.rol;
        } else {
          Logger.log('⚠️ CONFIG.COLUMNAS.PRESTAMOS_ELIMINADOS no configurada: ' +
                     'el respaldo de la solicitud ' + idSolicitud + ' quedó sin trazabilidad. ' +
                     'Ejecuta _configurarRegistrosEliminadosPrestamos() en el editor GAS.');
        }

        sheetEliminados.appendRow(rowBackup);

        // El archivo de Drive NO se elimina. Antes se mandaba a la papelera con
        // setTrashed(true), y era el único de los tres módulos con respaldo que
        // lo hacía — justificaciones y apelaciones nunca lo tocaron. Esa
        // asimetría no era deliberada.
        //
        // Se unificó hacia conservarlo (2026-08-25): la fila se respalda en
        // "Registros-eliminados" precisamente para poder recuperarla, y si el
        // archivo desaparece, la URL guardada en ese respaldo apunta a la nada.
        // Se perdía justo la evidencia que el respaldo quería conservar.
        //
        // Los archivos de registros eliminados siguen administrados: las tres
        // pestañas "Registros-eliminados" están en CATALOGO_ARCHIVOS_MODULOS
        // (Modulo permisosArchivos.js), así que la reconciliación les sigue
        // actualizando el acceso del socio y revocando su correo anterior.

        sheet.deleteRow(i + 1);
        return { success: true, message: "Registro eliminado y respaldado correctamente." };
      }

      return { success: false, message: "No encontrado." };
    } catch (e) {
      Logger.log('❌ Error en eliminarSolicitud: ' + e);
      return { success: false, message: "Ocurrió un error interno. Por favor, intente más tarde o contacte al administrador." };
    } finally {
      lock.releaseLock();
    }
  } else {
    return { success: false, message: "Servidor ocupado." };
  }
}

/**
 * Modifica cuotas/medio de pago de una solicitud en estado "Solicitado"
 */
function modificarSolicitud(idSolicitud, nuevasCuotas, nuevoMedio) {
  var lock = LockService.getScriptLock();
  if (lock.tryLock(30000)) {
    try {
      var sheet = getSheet('PRESTAMOS', 'PRESTAMOS');
      var data = sheet.getDataRange().getValues();
      var COL = CONFIG.COLUMNAS.PRESTAMOS;

      for (var i = 1; i < data.length; i++) {
        if (String(data[i][COL.ID]) === String(idSolicitud)) {
          var estado = String(data[i][COL.ESTADO]);
          if (estado !== "Solicitado") return { success: false, message: "No se puede editar. Estado: " + estado };

          var fechaSolicitud = new Date(data[i][COL.FECHA]);
          var diaSolicitud = fechaSolicitud.getDate();
          var fechaInicioPago = new Date(fechaSolicitud);
          if (diaSolicitud > 24) fechaInicioPago.setMonth(fechaInicioPago.getMonth() + 1);

          var fechaTermino = new Date(fechaInicioPago);
          fechaTermino.setMonth(fechaTermino.getMonth() + parseInt(nuevasCuotas));
          fechaTermino = new Date(fechaTermino.getFullYear(), fechaTermino.getMonth() + 1, 0);

          sheet.getRange(i + 1, COL.CUOTAS + 1).setValue(nuevasCuotas);
          sheet.getRange(i + 1, COL.MEDIO_PAGO + 1).setValue(nuevoMedio);
          sheet.getRange(i + 1, COL.FECHA_TERMINO + 1).setValue(fechaTermino);
          return { success: true, message: "Modificado correctamente." };
        }
      }
      return { success: false, message: "No encontrado." };
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
 * Trigger diario a las 8 AM: cambia préstamos "Vigente" → "Pagado" si venció fecha de término
 */
function verificarCambiosPrestamos(e) {
  if (activadorFueraDeProduccion_(e, 'verificarCambiosPrestamos')) return;
  try {
    var sheet = getSheet('PRESTAMOS', 'PRESTAMOS');
    if (!sheet) { console.error("❌ No se pudo acceder a la hoja BD_PRESTAMOS"); return { success: false }; }

    var data = sheet.getDataRange().getValues();
    var COL = CONFIG.COLUMNAS.PRESTAMOS;
    var hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    var prestamosActualizados = 0;

    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (String(row[COL.ESTADO]).trim() !== "Vigente") continue;
      if (!row[COL.FECHA_TERMINO]) continue;

      var fechaTermino;
      try {
        fechaTermino = new Date(row[COL.FECHA_TERMINO]);
        fechaTermino.setHours(0, 0, 0, 0);
      } catch (e) { continue; }
      if (isNaN(fechaTermino.getTime())) continue;
      if (hoy <= fechaTermino) continue;

      sheet.getRange(i + 1, COL.ESTADO + 1).setValue("Pagado");
      prestamosActualizados++;
    }

    console.log(prestamosActualizados > 0
      ? '📊 RESUMEN: ' + prestamosActualizados + ' préstamo(s) actualizado(s) a "Pagado"'
      : 'ℹ️ No hay préstamos que actualizar.');

    return { success: true, prestamosActualizados: prestamosActualizados };

  } catch (e) {
    console.error("❌ Error verificando préstamos: " + e.toString());
    return { success: false, error: "Ocurrió un error interno. Por favor, intente más tarde o contacte al administrador." };
  }
}
