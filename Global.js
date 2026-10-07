// ==========================================
// GLOBAL.GS — Configuración central, enrutamiento y utilidades
// ==========================================

/**
 * Servir HTML — Enrutador principal del Web App
 * Además, expone un endpoint JSON de configuración para la app móvil (Capacitor/APK)
 * cuando se llama con ?config=app — evita tener que hardcodear la URL /exec en el APK.
 */
function doGet(e) {
  // Endpoint de configuración para la app móvil — responde ANTES de servir el HTML
  if (e && e.parameter && e.parameter.config === 'app') {
    var props = PropertiesService.getScriptProperties();
    return ContentService.createTextOutput(JSON.stringify({
      exec_url:          ScriptApp.getService().getUrl(),
      version_minima:    props.getProperty('APP_MOVIL_VERSION_MINIMA') || '1.0.0',
      url_descarga_apk:  props.getProperty('APP_MOVIL_URL_DESCARGA') || ''
    })).setMimeType(ContentService.MimeType.JSON);
  }

  return HtmlService.createHtmlOutputFromFile('Index')
      .setTitle('Sindicato SLIM n°3 - App Socios')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no');
}

/**
 * Configuración de la app móvil — ejecutar una sola vez desde el editor GAS,
 * y volver a ejecutar cada vez que se publique una nueva versión del APK
 * para actualizar la versión mínima requerida y el link de descarga.
 */
function configurarAppMovil() {
  var props = PropertiesService.getScriptProperties();
  props.setProperty('APP_MOVIL_VERSION_MINIMA', '1.0.0');
  props.setProperty('APP_MOVIL_URL_DESCARGA', 'https://sindicatoslim3.com/descargas/slimapp.apk');
  Logger.log('✅ Configuración de app móvil guardada: ' + JSON.stringify(props.getProperties()));
}

// ==========================================
// CONFIGURACIÓN GLOBAL
// Toda la configuración se carga desde PropertiesService via _ensureConfig().
// Ningún ID, nombre de hoja, índice de columna ni correo se almacena en el código.
// Para inicializar: ejecutar inicializarConfiguracion() desde el editor GAS.
// ==========================================
var CONFIG = null;
var WEBAPP_BASE_URL = null;

// Límite máximo de tamaño de archivo para subidas (comprobantes, documentos, etc.)
// Único lugar donde se define este valor en el backend — no hardcodear "15" en otras funciones.
var LIMITE_ARCHIVO_MB = 15;

// Límite TOTAL combinado de adjuntos para correos a la empresa (módulo Trámites).
// Gmail permite máx. 25MB por correo; se usa 20MB como margen de seguridad.
var LIMITE_TOTAL_ADJUNTOS_MB = 20;

// ==========================================
// HELPERS DE ACCESO A SPREADSHEETS Y HOJAS
// ==========================================

/**
 * Parsea una propiedad JSON de PropertiesService de forma segura.
 * Función a nivel de módulo para evitar problemas de scoping en GAS V8.
 */
function _parseProp(props, key) {
  try {
    var val = JSON.parse(props[key] || 'null');
    return (val && typeof val === 'object') ? val : {};
  } catch (e) {
    Logger.log('_parseProp: error al parsear "' + key + '": ' + e);
    return {};
  }
}

/**
 * Carga toda la configuración desde PropertiesService en una sola llamada.
 * Se ejecuta una vez por ejecución de script (lazy-init).
 * Para configurar por primera vez: ejecutar inicializarConfiguracion() en el editor GAS.
 */
function _ensureConfig() {
  if (CONFIG) return;
  try {
    var props = PropertiesService.getScriptProperties().getProperties();

    CONFIG = {
      SPREADSHEETS: {
        USUARIOS:            props['SS_USUARIOS']            || '',
        JUSTIFICACIONES:     props['SS_JUSTIFICACIONES']     || '',
        APELACIONES:         props['SS_APELACIONES']         || '',
        PRESTAMOS:           props['SS_PRESTAMOS']           || '',
        PERMISOS_MEDICOS:    props['SS_PERMISOS_MEDICOS']    || '',
        CREDENCIALES:        props['SS_CREDENCIALES']        || '',
        ASISTENCIA:          props['SS_ASISTENCIA']          || '',
        ASISTENCIA_BRIGADA:  props['SS_ASISTENCIA_BRIGADA']  || '',
        ASISTENCIA_VIRTUAL:  props['SS_ASISTENCIA_VIRTUAL']  || '',
        GAMIFICACION:        props['SS_GAMIFICACION']        || '',
        DENUNCIAS_JEFATURAS: props['SS_DENUNCIAS_JEFATURAS'] || '',
        NOTICIAS:            props['SS_NOTICIAS']            || '',
        FORO:                props['SS_FORO']                || '',
        REPORTES_BUGS:       props['SS_REPORTES_BUGS']       || ''
      },
      HOJAS:    _parseProp(props, 'CONFIG_HOJAS'),
      COLUMNAS: _parseProp(props, 'CONFIG_COLUMNAS'),
      CARPETAS: _parseProp(props, 'CONFIG_CARPETAS'),
      CORREOS:  _parseProp(props, 'CONFIG_CORREOS')
    };

    WEBAPP_BASE_URL = props['WEBAPP_URL'] || '';
    Logger.log('_ensureConfig: OK — CARPETAS keys: ' + Object.keys(CONFIG.CARPETAS).join(', '));
  } catch (e) {
    Logger.log('_ensureConfig: ERROR CRÍTICO al cargar configuración: ' + e);
    throw new Error('No se pudo cargar la configuración del sistema. Verifica PropertiesService. Detalle: ' + e);
  }
}

/**
 * Retorna el objeto Spreadsheet para una clave del CONFIG.
 * @param {string} spreadsheetKey
 * @returns {Spreadsheet}
 */
function getSpreadsheet(spreadsheetKey) {
  _ensureConfig();
  var spreadsheetId = CONFIG.SPREADSHEETS[spreadsheetKey];
  if (!spreadsheetId) {
    throw new Error('Spreadsheet "' + spreadsheetKey + '" no configurado. Ejecuta inicializarConfiguracion() desde el editor GAS.');
  }
  return SpreadsheetApp.openById(spreadsheetId);
}

/**
 * Retorna una hoja específica con manejo de errores.
 * @param {string} spreadsheetKey
 * @param {string} sheetKey
 * @param {boolean} [createIfNotExists=false]
 * @returns {Sheet|null}
 */
function getSheet(spreadsheetKey, sheetKey, createIfNotExists) {
  _ensureConfig();
  createIfNotExists = createIfNotExists || false;
  try {
    var ss = getSpreadsheet(spreadsheetKey);
    var sheetName = CONFIG.HOJAS[sheetKey];

    if (!sheetName) {
      console.error('❌ Clave de hoja "' + sheetKey + '" no encontrada en CONFIG.HOJAS');
      return null;
    }

    var sheet = ss.getSheetByName(sheetName);

    if (!sheet && createIfNotExists) {
      console.warn('⚠️ Hoja "' + sheetName + '" no existe. Creándola...');
      sheet = ss.insertSheet(sheetName);
      console.log('✅ Hoja "' + sheetName + '" creada exitosamente');
    }

    if (!sheet) {
      console.error('❌ Hoja "' + sheetName + '" no encontrada en spreadsheet ' + spreadsheetKey);
      return null;
    }

    return sheet;

  } catch (e) {
    console.error('❌ Error obteniendo hoja ' + sheetKey + ' de ' + spreadsheetKey + ': ' + e.toString());
    return null;
  }
}

// ==========================================
// BÚSQUEDA INDEXADA POR RUT (TextFinder)
// ==========================================

/**
 * Busca la fila de un RUT limpio en la columna RUT de la hoja USUARIOS.
 * Usa TextFinder con matchEntireCell para evitar O(n) scans.
 * @param {Sheet} sheet - Hoja de USUARIOS
 * @param {string} rutLimpio - RUT sin puntos ni guión (resultado de cleanRut)
 * @returns {number} Número de fila 1-based, o -1 si no se encuentra
 */
function buscarFilaPorRut(sheet, rutLimpio) {
  _ensureConfig();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;
  var rutCol = CONFIG.COLUMNAS.USUARIOS.RUT;
  var match = sheet.getRange(2, rutCol + 1, lastRow - 1, 1)
    .createTextFinder(rutLimpio)
    .matchEntireCell(true)
    .findNext();
  return match ? match.getRow() : -1;
}

// ==========================================
// RESPALDO DE REGISTROS ELIMINADOS
// ==========================================

/**
 * Nombre de la hoja de respaldo histórico, igual en los tres spreadsheets que
 * la usan (préstamos, justificaciones, apelaciones). Es contenido append-only:
 * `restaurarBaseDeDatos` la preserva en vez de sobrescribirla.
 */
var HOJA_REGISTROS_ELIMINADOS = 'Registros-eliminados';

/**
 * Mensaje único de rechazo cuando alguien intenta eliminar un registro que no
 * le corresponde. Deliberadamente genérico: no distingue "no existe" de "no es
 * tuyo" ni revela el estado del registro, para no confirmarle nada a quien
 * prueba IDs ajenos.
 */
var MENSAJE_ELIMINACION_NO_AUTORIZADA = 'No tienes permiso para eliminar este registro.';

/**
 * Autoriza la eliminación de un registro: puede eliminarlo su titular o un rol
 * gestor (DIRIGENTE/DIRECTORIO/ADMIN), el mismo criterio que usa el resto del
 * sistema para actuar a nombre de un socio.
 *
 * El webapp es ANYONE_ANONYMOUS y estas funciones son invocables con solo el ID
 * del registro, así que sin esta validación cualquiera podía borrar el trámite
 * de otro. La identidad sigue viniendo del RUT que envía el frontend — es el
 * modelo del sistema completo — pero al menos ya no basta conocer un ID.
 *
 * @param {string} rutSolicitante - RUT de quien ejecuta la eliminación
 * @param {string} rutTitular - RUT dueño del registro (columna RUT de la fila)
 * @returns {{autorizado: boolean, esTitular: boolean, rol: string, motivo: string}}
 */
