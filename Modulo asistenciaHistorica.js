// ============================================================================
// ASISTENCIA HISTÓRICA (carga manual, anterior al sistema actual)
// ============================================================================
// Antes de que existiera el registro por Brigada, la asistencia a las asambleas
// se llevaba en planillas sueltas —una por zona y por asamblea— que se vaciaban
// una vez emitidos los descuentos del mes. Lo único que sobrevivió de esa etapa
// son los consolidados mensuales `DESCUENTOS_YYYY-MM_<MES>`: la lista validada
// de quiénes participaron y por qué vía.
//
// ¿POR QUÉ UNA CARGA A MANO Y NO UN IMPORTADOR? Porque esos consolidados son la
// base con la que se descontó plata a los socios. La persona que los produjo es
// la única que puede afirmar que una fila corresponde a la asamblea de ese mes:
// hay zonas que no sesionaron, planillas reutilizadas entre meses y correlativos
// que no siguen el calendario. Un importador automático adivinaría, y una falta
// mal imputada es un problema con un socio real, no un bug.
//
// ⛔ ESTE MÓDULO NO ENVÍA CORREOS. Ninguna función de acá manda, encola ni
//    dispara una notificación, y no debe hacerlo nunca. La carga es un acto
//    administrativo sobre datos de meses ya cerrados: al socio no se le avisa
//    nada, se le corrige el historial. Si alguna vez hiciera falta avisar, es
//    una decisión aparte, y va fuera de este archivo.
//
// ⛔ NO SE ESCRIBE EN LA PLANILLA DE BRIGADA. Es un proyecto ajeno, en
//    producción, con activadores cada minuto que sí envían correos a socios
//    reales. Los históricos viven en hoja propia; ver `HOJA_ASISTENCIA_HISTORICA`.
//
// La hoja es la FUENTE, no un paso intermedio: nada se copia a otro lado
// después de aplicarla. Se lee en vivo y se une a lo de Brigada al momento de
// mostrar, igual que las dos pestañas de Brigada se unen entre sí.
// ============================================================================

// Nombre de pestaña como constante LOCAL, no como clave de CONFIG.HOJAS. Mismo
// criterio que HOJA_PERMISOS_ARCHIVOS, HOJA_CATALOGO_ACTIVIDADES y QUEST_ESTADO:
// una clave en CONFIG obligaría a correr un `_configurar*()` por entorno antes
// de que el módulo sirviera, y hasta que eso ocurriera las escrituras se
// perderían en silencio (`row[undefined] = valor`). Esta hoja se auto-repara.
//
// Vive dentro del spreadsheet de JUSTIFICACIONES —como CONFIG_JUSTIFICACIONES y
// CATALOGO_ACTIVIDADES— para quedar cubierta por el respaldo semanal sin cablear
// nada: `respaldarBasesDeDatos` recorre CONFIG.SPREADSHEETS.
var HOJA_ASISTENCIA_HISTORICA = 'ASISTENCIA_HISTORICA';

var CFG_ASISTENCIA_HISTORICA = {
  ZONA_HORARIA: 'America/Santiago',

  // Encabezados en orden. Se resuelven POR NOMBRE, nunca por índice fijo: la
  // hoja la edita una persona a mano y una columna insertada al medio no puede
  // desplazar los datos de todas las demás.
  ENCABEZADOS: [
    'RUT',            // ← lo pega el operador (única columna imprescindible)
    'MES',            // ← lo pega el operador: 'YYYY-MM'
    'ACTIVIDAD',      // ← opcional: "Asamblea Ordinaria", "Asamblea Virtual"...
    'FECHA_EVENTO',   // ← opcional: día exacto, si se conoce
    'ORIGEN',         // ← opcional: de qué archivo salió la fila
    'NOMBRE',         // ↓ de acá abajo lo completa el sistema al validar
    'REGION',
    'ESTADO_CARGA',   // PENDIENTE | CARGADA | ERROR | OMITIDA
    'OBSERVACION',
    'CARGADO_POR',
    'FECHA_CARGA'
  ],

  // Las cinco primeras son del operador: al validar se respetan tal cual y sólo
  // se normaliza su formato. El resto las escribe el sistema.
  COLUMNAS_DEL_OPERADOR: ['RUT', 'MES', 'ACTIVIDAD', 'FECHA_EVENTO', 'ORIGEN'],

  ESTADO: {
    PENDIENTE: 'PENDIENTE',
    CARGADA:   'CARGADA',
    ERROR:     'ERROR',
    OMITIDA:   'OMITIDA'
  },

  // Lo que se muestra cuando la fila no trae nombre de actividad.
  ACTIVIDAD_POR_DEFECTO: 'Asamblea Ordinaria',

  // Cómo se le presenta al socio la vía de estos registros. No dice "presencial"
  // ni "virtual" porque el consolidado mensual no siempre lo distingue, y
  // afirmar de más en el historial de una persona no aporta nada.
  VIA: 'Registro histórico',

  // Meses anteriores a esto se rechazan en la validación. No es una regla de
  // negocio, es un cortafuegos contra el error de tipeo ('2016-05' por
  // '2026-05'), que si no se detecta abre un año entero de faltas falsas.
  // Se puede bajar si alguna vez se carga algo más antiguo.
  MES_MINIMO_ACEPTADO: '2025-01',

  CACHE_PREFIJO: 'asist_hist_',
  CACHE_SEGUNDOS: 300,

  // Cobertura = qué pares zona+mes tienen carga aplicada. Es lo que decide qué
  // meses viejos se evalúan y cuáles siguen bloqueados; se consulta una vez por
  // socio que entra, así que se cachea aparte y con TTL más largo.
  CACHE_COBERTURA: 'asist_hist_cobertura_v1',
  CACHE_COBERTURA_SEGUNDOS: 600
};

// ============================================================================
// LECTURA — lo que consume el resto del sistema
// ============================================================================

/**
 * Asistencia histórica de un socio, con la MISMA forma que devuelve
 * `_consolidarAsistencia()` en Modulo asistenciaBrigada.js.
 *
 * Que las dos fuentes hablen la misma forma es lo que permite unirlas con un
 * `concat` y que la interfaz no tenga que saber de dónde salió cada fila: para
 * el socio es un solo historial.
 *
 * NUNCA LANZA. Un problema acá no puede dejar a un socio sin ver lo de Brigada,
 * que es su historial reciente y el que más mira.
 *
 * @param {string} rutSesion RUT del socio (se limpia acá adentro).
 * @return {Array<{actividad,fecha,hora,via,enProceso,fechaOrden,mes,esHistorico}>}
 */
