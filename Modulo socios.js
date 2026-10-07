// ==========================================
// MODULO_SOCIOS.GS — Autenticación, datos personales, bancarios, vestuario, credencial
// ==========================================

// ==========================================
// ACCESO Y AUTENTICACIÓN
// ==========================================

/**
 * Valida usuario (Login)
 */
function validarUsuario(rutInput, passwordInput) {
  try {
    _ensureConfig();
    var rutLimpio = cleanRut(rutInput);
    var COL = CONFIG.COLUMNAS.USUARIOS;
    var sheet = getSheet('USUARIOS', 'USUARIOS');
    var rowNum = buscarFilaPorRut(sheet, rutLimpio);
    if (rowNum === -1) return { success: false, message: "RUT no encontrado", errorType: "rut" };
    var row = sheet.getRange(rowNum, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];

    var passDb = String(row[COL.ID_CREDENCIAL]);
    if (String(passDb).toUpperCase() === String(passwordInput).toUpperCase()) {
      return {
        success: true,
        message: "Login exitoso",
        // Token de sesión de servidor: permite que una consulta resuelva el RUT
        // sin recibirlo del cliente (ver bloque "SESIÓN DE USUARIO" en Global.js).
        sessionToken: crearSesionUsuario(rutLimpio),
        user: row[COL.NOMBRE] || "Socio",
        role: String(row[COL.ROL]).trim().toUpperCase() || "SOCIO",
        state: String(row[COL.ESTADO]).toUpperCase() || "ACTIVO",
        estadoNegColect: String(row[COL.ESTADO_NEG_COLECT] || "").trim().toUpperCase()
      };
    } else {
      return { success: false, message: "Contraseña incorrecta", errorType: "password" };
    }
  } catch (e) {
    Logger.log('ERROR en validarUsuario: ' + e.toString());
    return { success: false, message: "Ocurrió un error interno. Por favor, intente más tarde o contacte al administrador." };
  }
}

/**
 * Obtener datos completos del usuario
 */
function obtenerDatosUsuario(rutInput) {
  try {
    var sheet = getSheet('USUARIOS', 'USUARIOS');
    var rutLimpio = cleanRut(rutInput);
    var COL = CONFIG.COLUMNAS.USUARIOS;
    var rowNum = buscarFilaPorRut(sheet, rutLimpio);
    if (rowNum === -1) return { success: false, message: "Datos no encontrados." };
    var row = sheet.getRange(rowNum, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
    return {
      success: true,
      datos: {
        rut:                row[COL.RUT]             || "---",
        nombre:             row[COL.NOMBRE]          || "Sin Nombre",
        cargo:              row[COL.CARGO]           || "---",
        site:               row[COL.SITE]            || "---",
        // Fecha de afiliacion (columna C). Es SOLO LECTURA en Mis Datos: la
        // administra el sindicato, y de ella depende desde que mes se le evalua
        // la participacion al socio.
        fechaIngreso:       row[COL.FECHA_INGRESO]   || "",
        region:             row[COL.REGION],
        estado:             String(row[COL.ESTADO]).toUpperCase(),
        correo:             row[COL.CORREO],
        contacto:           row[COL.CONTACTO],
        estadoNegColect:    String(row[COL.ESTADO_NEG_COLECT] || "").trim().toUpperCase(),
        banco:              row[COL.BANCO]                || "",
        tipoCuenta:         row[COL.TIPO_CUENTA]          || "",
        numeroCuenta:       row[COL.NUMERO_CUENTA]        || "",
        tallaPolera:        row[COL.TALLA_POLERA]         || "",
        tallaPolar:         row[COL.TALLA_POLAR]          || "",
        tallaPantalon:      row[COL.TALLA_PANTALON]       || "",
        tallaCalzado:       row[COL.TALLA_CALZADO]        || "",
        calzadoEspecial:    row[COL.CALZADO_ESPECIAL]     || "NO",
        urlCertPieDiabetico:row[COL.URL_CERT_PIE_DIABETICO] || "",
        // Jefatura directa declarada por el socio. Si CONFIG aún no tiene las
        // columnas (falta _configurarColumnasSupervisor), row[undefined] es
        // undefined y el perfil muestra "S/D" en vez de romperse.
        supervisor:         row[COL.SUPERVISOR]        || "",
        correoSupervisor:   row[COL.CORREO_SUPERVISOR] || "",
        estadoCredencial:   obtenerEstadoCredencialPorRut(row[COL.RUT]),
        // Beneficio por Fallecimiento — designación de beneficiarios. Lectura
        // defensiva: si CONFIG aún no tiene las columnas (falta ejecutar
        // _configurarDocFallecimiento()), no rompe y cae a "SIN DOCUMENTO".
        // .trim() es obligatorio: hay whitespace invisible en celdas de la
        // planilla y la comparación por estado falla silenciosamente sin él.
        docFallecimientoUrl:    (COL.DOC_FALLECIMIENTO_URL    !== undefined) ? (row[COL.DOC_FALLECIMIENTO_URL]    || "") : "",
        docFallecimientoEstado: (COL.DOC_FALLECIMIENTO_ESTADO !== undefined) ? (String(row[COL.DOC_FALLECIMIENTO_ESTADO] || "").trim().toUpperCase() || "SIN DOCUMENTO") : "SIN DOCUMENTO",
        docFallecimientoFecha:  (COL.DOC_FALLECIMIENTO_FECHA  !== undefined) ? (row[COL.DOC_FALLECIMIENTO_FECHA]  || "") : ""
      }
    };
  } catch (e) {
    return { success: false, message: "Ocurrió un error interno. Por favor, intente más tarde o contacte al administrador." };
  }
}

/**
 * Obtener datos de usuario por RUT — Función auxiliar centralizada con caché
 */
function obtenerUsuarioPorRut(rutInput) {
  _ensureConfig();
  var cache = CacheService.getScriptCache();
  var rutLimpio = cleanRut(rutInput);
  var cacheKey = 'user_' + rutLimpio;

  var cached = cache.get(cacheKey);
  if (cached) {
    try { return JSON.parse(cached); } catch (e) { Logger.log('Error parsing cache: ' + e); }
  }

  var sheet = getSheet('USUARIOS', 'USUARIOS');
  var COL = CONFIG.COLUMNAS.USUARIOS;
  var rowNum = buscarFilaPorRut(sheet, rutLimpio);
  if (rowNum === -1) return { encontrado: false };

  // El rango llega hasta la última columna que este objeto necesita. Se calcula
  // en vez de fijarse para que CORREO_SUPERVISOR quede incluida sin romper nada
  // mientras esa columna todavía no está configurada (undefined → se ignora).
  var ultimaColumna = Math.max(COL.ESTADO_NEG_COLECT, COL.CORREO_SUPERVISOR || 0) + 1;
  var row = sheet.getRange(rowNum, 1, 1, ultimaColumna).getDisplayValues()[0];
  var usuario = {
    encontrado:     true,
    rut:            row[COL.RUT],
    nombre:         row[COL.NOMBRE],
    correo:         row[COL.CORREO],
    region:         row[COL.REGION],
    // Fecha de afiliacion (columna C). La necesita la participacion: a un socio
    // no se le puede imputar una falta de un mes en que todavia no era socio.
    // Viene de getDisplayValues(), o sea texto en formato chileno: quien la use
    // debe parsearla con parsearFechaFlexible(), nunca con new Date(string).
    fechaIngreso:   row[COL.FECHA_INGRESO] || "",
    cargo:          row[COL.CARGO],
    site:           row[COL.SITE],
    estado:         row[COL.ESTADO],
    rol:            row[COL.ROL],
    contacto:       row[COL.CONTACTO],
    estadoNegColect:String(row[COL.ESTADO_NEG_COLECT] || "").trim().toUpperCase(),
    banco:          row[COL.BANCO]          || "",
    tipoCuenta:     row[COL.TIPO_CUENTA]    || "",
    numeroCuenta:   row[COL.NUMERO_CUENTA]  || "",
    // Jefatura directa del socio — disponible aquí para que los módulos que
    // notifican gestiones puedan sumarla a futuro sin releer la hoja.
    supervisor:       row[COL.SUPERVISOR]        || "",
    correoSupervisor: row[COL.CORREO_SUPERVISOR] || ""
  };
  try { cache.put(cacheKey, JSON.stringify(usuario), 600); } catch (e) {}
  return usuario;
}

// ==========================================
// RECUPERACIÓN DE CONTRASEÑA
// ==========================================

function recuperarContrasena(rutInput) {
  try {
    var sheet = getSheet('USUARIOS', 'USUARIOS');
    var rutLimpio = cleanRut(rutInput);
    var COL = CONFIG.COLUMNAS.USUARIOS;
    var rowNum = buscarFilaPorRut(sheet, rutLimpio);
    if (rowNum === -1) return { success: false, message: "Usuario no encontrado." };
    var correo = sheet.getRange(rowNum, COL.CORREO + 1).getDisplayValue();
    return { success: true, correo: correo || "No registrado" };
  } catch (e) {
    return { success: false, message: "Ocurrió un error interno. Por favor, intente más tarde o contacte al administrador." };
  }
}

function enviarContrasenaCorreo(rutInput) {
  try {
    var sheet = getSheet('USUARIOS', 'USUARIOS');
    var rutLimpio = cleanRut(rutInput);
    var COL = CONFIG.COLUMNAS.USUARIOS;
    var rowNum = buscarFilaPorRut(sheet, rutLimpio);
    if (rowNum === -1) return { success: false, message: "Usuario no encontrado." };
    var row = sheet.getRange(rowNum, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
    var nombre   = row[COL.NOMBRE];
    var correo   = row[COL.CORREO];
    var password = row[COL.ID_CREDENCIAL];

    if (!correo || !correo.includes("@")) {
      return { success: false, message: "No tienes un correo registrado. Contacta con la directiva." };
    }

    enviarCorreoEstilizado(
      correo,
      "Recuperación de Contraseña - Sindicato SLIM n°3",
      "Recuperación de Contraseña",
      "Hola " + nombre + ", has solicitado recuperar tu contraseña de acceso al portal.",
      { "Tu contraseña es": password, "RUT": row[COL.RUT] },
      "#3b82f6"
    );

    return { success: true, message: "Contraseña enviada exitosamente." };
  } catch (e) {
    return { success: false, message: "Ocurrió un error interno. Por favor, intente más tarde o contacte al administrador." };
  }
}

// ==========================================
// ACTUALIZACIÓN DE DATOS PERSONALES
// ==========================================

/**
 * Valida el nombre de la jefatura directa que declara el socio.
 *
 * Se piden entre 2 y 3 palabras: nombre + apellido como mínimo, y a lo más
 * nombre + los dos apellidos. Sirve para que el dato quede utilizable en las
 * notificaciones y para descartar entradas de una sola palabra ("Juan") o
 * frases completas. El gemelo en el frontend es validarNombreSupervisor()
 * (Index.html) — si cambia uno, cambiar el otro.
 *
 * Devuelve { valido, valor, message }. `valor` viene con los espacios
 * colapsados, que es lo que corresponde escribir en la hoja.
 */
function _validarNombreSupervisor(valor) {
  var limpio = String(valor || "").replace(/\s+/g, " ").trim();

  if (!limpio) {
    return { valido: false, valor: "", message: "Ingresa el nombre de tu jefatura." };
  }

  // Letras (con tildes y ñ), apóstrofes y guiones: apellidos como "O'Higgins"
  // o "Pérez-Soto" son válidos; números y símbolos no.
  if (!/^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ'’\-]+( [A-Za-zÁÉÍÓÚÜÑáéíóúüñ'’\-]+)*$/.test(limpio)) {
    return { valido: false, valor: limpio, message: "El nombre solo puede contener letras." };
  }

  var palabras = limpio.split(" ");
  if (palabras.length < 2) {
    return { valido: false, valor: limpio, message: "Ingresa al menos nombre y apellido." };
  }
  if (palabras.length > 3) {
    return { valido: false, valor: limpio, message: "Ingresa como máximo nombre y dos apellidos." };
  }

  return { valido: true, valor: limpio, message: "" };
}