function _autorizarEliminacionRegistro(rutSolicitante, rutTitular) {
  if (!rutSolicitante) {
    return { autorizado: false, esTitular: false, rol: '', motivo: 'sin RUT de sesión' };
  }

  var rutLimpio = cleanRut(rutSolicitante);
  if (rutLimpio && rutLimpio === cleanRut(rutTitular)) {
    return { autorizado: true, esTitular: true, rol: 'TITULAR', motivo: '' };
  }

  var verificacion = verificarRolUsuario(rutSolicitante, ['DIRIGENTE', 'DIRECTORIO', 'ADMIN']);
  if (verificacion.autorizado) {
    return { autorizado: true, esTitular: false, rol: verificacion.rol, motivo: '' };
  }

  return {
    autorizado: false,
    esTitular:  false,
    rol:        verificacion.rol || '',
    motivo:     'no es el titular ni tiene rol gestor'
  };
}

/**
 * Columnas propias de las hojas "Registros-eliminados": las que responden
 * cuándo se eliminó el registro y quién lo hizo. La fila copiada del origen
 * por sí sola no puede responder ninguna de las dos.
 */
var COLUMNAS_TRAZABILIDAD_ELIMINACION = [
  'FECHA_ELIMINACION',
  'ELIMINADO_POR_RUT',
  'ELIMINADO_POR_NOMBRE',
  'ELIMINADO_POR_ROL'
];

/**
 * Resuelve quién ejecuta una eliminación, para la trazabilidad de las hojas
 * "Registros-eliminados". Nunca lanza: si el RUT no llega o no está en el
 * registro de socios, devuelve valores explícitos en vez de dejar celdas
 * vacías — "sin dato" y "no encontrado" son hallazgos distintos y ambos
 * importan al revisar el histórico.
 *
 * El rol se guarda tal como estaba AL MOMENTO de eliminar: los roles cambian
 * con el tiempo y consultarlo después no reconstruye el estado de entonces.
 *
 * @param {string} rutSolicitante
 * @returns {{rut: string, nombre: string, rol: string}}
 */
function _identificarAutorEliminacion(rutSolicitante) {
  if (!rutSolicitante) {
    return { rut: 'S/D', nombre: 'S/D', rol: 'S/D' };
  }
  try {
    var usuario = obtenerUsuarioPorRut(rutSolicitante);
    if (usuario.encontrado) {
      return {
        rut:    usuario.rut,
        nombre: usuario.nombre || 'S/D',
        rol:    usuario.rol    || 'SOCIO'
      };
    }
    return { rut: cleanRut(rutSolicitante), nombre: 'NO ENCONTRADO EN REGISTRO', rol: 'S/D' };
  } catch (e) {
    Logger.log('⚠️ _identificarAutorEliminacion: ' + e);
    return { rut: cleanRut(rutSolicitante), nombre: 'S/D', rol: 'S/D' };
  }
}

/**
 * Devuelve la posición de cada columna de trazabilidad en la hoja de respaldo,
 * agregando al final las que falten. Ubica por NOMBRE de encabezado, no por
 * índice fijo: así repara las hojas creadas antes de que existiera la
 * trazabilidad y queda inmune a que la hoja de origen cambie de ancho (las
 * filas ya escritas conservan su posición).
 *
 * @param {Sheet} sheetEliminados - Hoja de respaldo, ya con sus encabezados
 * @returns {Object} mapa nombre de columna → índice 0-based
 */
function _asegurarColumnasTrazabilidadEliminacion(sheetEliminados) {
  var lastCol = sheetEliminados.getLastColumn();
  var encabezados = lastCol > 0
    ? sheetEliminados.getRange(1, 1, 1, lastCol).getValues()[0].map(function(h) { return String(h).trim(); })
    : [];

  var indices = {};
  var faltantes = [];
  COLUMNAS_TRAZABILIDAD_ELIMINACION.forEach(function(nombre) {
    var i = encabezados.indexOf(nombre);
    if (i === -1) faltantes.push(nombre);
    else indices[nombre] = i;
  });

  if (faltantes.length > 0) {
    var inicio = encabezados.length;
    var totalCol = inicio + faltantes.length;
    if (sheetEliminados.getMaxColumns() < totalCol) {
      sheetEliminados.insertColumnsAfter(sheetEliminados.getMaxColumns(),
                                         totalCol - sheetEliminados.getMaxColumns());
    }
    var rango = sheetEliminados.getRange(1, inicio + 1, 1, faltantes.length);
    rango.setValues([faltantes]);
    rango.setFontWeight('bold');
    faltantes.forEach(function(nombre, k) { indices[nombre] = inicio + k; });
    console.log('✅ Columnas de trazabilidad agregadas a "' + sheetEliminados.getName() + '": ' + faltantes.join(', '));
  }

  return indices;
}

/**
 * Respalda una fila eliminada en la hoja "Registros-eliminados" del mismo
 * spreadsheet, replicando el patrón usado en Modulo prestamos.js.
 * Si la hoja no existe la crea y copia los encabezados de la hoja de origen,
 * de modo que el respaldo conserva la misma estructura de columnas. Además
 * agrega (o repara) las columnas de trazabilidad y registra cuándo se eliminó
 * el registro y quién lo hizo.
 *
 * Nota: Modulo prestamos.js NO pasa por aquí — tiene su propia ruta de respaldo,
 * anterior a este helper, y ubica esas mismas cuatro columnas por índice fijo
 * (CONFIG.COLUMNAS.PRESTAMOS_ELIMINADOS). Si algún día se unifica, esta es la
 * implementación a conservar: ubicar por nombre no necesita configuración.
 *
 * @param {Spreadsheet} ss - Spreadsheet que contiene la hoja de origen
 * @param {Sheet} sheetOrigen - Hoja desde la que se elimina el registro
 * @param {Array} valoresFila - Valores de la fila a respaldar (getValues del origen)
 * @param {string} [rutSolicitante] - RUT de quien ejecuta la eliminación
 * @returns {boolean} true si el respaldo quedó escrito
 */
function respaldarRegistroEliminado(ss, sheetOrigen, valoresFila, rutSolicitante) {
  try {
    if (!ss || !sheetOrigen || !valoresFila) return false;

    var NOMBRE_HOJA = HOJA_REGISTROS_ELIMINADOS;
    var sheetEliminados = ss.getSheetByName(NOMBRE_HOJA);

    if (!sheetEliminados) {
      sheetEliminados = ss.insertSheet(NOMBRE_HOJA);
      console.log('✅ Hoja "' + NOMBRE_HOJA + '" creada en ' + ss.getName());
    }

    // Copia los encabezados del origen si la hoja no los tiene. Cubre tanto la
    // hoja recién creada como una que alguien haya dejado vacía a mano: sin
    // encabezados, las columnas de trazabilidad se ubicarían en A-D y pisarían
    // los datos de la fila respaldada.
    var lastCol = sheetOrigen.getLastColumn();
    if (sheetEliminados.getLastColumn() === 0 && lastCol > 0) {
      var encabezados = sheetOrigen.getRange(1, 1, 1, lastCol).getValues();
      if (sheetEliminados.getMaxColumns() < lastCol) {
        sheetEliminados.insertColumnsAfter(sheetEliminados.getMaxColumns(),
                                           lastCol - sheetEliminados.getMaxColumns());
      }
      sheetEliminados.getRange(1, 1, 1, lastCol).setValues(encabezados);
      sheetEliminados.getRange(1, 1, 1, lastCol).setFontWeight('bold');
      sheetEliminados.setFrozenRows(1);
    }

    var fila = valoresFila.slice();
    var COL = _asegurarColumnasTrazabilidadEliminacion(sheetEliminados);
    var autor = _identificarAutorEliminacion(rutSolicitante);
    fila[COL.FECHA_ELIMINACION]    = new Date();
    fila[COL.ELIMINADO_POR_RUT]    = autor.rut;
    fila[COL.ELIMINADO_POR_NOMBRE] = autor.nombre;
    fila[COL.ELIMINADO_POR_ROL]    = autor.rol;

    sheetEliminados.appendRow(fila);
    return true;

  } catch (e) {
    console.error('❌ Error respaldando registro eliminado: ' + e.toString());
    return false;
  }
}

// ==========================================
// UTILIDADES DE FORMATO
// ==========================================

/**
 * Parser centralizado de fechas. Las hojas del sistema se leen con
 * getDisplayValues(), que devuelve strings en locale chileno (DD/MM/YYYY);
 * new Date(string) sobre esos valores los interpreta como MM/DD (convención
 * US) y intercambia día/mes en silencio. NUNCA usar new Date(string) sobre
 * valores de hoja: usar siempre esta función.
 * Orden de resolución: Date real → número (timestamp) → DD/MM/YYYY con hora
 * opcional → ISO yyyy-MM-dd → ISO con hora → new Date() como último recurso.
 * Retorna un Date válido o null.
 */