function _leerAsistenciaHistoricaPorRut(rutSesion) {
  try {
    var rutLimpio = cleanRut(rutSesion);
    if (!rutLimpio) return [];

    var claveCache = CFG_ASISTENCIA_HISTORICA.CACHE_PREFIJO + rutLimpio;
    try {
      var enCache = CacheService.getScriptCache().get(claveCache);
      if (enCache) return JSON.parse(enCache);
    } catch (eCache) { /* una caché ilegible no es motivo para no leer la hoja */ }

    var hoja = _hojaAsistenciaHistorica(false);
    if (!hoja || hoja.getLastRow() < 2) return [];

    var idx = _indicesAsistenciaHistorica(hoja);
    // Sin alguna de las tres, cada fila se descartaría por el filtro de estado y
    // el socio vería un historial vacío sin que nada fallara. Se dice en el log.
    if (idx.RUT === undefined || idx.MES === undefined || idx.ESTADO_CARGA === undefined) {
      Logger.log('⚠️ Asistencia histórica: la hoja no tiene RUT/MES/ESTADO_CARGA. ' +
                 'Ejecuta _prepararHojaAsistenciaHistorica().');
      return [];
    }

    var datos = hoja.getRange(2, 1, hoja.getLastRow() - 1, hoja.getLastColumn()).getValues();
    var TZ = CFG_ASISTENCIA_HISTORICA.ZONA_HORARIA;
    var salida = [];

    for (var i = 0; i < datos.length; i++) {
      var fila = datos[i];

      // Sólo las filas efectivamente aplicadas. Una PENDIENTE todavía no fue
      // revisada y una con ERROR no pasó la validación: mostrarlas sería dar por
      // buena una asistencia que nadie confirmó.
      var estadoCarga = String(fila[idx.ESTADO_CARGA] || '').trim().toUpperCase();
      if (estadoCarga !== CFG_ASISTENCIA_HISTORICA.ESTADO.CARGADA) continue;

      if (cleanRut(fila[idx.RUT]) !== rutLimpio) continue;

      var mes = _normalizarMesHistorico(fila[idx.MES]);
      if (!mes) continue;

      // La fecha exacta es opcional. Cuando falta se usa el día 1 del mes SÓLO
      // para ordenar la lista; lo que se le muestra al socio es el mes en
      // palabras, nunca un día inventado que no ocurrió.
      var fechaEvento = (idx.FECHA_EVENTO !== undefined)
        ? parsearFechaFlexible(fila[idx.FECHA_EVENTO])
        : null;

      var partes = mes.split('-');
      var fechaOrden = fechaEvento
        ? fechaEvento.getTime()
        : new Date(Number(partes[0]), Number(partes[1]) - 1, 1, 12, 0, 0).getTime();

      var actividad = (idx.ACTIVIDAD !== undefined)
        ? String(fila[idx.ACTIVIDAD] || '').trim()
        : '';

      salida.push({
        actividad:   actividad || CFG_ASISTENCIA_HISTORICA.ACTIVIDAD_POR_DEFECTO,
        fecha:       fechaEvento ? Utilities.formatDate(fechaEvento, TZ, 'dd-MM-yyyy') : '',
        hora:        '',              // el consolidado mensual no registra hora
        via:         CFG_ASISTENCIA_HISTORICA.VIA,
        enProceso:   false,           // son meses cerrados: nada está en curso
        fechaOrden:  fechaOrden,
        mes:         mes,
        esHistorico: true             // lo usa la unión para desempatar
      });
    }

    try {
      CacheService.getScriptCache().put(claveCache, JSON.stringify(salida),
                                        CFG_ASISTENCIA_HISTORICA.CACHE_SEGUNDOS);
    } catch (ePut) { /* sin caché igual funciona, sólo más lento */ }

    return salida;

  } catch (e) {
    Logger.log('⚠️ Asistencia histórica: falló la lectura por RUT — ' + e.toString());
    return [];
  }
}

/**
 * Une la asistencia histórica a la lista que ya venía de Brigada.
 *
 * Es el ÚNICO punto de fusión: los tres consumidores (el historial del socio, el
 * calendario individual y el diagnóstico) llaman acá en vez de repetir la lógica.
 *
 * REGLA DE PRECEDENCIA: si el socio ya tiene un registro de Brigada en ese mes,
 * el histórico de ese mes se descarta. Brigada es el sistema vivo y su fila trae
 * día, hora y vía reales; la histórica es una reconstrucción a nivel de mes. El
 * solape no debería ocurrir (Brigada empieza en agosto de 2026 y lo histórico
 * termina antes), pero si alguien carga un mes de más, el socio no puede
 * terminar viendo dos veces la misma asamblea.
 *
 * @param {Array} registrosBrigada Lo que devolvió `_leerAsistenciaBrigadaPorRut`.
 * @param {string} rutLimpio
 * @return {Array} La lista unida, ordenada de la más reciente a la más antigua.
 */
function _unirAsistenciaHistorica(registrosBrigada, rutLimpio) {
  var base = registrosBrigada || [];

  try {
    var historicos = _leerAsistenciaHistoricaPorRut(rutLimpio);
    if (!historicos.length) return base;

    // Meses que Brigada ya cubre. Se deduce de la fecha del registro, que viene
    // formateada 'dd-MM-yyyy': se arma 'yyyy-MM' sin volver a parsear.
    var mesesDeBrigada = {};
    for (var i = 0; i < base.length; i++) {
      var f = String(base[i].fecha || '');
      var m = f.match(/^(\d{2})-(\d{2})-(\d{4})$/);
      if (m) mesesDeBrigada['m_' + m[3] + '-' + m[2]] = true;
    }

    var unidos = base.slice();
    for (var h = 0; h < historicos.length; h++) {
      if (mesesDeBrigada['m_' + historicos[h].mes]) continue;
      unidos.push(historicos[h]);
    }

    unidos.sort(function(a, b) {
      if (a.fechaOrden === null && b.fechaOrden === null) return 0;
      if (a.fechaOrden === null) return 1;
      if (b.fechaOrden === null) return -1;
      return b.fechaOrden - a.fechaOrden;
    });

    return unidos;

  } catch (e) {
    Logger.log('⚠️ Asistencia histórica: falló la unión — ' + e.toString());
    return base;   // ante cualquier duda, el socio ve al menos lo de Brigada
  }
}

/**
 * Mapa "RUT|mes" de un mes concreto, para el consolidado por zona.
 *
 * Misma forma que devuelve `_participacionGeneralAsistencias()`, para que el
 * consolidado sume las dos fuentes sin distinguirlas.
 *
 * @param {string} mesElegido 'YYYY-MM'
 * @return {{ok: boolean, mapa: Object, mensaje: string}}
 */
function _asistenciaHistoricaDelMes(mesElegido) {
  var mapa = {};
  // Acepta un mes o varios, igual que su gemela de Brigada: el informe de
  // faltas pide un rango entero y no puede releer la hoja mes por mes.
  var filtro = _filtroDeMeses(mesElegido);

  try {
    var hoja = _hojaAsistenciaHistorica(false);
    if (!hoja || hoja.getLastRow() < 2) return { ok: true, mapa: mapa, mensaje: '' };

    var idx = _indicesAsistenciaHistorica(hoja);
    if (idx.RUT === undefined || idx.MES === undefined || idx.ESTADO_CARGA === undefined) {
      return { ok: false, mapa: mapa, mensaje: 'La hoja de asistencia histórica no tiene las columnas esperadas.' };
    }

    var datos = hoja.getRange(2, 1, hoja.getLastRow() - 1, hoja.getLastColumn()).getValues();

    for (var i = 0; i < datos.length; i++) {
      var estadoCarga = String(datos[i][idx.ESTADO_CARGA] || '').trim().toUpperCase();
      if (estadoCarga !== CFG_ASISTENCIA_HISTORICA.ESTADO.CARGADA) continue;

      var mes = _normalizarMesHistorico(datos[i][idx.MES]);
      if (!mes || !filtro.tiene(mes)) continue;

      var rut = cleanRut(datos[i][idx.RUT]);
      if (!rut) continue;

      mapa[rut + '|' + mes] = true;
    }

    return { ok: true, mapa: mapa, mensaje: '' };

  } catch (e) {
    // `ok:false` importa: quien lee el gráfico DEBE saber que una fuente falló.
    // Una asistencia que no se pudo leer se ve idéntica a una que no existe, y
    // eso se traduce en faltas que no son faltas.
    Logger.log('⚠️ Asistencia histórica: falló la lectura del mes — ' + e.toString());
    return { ok: false, mapa: mapa, mensaje: 'La asistencia histórica no está disponible en este momento.' };
  }
}

