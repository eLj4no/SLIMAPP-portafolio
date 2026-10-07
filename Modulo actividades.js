// ============================================================================
// CATÁLOGO DE ACTIVIDADES SINDICALES
// ============================================================================
// Registro append-only de las actividades del sindicato (asambleas, reuniones),
// una fila por actividad y región. Es el CALENDARIO del sindicato: la lista de
// lo que hubo, independiente de quién participó.
//
// ¿POR QUÉ EXISTE? Porque hasta ahora el sistema sabía lo que cada socio HIZO,
// pero no lo que DEBÍA hacer. Sin esa lista no hay denominador: un socio que
// nunca asistió ni justificó no tiene ningún registro, así que la vista de
// participación no puede distinguir "no hubo actividad ese mes" de "hubo y no
// participaste" — que son cosas opuestas. Con el catálogo, la participación se
// puede expresar contra el total real de actividades del año.
//
// ⚠️ CONFIG_JUSTIFICACIONES NO SIRVE PARA ESTO, y es el error fácil de cometer.
//    Esa hoja tiene UNA fila por región y `actualizarSwitchJustificaciones()`
//    la SOBRESCRIBE (`setValues` sobre la fila de la región) cada vez que se
//    configura la actividad siguiente: al cargar la asamblea de septiembre de
//    la RM, la de agosto desaparece. Es el estado VIGENTE, no un historial.
//    Este catálogo existe justamente para conservar lo que allá se pierde.
//
// La hoja vive dentro del spreadsheet de JUSTIFICACIONES, como
// CONFIG_JUSTIFICACIONES: así queda cubierta por el respaldo semanal sin
// cablear nada nuevo (`respaldarBasesDeDatos` recorre CONFIG.SPREADSHEETS).

// El nombre de la hoja es una constante LOCAL, no una clave de CONFIG.HOJAS.
// Mismo criterio que HOJA_PERMISOS_ARCHIVOS y HOJA_REGISTROS_ELIMINADOS: una
// clave en CONFIG obligaría a correr un `_configurar*()` por entorno antes de
// que el módulo funcione, y este se auto-repara solo.
//
// Se llama CATALOGO_ACTIVIDADES y no ACTIVIDADES_SINDICALES a propósito: ese
// otro nombre pertenece al registro del sistema de asistencia que se retiró, y
// sigue como clave residual en la semilla de config_local.js. Reutilizarlo
// invitaría a confundir dos cosas distintas.
var HOJA_CATALOGO_ACTIVIDADES = 'CATALOGO_ACTIVIDADES';

var CFG_CATALOGO_ACTIVIDADES = {
  ZONA_HORARIA: 'America/Santiago',

  // Encabezados en orden. Se resuelven POR NOMBRE (no por índice fijo), así que
  // agregar una columna más adelante no rompe nada ya escrito.
  ENCABEZADOS: [
    'CODIGO',          // Identificador único: ASAMBLEA_<REGION>_<YYYY_MM_DD>
    'NOMBRE',          // "Asamblea Ordinaria", "Reunión Informativa"...
    'REGION',
    'FECHA_EVENTO',    // Fecha real del evento (Date), cuando se conoce
    'FECHA_LIMITE',    // Plazo que tuvo el socio para justificar esa actividad
    'ANIO',            // "2026"  — redundante con FECHA_EVENTO, pero filtrar por
    'MES',             // "2026-08"  año/mes es la consulta natural de la vista
    'PRECISION',       // EXACTA (se conoce el dia) | MENSUAL (solo mes)
    'ORIGEN',          // JUSTIFICACIONES | BRIGADA | MANUAL
    'FECHA_REGISTRO',  // Cuándo entró al catálogo (reloj del servidor)
    'REGISTRADO_POR'   // RUT o proceso que la registró
  ],

  ORIGEN: {
    JUSTIFICACIONES: 'JUSTIFICACIONES',
    BRIGADA:         'BRIGADA',
    MANUAL:          'MANUAL'
  },

  PRECISION: {
    EXACTA:  'EXACTA',    // se conoce el dia del evento
    MENSUAL: 'MENSUAL'    // solo se conoce el mes: los codigos de asamblea de
  },                      // justificaciones son YYYY_MM y no traen dia

  // Valores de region que NO identifican una actividad. "S/D" es el centinela
  // de "sin dato" del sistema de origen: son marcajes a los que no se les pudo
  // asignar region, no una region propia.
  REGIONES_INVALIDAS: ['S/D', 'SD', 'SIN DATO', 'SIN REGION'],

  // Una actividad de prueba no pertenece al calendario oficial del sindicato.
  // Se compara en minusculas sobre el nombre de la actividad.
  PATRONES_ACTIVIDAD_EXCLUIDA: ['prueba', 'test']
};

// ============================================================================
// ESCRITURA (append-only)
// ============================================================================

/**
 * Registra una actividad en el catálogo si todavía no está.
 *
 * IDEMPOTENTE por CODIGO: llamarla dos veces con los mismos datos deja una sola
 * fila. Eso importa porque el hook de justificaciones se dispara en cada cambio
 * del switch, y un admin puede habilitar/deshabilitar la misma actividad varias
 * veces.
 *
 * NUNCA LANZA. Se la llama desde el flujo interactivo del admin (configurar la
 * justificación), y una falla acá no puede impedirle hacer su trabajo: el
 * catálogo es un registro paralelo, no parte del trámite.
 *
 * @param {{nombre, region, fechaEvento, origen, registradoPor}} datos
 * @return {{success: boolean, codigo: string, yaExistia: boolean, message: string}}
 */
function registrarActividadCatalogo(datos) {
  try {
    _ensureConfig();

    datos = datos || {};
    var region      = String(datos.region || '').trim();
    var nombre      = String(datos.nombre || '').trim() || 'Asamblea';
    var fechaEvento = parsearFechaFlexible(datos.fechaEvento);
    var origen      = String(datos.origen || CFG_CATALOGO_ACTIVIDADES.ORIGEN.MANUAL).trim();

    // Sin región o sin fecha no hay identidad posible: se prefiere no registrar
    // antes que ensuciar el catálogo con filas que después nadie puede cruzar.
    if (!region) return { success: false, codigo: '', yaExistia: false, message: 'Falta la región.' };

    var motivoExclusion = _motivoExclusionActividad(region, nombre);
    if (motivoExclusion) {
      return { success: false, codigo: '', yaExistia: false, message: 'Excluida: ' + motivoExclusion };
    }
    if (!fechaEvento && !datos.mes) {
      return { success: false, codigo: '', yaExistia: false, message: 'Falta la fecha del evento.' };
    }

    var mes    = datos.mes ? _normalizarMesCatalogo(datos.mes) : _mesDeFecha(fechaEvento);
    var codigo = _codigoActividad(region, fechaEvento, mes);

    var hoja = _asegurarHojaCatalogoActividades();
    var COL  = _indicesCatalogoActividades(hoja);

    // ¿Ya está? El catálogo es chico (decenas de filas al año), así que una
    // lectura completa es más simple y barata que mantener un índice.
    var lastRow = hoja.getLastRow();
    if (lastRow >= 2) {
      var codigos = hoja.getRange(2, COL.CODIGO + 1, lastRow - 1, 1).getValues();
      for (var i = 0; i < codigos.length; i++) {
        if (String(codigos[i][0]).trim() === codigo) {
          return { success: true, codigo: codigo, yaExistia: true, message: 'La actividad ya estaba en el catálogo.' };
        }
      }
    }

    var fila = new Array(CFG_CATALOGO_ACTIVIDADES.ENCABEZADOS.length).fill('');
    fila[COL.CODIGO]         = codigo;
    fila[COL.NOMBRE]         = nombre;
    fila[COL.REGION]         = region;
    fila[COL.FECHA_EVENTO]   = fechaEvento || '';
    fila[COL.FECHA_LIMITE]   = parsearFechaFlexible(datos.fechaLimite) || '';
    fila[COL.ANIO]           = mes ? mes.split('-')[0] : '';
    fila[COL.MES]            = mes || '';
    fila[COL.PRECISION]      = fechaEvento ? CFG_CATALOGO_ACTIVIDADES.PRECISION.EXACTA
                                           : CFG_CATALOGO_ACTIVIDADES.PRECISION.MENSUAL;
    fila[COL.ORIGEN]         = origen;
    fila[COL.FECHA_REGISTRO] = new Date();
    fila[COL.REGISTRADO_POR] = String(datos.registradoPor || 'SISTEMA').trim();

    hoja.appendRow(fila);
    _invalidarCacheCatalogo();

    return { success: true, codigo: codigo, yaExistia: false, message: 'Actividad registrada en el catálogo.' };

  } catch (e) {
    // Se registra y se sigue: el trámite del admin manda.
    Logger.log('⚠️ registrarActividadCatalogo: ' + e.toString());
    return { success: false, codigo: '', yaExistia: false, message: 'No se pudo registrar la actividad.' };
  }
}

// ============================================================================
// LECTURA (la vista anual consume esto)
// ============================================================================

/**
 * Devuelve las actividades del catálogo, opcionalmente filtradas por año.
 *
 * Es lectura pública del CALENDARIO del sindicato: no contiene datos de
 * personas, así que no necesita token de sesión ni filtro por RUT. Quién
 * participó de cada actividad es otra pregunta, y la responde
 * Modulo participacion.js.
 *
 * @param {string|number} anio Año a filtrar; vacío devuelve todo.
 * @return {{success: boolean, actividades: Array, message: string}}
 */
var CACHE_CATALOGO_CLAVE = 'catalogo_actividades_v1';
var CACHE_CATALOGO_SEG   = 300;

/** Invalida la cache del catalogo. Se llama al escribir en el. */
function _invalidarCacheCatalogo() {
  try { CacheService.getScriptCache().remove(CACHE_CATALOGO_CLAVE); } catch (e) {}
}