function parsearFechaFlexible(valor) {
  try {
    if (valor === null || valor === undefined || valor === '') return null;
    if (valor instanceof Date) return isNaN(valor.getTime()) ? null : valor;
    if (typeof valor === 'number') {
      var fechaNum = new Date(valor);
      return isNaN(fechaNum.getTime()) ? null : fechaNum;
    }
    var texto = String(valor).trim();
    if (!texto) return null;

    // DD/MM/YYYY con hora opcional. Acepta también el separador " - " que
    // produce formatearFechaConHora ("dd/mm/yyyy - hh:mm"). SIEMPRE se
    // interpreta como día/mes (convención de las hojas del sistema).
    var m = texto.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(?:-\s*)?(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
    if (m) {
      var dia  = parseInt(m[1], 10);
      var mes  = parseInt(m[2], 10);
      var anio = parseInt(m[3], 10);
      var fechaDDMM = new Date(anio, mes - 1, dia,
        parseInt(m[4] || '0', 10), parseInt(m[5] || '0', 10), parseInt(m[6] || '0', 10));
      // Coherencia: fechas imposibles (31/02) "ruedan" de mes en el
      // constructor — si día o mes resultante no coinciden, se rechaza.
      if (fechaDDMM.getDate() !== dia || fechaDDMM.getMonth() !== mes - 1) return null;
      return isNaN(fechaDDMM.getTime()) ? null : fechaDDMM;
    }

    // ISO yyyy-MM-dd sin hora: construir a mediodía local para evitar el
    // corrimiento de un día por timezone (new Date(ISO) asume UTC).
    var mIso = texto.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (mIso) {
      return new Date(parseInt(mIso[1], 10), parseInt(mIso[2], 10) - 1, parseInt(mIso[3], 10), 12, 0, 0);
    }

    // ISO con hora (yyyy-MM-ddT...): new Date lo interpreta correctamente.
    if (/^\d{4}-\d{2}-\d{2}T/.test(texto)) {
      var fechaIsoT = new Date(texto);
      return isNaN(fechaIsoT.getTime()) ? null : fechaIsoT;
    }

    // Último recurso: dejar que el motor intente parsear.
    var fechaUltimo = new Date(texto);
    return isNaN(fechaUltimo.getTime()) ? null : fechaUltimo;
  } catch (e) {
    Logger.log('Error en parsearFechaFlexible: ' + e.toString());
    return null;
  }
}

/**
 * Formatea una fecha a dd/mm/yyyy - hh:mm
 */
function formatearFechaConHora(fecha) {
  try {
    if (!fecha) return "";
    var fechaObj = parsearFechaFlexible(fecha);
    if (fechaObj === null) return fecha.toString();
    var dia = String(fechaObj.getDate()).padStart(2, '0');
    var mes = String(fechaObj.getMonth() + 1).padStart(2, '0');
    var anio = fechaObj.getFullYear();
    var hora = String(fechaObj.getHours()).padStart(2, '0');
    var min  = String(fechaObj.getMinutes()).padStart(2, '0');
    return dia + "/" + mes + "/" + anio + " - " + hora + ":" + min;
  } catch (e) {
    Logger.log('Error formateando fecha: ' + e.toString());
    return fecha ? fecha.toString() : "";
  }
}

/**
 * Formatea una fecha a dd/mm/yyyy (sin hora)
 */
function formatearFechaSinHora(fecha) {
  try {
    if (!fecha) return "";
    var fechaObj = parsearFechaFlexible(fecha);
    if (fechaObj === null) return fecha.toString();
    var dia = String(fechaObj.getDate()).padStart(2, '0');
    var mes = String(fechaObj.getMonth() + 1).padStart(2, '0');
    var anio = fechaObj.getFullYear();
    return dia + "/" + mes + "/" + anio;
  } catch (e) {
    Logger.log('Error formateando fecha: ' + e.toString());
    return fecha ? fecha.toString() : "";
  }
}

/**
 * Formatea un RUT con puntos y guión para visualización
 */
function formatRutDisplay(rut) {
  if (!rut) return '';
  var cleaned = cleanRut(rut);
  if (cleaned.length < 2) return cleaned;
  var dv = cleaned.slice(-1);
  var numero = cleaned.slice(0, -1);
  var formatted = numero.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return formatted + '-' + dv;
}

/**
 * Formatea un RUT para correos (con puntos y guión)
 */
function formatRutServer(rut) {
  if (!rut) return "";
  var rutString = String(rut).trim();
  var value = rutString.replace(/[^0-9kK]/g, '').toUpperCase();
  if (value.length < 2) return value;
  var body = value.slice(0, -1);
  var dv = value.slice(-1);
  var formattedBody = "";
  for (var i = body.length - 1, j = 0; i >= 0; i--, j++) {
    formattedBody = body.charAt(i) + ((j > 0 && j % 3 === 0) ? "." : "") + formattedBody;
  }
  return formattedBody + "-" + dv;
}

/**
 * Limpia un RUT quitando puntos, guión y espacios
 */
function cleanRut(rut) {
  if (!rut) return "";
  return String(rut).replace(/\./g, '').replace(/-/g, '').toUpperCase().trim();
}

// ==========================================
// SESIÓN DE USUARIO (token opaco en CacheService)
// ==========================================
// El webapp es ANYONE_ANONYMOUS y se ejecuta como el propietario, así que la
// identidad NO puede tomarse de Session.getActiveUser(). Estas tres funciones
// permiten que una consulta resuelva el RUT del socio EN EL SERVIDOR a partir
// de un token opaco entregado al momento del login, en vez de confiar en un
// RUT enviado por el cliente (que cualquiera puede alterar desde la consola).
//
// El token es un UUID sin relación con el RUT: conocerlo no permite deducir a
// quién pertenece, y sin él la consulta no devuelve nada.

var SESION_PREFIJO_CACHE = 'sess_';
var SESION_DURACION_SEG  = 21600; // 6 horas — máximo que admite CacheService

/**
 * Crea una sesión de servidor para un RUT ya autenticado y devuelve su token.
 * Retorna "" si no se pudo crear: quien llama debe seguir funcionando igual
 * (el login nunca debe fallar porque la caché no esté disponible).
 */
function crearSesionUsuario(rutLimpio) {
  try {
    if (!rutLimpio) return '';
    var token = Utilities.getUuid();
    CacheService.getScriptCache().put(SESION_PREFIJO_CACHE + token, rutLimpio, SESION_DURACION_SEG);
    return token;
  } catch (e) {
    Logger.log('⚠️ crearSesionUsuario: no se pudo crear la sesión — ' + e.toString());
    return '';
  }
}

/**
 * Devuelve el RUT limpio asociado a un token de sesión, o "" si el token no
 * existe, venció o nunca fue válido. Esta es la ÚNICA forma correcta de saber
 * quién está consultando sin creerle al cliente.
 */
function obtenerRutDeSesion(token) {
  try {
    if (!token) return '';
    var cache = CacheService.getScriptCache();
    var clave = SESION_PREFIJO_CACHE + String(token);
    var rut = cache.get(clave);
    if (!rut) return '';
    // Renovación deslizante: mientras el socio siga navegando, su sesión no vence.
    cache.put(clave, rut, SESION_DURACION_SEG);
    return rut;
  } catch (e) {
    Logger.log('⚠️ obtenerRutDeSesion: ' + e.toString());
    return '';
  }
}

/**
 * Invalida una sesión (cierre de sesión del socio). Nunca lanza excepción.
 */
function cerrarSesionUsuario(token) {
  try {
    if (token) CacheService.getScriptCache().remove(SESION_PREFIJO_CACHE + String(token));
  } catch (e) {
    Logger.log('⚠️ cerrarSesionUsuario: ' + e.toString());
  }
  return { success: true };
}

/**
 * Valida si un correo electrónico tiene formato válido
 */
function esCorreoValido(correo) {
  if (!correo || typeof correo !== 'string') return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo.trim().toLowerCase());
}

/**
 * Validación ESTRICTA, para cuando se GUARDA un correo por primera vez.
 *
 * esCorreoValido() sólo exige "algo, arroba, algo, punto, algo": acepta barras,
 * comas y cualquier símbolo que no sea espacio ni arroba. Así entró a la base
 * "s/socio.ejemplo@gmail.com" — el centinela S/D pegado al correo por una
 * edición a mano — y ahí se quedó, hasta que Drive rechazó el permiso.
 *
 * Se usa SÓLO en los caminos de escritura (actualizarDatoUsuario). La versión
 * permisiva se deja intacta para los caminos de lectura y notificación: si se
 * endureciera globalmente, direcciones ya guardadas dejarían de recibir correos
 * de un día para otro, que es un cambio distinto y hay que decidirlo aparte.
 *
 * Acepta el juego de caracteres que usa el 99,9% de las direcciones reales
 * (letras, dígitos, punto, guion, guion bajo, más y porcentaje) y exige un TLD
 * de al menos dos letras. No admite puntos consecutivos ni al principio o final
 * del nombre de usuario.
 */
function esCorreoValidoEstricto(correo) {
  if (!correo || typeof correo !== 'string') return false;
  var valor = correo.trim().toLowerCase();
  if (valor.length > 254) return false;
  if (!/^[a-z0-9][a-z0-9._%+-]*@[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(valor)) return false;
  if (valor.indexOf('..') !== -1) return false;
  if (valor.split('@')[0].slice(-1) === '.') return false;
  return true;
}

/**
 * Valida el dígito verificador de un RUT chileno — versión servidor.
 * Misma lógica que la función cliente homónima en Index.html, duplicada
 * aquí porque Modulo asistencia.js corre en el backend y no puede invocar
 * código del frontend.
 */
function validarRutChileno(rut) {
  if (!rut) return false;
  var limpio = String(rut).replace(/\./g, '').replace(/-/g, '').toUpperCase().trim();
  if (limpio.length < 2) return false;
  var dv = limpio.slice(-1);
  var numero = limpio.slice(0, -1);
  if (!/^\d+$/.test(numero)) return false;
  var suma = 0;
  var multiplo = 2;
  for (var i = numero.length - 1; i >= 0; i--) {
    suma += parseInt(numero[i], 10) * multiplo;
    multiplo = multiplo < 7 ? multiplo + 1 : 2;
  }
  var dvEsperado = 11 - (suma % 11);
  var dvCalculado = dvEsperado === 11 ? '0' : dvEsperado === 10 ? 'K' : String(dvEsperado);
  return dv === dvCalculado;
}

/**
 * Ajusta un color hexadecimal más claro/oscuro de forma PROPORCIONAL
 * (uso en plantillas de correo, ej. degradado del header).
 * percent negativo oscurece, percent positivo aclara.
 * A diferencia de la versión anterior (aditiva), esto evita que colores
 * ya oscuros (#065f46, #15803d, #0369a1, etc.) terminen clampados a
 * negro puro en el extremo del degradado.
 */
function adjustColor(hexColor, percent) {
  var num = parseInt(hexColor.replace("#", ""), 16);
  var R = (num >> 16) & 0xFF;
  var G = (num >> 8) & 0xFF;
  var B = num & 0xFF;

  var factor = 1 + (percent / 100);
  R = Math.min(255, Math.max(0, Math.round(R * factor)));
  G = Math.min(255, Math.max(0, Math.round(G * factor)));
  B = Math.min(255, Math.max(0, Math.round(B * factor)));

  return "#" + ((1 << 24) + (R << 16) + (G << 8) + B).toString(16).slice(1);
}

/**
 * Normaliza un string de hora al formato HH:mm
 */
function normalizarHoraHHmm(valor) {
  if (!valor) return '';
  var limpio = valor.replace(/\s/g, '').toUpperCase();
  var esPM = limpio.indexOf('PM') !== -1;
  var esAM = limpio.indexOf('AM') !== -1;
  limpio = limpio.replace('A.M.', '').replace('P.M.', '').replace('AM', '').replace('PM', '');
  var partes = limpio.split(':');
  if (partes.length < 2) return '';
  var horas   = parseInt(partes[0], 10);
  var minutos = parseInt(partes[1], 10);
  if (isNaN(horas) || isNaN(minutos)) return '';
  if (esAM && horas === 12) horas = 0;
  if (esPM && horas !== 12) horas += 12;
  return ('0' + horas).slice(-2) + ':' + ('0' + minutos).slice(-2);
}

/**
 * Genera código de asamblea en formato YYYY_MM
 */
function generarCodigoAsamblea(fecha) {
  if (!fecha || !(fecha instanceof Date)) fecha = new Date();
  var year  = fecha.getFullYear();
  var month = String(fecha.getMonth() + 1).padStart(2, '0');
  return year + "_" + month;
}

/**
 * Genera código de asamblea desde fecha de evento en formato YYYY_MM_DD
 */
function generarCodigoAsambleaEvento(fechaEvento) {
  try {
    var fecha;
    if (typeof fechaEvento === 'string') {
      var soloFecha = fechaEvento.split('T')[0];
      var partes = soloFecha.split('-');
      fecha = new Date(parseInt(partes[0]), parseInt(partes[1]) - 1, parseInt(partes[2]), 12, 0, 0);
    } else if (fechaEvento instanceof Date) {
      fecha = fechaEvento;
    } else {
      return generarCodigoAsamblea(new Date());
    }
    var year  = fecha.getFullYear();
    var month = String(fecha.getMonth() + 1).padStart(2, '0');
    var day   = String(fecha.getDate()).padStart(2, '0');
    return year + "_" + month + "_" + day;
  } catch (e) {
    Logger.log('Error en generarCodigoAsambleaEvento: ' + e.toString());
    return generarCodigoAsamblea(new Date());
  }
}

/**
 * Extrae la URL de una fórmula =IMAGE("URL")
 */
function extraerUrlDeImagen(formula) {
  if (!formula || typeof formula !== 'string') return '';
  var regex = /=IMAGE\s*\(\s*"([^"]+)"\s*\)/i;
  var match = formula.match(regex);
  if (match && match[1]) return match[1];
  if (formula.startsWith('http')) return formula;
  return '';
}

