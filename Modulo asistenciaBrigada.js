// ==========================================
// CAPA DE LECTURA — "ASISTENCIA POR BRIGADA" (sistema externo)
// ==========================================
// Este archivo lee la planilla del sistema auxiliar "ASISTENCIA POR BRIGADA",
// que es un proyecto INDEPENDIENTE de SLIMAPP y está en producción.
//
// ⛔ SOLO LECTURA. SIN EXCEPCIONES. EN LAS DOS PESTAÑAS.
//    Esa planilla pertenece a otro script, con triggers corriendo cada minuto y
//    una lógica de estados e idempotencia que depende de que nadie más la toque.
//    Una sola escritura desde acá puede provocar correos duplicados a socios
//    reales o la pérdida de marcajes. Aquí no hay (ni puede haber) setValue,
//    setValues, appendRow, clearContent, insertRow, deleteRow ni ordenar la hoja.
//    Vale IGUAL para "Historico": que sea una hoja fría de archivo no la vuelve
//    tierra de nadie, es el respaldo de toda la asistencia histórica del
//    sindicato y no tiene otra copia.
//
// Desde que SLIMAPP retiró BD_ASISTENCIA, esta planilla es la ÚNICA fuente de
// verdad de la asistencia. Toda la lectura y la normalización viven acá y
// desembocan en una sola función de salida (obtenerAsistenciaBrigada): el día
// que cambie la fuente, sólo se toca este archivo.
//
// LA FUENTE ESTÁ PARTIDA EN DOS PESTAÑAS DE ESTRUCTURA IDÉNTICA:
//   "Historico"  → archivo de las actividades ya cerradas. Es la fuente
//                  PRINCIPAL: ahí está la enorme mayoría del historial.
//   "Asistencia" → mesa de trabajo, sólo la actividad EN CURSO. Se vacía entre
//                  una actividad y la siguiente.
// Hay que leer LAS DOS y unirlas. Leer una sola deja al socio con un historial
// incompleto, y de las dos formas posibles el error es silencioso.

// ------------------------------------------
// Configuración del módulo
// ------------------------------------------
// El ID de la planilla NO se escribe literal: ya vive en PropertiesService bajo
// SS_ASISTENCIA_BRIGADA y se lee vía CONFIG.SPREADSHEETS.ASISTENCIA_BRIGADA,
// como manda el patrón de configuración del proyecto.
//
// Los nombres de las pestañas sí quedan como constantes de este módulo, para no
// depender de un paso manual de configuración por entorno. OJO: la pestaña de
// trabajo se llamó "Hoja 1" en el pasado y hoy se llama "Asistencia". Si algún
// día la lectura devuelve vacío, lo primero que hay que revisar es si le
// cambiaron el nombre a alguna de las dos.
//
// UN SOLO bloque de configuración para las dos pestañas, a propósito: su
// estructura es idéntica por diseño, y duplicarla es la forma más fácil de que
// se desincronicen.
var CFG_ASISTENCIA_BRIGADA = {
  // En este orden: primero el archivo, después la actividad en curso. El orden
  // importa para la deduplicación por ID (gana la copia ya consolidada).
  HOJAS_A_LEER:    ['Historico', 'Asistencia'],
  FILA_ENCABEZADO: 1,
  TOTAL_COLUMNAS:  12,  // A..L
  ZONA_HORARIA:    'America/Santiago',
  CACHE_PREFIJO:   'asist_brig_',

  // TTL de caché por pestaña. "Historico" sólo cambia cuando se archiva (muy de
  // vez en cuando): tolera un TTL largo. "Asistencia" cambia durante la
  // actividad: TTL corto, para que el socio vea el marcaje que acaba de hacer.
  CACHE_SEGUNDOS_POR_HOJA: {
    'Historico':  300,
    'Asistencia':  60
  },
  CACHE_SEGUNDOS_DEFECTO: 60,

  // Índices base 0 de las columnas A..L (idénticos en las dos pestañas)
  COL: {
    ID:                   0,  // A  Identificador único del marcaje
    RUT_AFILIADO:         1,  // B  RUT en formato crudo (con o sin puntos/guion)
    HORA_MARCAJE:         2,  // C  Fecha y hora del marcaje
    BRIGADISTA:           3,  // D  Origen del marcaje
    FECHA:                4,  // E  Fecha del marcaje, sin hora
    NOMBRE:               5,  // F
    CORREO:               6,  // G  (no se le muestra al socio)
    REGION:               7,  // H  (no se le muestra al socio)
    ESTADO_SOCIO:         8,  // I  (no se le muestra al socio)
    ESTADO_RUT:           9,  // J  (no se le muestra al socio)
    ESTADO_NOTIFICACION: 10,  // K  Estado interno del proceso de notificación
    ACTIVIDAD:           11   // L
  },

  // Encabezados esperados de A..L, en orden. Son el CONTRATO con un sistema que
  // SLIMAPP no controla: si allá insertan, mueven o renombran una columna, acá
  // se empezaría a mostrar el campo equivocado sin lanzar ninguna excepción.
  // Ver _verificarEncabezados().
  ENCABEZADOS_ESPERADOS: [
    'ID',
    'RUT_Afiliado',
    'Hora_Marcaje',
    'Brigadista',
    'Fecha',
    'Nombre',
    'Correo',
    'Region',
    'Estado_Socio',
    'Estado_RUT',
    'Estado_Notificacion',
    'Actividad'
  ],

  // Valores conocidos de la columna D, traducidos a texto legible para el socio.
  // Cualquier otro valor (incluido un correo de brigadista) se resuelve en
  // _traducirViaRegistro(): el correo del brigadista nunca se expone.
  VIA: {
    MANUAL:     'SISTEMA VIRTUAL DE MARCACION',
    FORMULARIO: 'FORMULARIO VIRTUAL'
  }
};

// Mensaje genérico ante cualquier falla de la fuente externa. El socio no ve
// detalles técnicos y, sobre todo, la vista del portal no se cae (regla 1.3).
var MENSAJE_ERROR_ASISTENCIA_BRIGADA =
  'No se pudo cargar tu historial de asistencia. Por favor, intenta más tarde.';

// ==========================================
// FUNCIÓN EXPUESTA AL CLIENTE
// ==========================================

/**
 * Devuelve el historial de asistencia del socio EN SESIÓN, ya normalizado y
 * listo para mostrar. Une las dos pestañas de la planilla externa.
 *
 * ⚠️ NO recibe el RUT como parámetro, y no debe hacerlo nunca: el RUT se
 * resuelve en el servidor a partir del token de sesión (Global.js). Si llegara
 * como parámetro, cualquiera podría pedir desde la consola del navegador el
 * historial de otro socio — google.script.run es invocable a mano.
 *
 * @param {string} sessionToken Token entregado por validarUsuario() al ingresar.
 * @return {{success: boolean, registros: Array, sesionExpirada: boolean, message: string}}
 */
function obtenerAsistenciaBrigada(sessionToken) {
  // _ensureConfig() va primero y FUERA del try: CONFIG parte en null en cada
  // ejecución y leerlo antes de poblarlo lanza TypeError. Dentro del try, ese
  // error quedaría tapado por el catch y la falla sería invisible.
  _ensureConfig();

  try {
    var rutSesion = obtenerRutDeSesion(sessionToken);
    if (!rutSesion) {
      return {
        success: false,
        sesionExpirada: true,
        registros: [],
        message: 'Tu sesión expiró. Vuelve a ingresar para ver tu historial de asistencia.'
      };
    }

    // La asistencia anterior al sistema actual vive en hoja propia de SLIMAPP y
    // se une acá (Modulo asistenciaHistorica.js). Para el socio es UN solo
    // historial: no tiene por qué saber que hubo un cambio de sistema en 2026.
    // La unión nunca lanza — si esa hoja falla, igual se ve lo de Brigada.
    var registros = _unirAsistenciaHistorica(
      _leerAsistenciaBrigadaPorRut(rutSesion),
      cleanRut(rutSesion)
    );
    return { success: true, sesionExpirada: false, registros: registros, message: '' };

  } catch (e) {
    // La planilla puede no responder, haber cambiado el nombre de una pestaña,
    // haber cambiado sus encabezados o habérsele revocado el permiso. Nada de
    // eso puede reventar el portal.
    Logger.log('❌ obtenerAsistenciaBrigada: ' + e.toString());
    return {
      success: false,
      sesionExpirada: false,
      registros: [],
      message: MENSAJE_ERROR_ASISTENCIA_BRIGADA
    };
  }
}

