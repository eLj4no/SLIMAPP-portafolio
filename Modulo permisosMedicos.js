// ==========================================
// MODULO_PERMISOS_MEDICOS.GS — Permisos médicos laborales
// ==========================================

/**
 * Envía la notificación consolidada de un permiso médico.
 *
 * Replica la arquitectura de "Trámites y Solicitudes a la Empresa"
 * (Modulo gestionesEmpresa.js): UN solo correo por evento, con
 *
 *   Para → REPLEGAL
 *   CC   → ADMIN + DIRECTORIO + socio (+ dirigente gestor, si aplica)
 *
 * Cuando hay documento y REPLEGAL ya lo recibió adjunto en su propio correo,
 * REPLEGAL sale de acá y "Para" pasa a ADMIN + DIRECTORIO (ver el parámetro
 * repLegalYaNotificado).
 *
 * Antes este módulo emitía hasta 4 correos separados por solicitud (uno al
 * socio, uno por cada representante legal, uno de respaldo al dirigente y una
 * copia al socio). Todos quedan reemplazados por esta única llamada, de modo
 * que los destinatarios comparten un mismo hilo y pueden responder a todos.
 *
 * El dirigente que gestiona a nombre del socio va en CC — antes recibía un
 * cuarto correo aparte y quedarse sin su respaldo sería una regresión.
 *
 * @param {string} correoSocio  Correo del beneficiario (puede venir vacío).
 * @param {string} correoGestor Correo del dirigente gestor, "" si gestiona el socio.
 * @param {boolean} repLegalYaNotificado true cuando REPLEGAL ya recibió este
 *   mismo evento con el documento adjunto (enviarDocumentosARepLegalAdjuntos).
 *   Entonces se le deja FUERA de este correo: el de acá lleva el botón "Ver
 *   Documento" con un enlace de Drive que sus casillas no pueden abrir, y les
 *   llegaban los dos. "Para" pasa a ADMIN + DIRECTORIO.
 * @returns {{success:boolean, destinatarios:string[], cc:string[], message:string}}
 */
function _notificarPermisoMedico(asunto, titulo, mensaje, detalles, colorTema, correoSocio, correoGestor, repLegalYaNotificado) {
  var correosAdmin      = obtenerCorreosAdmin();
  var correosDirectorio = obtenerCorreosDirectorio();
  var para              = repLegalYaNotificado ? [] : obtenerCorreosRepLegal();

  // Sin REPLEGAL activo el correo se quedaría sin "Para" y no saldría para
  // nadie — tampoco para el socio, que viaja en CC. Se degrada a los roles de
  // supervisión antes que perder la notificación por completo. Es también el
  // camino normal cuando REPLEGAL ya recibió su copia con el adjunto.
  if (para.length === 0) {
    if (!repLegalYaNotificado) {
      Logger.log('⚠️ _notificarPermisoMedico: sin REPLEGAL ACTIVO en CUENTAS_VALIDAS; "Para" degradado a ADMIN/DIRECTORIO.');
    }
    para = correosAdmin.concat(correosDirectorio);
  }

  var cc = correosAdmin.concat(correosDirectorio);
  if (esCorreoValido(correoSocio))  cc.push(correoSocio);
  if (esCorreoValido(correoGestor)) cc.push(correoGestor);

  // enviarCorreoEstilizadoConCopia() deduplica el CC y descarta los que ya
  // están en "Para" (relevante cuando hubo degradación).
  return enviarCorreoEstilizadoConCopia(para, cc, asunto, titulo, mensaje, detalles, colorTema);
}

// ==========================================
// EVIDENCIA DE NOTIFICACIÓN
// ==========================================

/**
 * Momento desde el cual EXISTEN las columnas de evidencia. Formato DD/MM/YYYY
 * con hora, que es el que parsearFechaFlexible() interpreta de forma nativa.
 *
 * Todo permiso anterior a este corte fue notificado por un código que todavía no
 * escribía evidencia, así que su ausencia no prueba nada y no debe reportarse
 * como hallazgo. verificarEvidenciaNotificacionPermisos() los cuenta aparte.
 *
 * ⚠️ LLEVA HORA, NO SOLO FECHA. La primera versión usaba `'2026-08-31'`, que se
 * resuelve a la medianoche de ese día, y el despliegue ocurrió a media tarde:
 * los 12 permisos ingresados entre las 00:00 y las 17:46 quedaron auditados
 * contra una regla que todavía no existía y salieron reportados como hallazgo.
 * Doce falsas alarmas en la primera corrida — que es justo lo que vuelve inútil
 * a una herramienta de verificación.
 *
 * Se usa la hora del ÚLTIMO despliegue del día y no la del primer push: entre
 * ambos hay una ventana en la que no todos los caminos corrían el código nuevo.
 * Preferimos omitir alguna fila de esa ventana antes que volver a inventar un
 * hallazgo; una fila sin avisar la recoge igual el trigger de reintento.
 *
 * Al moverlo, ajustar a la hora real del despliegue en PRODUCCIÓN. Si queda en
 * el futuro, el informe no reportará nada nunca.
 */
var FECHA_INICIO_EVIDENCIA_NOTIFICACION = '31/08/2026 17:46';

/**
 * Marca una fila como notificada y deja constancia de QUÉ se envió y CUÁNDO.
 *
 * Por qué existe: NOTIFICADO_REP_LEGAL era la única prueba de que un permiso
 * fue avisado, y esa columna puede mentir. Se edita a mano en la planilla, y
 * basta un TRUE copiado de la fila de arriba para que un permiso quede marcado
 * como notificado sin que ningún correo haya salido. El trigger de reintento
 * tampoco lo detecta: su criterio para saltar una fila es justamente esa marca.
 * Resultado: un permiso que el socio ve en su historial y que los representantes
 * legales de la empresa nunca recibieron.
 *
 * La evidencia cierra ese hueco sin mirar el buzón de correo. FECHA_NOTIFICACION
 * lleva el reloj del SERVIDOR y DESTINATARIOS_NOTIFICACION la lista real de
 * direcciones que devolvió el envío. Una persona que escribe TRUE a mano —o que
 * carga una fila entera a mano— no va a fabricar una marca de tiempo del
 * servidor ni una lista de correos institucionales: la fila queda delatada sola.
 *
 * No prueba la ENTREGA (eso solo lo sabe el servidor de correo del destinatario);
 * prueba que este código ejecutó el envío. Es exactamente la diferencia que
 * necesitábamos distinguir.
 *
 * Las dos columnas se escriben con guarda `!== undefined`: hasta que se ejecute
 * _configurarEvidenciaNotificacionPermisos() en cada proyecto, los índices son
 * undefined y escribir ahí no lanza error, simplemente pierde el dato en
 * silencio (ver la regla de columnas nuevas en CLAUDE.md).
 *
 * @param {Sheet}  sheet       Hoja de permisos médicos.
 * @param {number} filaNum     Fila 1-based a marcar.
 * @param {Object} COL         CONFIG.COLUMNAS.PERMISOS_MEDICOS.
 * @param {string} correoSocio Correo del beneficiario, para el espejo NOTIFICADO_SOCIO.
 * @param {Object} envio       Resultado de _notificarPermisoMedico().
 */
function _marcarPermisoNotificado(sheet, filaNum, COL, correoSocio, envio) {
  sheet.getRange(filaNum, COL.NOTIFICADO_REP_LEGAL + 1).setValue(true);
  sheet.getRange(filaNum, COL.NOTIFICADO_SOCIO + 1)
    .setValue(esCorreoValido(correoSocio) ? true : "SIN_CORREO");

  if (COL.FECHA_NOTIFICACION !== undefined) {
    sheet.getRange(filaNum, COL.FECHA_NOTIFICACION + 1).setValue(new Date());
  } else {
    Logger.log('⚠️ CONFIG sin FECHA_NOTIFICACION — ejecuta _configurarEvidenciaNotificacionPermisos(). La evidencia NO se guardó.');
  }

  if (COL.DESTINATARIOS_NOTIFICACION !== undefined) {
    sheet.getRange(filaNum, COL.DESTINATARIOS_NOTIFICACION + 1)
      .setValue(_resumirDestinatarios(envio));
  } else {
    Logger.log('⚠️ CONFIG sin DESTINATARIOS_NOTIFICACION — ejecuta _configurarEvidenciaNotificacionPermisos(). La evidencia NO se guardó.');
  }
}