// ============================================================================
// COBERTURA — qué zonas y meses quedaron habilitados por la carga
// ============================================================================

/**
 * Pares "zona|mes" con carga histórica aplicada.
 *
 * ¿PARA QUÉ? `CFG_PARTICIPACION.INICIO_DATOS_EVALUABLES` bloquea todo mes
 * anterior a agosto de 2026, porque antes de esa fecha no había asistencia en
 * ninguna base y evaluar esos meses habría mostrado EN FALTA a socios que
 * asistieron con toda normalidad. Este mapa es lo que permite levantar ese
 * bloqueo SÓLO donde ya hay datos, en vez de abrirlo entero y llenar de faltas
 * falsas a las zonas que aún no se cargaron.
 *
 * La llave es la zona NORMALIZADA (`_normalizarRegionParaComparar`), la misma
 * que usa el consolidado, porque la misma región se escribe distinto según
 * quién cargó la fila.
 *
 * @return {Object} { 'zona|mes': true }
 */
// Memoria de ESTA ejecucion. CacheService.get() es una llamada de servicio, y
// el informe de faltas pregunta por la cobertura una vez por socio y por mes:
// a 2.700 socios por 12 meses son 32.000 llamadas, que se llevaban dos minutos
// de una ejecucion que tiene seis. El estado global se reinicia en cada
// ejecucion de Apps Script, asi que esto no puede quedar rancio entre corridas.
var _MEMO_COBERTURA_HISTORICA = null;

function _coberturaAsistenciaHistorica() {
  if (_MEMO_COBERTURA_HISTORICA) return _MEMO_COBERTURA_HISTORICA;

  try {
    var enCache = CacheService.getScriptCache().get(CFG_ASISTENCIA_HISTORICA.CACHE_COBERTURA);
    if (enCache) {
      // Se memoriza TAMBIEN por este camino. Devolverlo directo dejaba el memo
      // vacio, asi que cada llamada volvia a pegarle a CacheService y a parsear
      // el JSON: con la cache caliente -o sea, siempre- el informe hacia 32.000
      // de esas y el bucle se llevaba 33 de sus 45 segundos.
      _MEMO_COBERTURA_HISTORICA = JSON.parse(enCache);
      return _MEMO_COBERTURA_HISTORICA;
    }
  } catch (eCache) { /* sigue */ }

  var cobertura = {};

  try {
    var hoja = _hojaAsistenciaHistorica(false);
    if (hoja && hoja.getLastRow() >= 2) {
      var idx = _indicesAsistenciaHistorica(hoja);

      if (idx.MES !== undefined && idx.REGION !== undefined && idx.ESTADO_CARGA !== undefined) {
        var datos = hoja.getRange(2, 1, hoja.getLastRow() - 1, hoja.getLastColumn()).getValues();

        for (var i = 0; i < datos.length; i++) {
          var estadoCarga = String(datos[i][idx.ESTADO_CARGA] || '').trim().toUpperCase();
          if (estadoCarga !== CFG_ASISTENCIA_HISTORICA.ESTADO.CARGADA) continue;

          var mes = _normalizarMesHistorico(datos[i][idx.MES]);
          var zona = _normalizarRegionParaComparar(datos[i][idx.REGION]);
          if (!mes || !zona) continue;

          cobertura[zona + '|' + mes] = true;
        }
      }
    }

    try {
      CacheService.getScriptCache().put(CFG_ASISTENCIA_HISTORICA.CACHE_COBERTURA,
                                        JSON.stringify(cobertura),
                                        CFG_ASISTENCIA_HISTORICA.CACHE_COBERTURA_SEGUNDOS);
    } catch (ePut) { /* sigue */ }

  } catch (e) {
    Logger.log('⚠️ Asistencia histórica: falló el cálculo de cobertura — ' + e.toString());
    // Un mapa vacío deja los meses viejos bloqueados, que es el estado seguro:
    // no se evalúa nada que no se pueda probar.
  }

  _MEMO_COBERTURA_HISTORICA = cobertura;
  return cobertura;
}

/**
 * ¿Este mes es evaluable para esta zona?
 *
 * Responde `true` cuando el mes es posterior al corte general (el sistema tiene
 * datos propios) o cuando ese par zona+mes fue cargado a mano. En cualquier otro
 * caso el mes queda bloqueado, que es lo correcto: sin dato no se imputa falta.
 *
 * @param {string} mes  'YYYY-MM'
 * @param {string} zonaNormalizada  Salida de `_normalizarRegionParaComparar`.
 */
function _mesEvaluableConHistorico(mes, zonaNormalizada) {
  var corte = CFG_PARTICIPACION.INICIO_DATOS_EVALUABLES;
  if (!corte || mes >= corte) return true;
  if (!zonaNormalizada) return false;

  var cobertura = _coberturaAsistenciaHistorica();
  return cobertura[zonaNormalizada + '|' + mes] === true;
}

/** Invalida las cachés del módulo. Se llama al aplicar una carga. */
function _invalidarCacheAsistenciaHistorica() {
  _MEMO_COBERTURA_HISTORICA = null;
  try {
    CacheService.getScriptCache().remove(CFG_ASISTENCIA_HISTORICA.CACHE_COBERTURA);
  } catch (e) { /* sin caché, la próxima lectura va a la hoja igual */ }
}

// ============================================================================
// VALIDACIÓN Y CARGA
// ============================================================================

/**
 * Revisa la hoja sin escribir nada y devuelve el informe de lo que pasaría.
 *
 * SIMULACIÓN PURA: no cambia una sola celda. Existe para que el operador pueda
 * pegar 500 filas, ver qué está mal y corregirlo ANTES de que nada entre al
 * sistema — que es todo el punto de hacer esto a mano.
 *
 * @param {string} rutSolicitante RUT ADMIN.
 */
function validarCargaAsistenciaHistorica(rutSolicitante) {
  _ensureConfig();
  return _procesarCargaAsistenciaHistorica(rutSolicitante, false);
}

/**
 * Aplica la carga: normaliza las filas válidas, las completa y las marca CARGADA.
 *
 * A partir de ese momento aparecen en el historial del socio y cuentan en el
 * consolidado. NO envía ningún correo, ni acá ni como efecto de esto: la
 * participación no notifica, y SLIM Quest no reprocesa meses ya cerrados.
 *
 * IDEMPOTENTE: una fila ya CARGADA se deja como está y se cuenta aparte. Volver
 * a ejecutar no duplica nada ni vuelve a tocar lo que ya entró.
 *
 * @param {string} rutSolicitante RUT ADMIN.
 */
function aplicarCargaAsistenciaHistorica(rutSolicitante) {
  _ensureConfig();
  return _procesarCargaAsistenciaHistorica(rutSolicitante, true);
}

/**
 * Núcleo compartido por la validación y la carga.
 *
 * Que sean el mismo código es deliberado: si validar y aplicar recorrieran
 * caminos distintos, el informe que el operador revisa dejaría de describir lo
 * que realmente va a ocurrir, y esa diferencia se descubriría con los datos ya
 * escritos.
 */