// ==========================================
// LECTURA Y NORMALIZACIÓN (interno)
// ==========================================

/**
 * Lee las DOS pestañas de la planilla externa y devuelve SOLO las asistencias
 * del RUT indicado, ya unidas, deduplicadas, agrupadas, ordenadas y traducidas
 * a lo que ve el socio.
 *
 * Es la única función que conoce la forma de la fuente. Si el día de mañana la
 * asistencia se integra a SLIMAPP, se reemplaza esta y nada más.
 *
 * Tolerancia a fallas (regla 1.4): si una pestaña se puede leer y la otra no,
 * se muestra lo que sí se pudo leer y el fallo de la otra queda en el log del
 * servidor. Sólo si NINGUNA de las dos se pudo leer se lanza la excepción que
 * deriva en el mensaje de error controlado.
 *
 * @param {string} rutSesion RUT del socio en sesión (crudo o limpio).
 * @return {Array<{actividad: string, fecha: string, hora: string, via: string, enProceso: boolean}>}
 */
function _leerAsistenciaBrigadaPorRut(rutSesion) {
  var rutLimpio = cleanRut(rutSesion);
  if (!rutLimpio) return [];

  var idPlanilla = CONFIG.SPREADSHEETS.ASISTENCIA_BRIGADA;
  if (!idPlanilla) {
    throw new Error('Falta configurar SS_ASISTENCIA_BRIGADA en PropertiesService.');
  }

  var hojas = CFG_ASISTENCIA_BRIGADA.HOJAS_A_LEER;
  var filas = [];
  var hojasLeidas = 0;
  var fallas = [];
  var ss = null;   // se abre perezosamente: si todo viene de caché, ni se toca

  for (var h = 0; h < hojas.length; h++) {
    var nombreHoja = hojas[h];
    try {
      // La caché es POR RUT y POR PESTAÑA: nunca se guarda un bloque global con
      // datos de varios socios mezclados, para que no exista forma de servirle a
      // uno lo del otro. Separarla por pestaña permite además el TTL distinto
      // de cada una (archivo frío vs. actividad en curso).
      var enCache = _leerFilasDesdeCache(nombreHoja, rutLimpio);
      if (enCache !== null) {
        filas = filas.concat(enCache);
        hojasLeidas++;
        continue;
      }

      if (!ss) ss = SpreadsheetApp.openById(idPlanilla);
      var hoja = ss.getSheetByName(nombreHoja);

      // Una pestaña que todavía no existe NO es un error: "Historico" puede no
      // haberse creado aún, y por simetría vale al revés. Nunca se la crea desde
      // acá — crearla es responsabilidad exclusiva del proyecto de origen.
      if (!hoja) {
        Logger.log('ℹ️ Asistencia por Brigada: la pestaña "' + nombreHoja +
                   '" no existe todavía. Se continúa con las demás.');
        hojasLeidas++;
        continue;
      }

      var filasHoja = _leerFilasDeHojaAsistencia(hoja, nombreHoja, rutLimpio);
      _guardarFilasEnCache(nombreHoja, rutLimpio, filasHoja);
      filas = filas.concat(filasHoja);
      hojasLeidas++;

    } catch (eHoja) {
      // Un problema en la hoja chica no puede dejar al socio sin sus años de
      // historial, ni al revés. Pero tampoco se oculta: queda en el log.
      fallas.push(nombreHoja + ': ' + eHoja.message);
      Logger.log('❌ Asistencia por Brigada: falló la lectura de la pestaña "' +
                 nombreHoja + '" — ' + eHoja.toString());
    }
  }

  // Ninguna pestaña legible = no hay historial que mostrar y no se sabe por qué:
  // eso sí es el error controlado de la regla 1.3.
  if (hojasLeidas === 0) {
    throw new Error('No se pudo leer ninguna pestaña de Asistencia por Brigada. ' + fallas.join(' | '));
  }

  return _consolidarAsistencia(filas);
}

/**
 * Lee UNA pestaña y devuelve las filas del socio ya mapeadas (todavía sin
 * deduplicar ni agrupar: eso se hace después de unir las dos pestañas).
 *
 * Es el MISMO código para las dos: su estructura es idéntica por diseño.
 */
function _leerFilasDeHojaAsistencia(hoja, nombreHoja, rutLimpio) {
  var ultimaFila = hoja.getLastRow();

  // Una pestaña vacía (sólo encabezados) NO es un error: "Asistencia" queda así
  // después de cada archivado.
  if (ultimaFila <= CFG_ASISTENCIA_BRIGADA.FILA_ENCABEZADO) return [];

  // Verificación del contrato de esquema ANTES de confiar en los datos.
  var encabezados = hoja.getRange(
    CFG_ASISTENCIA_BRIGADA.FILA_ENCABEZADO, 1, 1, CFG_ASISTENCIA_BRIGADA.TOTAL_COLUMNAS
  ).getValues()[0];
  var verificacion = _verificarEncabezados(encabezados);
  if (!verificacion.ok) {
    // Aviso a ADMIN. Hasta ahora esto solo quedaba en el log del servidor: el
    // 31-08-2026 la celda F1 de "Historico" quedo vacia tras el primer
    // archivado y NINGUN socio vio su asistencia durante dias, porque para el
    // socio el sintoma es un historial vacio, indistinguible de no haber
    // asistido nunca. Nadie se entera hasta que alguien reclama.
    _alertarContratoEsquemaRoto(nombreHoja, verificacion.detalle);
    // No se muestran datos posiblemente equivocados, y NO se intenta adivinar el
    // nuevo orden de las columnas: reacomodar los índices por cuenta propia
    // convierte un fallo visible en uno silencioso.
    throw new Error('Los encabezados de la pestaña "' + nombreHoja +
                    '" no calzan con lo esperado. ' + verificacion.detalle);
  }

  // UNA sola llamada getValues() sobre el bloque A..L. Se lee el rango completo
  // de columnas (no columna por columna) porque el costo de la llamada, no el
  // ancho del rango, es lo que pesa en Apps Script.
  // Se usa getValues() y no getDisplayValues() para recibir las fechas como
  // objetos Date reales y no como texto en formato chileno.
  var datos = hoja.getRange(
    CFG_ASISTENCIA_BRIGADA.FILA_ENCABEZADO + 1,
    1,
    ultimaFila - CFG_ASISTENCIA_BRIGADA.FILA_ENCABEZADO,
    CFG_ASISTENCIA_BRIGADA.TOTAL_COLUMNAS
  ).getValues();

  return _mapearFilasAsistencia(datos, rutLimpio);
}

/**
 * Compara la fila de encabezados contra ENCABEZADOS_ESPERADOS.
 * Se compara con trim y sin distinguir mayúsculas: un encabezado no cambia de
 * significado por una mayúscula, y no queremos alarmas falsas.
 *
 * @return {{ok: boolean, detalle: string}}
 */
function _verificarEncabezados(encabezados) {
  var esperados = CFG_ASISTENCIA_BRIGADA.ENCABEZADOS_ESPERADOS;
  var letras = 'ABCDEFGHIJKL';

  for (var i = 0; i < esperados.length; i++) {
    var valor = (encabezados || [])[i];
    var encontrado = String(valor === undefined || valor === null ? '' : valor).trim();
    if (encontrado.toUpperCase() !== esperados[i].toUpperCase()) {
      return {
        ok: false,
        detalle: 'Columna ' + letras.charAt(i) + ' (posición ' + (i + 1) + '): se esperaba "' +
                 esperados[i] + '" y se encontró "' + (encontrado || '(vacío)') + '".'
      };
    }
  }
  return { ok: true, detalle: 'Encabezados A..L correctos.' };
}

/**
 * Mapea las filas crudas de UNA pestaña a la forma interna del módulo,
 * quedándose sólo con las del socio y aplicando las reglas de qué se muestra.
 *
 * Filtra ÚNICAMENTE por RUT (columna B): las filas con estado "ERROR:" pueden
 * traer las columnas F, G y H vacías, porque el socio no estaba en BD_SLIMAPP
 * cuando marcó. No tener nombre ni correo no descalifica una asistencia — ese
 * es justamente el caso de alguien que se afilió hace poco y todavía no estaba
 * en la base cuando asistió.
 */
