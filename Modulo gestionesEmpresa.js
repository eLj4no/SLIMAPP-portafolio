// ==========================================
// MODULO_GESTIONES_EMPRESA.GS — Trámites y Solicitudes a la Empresa
// ==========================================
// El Portal de Autoservicio de Empleados de la empresa (ISS) está caído.
// Este módulo permite a los socios generar y enviar un correo formal a la
// casilla correcta de la empresa desde una interfaz guiada tipo "redactar
// correo", sin que tengan que escribirlo ni enviarlo manualmente.

// Catálogo de gestiones: clave → etiqueta. Los correos destino NO van aquí:
// viven en PropertiesService (clave GESTIONES_EMPRESA_CORREOS_JSON).
var CATALOGO_GESTIONES = {
  CONTRATOS:         "Contratos y firma de documentos",
  VACACIONES:        "Solicitud de vacaciones",
  CERTIFICADOS:      "Certificados y liquidaciones",
  ASISTENCIA:        "Consultas de asistencia (reloj)",
  LICENCIAS_MEDICAS: "Licencias médicas"
};

// Correo de pruebas por defecto (se usa si la propiedad JSON no existe).
// SOLO PRUEBAS — reemplazar vía PropertiesService en producción.
var CORREO_PRUEBAS_GESTIONES = "pruebas@ejemplo.com";

/**
 * Escapa HTML básico (< > & ") y convierte saltos de línea en <br>.
 * Uso exclusivo para contenido de usuario embebido en el correo formal.
 */
function _escaparHtmlGestion(texto) {
  return String(texto || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\n/g, "<br>");
}

/**
 * Lee el mapeo gestión→correos desde PropertiesService.
 * Formato esperado: {"CONTRATOS":["correo1"],...}
 * Si la propiedad no existe, no parsea, o falta la clave → fallback seguro
 * al correo de pruebas (DEV).
 */
function _obtenerCorreosGestion(claveGestion) {
  try {
    var json = PropertiesService.getScriptProperties().getProperty('GESTIONES_EMPRESA_CORREOS_JSON');
    if (!json) return [CORREO_PRUEBAS_GESTIONES];
    var mapa = JSON.parse(json);
    if (mapa && Array.isArray(mapa[claveGestion]) && mapa[claveGestion].length > 0) {
      return mapa[claveGestion];
    }
    return [CORREO_PRUEBAS_GESTIONES];
  } catch (e) {
    Logger.log('Error en _obtenerCorreosGestion: ' + e.toString());
    return [CORREO_PRUEBAS_GESTIONES];
  }
}

/**
 * Crea la hoja GESTIONES_EMPRESA con la fila de cabeceras si no existe.
 * Idempotente — ejecutar manualmente una sola vez desde el editor GAS
 * (después de _configurarPropiedadesGestionesEmpresa() en config_local.js).
 */
function _setupHojaGestionesEmpresa() {
  _ensureConfig();
  var sheet = getSheet('DENUNCIAS_JEFATURAS', 'GESTIONES_EMPRESA', true);
  if (!sheet) {
    Logger.log('❌ No se pudo crear/acceder a la hoja GESTIONES_EMPRESA.');
    return;
  }
  var headersEsperados = [
    "ID", "FECHA_REGISTRO", "RUT", "NOMBRE", "CORREO", "TIPO_GESTION",
    "ASUNTO", "CONTENIDO", "NOMBRES_ARCHIVOS", "URLS_RESPALDO",
    "DESTINATARIOS", "ESTADO", "GESTION", "NOMBRE_DIRIGENTE"
  ];

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headersEsperados);
    Logger.log('✅ Hoja GESTIONES_EMPRESA creada con cabeceras.');
    return;
  }

  // Reparación idempotente: agrega al final las columnas nuevas (GESTION,
  // NOMBRE_DIRIGENTE) si la hoja fue creada antes de que existieran. Solo
  // funciona correctamente si las columnas previas siguen el orden original
  // (ID..ESTADO) — que es el estado esperado del esquema.
  var ultimaCol = sheet.getLastColumn();
  var headerActual = sheet.getRange(1, 1, 1, ultimaCol).getValues()[0]
    .map(function(h) { return String(h).trim().toUpperCase(); });
  var faltantes = [];
  for (var c = 0; c < headersEsperados.length; c++) {
    if (headerActual.indexOf(headersEsperados[c].toUpperCase()) === -1) faltantes.push(headersEsperados[c]);
  }
  if (faltantes.length > 0) {
    sheet.getRange(1, ultimaCol + 1, 1, faltantes.length).setValues([faltantes]);
    Logger.log('✅ Hoja GESTIONES_EMPRESA: columnas agregadas → ' + faltantes.join(', '));
  } else {
    Logger.log('ℹ️ Hoja GESTIONES_EMPRESA ya está actualizada — no se modifican cabeceras.');
  }
}

