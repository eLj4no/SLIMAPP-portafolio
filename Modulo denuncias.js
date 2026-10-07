// ==========================================
// MODULO_DENUNCIAS.GS — Denuncias Internas Jefatura
// ==========================================

/**
 * Envía la notificación consolidada de una denuncia interna a jefatura.
 *
 * Replica la arquitectura ya validada en Modulo permisosMedicos.js
 * (_notificarPermisoMedico) y Modulo gestionesEmpresa.js: UN solo correo por
 * evento en vez de N correos individuales.
 *
 *   Para → el socio denunciante (el correo ES su comprobante de gestión)
 *   CC   → DIRECTORIO + ADMIN + REPLEGAL (+ dirigente gestor, si aplica)
 *
 * Antes este módulo emitía hasta 5 correos separados por denuncia (comprobante
 * al socio, respaldo al dirigente, copia extra al socio, uno por cada
 * ADMIN/DIRECTORIO y uno por cada REPLEGAL). Todos quedan reemplazados por esta
 * única llamada, de modo que los destinatarios comparten un mismo hilo y pueden
 * responder a todos.
 *
 * Degradación defensiva: si el denunciante no tiene correo válido, el mensaje
 * se quedaría sin "Para" y no saldría para NADIE — tampoco para los roles que
 * viajan en CC. En ese caso se promueven los roles a "Para" antes que perder la
 * trazabilidad por completo.
 *
 * @param {string} asunto            Asunto del correo.
 * @param {string} titulo            Título del encabezado de la plantilla.
 * @param {string} mensaje           Cuerpo HTML del mensaje.
 * @param {Object} detalles          Tabla clave-valor de detalles.
 * @param {string} colorTema         Color de acento de la plantilla.
 * @param {string} correoDenunciante Correo del socio denunciante (puede venir vacío).
 * @param {string} correoDirigente   Correo del dirigente gestor, "" si gestiona el propio socio.
 * @param {boolean} repLegalYaNotificado true cuando REPLEGAL ya recibió la
 *   denuncia con el respaldo adjunto (enviarDocumentosARepLegalAdjuntos). Se
 *   le deja fuera: este correo lleva el enlace de Drive que sus casillas no
 *   pueden abrir, y les llegaban los dos.
 * @returns {{success:boolean, destinatarios:string[], cc:string[], message:string}}
 */
function _notificarDenunciaJefatura(asunto, titulo, mensaje, detalles, colorTema, correoDenunciante, correoDirigente, repLegalYaNotificado) {
  var correosDirectorio = obtenerCorreosDirectorio();
  var correosAdmin      = obtenerCorreosAdmin();
  var correosRepLegal   = repLegalYaNotificado ? [] : obtenerCorreosRepLegal();

  var para = [];
  if (esCorreoValido(correoDenunciante)) para.push(correoDenunciante);

  if (para.length === 0) {
    Logger.log('⚠️ _notificarDenunciaJefatura: denunciante sin correo válido; "Para" degradado a REPLEGAL/ADMIN/DIRECTORIO.');
    para = correosRepLegal.concat(correosAdmin).concat(correosDirectorio);
  }

  // El orden refleja la prioridad institucional de lectura. El helper genérico
  // deduplica y descarta los que ya van en "Para" (relevante si hubo degradación).
  var cc = correosDirectorio.concat(correosAdmin).concat(correosRepLegal);
  if (esCorreoValido(correoDirigente)) cc.push(correoDirigente);

  // permiteRespuesta = true: acá el hilo de respuesta ES el canal por el que el
  // socio aporta evidencia (así lo pide el texto de MENSAJES_ESTADO.DENUNCIAS y
  // el párrafo de copia). Con el pie por defecto —"no respondas a este correo"—
  // el mismo mensaje se contradecía a sí mismo.
  return enviarCorreoEstilizadoConCopia(para, cc, asunto, titulo, mensaje, detalles, colorTema, true);
}