function _mapearFilasAsistencia(datos, rutLimpio) {
  var COL = CFG_ASISTENCIA_BRIGADA.COL;
  var TZ  = CFG_ASISTENCIA_BRIGADA.ZONA_HORARIA;
  var salida = [];

  for (var i = 0; i < datos.length; i++) {
    var fila = datos[i];

    // El RUT de la columna B viene en formato crudo y variable
    // ("123456785", "12.345.678-5", "12345678-5"): se normalizan AMBOS lados
    // con la misma función del proyecto antes de comparar.
    if (cleanRut(fila[COL.RUT_AFILIADO]) !== rutLimpio) continue;

    var estado = String(fila[COL.ESTADO_NOTIFICACION] || '').trim().toUpperCase();

    // Un DUPLICADO es la misma persona marcando dos veces para la misma
    // actividad: mostrarlo haría creer que asistió varias veces a una asamblea.
    // En "Historico" ya no habrá filas así (el archivado las descarta), pero en
    // "Asistencia" sí las hay mientras la actividad está en curso.
    if (estado.indexOf('DUPLICADO') === 0) continue;

    // Estado vacío = el marcaje existe pero el sistema de origen todavía no lo
    // procesa (tarda hasta ~1 minuto). Es asistencia válida, va como "en proceso".
    // Estado "ERROR:..." = la asistencia SÍ ocurrió; el error es del envío del
    // correo o de los datos del socio, no del marcaje. Se muestra como
    // registrada, sin exponerle nunca el texto técnico.
    var enProceso = (estado === '');

    // La hora del marcaje (C) es el dato preferente; la fecha sin hora (E) es
    // el respaldo si C viniera vacía o ilegible.
    var fechaMarcaje = parsearFechaFlexible(fila[COL.HORA_MARCAJE]) ||
                       parsearFechaFlexible(fila[COL.FECHA]);

    var actividad = String(fila[COL.ACTIVIDAD] || '').trim();

    salida.push({
      id:           String(fila[COL.ID] || '').trim(),
      actividad:    actividad || 'Actividad sindical',
      fechaOrden:   fechaMarcaje ? fechaMarcaje.getTime() : null,
      fecha:        fechaMarcaje ? Utilities.formatDate(fechaMarcaje, TZ, 'dd-MM-yyyy') : '',
      hora:         fechaMarcaje ? Utilities.formatDate(fechaMarcaje, TZ, 'HH:mm') : '',
      claveDia:     fechaMarcaje ? Utilities.formatDate(fechaMarcaje, TZ, 'yyyy-MM-dd') : 'SIN_FECHA',
      via:          _traducirViaRegistro(fila[COL.BRIGADISTA]),
      enProceso:    enProceso
    });
  }

  return salida;
}

/**
 * Toma las filas YA UNIDAS de las dos pestañas y devuelve la lista final:
 * deduplicada por ID, con una sola entrada por actividad y día, ordenada de la
 * más reciente a la más antigua.
 *
 * La agrupación va DESPUÉS de unir las dos pestañas, nunca antes: si se hiciera
 * por separado, una actividad repartida entre las dos hojas aparecería dos veces.
 */
function _consolidarAsistencia(filas) {
  // --- Deduplicación por ID (columna A) ---
  // El archivado copia las filas a "Historico" y recién después las borra de
  // "Asistencia". Si una corrida se interrumpe entre esos dos pasos, la misma
  // fila puede aparecer en AMBAS pestañas por un rato.
  // Como "Historico" se lee primero, quedarse con la PRIMERA aparición de cada
  // ID conserva la copia ya consolidada.
  // Ojo: algunas filas antiguas pueden tener el ID vacío. No se pueden
  // deduplicar por este camino, pero tampoco se descartan: el agrupamiento por
  // actividad y día que viene a continuación las cubre igual.
  var vistos = {};
  var unicas = [];
  for (var i = 0; i < filas.length; i++) {
    var id = filas[i].id;
    if (id) {
      // Prefijo para que un ID como "toString" no choque con el prototipo.
      var claveId = 'id_' + id;
      if (vistos[claveId]) continue;
      vistos[claveId] = true;
    }
    unicas.push(filas[i]);
  }

  // --- Una entrada por actividad y día ---
  // Aunque se omitan los DUPLICADO, pueden quedar varias filas del mismo socio
  // para una misma actividad (por ejemplo, una con error y otra notificada).
  var grupos = {};
  var claves = [];
  for (var j = 0; j < unicas.length; j++) {
    var reg = unicas[j];
    var clave = 'g_' + reg.actividad.toUpperCase() + '||' + reg.claveDia;
    var previo = grupos[clave];

    if (!previo) {
      grupos[clave] = reg;
      claves.push(clave);
      continue;
    }

    // Se conserva el marcaje MÁS ANTIGUO del grupo: ese es el momento real en
    // que el socio llegó.
    var reemplaza = (previo.fechaOrden === null && reg.fechaOrden !== null) ||
                    (previo.fechaOrden !== null && reg.fechaOrden !== null &&
                     reg.fechaOrden < previo.fechaOrden);

    // El grupo queda "en proceso" sólo si TODAS sus filas lo están: basta con
    // que una haya sido procesada para que la asistencia esté confirmada.
    var enProcesoGrupo = previo.enProceso && reg.enProceso;

    if (reemplaza) grupos[clave] = reg;
    grupos[clave].enProceso = enProcesoGrupo;
  }

  var registros = [];
  for (var k = 0; k < claves.length; k++) {
    var g = grupos[claves[k]];
    // Se entrega sólo lo que el socio debe ver. El ID del marcaje, la clave de
    // día y —sobre todo— de qué pestaña salió el registro son detalles internos:
    // para el socio es UN solo historial.
    registros.push({
      actividad:  g.actividad,
      fecha:      g.fecha,
      hora:       g.hora,
      via:        g.via,
      enProceso:  g.enProceso,
      fechaOrden: g.fechaOrden
    });
  }

  // De la asistencia más reciente a la más antigua. Las que no tienen fecha
  // legible se van al final en vez de encabezar la lista.
  registros.sort(function(a, b) {
    if (a.fechaOrden === null && b.fechaOrden === null) return 0;
    if (a.fechaOrden === null) return 1;
    if (b.fechaOrden === null) return -1;
    return b.fechaOrden - a.fechaOrden;
  });

  return registros;
}

/**
 * Traduce la columna D (Brigadista) al texto que ve el socio.
 * Si el valor es un correo, corresponde a un escaneo presencial: se informa la
 * vía, pero NUNCA el correo del brigadista.
 */
function _traducirViaRegistro(valorCrudo) {
  var valor = String(valorCrudo || '').trim();
  if (!valor) return 'Registro sindical';

  var valorMayus = valor.toUpperCase();
  if (valorMayus === CFG_ASISTENCIA_BRIGADA.VIA.MANUAL)     return 'Registro manual';
  if (valorMayus === CFG_ASISTENCIA_BRIGADA.VIA.FORMULARIO) return 'Formulario virtual';
  if (valor.indexOf('@') !== -1)                            return 'Presencial (brigadista)';

  // Valor no previsto: se responde algo genérico en vez de filtrar texto interno.
  return 'Registro sindical';
}

// ------------------------------------------
// Caché por pestaña y por RUT
// ------------------------------------------
// Nunca una clave global: cada entrada contiene sólo las filas de UN socio de
// UNA pestaña, para que no exista forma de servirle a uno lo del otro.

function _claveCacheAsistencia(nombreHoja, rutLimpio) {
  return CFG_ASISTENCIA_BRIGADA.CACHE_PREFIJO + nombreHoja + '_' + rutLimpio;
}

/** Devuelve las filas cacheadas de esa pestaña para ese RUT, o null si no hay. */
function _leerFilasDesdeCache(nombreHoja, rutLimpio) {
  try {
    var crudo = CacheService.getScriptCache().get(_claveCacheAsistencia(nombreHoja, rutLimpio));
    return crudo ? JSON.parse(crudo) : null;
  } catch (e) {
    Logger.log('⚠️ Caché de asistencia ilegible ("' + nombreHoja + '"), se relee la planilla — ' + e.toString());
    return null;
  }
}