function obtenerCatalogoActividades(anio) {
  _ensureConfig();

  try {
    var filtro = String(anio || '').trim();

    // El catalogo es el CALENDARIO del sindicato: no contiene datos de
    // personas, asi que se puede cachear una sola vez para todos en vez de por
    // socio. Se guarda completo y el filtro por anio se aplica en memoria, para
    // no abrir la planilla una vez por cada anio consultado.
    try {
      var enCache = CacheService.getScriptCache().get(CACHE_CATALOGO_CLAVE);
      if (enCache) {
        var todas = JSON.parse(enCache);
        return {
          success: true,
          actividades: filtro ? todas.filter(function(a) { return a.anio === filtro; }) : todas,
          message: ''
        };
      }
    } catch (eC) {
      Logger.log('⚠️ Cache del catálogo ilegible, se relee — ' + eC.toString());
    }

    var hoja = _asegurarHojaCatalogoActividades();
    var COL  = _indicesCatalogoActividades(hoja);
    var lastRow = hoja.getLastRow();

    if (lastRow < 2) return { success: true, actividades: [], message: '' };

    var datos = hoja.getRange(2, 1, lastRow - 1, hoja.getLastColumn()).getValues();
    var filtro = String(anio || '').trim();
    var TZ = CFG_CATALOGO_ACTIVIDADES.ZONA_HORARIA;
    var salida = [];

    for (var i = 0; i < datos.length; i++) {
      // Tolerante a que Sheets haya convertido el mes en Date: las filas
      // escritas antes de forzar el formato texto vienen asi.
      var mes = _mesDesdeCeldaCatalogo(datos[i][COL.MES]);
      var anioFila = String(datos[i][COL.ANIO] || '').trim() || (mes ? mes.split('-')[0] : '');

      var fechaEvento = parsearFechaFlexible(datos[i][COL.FECHA_EVENTO]);

      var nombreCrudo = String(datos[i][COL.NOMBRE] || '').trim();
      var regionCruda = String(datos[i][COL.REGION] || '').trim();
      var pNombre = _presentarNombreActividad(nombreCrudo, regionCruda);
      var pRegion = _presentarRegion(regionCruda);

      salida.push({
        codigo:    String(datos[i][COL.CODIGO] || '').trim(),
        nombre:    nombreCrudo,
        region:    regionCruda,
        // Campos listos para pantalla (derivados, no almacenados)
        nombreCorto: pNombre.nombre,
        modalidad:   pNombre.modalidad,
        regionCorta: pRegion.region,
        sede:        pRegion.sede,
        mes:       mes,
        anio:      anioFila,
        fecha:     fechaEvento ? Utilities.formatDate(fechaEvento, TZ, 'dd-MM-yyyy') : '',
        fechaLimite: (function(){ var fl = parsearFechaFlexible(datos[i][COL.FECHA_LIMITE]);
                                  return fl ? Utilities.formatDate(fl, TZ, 'dd-MM-yyyy') : ''; })(),
        fechaOrden: fechaEvento ? fechaEvento.getTime() : null,
        // Timestamp del plazo para justificar. Lo usa la participacion para no
        // marcar falta mientras el socio todavia puede justificar.
        fechaLimiteOrden: (function(){ var fl = parsearFechaFlexible(datos[i][COL.FECHA_LIMITE]);
                                       return fl ? fl.getTime() : null; })(),
        precision: String(datos[i][COL.PRECISION] || '').trim(),
        origen:    String(datos[i][COL.ORIGEN] || '').trim()
      });
    }

    // De la más reciente a la más antigua, igual que el resto de los historiales.
    salida.sort(function(a, b) {
      if (a.fechaOrden === null && b.fechaOrden === null) return a.mes < b.mes ? 1 : -1;
      if (a.fechaOrden === null) return 1;
      if (b.fechaOrden === null) return -1;
      return b.fechaOrden - a.fechaOrden;
    });

    try {
      CacheService.getScriptCache().put(CACHE_CATALOGO_CLAVE, JSON.stringify(salida), CACHE_CATALOGO_SEG);
    } catch (ePut) {
      Logger.log('⚠️ No se pudo cachear el catálogo — ' + ePut.toString());
    }

    return {
      success: true,
      actividades: filtro ? salida.filter(function(a) { return a.anio === filtro; }) : salida,
      message: ''
    };

  } catch (e) {
    Logger.log('❌ obtenerCatalogoActividades: ' + e.toString());
    return { success: false, actividades: [], message: 'No se pudo cargar el catálogo de actividades.' };
  }
}

/**
 * Años que tienen al menos una actividad registrada, del más reciente al más
 * antiguo.
 *
 * La vista anual se arma con esto en vez de con una regla de fecha (del tipo
 * "después del 20 de diciembre, mostrar el año siguiente"): una regla así hay
 * que mantenerla y se rompe sola si en diciembre se agenda una actividad para
 * enero. Que el año lo determinen los datos no necesita mantención.
 */
function obtenerAniosCatalogoActividades() {
  _ensureConfig();

  try {
    var r = obtenerCatalogoActividades('');
    if (!r.success) return { success: false, anios: [], message: r.message };

    var vistos = {};
    r.actividades.forEach(function(a) { if (a.anio) vistos['a' + a.anio] = a.anio; });

    var anios = Object.keys(vistos).map(function(k) { return vistos[k]; });
    anios.sort(function(x, y) { return y.localeCompare(x); });

    return { success: true, anios: anios, message: '' };

  } catch (e) {
    Logger.log('❌ obtenerAniosCatalogoActividades: ' + e.toString());
    return { success: false, anios: [], message: 'No se pudieron cargar los años.' };
  }
}

/**
 * Borra TODAS las filas de datos del catalogo, dejando los encabezados.
 *
 * Existe para una sola situacion: resembrar despues de corregir como se
 * interpretan los datos de origen. El catalogo es estado DERIVADO — se
 * reconstruye entero desde justificaciones y Brigada — asi que vaciarlo no
 * pierde nada que no se pueda volver a calcular. No hay ningun dato de socios
 * aqui.
 *
 * ADMIN-only. Pide confirmacion explicita para no borrarse de un click.
 */
function limpiarCatalogoActividades(rutSolicitante, confirmar) {
  _ensureConfig();
  try {
    var verificacion = verificarRolUsuario(rutSolicitante, ['ADMIN']);
    if (!verificacion.autorizado) {
      Logger.log('⚠️ limpiarCatalogoActividades: intento no autorizado — RUT=' + rutSolicitante);
      return { success: false, message: 'No autorizado.' };
    }
    if (confirmar !== true) {
      return { success: false, message: 'Falta confirmar: llama con confirmar = true.' };
    }

    var hoja = _asegurarHojaCatalogoActividades();
    var filas = hoja.getLastRow() - 1;
    if (filas > 0) hoja.deleteRows(2, filas);
    _forzarColumnasTextoCatalogo(hoja);
    _invalidarCacheCatalogo();

    Logger.log('🧹 Catalogo vaciado: ' + filas + ' fila(s) eliminadas. Ahora puedes resembrar.');
    return { success: true, eliminadas: filas, message: 'Catalogo vaciado: ' + filas + ' fila(s).' };

  } catch (e) {
    Logger.log('❌ limpiarCatalogoActividades: ' + e.toString());
    return { success: false, message: e.toString() };
  }
}

/** Atajo de editor. Requiere RUT_MANTENCION. Ver la advertencia de arriba. */
function _limpiarCatalogoDesdeEditor() {
  var rut = PropertiesService.getScriptProperties().getProperty('RUT_MANTENCION');
  if (!rut) {
    Logger.log('❌ Falta RUT_MANTENCION.');
    return { success: false, message: 'Falta configurar RUT_MANTENCION.' };
  }
  return limpiarCatalogoActividades(rut, true);
}

/**
 * Elimina del catalogo las actividades que ninguna fuente oficial respalda.
 *
 * REGLA (definida por la organizacion): una actividad existe si esta en
 * CONFIG_JUSTIFICACIONES, es decir si se le programo un plazo de justificacion.
 * Brigada aporta ASISTENCIA, no calendario.
 *
 * ¿POR QUE HIZO FALTA? La siembra inicial dedujo actividades de los marcajes:
 * "hay marcajes el 17 => hubo actividad el 17". El contraste de fuentes del
 * 31-08-2026 mostro que eso es falso. Para agosto, justificaciones tiene un
 * unico codigo (2026-08-15) mientras Brigada registra marcajes el 15 (861 en la
 * RM) y el 17 (14): los del 17 son socios que llenaron el formulario virtual
 * dos dias tarde, no una segunda asamblea. El catalogo mostraba asi asambleas
 * que nunca ocurrieron, y a los socios les aparecian actividades inventadas.
 *
 * Una actividad se considera respaldada si su REGION + DIA coincide con:
 *   - una fila de CONFIG_JUSTIFICACIONES (actividad programada), o
 *   - un codigo de asamblea de BD_JUSTIFICACIONES (alguien justifico para ella).
 *
 * ADMIN-only, SIMULACION salvo aplicarCambios === true. Idempotente.
 */