/**
 * true si la región registrada cuenta como "sin asignar": vacía o con uno de
 * los rellenos que aparecen en la base ("S/D", "-"). Su par en el frontend es
 * _regionSinAsignarFront() (Index.html): se mueven juntos.
 */
function _regionSinAsignar(valor) {
  var v = String(valor || "").trim().toUpperCase();
  return v === "" || v === "S/D" || v === "SD" || v === "-" || v === "—";
}

/**
 * Actualiza un campo individual del usuario
 */
function actualizarDatoUsuario(rutInput, campo, valor) {
  _ensureConfig();
  var lock = LockService.getScriptLock();
  if (lock.tryLock(30000)) {
    try {
      var sheet = getSheet('USUARIOS', 'USUARIOS');
      var rutLimpio = cleanRut(rutInput);
      var COL = CONFIG.COLUMNAS.USUARIOS;

      var colIndex = -1;
      if (campo === 'region')       colIndex = COL.REGION;
      else if (campo === 'correo')  colIndex = COL.CORREO;
      else if (campo === 'contacto')colIndex = COL.CONTACTO;
      else if (campo === 'banco')   colIndex = COL.BANCO;
      else if (campo === 'tipoCuenta')  colIndex = COL.TIPO_CUENTA;
      else if (campo === 'numeroCuenta')colIndex = COL.NUMERO_CUENTA;
      else if (campo === 'supervisor')       colIndex = COL.SUPERVISOR;
      else if (campo === 'correoSupervisor') colIndex = COL.CORREO_SUPERVISOR;

      // Las dos columnas de jefatura son posteriores al resto: si todavía no se
      // ejecutó _configurarColumnasSupervisor() en este proyecto, el índice es
      // undefined y escribir ahí perdería el dato en silencio.
      if ((campo === 'supervisor' || campo === 'correoSupervisor') && colIndex === undefined) {
        Logger.log('⚠️ CONFIG sin ' + campo + ' — ejecuta _configurarColumnasSupervisor(). El dato NO se guardó.');
        return { success: false, message: "Esta función aún no está disponible. Avisa a la directiva." };
      }

      if (colIndex === -1) return { success: false, message: "Campo inválido" };

      // El webapp es ANYONE_ANONYMOUS: la validación del formulario no basta,
      // se revalida acá antes de escribir.
      var valorFinal = valor;
      if (campo === 'supervisor') {
        var validacion = _validarNombreSupervisor(valor);
        if (!validacion.valido) return { success: false, message: validacion.message };
        valorFinal = validacion.valor;
      }
      // Validación estricta al ESCRIBIR: es la única barrera contra que entre a
      // la base una dirección con símbolos inválidos y ahí se quede. El webapp es
      // ANYONE_ANONYMOUS, así que la validación del formulario no basta.
      if (campo === 'correoSupervisor' || campo === 'correo') {
        valorFinal = String(valor || "").trim().toLowerCase();
        if (!esCorreoValidoEstricto(valorFinal)) {
          return {
            success: false,
            message: campo === 'correo'
              ? "Ingresa un correo electrónico válido. Revisa que no tenga espacios ni símbolos como / o ,"
              : "Ingresa un correo electrónico válido para tu jefatura."
          };
        }
      }

      if (campo === 'region') {
        valorFinal = String(valor || "").trim();
        if (!valorFinal) return { success: false, message: "Selecciona una región." };
      }

      var rowNum = buscarFilaPorRut(sheet, rutLimpio);
      if (rowNum === -1) return { success: false, message: "Usuario no hallado para editar" };

      // La región sólo la elige el socio que todavía no tiene una. Cambiarla
      // libremente permitía pasarse a otra región cuyo plazo de justificación
      // siguiera abierto. Se lee la celda dentro del lock, no desde el caché ni
      // desde lo que diga el navegador. Una corrección la hace la directiva
      // directamente en la base.
      if (campo === 'region') {
        var regionActual = sheet.getRange(rowNum, colIndex + 1).getDisplayValue();
        if (!_regionSinAsignar(regionActual)) {
          Logger.log('⚠️ actualizarDatoUsuario: intento de cambiar región ya asignada — RUT=' + rutLimpio);
          return { success: false, message: "Tu región ya está asignada y no se puede modificar. Si no corresponde, comunícate con la directiva." };
        }
      }

      sheet.getRange(rowNum, colIndex + 1).setValue(valorFinal);
      var cache = CacheService.getScriptCache();
      cache.remove('user_' + rutLimpio);
      cache.remove('loginRow_' + rutLimpio);

      // Al cambiar el correo, los permisos de Drive de sus archivos quedan
      // anclados al anterior. Aquí sólo se DEJA LA SEÑAL: el trabajo lo hace el
      // activador reconciliarPermisosPendientes() dentro de los 30 minutos
      // siguientes. Hacerlo acá dejaría al socio esperando un recorrido de Drive
      // dentro de este mismo lock, y sin reintento si falla a la mitad.
      if (campo === 'correo') marcarRutParaReconciliacionPermisos(rutLimpio);
      // Se devuelve el valor realmente escrito: puede diferir del enviado
      // (espacios colapsados, correo en minúsculas) y la vista debe mostrar eso.
      return { success: true, message: "OK", valor: valorFinal };
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
 * Actualiza los 3 campos bancarios para Cuenta RUT de Banco Estado
 */
function actualizarBancoEstado(rutInput) {
  var lock = LockService.getScriptLock();
  if (lock.tryLock(30000)) {
    try {
      var sheet = getSheet('USUARIOS', 'USUARIOS');
      var rutLimpio = cleanRut(rutInput);
      var COL = CONFIG.COLUMNAS.USUARIOS;
      var rutBody = rutLimpio.slice(0, -1);

      var rowNum = buscarFilaPorRut(sheet, rutLimpio);
      if (rowNum === -1) return { success: false, message: "Usuario no encontrado." };

      sheet.getRange(rowNum, COL.BANCO + 1).setValue("BANCO ESTADO (Cuenta RUT)");
      sheet.getRange(rowNum, COL.TIPO_CUENTA + 1).setValue("CUENTA VISTA");
      sheet.getRange(rowNum, COL.NUMERO_CUENTA + 1).setValue(rutBody);
      var cache = CacheService.getScriptCache();
      cache.remove('user_' + rutLimpio);
      cache.remove('loginRow_' + rutLimpio);
      return { success: true, numeroCuenta: rutBody, tipoCuenta: "CUENTA VISTA" };
    } catch (e) {
      return { success: false, message: "Ocurrió un error interno. Por favor, intente más tarde o contacte al administrador." };
    } finally {
      lock.releaseLock();
    }
  } else {
    return { success: false, message: "Servidor ocupado. Intente nuevamente." };
  }
}

/**
 * Guarda los 3 campos bancarios en una sola operación atómica
 */
function actualizarDatosBancarios(rutInput, banco, tipoCuenta, numeroCuenta) {
  var lock = LockService.getScriptLock();
  if (lock.tryLock(30000)) {
    try {
      var sheet = getSheet('USUARIOS', 'USUARIOS');
      var rutLimpio = cleanRut(rutInput);
      var COL = CONFIG.COLUMNAS.USUARIOS;

      var rowNum = buscarFilaPorRut(sheet, rutLimpio);
      if (rowNum === -1) return { success: false, message: "Usuario no encontrado." };

      sheet.getRange(rowNum, COL.BANCO + 1).setValue(banco);
      sheet.getRange(rowNum, COL.TIPO_CUENTA + 1).setValue(tipoCuenta);
      sheet.getRange(rowNum, COL.NUMERO_CUENTA + 1).setValue(numeroCuenta);
      var cache = CacheService.getScriptCache();
      cache.remove('user_' + rutLimpio);
      cache.remove('loginRow_' + rutLimpio);
      return { success: true };
    } catch (e) {
      return { success: false, message: "Ocurrió un error interno. Por favor, intente más tarde o contacte al administrador." };
    } finally {
      lock.releaseLock();
    }
  } else {
    return { success: false, message: "Servidor ocupado. Intente nuevamente." };
  }
}

/**
 * Guarda datos de vestuario del usuario (incluye upload de certificado pie diabético)
 */
function guardarDatosVestuario(rutInput, datosVestuario) {
  var lock = LockService.getScriptLock();
  if (lock.tryLock(30000)) {
    try {
      var sheet = getSheet('USUARIOS', 'USUARIOS');
      var rutLimpioInput = cleanRut(rutInput);
      var COL = CONFIG.COLUMNAS.USUARIOS;

      var tallasValidas  = ['XS','S','M','L','XL','XXL','3XL','4XL','5XL'];
      var numerosValidos = ['32','34','36','38','40','42','44','46','48','50','52','54','56','58','60','62','64','66','67'];

      if (datosVestuario.tallaPolera && !tallasValidas.includes(datosVestuario.tallaPolera)) {
        return { success: false, message: "Talla Polera/Camisa inválida." };
      }
      if (datosVestuario.tallaPolar && !tallasValidas.includes(datosVestuario.tallaPolar)) {
        return { success: false, message: "Talla Polar/Chaqueta inválida." };
      }
      if (datosVestuario.tallaPantalon && !numerosValidos.includes(String(datosVestuario.tallaPantalon))) {
        return { success: false, message: "Talla Pantalón inválida." };
      }
      if (datosVestuario.tallaCalzado && !['32','33','34','35','36','37','38','39','40','41','42','43','44','45','46','47','48','50','52'].includes(String(datosVestuario.tallaCalzado))) {
        return { success: false, message: "Talla Calzado inválida." };
      }

      var urlCert = "";
      var calzadoEsp = String(datosVestuario.calzadoEspecial || "").toUpperCase() === "SI";

      if (calzadoEsp && datosVestuario.archivo && datosVestuario.archivo.base64) {
        var archivo = datosVestuario.archivo;
        var tiposPermitidos = ['image/jpeg','image/png','image/gif','image/webp','application/pdf',
          'application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document'];

        if (!tiposPermitidos.includes(archivo.mimeType)) {
          return { success: false, message: "Tipo de archivo no permitido. Solo se aceptan imágenes, PDF o documentos Word." };
        }
        var sizeInBytes = Math.ceil((archivo.base64.length * 3) / 4);
        if (sizeInBytes > LIMITE_ARCHIVO_MB * 1024 * 1024) {
          return { success: false, message: "El archivo excede el tamaño máximo permitido de " + LIMITE_ARCHIVO_MB + " MB." };
        }
        // Se sube por subirArchivoConPermisos() como el resto de los módulos: el
        // archivo queda PRIVADO y el acceso se otorga en silencio solo al socio y
        // a los roles que gestionan vestuario. Antes usaba ANYONE_WITH_LINK, que
        // dejaba un documento de salud accesible a cualquiera con el enlace.
        var socioCert   = obtenerUsuarioPorRut(rutLimpioInput);
        var correosCert = [];
        if (socioCert.encontrado && esCorreoValido(socioCert.correo)) {
          correosCert.push({
            correo: String(socioCert.correo).trim().toLowerCase(),
            tipo:   'beneficiario',
            nombre: socioCert.nombre
          });
        }

        var resultadoCert = subirArchivoConPermisos(
          archivo,
          CONFIG.CARPETAS.VESTUARIO_DOCS,
          'CertPieDiabetico_' + rutLimpioInput + '_' + Utilities.formatDate(new Date(), 'America/Santiago', 'yyyyMMdd'),
          correosCert,
          []
        );

        if (!resultadoCert.success) {
          Logger.log('❌ Error subiendo certificado pie diabético: ' + resultadoCert.mensajeError);
          return { success: false, message: "Error al subir el archivo. Intenta nuevamente." };
        }

        urlCert = resultadoCert.url;
        if (resultadoCert.fileId) {
          compartirArchivoConRol(resultadoCert.fileId, 'ADMIN',      'leer');
          compartirArchivoConRol(resultadoCert.fileId, 'DIRECTORIO', 'leer');
        }
      } else if (calzadoEsp && !datosVestuario.archivo) {
        urlCert = datosVestuario.urlActual || "";
      } else {
        urlCert = "";
      }

      var rowNum = buscarFilaPorRut(sheet, rutLimpioInput);
      if (rowNum === -1) return { success: false, message: "Usuario no encontrado en el sistema." };

      sheet.getRange(rowNum, COL.TALLA_POLERA + 1).setValue(datosVestuario.tallaPolera || "");
      sheet.getRange(rowNum, COL.TALLA_POLAR + 1).setValue(datosVestuario.tallaPolar || "");
      sheet.getRange(rowNum, COL.TALLA_PANTALON + 1).setValue(datosVestuario.tallaPantalon || "");
      sheet.getRange(rowNum, COL.TALLA_CALZADO + 1).setValue(datosVestuario.tallaCalzado || "");
      sheet.getRange(rowNum, COL.CALZADO_ESPECIAL + 1).setValue(calzadoEsp ? "SI" : "NO");
      sheet.getRange(rowNum, COL.URL_CERT_PIE_DIABETICO + 1).setValue(urlCert);
      var cache = CacheService.getScriptCache();
      cache.remove('user_' + rutLimpioInput);
      cache.remove('loginRow_' + rutLimpioInput);
      return { success: true, message: "Datos de vestuario guardados correctamente.", urlCert: urlCert };

    } catch (e) {
      Logger.log('❌ Error en guardarDatosVestuario: ' + e.toString());
      return { success: false, message: "Ocurrió un error interno. Por favor, intente más tarde o contacte al administrador." };
    } finally {
      lock.releaseLock();
    }
  } else {
    return { success: false, message: "Servidor ocupado. Intenta nuevamente en unos segundos." };
  }
}

/**
 * Notificación consolidada (un solo correo, no fan-out) por cada cambio de
 * estado del documento de Fallecimiento (designación de beneficiarios).
 * Ruteo: "Para" = correo del socio si es válido, "CC" = ADMIN. Si el socio
 * no tiene correo registrado, "Para" degrada a ADMIN (para que el mensaje no
 * se pierda) y CC queda vacío. Sin DIRECTORIO ni REPLEGAL — mismo criterio de
 * acceso restringido que el resto del módulo (ver guardarDocFallecimiento()).
 * No bloqueante: un fallo de envío no debe impedir la operación que lo gatilla.
 * `urlDocumento` solo agrega el enlace al correo — el permiso de lectura ya
 * quedó otorgado al subir el archivo (beneficiario + compartirArchivoConRol
 * a ADMIN/DIRECTORIO en guardarDocFallecimiento()), así que todo destinatario
 * de este correo ya puede abrirlo.
 */
function _notificarEstadoDocFallecimiento(rutSocio, nombreSocio, correoSocio, estado, observacionAdmin, urlDocumento) {
  try {
    var correosAdmin = obtenerCorreosAdmin();
    var socioValido = esCorreoValido(correoSocio);
    var destinatarios = socioValido ? [correoSocio] : correosAdmin;
    var cc = socioValido ? correosAdmin : [];

    if (destinatarios.length === 0) {
      Logger.log('⚠️ _notificarEstadoDocFallecimiento: sin destinatarios (ni socio ni ADMIN activo) — RUT ' + rutSocio + ', estado ' + estado);
      return;
    }

    var titulos = {
      'EN REVISION':   'Documento en Revisión',
      'APROBADO':      'Designación Aprobada',
      'RECHAZADO':     'Documento Rechazado',
      'SIN DOCUMENTO': 'Designación Restablecida'
    };
    var colores = {
      'EN REVISION':   '#f59e0b',
      'APROBADO':      '#10b981',
      'RECHAZADO':     '#ef4444',
      'SIN DOCUMENTO': '#64748b'
    };
    var tituloEstado = titulos[estado] || 'Actualización de tu Designación';
    var colorTema = colores[estado] || '#e11d48';

    var mensaje = 'Se registró una actualización en el <strong>Beneficio por Fallecimiento</strong> (designación de beneficiarios) de <strong>' +
      (nombreSocio || 'S/D') + '</strong>: su documento pasó a estado <strong>' + tituloEstado + '</strong>.';
    mensaje += bloqueExplicacionEstado(obtenerMensajeEstado('FALLECIMIENTO', estado), colorTema);

    var detalles = {
      'Socio':  nombreSocio || 'S/D',
      'RUT':    formatRutDisplay(rutSocio),
      'Estado': tituloEstado
    };
    if (estado === 'RECHAZADO' && observacionAdmin) {
      detalles['Observación del directorio'] = observacionAdmin;
    }
    if (estado !== 'SIN DOCUMENTO' && urlDocumento) {
      detalles['Documento'] = '<a href="' + urlDocumento + '" style="color:' + colorTema + ';text-decoration:none;font-weight:600;">Ver Documento</a>';
    }

    enviarCorreoEstilizadoConCopia(
      destinatarios, cc,
      'Beneficio por Fallecimiento — ' + tituloEstado,
      tituloEstado, mensaje, detalles, colorTema
    );
  } catch (e) {
    Logger.log('❌ Error en _notificarEstadoDocFallecimiento: ' + e.toString());
  }
}

/**
 * Respalda un evento sobre el documento de Fallecimiento vigente — hoja
 * "Resp_Fallecimiento" (hoja 4 del mismo spreadsheet USUARIOS_SLIMAPP donde
 * vive BD_SLIMAPP). Dos orígenes distintos escriben aquí, distinguidos por
 * `tipo`:
 *   - 'ACTUALIZADO' — el socio reemplaza un documento vigente por uno nuevo
 *     (guardarDocFallecimiento). `observacion` va vacía.
 *   - 'RECHAZADO'   — el ADMIN rechaza el documento vigente
 *     (actualizarEstadoDocFallecimiento). `observacion` es la nota que el
 *     ADMIN ya escribió a mano en la columna AG (DOC_FALLECIMIENTO_OBSERVACION)
 *     del Sheet antes de rechazar — no se recibe desde el frontend.
 * Se crea sola con encabezados si no existe; si ya existe con el esquema
 * anterior (sin TIPO/OBSERVACION), agrega esas columnas al final sin tocar
 * las filas ya guardadas.
 */
function _respaldarDocFallecimientoReemplazado(rutLimpio, nombre, urlAnterior, tipo, observacion) {
  try {
    if (!urlAnterior) return; // nada vigente que respaldar
    tipo = tipo || 'ACTUALIZADO';

    var sheet = getSheet('USUARIOS', 'RESP_FALLECIMIENTO', true);
    if (!sheet) {
      Logger.log('⚠️ No se pudo acceder/crear la hoja Resp_Fallecimiento. Evento NO respaldado (RUT ' + rutLimpio + ', tipo ' + tipo + ').');
      return;
    }

    var headersEsperados = ['RUT', 'NOMBRE', 'FECHA_REEMPLAZO', 'URL_REEMPLAZADA', 'TIPO', 'OBSERVACION'];
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(headersEsperados);
      sheet.getRange(1, 1, 1, headersEsperados.length).setFontWeight('bold');
      sheet.setFrozenRows(1);
    } else {
      // Reparación idempotente: la hoja pudo crearse antes de que existieran
      // TIPO/OBSERVACION (esquema original de 4 columnas).
      var ultimaCol = sheet.getLastColumn();
      var headerActual = sheet.getRange(1, 1, 1, ultimaCol).getValues()[0]
        .map(function(h) { return String(h).trim().toUpperCase(); });
      var faltantes = headersEsperados.filter(function(h) { return headerActual.indexOf(h) === -1; });
      if (faltantes.length > 0) {
        sheet.getRange(1, ultimaCol + 1, 1, faltantes.length).setValues([faltantes]);
        sheet.getRange(1, ultimaCol + 1, 1, faltantes.length).setFontWeight('bold');
      }
    }

    var fechaActual = Utilities.formatDate(new Date(), 'America/Santiago', 'dd/MM/yyyy HH:mm:ss');
    sheet.appendRow([rutLimpio, nombre || '', fechaActual, urlAnterior, tipo, observacion || '']);
  } catch (e) {
    Logger.log('❌ Error en _respaldarDocFallecimientoReemplazado: ' + e.toString());
  }
}

/**
 * Guarda el documento de designación de beneficiarios del beneficio por
 * Fallecimiento (cláusula DÉCIMO NOVENO del contrato colectivo). Calcado del
 * patrón de guardarDatosVestuario(): validación MIME whitelist en servidor,
 * validación de tamaño, subida privada + permisos silenciosos.
 */
function guardarDocFallecimiento(rutInput, datosDoc) {
  _ensureConfig();
  var lock = LockService.getScriptLock();
  if (lock.tryLock(30000)) {
    try {
      var sheet = getSheet('USUARIOS', 'USUARIOS');
      var rutLimpioInput = cleanRut(rutInput);
      var COL = CONFIG.COLUMNAS.USUARIOS;

      if (COL.DOC_FALLECIMIENTO_URL === undefined) {
        Logger.log('⚠️ CONFIG sin DOC_FALLECIMIENTO_URL — ejecuta _configurarDocFallecimiento(). El dato NO se guardó.');
        return { success: false, message: "Ocurrió un error interno. Por favor, intente más tarde o contacte al administrador." };
      }

      if (!datosDoc || !datosDoc.archivo || !datosDoc.archivo.base64) {
        return { success: false, message: "Debes adjuntar un archivo." };
      }
      var archivo = datosDoc.archivo;

      var tiposPermitidos = ['image/jpeg','image/png','image/gif','image/webp','application/pdf',
        'application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
      if (!tiposPermitidos.includes(archivo.mimeType)) {
        return { success: false, message: "Tipo de archivo no permitido. Solo se aceptan imágenes, PDF o documentos Word." };
      }
      var sizeInBytes = Math.ceil((archivo.base64.length * 3) / 4);
      if (sizeInBytes > LIMITE_ARCHIVO_MB * 1024 * 1024) {
        return { success: false, message: "El archivo excede el tamaño máximo permitido de " + LIMITE_ARCHIVO_MB + " MB." };
      }

      var rowNum = buscarFilaPorRut(sheet, rutLimpioInput);
      if (rowNum === -1) return { success: false, message: "Usuario no encontrado en el sistema." };

      var socio = obtenerUsuarioPorRut(rutLimpioInput);
      var correosDoc = [];
      if (socio.encontrado && esCorreoValido(socio.correo)) {
        correosDoc.push({ correo: String(socio.correo).trim().toLowerCase(), tipo: 'beneficiario', nombre: socio.nombre });
      }

      var nombreArchivo = (socio.encontrado ? socio.nombre : rutLimpioInput) + '_' + rutLimpioInput + '_FALLECIMIENTO';
      var resultado = subirArchivoConPermisos(
        archivo,
        CONFIG.CARPETAS.DOCS_FALLECIMIENTO,
        nombreArchivo,
        correosDoc,
        []
      );

      if (!resultado.success) {
        Logger.log('❌ Error subiendo documento de fallecimiento: ' + resultado.mensajeError);
        return { success: false, message: "Error al subir el archivo. Intenta nuevamente." };
      }

      // Este documento contiene datos familiares y porcentajes de herencia:
      // el acceso queda restringido al directorio. NO se comparte con
      // DIRIGENTE ni con REPLEGAL (a diferencia del resto de los uploads del
      // sistema, que sí comparten con roles operativos).
      compartirArchivoConRol(resultado.fileId, 'ADMIN',      'leer');
      compartirArchivoConRol(resultado.fileId, 'DIRECTORIO', 'leer');

      // Si ya había un documento vigente (el socio está reemplazando una
      // designación previa, incluso una ya APROBADO o RECHAZADO), se respalda
      // antes de pisar la celda — ver _respaldarDocFallecimientoReemplazado().
      // Si venía de un rechazo, arrastra la observación que el ADMIN escribió
      // a mano en AG (DOC_FALLECIMIENTO_OBSERVACION) para que quede registrada
      // en el respaldo junto con el reemplazo. No bloqueante: el archivo
      // anterior sigue intacto en Drive aunque este respaldo falle.
      var urlAnterior = sheet.getRange(rowNum, COL.DOC_FALLECIMIENTO_URL + 1).getValue();
      var observacionPrevia = (COL.DOC_FALLECIMIENTO_OBSERVACION !== undefined)
        ? sheet.getRange(rowNum, COL.DOC_FALLECIMIENTO_OBSERVACION + 1).getValue()
        : '';
      if (urlAnterior) {
        _respaldarDocFallecimientoReemplazado(rutLimpioInput, socio.encontrado ? socio.nombre : '', urlAnterior, 'ACTUALIZADO', observacionPrevia);
      }

      var fechaActual = Utilities.formatDate(new Date(), 'America/Santiago', 'dd/MM/yyyy HH:mm:ss');
      sheet.getRange(rowNum, COL.DOC_FALLECIMIENTO_URL + 1).setValue(resultado.url);
      sheet.getRange(rowNum, COL.DOC_FALLECIMIENTO_ESTADO + 1).setValue('EN REVISION');
      sheet.getRange(rowNum, COL.DOC_FALLECIMIENTO_FECHA + 1).setValue(fechaActual);
      // Limpia la observación del rechazo anterior: queda en blanco lista
      // para que el ADMIN escriba una nueva si vuelve a rechazar este ciclo.
      if (COL.DOC_FALLECIMIENTO_OBSERVACION !== undefined) {
        sheet.getRange(rowNum, COL.DOC_FALLECIMIENTO_OBSERVACION + 1).setValue('');
      }

      var cache = CacheService.getScriptCache();
      cache.remove('user_' + rutLimpioInput);
      cache.remove('loginRow_' + rutLimpioInput);

      _notificarEstadoDocFallecimiento(rutLimpioInput, socio.encontrado ? socio.nombre : '', socio.encontrado ? socio.correo : '', 'EN REVISION', '', resultado.url);

      return {
        success: true,
        message: "Documento recibido. Quedará en revisión del directorio sindical.",
        url: resultado.url,
        estado: 'EN REVISION',
        fecha: fechaActual
      };

    } catch (e) {
      Logger.log('❌ Error en guardarDocFallecimiento: ' + e.toString());
      return { success: false, message: "Ocurrió un error interno. Por favor, intente más tarde o contacte al administrador." };
    } finally {
      lock.releaseLock();
    }
  } else {
    return { success: false, message: "Servidor ocupado. Intenta nuevamente en unos segundos." };
  }
}

/**
 * Núcleo compartido de un cambio de estado del documento de Fallecimiento —
 * respalda (si aplica), escribe ESTADO/FECHA y notifica. Dos caminos lo
 * invocan:
 *   1. actualizarEstadoDocFallecimiento() — llamada manual desde el editor
 *      GAS o un futuro panel, con verificación de rol ADMIN/DIRECTORIO.
 *   2. _onEditDocFallecimiento() — trigger instalable onEdit: se dispara solo
 *      con que el ADMIN elija un valor del desplegable directamente en la
 *      celda de BD_SLIMAPP. Ahí la autorización es "tener permiso de edición
 *      del Sheet" en vez de un RUT ADMIN validado — el mismo criterio que ya
 *      se usa para la observación de la columna AG, que también se escribe a
 *      mano sin pasar por la app.
 * Escribir ESTADO aquí es idempotente (incluso si ya tenía ese valor, como
 * ocurre al venir del trigger onEdit) — no genera un bucle: ver
 * _onEditDocFallecimiento() para el guard que corta la reentrada.
 */
function _aplicarCambioEstadoDocFallecimiento(sheet, COL, rowNum, rutLimpio, estado) {
  var nombre = sheet.getRange(rowNum, COL.NOMBRE + 1).getValue();
  var correo = sheet.getRange(rowNum, COL.CORREO + 1).getValue();

  // Al rechazar, se respalda el documento vigente en Resp_Fallecimiento con
  // tipo RECHAZADO, incluyendo la observación que el ADMIN ya haya escrito
  // a mano en la columna AG (DOC_FALLECIMIENTO_OBSERVACION) — no bloqueante.
  var observacionAdmin = (COL.DOC_FALLECIMIENTO_OBSERVACION !== undefined)
    ? sheet.getRange(rowNum, COL.DOC_FALLECIMIENTO_OBSERVACION + 1).getValue()
    : '';
  var urlVigente = sheet.getRange(rowNum, COL.DOC_FALLECIMIENTO_URL + 1).getValue();
  if (estado === 'RECHAZADO') {
    if (COL.DOC_FALLECIMIENTO_OBSERVACION === undefined) {
      Logger.log('⚠️ CONFIG sin DOC_FALLECIMIENTO_OBSERVACION — ejecuta _configurarDocFallecimiento(). Respaldo de rechazo sin observación.');
    }
    _respaldarDocFallecimientoReemplazado(rutLimpio, nombre, urlVigente, 'RECHAZADO', observacionAdmin);
  }

  var fechaActual = Utilities.formatDate(new Date(), 'America/Santiago', 'dd/MM/yyyy HH:mm:ss');
  sheet.getRange(rowNum, COL.DOC_FALLECIMIENTO_ESTADO + 1).setValue(estado);
  sheet.getRange(rowNum, COL.DOC_FALLECIMIENTO_FECHA + 1).setValue(fechaActual);

  var cache = CacheService.getScriptCache();
  cache.remove('user_' + rutLimpio);
  cache.remove('loginRow_' + rutLimpio);

  _notificarEstadoDocFallecimiento(rutLimpio, nombre, correo, estado, estado === 'RECHAZADO' ? observacionAdmin : '', urlVigente);

  return fechaActual;
}

/**
 * Actualiza el estado del documento de designación de beneficiarios
 * (Fallecimiento). Uso exclusivo de ADMIN/DIRECTORIO — quien filó el
 * documento (el socio) no puede autoaprobarse. Llamada manual (editor GAS o
 * un futuro panel) — la edición directa del desplegable en el Sheet la
 * dispara sola, ver _onEditDocFallecimiento().
 */
function actualizarEstadoDocFallecimiento(rutObjetivo, nuevoEstado, rutSolicitante) {
  _ensureConfig();
  try {
    var autorizacion = verificarRolUsuario(rutSolicitante, ['ADMIN', 'DIRECTORIO']);
    if (!autorizacion.autorizado) {
      return { success: false, message: "No tienes permisos para realizar esta acción." };
    }

    var estadosValidos = ['EN REVISION', 'APROBADO', 'RECHAZADO', 'SIN DOCUMENTO'];
    if (estadosValidos.indexOf(String(nuevoEstado).trim().toUpperCase()) === -1) {
      return { success: false, message: "Estado inválido." };
    }
    var estado = String(nuevoEstado).trim().toUpperCase();

    var sheet = getSheet('USUARIOS', 'USUARIOS');
    var COL = CONFIG.COLUMNAS.USUARIOS;
    if (COL.DOC_FALLECIMIENTO_ESTADO === undefined) {
      Logger.log('⚠️ CONFIG sin DOC_FALLECIMIENTO_ESTADO — ejecuta _configurarDocFallecimiento(). El dato NO se guardó.');
      return { success: false, message: "Ocurrió un error interno. Por favor, intente más tarde o contacte al administrador." };
    }

    var rutLimpioObjetivo = cleanRut(rutObjetivo);
    var rowNum = buscarFilaPorRut(sheet, rutLimpioObjetivo);
    if (rowNum === -1) return { success: false, message: "Usuario no encontrado en el sistema." };

    var fechaActual = _aplicarCambioEstadoDocFallecimiento(sheet, COL, rowNum, rutLimpioObjetivo, estado);

    return { success: true, message: "Estado actualizado.", estado: estado, fecha: fechaActual };

  } catch (e) {
    Logger.log('❌ Error en actualizarEstadoDocFallecimiento: ' + e.toString());
    return { success: false, message: "Ocurrió un error interno. Por favor, intente más tarde o contacte al administrador." };
  }
}

/**
 * Trigger INSTALABLE onEdit (no simple trigger — necesita autorización para
 * enviar correo) ligado al spreadsheet de USUARIOS. Se instala una sola vez
 * vía configurarTriggers(). Detecta cuando el ADMIN elige un valor del
 * desplegable de DOC_FALLECIMIENTO_ESTADO directamente en BD_SLIMAPP y
 * dispara respaldo + notificación sin que nadie tenga que ejecutar nada a
 * mano — mismo criterio de confianza que la observación de la columna AG
 * (editar el Sheet ya implica acceso de administración).
 *
 * Guard contra reentrada: si el valor nuevo es igual al anterior (incluye el
 * caso en que esta misma función ya escribió ese estado) se corta de
 * inmediato — así, aunque escribir DOC_FALLECIMIENTO_FECHA en la misma fila
 * disparara de nuevo este trigger, el filtro de columna ya lo descarta, y si
 * alguna vez se reescribiera el mismo ESTADO, el guard de "sin cambio real"
 * lo corta también. No hay bucle posible.
 */
function _onEditDocFallecimiento(e) {
  if (activadorFueraDeProduccion_(e, '_onEditDocFallecimiento')) return;
  _ensureConfig();
  try {
    if (!e || !e.range) return;

    var COL = CONFIG.COLUMNAS.USUARIOS;
    if (COL.DOC_FALLECIMIENTO_ESTADO === undefined) return; // sin configurar todavía

    var sheet = e.range.getSheet();
    if (sheet.getName() !== CONFIG.HOJAS.USUARIOS) return; // otra pestaña del mismo spreadsheet

    // Solo edición de una sola celda en la columna ESTADO (así es como se usa
    // el desplegable). Pegados masivos sobre varias filas/columnas se ignoran
    // deliberadamente — evita reprocesar en cadena una edición en bloque.
    if (e.range.getNumRows() !== 1 || e.range.getNumColumns() !== 1) return;
    if (e.range.getColumn() !== COL.DOC_FALLECIMIENTO_ESTADO + 1) return;

    var estadoNuevo = String(e.value || '').trim().toUpperCase();
    var estadoAnterior = String(e.oldValue || '').trim().toUpperCase();
    if (estadoNuevo === estadoAnterior) return; // sin cambio real — corta reentrada

    var estadosValidos = ['EN REVISION', 'APROBADO', 'RECHAZADO', 'SIN DOCUMENTO'];
    if (estadosValidos.indexOf(estadoNuevo) === -1) return; // celda vacía u otro valor fuera de lista

    var rowNum = e.range.getRow();
    var rutLimpio = cleanRut(sheet.getRange(rowNum, COL.RUT + 1).getValue());
    if (!rutLimpio) return;

    _aplicarCambioEstadoDocFallecimiento(sheet, COL, rowNum, rutLimpio, estadoNuevo);

  } catch (err) {
    Logger.log('❌ Error en _onEditDocFallecimiento: ' + err.toString());
  }
}

/**
 * Configura la columna DOC_FALLECIMIENTO_ESTADO (AE en USUARIOS_SLIMAPP) con
 * validación de datos (menú desplegable con las 4 opciones válidas) y formato
 * condicional por color, para que el directorio/ADMIN solo pueda seleccionar
 * un valor de la lista al revisar un documento — nunca escribir texto libre.
 *
 * Se aplica a toda la columna (no celda por celda en cada guardado): una vez
 * configurada, cualquier fila nueva o editada dentro del rango ya queda con
 * el desplegable y el color correspondientes.
 *
 * DEV y PROD comparten la misma hoja de cálculo (ver CLAUDE.md) — esta
 * función se ejecuta UNA SOLA VEZ en total, no una vez por entorno. Es
 * idempotente: reemplaza sus propias reglas de formato condicional si se
 * vuelve a ejecutar, sin duplicarlas ni afectar otras reglas de la hoja.
 */
function _configurarValidacionDocFallecimiento() {
  _ensureConfig();
  var sheet = getSheet('USUARIOS', 'USUARIOS');
  var COL = CONFIG.COLUMNAS.USUARIOS;
  if (COL.DOC_FALLECIMIENTO_ESTADO === undefined) {
    Logger.log('❌ CONFIG sin DOC_FALLECIMIENTO_ESTADO — ejecuta primero _configurarDocFallecimiento().');
    return;
  }

  // Desde la fila 2 hasta el final de la cuadrícula de la hoja, NO hasta un
  // tope fijo: BD_SLIMAPP ronda los 3.100 socios y un tope escrito a mano deja
  // sin desplegable a las filas de abajo. Ahí el estado se escribe como texto
  // libre, y un valor fuera de lista (acento, minúsculas) hace que
  // _onEditDocFallecimiento() lo descarte sin avisar: no respalda el rechazo
  // ni notifica al socio, y no hay error visible en ninguna parte.
  // getMaxRows() incluye también las filas vacías del final, así que un socio
  // dado de alta más adelante ya nace con el desplegable puesto.
  var FILA_INICIO = 2;
  var FILA_FIN = sheet.getMaxRows();
  if (FILA_FIN < FILA_INICIO) {
    Logger.log('❌ La hoja ' + CONFIG.HOJAS.USUARIOS + ' no tiene filas de datos.');
    return;
  }
  var col = COL.DOC_FALLECIMIENTO_ESTADO + 1;
  var rango = sheet.getRange(FILA_INICIO, col, FILA_FIN - FILA_INICIO + 1, 1);

  var opciones = ['SIN DOCUMENTO', 'EN REVISION', 'APROBADO', 'RECHAZADO'];
  var validacion = SpreadsheetApp.newDataValidation()
    .requireValueInList(opciones, true)
    .setAllowInvalid(false)
    .setHelpText('Selecciona el estado del documento de designación de beneficiarios.')
    .build();
  rango.setDataValidation(validacion);

  // Colores calcados de los badges del frontend (pintarEstadoFallecimiento en
  // Index.html) para que el color en el Sheet signifique lo mismo que ve el
  // socio en la app.
  var coloresPorEstado = [
    { valor: 'APROBADO',      fondo: '#d1fae5', texto: '#047857' }, // emerald
    { valor: 'EN REVISION',   fondo: '#fef3c7', texto: '#b45309' }, // amber
    { valor: 'RECHAZADO',     fondo: '#fee2e2', texto: '#b91c1c' }, // red
    { valor: 'SIN DOCUMENTO', fondo: '#e2e8f0', texto: '#475569' }  // slate
  ];

  var reglasExistentes = sheet.getConditionalFormatRules();
  var rangoA1 = rango.getA1Notation();
  // Descarta las reglas previas que caían sobre ESTA columna, cualquiera sea
  // el tramo de filas que cubrieran, y conserva el resto de la hoja. Comparar
  // la notación A1 exacta no basta: una ejecución anterior pudo dejarlas en
  // otro rango (AE2:AE1000, el tope fijo que había antes) y entonces no
  // coincidirían, quedando duplicadas debajo de las nuevas.
  var reglasSinEsteRango = reglasExistentes.filter(function(regla) {
    return !regla.getRanges().some(function(r) {
      return r.getColumn() === col && r.getNumColumns() === 1;
    });
  });

  var nuevasReglas = coloresPorEstado.map(function(c) {
    return SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo(c.valor)
      .setBackground(c.fondo)
      .setFontColor(c.texto)
      .setRanges([rango])
      .build();
  });

  sheet.setConditionalFormatRules(reglasSinEsteRango.concat(nuevasReglas));

  Logger.log('✅ Validación de datos y formato condicional configurados en ' + rangoA1 + ' (DOC_FALLECIMIENTO_ESTADO).');
}

/**
 * Recordatorio diario (trigger 10:00 AM) de documentos de designación de
 * beneficiarios (Fallecimiento) pendientes de revisión. Notifica SOLO a
 * ADMIN — a diferencia de otros módulos, este documento contiene datos
 * familiares y de herencia y su revisión queda acotada a ese rol (ver
 * guardarDocFallecimiento(), que ya restringe el acceso al archivo del
 * mismo modo). Si no hay pendientes, no envía correo — evita ruido diario.
 */
function reintentarNotificacionDocFallecimientoPendiente(e) {
  if (activadorFueraDeProduccion_(e, 'reintentarNotificacionDocFallecimientoPendiente')) return;
  _ensureConfig();
  try {
    var sheet = getSheet('USUARIOS', 'USUARIOS');
    var COL = CONFIG.COLUMNAS.USUARIOS;
    if (COL.DOC_FALLECIMIENTO_ESTADO === undefined) {
      Logger.log('⚠️ CONFIG sin DOC_FALLECIMIENTO_ESTADO — ejecuta _configurarDocFallecimiento(). Recordatorio omitido.');
      return;
    }

    var ultimaColumna = Math.max(COL.DOC_FALLECIMIENTO_URL, COL.DOC_FALLECIMIENTO_ESTADO, COL.DOC_FALLECIMIENTO_FECHA) + 1;
    var data = sheet.getRange(1, 1, sheet.getLastRow(), ultimaColumna).getDisplayValues();
    var pendientes = [];

    for (var i = 1; i < data.length; i++) {
      var fila = data[i];
      var estado = String(fila[COL.DOC_FALLECIMIENTO_ESTADO] || '').trim().toUpperCase();
      if (estado === 'EN REVISION') {
        pendientes.push({
          rut:    fila[COL.RUT]    || '',
          nombre: fila[COL.NOMBRE] || '',
          fecha:  fila[COL.DOC_FALLECIMIENTO_FECHA] || '',
          url:    fila[COL.DOC_FALLECIMIENTO_URL]   || ''
        });
      }
    }

    if (pendientes.length === 0) return;

    var correosAdmin = obtenerCorreosAdmin();
    if (correosAdmin.length === 0) {
      Logger.log('⚠️ reintentarNotificacionDocFallecimientoPendiente: sin correos ADMIN activos — recordatorio no enviado.');
      return;
    }

    var filasHtml = pendientes.map(function(p) {
      return '<li style="margin-bottom:8px;"><strong>' + p.nombre + '</strong> (' + formatRutDisplay(p.rut) + ') — subido el ' + (p.fecha || 'S/D') +
        (p.url ? ' — <a href="' + p.url + '">Ver documento</a>' : '') + '</li>';
    }).join('');

    var mensaje = 'Hay <strong>' + pendientes.length + '</strong> documento(s) de designación de beneficiarios (Beneficio por Fallecimiento) pendiente(s) de revisión:' +
      '<ul style="margin-top:15px;padding-left:20px;">' + filasHtml + '</ul>';

    enviarCorreoEstilizadoConCopia(
      correosAdmin,
      [],
      'Documentos de Fallecimiento pendientes de revisión',
      'Recordatorio: Revisión Pendiente',
      mensaje,
      null,
      '#e11d48'
    );

  } catch (e) {
    Logger.log('❌ Error en reintentarNotificacionDocFallecimientoPendiente: ' + e.toString());
  }
}

// ==========================================
// OBTENER CORREO POR RUT (auxiliar compartida)
// ==========================================

function obtenerCorreoDeRut(rut) {
  try {
    var sheet = getSheet('USUARIOS', 'USUARIOS');
    var rutLimpio = cleanRut(rut);
    var COL = CONFIG.COLUMNAS.USUARIOS;
    var rowNum = buscarFilaPorRut(sheet, rutLimpio);
    if (rowNum === -1) return "";
    return sheet.getRange(rowNum, COL.CORREO + 1).getDisplayValue();
  } catch (e) {
    console.error("Error obteniendo correo: " + e);
    return "";
  }
}

// ==========================================
// MÓDULO: CREDENCIAL SINDICAL
// ==========================================

/**
 * Obtiene el estado de credencial de un usuario desde BD_CREDENCIALES
 */
function obtenerEstadoCredencialPorRut(rutInput) {
  try {
    var rutLimpio = cleanRut(String(rutInput));
    var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEETS.CREDENCIALES);
    var sheet = ss.getSheetByName(CONFIG.HOJAS.CREDENCIALES);
    if (!sheet) { Logger.log('⚠️ Hoja CREDENCIALES no encontrada'); return "S/D"; }
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return "S/D";
    var data = sheet.getRange(2, 1, lastRow - 1, 7).getDisplayValues();
    for (var i = 0; i < data.length; i++) {
      if (cleanRut(String(data[i][0])) === rutLimpio) {
        return String(data[i][6] || "").trim().toUpperCase() || "S/D";
      }
    }
    return "S/D";
  } catch (e) {
    Logger.log('❌ Error obteniendo estado credencial: ' + e.toString());
    return "S/D";
  }
}

/**
 * Trigger diario a las 8 AM: detecta cambios de estado en credenciales y envía notificaciones
 */
function verificarCambiosCredenciales(e) {
  if (activadorFueraDeProduccion_(e, 'verificarCambiosCredenciales')) return;
  // Mismo motivo que en reintentarNotificacionSocio(): esta función accede a
  // CONFIG directamente (openById) sin pasar por getSheet()/getSpreadsheet(), que
  // son los que normalmente disparan _ensureConfig(). Aquí el TypeError caía
  // dentro del try, así que el catch lo tragaba y el trigger parecía exitoso.
  _ensureConfig();
  var ESTADOS_CON_NOTIFICACION = ["ENTREGADO","DISPONIBLE","SOLICITADO","NO VIGENTE","DATOS INCORRECTOS","REIMPRIMIR"];
  try {
    Logger.log('🔄 Iniciando verificación de cambios en credenciales...');
    var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEETS.CREDENCIALES);
    var sheetImpresion = ss.getSheetByName(CONFIG.HOJAS.CREDENCIALES);
    if (!sheetImpresion) { Logger.log('❌ No se encontró la hoja IMPRESION en BD_CREDENCIALES'); return; }

    var sheetHistorial = ss.getSheetByName(CONFIG.HOJAS.HISTORIAL_CREDENCIALES);
    if (!sheetHistorial) {
      sheetHistorial = ss.insertSheet(CONFIG.HOJAS.HISTORIAL_CREDENCIALES);
      sheetHistorial.appendRow(['FECHA','RUT','NOMBRE','CORREO','ESTADO ANTERIOR','ESTADO NUEVO','EMAIL ENVIADO']);
      sheetHistorial.getRange(1,1,1,7).setFontWeight('bold').setBackground('#1e293b').setFontColor('#ffffff');
    }

    var lastRow = sheetImpresion.getLastRow();
    if (lastRow < 2) { Logger.log('ℹ️ No hay datos en la hoja IMPRESION'); return; }

    var data = sheetImpresion.getRange(2, 1, lastRow - 1, 11).getDisplayValues();
    var enviados = 0, errores = 0, inicializados = 0, sinCambios = 0;

    for (var i = 0; i < data.length; i++) {
      var fila = i + 2;
      var rut = String(data[i][0] || "").trim();
      var nombre = String(data[i][3] || data[i][4] || "Socio").trim();
      var correo = String(data[i][5] || "").trim();
      var estadoActual = String(data[i][6] || "").trim().toUpperCase();
      var estadoAnterior = String(data[i][9] || "").trim().toUpperCase();

      if (!rut || !estadoActual) continue;

      if (!estadoAnterior) {
        sheetImpresion.getRange(fila, 10).setValue(estadoActual);
        inicializados++;
        Logger.log('ℹ️ Fila ' + fila + ' (' + rut + '): Inicializado con estado "' + estadoActual + '"');
        continue;
      }

      if (estadoActual === estadoAnterior) { sinCambios++; continue; }

      Logger.log('🔔 Fila ' + fila + ' (' + rut + '): Cambio detectado "' + estadoAnterior + '" → "' + estadoActual + '"');
      var emailEstado = "SIN CORREO";

      if (ESTADOS_CON_NOTIFICACION.indexOf(estadoActual) !== -1 && correo.includes('@')) {
        try {
          enviarNotificacionCredencial(correo, nombre, estadoActual, rut);
          emailEstado = "ENVIADO";
          enviados++;
        } catch (emailErr) {
          emailEstado = "ERROR: " + emailErr.toString().substring(0, 80);
          errores++;
          Logger.log('❌ Error enviando email a ' + correo + ': ' + emailErr.toString());
        }
      } else if (!correo.includes('@')) {
        emailEstado = "SIN CORREO VÁLIDO";
      } else {
        emailEstado = "ESTADO SIN NOTIF.";
      }

      var fechaAhora = Utilities.formatDate(new Date(), 'America/Santiago', 'dd/MM/yyyy HH:mm:ss');
      sheetHistorial.appendRow([fechaAhora, rut, nombre, correo, estadoAnterior, estadoActual, emailEstado]);
      sheetImpresion.getRange(fila, 10).setValue(estadoActual);
      sheetImpresion.getRange(fila, 11).setValue(emailEstado);
    }

    Logger.log('✅ Verificación completada: Inicializados=' + inicializados + ' | Sin cambios=' + sinCambios + ' | Emails enviados=' + enviados + ' | Errores=' + errores);
  } catch (e) {
    Logger.log('❌ Error crítico en verificarCambiosCredenciales: ' + e.toString());
  }
}

/**
 * Envía notificación HTML sobre el estado de credencial
 */
function enviarNotificacionCredencial(correo, nombre, estadoNuevo, rut) {
  var MENSAJES = {
    "ENTREGADO":         { titulo:"¡Tu credencial sindical ha sido entregada!",      icono:"🎉", color:"#059669", colorClaro:"#d1fae5", colorBorde:"#6ee7b7", mensaje:"Tu tarjeta ha sido entregada y se encuentra disponible para su uso. Te recordamos que la credencial sindical se utiliza para las asambleas presenciales, la cual debes mostrar para la correcta marcación de tu asistencia.", nota:"Si la credencial está desgastada o la extraviaste, debes solicitar una nueva a un dirigente de la organización." },
    "DISPONIBLE":        { titulo:"¡Tu credencial sindical está lista para retiro!", icono:"📦", color:"#0d9488", colorClaro:"#ccfbf1", colorBorde:"#5eead4", mensaje:"Tu credencial sindical ya está impresa y disponible para su retiro. Debes acercarte a la oficina sindical o retirarla en la próxima asamblea presencial.", nota:"Recuerda llevar tu RUT al momento de retirarla." },
    "SOLICITADO":        { titulo:"Solicitud de credencial recibida",                icono:"⏳", color:"#d97706", colorClaro:"#fef3c7", colorBorde:"#fcd34d", mensaje:"Tus datos han sido ingresados al sistema y se ha solicitado al departamento de comunicaciones la gestión para la impresión de tu credencial sindical.", nota:"Cuando esté disponible, recibirás un correo electrónico notificándote su disponibilidad de retiro." },
    "NO VIGENTE":        { titulo:"Credencial sindical deshabilitada",               icono:"⚠️", color:"#dc2626", colorClaro:"#fee2e2", colorBorde:"#fca5a5", mensaje:"De acuerdo a nuestros registros, tu credencial sindical ha sido deshabilitada, lo que indica que podrías ya no pertenecer a la empresa o a la organización sindical.", nota:"Si consideras que existe un error, comunícate con algún dirigente para regularizar tu situación." },
    "DATOS INCORRECTOS": { titulo:"Atención: datos incorrectos para tu credencial", icono:"❗", color:"#ea580c", colorClaro:"#ffedd5", colorBorde:"#fdba74", mensaje:"No se ha podido crear tu credencial sindical debido a que existen datos incorrectos para su fabricación.", nota:"Debes actualizar tus datos en el módulo \"Mis Datos\" de la aplicación sindical, o comunicarte con un dirigente." },
    "REIMPRIMIR":        { titulo:"Solicitud de reimpresión recibida",               icono:"🖨️", color:"#7c3aed", colorClaro:"#ede9fe", colorBorde:"#c4b5fd", mensaje:"Hemos recibido una solicitud de reimpresión de tu credencial sindical. Nuestro equipo está procesando esta solicitud.", nota:"Una vez que esté disponible, se te notificará a través del correo electrónico registrado." }
  };

  var info = MENSAJES[estadoNuevo] || { titulo:"Actualización de credencial sindical", icono:"📋", color:"#64748b", colorClaro:"#f1f5f9", colorBorde:"#cbd5e1", mensaje:"El estado de tu credencial sindical ha sido actualizado.", nota:"Puedes revisar el estado actual en el módulo 'Mis Datos' de la aplicación sindical." };
  var fechaActual = Utilities.formatDate(new Date(), 'America/Santiago', "dd 'de' MMMM 'de' yyyy");

  var htmlBody = '<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>' +
    '<body style="margin:0;padding:0;background-color:#0f172a;font-family:\'Helvetica Neue\',Arial,sans-serif;">' +
    '<div style="max-width:600px;margin:0 auto;padding:20px;">' +
    '<div style="background:linear-gradient(135deg,' + info.color + ',' + info.color + 'dd);border-radius:16px 16px 0 0;padding:32px 24px;text-align:center;">' +
    '<div style="font-size:48px;margin-bottom:12px;">' + info.icono + '</div>' +
    '<h1 style="color:#ffffff;font-size:20px;font-weight:700;margin:0 0 8px 0;line-height:1.3;">' + info.titulo + '</h1>' +
    '<p style="color:rgba(255,255,255,0.85);font-size:13px;margin:0;">Sindicato SLIM N°3 · Credencial Sindical</p></div>' +
    '<div style="background:#ffffff;padding:28px 24px;">' +
    '<p style="color:#374151;font-size:15px;margin:0 0 20px 0;">Estimado(a) <strong>' + nombre + '</strong>,</p>' +
    '<div style="background:' + info.colorClaro + ';border:1px solid ' + info.colorBorde + ';border-radius:12px;padding:16px;text-align:center;margin-bottom:20px;">' +
    '<p style="color:#6b7280;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin:0 0 8px 0;">NUEVO ESTADO DE CREDENCIAL</p>' +
    '<span style="display:inline-block;background:' + info.color + ';color:#ffffff;font-size:14px;font-weight:800;text-transform:uppercase;letter-spacing:1px;padding:8px 20px;border-radius:50px;">' + estadoNuevo + '</span></div>' +
    '<div style="background:#f8fafc;border-left:4px solid ' + info.color + ';border-radius:0 8px 8px 0;padding:16px;margin-bottom:16px;">' +
    '<p style="color:#374151;font-size:14px;line-height:1.6;margin:0;">' + info.mensaje + '</p></div>' +
    '<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:14px;margin-bottom:20px;">' +
    '<p style="color:#92400e;font-size:12px;line-height:1.6;margin:0;"><strong>📌 Nota:</strong> ' + info.nota + '</p></div>' +
    '<table style="width:100%;border-collapse:collapse;margin-bottom:20px;font-size:13px;">' +
    '<tr style="background:#f1f5f9;"><td style="padding:10px 12px;font-weight:700;color:#475569;border-bottom:1px solid #e2e8f0;width:40%;">Nombre</td><td style="padding:10px 12px;color:#1e293b;border-bottom:1px solid #e2e8f0;">' + nombre + '</td></tr>' +
    '<tr><td style="padding:10px 12px;font-weight:700;color:#475569;border-bottom:1px solid #e2e8f0;">Fecha</td><td style="padding:10px 12px;color:#1e293b;border-bottom:1px solid #e2e8f0;">' + fechaActual + '</td></tr>' +
    '</table></div>' +
    '<div style="background:#1e293b;border-radius:0 0 16px 16px;padding:20px 24px;text-align:center;">' +
    '<p style="color:#94a3b8;font-size:12px;margin:0 0 4px 0;">Este es un mensaje automático del sistema de gestión</p>' +
    '<p style="color:#64748b;font-size:11px;margin:0;">Sindicato SLIM N°3 · No responder a este correo</p></div>' +
    '</div></body></html>';

  MailApp.sendEmail({
    to: correo,
    subject: info.icono + ' Credencial Sindical: ' + estadoNuevo + ' - Sindicato SLIM N°3',
    htmlBody: htmlBody,
    name: "Sindicato SLIM N°3"
  });
}

// ==========================================
// CONSULTA ID CREDENCIAL (para DIRIGENTE/ADMIN)
// ==========================================

/**
 * Consulta el ID Credencial de un usuario por RUT
 * Solo accesible para roles DIRIGENTE y ADMIN
 */
function consultarIdCredencialBackend(rutConsultante, rutBuscado) {
  try {
    var validacion = verificarRolUsuario(rutConsultante, ['DIRIGENTE', 'DIRECTORIO', 'ADMIN']);
    if (!validacion.autorizado) {
      return { success: false, message: 'No tienes permisos para realizar esta consulta.' };
    }

    var rutLimpio = cleanRut(rutBuscado);
    if (!rutLimpio || rutLimpio.length < 7) {
      return { success: false, message: 'RUT inválido o incompleto.' };
    }

    var sheet = getSheet('USUARIOS', 'USUARIOS');
    if (!sheet) return { success: false, message: 'Error al acceder a la base de datos.' };

    var COL = CONFIG.COLUMNAS.USUARIOS;
    var rowNum = buscarFilaPorRut(sheet, rutLimpio);
    if (rowNum === -1) {
      return { success: false, message: 'No se encontró ningún usuario con el RUT ' + formatRutDisplay(rutBuscado) + ' en el sistema.' };
    }

    var row = sheet.getRange(rowNum, 1, 1, COL.ESTADO_NEG_COLECT + 1).getDisplayValues()[0];
    var rolUsuarioBuscado = String(row[COL.ROL] || 'SOCIO').trim().toUpperCase();

    if ((validacion.rol === 'DIRIGENTE' || validacion.rol === 'DIRECTORIO') && rolUsuarioBuscado !== 'SOCIO') {
      return { success: false, message: 'Acceso restringido: Solo puedes consultar información de usuarios con rol SOCIO.', restricted: true };
    }

    return {
      success: true,
      rut:             row[COL.RUT],
      nombre:          row[COL.NOMBRE],
      cargo:           row[COL.CARGO],
      estado:          row[COL.ESTADO],
      rol:             rolUsuarioBuscado,
      idCredencial:    row[COL.ID_CREDENCIAL] || 'S/D',
      estadoCredencial:obtenerEstadoCredencialPorRut(row[COL.RUT])
    };

  } catch (e) {
    Logger.log('❌ ERROR en consultarIdCredencialBackend: ' + e.toString());
    return { success: false, message: "Ocurrió un error interno. Por favor, intente más tarde o contacte al administrador." };
  }
}

// ==========================================
// MIGRACIÓN: COMPLETAR CAMPOS BANCARIOS EN BLANCO
// (Ejecutar manualmente una sola vez)
// ==========================================

function completarCamposBancariosEnBlanco() {
  try {
    var sheet = getSheet('USUARIOS', 'USUARIOS');
    if (!sheet) { Logger.log('❌ No se pudo acceder a la hoja de usuarios.'); return; }

    var COL = CONFIG.COLUMNAS.USUARIOS;
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) { Logger.log('⚠️ No hay registros en la hoja.'); return; }

    var data = sheet.getRange(2, 1, lastRow - 1, COL.NUMERO_CUENTA + 1).getValues();
    var contCompletados = 0, contOK = 0, contAvisos = 0, contOtrosBancos = 0, contSinRut = 0;

    for (var i = 0; i < data.length; i++) {
      var fila = i + 2;
      var rutRaw     = String(data[i][COL.RUT]          || '').trim();
      var banco      = String(data[i][COL.BANCO]         || '').trim();
      var tipoCuenta = String(data[i][COL.TIPO_CUENTA]   || '').trim();
      var numCuenta  = String(data[i][COL.NUMERO_CUENTA] || '').trim();
      var nombre     = String(data[i][COL.NOMBRE]        || '').trim();
      var bancoUp    = banco.toUpperCase();

      var rutLimpio = cleanRut(rutRaw);
      if (!rutLimpio || rutLimpio.length < 7) { contSinRut++; continue; }
      var rutBody = rutLimpio.slice(0, -1);

      if (!banco) {
        sheet.getRange(fila, COL.BANCO + 1).setValue('BANCO ESTADO (Cuenta RUT)');
        sheet.getRange(fila, COL.TIPO_CUENTA + 1).setValue('CUENTA VISTA');
        sheet.getRange(fila, COL.NUMERO_CUENTA + 1).setValue(rutBody);
        try { CacheService.getScriptCache().remove('user_' + rutLimpio); } catch(e) {}
        Logger.log('✅ Fila ' + fila + ' | ' + nombre + ' | Completado → Cuenta RUT: ' + rutBody);
        contCompletados++;
        if (contCompletados % 30 === 0) Utilities.sleep(500);

      } else if (bancoUp === 'BANCO ESTADO (CUENTA RUT)') {
        var tipoCuentaUp = tipoCuenta.toUpperCase();
        if (tipoCuentaUp !== '' && tipoCuentaUp !== 'CUENTA VISTA') { contOtrosBancos++; continue; }
        var tipoOK = (tipoCuentaUp === 'CUENTA VISTA'), numeroOK = (numCuenta === rutBody);
        if (tipoOK && numeroOK) {
          contOK++;
        } else {
          var problemas = [];
          if (!tipoOK) { sheet.getRange(fila, COL.TIPO_CUENTA + 1).setValue('CUENTA VISTA'); problemas.push('TIPO_CUENTA corregido'); }
          if (!numeroOK) { sheet.getRange(fila, COL.NUMERO_CUENTA + 1).setValue(rutBody); problemas.push('NUMERO_CUENTA corregido'); }
          try { CacheService.getScriptCache().remove('user_' + rutLimpio); } catch(e) {}
          Logger.log('🔧 Fila ' + fila + ' | ' + nombre + ' | ' + problemas.join(' | '));
          contAvisos++;
          if (contAvisos % 30 === 0) Utilities.sleep(500);
        }
      } else {
        contOtrosBancos++;
      }
    }

    Logger.log('============= RESUMEN =============');
    Logger.log('✅ Completados: ' + contCompletados + ' | Verificados OK: ' + contOK + ' | Inconsistencias: ' + contAvisos + ' | Otro banco: ' + contOtrosBancos + ' | Sin RUT: ' + contSinRut);
  } catch (e) {
    Logger.log('❌ Error en completarCamposBancariosEnBlanco: ' + e.toString());
  }
}