function extraerFileIdDeDriveUrl(url) {
  if (!url || typeof url !== 'string') return '';
  var m = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  m = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  return '';
}

// ==========================================
// SISTEMA CENTRALIZADO DE PERMISOS DE ARCHIVOS
// ==========================================

/**
 * Valida los correos de los usuarios involucrados antes de procesar archivos
 */
function validarCorreosParaPermisos(beneficiario, gestor, esGestionDirigente) {
  var resultado = {
    valido: true,
    alertas: [],
    correosParaPermisos: [],
    alertaBeneficiario: false,
    alertaGestor: false
  };

  var correoBeneficiarioValido = esCorreoValido(beneficiario.correo);

  if (correoBeneficiarioValido) {
    resultado.correosParaPermisos.push({
      correo: beneficiario.correo.trim().toLowerCase(),
      tipo: 'beneficiario',
      nombre: beneficiario.nombre
    });
  } else {
    resultado.alertaBeneficiario = true;
    if (esGestionDirigente) {
      resultado.alertas.push({
        tipo: 'warning',
        mensaje: 'El socio ' + beneficiario.nombre + ' no tiene un correo electrónico válido registrado. No podrá acceder al archivo adjunto. Infórmele que debe actualizar sus datos en "Mis Datos".'
      });
    } else {
      resultado.alertas.push({
        tipo: 'warning',
        mensaje: 'No tienes un correo electrónico válido registrado. No podrás acceder al archivo adjunto desde tu correo. Por favor, actualiza tus datos en el módulo "Mis Datos".'
      });
    }
  }

  // El correo del gestor NO recibe permiso. Antes se otorgaba aquí, tomándolo
  // de BD_SLIMAPP (obtenerUsuarioPorRut), y era un error por dos motivos:
  //
  //   1. Es redundante. Los módulos donde un dirigente puede gestionar a nombre
  //      de un socio ya llaman compartirArchivoConRol(..., 'DIRIGENTE', 'leer'),
  //      que reparte a las cuentas institucionales de CUENTAS_VALIDAS. El gestor
  //      ya ve el archivo por su cuenta de cargo.
  //   2. El acceso a documentos de terceros debe ir atado al CARGO, no a la
  //      persona. BD_SLIMAPP es la ficha que el propio usuario edita desde "Mis
  //      Datos": si cambia su Gmail, el permiso viejo queda huérfano, y si sale
  //      de la directiva lo conserva para siempre. CUENTAS_VALIDAS se administra
  //      de forma centralizada y tiene ESTADO, así que se puede revocar.
  //
  // Un escaneo de 2026-08-24 encontró once direcciones personales de dirigentes
  // con ~215 archivos de socios cada una, ya fuera de CUENTAS_VALIDAS y por lo
  // tanto imposibles de administrar. Esto corta esa fuente.
  //
  // El permiso al BENEFICIARIO sí sigue siendo personal: es su propio documento
  // y no tiene otra cuenta. El parámetro gestor se conserva para no cambiar la
  // firma que usan los cinco módulos que la invocan.
  //
  // Excepción a vigilar: si algún módulo NO comparte con el rol DIRIGENTE, el
  // gestor se queda sin ver lo que él mismo envió. Por eso Trámites a la Empresa
  // sumó ese rol a su reparto.

  return resultado;
}

// ==========================================
// PERMISOS DE DRIVE SILENCIOSOS — PUNTO ÚNICO
// ==========================================

/**
 * Único punto por donde el sistema otorga acceso a un archivo de Drive.
 *
 * Siempre silencioso: Drive API v2 con sendNotificationEmails:false. Nunca
 * addViewer()/addEditor(), que no pueden suprimir el correo nativo "Elemento
 * compartido contigo". Ese correo, repetido cada hora, es exactamente el spam
 * que recibieron socias en jul–sep 2026 desde proyectos con código anterior.
 *
 * El guion bajo FINAL es a propósito: en Apps Script una función terminada en
 * "_" es privada y google.script.run no puede invocarla. Sin él, cualquiera
 * podría darse acceso a un archivo ajeno desde la consola del navegador
 * (webapp ANYONE_ANONYMOUS). El guion bajo inicial, en cambio, no protege.
 *
 * Lanza el error de Drive tal cual: cada llamador decide si reintenta, encola
 * o lo clasifica como permanente (esErrorSinCuentaGoogle).
 *
 * @param {string} fileId
 * @param {string} correo Se normaliza a trim + minúsculas antes de otorgar.
 * @param {string} [rol] 'reader' (por defecto) o 'writer'.
 */
function otorgarPermisoSilencioso_(fileId, correo, rol) {
  var valor = String(correo || '').trim().toLowerCase();
  if (!fileId || !valor) {
    throw new Error('otorgarPermisoSilencioso_: falta fileId o correo.');
  }
  return Drive.Permissions.insert(
    { 'role': (rol === 'writer') ? 'writer' : 'reader', 'type': 'user', 'value': valor },
    fileId,
    { sendNotificationEmails: false }
  );
}

// ==========================================
// CANDADO DE ENTORNO PARA ACTIVADORES
// ==========================================

// Script ID del proyecto de PRODUCCIÓN (el mismo que figura en CLAUDE.md). No
// es un secreto ni un dato de configuración: es la identidad del proyecto, y
// no puede vivir en PropertiesService porque esas propiedades son justamente
// lo que una copia del proyecto hereda o se reconfigura.
var SCRIPT_ID_PRODUCCION = 'REEMPLAZAR_CON_SCRIPT_ID_DE_PRODUCCION';

// Script Property que habilita los activadores en un proyecto que no es PROD
// (p. ej. para probar uno en DEV). Se crea y se borra a mano; mientras exista,
// ese proyecto actúa sobre las bases reales igual que producción.
var PROP_PERMITIR_ACTIVADORES_FUERA_DE_PROD = 'PERMITIR_ACTIVADORES_FUERA_DE_PROD';

/**
 * true si la ejecución la disparó un activador instalable (de tiempo o
 * onEdit): esos eventos traen triggerUid. Una llamada desde el editor, desde
 * google.script.run o desde otra función nunca lo trae.
 */
function esEjecucionDeActivador_(e) {
  return !!(e && typeof e === 'object' && e.triggerUid);
}

/**
 * Candado de entorno: devuelve true si un activador debe ABORTAR porque este
 * proyecto no es producción.
 *
 * DEV, PROD y cualquier copia del proyecto comparten las mismas bases (ver
 * CLAUDE.md). Un activador vivo fuera de PROD actúa sobre datos reales sin que
 * nadie lo mire: duplica notificaciones y, con código viejo, reparte permisos
 * de Drive con aviso nativo. Así pasó con SLIMAPP-TESTING / TESTING II, que
 * siguieron compartiendo comprobantes de devolución cada hora meses después de
 * abandonados.
 *
 * Sólo frena ejecuciones de activador: correr la misma función a mano desde el
 * editor de DEV sigue funcionando, que es como se prueba.
 *
 * Uso, como primera línea de cada función de activador:
 *   if (activadorFueraDeProduccion_(e, 'nombreFuncion')) return;
 */
function activadorFueraDeProduccion_(e, nombreFuncion) {
  if (!esEjecucionDeActivador_(e)) return false;
  if (ScriptApp.getScriptId() === SCRIPT_ID_PRODUCCION) return false;

  var permitido = '';
  try {
    permitido = PropertiesService.getScriptProperties().getProperty(PROP_PERMITIR_ACTIVADORES_FUERA_DE_PROD) || '';
  } catch (eProp) { /* sin propiedades legibles: se bloquea */ }
  if (String(permitido).trim().toUpperCase() === 'SI') return false;

  Logger.log('🔒 ' + (nombreFuncion || 'activador') + ': este proyecto (' + ScriptApp.getScriptId() +
    ') no es PRODUCCIÓN — el activador no hace nada. Para habilitarlo aquí, crea la propiedad ' +
    PROP_PERMITIR_ACTIVADORES_FUERA_DE_PROD + ' = SI.');
  return true;
}