function _procesarCargaAsistenciaHistorica(rutSolicitante, aplicarCambios) {
  try {
    var verificacion = verificarRolUsuario(rutSolicitante, ['ADMIN']);
    if (!verificacion.autorizado) {
      Logger.log('⚠️ Carga histórica: intento no autorizado — RUT=' + rutSolicitante);
      return { success: false, message: 'No autorizado.' };
    }

    var candado = LockService.getScriptLock();
    if (!candado.tryLock(30000)) {
      return { success: false, message: 'Hay otra carga en curso. Intenta de nuevo en unos segundos.' };
    }

    try {
      var hoja = _hojaAsistenciaHistorica(true);
      if (hoja.getLastRow() < 2) {
        return {
          success: true, aplicado: !!aplicarCambios,
          resumen: { total: 0, listas: 0, errores: 0, yaCargadas: 0, duplicadas: 0 },
          detalles: [], message: 'La hoja está vacía: no hay nada que cargar.'
        };
      }

      var idx = _indicesAsistenciaHistorica(hoja);
      var faltantes = [];
      CFG_ASISTENCIA_HISTORICA.ENCABEZADOS.forEach(function(nombre) {
        if (idx[nombre] === undefined) faltantes.push(nombre);
      });
      if (faltantes.length) {
        return { success: false, message: 'A la hoja le faltan columnas: ' + faltantes.join(', ') +
                                          '. Vuelve a ejecutar la preparación de la hoja.' };
      }

      var socios = _mapaSociosParaCargaHistorica();
      if (!socios.ok) return { success: false, message: socios.mensaje };

      var datos = hoja.getRange(2, 1, hoja.getLastRow() - 1, hoja.getLastColumn()).getValues();
      var resumen = { total: 0, listas: 0, errores: 0, yaCargadas: 0, duplicadas: 0 };
      var detalles = [];
      var vistas = {};            // RUT|mes ya visto EN ESTA MISMA HOJA
      var huboCambios = false;    // ¿hay algo que escribir al final?
      var ahora = new Date();
      var TZ = CFG_ASISTENCIA_HISTORICA.ZONA_HORARIA;

      for (var i = 0; i < datos.length; i++) {
        var fila = datos[i];
        var numeroFila = i + 2;

        // Una fila totalmente vacía es el espacio en blanco normal de una hoja
        // que se llena a mano. Ni se cuenta ni se reporta.
        if (_filaVaciaHistorico(fila, idx)) continue;
        resumen.total++;

        var estadoActual = String(fila[idx.ESTADO_CARGA] || '').trim().toUpperCase();
        if (estadoActual === CFG_ASISTENCIA_HISTORICA.ESTADO.CARGADA) {
          resumen.yaCargadas++;
          // Igual ocupa su lugar: si más abajo alguien repitió el mismo par, se
          // detecta contra esta.
          var rutYa = cleanRut(fila[idx.RUT]);
          var mesYa = _normalizarMesHistorico(fila[idx.MES]);
          if (rutYa && mesYa) vistas['v_' + rutYa + '|' + mesYa] = numeroFila;
          continue;
        }

        var revision = _revisarFilaHistorica(fila, idx, socios.mapa, vistas, numeroFila);

        if (!revision.ok) {
          resumen.errores++;
          detalles.push({ fila: numeroFila, rut: revision.rutCrudo, estado: 'ERROR', motivo: revision.motivo });

          if (aplicarCambios) {
            fila[idx.ESTADO_CARGA] = CFG_ASISTENCIA_HISTORICA.ESTADO.ERROR;
            fila[idx.OBSERVACION]  = revision.motivo;
            huboCambios = true;
          }
          continue;
        }

        if (revision.duplicada) {
          resumen.duplicadas++;
          detalles.push({ fila: numeroFila, rut: revision.rut, estado: 'OMITIDA', motivo: revision.motivo });

          if (aplicarCambios) {
            fila[idx.ESTADO_CARGA] = CFG_ASISTENCIA_HISTORICA.ESTADO.OMITIDA;
            fila[idx.OBSERVACION]  = revision.motivo;
            huboCambios = true;
          }
          continue;
        }

        vistas['v_' + revision.rut + '|' + revision.mes] = numeroFila;
        resumen.listas++;

        if (aplicarCambios) {
          // Se muta la matriz EN MEMORIA y se escribe todo junto al final.
          //
          // La primera versión escribía celda por celda, pensando en no pisar lo
          // que el operador pudiera estar editando entremedio. Con una carga
          // real —cuatro meses de todas las zonas, miles de filas— eso son
          // decenas de miles de llamadas a Sheets y la ejecución se corta por
          // tiempo antes de llegar a la mitad. Un `setValues` es una sola
          // llamada, y el candado de más arriba ya cubre la concurrencia.
          fila[idx.RUT]          = revision.rut;
          fila[idx.MES]          = revision.mes;
          fila[idx.ACTIVIDAD]    = revision.actividad;
          fila[idx.NOMBRE]       = revision.nombre;
          fila[idx.REGION]       = revision.region;
          fila[idx.ESTADO_CARGA] = CFG_ASISTENCIA_HISTORICA.ESTADO.CARGADA;
          fila[idx.OBSERVACION]  = revision.aviso || '';
          fila[idx.CARGADO_POR]  = cleanRut(rutSolicitante);
          fila[idx.FECHA_CARGA]  = Utilities.formatDate(ahora, TZ, 'dd/MM/yyyy HH:mm:ss');

          if (revision.fechaEvento) {
            fila[idx.FECHA_EVENTO] = Utilities.formatDate(revision.fechaEvento, TZ, 'dd/MM/yyyy');
          }
          huboCambios = true;

        } else if (revision.aviso) {
          detalles.push({ fila: numeroFila, rut: revision.rut, estado: 'AVISO', motivo: revision.aviso });
        }
      }

      if (aplicarCambios && huboCambios) {
        // Una sola escritura para toda la hoja. Se parte de lo que se leyó, así
        // que las celdas que no se tocaron vuelven con su mismo valor.
        // (Esta hoja no lleva fórmulas —es de carga manual— así que reescribir
        // el rango completo no destruye nada.)
        hoja.getRange(2, 1, datos.length, datos[0].length).setValues(datos);
        SpreadsheetApp.flush();
        _invalidarCacheAsistenciaHistorica();
      }

      var mensaje = aplicarCambios
        ? ('Carga aplicada: ' + resumen.listas + ' filas ingresadas, ' + resumen.errores +
           ' con error, ' + resumen.duplicadas + ' omitidas por repetidas, ' +
           resumen.yaCargadas + ' ya estaban cargadas.')
        : ('Simulación: ' + resumen.listas + ' filas quedarían cargadas, ' + resumen.errores +
           ' tienen error, ' + resumen.duplicadas + ' están repetidas, ' +
           resumen.yaCargadas + ' ya estaban cargadas. No se escribió nada.');

      return {
        success: true, aplicado: !!aplicarCambios,
        resumen: resumen, detalles: detalles, message: mensaje
      };

    } finally {
      candado.releaseLock();
    }

  } catch (e) {
    Logger.log('❌ Carga histórica: ' + e.toString());
    return { success: false, message: 'Error al procesar la carga: ' + e.message };
  }
}

/**
 * Revisa UNA fila. No escribe: sólo dictamina.
 *
 * Distingue error de aviso. El error deja la fila fuera; el aviso la deja entrar
 * pero anota algo que el operador debe mirar (un socio desvinculado, por
 * ejemplo, que puede ser perfectamente correcto: en marzo estaba activo).
 */