function _guardarFilasEnCache(nombreHoja, rutLimpio, filas) {
  try {
    var ttl = CFG_ASISTENCIA_BRIGADA.CACHE_SEGUNDOS_POR_HOJA[nombreHoja] ||
              CFG_ASISTENCIA_BRIGADA.CACHE_SEGUNDOS_DEFECTO;
    CacheService.getScriptCache().put(
      _claveCacheAsistencia(nombreHoja, rutLimpio), JSON.stringify(filas), ttl);
  } catch (e) {
    // Un historial muy largo puede superar el límite por entrada de CacheService.
    // No es motivo para fallar: simplemente se releerá la planilla la próxima vez.
    Logger.log('⚠️ No se pudo cachear el historial de asistencia ("' + nombreHoja + '") — ' + e.toString());
  }
}

// ------------------------------------------
// Alerta de contrato de esquema roto
// ------------------------------------------

/**
 * Avisa a ADMIN que una pestaña de la planilla externa dejó de calzar con el
 * contrato de 12 columnas.
 *
 * NUNCA LANZA y NUNCA BLOQUEA: se la llama desde la consulta de un socio, y el
 * envío de un correo no puede impedirle ver lo que sí se pudo leer.
 *
 * THROTTLE OBLIGATORIO. Esta ruta se ejecuta en CADA consulta de CADA socio:
 * sin freno, una hoja rota generaría un correo por visita — cientos en una
 * tarde de asamblea. Se avisa como máximo una vez cada 6 horas por pestaña
 * (el máximo que admite CacheService), que basta para enterarse el mismo día
 * sin inundar la casilla.
 */
function _alertarContratoEsquemaRoto(nombreHoja, detalle) {
  try {
    var cache = CacheService.getScriptCache();
    var clave = 'alerta_esquema_' + nombreHoja;

    // ¿Ya se avisó hace poco? Entonces solo al log y se sigue.
    if (cache.get(clave)) {
      Logger.log('ℹ️ Contrato roto en "' + nombreHoja + '", pero ya se avisó a ADMIN en las últimas 6 h.');
      return;
    }

    var destinatarios = [];
    try { destinatarios = obtenerCorreosAdmin() || []; } catch (eA) {}
    if (!destinatarios.length && CONFIG.CORREOS && CONFIG.CORREOS.ADMIN) {
      destinatarios = [CONFIG.CORREOS.ADMIN];
    }
    if (!destinatarios.length) {
      Logger.log('⚠️ Contrato roto en "' + nombreHoja + '" y no hay correo ADMIN al que avisar.');
      return;
    }

    // Se marca ANTES de enviar: enviarCorreoEstilizadoConCopia se traga sus
    // propios errores, así que si el envío falla no hay forma de saberlo. Es
    // preferible perder un aviso a mandar cientos.
    cache.put(clave, '1', 21600);

    var detalles = {
      'Planilla':       'ASISTENCIA POR BRIGADA (sistema externo)',
      'Pestaña':        nombreHoja,
      'Problema':       detalle,
      'Efecto':         'Los socios no ven las asistencias de esa pestaña. Para ellos el historial aparece vacío.',
      'Cómo se corrige': 'Revisar la fila 1 de esa pestaña y dejar los 12 encabezados A..L exactamente como en la pestaña "Asistencia".',
      'Detectado':      formatearFechaConHora(new Date())
    };

    enviarCorreoEstilizadoConCopia(
      destinatarios,
      [],
      '⚠️ SLIMAPP: la planilla de Asistencia por Brigada cambió de estructura',
      'Los encabezados no calzan',
      'SLIMAPP dejó de leer una pestaña de la planilla de Asistencia por Brigada porque sus ' +
      'encabezados ya no coinciden con los esperados. No se muestran datos posiblemente ' +
      'equivocados: se prefiere no mostrar nada antes que atribuirle a un socio la información ' +
      'de otra columna. Mientras no se corrija, los socios verán su historial de asistencia ' +
      'incompleto o vacío.',
      detalles,
      '#DC2626'
    );

    Logger.log('📧 Aviso de contrato roto enviado a ADMIN — pestaña "' + nombreHoja + '".');

  } catch (e) {
    // Un fallo acá jamás puede afectar la consulta del socio.
    Logger.log('⚠️ _alertarContratoEsquemaRoto: ' + e.toString());
  }
}

// ==========================================
// DIAGNÓSTICO (ejecutar a mano desde el editor GAS)
// ==========================================

/**
 * Revisa, paso a paso, por qué la lectura de "Asistencia por Brigada" no está
 * devolviendo registros. Recorre LAS DOS pestañas y verifica sus encabezados con
 * la MISMA función que usa la lectura real (_verificarEncabezados), para que no
 * existan dos comprobaciones capaces de desalinearse.
 *
 * Ejecutar desde el editor de Apps Script (Ejecutar > _diagnosticarAsistenciaBrigada)
 * y leer el Registro de ejecución.
 *
 * No recibe parámetros a propósito: el webapp es ANYONE_ANONYMOUS y una función
 * de diagnóstico con RUT libre sería una forma de consultar la asistencia ajena.
 * Para probar el cruce de un RUT puntual, crear en Configuración del proyecto la
 * propiedad RUT_DIAGNOSTICO_ASISTENCIA con ese RUT, ejecutar, y BORRARLA después.
 * Sin esa propiedad la función no revela ningún dato de personas.
 */
function _diagnosticarAsistenciaBrigada() {
  _ensureConfig();
  var log = [];
  log.push('===== DIAGNÓSTICO ASISTENCIA POR BRIGADA =====');

  try {
    // 1. ¿Está configurado el ID de la planilla en ESTE proyecto?
    var idPlanilla = CONFIG.SPREADSHEETS.ASISTENCIA_BRIGADA;
    log.push('1) SS_ASISTENCIA_BRIGADA: ' + (idPlanilla || '❌ VACÍO — ejecuta _configurarPropiedadesAsistencia() en este proyecto'));
    if (!idPlanilla) { Logger.log(log.join('\n')); return log.join('\n'); }

    // 2. ¿Se puede abrir la planilla con la cuenta que ejecuta?
    var ss = SpreadsheetApp.openById(idPlanilla);
    log.push('2) Planilla abierta: "' + ss.getName() + '" ✅');

    // 3. ¿Cómo se llaman REALMENTE las pestañas? (la causa más típica del vacío silencioso)
    var nombres = ss.getSheets().map(function(h) { return '"' + h.getName() + '"'; });
    log.push('3) Pestañas existentes: ' + nombres.join(', '));
    log.push('   Pestañas que busca el código: ' + CFG_ASISTENCIA_BRIGADA.HOJAS_A_LEER.join(', '));

    var rutDiag = PropertiesService.getScriptProperties().getProperty('RUT_DIAGNOSTICO_ASISTENCIA');
    var rutLimpio = rutDiag ? cleanRut(rutDiag) : '';
    var COL = CFG_ASISTENCIA_BRIGADA.COL;

    // 4. Revisión completa POR PESTAÑA, con el mismo criterio de la lectura real.
    CFG_ASISTENCIA_BRIGADA.HOJAS_A_LEER.forEach(function(nombreHoja) {
      log.push('---- Pestaña "' + nombreHoja + '" ----');
      var hoja = ss.getSheetByName(nombreHoja);
      if (!hoja) {
        log.push('   ⚠️ No existe. No es un error: el módulo sigue con la otra pestaña.');
        return;
      }

      var ultimaFila = hoja.getLastRow();
      log.push('   Última fila con datos: ' + ultimaFila +
               ' (encabezado en la fila ' + CFG_ASISTENCIA_BRIGADA.FILA_ENCABEZADO + ')');
      if (ultimaFila <= CFG_ASISTENCIA_BRIGADA.FILA_ENCABEZADO) {
        log.push('   ℹ️ Sin filas de datos. Normal en "Asistencia" después de archivar.');
        return;
      }

      var encabezados = hoja.getRange(
        CFG_ASISTENCIA_BRIGADA.FILA_ENCABEZADO, 1, 1, CFG_ASISTENCIA_BRIGADA.TOTAL_COLUMNAS
      ).getValues()[0];
      log.push('   Encabezados A..L: ' + encabezados.join(' | '));

      var verificacion = _verificarEncabezados(encabezados);
      log.push('   Contrato de esquema: ' + (verificacion.ok ? '✅ ' : '❌ ') + verificacion.detalle);
      if (!verificacion.ok) {
        log.push('   ⚠️ Con los encabezados así, el módulo NO muestra los datos de esta pestaña (a propósito).');
        return;
      }

      if (!rutLimpio) {
        log.push('   Sin RUT_DIAGNOSTICO_ASISTENCIA: se omite la prueba de cruce de RUT.');
        return;
      }

      var datos = hoja.getRange(
        CFG_ASISTENCIA_BRIGADA.FILA_ENCABEZADO + 1, 1,
        ultimaFila - CFG_ASISTENCIA_BRIGADA.FILA_ENCABEZADO,
        CFG_ASISTENCIA_BRIGADA.TOTAL_COLUMNAS
      ).getValues();

      var coincidencias = 0;
      for (var i = 0; i < datos.length; i++) {
        if (cleanRut(datos[i][COL.RUT_AFILIADO]) !== rutLimpio) continue;
        coincidencias++;
        log.push('   fila ' + (i + 2) +
                 ' | ID A: "' + String(datos[i][COL.ID] || '(vacío)') + '"' +
                 ' | estado K: "' + String(datos[i][COL.ESTADO_NOTIFICACION] || '(vacío)') + '"' +
                 ' | actividad L: "' + String(datos[i][COL.ACTIVIDAD] || '(vacía)') + '"' +
                 ' | hora C: ' + datos[i][COL.HORA_MARCAJE]);
      }
      log.push('   Filas que cruzan con ese RUT: ' + coincidencias + ' de ' + datos.length);

      // Se limpia la caché de esta pestaña para que el resultado final refleje
      // la planilla de ahora y no algo guardado hace un rato.
      try { CacheService.getScriptCache().remove(_claveCacheAsistencia(nombreHoja, rutLimpio)); } catch (eC) {}
    });

    if (!rutLimpio) {
      log.push('5) Sin RUT_DIAGNOSTICO_ASISTENCIA: no se ejecuta la consulta final.');
      Logger.log(log.join('\n'));
      return log.join('\n');
    }

    log.push('5) RUT de prueba: "' + rutDiag + '" → normalizado: "' + rutLimpio + '"');
    var resultado = _leerAsistenciaBrigadaPorRut(rutLimpio);
    log.push('6) Registros que devolvería el módulo (unidas las dos pestañas, deduplicadas por ID ' +
             'y agrupadas por actividad y día): ' + resultado.length);
    log.push('   ' + JSON.stringify(resultado));
    log.push('   ⚠️ Recuerda BORRAR la propiedad RUT_DIAGNOSTICO_ASISTENCIA al terminar.');

  } catch (e) {
    log.push('❌ EXCEPCIÓN: ' + e.toString());
  }

  Logger.log(log.join('\n'));
  return log.join('\n');
}