/**
 * Sube un archivo a Google Drive y otorga permisos de lectura (silenciosos)
 */
function subirArchivoConPermisos(archivoData, carpetaId, nombreArchivo, correosParaPermisos, correosAdicionales) {
  correosAdicionales = correosAdicionales || [];

  var resultado = {
    success: false,
    url: '',
    permisosOtorgados: [],
    permisosError: [],
    mensajeError: ''
  };

  try {
    var sizeInBytes = (archivoData.base64.length * 3) / 4;
    if (sizeInBytes > LIMITE_ARCHIVO_MB * 1024 * 1024) {
      resultado.mensajeError = "El archivo es demasiado grande (máximo " + LIMITE_ARCHIVO_MB + "MB).";
      return resultado;
    }

    var folder = DriveApp.getFolderById(carpetaId);
    var blob = Utilities.newBlob(
      Utilities.base64Decode(archivoData.base64),
      archivoData.mimeType,
      archivoData.fileName
    );

    var extension = "";
    var nameParts = archivoData.fileName.split('.');
    if (nameParts.length > 1) extension = "." + nameParts.pop();
    blob.setName(nombreArchivo + extension);

    var file = folder.createFile(blob);
    Utilities.sleep(1500);
    file.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
    Utilities.sleep(1000);

    var todosLosCorreos = correosParaPermisos.slice();
    correosAdicionales.forEach(function(correo) {
      if (esCorreoValido(correo)) {
        var yaExiste = todosLosCorreos.some(function(c) {
          return c.correo === correo.trim().toLowerCase();
        });
        if (!yaExiste) {
          todosLosCorreos.push({ correo: correo.trim().toLowerCase(), tipo: 'adicional', nombre: 'Usuario adicional' });
        }
      }
    });

    var fileId = file.getId();

    todosLosCorreos.forEach(function(item) {
      try {
        otorgarPermisoSilencioso_(fileId, item.correo, 'reader');
        resultado.permisosOtorgados.push({ correo: item.correo, tipo: item.tipo, nombre: item.nombre });
        Logger.log("✅ Permiso silencioso otorgado a " + item.tipo + ": " + item.correo);
      } catch (permError) {
        resultado.permisosError.push({ correo: item.correo, tipo: item.tipo, nombre: item.nombre, error: permError.toString() });
        Logger.log("❌ Error al otorgar permiso silencioso (API Avanzada) a " + item.tipo + " (" + item.correo + "): " + permError);
      }
    });

    resultado.success = true;
    resultado.url    = file.getUrl();
    resultado.fileId = file.getId();
    return resultado;

  } catch (error) {
    Logger.log("❌ Error al subir archivo: " + error.toString());
    resultado.mensajeError = "Error al subir el archivo: " + error.toString();
    return resultado;
  }
}

/**
 * Genera el objeto de alerta de permisos para retornar al frontend
 */
function generarAlertaPermisos(validacionCorreos, resultadoSubida) {
  var alerta = { mostrarAlerta: false, tipoAlerta: 'info', mensajeAlerta: '', detalles: [] };

  if (validacionCorreos.alertas && validacionCorreos.alertas.length > 0) {
    alerta.mostrarAlerta = true;
    validacionCorreos.alertas.forEach(function(a) { alerta.detalles.push(a.mensaje); });
    if (validacionCorreos.alertaBeneficiario) alerta.tipoAlerta = 'warning';
  }

  if (resultadoSubida && resultadoSubida.permisosError && resultadoSubida.permisosError.length > 0) {
    alerta.mostrarAlerta = true;
    alerta.tipoAlerta = 'warning';
    resultadoSubida.permisosError.forEach(function(err) {
      alerta.detalles.push("No se pudo otorgar acceso a " + err.nombre + " (" + err.correo + ")");
    });
  }

  if (alerta.mostrarAlerta) alerta.mensajeAlerta = alerta.detalles.join('\n\n');
  return alerta;
}

// ==========================================
// ENRUTADOR DE PERMISOS POR ROL (CUENTAS_VALIDAS)
// ==========================================

/**
 * Otorga permisos de Google Drive a todos los usuarios ACTIVOS de un rol específico.
 *
 * @param {string} fileId      ID del archivo en Google Drive.
 * @param {string} rolAsignado Rol a buscar en CUENTAS_VALIDAS (ej: 'ADMIN', 'DIRIGENTE').
 * @param {string} tipoPermiso 'leer' → Viewer | 'editar' → Editor.
 * @returns {{ success: boolean, correos: string[], errores: string[], mensaje: string }}
 *
 * Uso desde otros módulos:
 *   var res = compartirArchivoConRol(urlArchivo.split('id=')[1], 'DIRIGENTE', 'leer');
 *   // O con el fileId directo si ya lo tienes:
 *   var res = compartirArchivoConRol(resultadoSubida.fileId, 'ADMIN', 'editar');
 */
function compartirArchivoConRol(fileId, rolAsignado, tipoPermiso) {
  try {
    var sheet = getSheet('USUARIOS', 'CUENTAS_VALIDAS');
    if (!sheet) return { success: false, correos: [], errores: [], mensaje: 'Hoja CUENTAS_VALIDAS no encontrada. Verifica CONFIG_HOJAS en PropertiesService.' };

    var COL      = CONFIG.COLUMNAS.CUENTAS_VALIDAS;
    var data     = sheet.getDataRange().getValues();
    var rolBuscar = rolAsignado.toString().trim().toUpperCase();
    var correosFiltrados = [];

    for (var i = 1; i < data.length; i++) {
      var fila   = data[i];
      var correo = (fila[COL.CORREO] || '').toString().trim();
      var rol    = (fila[COL.ROL]    || '').toString().trim().toUpperCase();
      var estado = (fila[COL.ESTADO] || '').toString().trim().toUpperCase();
      // Para REPLEGAL se aceptan variantes numeradas (REPLEGAL1, REPLEGAL2...),
      // por el mismo motivo que en obtenerCorreosRepLegal(). El resto de roles
      // mantiene comparación estricta.
      var coincideRol = (rolBuscar === 'REPLEGAL')
        ? /^REPLEGAL\d*$/.test(rol)
        : (rol === rolBuscar);
      if (coincideRol && estado === 'ACTIVO' && esCorreoValido(correo)) {
        correosFiltrados.push(correo);
      }
    }

    if (correosFiltrados.length === 0) {
      return { success: true, correos: [], errores: [], mensaje: 'Sin usuarios ACTIVOS con rol "' + rolAsignado + '".' };
    }

    var archivo = DriveApp.getFileById(fileId);
    var concedidos = [];
    var errores    = [];
    var hayErrorReparable = false;

    correosFiltrados.forEach(function(correo) {
      try {
        otorgarPermisoSilencioso_(fileId, correo, (tipoPermiso === 'editar') ? 'writer' : 'reader');
        concedidos.push(correo);
      } catch (e) {
        Logger.log('compartirArchivoConRol — error con ' + correo + ': ' + e);
        errores.push(correo);
        // Un rechazo por "no es cuenta Google" no se arregla reintentando: se
        // registra, pero no se encola. Cualquier otro error sí puede ser
        // transitorio y merece otra vuelta.
        if (!esErrorSinCuentaGoogle(e)) hayErrorReparable = true;
      }
    });

    // Los seis módulos llaman a esta función como si no devolviera nada, así que
    // hasta acá un otorgamiento fallido moría en el Logger: sin reintento, sin
    // aviso y sin nadie que lo mirara nunca más. El síntoma llegaba semanas
    // después, cuando alguien de la empresa pedía acceso a un archivo suelto
    // desde Drive. Se deja la señal y el activador de 30 minutos lo reintenta.
    //
    // El encolado va aparte y no puede propagar: la subida del socio ya terminó
    // bien en todo lo demás y no puede caerse por esto.
    if (hayErrorReparable) {
      try {
        marcarArchivoParaReparacionRoles(fileId, rolAsignado);
      } catch (eCola) {
        Logger.log('⚠️ compartirArchivoConRol — no se pudo encolar la reparación: ' + eCola);
      }
    }

    return {
      success:  true,
      correos:  concedidos,
      errores:  errores,
      mensaje:  concedidos.length + ' permiso(s) "' + tipoPermiso + '" otorgado(s) al rol "' + rolAsignado + '".'
    };
  } catch (e) {
    Logger.log('Error en compartirArchivoConRol: ' + e);
    return { success: false, correos: [], errores: [], mensaje: "Ocurrió un error interno. Por favor, intente más tarde o contacte al administrador." };
  }
}

/**
 * Devuelve un array con los correos de todos los miembros ACTIVOS del rol REPLEGAL
 * registrados en CUENTAS_VALIDAS. Usar para notificaciones al representante legal.
 *
 * @returns {string[]}
 */
function obtenerCorreosRepLegal() {
  try {
    var sheet = getSheet('USUARIOS', 'CUENTAS_VALIDAS');
    if (!sheet) return [];
    var COL  = CONFIG.COLUMNAS.CUENTAS_VALIDAS;
    var data = sheet.getDataRange().getValues();
    var correos = [];
    for (var i = 1; i < data.length; i++) {
      var fila   = data[i];
      var correo = (fila[COL.CORREO] || '').toString().trim();
      var rol    = (fila[COL.ROL]    || '').toString().trim().toUpperCase();
      var estado = (fila[COL.ESTADO] || '').toString().trim().toUpperCase();
      // Se aceptan REPLEGAL y variantes numeradas (REPLEGAL1, REPLEGAL2...).
      // Todos los representantes legales tienen el mismo alcance: si la hoja
      // se edita a mano con un sufijo, la persona NO debe quedar sin notificar.
      if (/^REPLEGAL\d*$/.test(rol) && estado === 'ACTIVO' && esCorreoValido(correo)) correos.push(correo);
    }
    return correos;
  } catch (e) {
    Logger.log('Error en obtenerCorreosRepLegal: ' + e);
    return [];
  }
}