function purgarActividadesSinRespaldo(rutSolicitante, aplicarCambios) {
  _ensureConfig();

  try {
    var verificacion = verificarRolUsuario(rutSolicitante, ['ADMIN']);
    if (!verificacion.autorizado) {
      Logger.log('purgarActividadesSinRespaldo: intento no autorizado - RUT=' + rutSolicitante);
      return { success: false, message: 'No autorizado.' };
    }

    var ssJ = getSpreadsheet('JUSTIFICACIONES');

    // FECHAS avaladas POR MES (no por region), en formato "yyyy-MM|dd-MM-yyyy".
    //
    // La primera version de esta funcion exigia respaldo por REGION y estuvo a
    // punto de borrar 6 asambleas reales del 15-08: en Rancagua, Puerto Montt,
    // Iquique, Talca, Copiapo y Arica hubo asamblea (hay marcajes) pero NADIE
    // justifico, asi que no existe codigo de asamblea para esas regiones. Sin
    // tramite no hay evidencia por region, y castigar eso borra actividad real.
    //
    // Lo que si es solido es la FECHA: las asambleas son nacionales y del mismo
    // dia. En agosto todos los codigos dicen 2026-08-15 y ninguno dice 17, asi
    // que el 17 no fue una asamblea en NINGUNA region.
    var fechasAvaladasPorMes = {};   // "2026-08" -> { "15-08-2026": true }

    function avalarFecha(fecha) {
      if (!fecha) return;
      var mes = _mesDeFecha(fecha);
      var dia = Utilities.formatDate(fecha, CFG_CATALOGO_ACTIVIDADES.ZONA_HORARIA, 'dd-MM-yyyy');
      if (!fechasAvaladasPorMes[mes]) fechasAvaladasPorMes[mes] = {};
      fechasAvaladasPorMes[mes][dia] = true;
    }

    // --- Respaldo 1: actividades programadas (la fuente de verdad) ---
    var hojaCfg = ssJ.getSheetByName(CONFIG.HOJAS.CONFIG_JUSTIFICACIONES);
    if (hojaCfg && hojaCfg.getLastRow() >= 2) {
      var dCfg = hojaCfg.getRange(2, 1, hojaCfg.getLastRow() - 1, 5).getValues();
      dCfg.forEach(function(f) {
        avalarFecha(parsearFechaFlexible(f[3]));
      });
    }

    // --- Respaldo 2: alguien justifico para esa asamblea ---
    var hojaJ = ssJ.getSheetByName(CONFIG.HOJAS.JUSTIFICACIONES);
    var COLJ = CONFIG.COLUMNAS.JUSTIFICACIONES;
    if (hojaJ && hojaJ.getLastRow() >= 2) {
      var dJ = hojaJ.getRange(2, 1, hojaJ.getLastRow() - 1, hojaJ.getLastColumn()).getValues();
      dJ.forEach(function(f) {
        avalarFecha(_fechaDesdeCodigoAsamblea(String(f[COLJ.ASAMBLEA] || '').trim()));
      });
    }

    // --- Revisar el catalogo ---
    var hoja = _asegurarHojaCatalogoActividades();
    var COL = _indicesCatalogoActividades(hoja);
    if (hoja.getLastRow() < 2) {
      return { success: true, sinRespaldo: 0, message: 'El catalogo esta vacio.' };
    }

    var datos = hoja.getRange(2, 1, hoja.getLastRow() - 1, hoja.getLastColumn()).getValues();
    var aBorrar = [], detalle = [];

    for (var i = 0; i < datos.length; i++) {
      var codigo = String(datos[i][COL.CODIGO] || '').trim();
      if (!codigo) continue;

      var feFila = parsearFechaFlexible(datos[i][COL.FECHA_EVENTO]);
      var mesFila = _mesDesdeCeldaCatalogo(datos[i][COL.MES]);
      var avaladasDelMes = fechasAvaladasPorMes[mesFila];

      // Sin ninguna fecha avalada en ese mes no hay con que contrastar: no se
      // borra nada. Ausencia de evidencia no es evidencia de ausencia.
      if (!avaladasDelMes || !Object.keys(avaladasDelMes).length) continue;

      var diaFila = feFila
        ? Utilities.formatDate(feFila, CFG_CATALOGO_ACTIVIDADES.ZONA_HORARIA, 'dd-MM-yyyy')
        : '';
      if (diaFila && avaladasDelMes[diaFila]) continue;

      aBorrar.push(i + 2);   // numero de fila real
      detalle.push(codigo + '  (origen=' + String(datos[i][COL.ORIGEN] || '') +
                   ', fecha=' + (diaFila || 'sin fecha') + ')');
    }

    var msg = (aplicarCambios === true ? 'PURGA APLICADA' : 'SIMULACION (no se borro nada)') +
              '\nActividades en el catalogo: ' + datos.length +
              '\nEn una fecha avalada: ' + (datos.length - aBorrar.length) +
              '\nSIN respaldo: ' + aBorrar.length;
    Logger.log(msg);
    detalle.slice(0, 30).forEach(function(d) { Logger.log('   ' + d); });

    if (aplicarCambios === true && aBorrar.length) {
      // De abajo hacia arriba: borrar por arriba correria los indices restantes.
      aBorrar.sort(function(a, b) { return b - a; });
      aBorrar.forEach(function(fila) { hoja.deleteRow(fila); });
      _invalidarCacheCatalogo();
      Logger.log('Filas eliminadas: ' + aBorrar.length);
    }

    return { success: true, sinRespaldo: aBorrar.length, total: datos.length,
             aplicado: (aplicarCambios === true), message: msg };

  } catch (e) {
    Logger.log('purgarActividadesSinRespaldo: ' + e.toString());
    return { success: false, message: e.toString() };
  }
}

/** Atajos de editor. Requieren RUT_MANTENCION; borrala al terminar. */
function _simularPurgaActividades() { return _correrPurgaActividades(false); }
function _aplicarPurgaActividades() { return _correrPurgaActividades(true); }

function _correrPurgaActividades(aplicar) {
  var rut = PropertiesService.getScriptProperties().getProperty('RUT_MANTENCION');
  if (!rut) {
    Logger.log('Falta la propiedad RUT_MANTENCION (RUT de un ADMIN).');
    return { success: false, message: 'Falta configurar RUT_MANTENCION.' };
  }
  return purgarActividadesSinRespaldo(rut, aplicar);
}

// ============================================================================
// SINCRONIZACIÓN CONTINUA DESDE CONFIG_JUSTIFICACIONES
// ============================================================================

/**
 * Copia al catálogo toda actividad que esté hoy en CONFIG_JUSTIFICACIONES y no
 * haya sido registrada todavía.
 *
 * ¿POR QUÉ, SI YA SE COPIA AL CONFIGURARLA? Porque los hooks de
 * `Modulo justificaciones.js` sólo se disparan cuando el admin pasa por el
 * panel. Si edita la hoja A MANO — que es perfectamente posible y ocurre —
 * ningún código se entera:
 *
 *   - crea o cambia una fila a mano  → nunca se registró en el catálogo;
 *   - borra filas a mano             → `eliminarConfigRegionJustificaciones`
 *                                      no corre, y con ella se va el único
 *                                      registro que existía de esa actividad.
 *
 * Este barrido no depende de que nadie use el panel: mira el estado real de la
 * hoja. Mientras la fila exista, la actividad queda copiada; después se puede
 * borrar a mano sin perder nada.
 *
 * Sin argumentos y sin datos personales, para poder colgarla de un trigger.
 * Es idempotente: `registrarActividadCatalogo()` no duplica por código.
 */
function sincronizarCatalogoDesdeConfig(e) {
  if (activadorFueraDeProduccion_(e, 'sincronizarCatalogoDesdeConfig')) return;
  _ensureConfig();

  var resultado = { revisadas: 0, nuevas: 0, yaEstaban: 0, sinFecha: 0, errores: [] };

  try {
    var ss = getSpreadsheet('JUSTIFICACIONES');
    var hojaConfig = ss.getSheetByName(CONFIG.HOJAS.CONFIG_JUSTIFICACIONES);

    if (!hojaConfig || hojaConfig.getLastRow() < 2) {
      Logger.log('ℹ️ sincronizarCatalogoDesdeConfig: no hay configuraciones que revisar.');
      return resultado;
    }

    // Las 5 columnas de CONFIG_JUSTIFICACIONES:
    // REGION | Habilitado | Fecha Limite | Fecha_Evento | Nombre_Actividad
    var filas = hojaConfig.getRange(2, 1, hojaConfig.getLastRow() - 1, 5).getValues();

    for (var i = 0; i < filas.length; i++) {
      var region = String(filas[i][0] || '').trim();
      if (!region) continue;

      resultado.revisadas++;

      // Sin fecha de evento no hay identidad de actividad posible. No es un
      // error: puede ser una fila a medio configurar.
      if (!filas[i][3]) { resultado.sinFecha++; continue; }

      // Se registra esté habilitada o no: una actividad ya cerrada (switch
      // apagado porque venció el plazo) igual ocurrió, y es justamente la que
      // interesa conservar antes de que la sobrescriban.
      var r = registrarActividadCatalogo({
        nombre: String(filas[i][4] || '').trim() || 'Asamblea',
        region: region,
        fechaEvento: filas[i][3],
        fechaLimite: filas[i][2],
        origen: CFG_CATALOGO_ACTIVIDADES.ORIGEN.JUSTIFICACIONES,
        registradoPor: 'SINCRONIZACION'
      });

      if (r.success && r.yaExistia) resultado.yaEstaban++;
      else if (r.success) resultado.nuevas++;
      else resultado.errores.push(region + ': ' + r.message);
    }

    Logger.log('🔄 sincronizarCatalogoDesdeConfig — revisadas: ' + resultado.revisadas +
               ' | nuevas: ' + resultado.nuevas +
               ' | ya estaban: ' + resultado.yaEstaban +
               ' | sin fecha: ' + resultado.sinFecha +
               (resultado.errores.length ? ' | errores: ' + resultado.errores.join(' / ') : ''));

  } catch (e) {
    // Corre desde un trigger: nunca debe quedar como ejecución fallida por algo
    // que se resuelve solo en la pasada siguiente.
    Logger.log('⚠️ sincronizarCatalogoDesdeConfig: ' + e.toString());
    resultado.errores.push(e.toString());
  }

  return resultado;
}

// ============================================================================
// SIEMBRA DEL HISTORIAL
// ============================================================================

/**
 * Reconstruye el catálogo hacia atrás desde los datos que ya existen.
 *
 * CONFIG_JUSTIFICACIONES no guarda historial, pero las actividades pasadas
 * dejaron huella en dos lugares:
 *   1. BD_JUSTIFICACIONES — cada justificación guarda su código de asamblea y
 *      la región del socio.
 *   2. La planilla de Brigada — cada marcaje guarda el nombre de la actividad y
 *      su fecha. Cubre las actividades donde hubo asistencia pero nadie
 *      justificó, que la fuente 1 no puede ver.
 *
 * ADMIN-only y en SIMULACIÓN salvo que `aplicarCambios === true` — mismo patrón
 * que `normalizarTelefonosUsuarios()`. Es idempotente: registrar dos veces la
 * misma actividad no duplica filas.
 *
 * @param {string} rutSolicitante RUT ADMIN.
 * @param {boolean} aplicarCambios true para escribir; cualquier otra cosa simula.
 */