/**
 * DIAGNÓSTICO DE DUPLICADOS DEL ARCHIVADO (solo lectura).
 *
 * Responde una pregunta concreta: cuando el sistema de asistencia archiva una
 * actividad, ¿por qué aparecen socios repetidos en "Historico"? Hay dos causas
 * posibles y se corrigen en lugares distintos, así que lo primero es separarlas:
 *
 *   A) MISMO ID repetido → el archivado copió la misma fila dos veces (corrió
 *      dos veces, o se interrumpió entre copiar y borrar y se reintentó). El
 *      defecto está en el proyecto del sistema de asistencia, no acá.
 *   B) MISMO RUT con IDs distintos → son dos marcajes reales de la persona
 *      (presencial + formulario, dos brigadistas, doble envío del formulario).
 *      El archivado hizo lo suyo; lo que faltó fue marcar el segundo como
 *      DUPLICADO en la columna K, que es lo que el portal usa para ocultarlo.
 *
 * Además avisa si una fila quedó en las DOS pestañas (copiada y no borrada),
 * que es el rastro de un archivado interrumpido.
 *
 * ⛔ No escribe una sola celda: la planilla es de otro proyecto (ver regla 1.1).
 *
 * Ejecutar desde el editor (Ejecutar > _diagnosticarDuplicadosArchivadoBrigada)
 * y leer el Registro de ejecución. No recibe parámetros: el webapp es
 * ANYONE_ANONYMOUS y una global con argumentos libres sería una consulta de
 * asistencia ajena. Por lo mismo el detalle sale con el RUT enmascarado y lo que
 * retorna es solo un resumen sin datos de personas; para ver los RUT completos,
 * crear la propiedad DETALLE_DUPLICADOS_BRIGADA con valor "1", ejecutar, y
 * BORRARLA después.
 */