/**
 * Formatea los destinatarios reales de un envío para dejarlos en la hoja.
 * Se guardan las direcciones que devolvió enviarCorreoEstilizadoConCopia(), ya
 * validadas y deduplicadas — no las que se pretendía usar.
 */
function _resumirDestinatarios(envio) {
  var para = (envio && envio.destinatarios) || [];
  var cc   = (envio && envio.cc) || [];
  var adjunto = (envio && envio.adjuntoRepLegal) || [];
  var texto = 'Para: ' + (para.length ? para.join(', ') : '(ninguno)');
  if (cc.length) texto += ' | CC: ' + cc.join(', ');
  // REPLEGAL ya no viaja en el consolidado cuando recibió el documento adjunto
  // en su propio correo; sin esta parte la evidencia parecería decir que nunca
  // se les avisó.
  if (adjunto.length) texto += ' | Adjunto: ' + adjunto.join(', ');
  return texto;
}

/**
 * Solicita un permiso médico
 */
function solicitarPermisoMedico(rutGestor, tipoPermiso, fechaInicio, motivo, rutBeneficiario, archivoData) {
  _ensureConfig();
  if (!CONFIG || !CONFIG.CARPETAS) return { success: false, message: 'Error de configuración del sistema. Contacta al administrador.' };
  var correosRepLegal = obtenerCorreosRepLegal();
  var CARPETA_ID = CONFIG.CARPETAS.PERMISOS_MEDICOS;

  var lock = LockService.getScriptLock();
  if (lock.tryLock(30000)) {
    try {
      var sheetPermisos= getSheet('PERMISOS_MEDICOS', 'PERMISOS_MEDICOS');
      var COL_PERM = CONFIG.COLUMNAS.PERMISOS_MEDICOS;

      // Validar gestor (lookup indexado con caché, igual que
      // apelaciones/justificaciones — evita escanear toda la hoja USUARIOS)
      var rutLimpioGestor = cleanRut(rutGestor);
      var gestor = obtenerUsuarioPorRut(rutGestor);
      if (!gestor.encontrado) return { success: false, message: "Error de sesión." };

      // Determinar beneficiario
      var rutTarget = rutBeneficiario ? cleanRut(rutBeneficiario) : rutLimpioGestor;
      var beneficiario;
      if (rutTarget === rutLimpioGestor) {
        beneficiario = gestor;
      } else {
        beneficiario = obtenerUsuarioPorRut(rutBeneficiario);
        if (!beneficiario.encontrado) return { success: false, message: "RUT del socio no encontrado." };
      }

      // Correo obligatorio — mismo requisito de entrada que "Trámites y
      // Solicitudes a la Empresa". Sin una dirección válida el permiso queda
      // registrado pero el socio no recibe nada: ni la notificación ni el
      // acceso de Drive al documento de respaldo, que se otorga con el correo
      // que tenga en ese instante. Así aparecieron las filas SIN_CORREO.
      //
      // Se valida el correo del BENEFICIARIO, no el del gestor: el que importa
      // es el de quien recibe el permiso. El dirigente que tramita a nombre de
      // un socio recibe su copia por el rol, no por esta dirección.
      //
      // El frontend ya lo exige antes de abrir el módulo, pero la webapp es
      // ANYONE_ANONYMOUS: esconder un formulario nunca es un control.
      if (!esCorreoValido(beneficiario.correo)) {
        Logger.log('⛔ solicitarPermisoMedico: beneficiario ' + cleanRut(beneficiario.rut) +
                   ' sin correo válido (' + JSON.stringify(beneficiario.correo) + '). Solicitud rechazada.');
        return {
          success: false,
          sinCorreo: true,
          message: (rutTarget === rutLimpioGestor)
            ? "Para solicitar un permiso médico necesitas tener un correo electrónico registrado: ahí llega el comprobante y el acceso a tu documento de respaldo. Regístralo en \"Mis Datos\" y vuelve a intentarlo."
            : "El socio " + beneficiario.nombre + " no tiene un correo electrónico válido registrado. Debe registrarlo en \"Mis Datos\" antes de que puedas gestionar un permiso médico a su nombre."
        };
      }

      // Validar fecha de inicio (±7 días)
      var fechaInicioObj = new Date(fechaInicio + 'T12:00:00');
      var hoy = new Date();
      hoy.setHours(0, 0, 0, 0);
      fechaInicioObj.setHours(0, 0, 0, 0);
      var diffDias = Math.floor((fechaInicioObj - hoy) / (1000 * 60 * 60 * 24));
      if (diffDias < -7 || diffDias > 7) {
        return { success: false, message: "La fecha de inicio debe estar dentro del rango de 7 días antes o después de hoy." };
      }

      var fechaInicioNormalizada = fechaInicio.trim();
      Logger.log('🔍 Validando para RUT: ' + beneficiario.rut + ' | Fecha Inicio: ' + fechaInicioNormalizada);

      // Validar permiso activo con misma fecha de inicio
      var dataPermisos = sheetPermisos.getDataRange().getDisplayValues();
      var permisoConMismaFechaInicio = null, permisoAnuladoMismaFecha = null;

      for (var k = 1; k < dataPermisos.length; k++) {
        if (cleanRut(dataPermisos[k][COL_PERM.RUT]) === cleanRut(beneficiario.rut)) {
          var fechaInicioRegistro = dataPermisos[k][COL_PERM.FECHA_INICIO];
          var fechaInicioRegistroNorm = "";
          if (fechaInicioRegistro && fechaInicioRegistro.toString().trim() !== "") {
            if (fechaInicioRegistro.toString().match(/^\d{4}-\d{2}-\d{2}$/)) {
              fechaInicioRegistroNorm = fechaInicioRegistro.toString().trim();
            } else {
              try {
                var fo = parsearFechaFlexible(fechaInicioRegistro);
                if (fo !== null) {
                  fechaInicioRegistroNorm = fo.getFullYear() + "-" + String(fo.getMonth()+1).padStart(2,'0') + "-" + String(fo.getDate()).padStart(2,'0');
                }
              } catch(e) { continue; }
            }
          }
          if (fechaInicioRegistroNorm === fechaInicioNormalizada) {
            if (dataPermisos[k][COL_PERM.ESTADO] === "Anulado") {
              permisoAnuladoMismaFecha = { id: dataPermisos[k][COL_PERM.ID] };
            } else {
              permisoConMismaFechaInicio = { id: dataPermisos[k][COL_PERM.ID], tipo: dataPermisos[k][COL_PERM.TIPO_PERMISO], estado: dataPermisos[k][COL_PERM.ESTADO] };
              break;
            }
          }
        }
      }

      if (permisoConMismaFechaInicio) {
        return { success: false, message: "❌ Ya existe un permiso médico ACTIVO con la misma fecha de inicio.\n\nID: " + permisoConMismaFechaInicio.id + "\nTipo: " + permisoConMismaFechaInicio.tipo + "\nEstado: " + permisoConMismaFechaInicio.estado + "\n\nSi cometió un error, puede anular el permiso existente desde el historial." };
      }
      if (permisoAnuladoMismaFecha) Logger.log('ℹ️ INFO: Hubo un permiso anulado para la fecha ' + fechaInicioNormalizada + ' (ID: ' + permisoAnuladoMismaFecha.id + '). Permitiendo crear uno nuevo.');

      var fechaHoyCompleta = new Date();
      var idUnico = Utilities.getUuid();
      var gestion = "Socio", nomDirigente = "", correoDirigente = "";
      if (rutTarget !== rutLimpioGestor) { gestion = "Dirigente"; nomDirigente = gestor.nombre; correoDirigente = gestor.correo; }

      var newRow = [];
      newRow[COL_PERM.ID]               = idUnico;
      newRow[COL_PERM.FECHA_SOLICITUD]  = fechaHoyCompleta;
      newRow[COL_PERM.RUT]              = beneficiario.rut;
      newRow[COL_PERM.NOMBRE]           = beneficiario.nombre;
      newRow[COL_PERM.CORREO]           = beneficiario.correo;
      newRow[COL_PERM.TIPO_PERMISO]     = tipoPermiso;
      newRow[COL_PERM.FECHA_INICIO]     = fechaInicioNormalizada;
      newRow[COL_PERM.MOTIVO_DETALLE]   = motivo;

      // Subir documento si fue adjuntado
      var urlDocFinal = "Sin documento";
      var estadoFinal = "Solicitado";
      var fechaSubidaFinal = "";

      if (archivoData && archivoData.base64) {
        var correosParaDoc = [];
        if (esCorreoValido(beneficiario.correo)) correosParaDoc.push({ correo: beneficiario.correo.trim().toLowerCase(), tipo: 'beneficiario', nombre: beneficiario.nombre });
        // El gestor no recibe permiso con su Gmail personal: lo cubre el
        // compartirArchivoConRol(..., 'DIRIGENTE', 'leer') de más abajo, con su
        // cuenta institucional. Ver la nota en validarCorreosParaPermisos().

        var resultadoSubida = subirArchivoConPermisos(archivoData, CARPETA_ID, "PERMISO-" + idUnico + "-" + cleanRut(beneficiario.rut), correosParaDoc, []);
        if (!resultadoSubida.success) return { success: false, message: "Error al subir el documento adjunto: " + resultadoSubida.mensajeError };
        urlDocFinal = resultadoSubida.url;
        if (resultadoSubida.fileId) {
          // REPLEGAL no va acá: sus casillas no son cuentas Google y el permiso
          // silencioso siempre es rechazado. Reciben el documento adjunto.
          compartirArchivoConRol(resultadoSubida.fileId, 'ADMIN',      'leer');
          compartirArchivoConRol(resultadoSubida.fileId, 'DIRIGENTE',  'leer');
          compartirArchivoConRol(resultadoSubida.fileId, 'DIRECTORIO', 'leer');
        }
        estadoFinal = "Solicitado con Documento";
        fechaSubidaFinal = fechaHoyCompleta;
      }

      newRow[COL_PERM.URL_DOCUMENTO]       = urlDocFinal;
      newRow[COL_PERM.ESTADO]              = estadoFinal;
      newRow[COL_PERM.FECHA_SUBIDA]        = fechaSubidaFinal;
      newRow[COL_PERM.NOTIFICADO_REP_LEGAL]= false;
      newRow[COL_PERM.NOTIFICADO_SOCIO]    = false;
      newRow[COL_PERM.GESTION]             = gestion;
      newRow[COL_PERM.NOMBRE_DIRIGENTE]    = nomDirigente;
      newRow[COL_PERM.CORREO_DIRIGENTE]    = correoDirigente;

      // Segunda validación anti-race-condition
      var dataPermisosPreEscritura = sheetPermisos.getDataRange().getDisplayValues();
      for (var n = 1; n < dataPermisosPreEscritura.length; n++) {
        if (cleanRut(dataPermisosPreEscritura[n][COL_PERM.RUT]) !== cleanRut(beneficiario.rut)) continue;
        var fechaInicioReg2 = dataPermisosPreEscritura[n][COL_PERM.FECHA_INICIO];
        var fechaNorm2 = "";
        if (fechaInicioReg2 && fechaInicioReg2.toString().trim() !== "") {
          if (fechaInicioReg2.toString().match(/^\d{4}-\d{2}-\d{2}$/)) { fechaNorm2 = fechaInicioReg2.toString().trim(); }
          else {
            try { var fo2 = parsearFechaFlexible(fechaInicioReg2); if (fo2 === null) continue; fechaNorm2 = fo2.getFullYear() + "-" + String(fo2.getMonth()+1).padStart(2,'0') + "-" + String(fo2.getDate()).padStart(2,'0'); } catch(e) { continue; }
          }
        }
        if (fechaNorm2 === fechaInicioNormalizada && dataPermisosPreEscritura[n][COL_PERM.ESTADO] !== "Anulado") {
          return { success: false, message: "Se detectó otra solicitud en proceso con la misma fecha de inicio. Por favor, recarga la página y verifica tu historial." };
        }
      }

      sheetPermisos.appendRow(newRow);
      var filaRegistro = sheetPermisos.getLastRow();
      Logger.log('✅ Permiso creado exitosamente. ID: ' + idUnico);

      var fechaInicioEmailStr = new Date(fechaInicio + 'T12:00:00').toLocaleDateString('es-CL', { year: 'numeric', month: 'long', day: 'numeric' });
      var tieneDoc = urlDocFinal !== "Sin documento";

      // Notificación consolidada: Para → REPLEGAL | CC → ADMIN + DIRECTORIO +
      // socio (+ dirigente gestor). Reemplaza los 4 correos separados que este
      // bloque enviaba antes; el texto es común a todos los destinatarios, así
      // que se redacta en tercera persona e incluye la instrucción al socio.
      var asuntoPermiso = tieneDoc
        ? "Nueva Solicitud de Permiso Médico con Documento - Sindicato SLIM n°3"
        : "Nueva Solicitud de Permiso Médico - Sindicato SLIM n°3";
      var tituloPermiso = tieneDoc
        ? "Permiso Médico Registrado con Documento"
        : "Permiso Médico Registrado";

      var mensajePermiso = "Se ha registrado una solicitud de permiso médico para el trabajador <strong>" + beneficiario.nombre + "</strong>.";
      if (gestion === "Dirigente") {
        mensajePermiso += " La gestión fue realizada por el dirigente <strong>" + nomDirigente + "</strong> en su nombre.";
      }

      var datosPermiso = {
        "ID": idUnico,
        "Trabajador": beneficiario.nombre,
        "RUT": formatRutServer(beneficiario.rut),
        "Tipo Permiso": tipoPermiso,
        "Fecha Inicio": fechaInicioEmailStr,
        "Motivo": motivo,
        "Estado": estadoFinal,
        "Gestión": gestion
      };
      if (gestion === "Dirigente") datosPermiso["Dirigente"] = nomDirigente;
      datosPermiso["Documento"] = tieneDoc
        ? '<a href="' + urlDocFinal + '" style="color:#10b981;text-decoration:none;font-weight:600;">Ver Documento Adjunto</a>'
        : "Pendiente - Adjuntar desde el historial una vez realizada la atención médica";

      // Mensaje base + explicación breve según el estado (fuente: Modulo mensajesEstado.js)
      var mensajeCompletoPermiso = mensajePermiso +
        bloqueExplicacionEstado(obtenerMensajeEstado('PERMISOS_MEDICOS', estadoFinal));

      // Con documento, REPLEGAL recibe ESTE aviso con el archivo adjunto, antes
      // del consolidado y en lugar de él: sus casillas no son cuentas Google y
      // el botón "Ver Documento Adjunto" del consolidado les pide un acceso que
      // Drive nunca les va a dar. Si el adjunto no sale, vuelven al consolidado
      // para que al menos se enteren del permiso.
      var adjRepLegal = tieneDoc
        ? enviarDocumentosARepLegalAdjuntos(
            [urlDocFinal], asuntoPermiso, tituloPermiso,
            mensajeCompletoPermiso, datosPermiso, "#10b981")
        : null;

      var envioPermiso = _notificarPermisoMedico(
        asuntoPermiso, tituloPermiso, mensajeCompletoPermiso,
        datosPermiso, "#10b981",
        beneficiario.correo, correoDirigente,
        !!(adjRepLegal && adjRepLegal.success)
      );
      if (adjRepLegal && adjRepLegal.success) envioPermiso.adjuntoRepLegal = adjRepLegal.destinatarios;

      // Las dos columnas de control quedan unificadas: ambas reflejan el estado
      // del único correo. Se conservan las dos para no alterar el esquema de la
      // hoja ni los filtros existentes. Si el envío falla, quedan en false y el
      // trigger de reintento se encarga.
      if (envioPermiso.success) {
        _marcarPermisoNotificado(sheetPermisos, filaRegistro, COL_PERM, beneficiario.correo, envioPermiso);
      } else {
        Logger.log("Advertencia: fallo notificación consolidada fila " + filaRegistro + " - " + envioPermiso.message);
      }

      return { success: true, message: tieneDoc ? "Permiso médico registrado con documento adjunto exitosamente." : "Permiso médico solicitado. No olvides adjuntar el documento de respaldo desde el historial." };

    } catch (e) {
      Logger.log("❌ Error en solicitarPermisoMedico: " + e.toString());
      return { success: false, message: "Ocurrió un error interno. Por favor, intente más tarde o contacte al administrador." };
    } finally {
      lock.releaseLock();
    }
  } else {
    return { success: false, message: "Servidor ocupado. Intenta nuevamente." };
  }
}