/**
 * Registra una denuncia interna contra jefatura.
 * @param {Object} datos - { rutGestor, categoria, subcategoria, tipoCargo, nombreDenunciado, lugarTrabajo, descripcionHechos, archivo, rutBeneficiario }
 */
function enviarDenunciaJefatura(datos) {
  _ensureConfig();
  var lock = LockService.getScriptLock();
  if (lock.tryLock(30000)) {
    try {
      // El backend también respeta el feature flag de la sección: el webapp es
      // ANYONE_ANONYMOUS, así que ocultar el botón en la UI no impide invocar
      // esta función por nombre con la sección de denuncias pausada.
      if (!obtenerEstadoSwitchDenunciaJefatura().habilitado) {
        return { success: false, message: "La sección de denuncias está temporalmente deshabilitada. Consulta con la directiva para más información." };
      }

      var rutGestor        = datos.rutGestor;
      var categoria        = datos.categoria;
      var subcategoria     = datos.subcategoria;
      var tipoCargo        = datos.tipoCargo;
      var nombreDenunciado = datos.nombreDenunciado;
      var lugarTrabajo     = datos.lugarTrabajo;
      var fechaEvento      = datos.fechaEvento || "";
      var descripcion      = datos.descripcionHechos;
      var archivo          = datos.archivo || null;
      var rutBeneficiario  = datos.rutBeneficiario || null;

      var gestor = obtenerUsuarioPorRut(rutGestor);
      if (!gestor.encontrado) return { success: false, message: "Error de sesión." };

      var rutTarget = rutBeneficiario ? cleanRut(rutBeneficiario) : cleanRut(rutGestor);
      var esGestionDirigente = rutTarget !== cleanRut(rutGestor);
      var denunciante;

      if (!esGestionDirigente) {
        denunciante = gestor;
      } else {
        denunciante = obtenerUsuarioPorRut(rutBeneficiario);
        if (!denunciante.encontrado) return { success: false, message: "RUT del socio no encontrado." };
      }

      // Validaciones básicas
      if (!categoria || !subcategoria || !tipoCargo || !nombreDenunciado || !lugarTrabajo || !fechaEvento || !descripcion) {
        return { success: false, message: "Todos los campos son obligatorios." };
      }

      // Generar ID_DENUNCIA formato DJ-XXXX
      var idDenuncia = "DJ-" + String(Math.floor(1000 + Math.random() * 9000));
      var fechaHoy = new Date();
      var fechaRegistro = Utilities.formatDate(fechaHoy, Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm:ss");

      var urlArchivo = "Sin archivo";
      var alertaPermisosResp = null;

      if (archivo && archivo.base64) {
        var carpetaId = CONFIG.CARPETAS.DENUNCIAS_JEFATURAS;
        if (!carpetaId) {
          return { success: false, message: "La carpeta de almacenamiento no está configurada. Contacta con el administrador." };
        }
        var validacionCorreos = validarCorreosParaPermisos(
          { rut: denunciante.rut, nombre: denunciante.nombre, correo: denunciante.correo },
          esGestionDirigente ? { rut: gestor.rut, nombre: gestor.nombre, correo: gestor.correo } : null,
          esGestionDirigente
        );
        var nombreArchivo = "DENUNCIA-" + idDenuncia + "-" + cleanRut(denunciante.rut);
        var resultadoSubida = subirArchivoConPermisos(archivo, carpetaId, nombreArchivo, validacionCorreos.correosParaPermisos, []);
        if (!resultadoSubida.success) return { success: false, message: "Error al subir el archivo: " + resultadoSubida.mensajeError };
        urlArchivo = resultadoSubida.url;
        alertaPermisosResp = generarAlertaPermisos(validacionCorreos, resultadoSubida);

        // Otorgar lectura a roles de supervisión activos en CUENTAS_VALIDAS
        compartirArchivoConRol(resultadoSubida.fileId, 'DIRIGENTE',  'leer');
        compartirArchivoConRol(resultadoSubida.fileId, 'DIRECTORIO', 'leer');
        compartirArchivoConRol(resultadoSubida.fileId, 'ADMIN',      'leer');
        // REPLEGAL no recibe permiso de Drive: sus casillas no son cuentas
        // Google y el otorgamiento silencioso siempre falla. El archivo les
        // llega adjunto en un correo aparte, después de la notificación.
        var fileIdDenuncia = resultadoSubida.fileId;
      }

      var sheet = getSheet('DENUNCIAS_JEFATURAS', 'DENUNCIAS_JEFATURAS');
      if (!sheet) return { success: false, message: "Error al acceder a la base de datos." };

      var COL = CONFIG.COLUMNAS.DENUNCIAS_JEFATURAS;
      var gestion = "Socio", nomDirigente = "", correoDirigente = "";
      if (esGestionDirigente) { gestion = "Dirigente"; nomDirigente = gestor.nombre; correoDirigente = gestor.correo; }

      var newRow = [];
      newRow[COL.ID]                 = idDenuncia;
      newRow[COL.FECHA_REGISTRO]     = fechaRegistro;
      newRow[COL.RUT_DENUNCIANTE]    = denunciante.rut;
      newRow[COL.NOMBRE_DENUNCIANTE] = denunciante.nombre;
      newRow[COL.CATEGORIA]          = categoria;
      newRow[COL.SUBCATEGORIA]       = subcategoria;
      newRow[COL.TIPO_CARGO]         = tipoCargo;
      newRow[COL.NOMBRE_DENUNCIADO]  = nombreDenunciado;
      newRow[COL.LUGAR_TRABAJO]      = lugarTrabajo;
      newRow[COL.FECHA_EVENTO]       = fechaEvento;
      newRow[COL.DESCRIPCION]        = descripcion;
      newRow[COL.URL_ARCHIVO]        = urlArchivo;
      newRow[COL.ESTADO]             = "Enviado";
      newRow[COL.ESTADO_SOCIO]       = "Enviado";
      newRow[COL.GESTION]            = gestion;
      newRow[COL.NOMBRE_DIRIGENTE]    = nomDirigente;
      newRow[COL.CORREO_DIRIGENTE]    = correoDirigente;
      newRow[COL.CORREO_DENUNCIANTE]   = denunciante.correo   || "";
      newRow[COL.CELULAR_DENUNCIANTE]  = denunciante.contacto || "";

      sheet.appendRow(newRow);

      // Un único link con el color del tema del correo: antes se construían tres
      // variantes (verde/gris) porque había tres correos distintos.
      var linkArchivo = (urlArchivo && urlArchivo.includes("http"))
        ? '<a href="' + urlArchivo + '" style="color:#00875a;text-decoration:none;font-weight:bold;">Ver Archivo Adjunto</a>'
        : "Sin archivo";

      // En la hoja se guarda yyyy-MM-dd (formato de intercambio); en los
      // correos se muestra dd/mm/yyyy.
      var fechaEventoDisplay = formatearFechaSinHora(fechaEvento) || fechaEvento;

      // El texto explicativo vive en Modulo mensajesEstado.js (DENUNCIAS.Enviado)
      // para no mantenerlo duplicado.
      var mensajeProceso = "<br><br><strong>¿Qué ocurre ahora con tu denuncia?</strong>" +
        bloqueExplicacionEstado(obtenerMensajeEstado('DENUNCIAS', 'Enviado'));

      // ==========================================
      // NOTIFICACIÓN CONSOLIDADA (un solo correo)
      // Para: socio denunciante | CC: DIRECTORIO + ADMIN + REPLEGAL (+ dirigente)
      // ==========================================

      // El cuerpo se dirige al socio (es su comprobante) e informa de forma
      // explícita que la denuncia quedó copiada a los roles responsables. Así el
      // mismo texto sirve tanto de comprobante como de aviso interno.
      var saludoCorreo = esGestionDirigente
        ? "Hola <strong>" + denunciante.nombre + "</strong>, un dirigente ha registrado una denuncia interna a tu nombre. A continuación los detalles registrados:"
        : "Hola <strong>" + denunciante.nombre + "</strong>, tu denuncia interna ha sido registrada correctamente. A continuación los detalles registrados:";

      var mensajeCorreo = saludoCorreo + mensajeProceso +
        "<br><br><span style=\"font-size:12px;color:#64748b;\">Este comprobante fue enviado con copia al <strong>Directorio</strong> y la <strong>Administración</strong> del Sindicato SLIM N°3, y también a los <strong>representantes legales de la empresa</strong>, para que se adopten las medidas necesarias y tu reclamo sea atendido satisfactoriamente. Todos quienes reciben esta copia ya están en conocimiento de la denuncia y darán seguimiento al caso. Puedes usar <em>Responder a todos</em> si necesitas aportar antecedentes adicionales.</span>";

      var detallesDenuncia = {
        "ID DENUNCIA":        idDenuncia,
        "FECHA REGISTRO":     fechaRegistro,
        "RUT DENUNCIANTE":    formatRutServer(denunciante.rut),
        "NOMBRE DENUNCIANTE": denunciante.nombre,
        "CATEGORÍA":          categoria,
        "SUBCATEGORÍA":       subcategoria,
        "TIPO DE CARGO":      tipoCargo,
        "NOMBRE DENUNCIADO":  nombreDenunciado,
        "LUGAR DE TRABAJO":   lugarTrabajo,
        "FECHA DEL HECHO":    fechaEventoDisplay,
        "DESCRIPCIÓN":        descripcion,
        "ARCHIVO ADJUNTO":    linkArchivo,
        "ESTADO":             "Enviado"
      };

      // Trazabilidad de quién ingresó el trámite: solo aparece cuando un
      // dirigente gestiona a nombre del socio, para no ensuciar la tabla en el
      // caso normal (el socio ingresa su propia denuncia).
      if (esGestionDirigente) {
        detallesDenuncia["GESTIÓN"]        = gestion;
        detallesDenuncia["GESTIONADO POR"] = nomDirigente;
      }

      // Con archivo de respaldo, REPLEGAL recibe la denuncia en un correo propio
      // con el archivo adjunto, y queda FUERA del consolidado: sus casillas no
      // son cuentas Google y el enlace de Drive de ese correo les pide un acceso
      // que nunca van a tener. Aparte y no adjunto al consolidado porque ese
      // lleva en copia al denunciante, al directorio y a administración — no
      // corresponde multiplicar copias de una denuncia para resolverle el
      // acceso a tres. Si el adjunto no sale, vuelven al consolidado.
      var adjRepLegal = fileIdDenuncia
        ? enviarDocumentosARepLegalAdjuntos(
            [fileIdDenuncia],
            "Denuncia Interna Registrada — Sindicato SLIM n°3",
            "Denuncia Interna Registrada",
            "Se ha registrado una denuncia interna del trabajador <strong>" + denunciante.nombre + "</strong>. " +
              "Se adjunta el archivo de respaldo presentado.",
            detallesDenuncia, "#00875a")
        : null;

      // enviarCorreoEstilizadoConCopia() nunca lanza excepción: devuelve
      // success:false. Se registra la falla sin abortar la transacción, porque la
      // denuncia YA quedó escrita en la hoja y en Drive.
      var resultadoNotificacion = _notificarDenunciaJefatura(
        "Denuncia Interna Registrada — Sindicato SLIM n°3",
        "Comprobante de Denuncia Interna",
        mensajeCorreo,
        detallesDenuncia,
        "#00875a",
        denunciante.correo,
        esGestionDirigente ? correoDirigente : "",
        !!(adjRepLegal && adjRepLegal.success)
      );

      if (!resultadoNotificacion.success) {
        Logger.log('⚠️ Denuncia ' + idDenuncia + ' registrada, pero la notificación falló: ' + resultadoNotificacion.message);
      } else {
        Logger.log('✅ Denuncia ' + idDenuncia + ' notificada. Para: ' + resultadoNotificacion.destinatarios.join(', ') +
                   ' | CC: ' + resultadoNotificacion.cc.join(', '));
      }

      var respuesta = { success: true, message: "Denuncia registrada exitosamente.", idDenuncia: idDenuncia };
      if (alertaPermisosResp && alertaPermisosResp.mostrarAlerta) {
        respuesta.mostrarAlerta    = true;
        respuesta.tipoAlerta       = alertaPermisosResp.tipoAlerta;
        respuesta.mensajeAlerta    = alertaPermisosResp.mensajeAlerta;
      }
      return respuesta;

    } catch (e) {
      Logger.log("❌ Error en enviarDenunciaJefatura: " + e.toString());
      return { success: false, message: "Ocurrió un error interno. Por favor, intente más tarde o contacte al administrador." };
    } finally {
      lock.releaseLock();
    }
  } else {
    return { success: false, message: "Servidor ocupado. Intente nuevamente." };
  }
}

/**
 * Obtiene el historial de denuncias de un usuario
 */
function obtenerHistorialDenuncias(rutInput) {
  try {
    var sheet = getSheet('DENUNCIAS_JEFATURAS', 'DENUNCIAS_JEFATURAS');
    var COL = CONFIG.COLUMNAS.DENUNCIAS_JEFATURAS;
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return { success: true, registros: [] };
    var data = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getDisplayValues();
    var rutLimpio = cleanRut(rutInput);
    var registros = [];
    for (var i = 0; i < data.length; i++) {
      var row = data[i];
      if (cleanRut(row[COL.RUT_DENUNCIANTE]) === rutLimpio) {
        registros.push({
          id:          row[COL.ID],
          fecha:       row[COL.FECHA_REGISTRO],
          categoria:   row[COL.CATEGORIA],
          subcategoria:row[COL.SUBCATEGORIA],
          tipoCargo:   row[COL.TIPO_CARGO],
          denunciado:  row[COL.NOMBRE_DENUNCIADO],
          lugar:       row[COL.LUGAR_TRABAJO],
          fechaEvento: row[COL.FECHA_EVENTO],
          descripcion: row[COL.DESCRIPCION],
          urlArchivo:  row[COL.URL_ARCHIVO],
          estado:      row[COL.ESTADO],
          gestion:     row[COL.GESTION]
        });
      }
    }
    registros.reverse();
    return { success: true, registros: registros };
  } catch (e) {
    Logger.log("❌ Error en obtenerHistorialDenuncias: " + e.toString());
    return { success: false, message: "Ocurrió un error interno. Por favor, intente más tarde o contacte al administrador." };
  }
}

// ==========================================
// SWITCH MÓDULO DENUNCIAS INTERNAS
// ==========================================

function obtenerEstadoSwitchDenuncias() {
  return _switchHabilitado('denuncias_habilitado');
}

// Solo ADMIN (validado en _toggleSwitchModulo).
function toggleSwitchDenuncias(estado, rutSolicitante) {
  return _toggleSwitchModulo('denuncias_habilitado', estado, rutSolicitante);
}

// --- Sub-sección "Denuncia a tu Jefatura" ---
// Flag propio, independiente del maestro `denuncias_habilitado` (que controla
// toda la vista "Trámites y Denuncias"). Permite pausar solo esta sección sin
// afectar la de "Trámites con la Empresa". Simétrico a gestiones_empresa_habilitado.
function obtenerEstadoSwitchDenunciaJefatura() {
  return _switchHabilitado('denuncia_jefatura_habilitado');
}

// Solo ADMIN (validado en _toggleSwitchModulo).
function toggleSwitchDenunciaJefatura(estado, rutSolicitante) {
  return _toggleSwitchModulo('denuncia_jefatura_habilitado', estado, rutSolicitante);
}