function _revisarFilaHistorica(fila, idx, mapaSocios, vistas, numeroFila) {
  var rutCrudo = String(fila[idx.RUT] || '').trim();
  var rut = cleanRut(rutCrudo);

  if (!rut) {
    return { ok: false, rutCrudo: rutCrudo, motivo: 'Falta el RUT.' };
  }
  if (!validarRutChileno(rut)) {
    // El dígito verificador es lo único que distingue un RUT mal tipeado de uno
    // que simplemente no está en la base. Sin esta comprobación, un dígito
    // cambiado se reportaría como "socio no encontrado" y alguien perdería el
    // tiempo buscándolo.
    return { ok: false, rutCrudo: rutCrudo, motivo: 'El RUT no es válido (dígito verificador incorrecto).' };
  }

  var socio = mapaSocios['s_' + rut];
  if (!socio) {
    return { ok: false, rutCrudo: rutCrudo, motivo: 'El RUT no está en la base de socios.' };
  }

  var mes = _normalizarMesHistorico(fila[idx.MES]);
  if (!mes) {
    return { ok: false, rutCrudo: rutCrudo,
             motivo: 'El mes no se entiende. Escríbelo como 2026-03.' };
  }
  if (mes < CFG_ASISTENCIA_HISTORICA.MES_MINIMO_ACEPTADO) {
    return { ok: false, rutCrudo: rutCrudo,
             motivo: 'El mes ' + mes + ' es anterior a ' +
                     CFG_ASISTENCIA_HISTORICA.MES_MINIMO_ACEPTADO +
                     '. Si es correcto, hay que bajar MES_MINIMO_ACEPTADO a propósito.' };
  }

  var mesActual = Utilities.formatDate(new Date(), CFG_ASISTENCIA_HISTORICA.ZONA_HORARIA, 'yyyy-MM');
  if (mes > mesActual) {
    return { ok: false, rutCrudo: rutCrudo,
             motivo: 'El mes ' + mes + ' está en el futuro.' };
  }

  var repetida = vistas['v_' + rut + '|' + mes];
  if (repetida) {
    // Repetir no es un error del operador: el consolidado puede traer al mismo
    // socio dos veces si marcó por dos vías. Se omite la segunda y se dice por qué.
    return { ok: true, duplicada: true, rut: rut, mes: mes,
             motivo: 'Repetida: ese socio ya tiene ' + mes + ' en la fila ' + repetida + '.' };
  }

  var fechaEvento = (idx.FECHA_EVENTO !== undefined)
    ? parsearFechaFlexible(fila[idx.FECHA_EVENTO])
    : null;

  // Una fecha que cae fuera del mes declarado es casi siempre un mes mal escrito,
  // y es justo el error que produciría una falta falsa en el mes vecino.
  if (fechaEvento) {
    var mesDeFecha = Utilities.formatDate(fechaEvento, CFG_ASISTENCIA_HISTORICA.ZONA_HORARIA, 'yyyy-MM');
    if (mesDeFecha !== mes) {
      return { ok: false, rutCrudo: rutCrudo,
               motivo: 'La fecha del evento (' + mesDeFecha + ') no corresponde al mes ' + mes + '.' };
    }
  }

  var actividad = (idx.ACTIVIDAD !== undefined) ? String(fila[idx.ACTIVIDAD] || '').trim() : '';

  var aviso = '';
  if (!socio.region) {
    // Entra igual: la asistencia ocurrió. Pero sin zona en su ficha, ese mes no
    // se le puede evaluar y tampoco suma a la cobertura de ninguna zona.
    aviso = 'El socio no tiene zona en su ficha: la asistencia se guarda, pero el mes no se le evalúa.';
  } else if (socio.estado && socio.estado !== 'ACTIVO') {
    aviso = 'Socio ' + socio.estado.toLowerCase() + ' hoy. Se carga igual: en ' + mes + ' pudo estar activo.';
  }

  return {
    ok: true, duplicada: false,
    rut: rut, mes: mes,
    nombre: socio.nombre,
    region: socio.region,
    actividad: actividad || CFG_ASISTENCIA_HISTORICA.ACTIVIDAD_POR_DEFECTO,
    fechaEvento: fechaEvento,
    aviso: aviso
  };
}

/**
 * RUT → {nombre, region, estado} de toda la base de socios, leída UNA vez.
 *
 * `obtenerUsuarioPorRut()` por fila costaría una búsqueda por cada una de las
 * ~500 filas de un mes, y la carga completa son varios miles: se saldría del
 * límite de 6 minutos sin llegar a la mitad.
 */
function _mapaSociosParaCargaHistorica() {
  try {
    var hoja = getSheet('USUARIOS', 'USUARIOS');
    if (!hoja || hoja.getLastRow() < 2) {
      return { ok: false, mapa: {}, mensaje: 'No se pudo leer la base de socios.' };
    }

    var COL = CONFIG.COLUMNAS.USUARIOS;
    var datos = hoja.getRange(2, 1, hoja.getLastRow() - 1, hoja.getLastColumn()).getValues();
    var mapa = {};

    for (var i = 0; i < datos.length; i++) {
      var rut = cleanRut(datos[i][COL.RUT]);
      if (!rut) continue;

      mapa['s_' + rut] = {
        nombre: String(datos[i][COL.NOMBRE] || '').trim(),
        region: String(datos[i][COL.REGION] || '').trim(),
        estado: String(datos[i][COL.ESTADO] || '').trim().toUpperCase()
      };
    }

    return { ok: true, mapa: mapa, mensaje: '' };

  } catch (e) {
    Logger.log('❌ Carga histórica: falló la lectura de socios — ' + e.toString());
    return { ok: false, mapa: {}, mensaje: 'No se pudo leer la base de socios: ' + e.message };
  }
}

// ============================================================================
// LA HOJA
// ============================================================================

/**
 * Devuelve la hoja. Con `crear` en true la construye o repara si hace falta.
 *
 * Auto-reparable como CATALOGO_ACTIVIDADES: agrega las columnas que falten sin
 * tocar las que ya están, así que ampliar el esquema más adelante no obliga a
 * rehacer nada ni a correr un `_configurar*()` por entorno.
 */
function _hojaAsistenciaHistorica(crear) {
  _ensureConfig();
  var ss = getSpreadsheet('JUSTIFICACIONES');
  var hoja = ss.getSheetByName(HOJA_ASISTENCIA_HISTORICA);

  if (!hoja) {
    if (!crear) return null;
    hoja = ss.insertSheet(HOJA_ASISTENCIA_HISTORICA);
    hoja.getRange(1, 1, 1, CFG_ASISTENCIA_HISTORICA.ENCABEZADOS.length)
        .setValues([CFG_ASISTENCIA_HISTORICA.ENCABEZADOS])
        .setFontWeight('bold');
    hoja.setFrozenRows(1);
    _formatearHojaAsistenciaHistorica(hoja);
    return hoja;
  }

  if (crear) {
    var encabezados = hoja.getRange(1, 1, 1, Math.max(hoja.getLastColumn(), 1)).getValues()[0];
    var presentes = {};
    encabezados.forEach(function(h) { presentes[String(h).trim().toUpperCase()] = true; });

    CFG_ASISTENCIA_HISTORICA.ENCABEZADOS.forEach(function(nombre) {
      if (!presentes[nombre.toUpperCase()]) {
        hoja.getRange(1, hoja.getLastColumn() + 1).setValue(nombre).setFontWeight('bold');
      }
    });
    _formatearHojaAsistenciaHistorica(hoja);
  }

  return hoja;
}

/**
 * Formato de la hoja. Lo único que de verdad importa acá es forzar RUT y MES a
 * TEXTO: pegados desde otra planilla, Sheets convierte '2026-03' en una fecha y
 * un RUT en un número que pierde el dígito verificador. Los dos destrozos son
 * silenciosos y se descubren cuando ya no calza nada.
 */