function sembrarCatalogoActividades(rutSolicitante, aplicarCambios) {
  _ensureConfig();

  try {
    var verificacion = verificarRolUsuario(rutSolicitante, ['ADMIN']);
    if (!verificacion.autorizado) {
      Logger.log('⚠️ sembrarCatalogoActividades: intento no autorizado — RUT=' + rutSolicitante);
      return { success: false, message: 'No autorizado.' };
    }

    var candidatas  = {};   // codigo -> datos (lo que finalmente se escribe)
    var candidatasJ = {};   // region+mes -> datos, desde justificaciones
    var cubiertoBrigada = {};  // region+mes que Brigada ya resolvio con fecha exacta
    var resumen = { justificaciones: 0, brigada: 0, descartadasPorBrigada: 0,
                    excluidas: 0, nuevas: 0, yaExistian: 0, errores: [] };

    // --- Fuente 1: justificaciones ---
    try {
      var ssJ  = getSpreadsheet('JUSTIFICACIONES');
      var hojaJ = ssJ.getSheetByName(CONFIG.HOJAS.JUSTIFICACIONES);
      if (hojaJ && hojaJ.getLastRow() >= 2) {
        var COLJ = CONFIG.COLUMNAS.JUSTIFICACIONES;
        var datosJ = hojaJ.getRange(2, 1, hojaJ.getLastRow() - 1, hojaJ.getLastColumn()).getValues();

        for (var i = 0; i < datosJ.length; i++) {
          var region = String(datosJ[i][COLJ.REGION] || '').trim();
          var codAsamblea = String(datosJ[i][COLJ.ASAMBLEA] || '').trim();
          if (!region) continue;

          // El código de asamblea viene como YYYY_MM_DD o YYYY_MM. La fecha de
          // la justificación es el respaldo: se justifica dentro del mismo mes.
          var fechaEvento = _fechaDesdeCodigoAsamblea(codAsamblea);
          var mes = _mesDesdeCodigoAsambleaCatalogo(codAsamblea) ||
                    _mesDeFecha(parsearFechaFlexible(datosJ[i][COLJ.FECHA]));
          if (!mes) continue;

          // Se acumulan aparte y con clave REGION+MES: los codigos de asamblea
          // de esta fuente casi siempre son mensuales (YYYY_MM) y no pueden
          // competir de igual a igual con la fecha exacta de Brigada. La fusion
          // ocurre mas abajo, una vez leidas las dos fuentes.
          // El nombre real viaja dentro del propio codigo de asamblea, despues
          // de la fecha: distingue modalidad (Presencial / Virtual) y sede,
          // mucho mejor que el "Asamblea" generico que se usaba antes.
          var nombreJ = _nombreDesdeCodigoAsamblea(codAsamblea) || 'Asamblea';

          var exclJ = _motivoExclusionActividad(region, nombreJ);
          if (exclJ) { resumen.excluidas++; continue; }

          // Clave CON DIA cuando el codigo lo trae (lo traen las 1.377 filas).
          // Agrupar por region+mes fundiria dos asambleas distintas del mismo
          // mes, que es un caso real y frecuente.
          var claveJ = _codigoActividad(region, fechaEvento, mes);
          if (candidatasJ[claveJ]) continue;

          candidatasJ[claveJ] = {
            nombre: nombreJ,
            region: region,
            fechaEvento: fechaEvento,
            mes: mes,
            origen: CFG_CATALOGO_ACTIVIDADES.ORIGEN.JUSTIFICACIONES,
            registradoPor: 'SIEMBRA'
          };
          resumen.justificaciones++;
        }
      }
    } catch (eJ) {
      resumen.errores.push('justificaciones: ' + eJ.message);
      Logger.log('⚠️ Siembra — justificaciones: ' + eJ.toString());
    }

    // --- Fuente 2: planilla de Brigada (SÓLO LECTURA, como siempre) ---
    try {
      var idBrigada = CONFIG.SPREADSHEETS.ASISTENCIA_BRIGADA;
      if (idBrigada) {
        var ssB = SpreadsheetApp.openById(idBrigada);
        var COLB = CFG_ASISTENCIA_BRIGADA.COL;

        CFG_ASISTENCIA_BRIGADA.HOJAS_A_LEER.forEach(function(nombreHoja) {
          var hojaB = ssB.getSheetByName(nombreHoja);
          if (!hojaB || hojaB.getLastRow() < 2) return;

          var datosB = hojaB.getRange(2, 1, hojaB.getLastRow() - 1,
                                      CFG_ASISTENCIA_BRIGADA.TOTAL_COLUMNAS).getValues();

          for (var b = 0; b < datosB.length; b++) {
            var actividad = String(datosB[b][COLB.ACTIVIDAD] || '').trim();
            var regionB   = String(datosB[b][COLB.REGION] || '').trim() || 'Sin región';
            if (!actividad) continue;

            var fechaB = parsearFechaFlexible(datosB[b][COLB.HORA_MARCAJE]) ||
                         parsearFechaFlexible(datosB[b][COLB.FECHA]);
            var mesB = _mesDeFecha(fechaB);
            if (!mesB) continue;

            var codigoB = _codigoActividad(regionB, fechaB, mesB);
            if (candidatas[codigoB]) continue;

            var exclB = _motivoExclusionActividad(regionB, actividad);
            if (exclB) { resumen.excluidas++; continue; }

            cubiertoBrigada[_codigoActividad(regionB, null, mesB)] = true;
            candidatas[codigoB] = {
              nombre: actividad,
              region: regionB,
              fechaEvento: fechaB,
              mes: mesB,
              origen: CFG_CATALOGO_ACTIVIDADES.ORIGEN.BRIGADA,
              registradoPor: 'SIEMBRA'
            };
            resumen.brigada++;
          }
        });
      }
    } catch (eB) {
      resumen.errores.push('brigada: ' + eB.message);
      Logger.log('⚠️ Siembra — brigada: ' + eB.toString());
    }

    // --- Escritura (o simulación) ---
    // Brigada manda cuando cubre ese region+mes: tiene la FECHA REAL del dia en
    // que la gente marco. La actividad de justificaciones para ese mismo
    // region+mes es la misma asamblea vista con menos precision, y agregarla
    // seria duplicarla -- fue exactamente lo que dio 37+24=61 sin fusionar.
    // Justificaciones solo aporta lo que Brigada no vio: actividades donde
    // nadie marco asistencia.
    // Ahora las dos fuentes identifican la actividad con el mismo nivel de
    // detalle (region + dia), asi que una misma asamblea produce EL MISMO
    // codigo en ambas y se fusiona sola. `cubiertoBrigada` se mantiene por si
    // alguna fila antigua no trae dia: en ese caso sigue cubriendo por mes.
    Object.keys(candidatasJ).forEach(function(clave) {
      if (candidatas[clave]) { resumen.descartadasPorBrigada++; return; }
      if (cubiertoBrigada[clave]) { resumen.descartadasPorBrigada++; return; }
      candidatas[clave] = candidatasJ[clave];
    });

    var codigos = Object.keys(candidatas);
    var detalle = [];

    if (aplicarCambios === true) {
      for (var c = 0; c < codigos.length; c++) {
        var r = registrarActividadCatalogo(candidatas[codigos[c]]);
        if (r.success && r.yaExistia) resumen.yaExistian++;
        else if (r.success) resumen.nuevas++;
        else resumen.errores.push(codigos[c] + ': ' + r.message);
      }
    } else {
      resumen.nuevas = codigos.length;
      detalle = codigos.slice(0, 25);
    }

    var msg = (aplicarCambios === true ? '✅ SIEMBRA APLICADA' : '🔎 SIMULACIÓN (no se escribió nada)') +
              '\nCandidatas desde justificaciones: ' + resumen.justificaciones +
              '\nCandidatas desde Brigada: ' + resumen.brigada +
              '\nJustificaciones descartadas por estar cubiertas por Brigada: ' + resumen.descartadasPorBrigada +
              '\nFilas excluidas (region sin dato / actividad de prueba): ' + resumen.excluidas +
              '\nActividades distintas: ' + codigos.length +
              '\nNuevas: ' + resumen.nuevas + ' | Ya estaban: ' + resumen.yaExistian +
              (resumen.errores.length ? '\nErrores: ' + resumen.errores.join(' | ') : '');

    Logger.log(msg);
    if (detalle.length) Logger.log('Ejemplos: ' + detalle.join(', '));

    return { success: true, resumen: resumen, codigos: codigos.length, message: msg };

  } catch (e) {
    Logger.log('❌ sembrarCatalogoActividades: ' + e.toString());
    return { success: false, message: 'Error en la siembra: ' + e.toString() };
  }
}

// ============================================================================
// INTERNOS
// ============================================================================

/**
 * Devuelve la hoja del catálogo, creándola o reparándola si hace falta.
 * Self-repairing como `_asegurarHojaPermisosArchivos()`: sin paso manual de
 * configuración y sin romperse si alguien agregó una columna a mano.
 */
function _asegurarHojaCatalogoActividades() {
  var ss = getSpreadsheet('JUSTIFICACIONES');
  var hoja = ss.getSheetByName(HOJA_CATALOGO_ACTIVIDADES);

  if (!hoja) {
    hoja = ss.insertSheet(HOJA_CATALOGO_ACTIVIDADES);
    hoja.appendRow(CFG_CATALOGO_ACTIVIDADES.ENCABEZADOS);
    hoja.setFrozenRows(1);
    _forzarColumnasTextoCatalogo(hoja);
    return hoja;
  }

  // Reparación: agregar los encabezados que falten, sin tocar los existentes.
  var lastCol = Math.max(hoja.getLastColumn(), 1);
  var actuales = hoja.getRange(1, 1, 1, lastCol).getValues()[0].map(function(h) {
    return String(h || '').trim().toUpperCase();
  });

  var seRepararon = false;
  CFG_CATALOGO_ACTIVIDADES.ENCABEZADOS.forEach(function(esperado) {
    if (actuales.indexOf(esperado.toUpperCase()) === -1) {
      hoja.getRange(1, hoja.getLastColumn() + 1).setValue(esperado);
      actuales.push(esperado.toUpperCase());
      seRepararon = true;
    }
  });

  // setNumberFormat es una ESCRITURA sobre miles de celdas y esta funcion se
  // llama en cada lectura del catalogo: hacerlo siempre costaba varios segundos
  // por consulta, en la ruta que el socio espera mirando el loader. Solo hace
  // falta cuando la hoja se crea o gana una columna.
  if (seRepararon) _forzarColumnasTextoCatalogo(hoja);
  return hoja;
}

/**
 * Fuerza a TEXTO PLANO las columnas que Sheets convertiría en fecha.
 *
 * "2026-08" parece un mes para nosotros, pero Sheets lo interpreta como una
 * fecha y lo guarda como Date. Al releerlo vuelve como
 * "Sat Aug 01 2026 00:00:00 GMT-0400", que no coincide con ninguna clave
 * "YYYY-MM" — y el cruce con la participacion deja de encontrar actividades sin
 * que nada falle a la vista. Paso el formato a "@" para que lo escrito se
 * guarde tal cual.
 */
function _forzarColumnasTextoCatalogo(hoja) {
  try {
    var COL = _indicesCatalogoActividades(hoja);
    var maxFilas = Math.max(hoja.getMaxRows() - 1, 1);
    ['MES', 'ANIO', 'CODIGO'].forEach(function(nombre) {
      var idx = COL[nombre];
      if (idx === undefined || idx < 0) return;
      hoja.getRange(2, idx + 1, maxFilas, 1).setNumberFormat('@');
    });
  } catch (e) {
    Logger.log('⚠️ _forzarColumnasTextoCatalogo: ' + e.toString());
  }
}

/**
 * Índices de las columnas resueltos POR NOMBRE.
 * Igual que la trazabilidad de eliminaciones: inmune a que la hoja cambie de
 * ancho o a que alguien inserte una columna intermedia a mano.
 */
function _indicesCatalogoActividades(hoja) {
  var encabezados = hoja.getRange(1, 1, 1, hoja.getLastColumn()).getValues()[0].map(function(h) {
    return String(h || '').trim().toUpperCase();
  });

  var COL = {};
  CFG_CATALOGO_ACTIVIDADES.ENCABEZADOS.forEach(function(nombre) {
    COL[nombre] = encabezados.indexOf(nombre.toUpperCase());
  });
  return COL;
}

/**
 * Código único de una actividad: ASAMBLEA_<REGION>_<YYYY_MM_DD>.
 *
 * Incluye la REGIÓN porque la misma fecha puede tener actividades distintas en
 * regiones distintas, y son actividades distintas para todos los efectos.
 * Cuando sólo se conoce el mes (códigos antiguos YYYY_MM), el código cae a
 * <YYYY_MM>: es menos preciso, pero sigue siendo estable y único.
 */