/**
 * Devuelve un array con los correos de todos los miembros ACTIVOS del rol ADMIN
 * registrados en CUENTAS_VALIDAS. Usar para notificaciones por email.
 *
 * @returns {string[]}  Lista de correos válidos. Array vacío si no hay o hay error.
 */
function obtenerCorreosAdmin() {
  try {
    var sheet = getSheet('USUARIOS', 'CUENTAS_VALIDAS');
    if (!sheet) return [];
    var COL  = CONFIG.COLUMNAS.CUENTAS_VALIDAS;
    var data = sheet.getDataRange().getValues();
    var correos = [];
    for (var i = 1; i < data.length; i++) {
      var fila   = data[i];
      var correo = (fila[COL.CORREO] || '').toString().trim();
      var rol    = (fila[COL.ROL]    || '').toString().trim().toUpperCase();
      var estado = (fila[COL.ESTADO] || '').toString().trim().toUpperCase();
      if (rol === 'ADMIN' && estado === 'ACTIVO' && esCorreoValido(correo)) {
        correos.push(correo);
      }
    }
    return correos;
  } catch (e) {
    Logger.log('Error en obtenerCorreosAdmin: ' + e);
    return [];
  }
}

/**
 * Devuelve un array con los correos de todos los miembros ACTIVOS del rol DIRECTORIO
 * registrados en CUENTAS_VALIDAS. Usar para notificaciones por email.
 *
 * @returns {string[]}  Lista de correos válidos. Array vacío si no hay o hay error.
 *
 * Uso: var correos = obtenerCorreosDirectorio();
 *      correos.forEach(function(c) { enviarCorreoEstilizado(c, ...); });
 */
function obtenerCorreosDirectorio() {
  try {
    var sheet = getSheet('USUARIOS', 'CUENTAS_VALIDAS');
    if (!sheet) return [];
    var COL  = CONFIG.COLUMNAS.CUENTAS_VALIDAS;
    var data = sheet.getDataRange().getValues();
    var correos = [];
    for (var i = 1; i < data.length; i++) {
      var fila   = data[i];
      var correo = (fila[COL.CORREO] || '').toString().trim();
      var rol    = (fila[COL.ROL]    || '').toString().trim().toUpperCase();
      var estado = (fila[COL.ESTADO] || '').toString().trim().toUpperCase();
      if (rol === 'DIRECTORIO' && estado === 'ACTIVO' && esCorreoValido(correo)) {
        correos.push(correo);
      }
    }
    return correos;
  } catch (e) {
    Logger.log('Error en obtenerCorreosDirectorio: ' + e);
    return [];
  }
}

// ==========================================
// CORREO ESTILIZADO CENTRALIZADO
// ==========================================

/**
 * Construye el cuerpo HTML de un correo estilizado del sindicato.
 *
 * Extraído de enviarCorreoEstilizado() para que ese helper y
 * enviarCorreoEstilizadoConCopia() compartan literalmente la misma plantilla:
 * si cambia el diseño, cambia acá una vez y ambos envíos quedan alineados.
 *
 * @param {boolean} [permiteRespuesta] - Cambia el pie del correo. Por defecto
 *        (false/omitido) dice "no respondas a este correo", que es lo correcto
 *        para los avisos de estado de préstamos, justificaciones, apelaciones y
 *        credenciales. Se pasa true SOLO donde la respuesta es parte del flujo
 *        —hoy denuncias a jefatura, cuyo texto invita a responder para aportar
 *        antecedentes—; sin este parámetro, el pie contradecía al cuerpo.
 *        Responder siempre funciona técnicamente (MailApp envía desde la cuenta
 *        que despliega y no se define replyTo); lo que decide el parámetro es si
 *        el correo lo ofrece o no.
 * @returns {string} HTML completo del correo.
 */
function _construirHtmlCorreoEstilizado(titulo, mensaje, detalles, colorTema, permiteRespuesta) {
    var detallesHtml = "";
    if (detalles && typeof detalles === "object") {
      detallesHtml = "<table style='width:100%;border-collapse:separate;border-spacing:0;margin-top:20px;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;'>";
      var isEven = false;
      for (var key in detalles) {
        var valor = detalles[key];
        if (valor === null || valor === undefined || valor === "") {
          valor = "<span style='color:#94a3b8;font-style:italic;'>S/D</span>";
        }
        var bgRow = isEven ? "#f8fafc" : "#ffffff";
        detallesHtml += "<tr style='background-color:" + bgRow + ";'>" +
          "<td style='padding:12px 15px;border-bottom:1px solid #e2e8f0;color:#64748b;font-weight:600;font-size:13px;width:35%;vertical-align:top;text-transform:uppercase;letter-spacing:0.05em;'>" + key + "</td>" +
          "<td style='padding:12px 15px;border-bottom:1px solid #e2e8f0;color:#1e293b;font-weight:500;font-size:14px;vertical-align:top;'>" + valor + "</td>" +
          "</tr>";
        isEven = !isEven;
      }
      detallesHtml += "</table>";
    }

    var uniqueId = Utilities.getUuid().slice(0, 8);
    var colorOscuro = adjustColor(colorTema, -40);

    var textoPie = permiteRespuesta === true
      ? "Puedes responder a este correo para aportar antecedentes: tu respuesta llega directamente al Sindicato SLIM N°3."
      : "Este es un mensaje automático. Por favor no respondas a este correo.";

    var htmlBody = '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>' +
      '<body style="margin:0;padding:0;font-family:\'Helvetica Neue\',Helvetica,Arial,sans-serif;background-color:#f1f5f9;">' +
      '<div style="max-width:600px;margin:20px auto;background:white;border-radius:16px;overflow:hidden;box-shadow:0 10px 15px -3px rgba(0,0,0,0.1);">' +
      '<div style="background:linear-gradient(135deg,' + colorTema + ' 0%,' + colorOscuro + ' 100%);padding:40px 30px;text-align:center;">' +
      '<h1 style="margin:0;color:white;font-size:24px;font-weight:800;letter-spacing:-0.5px;text-shadow:0 2px 4px rgba(0,0,0,0.1);">' + titulo + '</h1>' +
      '<p style="margin:10px 0 0 0;color:rgba(255,255,255,0.9);font-size:14px;">Sindicato SLIM N°3</p></div>' +
      '<div style="padding:40px 30px;background-color:#ffffff;">' +
      '<p style="color:#334155;font-size:16px;line-height:1.6;margin:0 0 25px 0;text-align:left;">' + mensaje + '</p>' +
      detallesHtml +
      '<div style="margin-top:30px;padding:15px;background-color:#eff6ff;border-left:4px solid ' + colorTema + ';border-radius:4px;">' +
      '<p style="color:#1e40af;font-size:12px;line-height:1.5;margin:0;"><strong>Nota Importante:</strong> Si el campo aparece como "S/D", significa que no hay datos registrados para ese ítem en el momento de la gestión.</p>' +
      '</div></div>' +
      '<div style="background:#f8fafc;padding:20px;text-align:center;border-top:1px solid #e2e8f0;">' +
      '<p style="color:#64748b;font-size:11px;margin:0;line-height:1.4;">' + textoPie + '<br>© ' + new Date().getFullYear() + ' Plataforma de Gestión Sindicato SLIM N°3</p>' +
      '<p style="color:#cbd5e1;font-size:9px;margin:10px 0 0 0;">Ref: ' + uniqueId + '</p>' +
      '</div></div></body></html>';

    return htmlBody;
}

/**
 * Envía un correo HTML estilizado con tabla de detalles a UN destinatario.
 *
 * @param {boolean} [permiteRespuesta] - Ver _construirHtmlCorreoEstilizado().
 *        Omitirlo mantiene el pie "no respondas a este correo" de siempre.
 */
function enviarCorreoEstilizado(destinatario, asunto, titulo, mensaje, detalles, colorTema, permiteRespuesta) {
  try {
    if (!destinatario || !destinatario.includes("@")) {
      console.log("Correo inválido: " + destinatario);
      return;
    }

    MailApp.sendEmail({
      to: destinatario,
      subject: asunto,
      htmlBody: _construirHtmlCorreoEstilizado(titulo, mensaje, detalles, colorTema, permiteRespuesta)
    });

  } catch (e) {
    console.error("Error enviando correo a " + destinatario + ": " + e.toString());
  }
}

/**
 * Igual que enviarCorreoEstilizado(), pero con enrutamiento "Para"/"CC": envía
 * UN solo correo a todos los interesados en vez de N correos individuales.
 * Misma plantilla y misma tabla de detalles.
 *
 * Replica el criterio de CC de enviarCorreoFormalConAdjuntos(): acepta string o
 * array, filtra inválidos, deduplica y descarta los que ya van en "Para". La
 * diferencia con ese helper es que este usa la plantilla interna del sindicato
 * y no adjunta archivos (los documentos siguen viajando como enlace de Drive
 * con permisos silenciosos por rol).
 *
 * @param {string|string[]} destinatarios - Correo(s) del campo "Para".
 * @param {string|string[]} ccCorreos     - Correo(s) en copia.
 * @param {boolean} [permiteRespuesta]    - Ver _construirHtmlCorreoEstilizado().
 *        Omitirlo mantiene el pie "no respondas a este correo" de siempre.
 * @returns {{success:boolean, destinatarios:string[], cc:string[], message:string}}
 */