function _diagnosticarDuplicadosArchivadoBrigada() {
  _ensureConfig();
  var log = [];
  var resumen = [];
  log.push('===== DUPLICADOS DEL ARCHIVADO — ASISTENCIA POR BRIGADA =====');

  try {
    var idPlanilla = CONFIG.SPREADSHEETS.ASISTENCIA_BRIGADA;
    if (!idPlanilla) {
      Logger.log('❌ SS_ASISTENCIA_BRIGADA vacío — ejecuta _configurarPropiedadesAsistencia() en este proyecto.');
      return 'SS_ASISTENCIA_BRIGADA sin configurar';
    }

    var verDetalle = PropertiesService.getScriptProperties()
                       .getProperty('DETALLE_DUPLICADOS_BRIGADA') === '1';
    var ss  = SpreadsheetApp.openById(idPlanilla);
    var COL = CFG_ASISTENCIA_BRIGADA.COL;
    var TZ  = CFG_ASISTENCIA_BRIGADA.ZONA_HORARIA;

    // --- Lectura cruda de las dos pestañas -------------------------------
    // Se leen tal cual, sin filtrar por RUT ni por estado: el objetivo es ver
    // lo que hay en la planilla, no lo que el portal muestra.
    var porHoja = {};
    CFG_ASISTENCIA_BRIGADA.HOJAS_A_LEER.forEach(function(nombreHoja) {
      porHoja[nombreHoja] = [];
      var hoja = ss.getSheetByName(nombreHoja);
      if (!hoja) { log.push('⚠️ Pestaña "' + nombreHoja + '": no existe.'); return; }

      var ultimaFila = hoja.getLastRow();
      if (ultimaFila <= CFG_ASISTENCIA_BRIGADA.FILA_ENCABEZADO) {
        log.push('ℹ️ Pestaña "' + nombreHoja + '": sin filas de datos.');
        return;
      }

      // El contrato de esquema se revisa con la MISMA función de la lectura
      // real: si el archivado volvió a dejar un encabezado en blanco (ya pasó
      // con F1 el 31/08/2026), este diagnóstico tiene que decirlo primero,
      // porque en ese estado el portal no muestra nada de esa pestaña.
      var encabezados = hoja.getRange(
        CFG_ASISTENCIA_BRIGADA.FILA_ENCABEZADO, 1, 1, CFG_ASISTENCIA_BRIGADA.TOTAL_COLUMNAS
      ).getValues()[0];
      var verificacion = _verificarEncabezados(encabezados);
      log.push('Pestaña "' + nombreHoja + '": ' + (ultimaFila - CFG_ASISTENCIA_BRIGADA.FILA_ENCABEZADO) +
               ' filas | encabezados ' + (verificacion.ok ? '✅' : '❌ ' + verificacion.detalle));

      var datos = hoja.getRange(
        CFG_ASISTENCIA_BRIGADA.FILA_ENCABEZADO + 1, 1,
        ultimaFila - CFG_ASISTENCIA_BRIGADA.FILA_ENCABEZADO,
        CFG_ASISTENCIA_BRIGADA.TOTAL_COLUMNAS
      ).getValues();

      for (var i = 0; i < datos.length; i++) {
        var f = datos[i];
        porHoja[nombreHoja].push({
          hoja:      nombreHoja,
          fila:      i + CFG_ASISTENCIA_BRIGADA.FILA_ENCABEZADO + 1,
          id:        String(f[COL.ID] || '').trim(),
          rut:       cleanRut(f[COL.RUT_AFILIADO]),
          hora:      f[COL.HORA_MARCAJE],
          via:       String(f[COL.BRIGADISTA] || '').trim(),
          estado:    String(f[COL.ESTADO_NOTIFICACION] || '').trim(),
          actividad: String(f[COL.ACTIVIDAD] || '').trim()
        });
      }
    });

    var historico = porHoja['Historico'] || [];
    var enCurso   = porHoja['Asistencia'] || [];
    var todas     = historico.concat(enCurso);
    if (!todas.length) {
      log.push('Sin filas que revisar.');
      Logger.log(log.join('\n'));
      return 'sin filas';
    }

    // --- Inventario por actividad ----------------------------------------
    // Se listan todas, no solo el último archivado: si una actividad anterior
    // no tiene duplicados y la nueva sí, eso ya acota cuándo empezó.
    var porActividad = {};
    todas.forEach(function(r) {
      var k = r.actividad || '(sin actividad)';
      if (!porActividad[k]) porActividad[k] = { filas: 0, ruts: {}, hojas: {} };
      porActividad[k].filas++;
      porActividad[k].ruts[r.rut] = true;
      porActividad[k].hojas[r.hoja] = (porActividad[k].hojas[r.hoja] || 0) + 1;
    });
    log.push('');
    log.push('--- Actividades presentes (filas vs. personas distintas) ---');
    Object.keys(porActividad).forEach(function(k) {
      var a = porActividad[k];
      var personas = Object.keys(a.ruts).length;
      var sobra = a.filas - personas;
      log.push('  ' + a.filas + ' filas / ' + personas + ' personas' +
               (sobra > 0 ? '  ⚠️ ' + sobra + ' fila(s) de más' : '  ✅') +
               ' | ' + JSON.stringify(a.hojas) + ' | ' + k);
    });

    // --- A) Mismo ID repetido --------------------------------------------
    var porId = {};
    todas.forEach(function(r) {
      if (!r.id) return;   // las filas antiguas sin ID se revisan aparte
      (porId[r.id] = porId[r.id] || []).push(r);
    });
    var idsRepetidos = Object.keys(porId).filter(function(id) { return porId[id].length > 1; });

    log.push('');
    log.push('--- A) Mismo ID repetido → el archivado copió dos veces ---');
    log.push('  Casos: ' + idsRepetidos.length);
    idsRepetidos.slice(0, 40).forEach(function(id) {
      var g = porId[id];
      var hojas = g.map(function(r) { return r.hoja + ':' + r.fila; }).join(' , ');
      var cruzado = g.some(function(r) { return r.hoja === 'Historico'; }) &&
                    g.some(function(r) { return r.hoja === 'Asistencia'; });
      log.push('  ID ' + id + ' ×' + g.length + ' [' + hojas + ']' +
               (cruzado ? '  ← quedó en las DOS pestañas: archivado interrumpido entre copiar y borrar' : '') +
               ' | ' + _rutParaLog_(g[0].rut, verDetalle) + ' | ' + g[0].actividad);
    });
    if (idsRepetidos.length > 40) log.push('  … y ' + (idsRepetidos.length - 40) + ' más.');

    // --- B) Mismo RUT + actividad con IDs distintos -----------------------
    var porRutActividad = {};
    todas.forEach(function(r) {
      var k = r.rut + '||' + r.actividad;
      (porRutActividad[k] = porRutActividad[k] || []).push(r);
    });
    var repetidosPersona = Object.keys(porRutActividad).filter(function(k) {
      return porRutActividad[k].length > 1;
    });

    var sinMarcaDuplicado = 0;
    var mismaHoraExacta   = 0;
    log.push('');
    log.push('--- B) Mismo RUT en la misma actividad, con IDs distintos ---');
    log.push('  Casos: ' + repetidosPersona.length);
    repetidosPersona.slice(0, 12).forEach(function(k) {
      var g = porRutActividad[k].slice().sort(function(a, b) {
        return _msMarcaje_(a.hora) - _msMarcaje_(b.hora);
      });

      // Sin una marca DUPLICADO en K, el portal le muestra al socio las dos
      // filas: ese es el síntoma que ve el socio.
      var conMarca = g.filter(function(r) {
        return r.estado.toUpperCase().indexOf('DUPLICADO') === 0;
      }).length;
      if (conMarca < g.length - 1) sinMarcaDuplicado++;

      var ms = g.map(function(r) { return _msMarcaje_(r.hora); })
                .filter(function(v) { return !!v; });
      var iguales = ms.length > 1 && ms[0] === ms[ms.length - 1];
      if (iguales) mismaHoraExacta++;
      var separacion = (ms.length > 1)
        ? Math.round((ms[ms.length - 1] - ms[0]) / 1000) + ' s entre el primero y el último'
        : 'sin hora comparable';

      log.push('  ' + _rutParaLog_(g[0].rut, verDetalle) + ' ×' + g.length +
               ' | ' + separacion + (iguales ? '  ← hora IDÉNTICA: reproceso, no dos marcajes' : '') +
               ' | marcadas DUPLICADO: ' + conMarca + ' de ' + (g.length - 1) + ' esperadas' +
               ' | ' + g[0].actividad);
      g.forEach(function(r) {
        log.push('      ' + r.hoja + ':' + r.fila +
                 ' | ID "' + (r.id || '(vacío)') + '"' +
                 ' | ' + _horaParaLog_(r.hora, TZ) +
                 ' | vía "' + r.via + '"' +
                 ' | K "' + (r.estado || '(vacío)') + '"');
      });
    });
    if (repetidosPersona.length > 12) log.push('  … y ' + (repetidosPersona.length - 12) + ' más (el registro de ejecución trunca los logs largos).');

    // --- Filas sin ID ------------------------------------------------------
    var sinId = todas.filter(function(r) { return !r.id; });
    log.push('');
    log.push('--- Filas sin ID (columna A vacía) ---');
    log.push('  ' + sinId.length + ' fila(s). Sin ID, el portal no puede deduplicarlas por ID: ' +
             'solo las salva la agrupación por actividad y día.');

    // --- Lectura para el socio --------------------------------------------
    log.push('');
    log.push('--- Qué llega a ver el socio ---');
    log.push('  El portal oculta las filas cuyo estado K empieza con DUPLICADO y agrupa por ' +
             'actividad + día quedándose con el marcaje más temprano. Por eso un duplicado ' +
             'del MISMO día no se le nota al socio, pero sí distorsiona cualquier conteo ' +
             'hecho sobre la planilla (asistentes por asamblea, descuentos, informes).');

    resumen.push('actividades: ' + Object.keys(porActividad).length);
    resumen.push('IDs repetidos: ' + idsRepetidos.length);
    resumen.push('RUT repetidos en una actividad: ' + repetidosPersona.length);
    resumen.push('de esos, sin marca DUPLICADO suficiente: ' + sinMarcaDuplicado);
    resumen.push('de esos, con hora idéntica: ' + mismaHoraExacta);
    resumen.push('filas sin ID: ' + sinId.length);

    log.push('');
    log.push('===== RESUMEN: ' + resumen.join(' | ') + ' =====');
    if (verDetalle) log.push('⚠️ Recuerda BORRAR la propiedad DETALLE_DUPLICADOS_BRIGADA.');

  } catch (e) {
    log.push('❌ EXCEPCIÓN: ' + e.toString());
    resumen.push('excepción: ' + e.message);
  }

  Logger.log(log.join('\n'));
  // Se retorna SOLO el resumen: el detalle queda en el registro de ejecución,
  // que el visitante anónimo del webapp no puede leer.
  return resumen.join(' | ');
}

/** RUT enmascarado salvo que se pida el detalle explícitamente. */
function _rutParaLog_(rut, verDetalle) {
  if (verDetalle) return rut;
  var r = String(rut || '');
  return r.length > 4 ? r.substring(0, 3) + '*****' + r.substring(r.length - 1) : '****';
}

/** Milisegundos del marcaje, tolerando Date o texto en formato chileno. */
function _msMarcaje_(valor) {
  var d = parsearFechaFlexible(valor);
  return d ? d.getTime() : 0;
}

/** Fecha y hora legible del marcaje; si no se puede parsear, se muestra cruda. */
function _horaParaLog_(valor, tz) {
  var d = parsearFechaFlexible(valor);
  return d ? Utilities.formatDate(d, tz, 'dd/MM/yyyy HH:mm:ss') : '(' + String(valor) + ')';
}