function _codigoActividad(region, fechaEvento, mes) {
  var slug = String(region || '')
    .toUpperCase()
    .replace(/[ÁÀÄÂ]/g, 'A').replace(/[ÉÈËÊ]/g, 'E').replace(/[ÍÌÏÎ]/g, 'I')
    .replace(/[ÓÒÖÔ]/g, 'O').replace(/[ÚÙÜÛ]/g, 'U').replace(/Ñ/g, 'N')
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  var sufijo;
  if (fechaEvento) {
    sufijo = Utilities.formatDate(fechaEvento, CFG_CATALOGO_ACTIVIDADES.ZONA_HORARIA, 'yyyy_MM_dd');
  } else {
    sufijo = String(mes || '').replace('-', '_');
  }

  return 'ASAMBLEA_' + slug + '_' + sufijo;
}

/**
 * Motivo por el que una actividad NO debe entrar al catalogo, o '' si es
 * admisible.
 *
 * Vive aparte a proposito: la usan TANTO la escritura como la recoleccion de
 * candidatas de la siembra. Cuando el filtro estaba solo en la escritura, la
 * simulacion contaba filas que despues se descartaban al aplicar — o sea
 * informaba un numero que no era el que iba a ocurrir.
 */
function _motivoExclusionActividad(region, nombre) {
  var reg = String(region || '').trim().toUpperCase();
  if (!reg) return 'sin region';

  // "S/D" y compania no son regiones: son marcajes sin region asignada.
  if (CFG_CATALOGO_ACTIVIDADES.REGIONES_INVALIDAS.indexOf(reg) !== -1) {
    return 'region sin dato (' + region + ')';
  }

  // Las actividades de prueba no pertenecen al calendario oficial.
  var nom = String(nombre || '').toLowerCase();
  var pat = CFG_CATALOGO_ACTIVIDADES.PATRONES_ACTIVIDAD_EXCLUIDA.filter(function(x) {
    return nom.indexOf(x) !== -1;
  });
  if (pat.length) return 'actividad de prueba (' + nombre + ')';

  return '';
}

/**
 * Lee la celda MES venga como texto "YYYY-MM" o como Date (ver
 * _forzarColumnasTextoCatalogo: Sheets convierte lo primero en lo segundo).
 */
function _mesDesdeCeldaCatalogo(valor) {
  if (valor instanceof Date) return _mesDeFecha(valor);
  var s = String(valor || '').trim();
  if (/^\d{4}-\d{2}$/.test(s)) return s;
  var f = parsearFechaFlexible(s);
  return f ? _mesDeFecha(f) : s;
}

// ---------------------------------------------------------------------------
// PRESENTACION — de formato de planilla a algo que se le pueda mostrar al socio
// ---------------------------------------------------------------------------
// Los datos crudos vienen pensados para la planilla, no para una pantalla:
//
//   REGION : "01. XV. Region de Arica y Parinacota - Arica"
//   NOMBRE : "Asamblea Ordinaria-Virtual - 01. XV. Region de Arica y Parinacota - Arica"
//
// El nombre REPITE la region completa, y la region trae un prefijo de orden
// ("01.") y a veces un punto final. Mostrar eso tal cual es ilegible en un
// telefono.
//
// Se derivan AL LEER y no se guardan como columnas: el formato de presentacion
// va a cambiar mas de una vez, y si estuviera escrito en la hoja habria que
// resembrar el catalogo entero cada vez. Los datos crudos quedan intactos.

/**
 * Separa el nombre de la actividad de su modalidad, y le quita la region que
 * viene repetida al final.
 * "Asamblea Ordinaria-Virtual - 01. XV. Region de Arica..." ->
 *   { nombre: "Asamblea Ordinaria", modalidad: "Virtual" }
 */
function _presentarNombreActividad(nombreCrudo, regionCruda) {
  var nombre = String(nombreCrudo || '').trim();
  var region = String(regionCruda || '').trim();

  // Quitar la region repetida al final (" - <region>")
  if (region && nombre.length > region.length) {
    var sufijo = nombre.slice(-region.length);
    if (sufijo.toLowerCase() === region.toLowerCase()) {
      nombre = nombre.slice(0, nombre.length - region.length).replace(/[\s\-–]+$/, '').trim();
    }
  }

  // Modalidad: viene pegada con guion ("Asamblea Ordinaria-Virtual")
  var modalidad = '';
  var m = nombre.match(/^(.*?)[\s]*-[\s]*(Virtual|Presencial|Mixta)$/i);
  if (m) {
    nombre = m[1].trim();
    modalidad = m[2].charAt(0).toUpperCase() + m[2].slice(1).toLowerCase();
  }

  return { nombre: nombre || 'Asamblea', modalidad: modalidad };
}

/**
 * Region legible y sede.
 * "01. XV. Region de Arica y Parinacota - Arica" ->
 *   { region: "XV. Region de Arica y Parinacota", sede: "Arica" }
 * El prefijo numerico ("01.") ordena la planilla y no significa nada para el
 * socio; el punto final es ruido de digitacion.
 */
function _presentarRegion(regionCruda) {
  var texto = String(regionCruda || '').trim().replace(/\.+$/, '');
  texto = texto.replace(/^\d+\.\s*/, '');           // "01. " al inicio

  var sede = '';
  var partes = texto.split(/\s+-\s+/);
  if (partes.length > 1) {
    sede  = partes.pop().trim();
    texto = partes.join(' - ').trim();
  }
  return { region: texto.replace(/\.+$/, '').trim(), sede: sede };
}

/** "YYYY-MM" a partir de un Date. */
function _mesDeFecha(fecha) {
  if (!fecha) return '';
  return Utilities.formatDate(fecha, CFG_CATALOGO_ACTIVIDADES.ZONA_HORARIA, 'yyyy-MM');
}

/** Normaliza un mes suelto a "YYYY-MM" (acepta "2026_08" y "2026-08"). */
function _normalizarMesCatalogo(valor) {
  var m = String(valor || '').trim().match(/^(\d{4})[-_](\d{1,2})/);
  if (!m) return '';
  return m[1] + '-' + (m[2].length === 1 ? '0' + m[2] : m[2]);
}

/** Mes "YYYY-MM" desde un código de asamblea YYYY_MM o YYYY_MM_DD. */
function _mesDesdeCodigoAsambleaCatalogo(codigo) {
  return _normalizarMesCatalogo(codigo);
}

/**
 * Fecha real desde un código de asamblea, sólo si trae día (YYYY_MM_DD).
 * Un código YYYY_MM no tiene día y devuelve null a propósito: inventar el día 1
 * pondría en el catálogo una fecha que nunca existió.
 */
function _fechaDesdeCodigoAsamblea(codigo) {
  // Formato real, confirmado por la auditoria del 31-08-2026 sobre las 1.377
  // filas de BD_JUSTIFICACIONES:
  //   "2026-05-09_Asamblea Ordinaria-Presencial - 07. RM Region ..."
  // La fecha va al principio y el nombre de la actividad la sigue tras un "_".
  // Una version anterior exigia que el codigo TERMINARA en el dia, no encontraba
  // ninguna coincidencia y trataba las 1.377 como si solo tuvieran mes: se
  // perdia el dia real y dos asambleas del mismo mes y region se fundian en una.
  var m = String(codigo || '').trim().match(/^(\d{4})[-_](\d{2})[-_](\d{2})(?:[_ ]|$)/);
  if (!m) return null;
  return new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10), 12, 0, 0);
}

/**
 * Nombre de la actividad embebido en el codigo de asamblea, despues del "_".
 * Ej: "2026-05-09_Asamblea Ordinaria-Presencial - 07. RM Region..." ->
 *     "Asamblea Ordinaria-Presencial - 07. RM Region..."
 * Devuelve '' si el codigo no trae nombre.
 */
function _nombreDesdeCodigoAsamblea(codigo) {
  var s = String(codigo || '').trim();
  var m = s.match(/^\d{4}[-_]\d{2}[-_]\d{2}[_ ](.+)$/);
  return m ? m[1].trim() : '';
}

// ============================================================================
// ATAJOS DE EDITOR (sin argumentos)
// ============================================================================
// El editor de Apps Script ejecuta funciones SIN pasarles argumentos, así que
// `sembrarCatalogoActividades()` llega con rutSolicitante === undefined y el
// control de rol la rechaza — correctamente, pero sin forma de usarla a mano.
//
// Mismo patrón que `simularNormalizacionTelefonos()` / `aplicarNormalizacion...`
// en Modulo admin.js: el RUT ADMIN se lee de la propiedad RUT_MANTENCION.
//
// ⚠️ BORRA RUT_MANTENCION AL TERMINAR. Mientras exista, estas dos funciones sin
//    argumentos son invocables vía google.script.run desde la consola del
//    navegador en un webapp ANYONE_ANONYMOUS, sin probar que quien llama es
//    ADMIN. Sin la propiedad quedan inertes y sólo funciona
//    `sembrarCatalogoActividades(rut, ...)`, que sí valida el rol.

/** Simula la siembra (no escribe nada). Requiere RUT_MANTENCION. */
function _simularSiembraCatalogoActividades() {
  return _correrSiembraCatalogo(false);
}

/** Aplica la siembra. Requiere RUT_MANTENCION. */
function _aplicarSiembraCatalogoActividades() {
  return _correrSiembraCatalogo(true);
}

function _correrSiembraCatalogo(aplicar) {
  var rut = PropertiesService.getScriptProperties().getProperty('RUT_MANTENCION');
  if (!rut) {
    Logger.log('❌ Falta la propiedad RUT_MANTENCION en PropertiesService (RUT de un ADMIN).\n' +
               '   Créala en Configuración del proyecto, ejecuta de nuevo, y BÓRRALA al terminar.');
    return { success: false, message: 'Falta configurar RUT_MANTENCION.' };
  }
  return sembrarCatalogoActividades(rut, aplicar);
}

// ============================================================================
// DIAGNÓSTICO (ejecutar a mano desde el editor GAS)
// ============================================================================

// ============================================================================
// AUDITORÍA DE FORMATOS (ejecutar a mano desde el editor GAS)
// ============================================================================

/**
 * Radiografía de los formatos reales de todas las bases que alimentan el
 * catálogo y la participación.
 *
 * ¿POR QUÉ? Porque estas planillas las llenan personas y otros sistemas, y el
 * código las cruza asumiendo formatos. Un supuesto equivocado no lanza ninguna
 * excepción: simplemente el cruce no encuentra nada y el socio ve un mes vacío.
 * Ya pasó dos veces — las apelaciones guardaban el mes como Date y no como
 * texto, y los códigos de asamblea resultaron ser todos mensuales.
 *
 * Reporta, por cada campo que participa del cruce: de qué TIPO viene (Date,
 * texto, número, vacío), qué FORMATOS tiene y ejemplos reales.
 *
 * NO expone datos personales: nunca lee RUT ni nombres de socios. Sólo fechas,
 * códigos, regiones, estados y nombres de actividad.
 *
 * SÓLO LECTURA sobre todas las fuentes.
 */