/**
 * Envía un trámite/solicitud formal a la empresa en nombre del socio.
 * @param {Object} datos - {
 *   rutGestor: string,
 *   tipoGestion: string (clave de CATALOGO_GESTIONES),
 *   asunto: string,
 *   contenido: string,
 *   archivos: Array<{base64, mimeType, fileName}>  // 0 a 5 elementos
 * }
 * @returns {{success:boolean, message:string, idGestion?:string}}
 */
function enviarGestionEmpresa(datos) {
  _ensureConfig();
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    return { success: false, message: "Servidor ocupado. Intenta nuevamente." };
  }

  try {
    // El backend también respeta el feature flag: el webapp es
    // ANYONE_ANONYMOUS, así que ocultar el botón en la UI no impide invocar
    // esta función por nombre con el módulo pausado.
    if (!obtenerEstadoSwitchGestiones().habilitado) {
      return { success: false, message: "El módulo de trámites está temporalmente deshabilitado. Consulta con la directiva para más información." };
    }

    var rutGestor    = datos && datos.rutGestor;
    var tipoGestion  = datos && datos.tipoGestion;
    var asunto       = String((datos && datos.asunto) || "").trim();
    var contenido    = String((datos && datos.contenido) || "").trim();
    var archivos     = (datos && datos.archivos) || [];
    var rutBeneficiarioInput = (datos && datos.rutBeneficiario) ? String(datos.rutBeneficiario).trim() : "";

    var gestor = obtenerUsuarioPorRut(rutGestor);
    if (!gestor.encontrado) return { success: false, message: "Error de sesión." };

    // ---- Resolver beneficiario (trámite a nombre de un socio) ----
    // Mismo patrón que Permisos Médicos / Préstamos / Justificaciones: si un
    // gestor (DIRIGENTE/DIRECTORIO/ADMIN) ingresa el RUT de un socio, el trámite
    // se registra y se envía con los datos del SOCIO (la empresa le responde a
    // él); el gestor queda como CC/receptor. Sin RUT (o con el propio), el
    // beneficiario es quien inicia la sesión.
    var rutLimpioGestor = cleanRut(rutGestor);
    var rutTarget = rutBeneficiarioInput ? cleanRut(rutBeneficiarioInput) : rutLimpioGestor;
    var beneficiario, esGestionDirigente = false;
    var gestion = "Socio", nomDirigente = "";
    if (!rutBeneficiarioInput || rutTarget === rutLimpioGestor) {
      beneficiario = gestor;
    } else {
      // Solo roles gestores pueden tramitar a nombre de otro socio. El webapp es
      // ANYONE_ANONYMOUS: ocultar el campo en la UI no sustituye este chequeo.
      var verifRol = verificarRolUsuario(rutGestor, ['DIRIGENTE', 'DIRECTORIO', 'ADMIN']);
      if (!verifRol.autorizado) {
        return { success: false, message: "No tienes permisos para realizar trámites a nombre de otro socio." };
      }
      beneficiario = obtenerUsuarioPorRut(rutBeneficiarioInput);
      if (!beneficiario.encontrado) {
        return { success: false, message: "El RUT del socio ingresado no está registrado. Verifícalo e intenta nuevamente." };
      }
      esGestionDirigente = true;
      gestion = "Dirigente";
      nomDirigente = gestor.nombre;
    }

    // ---- Validaciones servidor (nunca confiar solo en el frontend) ----
    // Requisito obligatorio: el BENEFICIARIO debe tener correo válido
    // registrado, ya que la empresa responderá directamente a ese correo.
    if (!esCorreoValido(beneficiario.correo)) {
      return {
        success: false,
        message: esGestionDirigente
          ? "El socio a nombre de quien realizas el trámite no tiene un correo válido registrado. La empresa responde directamente a ese correo, por lo que debe registrarse en su ficha antes de continuar."
          : "Debes tener un correo electrónico registrado para realizar trámites con la empresa. Actualiza tus datos en 'Mis Datos' e intenta nuevamente."
      };
    }
    if (!tipoGestion || !CATALOGO_GESTIONES[tipoGestion]) {
      return { success: false, message: "Debes seleccionar un tipo de trámite válido." };
    }
    if (!asunto) {
      return { success: false, message: "El asunto es obligatorio." };
    }
    if (asunto.length > 120) {
      return { success: false, message: "El asunto no puede superar los 120 caracteres." };
    }
    if (!contenido) {
      return { success: false, message: "Debes escribir el detalle de tu solicitud." };
    }
    if (contenido.length > 4000) {
      return { success: false, message: "El detalle de tu solicitud no puede superar los 4000 caracteres." };
    }
    if (!Array.isArray(archivos)) archivos = [];
    if (archivos.length > 5) {
      return { success: false, message: "Puedes adjuntar como máximo 5 archivos." };
    }

    var tamanoTotalBytes = 0;
    for (var v = 0; v < archivos.length; v++) {
      var arch = archivos[v];
      if (!arch || !arch.base64) {
        return { success: false, message: "Uno de los archivos adjuntos no se pudo leer. Intenta adjuntarlo nuevamente." };
      }
      var tamanoBytes = (arch.base64.length * 3) / 4;
      if (tamanoBytes > LIMITE_ARCHIVO_MB * 1024 * 1024) {
        return { success: false, message: "El archivo \"" + arch.fileName + "\" supera el máximo de " + LIMITE_ARCHIVO_MB + "MB permitido por archivo." };
      }
      tamanoTotalBytes += tamanoBytes;
    }
    if (tamanoTotalBytes > LIMITE_TOTAL_ADJUNTOS_MB * 1024 * 1024) {
      return { success: false, message: "El peso combinado de los archivos adjuntos supera el máximo de " + LIMITE_TOTAL_ADJUNTOS_MB + "MB. Reduce el tamaño o la cantidad de archivos." };
    }

    // ---- Identificadores ----
    var idGestion = "GE-" + String(Math.floor(1000 + Math.random() * 9000));
    var fechaRegistro = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm:ss");
    var etiquetaGestion = CATALOGO_GESTIONES[tipoGestion];

    // ---- Blobs de adjuntos ----
    var blobs = [];
    var nombresArchivos = [];
    for (var b = 0; b < archivos.length; b++) {
      var a = archivos[b];
      var blob = Utilities.newBlob(Utilities.base64Decode(a.base64), a.mimeType, a.fileName);
      blobs.push(blob);
      nombresArchivos.push(a.fileName);
    }

    // ---- Respaldo en Drive (secundario: si falla o no está configurado, no bloquea el envío) ----
    // Usa subirArchivoConPermisos() (no folder.createFile directo) para que cada
    // adjunto quede compartido individualmente con el socio y los roles de
    // supervisión — mismo patrón que Permisos Médicos y Apelaciones. Antes solo
    // quedaba accesible por quien tuviera acceso general a la carpeta.
    var urlsRespaldo = [];
    var carpetaId = CONFIG.CARPETAS.GESTIONES_EMPRESA;
    var correosParaPermisos = [];
    if (esCorreoValido(beneficiario.correo)) {
      correosParaPermisos.push({ correo: beneficiario.correo.trim().toLowerCase(), tipo: 'beneficiario', nombre: beneficiario.nombre });
    }
    // El dirigente gestor accede al respaldo por su cuenta institucional, vía el
    // compartirArchivoConRol(..., 'DIRIGENTE', 'leer') de más abajo — no por su
    // Gmail personal de BD_SLIMAPP. Ver la nota en validarCorreosParaPermisos().

    if (archivos.length === 0) {
      urlsRespaldo.push("Sin adjuntos");
    } else if (!carpetaId) {
      Logger.log('⚠️ CONFIG.CARPETAS.GESTIONES_EMPRESA no configurada — se omite respaldo Drive para ' + idGestion);
      urlsRespaldo.push("SIN_RESPALDO");
    } else {
      for (var n = 0; n < archivos.length; n++) {
        var resultadoRespaldo = subirArchivoConPermisos(
          archivos[n],
          carpetaId,
          idGestion + "-" + (n + 1) + "-" + cleanRut(beneficiario.rut),
          correosParaPermisos,
          []
        );
        if (resultadoRespaldo.success && resultadoRespaldo.fileId) {
          // Otorgar lectura a roles de supervisión, igual que Denuncias/Apelaciones/Permisos Médicos
          compartirArchivoConRol(resultadoRespaldo.fileId, 'ADMIN',      'leer');
          compartirArchivoConRol(resultadoRespaldo.fileId, 'DIRECTORIO', 'leer');
          // REPLEGAL no recibe permiso de Drive (sus casillas no son cuentas
          // Google): en este módulo ya reciben los archivos como adjuntos
          // reales del correo formal a la empresa, donde van en copia.

          // DIRIGENTE se sumó cuando validarCorreosParaPermisos() dejó de otorgar
          // permiso al Gmail personal del gestor. Este era el ÚNICO módulo que no
          // repartía a ese rol: sin esta línea, el dirigente que envía una gestión
          // a nombre de un socio se queda sin ver el adjunto que él mismo mandó.
          compartirArchivoConRol(resultadoRespaldo.fileId, 'DIRIGENTE',  'leer');
          urlsRespaldo.push(resultadoRespaldo.url);
        } else {
          Logger.log('⚠️ No se pudo respaldar/compartir adjunto ' + (n + 1) + ' de gestión ' + idGestion + ': ' + (resultadoRespaldo.mensajeError || 'sin detalle'));
          urlsRespaldo.push("SIN_RESPALDO");
        }
      }
    }

    // ---- Construcción del correo formal ----
    // Azul consistente con el correo "Apelación Ingresada" (Modulo apelaciones.js).
    // Reemplaza el acento verde (#00875a) usado anteriormente en este correo.
    var ACENTO_CORREO_EMPRESA = "#1d4ed8";
    // No se usa Session.getEffectiveUser().getEmail(): requiere el scope
    // "userinfo.email", no declarado en el manifest. Se lee desde
    // PropertiesService en su lugar (sin permisos adicionales). Configurar
    // una vez desde "Configuración del proyecto" > "Propiedades del script"
    // con la clave CUENTA_REMITENTE_GESTIONES. Si no está configurada, el
    // pie de página simplemente omite la mención de la cuenta específica.
    var cuentaRemitente = PropertiesService.getScriptProperties().getProperty('CUENTA_REMITENTE_GESTIONES') || '';
    var asuntoCorreo = "[Sindicato SLIM N°3] " + etiquetaGestion + " — " + asunto + " — " + beneficiario.nombre + " (" + formatRutServer(beneficiario.rut) + ")";
    var contenidoEscapado = _escaparHtmlGestion(contenido);
    var asuntoEscapado = _escaparHtmlGestion(asunto);

    var htmlBody =
      '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#334155;max-width:640px;margin:0 auto;background:#ffffff;">' +
        '<table role="presentation" style="width:100%;border-collapse:collapse;margin-bottom:20px;">' +
          '<tr><td style="padding:16px 0;border-bottom:2px solid ' + ACENTO_CORREO_EMPRESA + ';">' +
            '<span style="font-size:16px;font-weight:bold;color:' + ACENTO_CORREO_EMPRESA + ';">Sindicato SLIM N°3</span><br>' +
            '<span style="font-size:12px;color:#64748b;">' + _escaparHtmlGestion(etiquetaGestion) + '</span>' +
          '</td></tr>' +
        '</table>' +
        '<p>Estimados/as,</p>' +
        '<p>Junto con saludar, por medio del presente correo el Sindicato SLIM N°3 canaliza la siguiente ' +
        'solicitud del trabajador/a que se individualiza, en el marco de la contingencia del Portal de ' +
        'Autoservicio de Empleados de ISS Chile.</p>' +
        '<table role="presentation" style="width:100%;border-collapse:collapse;margin:20px 0;border:1px solid #e2e8f0;">' +
          '<tr><td style="padding:8px 12px;background:#f8fafc;font-weight:bold;width:35%;border-bottom:1px solid #e2e8f0;">Trabajador/a</td>' +
            '<td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;">' + _escaparHtmlGestion(beneficiario.nombre) + '</td></tr>' +
          '<tr><td style="padding:8px 12px;background:#f8fafc;font-weight:bold;border-bottom:1px solid #e2e8f0;">RUT</td>' +
            '<td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;">' + _escaparHtmlGestion(formatRutServer(beneficiario.rut)) + '</td></tr>' +
          '<tr><td style="padding:8px 12px;background:#f8fafc;font-weight:bold;border-bottom:1px solid #e2e8f0;">Correo de contacto</td>' +
            '<td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;">' + _escaparHtmlGestion(beneficiario.correo || "No registrado") + '</td></tr>' +
          '<tr><td style="padding:8px 12px;background:#f8fafc;font-weight:bold;">Tipo de gestión</td>' +
            '<td style="padding:8px 12px;">' + _escaparHtmlGestion(etiquetaGestion) + '</td></tr>' +
        '</table>' +
        // Panel destacado con el contenido escrito por el socio. Se enmarca con
        // cabecera de acento y el mensaje va en un bloque citado, para que se lea
        // como algo agregado por el trabajador/a y no como texto de la plantilla.
        '<table role="presentation" style="width:100%;border-collapse:separate;border-spacing:0;margin:26px 0;border:1px solid #cbd5e1;border-radius:8px;overflow:hidden;">' +
          '<tr><td style="padding:11px 18px;background:' + ACENTO_CORREO_EMPRESA + ';">' +
            '<span style="font-size:11px;font-weight:bold;letter-spacing:0.09em;text-transform:uppercase;color:#ffffff;">Detalle de la solicitud</span>' +
          '</td></tr>' +
          '<tr><td style="padding:20px;background:#ffffff;">' +
            '<p style="margin:0 0 4px 0;font-size:10px;font-weight:bold;letter-spacing:0.07em;text-transform:uppercase;color:#94a3b8;">Asunto</p>' +
            '<p style="margin:0 0 18px 0;font-size:15px;font-weight:bold;color:#0f172a;line-height:1.4;">' + asuntoEscapado + '</p>' +
            '<p style="margin:0 0 6px 0;font-size:10px;font-weight:bold;letter-spacing:0.07em;text-transform:uppercase;color:#94a3b8;">Mensaje del trabajador/a</p>' +
            '<div style="background:#f8fafc;border-left:3px solid ' + ACENTO_CORREO_EMPRESA + ';border-radius:0 6px 6px 0;padding:14px 16px;">' +
              '<p style="margin:0;font-size:14px;color:#334155;line-height:1.7;">' + contenidoEscapado + '</p>' +
            '</div>' +
          '</td></tr>' +
        '</table>' +
        (blobs.length > 0 ? '<p style="font-style:italic;color:#64748b;">Se adjuntan ' + blobs.length + ' documento(s) de respaldo.</p>' : '') +
        '<div style="background:#eff6ff;border-left:4px solid ' + ACENTO_CORREO_EMPRESA + ';border-radius:0 8px 8px 0;padding:14px 18px;margin:20px 0;">' +
          '<p style="margin:0;font-size:13px;line-height:1.6;color:#1e3a5f;">' +
            '<strong>Importante:</strong> Por favor, responde este correo utilizando la ' +
            'opción <strong>"Responder a todos"</strong>. De esta forma la respuesta ' +
            'queda registrada tanto para el trabajador como para el Sindicato SLIM ' +
            'N°3, manteniendo un respaldo formal de la gestión ante eventuales ' +
            'fiscalizaciones.' +
          '</p>' +
        '</div>' +
        // Aviso orientado al trabajador/a (va en el mismo correo que la empresa lee
        // en copia): plazo de respuesta, valor del correo como medio de prueba y
        // acceso directo al portal MiDT de la Dirección del Trabajo. Paleta sobria
        // en el mismo azul institucional del correo.
        '<table role="presentation" style="width:100%;border-collapse:separate;border-spacing:0;margin:24px 0;border:1px solid #cbd5e1;border-radius:8px;overflow:hidden;">' +
          '<tr><td style="padding:18px 20px;background:#ffffff;">' +
            '<p style="margin:0 0 10px 0;font-size:11px;font-weight:bold;letter-spacing:0.08em;text-transform:uppercase;color:' + ACENTO_CORREO_EMPRESA + ';">Información para el trabajador/a</p>' +
            '<p style="margin:0 0 12px 0;font-size:13px;line-height:1.7;color:#334155;">' +
              'Si el empleador no entrega una respuesta satisfactoria a esta solicitud dentro de un plazo de ' +
              '<strong>3 días hábiles</strong>, conserva este correo como <strong>medio de prueba</strong>. ' +
              'En caso de que el empleador haya incumplido alguna obligación legal, este respaldo te permite ' +
              'solicitar una fiscalización ante la Inspección del Trabajo.' +
            '</p>' +
            '<p style="margin:0 0 16px 0;font-size:13px;line-height:1.7;color:#64748b;">' +
              'Realizar una fiscalización significa pedir formalmente a la Dirección del Trabajo que revise si ' +
              'tu empleador está cumpliendo con tus derechos laborales. Puedes iniciar este trámite en línea a ' +
              'través del portal <strong>MiDT</strong>. Para ingresar necesitas tu <strong>ClaveÚnica</strong>.' +
            '</p>' +
            '<table role="presentation" style="border-collapse:collapse;margin:0 auto;"><tr><td style="border-radius:6px;background:' + ACENTO_CORREO_EMPRESA + ';">' +
              '<a href="https://midt.dirtrab.cl/" target="_blank" rel="noopener" ' +
              'style="display:inline-block;padding:12px 26px;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:6px;">' +
              'Ir al portal MiDT &rarr;</a>' +
            '</td></tr></table>' +
            '<p style="margin:14px 0 0 0;font-size:11px;line-height:1.5;color:#94a3b8;text-align:center;">' +
              'Portal oficial de la Dirección del Trabajo &middot; midt.dirtrab.cl' +
            '</p>' +
          '</td></tr>' +
        '</table>' +
        '<p style="margin-top:24px;">Agradecemos gestionar esta solicitud y responder directamente al correo ' +
        'del trabajador/a indicado.</p>' +
        '<p>Saluda atentamente,<br><strong>Sindicato SLIM N°3</strong></p>' +
        '<div style="margin-top:24px;padding-top:14px;border-top:1px solid #e2e8f0;">' +
          '<p style="margin:0;font-size:11px;color:#94a3b8;line-height:1.5;">' +
            'Este correo fue enviado desde la cuenta oficial de gestiones del ' +
            'Sindicato SLIM N°3' + (cuentaRemitente ? ' (' + _escaparHtmlGestion(cuentaRemitente) + ')' : '') + ' utilizada para ' +
            'la tramitación de solicitudes ante la empresa.' +
          '</p>' +
        '</div>' +
      '</div>';

    // ---- Envío ----
    // Enrutamiento:
    //   "Para": el/los buzón(es) de ISS que corresponden a la gestión.
    //   "CC":   los roles responsables (ADMIN + DIRECTORIO + REPLEGAL) para que
    //           tanto la organización como la empresa estén al tanto, más el
    //           socio (recibe copia y queda en el hilo de "responder a todos") y,
    //           cuando un dirigente tramita a su nombre, también el dirigente
    //           (su único comprobante de la gestión).
    //   "Responder a": el socio, para que la empresa le responda directamente.
    // enviarCorreoFormalConAdjuntos deduplica el CC y descarta los que ya van en "Para".
    var correosDestino  = _obtenerCorreosGestion(tipoGestion);
    var ccResponsables  = obtenerCorreosAdmin()
      .concat(obtenerCorreosDirectorio())
      .concat(obtenerCorreosRepLegal());
    ccResponsables.push(beneficiario.correo);              // el socio recibe copia
    if (esGestionDirigente) ccResponsables.push(gestor.correo); // y el dirigente que la ingresó
    var resultadoEnvio = enviarCorreoFormalConAdjuntos(
      correosDestino,
      asuntoCorreo,
      htmlBody,
      blobs,
      ccResponsables,
      beneficiario.correo                                   // la empresa responde al socio
    );

    if (!resultadoEnvio.success) {
      return { success: false, message: resultadoEnvio.message };
    }

    // ---- Registro en hoja (solo tras envío exitoso) ----
    var sheet = getSheet('DENUNCIAS_JEFATURAS', 'GESTIONES_EMPRESA');
    if (sheet) {
      var COL = CONFIG.COLUMNAS.GESTIONES_EMPRESA;
      var newRow = [];
      newRow[COL.ID]                = idGestion;
      newRow[COL.FECHA_REGISTRO]    = fechaRegistro;
      newRow[COL.RUT]               = beneficiario.rut;
      newRow[COL.NOMBRE]            = beneficiario.nombre;
      newRow[COL.CORREO]            = beneficiario.correo || "";
      newRow[COL.TIPO_GESTION]      = tipoGestion;
      newRow[COL.ASUNTO]            = asunto;
      newRow[COL.CONTENIDO]         = contenido;
      newRow[COL.NOMBRES_ARCHIVOS]  = nombresArchivos.join(" ; ");
      newRow[COL.URLS_RESPALDO]     = urlsRespaldo.join(" ; ");
      newRow[COL.DESTINATARIOS]     = "Para: " + correosDestino.join(" ; ") + " | CC: " + ccResponsables.join(" ; ");
      newRow[COL.ESTADO]            = "Enviado";
      // Traza de quién ingresó el trámite (guardado defensivo: solo si la hoja
      // ya tiene estas columnas — ver _setupHojaGestionesEmpresa/config_local).
      if (COL.GESTION !== undefined)          newRow[COL.GESTION]          = gestion;
      if (COL.NOMBRE_DIRIGENTE !== undefined) newRow[COL.NOMBRE_DIRIGENTE] = nomDirigente;
      sheet.appendRow(newRow);
    } else {
      Logger.log('⚠️ Correo de gestión ' + idGestion + ' enviado pero no se pudo registrar en la hoja (sheet no encontrada).');
    }

    // Nota: ADMIN + DIRECTORIO + REPLEGAL quedan al tanto porque van en el CC
    // del correo formal a la empresa (ver bloque de envío). No se envía una
    // notificación interna adicional para no duplicar correos por gestión.

    return { success: true, message: "Tu solicitud fue enviada correctamente.", idGestion: idGestion };

  } catch (e) {
    Logger.log("❌ Error en enviarGestionEmpresa: " + e.toString());
    return { success: false, message: "Ocurrió un error interno. Por favor, intente más tarde o contacte al administrador." };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Obtiene el historial de trámites/solicitudes de un usuario.
 */
function obtenerHistorialGestiones(rutInput) {
  try {
    _ensureConfig();
    var sheet = getSheet('DENUNCIAS_JEFATURAS', 'GESTIONES_EMPRESA');
    if (!sheet) return { success: true, registros: [] };
    var COL = CONFIG.COLUMNAS.GESTIONES_EMPRESA;
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return { success: true, registros: [] };
    var data = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getDisplayValues();
    var rutLimpio = cleanRut(rutInput);
    var registros = [];
    for (var i = 0; i < data.length; i++) {
      var row = data[i];
      if (cleanRut(row[COL.RUT]) === rutLimpio) {
        registros.push({
          id:          row[COL.ID],
          fecha:       row[COL.FECHA_REGISTRO],
          tipoGestion: CATALOGO_GESTIONES[row[COL.TIPO_GESTION]] || row[COL.TIPO_GESTION],
          asunto:      row[COL.ASUNTO],
          contenido:   row[COL.CONTENIDO],
          archivos:    row[COL.NOMBRES_ARCHIVOS],
          estado:      row[COL.ESTADO]
        });
      }
    }
    registros.reverse();
    return { success: true, registros: registros };
  } catch (e) {
    Logger.log("❌ Error en obtenerHistorialGestiones: " + e.toString());
    return { success: false, message: "Ocurrió un error interno. Por favor, intente más tarde o contacte al administrador." };
  }
}

// ==========================================
// SWITCH SUB-MÓDULO TRÁMITES Y SOLICITUDES A LA EMPRESA
// ==========================================

function obtenerEstadoSwitchGestiones() {
  return _switchHabilitado('gestiones_empresa_habilitado');
}

// Solo ADMIN (validado en _toggleSwitchModulo).
function toggleSwitchGestiones(estado, rutSolicitante) {
  return _toggleSwitchModulo('gestiones_empresa_habilitado', estado, rutSolicitante);
}