/**
 * CRONOLOGÍA DEL ARCHIVADO (solo lectura).
 *
 * Complemento de _diagnosticarDuplicadosArchivadoBrigada(). Aquel dice QUÉ filas
 * están repetidas; esta dice CUÁNDO entraron, que es lo que separa las dos
 * explicaciones posibles de un duplicado no detectado:
 *
 *   H1) El archivado corrió con la actividad todavía abierta. Al vaciarse
 *       "Asistencia", el marcaje anterior dejó de estar a la vista y el marcaje
 *       rezagado entró como si fuera el primero.
 *   H2) El archivado corrió una sola vez, al final, y el detector de duplicados
 *       compara por RUT + actividad + DÍA en vez de RUT + actividad: dos días
 *       distintos de la misma asamblea le parecen dos asistencias legítimas.
 *
 * Lo que las distingue es si hubo UNA o VARIAS tandas de migración, y en qué
 * fechas. Por eso acá se recorren también las pestañas de control de la planilla
 * (la de migración lleva su propia marca temporal por fila).
 *
 * ⛔ No escribe una sola celda: la planilla es de otro proyecto (ver regla 1.1).
 *
 * Ejecutar desde el editor (Ejecutar > _diagnosticarCronologiaArchivadoBrigada).
 * Sin parámetros y sin datos de personas en la salida: todo lo que reporta son
 * conteos por fecha.
 */
function _diagnosticarCronologiaArchivadoBrigada() {
  _ensureConfig();
  var log = [];
  log.push('===== CRONOLOGÍA DEL ARCHIVADO — ASISTENCIA POR BRIGADA =====');

  try {
    var idPlanilla = CONFIG.SPREADSHEETS.ASISTENCIA_BRIGADA;
    if (!idPlanilla) {
      Logger.log('❌ SS_ASISTENCIA_BRIGADA vacío.');
      return 'sin configurar';
    }
    var ss  = SpreadsheetApp.openById(idPlanilla);
    var TZ  = CFG_ASISTENCIA_BRIGADA.ZONA_HORARIA;
    var COL = CFG_ASISTENCIA_BRIGADA.COL;

    // --- 1. Inventario de TODAS las pestañas -----------------------------
    // El módulo solo lee dos, pero el archivado lo gobiernan las de control, y
    // desde acá no se sabe cómo se llaman: se listan y se identifican por sus
    // encabezados, no por su nombre.
    log.push('');
    log.push('--- 1) Pestañas de la planilla ---');
    var hojas = ss.getSheets();
    var hojaMigracion = null;
    var encMigracion = null;
    hojas.forEach(function(h) {
      var nombre = h.getName();
      var ultimaFila = h.getLastRow();
      var ultimaCol  = h.getLastColumn();
      var enc = [];
      if (ultimaFila >= 1 && ultimaCol >= 1) {
        enc = h.getRange(1, 1, 1, ultimaCol).getValues()[0].map(function(v) {
          return String(v || '').trim();
        });
      }
      log.push('  "' + nombre + '" — ' + Math.max(0, ultimaFila - 1) + ' filas | ' + enc.join(' | '));

      var encUpper = enc.map(function(v) { return v.toUpperCase(); });
      if (encUpper.indexOf('ESTADO_MIGRACION') !== -1) {
        hojaMigracion = h;
        encMigracion  = encUpper;
      }
    });

    // --- 2. Tandas de migración -------------------------------------------
    // Cada fila de esa pestaña lleva la marca temporal de cuándo se migró. Si
    // todas caen en un mismo momento, el archivado corrió una sola vez (H2); si
    // hay dos grupos separados por días, corrió con la actividad abierta (H1).
    log.push('');
    log.push('--- 2) Tandas de migración ---');
    if (!hojaMigracion) {
      log.push('  No se encontró una pestaña con la columna Estado_Migracion.');
    } else {
      var iMarca  = encMigracion.indexOf('MARCA TEMPORAL');
      var iEstado = encMigracion.indexOf('ESTADO_MIGRACION');
      var ultima  = hojaMigracion.getLastRow();
      if (ultima < 2 || iMarca === -1) {
        log.push('  Pestaña "' + hojaMigracion.getName() + '" sin filas o sin marca temporal.');
      } else {
        var datosMig = hojaMigracion.getRange(2, 1, ultima - 1, hojaMigracion.getLastColumn()).getValues();
        var porMinuto = {};
        var estados = {};
        datosMig.forEach(function(f) {
          var d = parsearFechaFlexible(f[iMarca]);
          var k = d ? Utilities.formatDate(d, TZ, 'dd/MM/yyyy HH:mm') : '(sin fecha)';
          porMinuto[k] = (porMinuto[k] || 0) + 1;
          var e = iEstado !== -1 ? String(f[iEstado] || '(vacío)').trim() : '-';
          estados[e] = (estados[e] || 0) + 1;
        });
        log.push('  Pestaña "' + hojaMigracion.getName() + '": ' + datosMig.length + ' filas | estados ' + JSON.stringify(estados));
        log.push('  Filas migradas por minuto (solo los minutos con actividad):');
        Object.keys(porMinuto).sort().forEach(function(k) {
          log.push('    ' + k + '  →  ' + porMinuto[k]);
        });
      }
    }

    // --- 3. Historico: qué días de marcaje tiene cada actividad -----------
    // Un duplicado a 7 días de distancia dentro de la MISMA asamblea solo puede
    // existir si la actividad aceptó marcajes varios días. Acá se ve cuántos
    // días abarcó cada una y por qué vía llegó cada día.
    log.push('');
    log.push('--- 3) Días de marcaje por actividad (pestaña Historico) ---');
    var hojaHist = ss.getSheetByName('Historico');
    if (!hojaHist || hojaHist.getLastRow() < 2) {
      log.push('  Sin datos en "Historico".');
    } else {
      var datos = hojaHist.getRange(
        2, 1, hojaHist.getLastRow() - 1, CFG_ASISTENCIA_BRIGADA.TOTAL_COLUMNAS
      ).getValues();

      var mapa = {};
      for (var i = 0; i < datos.length; i++) {
        var act = String(datos[i][COL.ACTIVIDAD] || '(sin actividad)').trim();
        var d   = parsearFechaFlexible(datos[i][COL.HORA_MARCAJE]);
        var dia = d ? Utilities.formatDate(d, TZ, 'dd/MM/yyyy') : '(sin fecha)';
        var via = String(datos[i][COL.BRIGADISTA] || '(vacía)').trim();
        // La vía que importa es si fue un brigadista (una cuenta de correo) o un
        // canal automático; el correo concreto no aporta al diagnóstico.
        var tipoVia = (via.indexOf('@') !== -1) ? 'BRIGADISTA (presencial)' : via;

        if (!mapa[act]) mapa[act] = {};
        if (!mapa[act][dia]) mapa[act][dia] = { total: 0, vias: {}, filaMin: i + 2, filaMax: i + 2 };
        var celda = mapa[act][dia];
        celda.total++;
        celda.vias[tipoVia] = (celda.vias[tipoVia] || 0) + 1;
        celda.filaMin = Math.min(celda.filaMin, i + 2);
        celda.filaMax = Math.max(celda.filaMax, i + 2);
      }

      Object.keys(mapa).forEach(function(act) {
        var dias = Object.keys(mapa[act]).sort(function(a, b) {
          var da = parsearFechaFlexible(a), db = parsearFechaFlexible(b);
          return (da ? da.getTime() : 0) - (db ? db.getTime() : 0);
        });
        log.push('  ▸ ' + act + '  (' + dias.length + ' día(s) de marcaje)');
        dias.forEach(function(dia) {
          var c = mapa[act][dia];
          log.push('      ' + dia + ' | ' + c.total + ' marcajes | filas ' +
                   c.filaMin + '–' + c.filaMax + ' | ' + JSON.stringify(c.vias));
        });
      });
    }

  } catch (e) {
    log.push('❌ EXCEPCIÓN: ' + e.toString());
  }

  Logger.log(log.join('\n'));
  return 'ver Registro de ejecución';
}