function _auditarFormatosDatos() {
  _ensureConfig();
  var log = ['===== AUDITORÍA DE FORMATOS =====',
             'Fecha: ' + Utilities.formatDate(new Date(), CFG_CATALOGO_ACTIVIDADES.ZONA_HORARIA, 'dd-MM-yyyy HH:mm'),
             ''];

  // --- utilidades del reporte -------------------------------------------
  function tipoDe(v) {
    if (v === '' || v === null || v === undefined) return 'vacio';
    if (v instanceof Date) return 'Date';
    if (typeof v === 'number') return 'number';
    if (typeof v === 'boolean') return 'boolean';
    return 'string';
  }

  function patronDe(v) {
    if (v instanceof Date) return 'Date';
    var s = String(v === null || v === undefined ? '' : v).trim();
    if (!s) return '(vacio)';
    if (/^\d{4}-\d{2}-\d{2}T/.test(s))            return 'ISO completo';
    if (/^\d{4}[-_]\d{2}[-_]\d{2}[_ ]/.test(s))   return 'YYYY-MM-DD_Texto';
    if (/^\d{4}[-_]\d{2}[-_]\d{2}$/.test(s))      return 'YYYY_MM_DD';
    if (/^\d{4}[-_]\d{1,2}$/.test(s))             return 'YYYY_MM';
    if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(s))       return 'DD/MM/YYYY';
    return 'texto libre';
  }

  // Resume una columna: tipos, patrones y ejemplos. `limpio` permite ocultar
  // valores si alguna vez se auditara una columna sensible.
  function resumirColumna(titulo, valores, maxEjemplos) {
    var tipos = {}, patrones = {}, ejemplos = {}, vacios = 0;
    valores.forEach(function(v) {
      var t = tipoDe(v);
      tipos[t] = (tipos[t] || 0) + 1;
      if (t === 'vacio') { vacios++; return; }
      var pat = patronDe(v);
      patrones[pat] = (patrones[pat] || 0) + 1;
      var muestra = (v instanceof Date)
        ? Utilities.formatDate(v, CFG_CATALOGO_ACTIVIDADES.ZONA_HORARIA, 'dd-MM-yyyy HH:mm')
        : String(v).trim();
      if (Object.keys(ejemplos).length < (maxEjemplos || 5)) ejemplos[muestra] = true;
    });

    log.push('  ' + titulo);
    log.push('    tipos:    ' + Object.keys(tipos).map(function(k){ return k + '=' + tipos[k]; }).join(', '));
    var listaPat = Object.keys(patrones).sort(function(a,b){ return patrones[b]-patrones[a]; });
    log.push('    formatos: ' + listaPat.slice(0, 8).map(function(k){ return k + '=' + patrones[k]; }).join(', ') +
             (listaPat.length > 8 ? '  (+' + (listaPat.length - 8) + ' mas)' : ''));
    var ej = Object.keys(ejemplos);
    if (ej.length) log.push('    ejemplos: ' + ej.map(function(e){ return '"' + e + '"'; }).join(' | '));
  }

  // Distribución completa de valores (para columnas de pocos valores, como ESTADO)
  function distribucion(titulo, valores) {
    var d = {};
    valores.forEach(function(v) {
      var k = String(v === null || v === undefined ? '' : v).trim();
      if (!k) k = '(vacio)';
      d[k] = (d[k] || 0) + 1;
    });
    log.push('  ' + titulo);
    var claves = Object.keys(d).sort(function(a,b){ return d[b]-d[a]; });
    claves.slice(0, 25).forEach(function(k) { log.push('    "' + k + '"  x' + d[k]); });
    if (claves.length > 25) log.push('    (+' + (claves.length - 25) + ' valores mas)');
    return d;
  }

  function columna(datos, idx) {
    return datos.map(function(f) { return (idx === undefined || idx < 0) ? '' : f[idx]; });
  }

  try {
    // ======================================================================
    // 1. CONFIG_JUSTIFICACIONES — la fuente de verdad del calendario
    // ======================================================================
    log.push('=== 1. CONFIG_JUSTIFICACIONES (fuente de verdad del calendario) ===');
    var ssJ = getSpreadsheet('JUSTIFICACIONES');
    var hojaCfg = ssJ.getSheetByName(CONFIG.HOJAS.CONFIG_JUSTIFICACIONES);

    if (!hojaCfg || hojaCfg.getLastRow() < 2) {
      log.push('  (sin filas)');
    } else {
      var datosCfg = hojaCfg.getRange(2, 1, hojaCfg.getLastRow() - 1, 5).getValues();
      log.push('  Filas: ' + datosCfg.length + '   (una por region, se sobrescriben)');
      log.push('  Encabezados: ' + hojaCfg.getRange(1, 1, 1, 5).getValues()[0].join(' | '));
      resumirColumna('A REGION', columna(datosCfg, 0), 3);
      distribucion('B Habilitado', columna(datosCfg, 1));
      resumirColumna('C Fecha Limite (plazo para justificar)', columna(datosCfg, 2), 5);
      resumirColumna('D Fecha_Evento (fecha de la actividad)', columna(datosCfg, 3), 5);
      resumirColumna('E Nombre_Actividad', columna(datosCfg, 4), 8);
    }
    log.push('');

    // ======================================================================
    // 2. BD_JUSTIFICACIONES — los tramites de los socios
    // ======================================================================
    log.push('=== 2. BD_JUSTIFICACIONES (tramites) ===');
    var hojaJ = ssJ.getSheetByName(CONFIG.HOJAS.JUSTIFICACIONES);
    var COLJ = CONFIG.COLUMNAS.JUSTIFICACIONES;

    if (!hojaJ || hojaJ.getLastRow() < 2) {
      log.push('  (sin filas)');
    } else {
      var datosJ = hojaJ.getRange(2, 1, hojaJ.getLastRow() - 1, hojaJ.getLastColumn()).getValues();
      log.push('  Filas: ' + datosJ.length);
      resumirColumna('ASAMBLEA (llave de cruce)', columna(datosJ, COLJ.ASAMBLEA), 8);
      resumirColumna('FECHA (solo tipo: son miles de valores unicos)', columna(datosJ, COLJ.FECHA), 2);
      var estJ = distribucion('ESTADO', columna(datosJ, COLJ.ESTADO));

      // ¿Los estados que el codigo considera "aprobado" existen de verdad?
      log.push('  >> CRUCE CON EL CODIGO:');
      log.push('     El modulo acredita participacion con: ' +
               CFG_PARTICIPACION.ESTADOS_JUSTIFICACION_APROBADA.join(', '));
      var reconocidosJ = 0, noReconocidosJ = [];
      Object.keys(estJ).forEach(function(e) {
        var norm = e.toLowerCase().replace(/\s+/g, '');
        var esAprob = CFG_PARTICIPACION.ESTADOS_JUSTIFICACION_APROBADA.indexOf(norm) !== -1;
        var esRev   = CFG_PARTICIPACION.ESTADOS_EN_REVISION.indexOf(norm) !== -1;
        if (esAprob || esRev) reconocidosJ += estJ[e];
        else if (e !== '(vacio)') noReconocidosJ.push(e + ' (x' + estJ[e] + ')');
      });
      log.push('     Filas con estado reconocido: ' + reconocidosJ + ' de ' + datosJ.length);
      if (noReconocidosJ.length) {
        log.push('     ⚠️ Estados NO reconocidos por el codigo: ' + noReconocidosJ.join(', '));
        log.push('        (esas filas no acreditan participacion ni figuran en revision)');
      }
    }
    log.push('');

    // ======================================================================
    // 3. BD_APELACIONES
    // ======================================================================
    log.push('=== 3. BD_APELACIONES ===');
    var ssA = getSpreadsheet('APELACIONES');
    var hojaA = ssA.getSheetByName(CONFIG.HOJAS.APELACIONES);
    var COLA = CONFIG.COLUMNAS.APELACIONES;

    if (!hojaA || hojaA.getLastRow() < 2) {
      log.push('  (sin filas)');
    } else {
      var datosA = hojaA.getRange(2, 1, hojaA.getLastRow() - 1, hojaA.getLastColumn()).getValues();
      log.push('  Filas: ' + datosA.length);
      resumirColumna('MES_APELACION (llave de cruce)', columna(datosA, COLA.MES_APELACION), 8);
      resumirColumna('FECHA_SOLICITUD', columna(datosA, COLA.FECHA_SOLICITUD), 4);
      var estA = distribucion('ESTADO', columna(datosA, COLA.ESTADO));

      log.push('  >> CRUCE CON EL CODIGO:');
      log.push('     El modulo acredita participacion con: ' +
               CFG_PARTICIPACION.ESTADOS_APELACION_APROBADA.join(', '));
      var reconocidosA = 0, noReconocidosA = [];
      Object.keys(estA).forEach(function(e) {
        var norm = e.toLowerCase().replace(/\s+/g, '');
        var esAprob = CFG_PARTICIPACION.ESTADOS_APELACION_APROBADA.indexOf(norm) !== -1;
        var esRev   = CFG_PARTICIPACION.ESTADOS_EN_REVISION.indexOf(norm) !== -1;
        if (esAprob || esRev) reconocidosA += estA[e];
        else if (e !== '(vacio)') noReconocidosA.push(e + ' (x' + estA[e] + ')');
      });
      log.push('     Filas con estado reconocido: ' + reconocidosA + ' de ' + datosA.length);
      if (noReconocidosA.length) {
        log.push('     ⚠️ Estados NO reconocidos por el codigo: ' + noReconocidosA.join(', '));
      }
    }
    log.push('');

    // ======================================================================
    // 4. CATALOGO_ACTIVIDADES — lo que quedo guardado
    // ======================================================================
    log.push('=== 4. CATALOGO_ACTIVIDADES (lo que hoy alimenta la vista) ===');
    var hojaCat = _asegurarHojaCatalogoActividades();
    if (hojaCat.getLastRow() < 2) {
      log.push('  (vacio)');
    } else {
      var COLC = _indicesCatalogoActividades(hojaCat);
      var datosC = hojaCat.getRange(2, 1, hojaCat.getLastRow() - 1, hojaCat.getLastColumn()).getValues();
      log.push('  Filas: ' + datosC.length);
      log.push('  Encabezados: ' + hojaCat.getRange(1, 1, 1, hojaCat.getLastColumn()).getValues()[0].join(' | '));
      resumirColumna('NOMBRE', columna(datosC, COLC.NOMBRE), 8);
      resumirColumna('FECHA_EVENTO', columna(datosC, COLC.FECHA_EVENTO), 4);
      resumirColumna('FECHA_LIMITE', columna(datosC, COLC.FECHA_LIMITE), 4);
      distribucion('MES', columna(datosC, COLC.MES));
      distribucion('PRECISION', columna(datosC, COLC.PRECISION));
      distribucion('ORIGEN', columna(datosC, COLC.ORIGEN));
    }
    log.push('');

    // ======================================================================
    // 5. COHERENCIA DE REGIONES entre las tres hojas
    // ======================================================================
    log.push('=== 5. COHERENCIA DE REGIONES ===');
    log.push('  Si la misma region se escribe distinto en dos hojas, el cruce falla');
    log.push('  en silencio. Se comparan los valores tal cual, sin normalizar.');

    function setRegiones(hoja, idx, desde) {
      var r = {};
      if (!hoja || hoja.getLastRow() < 2) return r;
      var d = hoja.getRange(2, 1, hoja.getLastRow() - 1, hoja.getLastColumn()).getValues();
      d.forEach(function(f) {
        var v = String(f[idx] || '').trim();
        if (v) r[v] = true;
      });
      return r;
    }

    var regCfg = setRegiones(hojaCfg, 0);
    var regJus = setRegiones(hojaJ, COLJ.REGION);
    var regCat = setRegiones(hojaCat, _indicesCatalogoActividades(hojaCat).REGION);

    log.push('  CONFIG_JUSTIFICACIONES: ' + Object.keys(regCfg).length + ' regiones');
    log.push('  BD_JUSTIFICACIONES:     ' + Object.keys(regJus).length + ' regiones');
    log.push('  CATALOGO_ACTIVIDADES:   ' + Object.keys(regCat).length + ' regiones');

    // USUARIOS: es la region que decide QUE actividades le tocan a cada socio.
    // Si aqui se escribe distinto que en el catalogo, el filtro no encuentra
    // nada y el socio ve un anio entero sin actividades que le correspondan.
    var regUsr = {};
    try {
      var hojaU = getSheet('USUARIOS', 'USUARIOS');
      var COLU = CONFIG.COLUMNAS.USUARIOS;
      if (hojaU && hojaU.getLastRow() >= 2 && COLU.REGION !== undefined) {
        var colU = hojaU.getRange(2, COLU.REGION + 1, hojaU.getLastRow() - 1, 1).getValues();
        colU.forEach(function(f) {
          var v = String(f[0] || '').trim();
          if (v) regUsr[v] = (regUsr[v] || 0) + 1;
        });
      }
    } catch (eU) {
      log.push('  ⚠️ No se pudo leer la region de USUARIOS: ' + eU.message);
    }

    log.push('  BD_SLIMAPP (USUARIOS):  ' + Object.keys(regUsr).length + ' regiones');
    Object.keys(regUsr).sort().forEach(function(r) { log.push('     "' + r + '"  x' + regUsr[r]); });

    // Comparacion normalizada (asi es como el filtro las compara de verdad)
    function normReg(v) {
      return String(v || '').toUpperCase()
        .replace(/[ÁÀÄÂ]/g,'A').replace(/[ÉÈËÊ]/g,'E').replace(/[ÍÌÏÎ]/g,'I')
        .replace(/[ÓÒÖÔ]/g,'O').replace(/[ÚÙÜÛ]/g,'U').replace(/Ñ/g,'N')
        .replace(/^\s*\d+\s*\.\s*/,'').replace(/[^A-Z0-9]+/g,'').trim();
    }
    var normCat = {};
    Object.keys(regCat).forEach(function(r) { normCat[normReg(r)] = r; });

    var usuariosSinCalce = [], sociosAfectados = 0;
    Object.keys(regUsr).forEach(function(r) {
      if (!normCat[normReg(r)]) { usuariosSinCalce.push(r + ' (x' + regUsr[r] + ')'); sociosAfectados += regUsr[r]; }
    });

    log.push('  >> CRUCE USUARIOS vs CATALOGO (normalizado, como lo hace el filtro):');
    if (usuariosSinCalce.length === 0) {
      log.push('     ✅ Todas las regiones de los socios calzan con alguna del catalogo.');
    } else {
      log.push('     ⚠️ Regiones de socios SIN actividad equivalente en el catalogo:');
      usuariosSinCalce.forEach(function(r) { log.push('        ' + r); });
      log.push('     Socios afectados: ' + sociosAfectados + ' (verian su anio sin actividades)');
    }

    var soloEnCat = Object.keys(regCat).filter(function(r) { return !regJus[r] && !regCfg[r]; });
    if (soloEnCat.length) {
      log.push('  Regiones del catalogo que no aparecen en ninguna hoja de justificaciones:');
      soloEnCat.forEach(function(r) { log.push('     "' + r + '"'); });
    } else {
      log.push('  ✅ Todas las regiones del catalogo existen en justificaciones.');
    }

  } catch (e) {
    log.push('❌ EXCEPCION: ' + e.toString());
  }

  Logger.log(log.join('\n'));
  return log.join('\n');
}