function enviarCorreoEstilizadoConCopia(destinatarios, ccCorreos, asunto, titulo, mensaje, detalles, colorTema, permiteRespuesta) {
  try {
    var paraEntrada = Array.isArray(destinatarios) ? destinatarios : (destinatarios ? [destinatarios] : []);
    var paraVistos  = {};
    var paraValidos = [];
    paraEntrada.forEach(function(correo) {
      var c = (correo || '').toString().trim();
      var k = c.toLowerCase();
      if (esCorreoValido(c) && !paraVistos[k]) { paraVistos[k] = true; paraValidos.push(c); }
    });

    // Sin "Para" válido el correo no sale para NADIE, ni siquiera para quienes
    // van en CC. Se corta acá con log explícito en vez de fallar en silencio.
    if (paraValidos.length === 0) {
      Logger.log('⚠️ enviarCorreoEstilizadoConCopia: sin destinatarios válidos en "Para" — asunto: ' + asunto);
      return { success: false, destinatarios: [], cc: [], message: 'Sin destinatarios válidos.' };
    }

    var ccEntrada = Array.isArray(ccCorreos) ? ccCorreos : (ccCorreos ? [ccCorreos] : []);
    var ccVistos  = {};
    var ccValidos = [];
    ccEntrada.forEach(function(correo) {
      var c = (correo || '').toString().trim();
      var k = c.toLowerCase();
      if (esCorreoValido(c) && !paraVistos[k] && !ccVistos[k]) { ccVistos[k] = true; ccValidos.push(c); }
    });

    var opciones = {
      to:       paraValidos.join(","),
      subject:  asunto,
      htmlBody: _construirHtmlCorreoEstilizado(titulo, mensaje, detalles, colorTema, permiteRespuesta),
      name:     "Sindicato SLIM N°3"
    };
    if (ccValidos.length > 0) opciones.cc = ccValidos.join(",");

    MailApp.sendEmail(opciones);
    return { success: true, destinatarios: paraValidos, cc: ccValidos, message: 'Correo enviado.' };

  } catch (e) {
    Logger.log('Error en enviarCorreoEstilizadoConCopia: ' + e);
    return { success: false, destinatarios: [], cc: [], message: 'Ocurrió un error interno al enviar la notificación.' };
  }
}

/**
 * Envía un correo formal a la empresa con archivos adjuntos reales.
 * A diferencia de enviarCorreoEstilizado(), este helper:
 *  - Soporta múltiples destinatarios (array), CC y replyTo.
 *  - Adjunta blobs directamente al correo (no links de Drive).
 *  - Usa un formato de carta formal, no la tabla interna del sindicato.
 *
 * @param {string[]} destinatarios - Correos destino "Para" (empresa).
 * @param {string}   asunto        - Asunto completo del correo.
 * @param {string}   htmlBody      - Cuerpo HTML ya construido.
 * @param {Blob[]}   adjuntos      - Blobs a adjuntar (puede ser array vacío).
 * @param {string|string[]} ccCorreos - Correo(s) para copia: acepta un string
 *                                   único o un array. Se filtran válidos, se
 *                                   deduplican y se excluyen los que ya van en "Para".
 * @param {string}   replyTo       - Correo de respuesta (correo del socio).
 * @returns {{success:boolean, message:string}}
 */
function enviarCorreoFormalConAdjuntos(destinatarios, asunto, htmlBody, adjuntos, ccCorreos, replyTo) {
  try {
    var destinosValidos = (destinatarios || []).filter(function(c) { return esCorreoValido(c); });
    if (destinosValidos.length === 0) {
      return { success: false, message: "No hay destinatarios válidos configurados para esta gestión." };
    }
    // Correos ya presentes en "Para": no deben repetirse en CC.
    var enPara = {};
    destinosValidos.forEach(function(c) { enPara[c.toString().trim().toLowerCase()] = true; });

    var opciones = {
      htmlBody: htmlBody,
      name: "Sindicato SLIM N°3",
      attachments: adjuntos || []
    };

    // CC: acepta string único o array. Se filtran válidos, se deduplican y se
    // excluyen los que ya están en "Para".
    var ccEntrada = Array.isArray(ccCorreos) ? ccCorreos : (ccCorreos ? [ccCorreos] : []);
    var ccVistos = {};
    var ccValidos = [];
    ccEntrada.forEach(function(correo) {
      var c = (correo || '').toString().trim();
      var k = c.toLowerCase();
      if (esCorreoValido(c) && !enPara[k] && !ccVistos[k]) {
        ccVistos[k] = true;
        ccValidos.push(c);
      }
    });
    if (ccValidos.length > 0) opciones.cc = ccValidos.join(",");
    if (replyTo && esCorreoValido(replyTo)) opciones.replyTo = replyTo;

    GmailApp.sendEmail(destinosValidos.join(","), asunto, "", opciones);
    return { success: true, message: "Correo enviado." };
  } catch (e) {
    // Hallazgo M-2 (INFORME_QA.md): nunca exponer e.message crudo al socio.
    // El detalle técnico queda solo en Logger para diagnóstico del admin.
    Logger.log("Error en enviarCorreoFormalConAdjuntos: " + e);
    return { success: false, message: "Ocurrió un error interno. Por favor, intente más tarde o contacte al administrador." };
  }
}

// ==========================================
// VERIFICACIÓN DE ROL DE USUARIO
// ==========================================

/**
 * Verifica si un usuario tiene un rol específico
 * @param {string} rut
 * @param {Array} rolesPermitidos
 * @returns {Object} {autorizado, mensaje, rol}
 */
function verificarRolUsuario(rut, rolesPermitidos) {
  try {
    var usuario = obtenerUsuarioPorRut(rut);
    if (!usuario.encontrado) {
      return { autorizado: false, mensaje: "Usuario no encontrado", rol: "" };
    }
    var rolUsuario = String(usuario.rol || "SOCIO").trim().toUpperCase();
    var tienePermiso = rolesPermitidos.some(function(rol) {
      return rol.toUpperCase() === rolUsuario;
    });
    if (!tienePermiso) {
      Logger.log('⚠️ INTENTO DE ACCESO NO AUTORIZADO: RUT=' + rut + ' Rol=' + rolUsuario + ' Requeridos=' + rolesPermitidos.join(', '));
      return { autorizado: false, mensaje: "No tienes permisos para realizar esta acción", rol: rolUsuario };
    }
    return { autorizado: true, mensaje: "Acceso autorizado", rol: rolUsuario };
  } catch (e) {
    Logger.log('❌ Error verificando rol: ' + e.toString());
    return { autorizado: false, mensaje: "Error de validación", rol: "" };
  }
}

// ==========================================
// HELPERS COMPARTIDOS DE SWITCHES DE MÓDULO
// ==========================================
// Los obtenerEstadoSwitch*/toggleSwitch* de cada módulo delegan aquí para no
// repetir la misma lógica 8 veces. Los nombres públicos por módulo se
// mantienen porque el frontend los invoca por nombre vía google.script.run.

/**
 * Lee el flag de un módulo desde PropertiesService.
 * Default habilitado cuando la clave no existe.
 */
function _switchHabilitado(claveProp) {
  try {
    var estado = PropertiesService.getScriptProperties().getProperty(claveProp);
    return { success: true, habilitado: (estado === null || estado === 'true') };
  } catch (e) {
    return { success: true, habilitado: true };
  }
}

/**
 * Habilita/deshabilita el flag de un módulo. Solo ADMIN — el webapp es
 * ANYONE_ANONYMOUS, así que sin esta validación cualquier visitante podría
 * apagar módulos completos invocando la función por nombre.
 */
function _toggleSwitchModulo(claveProp, estado, rutSolicitante) {
  try {
    var verificacion = verificarRolUsuario(rutSolicitante, ['ADMIN']);
    if (!verificacion.autorizado) {
      Logger.log('⚠️ _toggleSwitchModulo: intento no autorizado — clave=' + claveProp + ' RUT=' + rutSolicitante);
      return { success: false, message: "No autorizado." };
    }
    PropertiesService.getScriptProperties().setProperty(claveProp, estado ? 'true' : 'false');
    return { success: true, habilitado: !!estado };
  } catch (e) {
    return { success: false, message: "Ocurrió un error interno. Por favor, intente más tarde o contacte al administrador." };
  }
}

// ==========================================
// ESTADOS SWITCHES PARA DASHBOARD (badges)
// ==========================================

/**
 * Retorna el estado habilitado/deshabilitado de todos los módulos en una sola llamada
 */
function obtenerEstadosSwitchDashboard() {
  try {
    var props = PropertiesService.getScriptProperties();
    var prestamos     = (props.getProperty('prestamos_habilitado')         !== 'false');
    var contrato      = (props.getProperty('contrato_colectivo_habilitado') !== 'false');
    var slimquest     = (props.getProperty('slimquest_habilitado')          !== 'false');
    var calculadora   = (props.getProperty('calculadora_habilitada')        !== 'false');
    var permisosMedicos = (props.getProperty('permisos_medicos_habilitado') !== 'false');
    var asistencia    = (props.getProperty('asistencia_habilitada')         !== 'false');
    var apelaciones   = (props.getProperty('apelaciones_habilitado')        !== 'false');

    var denuncias = (props.getProperty('denuncias_habilitado') !== 'false');
    // Las dos sub-secciones de "Trámites y Denuncias" tienen tarjeta propia en
    // el inicio; el cliente combina cada una con el maestro `denuncias`.
    var gestionesEmpresa = (props.getProperty('gestiones_empresa_habilitado') !== 'false');
    var denunciaJefatura = (props.getProperty('denuncia_jefatura_habilitado') !== 'false');
    var foro = (props.getProperty('foro_habilitado') !== 'false');

    var justificaciones = false;
    try {
      var resJ = obtenerEstadoSwitchJustificaciones();
      justificaciones = resJ.habilitado;
    } catch (eJ) { justificaciones = false; }

    return {
      success: true,
      prestamos:       prestamos,
      justificaciones: justificaciones,
      contrato:        contrato,
      slimquest:       slimquest,
      calculadora:     calculadora,
      permisosMedicos: permisosMedicos,
      asistencia:      asistencia,
      apelaciones:     apelaciones,
      denuncias:       denuncias,
      gestionesEmpresa: gestionesEmpresa,
      denunciaJefatura: denunciaJefatura,
      foro:            foro
    };
  } catch (e) {
    Logger.log('Error en obtenerEstadosSwitchDashboard: ' + e.toString());
    return { success: false };
  }
}


/**
 * Registra un reporte de bug en la hoja de cálculo de reportes.
 * Sube la captura al mismo directorio del spreadsheet si se adjuntó.
 */