function _formatearHojaAsistenciaHistorica(hoja) {
  try {
    var idx = _indicesAsistenciaHistorica(hoja);
    var filas = Math.max(hoja.getMaxRows() - 1, 1);

    ['RUT', 'MES'].forEach(function(nombre) {
      if (idx[nombre] !== undefined) {
        hoja.getRange(2, idx[nombre] + 1, filas, 1).setNumberFormat('@');
      }
    });

    hoja.setColumnWidth(idx.RUT + 1, 110);
    if (idx.NOMBRE !== undefined)      hoja.setColumnWidth(idx.NOMBRE + 1, 240);
    if (idx.REGION !== undefined)      hoja.setColumnWidth(idx.REGION + 1, 260);
    if (idx.OBSERVACION !== undefined) hoja.setColumnWidth(idx.OBSERVACION + 1, 320);

  } catch (e) {
    // El formato es comodidad, no corrección: si falla, la hoja sirve igual.
    Logger.log('⚠️ Asistencia histórica: no se pudo dar formato a la hoja — ' + e.toString());
  }
}

/** Índices de columna por nombre de encabezado. `undefined` si no está. */
function _indicesAsistenciaHistorica(hoja) {
  var idx = {};
  var ultima = hoja.getLastColumn();
  if (ultima < 1) return idx;

  var encabezados = hoja.getRange(1, 1, 1, ultima).getValues()[0];
  for (var i = 0; i < encabezados.length; i++) {
    var nombre = String(encabezados[i]).trim().toUpperCase();
    if (nombre) idx[nombre] = i;
  }
  return idx;
}

/** ¿Está vacía en las columnas que llena el operador? */
function _filaVaciaHistorico(fila, idx) {
  for (var i = 0; i < CFG_ASISTENCIA_HISTORICA.COLUMNAS_DEL_OPERADOR.length; i++) {
    var col = idx[CFG_ASISTENCIA_HISTORICA.COLUMNAS_DEL_OPERADOR[i]];
    if (col !== undefined && String(fila[col] || '').trim() !== '') return false;
  }
  return true;
}

/**
 * Normaliza el mes a 'YYYY-MM'.
 *
 * Acepta lo que realmente aparece al pegar desde otra planilla: el texto
 * '2026-03', un Date (Sheets convierte '2026-03' en fecha por su cuenta),
 * '03/2026', y el nombre del mes en palabras, que es como vienen titulados los
 * consolidados ('MARZO 2026').
 *
 * Devuelve '' si no lo entiende: se prefiere rechazar la fila a adivinar el mes
 * de una asistencia, porque adivinar mal produce una falta en el mes vecino.
 */
function _normalizarMesHistorico(valor) {
  if (valor === null || valor === undefined || valor === '') return '';

  if (Object.prototype.toString.call(valor) === '[object Date]' && !isNaN(valor.getTime())) {
    return Utilities.formatDate(valor, CFG_ASISTENCIA_HISTORICA.ZONA_HORARIA, 'yyyy-MM');
  }

  var texto = String(valor).trim();
  if (!texto) return '';

  var iso = texto.match(/^(\d{4})[-\/_](\d{1,2})$/);
  if (iso) return iso[1] + '-' + _dosDigitosHistorico(iso[2]);

  var alReves = texto.match(/^(\d{1,2})[-\/_](\d{4})$/);
  if (alReves) return alReves[2] + '-' + _dosDigitosHistorico(alReves[1]);

  var completa = texto.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})$/);
  if (completa) return completa[1] + '-' + _dosDigitosHistorico(completa[2]);

  var NOMBRES = {
    'ENERO': 1, 'FEBRERO': 2, 'MARZO': 3, 'ABRIL': 4, 'MAYO': 5, 'JUNIO': 6,
    'JULIO': 7, 'AGOSTO': 8, 'SEPTIEMBRE': 9, 'SETIEMBRE': 9, 'OCTUBRE': 10,
    'NOVIEMBRE': 11, 'DICIEMBRE': 12
  };
  var enPalabras = texto.toUpperCase()
                        .replace(/[ÁÀÄÂ]/g, 'A').replace(/[ÉÈËÊ]/g, 'E')
                        .replace(/[ÍÌÏÎ]/g, 'I').replace(/[ÓÒÖÔ]/g, 'O')
                        .replace(/[ÚÙÜÛ]/g, 'U')
                        .match(/([A-Z]+)\s+(?:DE\s+)?(\d{4})/);
  if (enPalabras && NOMBRES[enPalabras[1]]) {
    return enPalabras[2] + '-' + _dosDigitosHistorico(NOMBRES[enPalabras[1]]);
  }

  // Último recurso: una fecha completa en formato chileno. Se resuelve con el
  // parser central del proyecto, nunca con `new Date(texto)`, que interpreta
  // DD/MM como MM/DD y cambia el mes en silencio.
  var fecha = parsearFechaFlexible(texto);
  if (fecha) return Utilities.formatDate(fecha, CFG_ASISTENCIA_HISTORICA.ZONA_HORARIA, 'yyyy-MM');

  return '';
}

function _dosDigitosHistorico(n) {
  var s = String(Number(n));
  return s.length < 2 ? '0' + s : s;
}

// ============================================================================
// SIEMBRA DEL CALENDARIO A PARTIR DE LO CARGADO
// ============================================================================
//
// Cargar la asistencia responde "quién fue". El consolidado por zona necesita
// además "qué hubo": sin la asamblea registrada en el calendario, el sistema no
// puede afirmar que alguien faltó —y hace bien en no afirmarlo, porque no lo
// sabe—, así que la zona entera queda fuera del gráfico.
//
// ⚠️ ESTO DERIVA ACTIVIDADES DE DATOS DE PARTICIPACIÓN, que es justo lo que una
//    vez creó cinco asambleas falsas. La diferencia está en la fuente: aquéllas
//    salían de marcajes crudos del sistema de asistencia, y éstas de filas que
//    una persona revisó, validó y aplicó a mano desde los consolidados con los
//    que se descontó plata. Aun así, por eso mismo:
//
//    · Es una función APARTE y explícita, nunca un efecto de aplicar la carga.
//    · Simula por defecto: se ve la lista completa antes de escribir nada.
//    · Sólo mira filas CARGADA, jamás una PENDIENTE o con ERROR.
//    · Nunca duplica una asamblea que ya esté registrada para esa zona y mes,
//      aunque la existente tenga fecha exacta y ésta no.
//
// PRECISIÓN MENSUAL, a propósito. La carga no trae el día de cada asamblea, y
// no se inventa: la actividad se registra con su mes y sin fecha. Para el
// cálculo da igual —la unidad de la participación es el mes— y el plazo queda
// cerrado, que es lo correcto en meses ya terminados. Lo que se pierde es el
// día en la ficha y el nombre real; se aceptó al construir esto.

/**
 * Registra en el catálogo una asamblea por cada zona y mes que aparezca en la
 * carga histórica y todavía no tenga ninguna.
 *
 * @param {string} rutSolicitante RUT ADMIN.
 * @param {boolean} aplicarCambios Sin `true`, sólo informa.
 */