/**
 * Compara las dos fuentes de la siembra ANTES de escribir nada.
 *
 * Existe porque la primera simulación dio 37 + 24 = 61 actividades con CERO
 * fusión: los códigos de asamblea de justificaciones son mensuales (YYYY_MM) y
 * los de Brigada salen de la fecha del marcaje (YYYY_MM_DD), así que la misma
 * asamblea produce dos códigos distintos y entraría duplicada.
 *
 * Responde las tres preguntas que deciden cuál debe ser la llave del catálogo:
 *   1. ¿Las dos fuentes escriben la región igual? Si no, ni siquiera una llave
 *      mensual las fusionaría.
 *   2. ¿Cuántos códigos de asamblea traen día y cuántos sólo mes?
 *   3. ¿Hay región+mes con más de una fecha de actividad? Ese es el costo de
 *      una llave mensual: esas dos se fundirían en una.
 *
 * SÓLO LECTURA. No expone datos de personas: sólo regiones, meses y conteos.
 */
function _diagnosticarSiembraCatalogo() {
  _ensureConfig();
  var log = ['===== COMPARACIÓN DE FUENTES PARA EL CATÁLOGO ====='];

  try {
    // --- Justificaciones ---
    var regionesJ = {}, conDia = 0, soloMes = 0, sinCodigo = 0;
    var ssJ = getSpreadsheet('JUSTIFICACIONES');
    var hojaJ = ssJ.getSheetByName(CONFIG.HOJAS.JUSTIFICACIONES);

    if (hojaJ && hojaJ.getLastRow() >= 2) {
      var COLJ = CONFIG.COLUMNAS.JUSTIFICACIONES;
      var datosJ = hojaJ.getRange(2, 1, hojaJ.getLastRow() - 1, hojaJ.getLastColumn()).getValues();
      for (var i = 0; i < datosJ.length; i++) {
        var regJ = String(datosJ[i][COLJ.REGION] || '').trim();
        if (regJ) regionesJ[regJ] = (regionesJ[regJ] || 0) + 1;

        var cod = String(datosJ[i][COLJ.ASAMBLEA] || '').trim();
        if (!cod) sinCodigo++;
        else if (/^\d{4}[-_]\d{2}[-_]\d{2}$/.test(cod)) conDia++;
        else soloMes++;
      }
    }

    log.push('--- JUSTIFICACIONES ---');
    log.push('Códigos de asamblea: con día ' + conDia + ' | sólo mes ' + soloMes + ' | sin código ' + sinCodigo);
    log.push('Regiones distintas (' + Object.keys(regionesJ).length + '):');
    Object.keys(regionesJ).sort().forEach(function(r) { log.push('   "' + r + '"  (' + regionesJ[r] + ' filas)'); });

    // --- Brigada (sólo lectura) ---
    var regionesB = {}, porRegionMes = {}, actividadesB = {};
    var idB = CONFIG.SPREADSHEETS.ASISTENCIA_BRIGADA;

    if (idB) {
      var ssB = SpreadsheetApp.openById(idB);
      var COLB = CFG_ASISTENCIA_BRIGADA.COL;

      CFG_ASISTENCIA_BRIGADA.HOJAS_A_LEER.forEach(function(nombreHoja) {
        var hojaB = ssB.getSheetByName(nombreHoja);
        if (!hojaB || hojaB.getLastRow() < 2) return;

        var datosB = hojaB.getRange(2, 1, hojaB.getLastRow() - 1,
                                    CFG_ASISTENCIA_BRIGADA.TOTAL_COLUMNAS).getValues();

        for (var b = 0; b < datosB.length; b++) {
          var regB = String(datosB[b][COLB.REGION] || '').trim();
          if (regB) regionesB[regB] = (regionesB[regB] || 0) + 1;

          var act = String(datosB[b][COLB.ACTIVIDAD] || '').trim();
          if (act) actividadesB[act] = (actividadesB[act] || 0) + 1;

          var fB = parsearFechaFlexible(datosB[b][COLB.HORA_MARCAJE]) ||
                   parsearFechaFlexible(datosB[b][COLB.FECHA]);
          if (!fB || !regB) continue;

          var clave = regB + ' || ' + _mesDeFecha(fB);
          var dia = Utilities.formatDate(fB, CFG_CATALOGO_ACTIVIDADES.ZONA_HORARIA, 'dd-MM-yyyy');
          if (!porRegionMes[clave]) porRegionMes[clave] = {};
          porRegionMes[clave][dia] = true;
        }
      });
    }

    log.push('--- BRIGADA ---');
    log.push('Regiones distintas (' + Object.keys(regionesB).length + '):');
    Object.keys(regionesB).sort().forEach(function(r) { log.push('   "' + r + '"  (' + regionesB[r] + ' marcajes)'); });
    log.push('Nombres de actividad distintos: ' + Object.keys(actividadesB).length);
    Object.keys(actividadesB).sort().slice(0, 20).forEach(function(a) { log.push('   "' + a + '"'); });

    // --- ¿Coinciden las nomenclaturas? ---
    function slug(s) {
      return String(s).toUpperCase()
        .replace(/[ÁÀÄÂ]/g,'A').replace(/[ÉÈËÊ]/g,'E').replace(/[ÍÌÏÎ]/g,'I')
        .replace(/[ÓÒÖÔ]/g,'O').replace(/[ÚÙÜÛ]/g,'U').replace(/Ñ/g,'N')
        .replace(/[^A-Z0-9]+/g,'_').replace(/^_+|_+$/g,'');
    }
    var slugsJ = {};
    Object.keys(regionesJ).forEach(function(r) { slugsJ[slug(r)] = r; });
    var calzan = 0, noCalzan = [];
    Object.keys(regionesB).forEach(function(r) {
      if (slugsJ[slug(r)]) calzan++; else noCalzan.push(r);
    });

    log.push('--- ¿CALZAN LAS REGIONES? ---');
    log.push('Regiones de Brigada que existen igual en Justificaciones: ' + calzan +
             ' de ' + Object.keys(regionesB).length);
    if (noCalzan.length) {
      log.push('Sin equivalente en Justificaciones: ' +
               noCalzan.map(function(r) { return '"' + r + '"'; }).join(', '));
      log.push('   OJO: que no aparezcan aca NO significa que esten mal escritas. Lo normal');
      log.push('   es que en esas regiones haya habido marcajes pero nadie haya justificado,');
      log.push('   o que sean centinelas de "sin dato" (S/D), que el catalogo descarta.');
      log.push('   La senal de alarma real seria ver la MISMA region escrita distinto en las');
      log.push('   dos listas de arriba: eso si impediria fusionar las fuentes.');
    }

    // --- Costo de una llave mensual ---
    var multiples = Object.keys(porRegionMes).filter(function(k) {
      return Object.keys(porRegionMes[k]).length > 1;
    });
    log.push('--- COSTO DE UNA LLAVE MENSUAL ---');
    log.push('Región+mes con MÁS DE UNA fecha de actividad: ' + multiples.length);
    multiples.slice(0, 15).forEach(function(k) {
      log.push('   ' + k + ' → ' + Object.keys(porRegionMes[k]).join(', '));
    });
    if (multiples.length === 0) {
      log.push('✅ Ninguna. Una llave región+mes no fusionaría actividades distintas.');
    }

  } catch (e) {
    log.push('❌ EXCEPCIÓN: ' + e.toString());
  }

  Logger.log(log.join('\n'));
  return log.join('\n');
}