/**
 * Adjunta un documento de respaldo a un permiso médico existente
 */
function adjuntarDocumentoPermiso(idPermiso, archivoData) {
  // Asegurar que CONFIG esté inicializado: esta función puede ejecutarse
  // como primera llamada en una instancia nueva del servidor GAS, donde
  // la variable global CONFIG todavía es null (mismo patrón usado en
  // solicitarPermisoMedico y enviarApelacion).
  _ensureConfig();
  if (!CONFIG || !CONFIG.CARPETAS) {
    return { success: false, message: 'Error de configuración del sistema. Contacta al administrador.' };
  }

  var CARPETA_ID = CONFIG.CARPETAS.PERMISOS_MEDICOS;
  var correosRepLegal = obtenerCorreosRepLegal();

  var lock = LockService.getScriptLock();
  if (lock.tryLock(30000)) {
    try {
      var sheetPermisos = getSheet('PERMISOS_MEDICOS', 'PERMISOS_MEDICOS');
      var data = sheetPermisos.getDataRange().getValues();
      var COL = CONFIG.COLUMNAS.PERMISOS_MEDICOS;

      var rowIndex = -1, beneficiario = null, tipoPermiso = "", gestionTipo = "", correoGestor = "";
      for (var i = 1; i < data.length; i++) {
        if (String(data[i][COL.ID]) === String(idPermiso)) {
          rowIndex = i + 1;
          beneficiario = { nombre: data[i][COL.NOMBRE], correo: data[i][COL.CORREO], rut: data[i][COL.RUT] };
          tipoPermiso = data[i][COL.TIPO_PERMISO];
          gestionTipo = data[i][COL.GESTION];
          correoGestor = data[i][COL.CORREO_DIRIGENTE];
          break;
        }
      }
      if (rowIndex === -1) return { success: false, message: "Permiso no encontrado." };

      var esGestionDirigente = gestionTipo === "Dirigente" && esCorreoValido(correoGestor);
      var correosParaPermisos = [];
      var alertas = [];

      if (esCorreoValido(beneficiario.correo)) {
        correosParaPermisos.push({ correo: beneficiario.correo.trim().toLowerCase(), tipo: 'beneficiario', nombre: beneficiario.nombre });
      } else {
        alertas.push("El socio " + beneficiario.nombre + " no tiene correo válido. No podrá acceder al documento.");
      }
      // Igual que en el registro: el dirigente gestor accede por su cuenta
      // institucional vía compartirArchivoConRol(..., 'DIRIGENTE', 'leer'), no
      // por su Gmail personal. Ver la nota en validarCorreosParaPermisos().

      var resultadoSubida = subirArchivoConPermisos(archivoData, CARPETA_ID, "PERMISO-" + idPermiso + "-" + cleanRut(beneficiario.rut), correosParaPermisos, []);
      if (!resultadoSubida.success) return { success: false, message: resultadoSubida.mensajeError };
      if (resultadoSubida.fileId) {
        // REPLEGAL no va acá: ver el comentario en solicitarPermisoMedico().
        compartirArchivoConRol(resultadoSubida.fileId, 'ADMIN',      'leer');
        compartirArchivoConRol(resultadoSubida.fileId, 'DIRIGENTE',  'leer');
        compartirArchivoConRol(resultadoSubida.fileId, 'DIRECTORIO', 'leer');
      }

      var fechaSubida = new Date();
      var nuevoEstado = "Documento Adjuntado";
      sheetPermisos.getRange(rowIndex, COL.URL_DOCUMENTO + 1).setValue(resultadoSubida.url);
      sheetPermisos.getRange(rowIndex, COL.ESTADO + 1).setValue(nuevoEstado);
      sheetPermisos.getRange(rowIndex, COL.FECHA_SUBIDA + 1).setValue(fechaSubida);
      sheetPermisos.getRange(rowIndex, COL.NOTIFICADO_REP_LEGAL + 1).setValue(false);
      sheetPermisos.getRange(rowIndex, COL.NOTIFICADO_SOCIO + 1).setValue(false);

      // Misma ruta que en el registro: REPLEGAL recibe el aviso con el
      // documento adjunto y queda fuera del consolidado, cuyo enlace de Drive
      // no pueden abrir. Si el adjunto falla, vuelven al consolidado.
      var asuntoAdjunto  = "Documento de Permiso Médico Adjuntado - Sindicato SLIM n°3";
      var tituloAdjunto  = "Documento de Permiso Médico Disponible";
      var mensajeAdjunto = "El trabajador <strong>" + beneficiario.nombre + "</strong> ha adjuntado el documento de respaldo de su permiso médico. Ya se encuentra disponible para revisión." +
        bloqueExplicacionEstado(obtenerMensajeEstado('PERMISOS_MEDICOS', nuevoEstado));
      var datosAdjunto = {
        "ID": idPermiso,
        "Trabajador": beneficiario.nombre,
        "RUT": formatRutServer(beneficiario.rut),
        "Tipo Permiso": tipoPermiso,
        "Estado": nuevoEstado,
        "Fecha Adjunto": formatearFechaSinHora(fechaSubida),
        "Documento": '<a href="' + resultadoSubida.url + '" style="color:#10b981;text-decoration:none;font-weight:600;">Ver Documento</a>'
      };

      var adjRepLegal = enviarDocumentosARepLegalAdjuntos(
        [resultadoSubida.url], asuntoAdjunto, tituloAdjunto, mensajeAdjunto, datosAdjunto, "#10b981");

      var envioAdjunto = _notificarPermisoMedico(
        asuntoAdjunto, tituloAdjunto, mensajeAdjunto, datosAdjunto,
        "#10b981",
        beneficiario.correo,
        esGestionDirigente ? correoGestor : "",
        adjRepLegal.success
      );
      if (adjRepLegal.success) envioAdjunto.adjuntoRepLegal = adjRepLegal.destinatarios;

      if (envioAdjunto.success) {
        _marcarPermisoNotificado(sheetPermisos, rowIndex, COL, beneficiario.correo, envioAdjunto);
      } else {
        Logger.log("Advertencia adjuntarDocumentoPermiso: fallo notificación consolidada - " + envioAdjunto.message);
      }

      var respuesta = { success: true, message: "Documento adjuntado y notificaciones enviadas." };
      if (alertas.length > 0 || (resultadoSubida.permisosError && resultadoSubida.permisosError.length > 0)) {
        var todosDetalles = alertas.slice();
        if (resultadoSubida.permisosError) resultadoSubida.permisosError.forEach(function(err) { todosDetalles.push("No se pudo dar acceso a " + err.nombre); });
        respuesta.mostrarAlerta = true; respuesta.tipoAlerta = 'warning'; respuesta.mensajeAlerta = todosDetalles.join('\n\n');
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
 * Obtiene el historial de permisos médicos de un usuario
 */
function obtenerHistorialPermisosMedicos(rutInput) {
  try {
    var sheet = getSheet('PERMISOS_MEDICOS', 'PERMISOS_MEDICOS');
    var COL = CONFIG.COLUMNAS.PERMISOS_MEDICOS;
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return { success: true, registros: [] };
    var lastCol = sheet.getLastColumn();
    var data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
    var rutLimpio = cleanRut(rutInput);
    var registros = [];
    for (var i = 0; i < data.length; i++) {
      var row = data[i];
      if (cleanRut(row[COL.RUT]) === rutLimpio) {
        registros.push({ id: row[COL.ID], fecha: formatearFechaConHora(row[COL.FECHA_SOLICITUD]), tipoPermiso: row[COL.TIPO_PERMISO], fechaInicio: formatearFechaSinHora(row[COL.FECHA_INICIO]), motivo: row[COL.MOTIVO_DETALLE], urlDocumento: row[COL.URL_DOCUMENTO], estado: row[COL.ESTADO], gestion: row[COL.GESTION], nomDirigente: row[COL.NOMBRE_DIRIGENTE] });
      }
    }
    registros.reverse();
    return { success: true, registros: registros };
  } catch (e) {
    Logger.log("❌ Error en obtenerHistorialPermisosMedicos: " + e.toString());
    return { success: false, message: "Ocurrió un error interno. Por favor, intente más tarde o contacte al administrador." };
  }
}

/**
 * Anula un permiso médico en estado "Solicitado"
 */
function eliminarPermisoMedico(idPermiso) {
  var correosRepLegal = obtenerCorreosRepLegal();
  var lock = LockService.getScriptLock();
  if (lock.tryLock(30000)) {
    try {
      var sheet = getSheet('PERMISOS_MEDICOS', 'PERMISOS_MEDICOS');
      var data = sheet.getDataRange().getDisplayValues();
      var COL = CONFIG.COLUMNAS.PERMISOS_MEDICOS;

      for (var i = 1; i < data.length; i++) {
        if (String(data[i][COL.ID]) === String(idPermiso)) {
          if (String(data[i][COL.ESTADO]) !== "Solicitado") return { success: false, message: "Solo se pueden anular permisos en estado 'Solicitado'." };

          var beneficiario = { nombre: data[i][COL.NOMBRE], correo: data[i][COL.CORREO], rut: data[i][COL.RUT] };
          var tipoPermiso = data[i][COL.TIPO_PERMISO];
          var fechaInicio = formatearFechaSinHora(data[i][COL.FECHA_INICIO]) || data[i][COL.FECHA_INICIO];

          if (beneficiario.correo && beneficiario.correo.includes("@")) {
            enviarCorreoEstilizado(beneficiario.correo, "Permiso Médico Anulado - Sindicato SLIM n°3", "Solicitud de Permiso Anulada",
              "Hola " + beneficiario.nombre + ", tu solicitud de permiso médico ha sido anulada. No se hará uso de este permiso.",
              { "ID": idPermiso, "Tipo Permiso": tipoPermiso, "Fecha Inicio": fechaInicio, "Estado": "Anulado", "Acción": "Solicitud eliminada del sistema" },
              "#ef4444");
          }
          correosRepLegal.forEach(function(c) {
            enviarCorreoEstilizado(c, "Permiso Médico Anulado - Sindicato SLIM n°3", "Solicitud de Permiso Anulada",
              "La solicitud de permiso médico del trabajador <strong>" + beneficiario.nombre + "</strong> ha sido anulada.",
              { "ID": idPermiso, "Trabajador": beneficiario.nombre, "RUT": beneficiario.rut, "Tipo Permiso": tipoPermiso, "Fecha Inicio": fechaInicio, "Estado": "Anulado por el usuario" },
              "#475569");
          });

          sheet.deleteRow(i + 1);
          return { success: true, message: "Permiso anulado y notificaciones enviadas." };
        }
      }
      return { success: false, message: "Permiso no encontrado." };
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
// TRIGGERS DE NOTIFICACIÓN — REINTENTO
// ==========================================

/**
 * Deduce el estado de una fila cuya columna ESTADO llegó vacía.
 *
 * Una fila sin estado es, en la práctica, una fila cargada a mano en la planilla:
 * el flujo de la app siempre escribe "Solicitado" o "Solicitado con Documento".
 * La única señal fiable que queda es si hay o no documento de respaldo, así que
 * se reconstruye el estado desde ahí en vez de adivinar.
 */
function _estadoPermisoInferido(fila, COL) {
  var urlDoc = String(fila[COL.URL_DOCUMENTO] || '').trim();
  var tieneDoc = urlDoc !== '' && urlDoc !== 'Sin documento';
  return tieneDoc ? 'Solicitado con Documento' : 'Solicitado';
}

/**
 * Arma y envía la notificación consolidada de UNA fila de la hoja de permisos.
 *
 * Extraído del trigger de reintento para que ese trigger y el reenvío forzado
 * (forzarNotificacionPermisoMedico) compartan literalmente el mismo correo. Si
 * cada uno construyera el suyo, terminarían divergiendo y el socio recibiría un
 * texto distinto según qué camino lo notificó.
 *
 * @param {Array}  fila   Fila cruda de la hoja (getValues()).
 * @param {Object} COL    CONFIG.COLUMNAS.PERMISOS_MEDICOS.
 * @param {string} estado Estado ya resuelto (nunca vacío).
 * @returns {{success:boolean, destinatarios:string[], cc:string[], message:string}}
 */
function _enviarNotificacionPermisoDesdeFila(fila, COL, estado) {
  var idPermiso    = String(fila[COL.ID]);
  var nombre       = String(fila[COL.NOMBRE]);
  var rut          = String(fila[COL.RUT]);
  var correoSocio  = String(fila[COL.CORREO] || "");
  var tipoPermiso  = String(fila[COL.TIPO_PERMISO]);
  var urlDoc       = String(fila[COL.URL_DOCUMENTO] || "");
  var motivo       = String(fila[COL.MOTIVO_DETALLE]);
  var gestion      = String(fila[COL.GESTION]);
  var nomDirigente = String(fila[COL.NOMBRE_DIRIGENTE] || "");
  var correoGestor = String(fila[COL.CORREO_DIRIGENTE] || "");
  var fechaValParsed = parsearFechaFlexible(fila[COL.FECHA_INICIO]);
  var fechaInicioStr = fechaValParsed !== null
    ? fechaValParsed.toLocaleDateString('es-CL', { year:'numeric', month:'long', day:'numeric' })
    : String(fila[COL.FECHA_INICIO]);
  var tieneDoc = urlDoc !== '' && urlDoc !== 'Sin documento';

  var asunto, titulo, mensaje;
  if (estado === 'Documento Adjuntado') {
    asunto  = "Documento de Permiso Médico Adjuntado - Sindicato SLIM n°3";
    titulo  = "Documento de Permiso Médico Disponible";
    mensaje = "El trabajador <strong>" + nombre + "</strong> ha adjuntado el documento de respaldo de su permiso médico. Ya se encuentra disponible para revisión.";
  } else {
    asunto  = tieneDoc
      ? "Nueva Solicitud de Permiso Médico con Documento - Sindicato SLIM n°3"
      : "Nueva Solicitud de Permiso Médico - Sindicato SLIM n°3";
    titulo  = tieneDoc ? "Permiso Médico Registrado con Documento" : "Permiso Médico Registrado";
    mensaje = "Se ha registrado una solicitud de permiso médico para el trabajador <strong>" + nombre + "</strong>.";
    if (gestion === "Dirigente") {
      mensaje += " La gestión fue realizada por el dirigente <strong>" + nomDirigente + "</strong> en su nombre.";
    }
  }

  var datos = {
    "ID": idPermiso,
    "Trabajador": nombre,
    "RUT": formatRutServer(rut),
    "Tipo Permiso": tipoPermiso,
    "Fecha Inicio": fechaInicioStr,
    "Motivo": motivo,
    "Estado": estado,
    "Gestión": gestion || "Socio"
  };
  if (gestion === "Dirigente" && nomDirigente) datos["Dirigente"] = nomDirigente;
  datos["Documento"] = tieneDoc
    ? '<a href="' + urlDoc + '" style="color:#10b981;text-decoration:none;font-weight:600;">Ver Documento</a>'
    : "Pendiente - Adjuntar desde el historial una vez realizada la atención médica";

  // Mensaje base + explicación breve según el estado (fuente: Modulo mensajesEstado.js)
  var mensajeCompleto = mensaje + bloqueExplicacionEstado(obtenerMensajeEstado('PERMISOS_MEDICOS', estado));

  // Con documento, REPLEGAL recibe el aviso con el archivo adjunto y queda
  // fuera del consolidado (ver solicitarPermisoMedico). Al vivir acá cubre
  // también el trigger de reintento y el reenvío forzado, que comparten esta
  // función justamente para que los caminos no envíen cosas distintas.
  var adjRepLegal = tieneDoc
    ? enviarDocumentosARepLegalAdjuntos([urlDoc], asunto, titulo, mensajeCompleto, datos, "#10b981")
    : null;

  var envio = _notificarPermisoMedico(
    asunto, titulo, mensajeCompleto,
    datos, "#10b981",
    correoSocio, (gestion === "Dirigente" ? correoGestor : ""),
    !!(adjRepLegal && adjRepLegal.success)
  );
  if (adjRepLegal && adjRepLegal.success) envio.adjuntoRepLegal = adjRepLegal.destinatarios;

  return envio;
}

/**
 * Trigger: cada 30 minutos. Reintenta la notificación consolidada de los
 * permisos médicos que quedaron sin notificar.
 *
 * Reemplaza a los dos triggers separados que existían antes (uno para el socio
 * y otro para el representante legal). Como ahora hay un solo correo por
 * permiso, NOTIFICADO_REP_LEGAL pasa a ser la marca canónica de "ya se envió" y
 * NOTIFICADO_SOCIO se mantiene en espejo para no romper filtros de la hoja.
 *
 * ⚠️ Una fila con ESTADO vacío NO se salta. Antes sí: la primera condición del
 * bucle era `if (estado === '' || estado === 'Anulado') continue;`, de modo que
 * cualquier permiso cargado a mano en la planilla sin llenar esa columna quedaba
 * fuera del reintento para siempre — el permiso existía, el socio lo veía en su
 * historial y los representantes legales no se enteraban nunca. Y era invisible:
 * el panel de Ejecuciones reportaba la corrida como exitosa. Ahora el estado se
 * reconstruye con _estadoPermisoInferido() y se escribe de vuelta en la hoja
 * cuando el envío sale bien, para que la fila deje de ser ambigua.
 */
function reintentarNotificacionPermisoMedico(e) {
  if (activadorFueraDeProduccion_(e, 'reintentarNotificacionPermisoMedico')) return;
  // OBLIGATORIO como primera línea: en una ejecución por trigger el estado global
  // arranca limpio y CONFIG vale null (Global.js) hasta que algo llame a
  // _ensureConfig(). Leer CONFIG.COLUMNAS antes —y fuera del try— hacía que la
  // función reventara con TypeError en cada corrida, sin enviar nada ni loguear.
  _ensureConfig();
  var COL = CONFIG.COLUMNAS.PERMISOS_MEDICOS;
  try {
    var sheetPermisos = getSheet('PERMISOS_MEDICOS', 'PERMISOS_MEDICOS');
    var data = sheetPermisos.getDataRange().getValues();
    var pendientes = 0, exitosos = 0, inferidos = 0;

    for (var i = 1; i < data.length; i++) {
      var fila        = data[i];
      var notificado  = fila[COL.NOTIFICADO_REP_LEGAL];
      var estadoCrudo = String(fila[COL.ESTADO] || '').trim();

      if (estadoCrudo === 'Anulado') continue;
      if (notificado === true || String(notificado).toUpperCase() === 'TRUE') continue;

      // Fila sin estado: se reconstruye en vez de descartarla (ver cabecera).
      var estado = estadoCrudo;
      var estadoInferido = false;
      if (estado === '') {
        estado = _estadoPermisoInferido(fila, COL);
        estadoInferido = true;
        inferidos++;
        Logger.log('⚠️ reintentarNotificacionPermisoMedico - Fila ' + (i + 1) +
                   ' (ID ' + String(fila[COL.ID]) + ') sin ESTADO. Se asume "' + estado +
                   '" a partir del documento de respaldo. Probable carga manual en la planilla.');
      }

      pendientes++;
      var envio = _enviarNotificacionPermisoDesdeFila(fila, COL, estado);

      if (envio.success) {
        // El estado se escribe de vuelta solo si el correo salió: si falló, la
        // fila debe quedar tal cual para que la próxima corrida la vuelva a ver.
        if (estadoInferido) sheetPermisos.getRange(i + 1, COL.ESTADO + 1).setValue(estado);
        _marcarPermisoNotificado(sheetPermisos, i + 1, COL, String(fila[COL.CORREO] || ""), envio);
        exitosos++;
        Utilities.sleep(600);
      } else {
        Logger.log("reintentarNotificacionPermisoMedico - Fila " + (i + 1) + ": " + envio.message);
      }
    }
    Logger.log("reintentarNotificacionPermisoMedico: " + pendientes + " pendientes, " +
               exitosos + " enviados, " + inferidos + " con estado reconstruido.");
  } catch (e) { Logger.log("Error en reintentarNotificacionPermisoMedico: " + e.toString()); }
}

// ==========================================
// REENVÍO FORZADO Y VERIFICACIÓN (mantención)
// ==========================================

/**
 * Cerrojo de ejecución para las funciones internas de mantención.
 *
 * El guion bajo del nombre es convención, no protección: en este proyecto TODA
 * función global es invocable de forma anónima con google.script.run desde la
 * consola del navegador, porque la webapp es ANYONE_ANONYMOUS y corre como el
 * usuario que despliega. Sin esto, cualquiera podría llamar directamente al
 * núcleo del reenvío forzado y hacer que salgan correos a los representantes
 * legales de la empresa, saltándose el control de rol de la función pública.
 *
 * Funciona porque cada ejecución de Apps Script arranca con el estado global
 * limpio: la variable vuelve a false en cada llamada. Solo queda en true si,
 * dentro de ESA misma ejecución, se pasó antes por un control de acceso real.
 */
var _PERMISOS_ACCION_AUTORIZADA = false;

function _autorizarAccionMantencionPermisos() {
  _PERMISOS_ACCION_AUTORIZADA = true;
}

function _accionMantencionPermisosAutorizada(nombreFuncion) {
  if (!_PERMISOS_ACCION_AUTORIZADA) {
    Logger.log('⛔ ' + nombreFuncion + ': llamada directa sin pasar por un control de acceso. Ignorada.');
    return false;
  }
  return true;
}

/**
 * Reenvía la notificación consolidada de los permisos médicos de un socio,
 * IGNORANDO la marca NOTIFICADO_REP_LEGAL.
 *
 * Existe para cuando la marca miente: una fila cargada a mano con TRUE escrito
 * a mano, o una fila que el trigger dio por notificada sin que el correo llegara
 * a salir. El trigger normal nunca la va a tomar, porque su criterio es
 * justamente esa marca. Acá el operador afirma que el correo no salió y se envía.
 *
 * Salta las filas "Anulado" (el permiso ya no existe) y reconstruye el estado
 * vacío igual que el trigger. Al terminar deja la fila marcada como notificada.
 *
 * @param {string} rutSocio       RUT del socio cuyos permisos se reenvían.
 * @param {string} rutSolicitante RUT del ADMIN que lo pide.
 * @returns {{success:boolean, message:string, enviados:number, detalle:Array}}
 */
function forzarNotificacionPermisoMedico(rutSocio, rutSolicitante) {
  _ensureConfig();
  var verificacion = verificarRolUsuario(rutSolicitante, ['ADMIN']);
  if (!verificacion.autorizado) {
    Logger.log('⚠️ forzarNotificacionPermisoMedico: intento no autorizado.');
    return { success: false, message: 'No autorizado.', enviados: 0, detalle: [] };
  }
  _autorizarAccionMantencionPermisos();
  return _forzarNotificacionPermisoMedicoCore(rutSocio);
}

/**
 * Núcleo del reenvío forzado, sin control de rol. No exponer directamente: lo
 * llaman forzarNotificacionPermisoMedico() (con ADMIN) y el atajo de editor.
 */
function _forzarNotificacionPermisoMedicoCore(rutSocio) {
  if (!_accionMantencionPermisosAutorizada('_forzarNotificacionPermisoMedicoCore')) {
    return { success: false, message: 'No autorizado.', enviados: 0, detalle: [] };
  }
  _ensureConfig();
  var rutLimpio = cleanRut(rutSocio);
  if (!rutLimpio) return { success: false, message: 'RUT vacío.', enviados: 0, detalle: [] };

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return { success: false, message: 'Servidor ocupado.', enviados: 0, detalle: [] };

  try {
    var sheet = getSheet('PERMISOS_MEDICOS', 'PERMISOS_MEDICOS');
    var COL   = CONFIG.COLUMNAS.PERMISOS_MEDICOS;
    var data  = sheet.getDataRange().getValues();
    var detalle = [], enviados = 0;

    for (var i = 1; i < data.length; i++) {
      var fila = data[i];
      if (cleanRut(fila[COL.RUT]) !== rutLimpio) continue;

      var estado = String(fila[COL.ESTADO] || '').trim();
      if (estado === 'Anulado') {
        detalle.push({ fila: i + 1, id: String(fila[COL.ID]), resultado: 'omitido (Anulado)' });
        continue;
      }
      var estadoInferido = false;
      if (estado === '') { estado = _estadoPermisoInferido(fila, COL); estadoInferido = true; }

      var envio = _enviarNotificacionPermisoDesdeFila(fila, COL, estado);
      if (envio.success) {
        if (estadoInferido) sheet.getRange(i + 1, COL.ESTADO + 1).setValue(estado);
        _marcarPermisoNotificado(sheet, i + 1, COL, String(fila[COL.CORREO] || ""), envio);
        enviados++;
        detalle.push({ fila: i + 1, id: String(fila[COL.ID]), estado: estado, resultado: 'enviado',
                       para: envio.destinatarios, cc: envio.cc });
        Utilities.sleep(600);
      } else {
        detalle.push({ fila: i + 1, id: String(fila[COL.ID]), estado: estado, resultado: 'error: ' + envio.message });
      }
    }

    Logger.log('forzarNotificacionPermisoMedico(' + rutLimpio + '): ' + enviados +
               ' enviados. Detalle: ' + JSON.stringify(detalle));
    return {
      success: true,
      message: enviados + ' notificacion(es) reenviada(s) para el RUT ' + rutLimpio + '.',
      enviados: enviados,
      detalle: detalle
    };
  } catch (e) {
    Logger.log('❌ Error en _forzarNotificacionPermisoMedicoCore: ' + e.toString());
    return { success: false, message: 'Error interno: ' + e.toString(), enviados: 0, detalle: [] };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Atajo para correr el reenvío forzado desde el editor de Apps Script, donde
 * solo se pueden ejecutar funciones sin argumentos.
 *
 * Uso: crear la Script Property PERMISO_FORZAR_RUT con el RUT del socio y
 * ejecutar esta función. La propiedad se BORRA sola antes de enviar nada, así
 * que la puerta se cierra en la misma corrida — mismo criterio que
 * PERMITIR_CONFIG_TRIGGERS y a diferencia de RUT_MANTENCION, que hay que
 * acordarse de limpiar. Sin la propiedad no hace nada, de modo que no queda un
 * endpoint sin control de rol invocable desde la consola del navegador.
 */
function _forzarNotificacionPermisoMedicoDesdeEditor() {
  var props = PropertiesService.getScriptProperties();
  var rut = (props.getProperty('PERMISO_FORZAR_RUT') || '').trim();
  if (!rut) {
    Logger.log('⚠️ Falta la Script Property PERMISO_FORZAR_RUT. Créala con el RUT del socio y vuelve a ejecutar.');
    return;
  }
  props.deleteProperty('PERMISO_FORZAR_RUT');
  Logger.log('🔓 Puerta PERMISO_FORZAR_RUT consumida y borrada. Procesando RUT ' + rut + '…');
  _autorizarAccionMantencionPermisos();
  Logger.log(JSON.stringify(_forzarNotificacionPermisoMedicoCore(rut), null, 2));
}

/**
 * Compatibilidad. Nombre del activador antiguo, que sigue instalado en el
 * proyecto GAS hasta que se vuelva a ejecutar configurarTriggers(). Delega en el
 * reintento consolidado para que un activador sin actualizar siga funcionando en
 * lugar de fallar con "función no encontrada".
 */
function reintentarNotificacionSocio(e) {
  reintentarNotificacionPermisoMedico(e);
}

/**
 * Compatibilidad. El reintento del representante legal quedó absorbido por
 * reintentarNotificacionPermisoMedico(), que ahora manda un único correo con
 * REPLEGAL en "Para".
 *
 * Se deja como no-op DELIBERADO: delegar acá también duplicaría el envío en
 * cada corrida mientras el activador antiguo siga instalado, ya que
 * reintentarNotificacionSocio() —el otro activador de 30 min— ya delega.
 * Desaparece al volver a ejecutar configurarTriggers().
 */
function reintentarNotificacionRepLegal() {
  Logger.log('ℹ️ reintentarNotificacionRepLegal: obsoleta — absorbida por reintentarNotificacionPermisoMedico(). Ejecuta configurarTriggers() para retirar este activador.');
}

// ==========================================
// VERIFICACIÓN DE EVIDENCIA DE NOTIFICACIÓN
// ==========================================

/**
 * Revisa que cada permiso marcado como notificado tenga la evidencia que este
 * código deja al enviar: fecha de servidor + destinatarios reales.
 *
 * Reemplaza a la idea original de auditar el buzón de salida de la cuenta
 * institucional. Se descartó a propósito: leer Enviados exige el scope
 * gmail.readonly, que en Gmail no se puede acotar y da lectura del buzón
 * COMPLETO — recibidos, borradores y papelera incluidos. Concederlo de forma
 * permanente a un proyecto donde cualquier función global es invocable de forma
 * anónima era un precio desproporcionado para detectar filas mal marcadas.
 * Escribiendo nosotros la evidencia se obtiene lo mismo sin permisos nuevos.
 *
 * Qué detecta: la fila que dice "notificado" y no tiene con qué respaldarlo.
 * Es la firma de una fila cargada o editada a mano en la planilla — el caso que
 * dejó a una socia con su permiso registrado y a los representantes legales sin
 * enterarse, y que el trigger de reintento nunca podría descubrir porque salta
 * las filas justamente por esa marca.
 *
 * Qué NO detecta: si el correo fue entregado. Eso solo lo sabe el servidor del
 * destinatario. La evidencia prueba que este código ejecutó el envío, que es la
 * distinción que hacía falta.
 *
 * SOLO OBSERVA: no envía, no marca, no corrige. Lo que aparezca se repara con
 * forzarNotificacionPermisoMedico(), o borrando la marca y dejando actuar al
 * trigger de 30 minutos.
 *
 * @param {string} rutSolicitante RUT del ADMIN que lo pide.
 * @returns {Object} Informe agregado.
 */
function verificarEvidenciaNotificacionPermisos(rutSolicitante) {
  _ensureConfig();
  var verificacion = verificarRolUsuario(rutSolicitante, ['ADMIN']);
  if (!verificacion.autorizado) {
    Logger.log('⚠️ verificarEvidenciaNotificacionPermisos: intento no autorizado.');
    return { success: false, message: 'No autorizado.' };
  }
  _autorizarAccionMantencionPermisos();
  return _verificarEvidenciaNotificacionPermisosCore();
}

/**
 * Núcleo de la verificación. Protegido por el cerrojo de ejecución: devuelve
 * nombres, RUTs y correos de socios, así que una llamada anónima directa desde
 * la consola del navegador sería una fuga de datos personales.
 */
function _verificarEvidenciaNotificacionPermisosCore() {
  if (!_accionMantencionPermisosAutorizada('_verificarEvidenciaNotificacionPermisosCore')) {
    return { success: false, message: 'No autorizado.' };
  }
  _ensureConfig();

  try {
    var sheet = getSheet('PERMISOS_MEDICOS', 'PERMISOS_MEDICOS');
    var COL   = CONFIG.COLUMNAS.PERMISOS_MEDICOS;

    if (COL.FECHA_NOTIFICACION === undefined || COL.DESTINATARIOS_NOTIFICACION === undefined) {
      var aviso = 'CONFIG sin las columnas de evidencia. Ejecuta _configurarEvidenciaNotificacionPermisos() en ESTE proyecto (DEV y PROD por separado) antes de verificar.';
      Logger.log('⚠️ ' + aviso);
      return { success: false, message: aviso };
    }

    // Sin truncar a medianoche: el corte lleva hora a propósito (ver la
    // constante). Truncarlo era la mitad del bug de las 12 falsas alarmas.
    var corte = parsearFechaFlexible(FECHA_INICIO_EVIDENCIA_NOTIFICACION);
    if (corte === null) {
      return { success: false, message: 'FECHA_INICIO_EVIDENCIA_NOTIFICACION no es una fecha válida: ' + FECHA_INICIO_EVIDENCIA_NOTIFICACION };
    }

    var data = sheet.getDataRange().getValues();
    var conEvidencia = 0, anterioresAlCorte = 0, anuladas = 0;
    var sinEvidencia = [];      // ⚠️ dice notificado y no tiene con qué probarlo
    var pendientes = [];        // sin marcar: el trigger las debería tomar
    var sinFechaLegible = [];

    for (var i = 1; i < data.length; i++) {
      var fila = data[i];
      var id   = String(fila[COL.ID] || '').trim();
      if (!id) continue;

      var estado = String(fila[COL.ESTADO] || '').trim();
      if (estado === 'Anulado') { anuladas++; continue; }

      var fechaSolicitud = parsearFechaFlexible(fila[COL.FECHA_SOLICITUD]);
      if (fechaSolicitud === null) {
        sinFechaLegible.push({ fila: i + 1, id: id, nombre: String(fila[COL.NOMBRE] || '') });
        continue;
      }
      // Antes del corte el código todavía no escribía evidencia: su ausencia no
      // prueba nada. Se cuentan aparte, nunca como hallazgo.
      if (fechaSolicitud < corte) { anterioresAlCorte++; continue; }

      var notificado  = fila[COL.NOTIFICADO_REP_LEGAL];
      var estaMarcada = (notificado === true || String(notificado).toUpperCase() === 'TRUE');
      var tieneFecha  = parsearFechaFlexible(fila[COL.FECHA_NOTIFICACION]) !== null;
      var tieneDest   = String(fila[COL.DESTINATARIOS_NOTIFICACION] || '').trim() !== '';

      if (estaMarcada && tieneFecha && tieneDest) { conEvidencia++; continue; }

      var caso = {
        fila: i + 1,
        id: id,
        fecha: formatearFechaConHora(fila[COL.FECHA_SOLICITUD]),
        rut: formatRutServer(String(fila[COL.RUT] || '')),
        nombre: String(fila[COL.NOMBRE] || ''),
        correo: String(fila[COL.CORREO] || ''),
        estado: estado || '(vacío)',
        gestion: String(fila[COL.GESTION] || ''),
        marcada: estaMarcada,
        tieneFecha: tieneFecha,
        tieneDestinatarios: tieneDest
      };
      if (estaMarcada) sinEvidencia.push(caso);
      else pendientes.push(caso);
    }

    var informe = {
      success: true,
      desdeCorte: FECHA_INICIO_EVIDENCIA_NOTIFICACION,
      conEvidencia: conEvidencia,
      sinEvidencia: sinEvidencia,
      pendientes: pendientes,
      anterioresAlCorte: anterioresAlCorte,
      anuladas: anuladas,
      sinFechaLegible: sinFechaLegible
    };

    Logger.log('📋 Verificación de evidencia de notificación (permisos desde ' + FECHA_INICIO_EVIDENCIA_NOTIFICACION + ')');
    Logger.log('   ✅ Con evidencia completa: ' + conEvidencia);
    Logger.log('   ⚠️ MARCADAS COMO NOTIFICADAS SIN EVIDENCIA: ' + sinEvidencia.length);
    sinEvidencia.forEach(function(c) {
      Logger.log('      · Fila ' + c.fila + ' | ' + c.fecha + ' | ' + c.nombre + ' (' + c.rut +
                 ') | Estado: ' + c.estado + ' | fecha:' + c.tieneFecha + ' dest:' + c.tieneDestinatarios);
    });
    Logger.log('   ⏳ Sin marcar (el trigger las debería tomar): ' + pendientes.length);
    pendientes.forEach(function(c) {
      Logger.log('      · Fila ' + c.fila + ' | ' + c.fecha + ' | ' + c.nombre + ' (' + c.rut + ')');
    });
    Logger.log('   ℹ️ Anteriores al corte (no auditables): ' + anterioresAlCorte + ' | Anuladas: ' + anuladas);
    if (sinFechaLegible.length) {
      Logger.log('   ❓ Con FECHA_SOLICITUD ilegible: ' + sinFechaLegible.length);
    }

    return informe;

  } catch (e) {
    Logger.log('❌ Error en verificarEvidenciaNotificacionPermisos: ' + e.toString());
    return { success: false, message: 'Error al verificar: ' + e.toString() };
  }
}

/**
 * Atajo para correr la verificación desde el editor de Apps Script.
 *
 * NO DEVUELVE NADA a propósito: al no recibir argumentos sería invocable de
 * forma anónima vía google.script.run, y el informe trae nombres, RUTs y
 * correos de socios. Dejando el resultado solo en Logger, quien la llame sin
 * autorización recibe undefined y los datos no salen del proyecto. Para
 * obtenerlo como valor, usa verificarEvidenciaNotificacionPermisos(rutAdmin).
 */
function _verificarEvidenciaNotificacionPermisosDesdeEditor() {
  _autorizarAccionMantencionPermisos();
  _verificarEvidenciaNotificacionPermisosCore();
  return;
}

// ==========================================
// SWITCH MÓDULO PERMISOS MÉDICOS
// ==========================================

function obtenerEstadoSwitchPermisosMedicos() {
  return _switchHabilitado('permisos_medicos_habilitado');
}

// Solo ADMIN (validado en _toggleSwitchModulo).
function toggleSwitchPermisosMedicos(estado, rutSolicitante) {
  return _toggleSwitchModulo('permisos_medicos_habilitado', estado, rutSolicitante);
}