function sembrarCatalogoDesdeCargaHistorica(rutSolicitante, aplicarCambios) {
  _ensureConfig();

  try {
    var verificacion = verificarRolUsuario(rutSolicitante, ['ADMIN']);
    if (!verificacion.autorizado) {
      Logger.log('⚠️ Siembra histórica: intento no autorizado — RUT=' + rutSolicitante);
      return { success: false, message: 'No autorizado.' };
    }

    // --- Lo que ya está en el calendario, por zona y mes ---
    // La comparación es por ZONA+MES y no por código de actividad: las asambleas
    // sembradas desde justificaciones tienen fecha exacta, así que su código
    // lleva el día y jamás coincidiría con el mensual que se generaría acá. Ir
    // por código habría creado una asamblea mensual duplicada al lado de cada
    // una de las que ya existen.
    var yaEnCatalogo = {};
    var cat = obtenerCatalogoActividades('');
    if (!cat || !cat.success) {
      return { success: false, message: 'No se pudo leer el catálogo de actividades.' };
    }
    (cat.actividades || []).forEach(function(a) {
      var z = _normalizarRegionParaComparar(a.region);
      if (z && a.mes) yaEnCatalogo[z + '|' + a.mes] = true;
    });

    // --- Zonas y meses presentes en la carga ---
    var hoja = _hojaAsistenciaHistorica(false);
    if (!hoja || hoja.getLastRow() < 2) {
      return { success: true, message: 'No hay carga histórica: nada que sembrar.',
               resumen: { pares: 0, nuevas: 0, yaExistian: 0, errores: 0 }, detalles: [] };
    }

    var idx = _indicesAsistenciaHistorica(hoja);
    if (idx.MES === undefined || idx.REGION === undefined || idx.ESTADO_CARGA === undefined) {
      return { success: false, message: 'La hoja de carga no tiene las columnas esperadas.' };
    }

    var datos = hoja.getRange(2, 1, hoja.getLastRow() - 1, hoja.getLastColumn()).getValues();
    var pares = {};   // 'zona|mes' -> { region cruda, mes, socios }

    for (var i = 0; i < datos.length; i++) {
      if (String(datos[i][idx.ESTADO_CARGA] || '').trim().toUpperCase() !==
          CFG_ASISTENCIA_HISTORICA.ESTADO.CARGADA) continue;

      var mes = _normalizarMesHistorico(datos[i][idx.MES]);
      var regionCruda = String(datos[i][idx.REGION] || '').trim();
      var zona = _normalizarRegionParaComparar(regionCruda);
      if (!mes || !zona) continue;

      // Un socio sin zona en su ficha no prueba que hubo asamblea en ninguna
      // parte: su asistencia vale, pero no puede fundar una actividad.
      if (CENTINELAS_SIN_REGION.indexOf(zona) !== -1) continue;

      var clave = zona + '|' + mes;
      if (!pares[clave]) pares[clave] = { region: regionCruda, mes: mes, socios: 0 };
      pares[clave].socios++;
    }

    // --- Qué falta ---
    var resumen = { pares: 0, nuevas: 0, yaExistian: 0, errores: 0 };
    var detalles = [];
    var claves = Object.keys(pares).sort();

    for (var k = 0; k < claves.length; k++) {
      var p = pares[claves[k]];
      resumen.pares++;

      if (yaEnCatalogo[claves[k]]) {
        resumen.yaExistian++;
        continue;
      }

      resumen.nuevas++;
      detalles.push({ mes: p.mes, region: p.region, socios: p.socios,
                      estado: aplicarCambios ? 'REGISTRADA' : 'SE_REGISTRARIA' });

      if (aplicarCambios) {
        var r = registrarActividadCatalogo({
          nombre: CFG_ASISTENCIA_HISTORICA.ACTIVIDAD_POR_DEFECTO,
          region: p.region,
          mes: p.mes,              // sin fechaEvento: queda PRECISION MENSUAL
          origen: CFG_CATALOGO_ACTIVIDADES.ORIGEN.MANUAL,
          registradoPor: 'CARGA_HISTORICA'
        });

        if (!r.success) {
          resumen.nuevas--;
          resumen.errores++;
          detalles[detalles.length - 1].estado = 'ERROR';
          detalles[detalles.length - 1].motivo = r.message;
        }
      }
    }

    if (aplicarCambios) _invalidarCacheCatalogo();

    var mensaje = aplicarCambios
      ? ('Siembra aplicada: ' + resumen.nuevas + ' asambleas registradas, ' +
         resumen.yaExistian + ' ya estaban, ' + resumen.errores + ' con error.')
      : ('Simulación: se registrarían ' + resumen.nuevas + ' asambleas; ' +
         resumen.yaExistian + ' ya están en el calendario. No se escribió nada.');

    return { success: true, aplicado: !!aplicarCambios,
             resumen: resumen, detalles: detalles, message: mensaje };

  } catch (e) {
    Logger.log('❌ Siembra histórica: ' + e.toString());
    return { success: false, message: 'Error al sembrar el calendario: ' + e.message };
  }
}

// ============================================================================
// ATAJOS DE EDITOR Y DIAGNÓSTICO
// ============================================================================
//
// El botón "Ejecutar" del editor de Apps Script no pasa argumentos, así que las
// dos funciones públicas de arriba no se pueden lanzar desde ahí: `rutSolicitante`
// llegaría vacío y `verificarRolUsuario` reventaría con un error que no dice
// nada del RUT faltante.
//
// Estos atajos existen para eso, detrás de una PUERTA QUE SE CIERRA SOLA: la
// propiedad `PERMITIR_CARGA_HISTORICA` se borra ANTES de hacer nada. Es el
// criterio de `PERMITIR_CONFIG_TRIGGERS` y no el de `RUT_MANTENCION`, porque no
// hay que acordarse de limpiar nada después y una caída a mitad de camino deja
// la puerta cerrada igual. Sin eso, una función global sin argumentos es
// invocable de forma anónima desde la consola del navegador: el webapp es
// ANYONE_ANONYMOUS.

/** Simula la carga. Requiere `PERMITIR_CARGA_HISTORICA` = SIMULAR. */
function _validarCargaHistoricaDesdeEditor() {
  return _cargaHistoricaDesdeEditor('SIMULAR');
}

/** Aplica la carga. Requiere `PERMITIR_CARGA_HISTORICA` = APLICAR. */
function _aplicarCargaHistoricaDesdeEditor() {
  return _cargaHistoricaDesdeEditor('APLICAR');
}

function _cargaHistoricaDesdeEditor(modoEsperado) {
  _ensureConfig();
  var props = PropertiesService.getScriptProperties();
  var modo = String(props.getProperty('PERMITIR_CARGA_HISTORICA') || '').trim().toUpperCase();

  // Se borra ANTES de actuar: si el proceso se cae a la mitad, la puerta ya
  // quedó cerrada y nadie puede repetir la llamada sin volver a abrirla.
  props.deleteProperty('PERMITIR_CARGA_HISTORICA');

  if (modo !== modoEsperado) {
    Logger.log('Puerta cerrada. Crea la propiedad PERMITIR_CARGA_HISTORICA con el valor "' +
               modoEsperado + '" y vuelve a ejecutar. (Se borra sola en cada intento.)');
    return;
  }

  var rutAdmin = String(props.getProperty('RUT_MANTENCION') || '').trim();
  if (!rutAdmin) {
    Logger.log('Falta la propiedad RUT_MANTENCION con un RUT ADMIN. Recuerda BORRARLA al terminar.');
    return;
  }

  var r = _procesarCargaAsistenciaHistorica(rutAdmin, modoEsperado === 'APLICAR');

  var log = ['===== CARGA DE ASISTENCIA HISTÓRICA (' + modoEsperado + ') ====='];
  log.push(r.message || '');
  if (r.resumen) {
    log.push('   Filas con datos: ' + r.resumen.total);
    log.push('   Listas para cargar: ' + r.resumen.listas);
    log.push('   Con error: ' + r.resumen.errores);
    log.push('   Repetidas (omitidas): ' + r.resumen.duplicadas);
    log.push('   Ya estaban cargadas: ' + r.resumen.yaCargadas);
  }
  if (r.detalles && r.detalles.length) {
    log.push('--- DETALLE (primeros 60) ---');
    r.detalles.slice(0, 60).forEach(function(d) {
      log.push('   Fila ' + d.fila + ' [' + d.estado + '] ' + (d.rut || '') + ' — ' + d.motivo);
    });
    if (r.detalles.length > 60) log.push('   ... y ' + (r.detalles.length - 60) + ' más.');
  }
  log.push('Recuerda BORRAR RUT_MANTENCION al terminar.');

  Logger.log(log.join(String.fromCharCode(10)));

  // Devuelve el resumen y NUNCA los detalles: nombran RUTs de socios, y una
  // función sin argumentos es invocable de forma anónima. El detalle se queda
  // en el Logger, dentro del proyecto.
  return r.resumen;
}