/**
 * Contrasta, para un MES y una REGION, lo que dice cada fuente sobre que
 * actividades hubo.
 *
 * Existe para responder una duda concreta: el catalogo puede mostrar dos
 * asambleas en un mes cuando en realidad hubo una sola y la segunda fecha son
 * marcajes rezagados (carga manual posterior, formulario llenado despues). Como
 * la fuente de verdad del calendario es CONFIG_JUSTIFICACIONES, esta funcion
 * pone lado a lado las tres visiones para poder decidirlo con datos.
 *
 * Uso desde el editor: crear las propiedades de script DIAG_MES ("2026-08") y
 * DIAG_REGION (el texto exacto de la region), ejecutar, y BORRARLAS despues.
 * No expone RUT ni nombres de socios: solo fechas y conteos.
 */
function _diagnosticarMesRegion() {
  _ensureConfig();
  var props = PropertiesService.getScriptProperties();
  var mesObj = String(props.getProperty('DIAG_MES') || '').trim();
  var regObj = String(props.getProperty('DIAG_REGION') || '').trim();
  var log = ['===== CONTRASTE DE FUENTES: ' + (mesObj || '(sin mes)') + ' / ' + (regObj || '(todas las regiones)') + ' ====='];

  if (!mesObj) {
    mesObj = Utilities.formatDate(new Date(), CFG_CATALOGO_ACTIVIDADES.ZONA_HORARIA, 'yyyy-MM');
    log[0] = '===== CONTRASTE DE FUENTES: ' + mesObj + ' / ' +
             (regObj || 'TODAS las regiones') + ' =====';
    log.push('(sin DIAG_MES: se usa el mes en curso. Para otro mes, crea la propiedad DIAG_MES = "2026-05")');
  }

  if (false) {
    log.push('');
    Logger.log(log.join('\n'));
    return log.join('\n');
  }

  function norm(v) {
    return String(v || '').toUpperCase()
      .replace(/[ÁÀÄÂ]/g,'A').replace(/[ÉÈËÊ]/g,'E').replace(/[ÍÌÏÎ]/g,'I')
      .replace(/[ÓÒÖÔ]/g,'O').replace(/[ÚÙÜÛ]/g,'U').replace(/Ñ/g,'N')
      .replace(/^\s*\d+\s*\.\s*/,'').replace(/[^A-Z0-9]+/g,'').trim();
  }
  var regNorm = regObj ? norm(regObj) : '';

  try {
    // --- 1. Lo que dice el CATALOGO (lo que ve el socio) ---
    log.push('--- 1. CATALOGO_ACTIVIDADES (lo que se le muestra al socio) ---');
    var cat = obtenerCatalogoActividades(mesObj.split('-')[0]);
    var delMes = (cat.actividades || []).filter(function(a) {
      return a.mes === mesObj && (!regNorm || norm(a.region) === regNorm);
    });
    if (!delMes.length) log.push('   (ninguna)');
    delMes.forEach(function(a) {
      log.push('   ' + (a.fecha || '(sin fecha)') + '  origen=' + a.origen +
               '  precision=' + a.precision + '  "' + a.nombre + '"');
    });

    // --- 2. Lo que dice JUSTIFICACIONES (la fuente de verdad del calendario) ---
    log.push('--- 2. BD_JUSTIFICACIONES: codigos de asamblea de ese mes ---');
    var ssJ = getSpreadsheet('JUSTIFICACIONES');
    var hojaJ = ssJ.getSheetByName(CONFIG.HOJAS.JUSTIFICACIONES);
    var COLJ = CONFIG.COLUMNAS.JUSTIFICACIONES;
    var codigos = {};
    if (hojaJ && hojaJ.getLastRow() >= 2) {
      var dJ = hojaJ.getRange(2, 1, hojaJ.getLastRow() - 1, hojaJ.getLastColumn()).getValues();
      dJ.forEach(function(f) {
        var reg = String(f[COLJ.REGION] || '').trim();
        if (regNorm && norm(reg) !== regNorm) return;
        var cod = String(f[COLJ.ASAMBLEA] || '').trim();
        if (cod.indexOf(mesObj) !== 0) return;
        codigos[cod] = (codigos[cod] || 0) + 1;
      });
    }
    if (!Object.keys(codigos).length) log.push('   (ninguno)');
    Object.keys(codigos).sort().forEach(function(c) {
      log.push('   "' + c + '"   x' + codigos[c] + ' tramite(s)');
    });
    if (!regNorm) {
      log.push('   (sin DIAG_REGION: se listan TODAS las regiones. El nombre de la');
      log.push('    region va dentro de cada codigo de asamblea)');
    }

    // --- 3. Lo que dice BRIGADA (marcajes por dia) ---
    log.push('--- 3. BRIGADA: marcajes por dia (todas las vias) ---');
    var idB = CONFIG.SPREADSHEETS.ASISTENCIA_BRIGADA;
    var porDia = {}, porDiaVia = {};
    if (idB) {
      var ssB = SpreadsheetApp.openById(idB);
      var COLB = CFG_ASISTENCIA_BRIGADA.COL;
      CFG_ASISTENCIA_BRIGADA.HOJAS_A_LEER.forEach(function(nombreHoja) {
        var h = ssB.getSheetByName(nombreHoja);
        if (!h || h.getLastRow() < 2) return;
        var dB = h.getRange(2, 1, h.getLastRow() - 1, CFG_ASISTENCIA_BRIGADA.TOTAL_COLUMNAS).getValues();
        dB.forEach(function(f) {
          var reg = String(f[COLB.REGION] || '').trim();
          if (regNorm && norm(reg) !== regNorm) return;
          var fe = parsearFechaFlexible(f[COLB.HORA_MARCAJE]) || parsearFechaFlexible(f[COLB.FECHA]);
          if (!fe) return;
          if (Utilities.formatDate(fe, CFG_CATALOGO_ACTIVIDADES.ZONA_HORARIA, 'yyyy-MM') !== mesObj) return;
          var dia = Utilities.formatDate(fe, CFG_CATALOGO_ACTIVIDADES.ZONA_HORARIA, 'dd-MM-yyyy');
          // Sin region filtrada se antepone la region, para no mezclar el pais
          // entero en una sola cuenta por dia.
          if (!regNorm) dia = reg + '  |  ' + dia;
          porDia[dia] = (porDia[dia] || 0) + 1;
          var via = _traducirViaRegistro(f[COLB.BRIGADISTA]);
          if (!porDiaVia[dia]) porDiaVia[dia] = {};
          porDiaVia[dia][via] = (porDiaVia[dia][via] || 0) + 1;
          var act = String(f[COLB.ACTIVIDAD] || '').trim();
          porDiaVia[dia]['act:' + act] = (porDiaVia[dia]['act:' + act] || 0) + 1;
        });
      });
    }
    if (!Object.keys(porDia).length) log.push('   (ninguno)');
    Object.keys(porDia).sort().forEach(function(d) {
      log.push('   ' + d + '  ->  ' + porDia[d] + ' marcaje(s)');
      Object.keys(porDiaVia[d]).forEach(function(k) {
        log.push('        ' + k + ': ' + porDiaVia[d][k]);
      });
    });

    log.push('--- COMO LEER ESTO ---');
    log.push('  Si en (2) hay UN SOLO codigo de asamblea y en (3) aparecen VARIOS dias,');
    log.push('  esos dias extra son marcajes rezagados de la MISMA asamblea, no');
    log.push('  actividades distintas: el catalogo tiene una fila de mas.');
    log.push('  Si en (2) hay varios codigos, entonces si hubo varias asambleas.');
    log.push('  ⚠️ Borra DIAG_MES y DIAG_REGION al terminar.');

  } catch (e) {
    log.push('❌ EXCEPCION: ' + e.toString());
  }

  Logger.log(log.join('\n'));
  return log.join('\n');
}

/**
 * Estado del catálogo: cuántas actividades hay, de qué años y de qué origen.
 * No expone datos de personas — el catálogo no los tiene.
 */
function _diagnosticarCatalogoActividades() {
  _ensureConfig();
  var log = ['===== CATÁLOGO DE ACTIVIDADES ====='];

  try {
    var hoja = _asegurarHojaCatalogoActividades();
    log.push('Hoja: "' + HOJA_CATALOGO_ACTIVIDADES + '" en el spreadsheet de JUSTIFICACIONES');
    log.push('Encabezados: ' + hoja.getRange(1, 1, 1, hoja.getLastColumn()).getValues()[0].join(' | '));

    var r = obtenerCatalogoActividades('');
    log.push('Actividades registradas: ' + r.actividades.length);

    var porAnio = {}, porOrigen = {};
    r.actividades.forEach(function(a) {
      porAnio[a.anio] = (porAnio[a.anio] || 0) + 1;
      porOrigen[a.origen] = (porOrigen[a.origen] || 0) + 1;
    });

    Object.keys(porAnio).sort().reverse().forEach(function(anio) {
      log.push('  ' + anio + ': ' + porAnio[anio] + ' actividad(es)');
    });
    Object.keys(porOrigen).forEach(function(o) {
      log.push('  origen ' + o + ': ' + porOrigen[o]);
    });

    if (r.actividades.length === 0) {
      log.push('ℹ️ Vacío. Ejecuta sembrarCatalogoActividades(<RUT ADMIN>, false) para simular la siembra.');
    }

  } catch (e) {
    log.push('❌ EXCEPCIÓN: ' + e.toString());
  }

  Logger.log(log.join('\n'));
  return log.join('\n');
}