/**
 * ÍNDICE "YA NOTIFICADO" vs. MARCAJES REALES (solo lectura).
 *
 * Tercer y último paso del diagnóstico. Los dos anteriores dejaron el problema
 * acotado a un mecanismo: la marca "DUPLICADO: ya notificado en esta actividad"
 * funcionó en agosto y no marcó ninguno de los 64 casos de septiembre. Esa marca
 * necesita un índice de a quién ya se le notificó, y la pestaña "REVISION"
 * (RUT | LISTADO) es la candidata.
 *
 * Lo que se comprueba acá es de QUIÉN son esos RUT:
 *
 *   - Si el índice trae los marcajes de una vía y no de otra (por ejemplo, los
 *     del formulario sí y los del brigadista presencial no), entonces el socio
 *     que marcó presencial no figura como notificado, y su marcaje posterior por
 *     otra vía entra como si fuera el primero. Eso explica los 64 casos.
 *   - Si el índice quedó con los RUT de la actividad ANTERIOR, el problema es
 *     que no se reinicia al abrir una actividad nueva.
 *
 * ⛔ No escribe una sola celda: la planilla es de otro proyecto (ver regla 1.1).
 *
 * Ejecutar desde el editor (Ejecutar > _diagnosticarIndiceNotificadosBrigada).
 * Sin parámetros; la salida son conteos, sin datos de personas.
 */
function _diagnosticarIndiceNotificadosBrigada() {
  _ensureConfig();
  var log = [];
  log.push('===== ÍNDICE "YA NOTIFICADO" (REVISION) vs. MARCAJES =====');

  try {
    var idPlanilla = CONFIG.SPREADSHEETS.ASISTENCIA_BRIGADA;
    if (!idPlanilla) { Logger.log('❌ SS_ASISTENCIA_BRIGADA vacío.'); return 'sin configurar'; }

    var ss  = SpreadsheetApp.openById(idPlanilla);
    var TZ  = CFG_ASISTENCIA_BRIGADA.ZONA_HORARIA;
    var COL = CFG_ASISTENCIA_BRIGADA.COL;

    // --- Índice de notificados --------------------------------------------
    var hojaRev = ss.getSheetByName('REVISION');
    if (!hojaRev || hojaRev.getLastRow() < 2) {
      log.push('No hay pestaña "REVISION" con datos.');
      Logger.log(log.join('\n'));
      return 'sin REVISION';
    }
    var filasRev = hojaRev.getRange(2, 1, hojaRev.getLastRow() - 1, hojaRev.getLastColumn()).getValues();
    var indice = {};
    var repetidosEnIndice = 0;
    filasRev.forEach(function(f) {
      var r = cleanRut(f[0]);
      if (!r) return;
      if (indice[r]) repetidosEnIndice++;
      indice[r] = true;
    });
    log.push('REVISION: ' + filasRev.length + ' filas | ' + Object.keys(indice).length +
             ' RUT distintos | ' + repetidosEnIndice + ' repetido(s) dentro del propio índice');

    // --- Marcajes por actividad, y cuántos de ellos figuran en el índice ---
    var hojaHist = ss.getSheetByName('Historico');
    var datos = hojaHist.getRange(
      2, 1, hojaHist.getLastRow() - 1, CFG_ASISTENCIA_BRIGADA.TOTAL_COLUMNAS
    ).getValues();

    var porActividad = {};   // actividad -> { ruts, vias: { via: {total, enIndice} } }
    var rutsPorActYVia = {};
    for (var i = 0; i < datos.length; i++) {
      var act = String(datos[i][COL.ACTIVIDAD] || '(sin actividad)').trim();
      var rut = cleanRut(datos[i][COL.RUT_AFILIADO]);
      var via = String(datos[i][COL.BRIGADISTA] || '(vacía)').trim();
      var tipoVia = (via.indexOf('@') !== -1) ? 'BRIGADISTA (presencial)' : via;

      if (!porActividad[act]) porActividad[act] = { ruts: {}, vias: {} };
      porActividad[act].ruts[rut] = true;
      if (!porActividad[act].vias[tipoVia]) porActividad[act].vias[tipoVia] = { total: 0, enIndice: 0 };
      porActividad[act].vias[tipoVia].total++;
      if (indice[rut]) porActividad[act].vias[tipoVia].enIndice++;

      var kv = act + '||' + tipoVia;
      (rutsPorActYVia[kv] = rutsPorActYVia[kv] || {})[rut] = true;
    }

    log.push('');
    log.push('--- Cobertura del índice, por actividad y por vía ---');
    log.push('  (cuántos de los que marcaron figuran como ya notificados)');
    Object.keys(porActividad).forEach(function(act) {
      var a = porActividad[act];
      var personas = Object.keys(a.ruts).length;
      var enIndice = Object.keys(a.ruts).filter(function(r) { return !!indice[r]; }).length;
      log.push('  ▸ ' + act + ' — ' + personas + ' personas, ' + enIndice +
               ' en el índice (' + Math.round(enIndice * 100 / personas) + '%)');
      Object.keys(a.vias).forEach(function(v) {
        var c = a.vias[v];
        log.push('      ' + v + ': ' + c.total + ' marcajes, ' + c.enIndice +
                 ' en el índice (' + Math.round(c.enIndice * 100 / c.total) + '%)');
      });
    });

    // --- Los repetidos de cada actividad, contra el índice ------------------
    // La pregunta concreta: cuando llegó el segundo marcaje, ¿el socio estaba o
    // no en el índice? Si no estaba, el detector no tenía cómo verlo.
    var porRutAct = {};
    for (var j = 0; j < datos.length; j++) {
      var actJ = String(datos[j][COL.ACTIVIDAD] || '(sin actividad)').trim();
      var rutJ = cleanRut(datos[j][COL.RUT_AFILIADO]);
      var dJ   = parsearFechaFlexible(datos[j][COL.HORA_MARCAJE]);
      var viaJ = String(datos[j][COL.BRIGADISTA] || '').trim();
      (porRutAct[rutJ + '||' + actJ] = porRutAct[rutJ + '||' + actJ] || []).push({
        ms:  dJ ? dJ.getTime() : 0,
        dia: dJ ? Utilities.formatDate(dJ, TZ, 'dd/MM/yyyy') : '(sin fecha)',
        via: (viaJ.indexOf('@') !== -1) ? 'BRIGADISTA (presencial)' : viaJ,
        estado: String(datos[j][COL.ESTADO_NOTIFICACION] || '').trim(),
        rut: rutJ,
        act: actJ
      });
    }

    log.push('');
    log.push('--- Repetidos: combinación de vías y días, y si el RUT está en el índice ---');
    var patrones = {};
    Object.keys(porRutAct).forEach(function(k) {
      var g = porRutAct[k];
      if (g.length < 2) return;
      g.sort(function(a, b) { return a.ms - b.ms; });
      var mismoDia = g[0].dia === g[g.length - 1].dia;
      var marcado  = g.filter(function(r) {
        return r.estado.toUpperCase().indexOf('DUPLICADO') === 0;
      }).length;
      var clave = g[0].act + ' ‖ ' + g.map(function(r) { return r.via; }).join(' → ') +
                  ' ‖ ' + (mismoDia ? 'mismo día' : 'días distintos') +
                  ' ‖ ' + (marcado > 0 ? 'marcado DUPLICADO' : 'SIN marcar') +
                  ' ‖ ' + (indice[g[0].rut] ? 'RUT en índice' : 'RUT AUSENTE del índice');
      patrones[clave] = (patrones[clave] || 0) + 1;
    });
    Object.keys(patrones).sort(function(a, b) { return patrones[b] - patrones[a]; })
      .forEach(function(k) { log.push('  ' + patrones[k] + ' caso(s) | ' + k); });

  } catch (e) {
    log.push('❌ EXCEPCIÓN: ' + e.toString());
  }

  Logger.log(log.join('\n'));
  return 'ver Registro de ejecución';
}

// ==========================================
// SWITCH MÓDULO ASISTENCIA
// ==========================================
// Bandera `asistencia_habilitada` — gobierna la visibilidad de la vista
// "Registro de Asistencia" en el portal. Vive acá desde que se retiró
// BD_ASISTENCIA: la vista que gobierna es la que sirve este módulo.

function obtenerEstadoSwitchAsistencia() {
  return _switchHabilitado('asistencia_habilitada');
}

// Solo ADMIN (validado en _toggleSwitchModulo).
function toggleSwitchAsistencia(estado, rutSolicitante) {
  return _toggleSwitchModulo('asistencia_habilitada', estado, rutSolicitante);
}