/** Simula la siembra del calendario. Requiere `PERMITIR_SIEMBRA_HISTORICA` = SIMULAR. */
function _simularSiembraDesdeCargaHistorica() {
  return _siembraHistoricaDesdeEditor('SIMULAR');
}

/** Aplica la siembra del calendario. Requiere `PERMITIR_SIEMBRA_HISTORICA` = APLICAR. */
function _aplicarSiembraDesdeCargaHistorica() {
  return _siembraHistoricaDesdeEditor('APLICAR');
}

function _siembraHistoricaDesdeEditor(modoEsperado) {
  _ensureConfig();
  var props = PropertiesService.getScriptProperties();
  var modo = String(props.getProperty('PERMITIR_SIEMBRA_HISTORICA') || '').trim().toUpperCase();
  props.deleteProperty('PERMITIR_SIEMBRA_HISTORICA');

  if (modo !== modoEsperado) {
    Logger.log('Puerta cerrada. Crea la propiedad PERMITIR_SIEMBRA_HISTORICA con el valor "' +
               modoEsperado + '" y vuelve a ejecutar. (Se borra sola en cada intento.)');
    return;
  }

  var rutAdmin = String(props.getProperty('RUT_MANTENCION') || '').trim();
  if (!rutAdmin) {
    Logger.log('Falta la propiedad RUT_MANTENCION con un RUT ADMIN. Recuerda BORRARLA al terminar.');
    return;
  }

  var r = sembrarCatalogoDesdeCargaHistorica(rutAdmin, modoEsperado === 'APLICAR');

  var log = ['===== SIEMBRA DEL CALENDARIO (' + modoEsperado + ') ====='];
  log.push(r.message || '');
  if (r.resumen) {
    log.push('   Pares zona+mes en la carga: ' + r.resumen.pares);
    log.push('   Asambleas nuevas: ' + r.resumen.nuevas);
    log.push('   Ya estaban en el calendario: ' + r.resumen.yaExistian);
    log.push('   Con error: ' + r.resumen.errores);
  }
  if (r.detalles && r.detalles.length) {
    log.push('--- ASAMBLEAS ---');
    r.detalles.forEach(function(d) {
      log.push('   ' + d.mes + '  ' + d.region + '  (' + d.socios + ' socios cargados)' +
               (d.motivo ? ' — ' + d.motivo : ''));
    });
  }
  log.push('Recuerda BORRAR RUT_MANTENCION al terminar.');
  Logger.log(log.join(String.fromCharCode(10)));

  // Sólo el resumen: el detalle nombra zonas y volúmenes, y esto es invocable
  // de forma anónima. El listado completo se queda en el Logger.
  return r.resumen;
}

/**
 * Estado de la carga histórica: qué hay cargado, de qué meses y qué zonas.
 *
 * Sin parámetros y sólo lectura. No devuelve nada por la misma razón de siempre:
 * el informe nombra zonas y cantidades por socio, y esto es invocable de forma
 * anónima. Se lee en el Logger.
 */
function _diagnosticarAsistenciaHistorica() {
  _ensureConfig();
  var log = ['===== ASISTENCIA HISTÓRICA =====', ''];

  try {
    var hoja = _hojaAsistenciaHistorica(false);
    if (!hoja) {
      log.push('La hoja "' + HOJA_ASISTENCIA_HISTORICA + '" todavía no existe.');
      log.push('Ejecuta _prepararHojaAsistenciaHistorica() para crearla.');
      Logger.log(log.join(String.fromCharCode(10)));
      return;
    }

    var idx = _indicesAsistenciaHistorica(hoja);
    var faltantes = [];
    CFG_ASISTENCIA_HISTORICA.ENCABEZADOS.forEach(function(n) {
      if (idx[n] === undefined) faltantes.push(n);
    });
    log.push('Hoja: ' + HOJA_ASISTENCIA_HISTORICA + ' (' + Math.max(hoja.getLastRow() - 1, 0) + ' filas)');
    log.push('Columnas faltantes: ' + (faltantes.length ? faltantes.join(', ') : 'ninguna'));
    log.push('');

    if (hoja.getLastRow() < 2) {
      log.push('Sin filas cargadas todavía.');
      Logger.log(log.join(String.fromCharCode(10)));
      return;
    }

    var datos = hoja.getRange(2, 1, hoja.getLastRow() - 1, hoja.getLastColumn()).getValues();
    var porEstado = {}, porMes = {}, zonasPorMes = {};

    for (var i = 0; i < datos.length; i++) {
      if (_filaVaciaHistorico(datos[i], idx)) continue;

      var estado = String(datos[i][idx.ESTADO_CARGA] || '').trim().toUpperCase() || '(vacío)';
      porEstado[estado] = (porEstado[estado] || 0) + 1;

      if (estado !== CFG_ASISTENCIA_HISTORICA.ESTADO.CARGADA) continue;

      var mes = _normalizarMesHistorico(datos[i][idx.MES]);
      if (!mes) continue;
      porMes[mes] = (porMes[mes] || 0) + 1;

      var zona = _normalizarRegionParaComparar(datos[i][idx.REGION]);
      if (!zona) zona = '(sin zona)';
      if (!zonasPorMes[mes]) zonasPorMes[mes] = {};
      zonasPorMes[mes][zona] = (zonasPorMes[mes][zona] || 0) + 1;
    }

    log.push('--- POR ESTADO ---');
    Object.keys(porEstado).sort().forEach(function(e) { log.push('   ' + e + ': ' + porEstado[e]); });

    log.push('');
    log.push('--- MESES CARGADOS (los que se destraban) ---');
    var meses = Object.keys(porMes).sort();
    if (!meses.length) {
      log.push('   Ninguno: nada aplicado todavía.');
    } else {
      meses.forEach(function(m) {
        var zonas = Object.keys(zonasPorMes[m] || {}).sort();
        log.push('   ' + m + ': ' + porMes[m] + ' socios, ' + zonas.length + ' zonas');
        zonas.forEach(function(z) { log.push('        · ' + z + ': ' + zonasPorMes[m][z]); });
      });
    }

    log.push('');
    log.push('Corte general vigente: ' + CFG_PARTICIPACION.INICIO_DATOS_EVALUABLES +
             ' — los meses anteriores sólo se evalúan en las zonas listadas arriba.');

  } catch (e) {
    log.push('❌ ' + e.toString());
  }

  Logger.log(log.join(String.fromCharCode(10)));
}

/**
 * Crea o repara la hoja de carga. Sin parámetros, idempotente y sin riesgo: no
 * escribe datos, sólo encabezados y formato.
 */
function _prepararHojaAsistenciaHistorica() {
  _ensureConfig();
  var hoja = _hojaAsistenciaHistorica(true);
  Logger.log('Hoja "' + HOJA_ASISTENCIA_HISTORICA + '" lista en el spreadsheet de justificaciones.' +
             String.fromCharCode(10) +
             'Columnas que llenas tú: ' + CFG_ASISTENCIA_HISTORICA.COLUMNAS_DEL_OPERADOR.join(', ') + '.' +
             String.fromCharCode(10) +
             'El resto las completa el sistema al validar.');
  return hoja.getName();
}