function registrarReporteBug(datos, archivoData) {
  try {
    _ensureConfig();
    var ssId = CONFIG.SPREADSHEETS.REPORTES_BUGS;
    if (!ssId) return { success: false, message: 'Base de datos de reportes no configurada.' };

    var ss = SpreadsheetApp.openById(ssId);
    var sheet = ss.getSheets()[0];

    var ahora    = new Date();
    var fechaStr = Utilities.formatDate(ahora, Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm:ss");
    var numFila  = Math.max(sheet.getLastRow(), 1);
    var id = 'BUG-' + Utilities.formatDate(ahora, Session.getScriptTimeZone(), "yyyyMMdd")
           + '-' + String(numFila).padStart(3, '0');

    var urlCaptura = '';
    if (archivoData && archivoData.base64) {
      try {
        var ssFile      = DriveApp.getFileById(ssId);
        var carpetaId   = ssFile.getParents().next().getId();
        var resultado   = subirArchivoConPermisos(archivoData, carpetaId, 'Bug-' + id, [], []);
        urlCaptura      = resultado.url || '';
      } catch (eImg) {
        Logger.log('registrarReporteBug: error al subir imagen - ' + eImg.toString());
        urlCaptura = 'Error al subir imagen';
      }
    }

    sheet.appendRow([
      id,
      fechaStr,
      String(datos.rut        || ''),
      String(datos.nombre     || ''),
      String(datos.modulo     || ''),
      String(datos.tipo       || ''),
      String(datos.descripcion|| ''),
      String(datos.pasos      || ''),
      urlCaptura,
      'Nuevo'
    ]);

    return { success: true, id: id };
  } catch (e) {
    Logger.log('Error en registrarReporteBug: ' + e.toString());
    return { success: false, message: e.message };
  }
}

// ==========================================
// ENTREGA DE DOCUMENTOS A REPLEGAL POR ADJUNTO
// ==========================================

/**
 * Envía uno o más documentos de Drive a los representantes legales de la
 * empresa como ADJUNTOS REALES, en un correo aparte.
 *
 * POR QUÉ EXISTE
 * Las tres casillas de REPLEGAL (@cl.issworld.com) NO son cuentas de Google.
 * Drive rechaza todo intento de otorgarles permiso en silencio:
 *
 *   "Debido a que no hay una cuenta de Google asociada con esta dirección de
 *    correo electrónico, debes marcar la casilla Enviar notificaciones a las
 *    personas para invitar a este destinatario."
 *
 * Y el invariante del proyecto es que TODO permiso se otorga con
 * sendNotificationEmails:false. O sea: el reparto por rol nunca pudo darles
 * acceso y nunca podrá. La auditoría del 01/09/2026 lo midió — no tenían acceso
 * a ninguno de los 1.004 archivos que les correspondían, y nadie lo notó porque
 * las notificaciones por correo sí les llegaban, con un enlace que no podían
 * abrir.
 *
 * DECISIÓN Y SU COSTO (usuario, 01/09/2026)
 * Se optó por entregarles el documento adjunto en vez de compartirlo. Esto
 * REVIERTE para este rol la decisión registrada en CLAUDE.md de que los
 * documentos médicos viajaran sólo como enlace: un adjunto deja una copia
 * permanente en la casilla del destinatario, fuera del modelo revocable de
 * Drive. Es una decisión tomada a conciencia, no un olvido.
 *
 * POR QUÉ EN UN CORREO APARTE Y NO EN EL CONSOLIDADO
 * El correo consolidado lleva en copia a ADMIN, DIRECTORIO, al socio y a veces
 * al dirigente gestor. Adjuntar ahí mandaría el documento médico a ocho
 * casillas para resolverle el acceso a tres. Este correo va SÓLO a REPLEGAL,
 * que es quien no tiene otra vía; el resto sigue recibiendo el enlace de
 * siempre, que sí pueden abrir. Limita la copia al mínimo que la decisión exige.
 *
 * No reemplaza la notificación consolidada: la acompaña.
 *
 * @param {string[]} urlsOIds   URLs de Drive o fileIds de los documentos.
 * @param {string}   asunto
 * @param {string}   titulo
 * @param {string}   mensaje    Cuerpo (admite HTML simple).
 * @param {Array}    detalles   Pares {label, value} para la tabla, como en el resto.
 * @param {string}   colorTema
 * @returns {{success:boolean, destinatarios:string[], adjuntados:number, omitidos:string[], message:string}}
 */
/**
 * ¿El error de Drive dice que la dirección no tiene cuenta Google?
 *
 * Drive responde "Bad Request" con un mensaje que pide marcar la casilla de
 * notificaciones para poder invitar a esa dirección. Es un rechazo PERMANENTE
 * mientras se otorgue en silencio: reintentarlo da siempre el mismo resultado.
 *
 * Distinguirlo importa porque un error transitorio se reintenta y este no. Sin
 * esta comprobación, las tres casillas de REPLEGAL volverían a la cola cada 30
 * minutos y el activador gastaría miles de llamadas repitiendo un fallo seguro.
 *
 * Se buscan varias marcas porque el texto viene traducido al idioma de la
 * cuenta: se cubre el español y el inglés, y como red se acepta cualquier
 * mención conjunta de "cuenta de Google"/"Google account".
 */
function esErrorSinCuentaGoogle(error) {
  var texto = String(error || '').toLowerCase();
  if (texto.indexOf('bad request') === -1) return false;
  return texto.indexOf('no hay una cuenta de google') !== -1 ||
         texto.indexOf('cuenta de google asociada')   !== -1 ||
         texto.indexOf('no google account')           !== -1 ||
         texto.indexOf('enviar notificaciones')       !== -1 ||
         texto.indexOf('send notification')           !== -1;
}

/**
 * Reemplaza por "Adjunto a este correo" cualquier detalle que sea un enlace de
 * Drive.
 *
 * La tabla de detalles se comparte con la notificación consolidada, donde el
 * enlace es correcto porque quienes la reciben sí lo pueden abrir. En el correo
 * de REPLEGAL ese mismo enlace es una trampa: es la fila que muestra "Ver
 * Documento Adjunto" y que, al pulsarla, les pide permiso de acceso — que es
 * exactamente lo que este envío vino a resolver. Y aparece justo debajo del
 * documento que sí llevan adjunto, así que además hace dudar de si el adjunto
 * llegó.
 *
 * Se hace acá y no en cada módulo para que ninguno pueda volver a colar un
 * enlace inservible en este correo.
 */
function _detallesSinEnlacesDrive(detalles) {
  if (!detalles || typeof detalles !== 'object') return detalles;

  var copia = {};
  for (var clave in detalles) {
    var valor = detalles[clave];
    copia[clave] = (typeof valor === 'string' &&
                    valor.toLowerCase().indexOf('drive.google.com') !== -1)
                 ? 'Adjunto a este correo'
                 : valor;
  }
  return copia;
}

function enviarDocumentosARepLegalAdjuntos(urlsOIds, asunto, titulo, mensaje, detalles, colorTema) {
  var resultado = { success: false, destinatarios: [], adjuntados: 0, omitidos: [], message: '' };

  try {
    var repLegal = obtenerCorreosRepLegal();
    if (repLegal.length === 0) {
      resultado.message = 'Sin REPLEGAL ACTIVO en CUENTAS_VALIDAS: no se envía el adjunto.';
      Logger.log('⚠️ enviarDocumentosARepLegalAdjuntos: ' + resultado.message);
      return resultado;
    }

    var lista = Array.isArray(urlsOIds) ? urlsOIds : [urlsOIds];
    var adjuntos = [], totalBytes = 0;
    var topeBytes = LIMITE_TOTAL_ADJUNTOS_MB * 1024 * 1024;

    lista.forEach(function(ref) {
      var texto = String(ref || '').trim();
      if (!texto || texto.toLowerCase().indexOf('sin documento') !== -1) return;

      var fileId = (texto.indexOf('drive.google.com') !== -1)
                 ? extraerFileIdDeDriveUrl(texto) : texto;
      if (!fileId) { resultado.omitidos.push(texto + ' (URL ilegible)'); return; }

      try {
        var archivo = DriveApp.getFileById(fileId);
        var blob    = archivo.getBlob();
        var bytes   = blob.getBytes().length;

        // Gmail rechaza el envío completo si se pasa del tope, así que es
        // preferible omitir un documento y avisar que perder el correo entero.
        if (totalBytes + bytes > topeBytes) {
          resultado.omitidos.push(archivo.getName() + ' (excede el límite de ' + LIMITE_TOTAL_ADJUNTOS_MB + ' MB)');
          return;
        }

        totalBytes += bytes;
        adjuntos.push(blob);
      } catch (eArch) {
        resultado.omitidos.push(fileId + ' (no se pudo leer: ' + eArch + ')');
      }
    });

    if (adjuntos.length === 0) {
      resultado.message = 'No hay documentos adjuntables; no se envía el correo.';
      Logger.log('⚠️ enviarDocumentosARepLegalAdjuntos: ' + resultado.message +
                 (resultado.omitidos.length ? ' Omitidos: ' + resultado.omitidos.join('; ') : ''));
      return resultado;
    }

    // Misma plantilla con marca que el resto del sistema, para que no parezca
    // un correo ajeno. permiteRespuesta = false: este envío no abre conversación.
    var html = _construirHtmlCorreoEstilizado(
      titulo, mensaje, _detallesSinEnlacesDrive(detalles), colorTema, false);

    var envio = enviarCorreoFormalConAdjuntos(repLegal, asunto, html, adjuntos, [], '');

    resultado.success       = !!(envio && envio.success);
    resultado.destinatarios = repLegal;
    resultado.adjuntados    = adjuntos.length;
    resultado.message       = (envio && envio.message) ? envio.message : '';

    Logger.log((resultado.success ? '✅' : '❌') + ' Documento(s) a REPLEGAL por adjunto: ' +
               adjuntos.length + ' archivo(s) [' +
               adjuntos.map(function(b) { return b.getName(); }).join(', ') + '] → ' + repLegal.join(', ') +
               (resultado.omitidos.length ? ' | Omitidos: ' + resultado.omitidos.join('; ') : ''));

    return resultado;

  } catch (e) {
    // Nunca propaga: este envío es complementario. Si falla, la notificación
    // consolidada ya salió y el trámite del socio no se puede caer por esto.
    Logger.log('❌ enviarDocumentosARepLegalAdjuntos: ' + e);
    resultado.message = String(e);
    return resultado;
  }
}
