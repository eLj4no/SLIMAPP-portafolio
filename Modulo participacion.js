/**
 * ============================================================================
 * PARTICIPACIÓN CONSOLIDADA EN ACTIVIDADES SINDICALES
 * ============================================================================
 * Responde una sola pregunta, mes a mes: ¿este socio participó?
 *
 * QUÉ ES "PARTICIPAR":
 *
 *   La organización reconoce TRES formas válidas de acreditar participación en
 *   una actividad sindical, y este módulo las trata como equivalentes:
 *
 *     1. ASISTIÓ ............... hay marcaje en la planilla de Brigada.
 *     2. JUSTIFICÓ ............. no asistió, pero presentó justificación y el
 *                                directorio la APROBÓ.
 *     3. APELACIÓN ACOGIDA ..... no asistió ni justificó a tiempo, se le aplicó
 *                                el descuento, y al apelar acreditó que sí
 *                                correspondía. El trámite llegó tarde o no se
 *                                hizo, pero el motivo era válido.
 *
 *   Hasta ahora cada una vivía en su propio módulo y no había forma de ver las
 *   tres juntas. Un socio que justificó correctamente aparecía como ausente en
 *   el historial de asistencia, que es exactamente lo contrario de lo que la
 *   organización quiere reconocerle.
 *
 * POR QUÉ SE CALCULA AL LEER Y NO SE GUARDA EN NINGUNA PARTE:
 *
 *   Decisión del usuario, 2026-08-29. Se evaluó escribir estos datos en la hoja
 *   "Historico" de la planilla de Brigada y se descartó:
 *
 *     - Un marcaje es un hecho INMUTABLE: ocurrió a una hora y ya está. Una
 *       justificación o una apelación son EXPEDIENTES VIVOS: el directorio los
 *       revisa y les cambia el estado a mano en la planilla. Una copia quedaría
 *       desactualizada apenas eso pasa, y sería la copia —no el original— la
 *       que vería el socio.
 *     - "Historico" es una hoja fría por diseño: su valor está en que nadie la
 *       escribe salvo el archivado manual.
 *     - Rompería el contrato de 12 columnas que "Historico" comparte con
 *       "Asistencia" y que este proyecto verifica antes de confiar en los datos.
 *
 *   La participación NO es un dato nuevo que haya que almacenar: es una
 *   conclusión que se deriva de tres hechos que ya existen. Se calcula en cada
 *   lectura, siempre con el estado actual de cada expediente.
 *
 * LA LLAVE DE CRUCE ES EL MES:
 *
 *   Las tres fuentes identifican el evento de forma distinta:
 *
 *     Asistencia (Brigada) -> "Actividad", texto libre configurado a mano.
 *     Justificaciones ...... -> "ASAMBLEA", código que puede venir en DOS
 *                              formatos: "YYYY-MM-DD_NombreActividad" cuando hay
 *                              evento configurado, o "YYYY_MM" en modo mes.
 *     Apelaciones .......... -> "MES_APELACION", un mes "YYYY-MM". No apunta a
 *                              ninguna asamblea concreta.
 *
 *   El MES es el único denominador común real: las apelaciones sólo tienen mes,
 *   y es además como razona la organización, porque el descuento es mensual.
 *   Cruzar por nombre de actividad sería frágil desde el primer día: son textos
 *   libres, escritos por personas distintas, en sistemas distintos.
 *
 * ⛔ SÓLO LECTURA, las tres fuentes. Este módulo no tiene ni debe tener nunca
 *    un setValue, setValues, appendRow, deleteRow ni clearContent. La planilla
 *    de Brigada, además, es intocable desde acá por regla del proyecto.
 *
 * TOLERANCIA A FALLOS: cada fuente se lee aislada. Si una planilla falla o no
 * está disponible, se informa esa fuente como no disponible y las otras dos
 * siguen mostrándose. El portal nunca se cae por esto.
 * ============================================================================
 */

var CFG_PARTICIPACION = {
  // Estados que ACREDITAN participación. Ojo: justificaciones y apelaciones
  // escriben la variante con observación de forma DISTINTA ("Aceptado/Obs" vs
  // "Aceptado-Obs"). Se contemplan las dos en ambas listas a propósito: si
  // alguien unifica los textos más adelante, esto sigue funcionando.
  ESTADOS_JUSTIFICACION_APROBADA: ['aceptado', 'aceptado/obs', 'aceptado-obs'],
  ESTADOS_APELACION_APROBADA:     ['aceptado', 'aceptado/obs', 'aceptado-obs', 'pagado'],

  // Estados que todavía no resuelven nada, pero que el socio debe ver para
  // saber que su trámite está en curso.
  ESTADOS_EN_REVISION: ['enviado'],

  // Resultados posibles de un mes, de mayor a menor peso.
  RESULTADO: {
    ASISTIO:            'ASISTIO',
    JUSTIFICADO:        'JUSTIFICADO',
    APELACION_ACOGIDA:  'APELACION_ACOGIDA',
    EN_REVISION:        'EN_REVISION',
    SIN_PARTICIPACION:  'SIN_PARTICIPACION'
  },

  ZONA_HORARIA: 'America/Santiago',

  // ---------------------------------------------------------------------
  // DESDE CUANDO LOS DATOS SON EVALUABLES
  // ---------------------------------------------------------------------
  // Mes (YYYY-MM) a partir del cual el sistema recopila la participacion de
  // forma completa. TODO lo anterior se muestra bloqueado y no cuenta.
  //
  // ¿POR QUE AGOSTO DE 2026? Porque la asistencia solo existe desde ahi: la
  // planilla de Brigada empieza en agosto, y antes de esa fecha lo unico que
  // quedo registrado son las justificaciones. Un socio que asistio con toda
  // normalidad en mayo no tiene marcaje en ninguna base, asi que evaluar esos
  // meses lo mostraria EN FALTA por un dato que el sistema nunca guardo.
  //
  // Es una decision sobre los datos, no sobre las personas: preferimos decir
  // "no evaluado" antes que imputar una ausencia que no podemos probar.
  // Cuando pasen los anios y todos los meses del calendario sean posteriores a
  // este corte, esta constante deja de tener efecto por si sola.
  INICIO_DATOS_EVALUABLES: '2026-08'
};

// ============================================================================
// API PÚBLICA
// ============================================================================

/**
 * Participación consolidada del socio de la sesión, mes a mes.
 *
 * El RUT sale del TOKEN DE SESIÓN, nunca de un parámetro del cliente: el webapp
 * es ANYONE_ANONYMOUS, así que un RUT recibido desde el navegador permitiría
 * consultar la participación de cualquier otro socio desde la consola. Mismo
 * criterio que obtenerAsistenciaBrigada().
 *
 * @param {string} sessionToken Token entregado por validarUsuario() al ingresar.
 * @return {{success: boolean, meses: Array, fuentes: Object, sesionExpirada: boolean, message: string}}
 */
function obtenerParticipacionSocio(sessionToken) {
  // _ensureConfig() va primero y FUERA del try, por la misma razón que en
  // Modulo asistenciaBrigada.js: CONFIG parte en null en cada ejecución y
  // leerlo antes de poblarlo lanza un TypeError que el catch taparía.
  _ensureConfig();

  try {
    var rutSesion = obtenerRutDeSesion(sessionToken);
    if (!rutSesion) {
      return {
        success: false,
        sesionExpirada: true,
        meses: [],
        fuentes: {},
        message: 'Tu sesión expiró. Vuelve a ingresar.'
      };
    }

    var rutLimpio = cleanRut(rutSesion);

    // Cada fuente aislada: el fallo de una no puede dejar al socio sin ver las
    // otras dos.
    var asistencias    = _participacionLeerAsistencias(sessionToken);
    var justificaciones = _participacionLeerJustificaciones(rutLimpio);
    var apelaciones     = _participacionLeerApelaciones(rutLimpio);

    var meses = _consolidarParticipacionPorMes(
      asistencias.registros,
      justificaciones.registros,
      apelaciones.registros
    );

    return {
      success: true,
      sesionExpirada: false,
      meses: meses,
      fuentes: {
        asistencia:      { ok: asistencias.ok,     mensaje: asistencias.mensaje },
        justificaciones: { ok: justificaciones.ok, mensaje: justificaciones.mensaje },
        apelaciones:     { ok: apelaciones.ok,     mensaje: apelaciones.mensaje }
      },
      message: ''
    };

  } catch (e) {
    Logger.log('❌ obtenerParticipacionSocio: ' + e.toString());
    return {
      success: false,
      sesionExpirada: false,
      meses: [],
      fuentes: {},
      message: 'No se pudo cargar tu participación en este momento.'
    };
  }
}

// ============================================================================
// LECTURA DE CADA FUENTE (todas devuelven {ok, registros, mensaje})
// ============================================================================

/**
 * Asistencias del socio, reutilizando el módulo de Brigada tal cual está.
 *
 * No se relee la planilla por cuenta propia: ese módulo ya resuelve el contrato
 * de 12 columnas, la unión de "Historico" + "Asistencia", la deduplicación por
 * ID y la caché. Duplicar esa lógica acá sería garantizar que las dos versiones
 * se desincronicen.
 */
function _participacionLeerAsistencias(sessionToken) {
  try {
    var r = obtenerAsistenciaBrigada(sessionToken);

    if (!r || !r.success) {
      return {
        ok: false,
        registros: [],
        mensaje: (r && r.message) ? r.message : 'No se pudo leer la asistencia.'
      };
    }

    var registros = [];
    var lista = r.registros || [];

    for (var i = 0; i < lista.length; i++) {
      // obtenerAsistenciaBrigada() entrega la fecha ya formateada como
      // "dd-MM-yyyy" (no hay un campo ISO), y _mesDesdeValor() lo contempla.
      //
      // Los registros históricos traen `mes` propio y pueden NO tener día: el
      // consolidado mensual del que salieron no siempre lo registra. Se usa ese
      // campo cuando viene, o si no se perderían justo las filas sin fecha
      // exacta —silenciosamente, que es la peor forma de perderlas.
      var mes = lista[i].mes || _mesDesdeValor(lista[i].fecha);
      if (!mes) continue;

      registros.push({
        mes: mes,
        actividad: lista[i].actividad || '',
        fecha: lista[i].fecha || '',
        via: lista[i].via || ''
      });
    }

    return { ok: true, registros: registros, mensaje: '' };

  } catch (e) {
    Logger.log('⚠️ Participación: falló la lectura de asistencia — ' + e.toString());
    return { ok: false, registros: [], mensaje: 'La asistencia no está disponible en este momento.' };
  }
}

/**
 * Mide cuanto tarda cada parte de la consulta que ve el socio.
 *
 * Requiere la propiedad RUT_DIAGNOSTICO_ASISTENCIA. Primero mide con las caches
 * vacias (el peor caso, que es lo que sufre el primer socio que entra) y
 * despues con las caches calientes.
 */
function _medirTiemposParticipacion() {
  _ensureConfig();
  var rutDiag = PropertiesService.getScriptProperties().getProperty('RUT_DIAGNOSTICO_ASISTENCIA');
  if (!rutDiag) {
    Logger.log('Falta la propiedad RUT_DIAGNOSTICO_ASISTENCIA.');
    return;
  }
  var rut = cleanRut(rutDiag);
  var log = ['===== TIEMPOS DE LA CONSULTA ====='];

  function medir(etiqueta, fn) {
    var t0 = new Date().getTime();
    var r = fn();
    var ms = new Date().getTime() - t0;
    log.push('   ' + etiqueta + ': ' + ms + ' ms');
    return r;
  }

  // Caches vacias: el peor caso
  try {
    var c = CacheService.getScriptCache();
    c.remove('catalogo_actividades_v1');
    c.remove('part_just_' + rut);
    c.remove('part_apel_' + rut);
    CFG_ASISTENCIA_BRIGADA.HOJAS_A_LEER.forEach(function(h) {
      c.remove(_claveCacheAsistencia(h, rut));
    });
    c.remove('user_' + rut);
  } catch (e) {}

  log.push('--- CACHES VACIAS (peor caso) ---');
  medir('Datos del socio', function() { return obtenerUsuarioPorRut(rut); });
  medir('Catalogo de actividades', function() { return obtenerCatalogoActividades(''); });
  medir('Asistencia (Brigada)', function() { return _leerAsistenciaBrigadaPorRut(rut); });
  medir('Justificaciones', function() { return _participacionLeerJustificaciones(rut); });
  medir('Apelaciones', function() { return _participacionLeerApelaciones(rut); });

  log.push('--- CACHES CALIENTES (visitas siguientes) ---');
  medir('Datos del socio', function() { return obtenerUsuarioPorRut(rut); });
  medir('Catalogo de actividades', function() { return obtenerCatalogoActividades(''); });
  medir('Asistencia (Brigada)', function() { return _leerAsistenciaBrigadaPorRut(rut); });
  medir('Justificaciones', function() { return _participacionLeerJustificaciones(rut); });
  medir('Apelaciones', function() { return _participacionLeerApelaciones(rut); });

  log.push('Recuerda BORRAR RUT_DIAGNOSTICO_ASISTENCIA al terminar.');
  Logger.log(log.join(String.fromCharCode(10)));
  return log.join(String.fromCharCode(10));
}

/**
 * Igual que _participacionLeerAsistencias pero partiendo del RUT en vez del
 * token de sesion. SOLO para diagnostico desde el editor: los endpoints que
 * atienden al socio deben seguir resolviendo el RUT desde la sesion.
 */
function _participacionLeerAsistenciasPorRut(rutLimpio) {
  var salida = [];
  try {
    // Misma unión que ve el socio en su historial, para que el diagnóstico
    // describa lo que la aplicación muestra y no una versión parcial.
    var lista = _unirAsistenciaHistorica(_leerAsistenciaBrigadaPorRut(rutLimpio), rutLimpio) || [];
    for (var i = 0; i < lista.length; i++) {
      var mes = _mesDesdeValor(lista[i].fecha);
      if (!mes) continue;
      salida.push({ mes: mes, actividad: lista[i].actividad || '',
                    fecha: lista[i].fecha || '', via: lista[i].via || '' });
    }
  } catch (e) {
    Logger.log('_participacionLeerAsistenciasPorRut: ' + e.toString());
  }
  return salida;
}

/**
 * Justificaciones del socio. SÓLO LECTURA de BD_JUSTIFICACIONES.
 */
function _participacionLeerJustificaciones(rutLimpio) {
  // Cache por RUT y TTL corto. La hoja tiene ~1.400 filas y se leia entera en
  // cada consulta; el socio esperaba esa lectura mirando el loader. El TTL es
  // corto a proposito: el estado de un tramite lo cambia el directorio a mano y
  // el socio debe verlo reflejado pronto.
  var claveCache = 'part_just_' + rutLimpio;
  try {
    var enCache = CacheService.getScriptCache().get(claveCache);
    if (enCache) return JSON.parse(enCache);
  } catch (eC) {}

  try {
    var ss = getSpreadsheet('JUSTIFICACIONES');
    var hoja = ss.getSheetByName(CONFIG.HOJAS.JUSTIFICACIONES);

    if (!hoja) {
      return { ok: false, registros: [], mensaje: 'No se encontró la hoja de justificaciones.' };
    }

    var lastRow = hoja.getLastRow();
    if (lastRow < 2) return { ok: true, registros: [], mensaje: '' };

    var COL = CONFIG.COLUMNAS.JUSTIFICACIONES;
    var datos = hoja.getRange(2, 1, lastRow - 1, hoja.getLastColumn()).getValues();
    var registros = [];

    for (var i = 0; i < datos.length; i++) {
      if (cleanRut(datos[i][COL.RUT]) !== rutLimpio) continue;

      // El mes sale del código de asamblea; si no se puede leer, la fecha de
      // solicitud es un respaldo razonable: se justifica dentro del mismo mes.
      var mes = _mesDesdeCodigoAsamblea(datos[i][COL.ASAMBLEA]) ||
                _mesDesdeValor(datos[i][COL.FECHA]);
      if (!mes) continue;

      registros.push({
        mes: mes,
        estado: String(datos[i][COL.ESTADO] || '').trim(),
        motivo: String(datos[i][COL.MOTIVO] || '').trim(),
        observacion: String(datos[i][COL.OBSERVACION] || '').trim(),
        asamblea: String(datos[i][COL.ASAMBLEA] || '').trim()
      });
    }

    var resultado = { ok: true, registros: registros, mensaje: '' };
    try { CacheService.getScriptCache().put(claveCache, JSON.stringify(resultado), 120); } catch (eP) {}
    return resultado;

  } catch (e) {
    Logger.log('⚠️ Participación: falló la lectura de justificaciones — ' + e.toString());
    return { ok: false, registros: [], mensaje: 'Las justificaciones no están disponibles en este momento.' };
  }
}

/**
 * Apelaciones del socio. SÓLO LECTURA de BD_APELACIONES.
 */
function _participacionLeerApelaciones(rutLimpio) {
  var claveCacheAp = 'part_apel_' + rutLimpio;
  try {
    var enCacheAp = CacheService.getScriptCache().get(claveCacheAp);
    if (enCacheAp) return JSON.parse(enCacheAp);
  } catch (eC) {}

  try {
    var ss = getSpreadsheet('APELACIONES');
    var hoja = ss.getSheetByName(CONFIG.HOJAS.APELACIONES);

    if (!hoja) {
      return { ok: false, registros: [], mensaje: 'No se encontró la hoja de apelaciones.' };
    }

    var lastRow = hoja.getLastRow();
    if (lastRow < 2) return { ok: true, registros: [], mensaje: '' };

    var COL = CONFIG.COLUMNAS.APELACIONES;
    var datos = hoja.getRange(2, 1, lastRow - 1, hoja.getLastColumn()).getValues();
    var registros = [];

    for (var i = 0; i < datos.length; i++) {
      if (cleanRut(datos[i][COL.RUT]) !== rutLimpio) continue;

      // MES_APELACION debería venir como texto "YYYY-MM" (el módulo lo guarda
      // forzando el formato), pero en la planilla real 85 de 378 filas están
      // como Date: Sheets interpretó "2026-01" y lo convirtió al 1 de enero de
      // 2026. Ese Date SIGUE SIENDO el mes apelado, así que se lee de ahí.
      //
      // El orden importa y no es cosmético: caer directamente a
      // FECHA_SOLICITUD atribuiría la apelación al mes en que se presentó el
      // trámite, no al mes reclamado. Una apelación de enero presentada en
      // marzo contaría como participación de marzo — un dato incorrecto, en
      // silencio, en el 22% de las filas.
      var crudoMes = datos[i][COL.MES_APELACION];
      var mes = _normalizarMes(crudoMes) ||
                _mesDesdeValor(crudoMes) ||
                _mesDesdeValor(datos[i][COL.FECHA_SOLICITUD]);
      if (!mes) continue;

      registros.push({
        mes: mes,
        estado: String(datos[i][COL.ESTADO] || '').trim(),
        motivo: String(datos[i][COL.TIPO_MOTIVO] || '').trim(),
        observacion: String(datos[i][COL.OBSERVACION] || '').trim()
      });
    }

    var resultadoAp = { ok: true, registros: registros, mensaje: '' };
    try { CacheService.getScriptCache().put(claveCacheAp, JSON.stringify(resultadoAp), 120); } catch (eP) {}
    return resultadoAp;

  } catch (e) {
    Logger.log('⚠️ Participación: falló la lectura de apelaciones — ' + e.toString());
    return { ok: false, registros: [], mensaje: 'Las apelaciones no están disponibles en este momento.' };
  }
}

// ============================================================================
// CONSOLIDACIÓN
// ============================================================================

/**
 * Une las tres fuentes en una entrada por mes, resolviendo el resultado.
 *
 * PRECEDENCIA (de mayor a menor): asistió > justificado > apelación acogida >
 * en revisión > sin participación. Un socio que asistió Y justificó el mismo
 * mes cuenta como que asistió: es el hecho más fuerte y el que ocurrió primero.
 *
 * @return {Array} meses ordenados del más reciente al más antiguo
 */
function _consolidarParticipacionPorMes(asistencias, justificaciones, apelaciones) {
  var R = CFG_PARTICIPACION.RESULTADO;
  var porMes = {};

  function bucket(mes) {
    if (!porMes[mes]) {
      porMes[mes] = {
        mes: mes,
        asistencias: [],
        justificaciones: [],
        apelaciones: []
      };
    }
    return porMes[mes];
  }

  for (var a = 0; a < asistencias.length; a++) bucket(asistencias[a].mes).asistencias.push(asistencias[a]);
  for (var j = 0; j < justificaciones.length; j++) bucket(justificaciones[j].mes).justificaciones.push(justificaciones[j]);
  for (var p = 0; p < apelaciones.length; p++) bucket(apelaciones[p].mes).apelaciones.push(apelaciones[p]);

  var salida = [];

  Object.keys(porMes).forEach(function(mes) {
    var b = porMes[mes];

    var justAprobada = _primeroConEstado(b.justificaciones, CFG_PARTICIPACION.ESTADOS_JUSTIFICACION_APROBADA);
    var apelAprobada = _primeroConEstado(b.apelaciones, CFG_PARTICIPACION.ESTADOS_APELACION_APROBADA);
    var enRevision   = _primeroConEstado(b.justificaciones, CFG_PARTICIPACION.ESTADOS_EN_REVISION) ||
                       _primeroConEstado(b.apelaciones, CFG_PARTICIPACION.ESTADOS_EN_REVISION);

    var resultado, detalle;

    if (b.asistencias.length > 0) {
      resultado = R.ASISTIO;
      detalle = 'Asististe a la actividad.';
    } else if (justAprobada) {
      resultado = R.JUSTIFICADO;
      detalle = 'No asististe, pero tu justificación fue aprobada.';
    } else if (apelAprobada) {
      resultado = R.APELACION_ACOGIDA;
      detalle = 'Tu apelación fue acogida: se acreditó que tu ausencia estaba justificada.';
    } else if (enRevision) {
      resultado = R.EN_REVISION;
      detalle = 'Tienes un trámite en revisión para este mes.';
    } else {
      resultado = R.SIN_PARTICIPACION;
      detalle = 'No hay asistencia ni trámites aprobados para este mes.';
    }

    salida.push({
      mes: mes,
      mesLegible: _mesLegible(mes),
      resultado: resultado,
      participo: (resultado === R.ASISTIO ||
                  resultado === R.JUSTIFICADO ||
                  resultado === R.APELACION_ACOGIDA),
      detalle: detalle,
      asistencias: b.asistencias,
      justificaciones: b.justificaciones,
      apelaciones: b.apelaciones
    });
  });

  // Del mes más reciente al más antiguo. "YYYY-MM" ordena bien como texto.
  salida.sort(function(x, y) { return x.mes < y.mes ? 1 : (x.mes > y.mes ? -1 : 0); });

  return salida;
}

/**
 * Primer registro cuyo estado esté en la lista dada (comparación en minúsculas
 * y sin espacios: los estados los escriben personas en una planilla).
 */
function _primeroConEstado(registros, estadosValidos) {
  for (var i = 0; i < registros.length; i++) {
    var estado = String(registros[i].estado || '').trim().toLowerCase();
    if (estadosValidos.indexOf(estado) !== -1) return registros[i];
  }
  return null;
}

// ============================================================================
// VISTA ANUAL (catálogo + participación)
// ============================================================================

// Estados de un mes en la grilla anual. Los tres primeros y EN_REVISION vienen
// de CFG_PARTICIPACION.RESULTADO; los otros cuatro sólo existen acá porque
// requieren saber qué actividades hubo, y eso lo aporta el catálogo.
// Valores de region que NO identifican una region. Normalizados con
// _normalizarRegionParaComparar (sin puntuacion ni espacios), que es la forma
// en que se comparan: "S/D" llega aqui como "SD".
var CENTINELAS_SIN_REGION = ['SD', 'SINDATO', 'SINREGION', 'NA'];

var ESTADOS_MES_ANUAL = {
  ASISTIO:           'ASISTIO',
  JUSTIFICADO:       'JUSTIFICADO',
  APELACION_ACOGIDA: 'APELACION_ACOGIDA',
  EN_REVISION:       'EN_REVISION',
  EN_PLAZO:          'EN_PLAZO',          // la actividad aun no ocurre o el plazo sigue abierto
  FALTA:             'FALTA',             // hubo actividad y no hay participacion valida
  SIN_ACTIVIDAD:     'SIN_ACTIVIDAD',     // no hubo actividad ese mes
  SIN_INFORMACION:   'SIN_INFORMACION',   // anterior al inicio del registro
  NO_EVALUADO:       'NO_EVALUADO',       // anterior al corte de datos confiables
  NO_AFILIADO:       'NO_AFILIADO',       // anterior a la afiliacion del socio
  FUTURO:            'FUTURO'             // todavía no ocurre
};

/**
 * Participación del socio de la sesión a lo largo de un año, mes por mes.
 *
 * Es la union de dos preguntas distintas:
 *   - ¿qué actividades hubo?  → catálogo (Modulo actividades.js)
 *   - ¿qué hizo este socio?   → obtenerParticipacionSocio()
 *
 * Sin la primera no hay denominador: un mes vacío puede ser "no hubo asamblea"
 * o "hubo y no fuiste", que son cosas opuestas. Y antes del inicio del registro
 * no se puede afirmar ninguna de las dos, por eso existe SIN_INFORMACION: es
 * preferible decir "no sabemos" a imputarle al socio una ausencia que nadie
 * puede probar.
 *
 * @param {string} sessionToken Token de sesión. El RUT NUNCA llega del cliente.
 * @param {string|number} anio  Año a mostrar; vacío = año en curso.
 */
function obtenerParticipacionAnual(sessionToken, anio) {
  _ensureConfig();

  try {
    var rutSesion = obtenerRutDeSesion(sessionToken);
    if (!rutSesion) {
      return {
        success: false, sesionExpirada: true, anio: '', anios: [], meses: [],
        resumen: {}, message: 'Tu sesión expiró. Vuelve a ingresar.'
      };
    }

    var TZ = CFG_PARTICIPACION.ZONA_HORARIA;
    var hoy = new Date();
    var anioActual = parseInt(Utilities.formatDate(hoy, TZ, 'yyyy'), 10);
    var mesActual  = parseInt(Utilities.formatDate(hoy, TZ, 'MM'), 10);

    var anioElegido = parseInt(String(anio || '').trim(), 10);
    if (!anioElegido) anioElegido = anioActual;

    // --- De que region es este socio ---
    // El catalogo tiene las asambleas de las 18 regiones, pero a un socio solo
    // le corresponden las SUYAS. Sin este filtro se le mostraban todas y, peor,
    // se le imputaba una falta por cada asamblea de cualquier region a la que
    // obviamente no tenia por que asistir.
    var usuario = obtenerUsuarioPorRut(rutSesion);
    var regionSocio = (usuario && usuario.encontrado) ? String(usuario.region || '').trim() : '';
    var regionSocioNorm = _normalizarRegionParaComparar(regionSocio);

    // "S/D" es el centinela de "sin dato" de BD_SLIMAPP, no una region. La
    // auditoria del 31-08-2026 encontro 138 socios asi. Tratarlo como region
    // real hace que se busquen asambleas de una region inexistente: el socio
    // veria todos los meses como "no se registraron actividades", sin
    // explicacion. Se trata igual que no tener region: no se le imputan faltas
    // y se le dice por que.
    if (CENTINELAS_SIN_REGION.indexOf(regionSocioNorm) !== -1) {
      regionSocio = '';
      regionSocioNorm = '';
    }

    // Desde cuando es socio. Antes de esa fecha no habia nada que cumplir, asi
    // que no se le muestran meses en falta de una epoca en que no pertenecia al
    // sindicato. Sin fecha legible no se restringe nada (ver _mesDeAfiliacion).
    var mesAfiliacion = (usuario && usuario.encontrado)
      ? _mesDeAfiliacion(usuario.fechaIngreso) : '';

    // --- Qué actividades hubo ---
    // UNA sola lectura del catalogo por consulta. Antes se pedia tres veces
    // —el anio, el historico completo, y los anios disponibles, que internamente
    // volvia a pedir el completo— y cada una abria la planilla. Ahora se lee
    // entero una vez y lo demas se deriva en memoria.
    var catalogoTodo = obtenerCatalogoActividades('');
    var todasActividades = (catalogoTodo.actividades || []);
    var actividadesAnio = todasActividades.filter(function(a) {
      return a.anio === String(anioElegido);
    });

    var aniosCatalogo = {};
    todasActividades.forEach(function(a) { if (a.anio) aniosCatalogo[a.anio] = true; });

    // Mes más antiguo con registro, para saber desde cuándo se puede afirmar
    // algo. Antes de ese mes el catálogo no prueba ausencia de actividades.
    var primerMesRegistrado = '';
    todasActividades.forEach(function(a) {
      if (a.mes && (!primerMesRegistrado || a.mes < primerMesRegistrado)) primerMesRegistrado = a.mes;
    });

    // Actividades del año que le corresponden a ESTE socio, agrupadas por mes.
    // Si no se conoce su region no se filtra por region alguna: se prefiere no
    // mostrarle actividades ajenas (ver mas abajo, quedan sin faltas) antes que
    // mostrarle las de todo el pais.
    var actividadesPorMes = {};
    actividadesAnio.forEach(function(a) {
      if (!a.mes) return;
      if (regionSocioNorm && _normalizarRegionParaComparar(a.region) !== regionSocioNorm) return;
      if (!actividadesPorMes[a.mes]) actividadesPorMes[a.mes] = [];
      actividadesPorMes[a.mes].push(a);
    });

    // --- Qué hizo el socio ---
    var participacion = obtenerParticipacionSocio(sessionToken);
    var participacionPorMes = {};
    var aniosParticipacion = {};
    if (participacion && participacion.success) {
      (participacion.meses || []).forEach(function(m) {
        participacionPorMes[m.mes] = m;
        // Los años del selector no pueden salir sólo del catálogo: un socio con
        // justificaciones de un año que el catálogo todavía no cubre se quedaría
        // sin forma de llegar a ellas.
        if (m.mes) aniosParticipacion[m.mes.split('-')[0]] = true;
      });
    }

    // --- Un registro por cada mes del año ---
    var meses = [];
    var resumen = { actividades: 0, mesesConActividad: 0, mesesParticipados: 0,
                    mesesSinInformacion: 0, mesesNoEvaluados: 0, faltas: 0 };

    for (var n = 1; n <= 12; n++) {
      var clave = anioElegido + '-' + _dosDigitos(n);
      var actividades = actividadesPorMes[clave] || [];
      var p = participacionPorMes[clave];
      var estado, detalle;

      var esFuturo = (anioElegido > anioActual) || (anioElegido === anioActual && n > mesActual);

      // ORDEN DE PRECEDENCIA — el primero que aplica gana.
      //
      // ⚠️ LO QUE EL SOCIO HIZO VA PRIMERO, ANTES QUE EL CATALOGO. Su asistencia,
      // su justificacion aprobada o su apelacion acogida son hechos suyos y no
      // dependen de que la actividad este registrada en el calendario. El
      // catalogo cubre desde mayo de 2026 hacia adelante, asi que preguntar
      // primero por las actividades escondia toda la participacion anterior a
      // esa fecha: una justificacion aprobada en marzo aparecia como "sin
      // informacion". El catalogo sirve para explicar los meses VACIOS, nunca
      // para tapar los que tienen registro.
      var tieneParticipacion = (p && p.resultado && p.resultado !== 'SIN_PARTICIPACION');

      // El corte manda sobre todo lo demas, incluso sobre la participacion:
      // antes de esta fecha los datos estan incompletos y cualquier conclusion
      // —a favor o en contra del socio— seria poco fiable.
      //
      // La carga historica manual levanta ese bloqueo, pero SOLO en el par
      // zona+mes que ya se cargo (Modulo asistenciaHistorica.js). Abrirlo por
      // mes completo dejaria en FALTA a todas las zonas todavia sin cargar, que
      // es exactamente la falta falsa que el corte existe para evitar.
      if (!_mesEvaluableConHistorico(clave, regionSocioNorm)) {
        estado = ESTADOS_MES_ANUAL.NO_EVALUADO;
        detalle = 'Periodo anterior al registro completo del sistema. No se evalúa participación.';
        resumen.mesesNoEvaluados++;

      } else if (tieneParticipacion) {
        estado  = p.resultado;
        detalle = p.detalle || '';
        if (p.participo) resumen.mesesParticipados++;
        // Un mes con participacion cuenta como mes con actividad aunque el
        // catalogo no la tenga: la participacion misma es la prueba de que hubo.
        resumen.mesesConActividad++;
        resumen.actividades += actividades.length;

      } else if (esFuturo) {
        estado = ESTADOS_MES_ANUAL.FUTURO;
        detalle = 'Todavía no ocurre.';

      } else if (mesAfiliacion && clave < mesAfiliacion) {
        // Va despues de la participacion: si hay registro de que participo, ese
        // hecho manda sobre la fecha de la ficha, que se carga a mano.
        estado = ESTADOS_MES_ANUAL.NO_AFILIADO;
        detalle = 'Todavía no eras socio. Este mes no se evalúa.';
        resumen.mesesNoEvaluados++;

      } else if (!regionSocioNorm) {
        // No se sabe de que region es: no se puede afirmar que actividad le
        // correspondia, asi que tampoco se le puede imputar una falta. Se
        // informa la limitacion en vez de inventar un juicio sobre el socio.
        estado = ESTADOS_MES_ANUAL.SIN_INFORMACION;
        detalle = 'No tienes una región registrada, así que no podemos determinar qué actividades te correspondían.';
        resumen.mesesSinInformacion++;

      } else if (actividades.length > 0) {
        // Hubo actividad y no hay registro suyo. Esto es lo que antes no se
        // podía mostrar: sin catálogo, este mes simplemente no aparecía.
        resumen.mesesConActividad++;
        resumen.actividades += actividades.length;

        // ¿Todavia se puede hacer algo con este mes? Un mes NO puede marcarse
        // como falta mientras alguna de sus actividades no haya ocurrido, o
        // mientras siga abierto su plazo para justificar.
        //
        // "Mes futuro" mira solo el numero del mes, asi que el dia 1 el mes
        // entero dejaba de ser futuro y caia de inmediato en falta: el 1 de
        // septiembre el socio habria visto FALTA en rojo, con boton de apelar,
        // por asambleas que recien se realizaban el 5 y cuyo plazo para
        // justificar vencia el 14. Es el mismo error que evitamos con los meses
        // viejos, pero por el otro extremo del calendario.
        var plazo = _plazoAbiertoDelMes(actividades, hoy);

        if (plazo.abierto) {
          estado = ESTADOS_MES_ANUAL.EN_PLAZO;
          detalle = plazo.detalle;

        } else {
          // FALTA. Basta UNA participacion valida en el mes para que no lo sea:
          // la rama de arriba ya capturo ese caso, porque la participacion se
          // resuelve por mes y no por actividad. Un mes con tres asambleas al
          // que el socio fue una vez cuenta como participacion, no como falta.
          estado = ESTADOS_MES_ANUAL.FALTA;
          detalle = actividades.length === 1
            ? 'Hubo una actividad y no registras participación.'
            : 'Hubo ' + actividades.length + ' actividades y no registras participación en ninguna.';
          resumen.faltas++;
        }

      } else if (primerMesRegistrado && clave < primerMesRegistrado) {
        // Sin actividades y antes del inicio del registro: no se puede afirmar
        // que no hubo asamblea, sólo que nadie la anotó.
        estado = ESTADOS_MES_ANUAL.SIN_INFORMACION;
        detalle = 'No hay registro de actividades de este mes.';
        resumen.mesesSinInformacion++;

      } else {
        estado = ESTADOS_MES_ANUAL.SIN_ACTIVIDAD;
        detalle = 'No se registraron actividades este mes.';
      }

      meses.push({
        // Un mes en FALTA es el unico que se puede apelar: hubo actividad y no
        // hay participacion registrada, que es justo lo que se reclama ante una
        // multa. El frontend usa esto para ofrecer el acceso a Apelaciones.
        apelable: (estado === ESTADOS_MES_ANUAL.FALTA),
        mes: clave,
        numero: n,
        nombre: _nombreMesCorto(n),
        estado: estado,
        detalle: detalle,
        cantidadActividades: actividades.length,
        // Un mes en plazo no se puede apelar todavia: no hay multa que reclamar.
        actividades: actividades.map(function(a) {
          // Se entregan los campos YA presentables (derivados en el catalogo),
          // no los crudos de la planilla: la vista no deberia saber que la
          // region trae un prefijo de orden ni que el nombre la repite adentro.
          return {
            nombre:    a.nombreCorto || a.nombre,
            modalidad: a.modalidad || '',
            region:    a.regionCorta || a.region,
            sede:      a.sede || '',
            fecha:     a.fecha,
            precision: a.precision
          };
        })
      });
    }

    return {
      success: true,
      sesionExpirada: false,
      anio: String(anioElegido),
      region: regionSocio,
      sinRegion: !regionSocioNorm,
      inicioDatos: CFG_PARTICIPACION.INICIO_DATOS_EVALUABLES,
      // Desde cuando se le evalua. Viaja al frontend para poder explicarle por
      // que los meses anteriores aparecen bloqueados: sin este dato, un socio
      // recien afiliado ve medio calendario en gris y no sabe si es un problema
      // del sistema o algo que le falta hacer.
      mesAfiliacion: mesAfiliacion,
      socioDesde: mesAfiliacion ? _mesLegible(mesAfiliacion) : '',
      anios: _unirAnios(Object.keys(aniosCatalogo),
                        Object.keys(aniosParticipacion), String(anioElegido)),
      // Se propaga tal cual viene de obtenerParticipacionSocio(): si una de las
      // tres bases fallo, el socio DEBE saberlo. Sin esto, una justificacion que
      // no se pudo leer se ve identica a una que no existe -- un error tecnico
      // disfrazado de ausencia, que es la peor forma de equivocarse aca.
      fuentes: (participacion && participacion.fuentes) ? participacion.fuentes : {},
      catalogoOk: !!(catalogoTodo && catalogoTodo.success),
      meses: meses,
      resumen: resumen,
      message: ''
    };

  } catch (e) {
    Logger.log('❌ obtenerParticipacionAnual: ' + e.toString());
    return {
      success: false, sesionExpirada: false, anio: '', anios: [], meses: [],
      resumen: {}, message: 'No se pudo cargar tu participación anual.'
    };
  }
}

/**
 * Une los años del catálogo con los años en que el socio tiene participación,
 * más el que se está mostrando. Del más reciente al más antiguo, sin repetir.
 */
function _unirAnios(aniosCatalogo, aniosSocio, anioElegido) {
  var vistos = {};
  [].concat(aniosCatalogo || [], aniosSocio || [], [anioElegido]).forEach(function(a) {
    var x = String(a || '').trim();
    if (x) vistos[x] = true;
  });
  return Object.keys(vistos).sort(function(x, y) { return y.localeCompare(x); });
}

/**
 * Forma canonica de una region, SOLO para comparar.
 *
 * La misma region se escribe distinto segun quien la haya cargado: con o sin el
 * prefijo de orden ("07. "), con o sin punto final, con o sin tildes. Comparar
 * el texto crudo haria que a un socio no le calzara ninguna actividad y
 * apareciera como si no le correspondiera ninguna asamblea.
 *
 * Nunca se usa para MOSTRAR ni para escribir: solo para decidir si dos textos
 * hablan de la misma region.
 */
function _normalizarRegionParaComparar(valor) {
  return String(valor || '')
    .toUpperCase()
    .replace(/[ÁÀÄÂ]/g, 'A').replace(/[ÉÈËÊ]/g, 'E').replace(/[ÍÌÏÎ]/g, 'I')
    .replace(/[ÓÒÖÔ]/g, 'O').replace(/[ÚÙÜÛ]/g, 'U').replace(/Ñ/g, 'N')
    .replace(/^\s*\d+\s*\.\s*/, '')   // prefijo de orden "07. "
    .replace(/[^A-Z0-9]+/g, '')        // puntuacion y espacios
    .trim();
}

/**
 * ¿Este mes todavia esta abierto, o ya se puede concluir que hubo falta?
 *
 * Un mes sigue abierto mientras:
 *   - alguna de sus actividades no haya ocurrido todavia, o
 *   - alguna conserve su plazo de justificacion vigente.
 *
 * El plazo sale de FECHA_LIMITE del catalogo, que es el mismo que el
 * administrador configura al programar la justificacion. Cuando una actividad
 * no tiene plazo registrado se usa el final del dia del evento: la asamblea del
 * dia 5 no puede darse por perdida a las 9 de la manana del dia 5.
 *
 * @return {{abierto: boolean, detalle: string}}
 */
function _plazoAbiertoDelMes(actividades, ahora) {
  var TZ = CFG_PARTICIPACION.ZONA_HORARIA;
  var ahoraMs = ahora.getTime();
  var limiteMasLejano = null;
  var algunaSinRealizar = false;

  for (var i = 0; i < actividades.length; i++) {
    var a = actividades[i];

    // Fin del dia del evento: hasta ahi la actividad se considera en curso.
    var finEvento = null;
    if (a.fechaOrden) {
      var d = new Date(a.fechaOrden);
      finEvento = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59).getTime();
      if (finEvento > ahoraMs) algunaSinRealizar = true;
    }

    // El plazo de justificacion, cuando existe, siempre es posterior al evento.
    var candidato = Math.max(a.fechaLimiteOrden || 0, finEvento || 0);
    if (candidato && (limiteMasLejano === null || candidato > limiteMasLejano)) {
      limiteMasLejano = candidato;
    }
  }

  // Sin ninguna fecha utilizable no se puede afirmar que el plazo siga abierto,
  // pero tampoco cerrado. Se deja cerrado para no ocultar faltas antiguas: las
  // actividades sin fecha son las mas viejas del catalogo.
  if (limiteMasLejano === null) return { abierto: false, detalle: '' };
  if (ahoraMs >= limiteMasLejano) return { abierto: false, detalle: '' };

  var textoLimite = Utilities.formatDate(new Date(limiteMasLejano), TZ, 'dd-MM-yyyy');

  return {
    abierto: true,
    detalle: algunaSinRealizar
      ? 'Este mes tiene actividades que aún no se realizan. Si no puedes asistir, tienes plazo para justificar hasta el ' + textoLimite + '.'
      : 'Todavía estás en plazo para justificar tu inasistencia, hasta el ' + textoLimite + '.'
  };
}

/** Nombre corto del mes (1-12), para las casillas de la grilla. */
function _nombreMesCorto(n) {
  var nombres = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  return nombres[n - 1] || String(n);
}

// ============================================================================
// NORMALIZACIÓN DE MESES
// ============================================================================

/**
 * "YYYY-MM" a partir de un valor que puede ser Date o texto.
 * Acepta el formato chileno dd/MM/yyyy, que es como salen varias fechas de las
 * planillas cuando se leen como texto.
 */
function _mesDesdeValor(valor) {
  if (!valor) return '';

  if (valor instanceof Date && !isNaN(valor)) {
    return Utilities.formatDate(valor, CFG_PARTICIPACION.ZONA_HORARIA, 'yyyy-MM');
  }

  var texto = String(valor).trim();

  // dd/MM/yyyy o dd-MM-yyyy, con hora opcional detrás.
  var chileno = texto.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (chileno) return chileno[3] + '-' + _dosDigitos(chileno[2]);

  // yyyy-MM-dd o yyyy/MM/dd
  var iso = texto.match(/^(\d{4})[\/\-](\d{1,2})/);
  if (iso) return iso[1] + '-' + _dosDigitos(iso[2]);

  return '';
}

/**
 * "YYYY-MM" desde el código de asamblea de justificaciones, que viene en dos
 * formatos según cómo estuviera configurada la actividad:
 *
 *   "2026-08-15_Asamblea Ordinaria"  -> evento con fecha
 *   "2026_08"                        -> modo mes
 */
function _mesDesdeCodigoAsamblea(codigo) {
  var texto = String(codigo || '').trim();
  if (!texto) return '';

  // Evento con fecha: los primeros 7 caracteres ya son "YYYY-MM".
  var conFecha = texto.match(/^(\d{4})-(\d{2})-\d{2}/);
  if (conFecha) return conFecha[1] + '-' + conFecha[2];

  // Modo mes: "YYYY_MM".
  var modoMes = texto.match(/^(\d{4})_(\d{1,2})$/);
  if (modoMes) return modoMes[1] + '-' + _dosDigitos(modoMes[2]);

  return '';
}

/** Valida y normaliza un "YYYY-MM" ya formado. */
function _normalizarMes(valor) {
  var texto = String(valor || '').trim();
  var m = texto.match(/^(\d{4})-(\d{1,2})$/);
  return m ? m[1] + '-' + _dosDigitos(m[2]) : '';
}

function _dosDigitos(n) {
  var s = String(parseInt(n, 10));
  return s.length < 2 ? '0' + s : s;
}

/** "2026-08" -> "agosto de 2026". */
function _mesLegible(mes) {
  var m = String(mes || '').match(/^(\d{4})-(\d{2})$/);
  if (!m) return mes;

  var nombres = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
                 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  var indice = parseInt(m[2], 10) - 1;

  return (nombres[indice] || m[2]) + ' de ' + m[1];
}

// ============================================================================
// DIAGNÓSTICO
// ============================================================================

/**
 * Mide si el cruce por mes FUNCIONA sobre los datos reales, sin mirar a nadie.
 *
 * Recorre TODAS las filas de justificaciones y apelaciones e intenta extraer el
 * mes de cada una. Reporta cuántas se pudieron interpretar, cuántas no, con qué
 * formatos vienen los códigos y qué rango de meses cubren.
 *
 * Es la validación que de verdad importa antes de mostrarle esto a un socio: si
 * un porcentaje alto de códigos no se puede interpretar, el cruce por mes no
 * sirve y hay que adaptar el módulo de justificaciones.
 *
 * NO expone datos personales: no lee ni muestra RUT ni nombres, sólo códigos de
 * asamblea, estados y conteos. SÓLO LECTURA.
 */
function _diagnosticarFormatosParticipacion() {
  _ensureConfig();
  var log = ['===== FORMATOS Y COBERTURA DEL CRUCE POR MES ====='];

  // --- Justificaciones: el caso difícil, por los dos formatos de código ---
  try {
    var ssJ = getSpreadsheet('JUSTIFICACIONES');
    var hojaJ = ssJ.getSheetByName(CONFIG.HOJAS.JUSTIFICACIONES);
    var COLJ = CONFIG.COLUMNAS.JUSTIFICACIONES;
    var lastJ = hojaJ.getLastRow();
    var datosJ = hojaJ.getRange(2, 1, lastJ - 1, hojaJ.getLastColumn()).getValues();

    var porCodigo = 0, porFecha = 0, sinMes = 0;
    var formatos = {};
    var ejemplosSinMes = [];
    var estados = {};
    var meses = {};

    for (var i = 0; i < datosJ.length; i++) {
      var codigo = String(datosJ[i][COLJ.ASAMBLEA] || '').trim();

      // Clasificación del formato del código, sin interpretar su contenido.
      var forma = codigo === ''                            ? '(vacío)'
                : /^\d{4}-\d{2}-\d{2}_/.test(codigo)       ? 'YYYY-MM-DD_Nombre'
                : /^\d{4}_\d{1,2}$/.test(codigo)           ? 'YYYY_MM'
                : /^\d{4}-\d{2}-\d{2}$/.test(codigo)       ? 'YYYY-MM-DD'
                : 'otro';
      formatos[forma] = (formatos[forma] || 0) + 1;

      if (forma === 'otro' && ejemplosSinMes.length < 8) ejemplosSinMes.push(codigo);

      var estado = String(datosJ[i][COLJ.ESTADO] || '(vacío)').trim();
      estados[estado] = (estados[estado] || 0) + 1;

      var mes = _mesDesdeCodigoAsamblea(codigo);
      if (mes) {
        porCodigo++;
      } else {
        mes = _mesDesdeValor(datosJ[i][COLJ.FECHA]);
        if (mes) porFecha++; else sinMes++;
      }
      if (mes) meses[mes] = (meses[mes] || 0) + 1;
    }

    log.push('');
    log.push('--- JUSTIFICACIONES: ' + datosJ.length + ' filas ---');
    log.push('   Mes obtenido del código:  ' + porCodigo);
    log.push('   Mes obtenido de la fecha: ' + porFecha + '  (respaldo)');
    log.push('   SIN mes:                  ' + sinMes + (sinMes ? '   ⚠️ estas quedarían fuera' : '   ✅'));
    log.push('   Cobertura: ' + Math.round(((datosJ.length - sinMes) / datosJ.length) * 100) + '%');
    log.push('');
    log.push('   Formatos de código encontrados:');
    Object.keys(formatos).sort().forEach(function(k) { log.push('      ' + formatos[k] + '  ' + k); });
    if (ejemplosSinMes.length) {
      log.push('   Ejemplos de códigos "otro": ' + ejemplosSinMes.join(' | '));
    }
    log.push('');
    log.push('   Estados presentes:');
    Object.keys(estados).sort().forEach(function(k) { log.push('      ' + estados[k] + '  "' + k + '"'); });
    log.push('   Meses distintos cubiertos: ' + Object.keys(meses).length +
             '  (' + Object.keys(meses).sort()[0] + ' a ' + Object.keys(meses).sort().pop() + ')');

  } catch (e) {
    log.push('❌ Justificaciones: ' + e.toString());
  }

  // --- Apelaciones: el mes ya viene explícito, se confirma que sea legible ---
  try {
    var ssA = getSpreadsheet('APELACIONES');
    var hojaA = ssA.getSheetByName(CONFIG.HOJAS.APELACIONES);
    var COLA = CONFIG.COLUMNAS.APELACIONES;
    var lastA = hojaA.getLastRow();
    var datosA = hojaA.getRange(2, 1, lastA - 1, hojaA.getLastColumn()).getValues();

    var okA = 0, comoFecha = 0, porFechaA = 0, sinMesA = 0;
    var estadosA = {};
    var mesesDesdeDate = {};
    var desviaciones = 0;

    for (var j = 0; j < datosA.length; j++) {
      var crudo = datosA[j][COLA.MES_APELACION];
      var mesA = _normalizarMes(crudo);

      if (mesA) {
        okA++;
      } else {
        // El MES_APELACION guardado como Date: sigue siendo el mes apelado.
        mesA = _mesDesdeValor(crudo);
        if (mesA) {
          comoFecha++;
          mesesDesdeDate[mesA] = (mesesDesdeDate[mesA] || 0) + 1;

          // ¿Cuántas de éstas se habrían atribuido al mes equivocado si se
          // hubiese usado la fecha de solicitud como respaldo?
          var mesSolicitud = _mesDesdeValor(datosA[j][COLA.FECHA_SOLICITUD]);
          if (mesSolicitud && mesSolicitud !== mesA) desviaciones++;

        } else {
          mesA = _mesDesdeValor(datosA[j][COLA.FECHA_SOLICITUD]);
          if (mesA) porFechaA++; else sinMesA++;
        }
      }

      var eA = String(datosA[j][COLA.ESTADO] || '(vacío)').trim();
      estadosA[eA] = (estadosA[eA] || 0) + 1;
    }

    log.push('');
    log.push('--- APELACIONES: ' + datosA.length + ' filas ---');
    log.push('   Mes como texto "YYYY-MM":   ' + okA);
    log.push('   Mes guardado como FECHA:    ' + comoFecha + '  (se lee de ahí, es el mes apelado)');
    log.push('   Mes desde FECHA_SOLICITUD:  ' + porFechaA + '  (último respaldo)');
    log.push('   SIN mes:                    ' + sinMesA + (sinMesA ? '   ⚠️' : '   ✅'));
    log.push('   Cobertura: ' + Math.round(((datosA.length - sinMesA) / datosA.length) * 100) + '%');

    if (comoFecha > 0) {
      log.push('');
      log.push('   Meses de las filas guardadas como fecha:');
      Object.keys(mesesDesdeDate).sort().forEach(function(k) {
        log.push('      ' + mesesDesdeDate[k] + '  ' + k);
      });
      log.push('   ⚠️ De esas, ' + desviaciones + ' se habrían atribuido al MES EQUIVOCADO');
      log.push('      si se hubiera usado la fecha de solicitud como respaldo.');
    }
    log.push('');
    log.push('   Estados presentes:');
    Object.keys(estadosA).sort().forEach(function(k) { log.push('      ' + estadosA[k] + '  "' + k + '"'); });

  } catch (e) {
    log.push('❌ Apelaciones: ' + e.toString());
  }

  Logger.log(log.join('\n'));
  return log.join('\n');
}

/**
 * Comprueba que las tres fuentes se puedan leer y que el cruce por mes funcione.
 *
 * Ejecutar desde el editor. No recibe RUT por parámetro, por la misma razón que
 * _diagnosticarAsistenciaBrigada(): una función de diagnóstico con RUT libre
 * sería una forma de consultar datos ajenos. Para probar un RUT puntual, crear
 * la propiedad RUT_DIAGNOSTICO_ASISTENCIA, ejecutar y BORRARLA después.
 */
function _diagnosticarParticipacion() {
  _ensureConfig();
  var log = ['===== DIAGNÓSTICO DE PARTICIPACIÓN ====='];

  try {
    // --- Las dos planillas propias ---
    [['JUSTIFICACIONES', CONFIG.HOJAS.JUSTIFICACIONES],
     ['APELACIONES',     CONFIG.HOJAS.APELACIONES]].forEach(function(par) {
      try {
        var ss = getSpreadsheet(par[0]);
        var hoja = ss.getSheetByName(par[1]);
        log.push(par[0] + ': "' + ss.getName() + '" / pestaña "' + par[1] + '" ' +
                 (hoja ? '✅ ' + (hoja.getLastRow() - 1) + ' filas' : '❌ NO EXISTE'));
      } catch (e) {
        log.push(par[0] + ': ❌ ' + e.toString());
      }
    });

    // --- Cruce de un RUT concreto, sólo si se pidió explícitamente ---
    var rutDiag = PropertiesService.getScriptProperties().getProperty('RUT_DIAGNOSTICO_ASISTENCIA');

    if (!rutDiag) {
      log.push('');
      log.push('Sin RUT_DIAGNOSTICO_ASISTENCIA: no se revisa ningún socio.');
      Logger.log(log.join('\n'));
      return log.join('\n');
    }

    var rutLimpio = cleanRut(rutDiag);
    var just = _participacionLeerJustificaciones(rutLimpio);
    var apel = _participacionLeerApelaciones(rutLimpio);

    // --- ASISTENCIA ---
    // Se lee por RUT directamente, sin token: la version anterior de este
    // diagnostico omitia la asistencia por exigir una sesion real, y esa era
    // justamente la parte que fallaba. Se limpia primero la cache para no leer
    // un resultado guardado hace minutos.
    try {
      CFG_ASISTENCIA_BRIGADA.HOJAS_A_LEER.forEach(function(h) {
        CacheService.getScriptCache().remove(_claveCacheAsistencia(h, rutLimpio));
      });
    } catch (eC) {}

    var asistCrudas = [];
    try {
      asistCrudas = _leerAsistenciaBrigadaPorRut(rutLimpio) || [];
    } catch (eA) {
      log.push('ERROR leyendo asistencia: ' + eA.toString());
    }

    log.push('');
    log.push('--- ASISTENCIA (lo que devuelve el modulo de Brigada) ---');
    log.push('Registros: ' + asistCrudas.length);
    asistCrudas.forEach(function(a) {
      log.push('   fecha="' + a.fecha + '"  hora="' + a.hora + '"  via="' + a.via +
               '"  enProceso=' + a.enProceso + '  actividad="' + a.actividad + '"');
      log.push('      -> mes derivado por _mesDesdeValor(): "' + _mesDesdeValor(a.fecha) + '"');
    });
    if (!asistCrudas.length) {
      log.push('   (ninguno) Si el socio SI figura en la planilla, revisa:');
      log.push('   - que su RUT alli sea el mismo (se compara normalizado)');
      log.push('   - que el Estado_Notificacion no empiece con DUPLICADO (se omite)');
      log.push('   - que la fila este en Historico o Asistencia, no en otra pestana');
    }

    var asistMap = _participacionLeerAsistenciasPorRut(rutLimpio);
    log.push('Convertidas a registros de participacion: ' + asistMap.length);
    asistMap.forEach(function(r) { log.push('   mes=' + r.mes + '  actividad="' + r.actividad + '"'); });

    log.push('');
    log.push('RUT de prueba: justificaciones=' + just.registros.length +
             ' | apelaciones=' + apel.registros.length);

    var meses = _consolidarParticipacionPorMes(asistMap, just.registros, apel.registros);
    log.push('Meses con algun registro: ' + meses.length);

    meses.forEach(function(m) {
      log.push('   ' + m.mes + '  ' + m.resultado +
               '  (just: ' + m.justificaciones.length + ', apel: ' + m.apelaciones.length + ')');
    });

    log.push('');
    log.push('--- REGION DEL SOCIO (decide que actividades le tocan) ---');
    var u = obtenerUsuarioPorRut(rutLimpio);
    log.push('   region en BD_SLIMAPP: "' + ((u && u.region) || '(sin dato)') + '"');

  } catch (e) {
    log.push('❌ ' + e.toString());
  }

  Logger.log(log.join('\n'));
  return log.join('\n');
}

// ============================================================================
// VISTA GENERAL (consolidado de los socios activos, un mes a la vez)
// ============================================================================
//
// Responde una pregunta distinta a la del calendario individual: de todos los
// socios activos de BD_SLIMAPP, ¿cuántos participaron, cuántos justificaron y
// cuántos faltaron en un mes determinado?
//
// SON DOS CIFRAS, NO UNA, Y NO TODOS VEN LAS MISMAS:
//
//   El consolidado NACIONAL dice cómo va la organización; el de una ZONA dice
//   cómo va lo que alguien efectivamente conduce, que es sobre lo que puede
//   hacer algo. Se calculan en la MISMA pasada: las planillas ya están leídas y
//   separar por zona es contar dos veces en memoria, no leer dos veces.
//
//   ADMIN y DIRECTORIO ven el nacional y, además, cualquier zona: eligen cuál
//   desde un listado dentro de la tarjeta. Conducen la organización completa y
//   comparar zonas es justamente su trabajo.
//
//   Un DIRIGENTE ve SOLO su zona. No es una cortesía de interfaz: el nacional
//   no se le manda, y la zona pedida por parámetro se le ignora. Un panel de
//   control que compara zonas convierte una herramienta de gestión en un
//   ranking entre dirigentes, y esa no es la conversación que la organización
//   quiere tener con sus datos.
//
// POR QUE UN MES Y NO EL AÑO COMPLETO:
//
//   El denominador cambia mes a mes. Las asambleas son REGIONALES: en un mes
//   pueden haber tenido actividad seis regiones y en el siguiente diez. Sumar
//   los doce meses en una sola cifra mezclaría bases distintas y el porcentaje
//   resultante no significaría nada. Un mes es la unidad más grande que se
//   puede comparar consigo misma.
//
// EL MES LO ELIGE EL CALENDARIO, NO ESTA SECCION:
//
//   La vista no tiene su propio selector de meses. Muestra el mes que el
//   dirigente tocó en la grilla del calendario anual, para que no existan dos
//   meses distintos en pantalla al mismo tiempo — que es la forma más fácil de
//   leer una cifra y atribuirla al mes equivocado. Si ese mes no tiene
//   actividades registradas se dice así, en vez de saltar en silencio a otro:
//   mostrar agosto cuando el usuario tocó marzo es peor que no mostrar nada.
//
// QUIEN ENTRA EN LA BASE:
//
//   Solo los socios ACTIVOS cuya REGION tuvo alguna actividad ese mes. A un
//   socio de una region sin asamblea no se le puede imputar una falta, y a uno
//   sin region registrada no se sabe que le correspondia (la auditoria del
//   31-08-2026 encontro 138 asi). Ambos grupos se informan aparte, con su
//   cantidad, en vez de esconderlos dentro del total: son una limitacion de los
//   datos y quien lee el grafico debe verla.
//
//   La UNICA excepcion es la participacion probada: si el socio tiene marcaje,
//   justificacion aprobada o apelacion acogida ese mes, cuenta como participante
//   aunque su region no aparezca en el catalogo. Es la misma precedencia del
//   calendario individual — lo que el socio hizo va antes que el catalogo.
//
// POR QUE SE LEE CADA PLANILLA UNA VEZ Y NO UNA VEZ POR SOCIO:
//
//   obtenerParticipacionSocio() esta pensado para UN socio: filtra cada hoja
//   por RUT. Llamarlo 3.143 veces significaria releer las mismas hojas 3.143
//   veces y no cabria ni de lejos en los 6 minutos de Apps Script. Aca cada
//   fuente se lee ENTERA una sola vez y se indexa en memoria por RUT; despues
//   el recorrido de socios es aritmetica pura.
//
// SOLO LECTURA, igual que el resto del modulo. La planilla de Brigada, ademas,
// es intocable por regla del proyecto: aca no hay ni debe haber nunca un
// setValue, setValues, appendRow, deleteRow ni clearContent.
//
// ACCESO: roles de gestion (DIRIGENTE / DIRECTORIO / ADMIN), verificado en el
// SERVIDOR. Son cifras agregadas —sin nombres ni RUT— pero describen el
// cumplimiento del sindicato completo, y el webapp es ANYONE_ANONYMOUS: ocultar
// el boton no es un control.
// ============================================================================

var CFG_PARTICIPACION_GENERAL = {
  // Roles que pueden ver el consolidado.
  ROLES_AUTORIZADOS: ['DIRIGENTE', 'DIRECTORIO', 'ADMIN'],

  // De estos tres, los que ven el nacional y pueden elegir cualquier zona.
  ROLES_NACIONAL: ['DIRECTORIO', 'ADMIN'],

  // TTL de la caché del consolidado, en segundos. Es un dato agregado y sin
  // nombres, así que se cachea una sola vez para todos los que lo consulten.
  // 10 minutos: suficiente para que varios dirigentes lo miren seguido sin
  // recalcular, y lo bastante corto para que un cambio de estado hecho a mano
  // en una planilla se refleje el mismo día.
  CACHE_SEGUNDOS: 600,
  // El prefijo lleva version: el bloque cacheado cambio de forma al sumarle
  // las etiquetas de zona, y uno viejo se leeria sin ellas.
  CACHE_PREFIJO: 'part_gen_v2_',

  // Estados posibles de un socio en el mes, en el orden en que se muestran.
  // Estos seis forman la BASE del gráfico; SIN_ACTIVIDAD y SIN_REGION quedan
  // deliberadamente fuera (ver el encabezado del bloque).
  ORDEN: ['ASISTIO', 'JUSTIFICADO', 'APELACION_ACOGIDA', 'EN_REVISION', 'EN_PLAZO', 'FALTA']
};

/**
 * Consolidado de participación para UN mes.
 *
 * Qué devuelve depende del rol, y la decisión se toma acá, en el servidor:
 *   ADMIN / DIRECTORIO -> el nacional MAS cualquier zona, elegida de un listado.
 *   DIRIGENTE          -> solo su propia zona.
 *
 * @param {string} sessionToken Token de sesión. El RUT nunca llega del cliente.
 * @param {string} mes          Mes "YYYY-MM" tocado en el calendario anual.
 *                              Vacío = el más reciente con actividades.
 * @param {string} region       Zona pedida desde el listado. Solo la respetan
 *                              ADMIN y DIRECTORIO; a un DIRIGENTE se le ignora.
 */
function obtenerParticipacionGeneral(sessionToken, mes, region) {
  _ensureConfig();

  try {
    var rutSesion = obtenerRutDeSesion(sessionToken);
    if (!rutSesion) {
      return _respuestaGeneralVacia(true, false, 'Tu sesión expiró. Vuelve a ingresar.');
    }

    // El rol se verifica SIEMPRE en el servidor: google.script.run se invoca a
    // mano desde la consola del navegador, así que esconder la sección en la
    // interfaz no impide nada — y acá el rol no solo decide si se responde,
    // decide QUE se responde.
    var permiso = verificarRolUsuario(rutSesion, CFG_PARTICIPACION_GENERAL.ROLES_AUTORIZADOS);
    if (!permiso || !permiso.autorizado) {
      return _respuestaGeneralVacia(false, false, 'No tienes acceso a esta información.');
    }

    var rol = String(permiso.rol || '').trim().toUpperCase();
    var mando = (CFG_PARTICIPACION_GENERAL.ROLES_NACIONAL.indexOf(rol) !== -1);

    // --- De qué zona es quien consulta ---
    // Mismo criterio que el calendario individual: "S/D" y sus variantes NO son
    // una región, son la ausencia del dato. Tratarlas como región real haría
    // buscar socios de una zona inexistente y el gráfico saldría en cero, sin
    // explicación.
    var usuario = obtenerUsuarioPorRut(rutSesion);
    var regionPropia = (usuario && usuario.encontrado) ? String(usuario.region || '').trim() : '';
    var normPropia = _normalizarRegionParaComparar(regionPropia);
    if (CENTINELAS_SIN_REGION.indexOf(normPropia) !== -1) {
      regionPropia = '';
      normPropia = '';
    }

    var TZ = CFG_PARTICIPACION.ZONA_HORARIA;
    var ahora = new Date();
    var mesActual = Utilities.formatDate(ahora, TZ, 'yyyy-MM');

    // --- Qué meses se pueden consolidar ---
    // Salen del catálogo: un mes sin actividades registradas no tiene nada que
    // consolidar. Se acotan al corte de datos evaluables y al mes en curso.
    var catalogoTodo = obtenerCatalogoActividades('');
    var todasActividades = (catalogoTodo && catalogoTodo.actividades) ? catalogoTodo.actividades : [];

    var mesesDisponibles = _participacionGeneralMesesDisponibles(todasActividades, mesActual);
    if (mesesDisponibles.length === 0) {
      return _respuestaGeneralVacia(false, true,
        'Todavía no hay meses con actividades registradas para consolidar.');
    }

    // El mes pedido es el que se tocó en el calendario. Si no se puede
    // consolidar se dice; NO se sustituye por otro. Solo cuando no llega ninguno
    // (primera carga) se toma el más reciente.
    var mesPedido = _normalizarMes(mes) || String(mes || '').trim();
    if (!mesPedido) {
      mesPedido = mesesDisponibles[0];
    } else if (mesesDisponibles.indexOf(mesPedido) === -1) {
      var vacia = _respuestaGeneralVacia(false, true,
        'En ' + _mesLegible(mesPedido) + ' no hay actividades registradas para consolidar.');
      vacia.meses = mesesDisponibles;
      vacia.puedeVerNacional = mando;
      vacia.region = regionPropia;
      vacia.sinRegion = !normPropia;
      return vacia;
    }

    // --- Caché ---
    // Se guarda el reparto de TODAS las zonas, no el de una: el cálculo pesado
    // es leer las planillas, y hecho una vez sirve para cualquiera que pregunte
    // por ese mes, sea cual sea su rol o la zona que elija. El recorte por rol
    // se hace después, al responder.
    var claveCache = CFG_PARTICIPACION_GENERAL.CACHE_PREFIJO + mesPedido;
    var calculo = null;
    try {
      var enCache = CacheService.getScriptCache().get(claveCache);
      if (enCache) calculo = JSON.parse(enCache);
    } catch (eC) {
      Logger.log('Participación general: caché ilegible, se recalcula — ' + eC.toString());
    }

    if (!calculo) {
      calculo = _calcularParticipacionGeneral(mesPedido, todasActividades, ahora);
      try {
        CacheService.getScriptCache().put(claveCache, JSON.stringify(calculo),
                                          CFG_PARTICIPACION_GENERAL.CACHE_SEGUNDOS);
      } catch (eP) {}
    }

    // --- Qué zona se muestra ---
    // Un DIRIGENTE ve la suya y nada más: el parámetro no se mira siquiera.
    // Filtrarlo acá y no en la interfaz es el punto — el parámetro viaja por
    // una llamada que cualquiera puede repetir a mano.
    var normElegida = normPropia;
    if (mando) {
      var pedida = _normalizarRegionParaComparar(region);
      if (CENTINELAS_SIN_REGION.indexOf(pedida) !== -1) pedida = '';
      // Si la zona pedida no existe se cae a la propia, y si tampoco tiene, a la
      // primera del listado: un panel de control que abre vacío no sirve de nada.
      if (pedida && calculo.regiones[pedida]) normElegida = pedida;
      else if (!normElegida || !calculo.regiones[normElegida]) normElegida = _primeraZonaDelListado(calculo);
    }

    // El listado de zonas solo viaja a quien puede elegir. Para un DIRIGENTE
    // sería una lista de zonas que no puede abrir.
    var listado = mando ? _listadoZonas(calculo) : [];

    return {
      success: true,
      sesionExpirada: false,
      mes: calculo.mes,
      mesLegible: calculo.mesLegible,
      meses: mesesDisponibles,
      rol: rol,
      puedeVerNacional: mando,
      // El nacional es de ADMIN y DIRECTORIO. A un DIRIGENTE no se le manda:
      // esconderlo en la interfaz dejaría la cifra igual de disponible.
      nacional: mando ? calculo.nacional : null,
      regional: normElegida ? (calculo.regiones[normElegida] || _bloqueVacioRegion()) : null,
      region: normElegida ? _etiquetaZona(calculo, normElegida, regionPropia) : regionPropia,
      regionClave: normElegida,
      regiones: listado,
      // Sin zona registrada no hay consolidado que mostrarle a un dirigente, y
      // decirlo es parte de la respuesta: debe saber por qué falta.
      sinRegion: !normElegida,
      catalogoOk: !!(catalogoTodo && catalogoTodo.success),
      fuentes: calculo.fuentes,
      message: ''
    };

  } catch (e) {
    Logger.log('obtenerParticipacionGeneral: ' + e.toString());
    return _respuestaGeneralVacia(false, false, 'No se pudo calcular el consolidado en este momento.');
  }
}

/**
 * Prefijo geográfico de una zona. Las etiquetas vienen numeradas de norte a sur
 * ("01. XV. Region de Arica y Parinacota - Arica", "16. XII Region de
 * Magallanes..."), y ese número NO es el romano: las regiones de Chile no están
 * numeradas de norte a sur, así que Arica es la 01 pero la XV, y Tarapacá la 02
 * pero la I. El prefijo es lo único que da el orden físico del mapa.
 *
 * Una zona sin prefijo —una región escrita a mano en la base— se va al final en
 * vez de colarse arriba: no se puede adivinar dónde va.
 */
function _ordenGeograficoZona(etiqueta) {
  var m = /^\s*(\d{1,2})\b/.exec(etiqueta || '');
  return m ? parseInt(m[1], 10) : 999;
}

/**
 * Listado de zonas para el panel de selección, ordenado de norte a sur por el
 * prefijo de la etiqueta. Se ordenaba por cantidad de socios, pero el panel se
 * lee como un mapa: buscar una zona en una lista cuyo orden no se puede
 * anticipar obliga a recorrerla entera cada vez. La cantidad de socios sigue
 * a la vista en cada fila, que es donde se necesita.
 *
 * El prefijo va con cero a la izquierda, así que el orden es estable aunque la
 * etiqueta falte: la clave normalizada también lo conserva
 * ("11VIIIREGIONDELBIOBIOHORCONES").
 *
 * Las tres sedes de Biobío comparten el 11 y se desempatan alfabéticamente.
 *
 * Viaja completo, con el bloque de cada zona adentro: son cifras chicas y así
 * cambiar de zona en el panel es instantáneo, sin una consulta por clic. Quien
 * recibe este listado ya puede consultar cualquier zona de todos modos.
 */
function _listadoZonas(calculo) {
  var etiquetas = calculo.etiquetas || {};
  return Object.keys(calculo.regiones || {}).map(function(clave) {
    return {
      clave: clave,
      etiqueta: etiquetas[clave] || clave,
      bloque: calculo.regiones[clave]
    };
  }).sort(function(a, b) {
    var d = _ordenGeograficoZona(a.etiqueta) - _ordenGeograficoZona(b.etiqueta);
    return d !== 0 ? d : a.etiqueta.localeCompare(b.etiqueta, 'es');
  });
}

/**
 * Zona con más socios activos. Es el último recurso para abrir el panel: la
 * zona inicial es SIEMPRE la propia de quien consulta (ver normElegida), y esto
 * solo actúa cuando no tiene región registrada o la suya no tuvo actividad ese
 * mes.
 *
 * Se calcula aparte y ya no como el primero de _listadoZonas(): desde que ese
 * listado se ordena de norte a sur, tomar su primer elemento abriría el panel
 * en Arica —una de las zonas más chicas— en vez de en la más representativa.
 */
function _primeraZonaDelListado(calculo) {
  var regiones = calculo.regiones || {};
  var mejor = '', max = -1;
  Object.keys(regiones).forEach(function(clave) {
    var n = (regiones[clave] || {}).totalActivos || 0;
    // El desempate por clave mantiene la elección estable entre ejecuciones:
    // Object.keys no garantiza un orden en el que apoyarse.
    if (n > max || (n === max && clave < mejor)) { max = n; mejor = clave; }
  });
  return mejor;
}

/**
 * Nombre presentable de una zona. La clave normalizada ("VIIIREGIONDELBIOBIO")
 * sirve para comparar, nunca para mostrar; el respaldo es cómo la escribe la
 * ficha de quien consulta.
 */
function _etiquetaZona(calculo, clave, respaldo) {
  var etiquetas = calculo.etiquetas || {};
  return etiquetas[clave] || respaldo || clave;
}

/** Respuesta vacía con la misma forma que la exitosa, para que la vista no adivine. */
function _respuestaGeneralVacia(sesionExpirada, exito, mensaje) {
  return {
    success: !!exito,
    sesionExpirada: !!sesionExpirada,
    mes: '',
    mesLegible: '',
    meses: [],
    rol: '',
    puedeVerNacional: false,
    nacional: null,
    regional: null,
    region: '',
    regionClave: '',
    regiones: [],
    sinRegion: false,
    fuentes: {},
    message: mensaje || ''
  };
}

/**
 * Bloque de una región que existe pero no aportó ningún socio a este mes.
 * Se devuelve vacío en vez de null para que la vista no tenga que distinguir
 * "no tienes región" de "tu región no tuvo nada": son cosas distintas y cada
 * una se explica por su lado.
 */
function _bloqueVacioRegion() {
  return {
    conteos: { ASISTIO: 0, JUSTIFICADO: 0, APELACION_ACOGIDA: 0,
               EN_REVISION: 0, EN_PLAZO: 0, FALTA: 0 },
    participaron: 0,
    base: 0,
    totalActivos: 0,
    fueraDeBase: { SIN_ACTIVIDAD: 0, SIN_REGION: 0, NO_AFILIADO: 0 },
    actividades: 0
  };
}

/**
 * Meses consolidables, del más reciente al más antiguo.
 *
 * Un mes entra si tiene al menos una actividad en el catálogo, es posterior al
 * corte de datos evaluables y ya empezó. Los meses anteriores al corte se
 * excluyen por la misma razón que en el calendario individual: antes de esa
 * fecha la asistencia no se registraba, así que todos aparecerían en falta por
 * un dato que el sistema nunca guardó.
 */
function _participacionGeneralMesesDisponibles(actividades, mesActual) {
  var corte = CFG_PARTICIPACION.INICIO_DATOS_EVALUABLES;
  var vistos = {};

  for (var i = 0; i < actividades.length; i++) {
    var m = actividades[i].mes;
    if (!m) continue;
    // Un mes anterior al corte entra al selector si su propia zona tiene carga
    // histórica: es la misma regla del calendario individual, aplicada acá a la
    // zona de la actividad en vez de a la del socio.
    if (corte && m < corte &&
        !_mesEvaluableConHistorico(m, _normalizarRegionParaComparar(actividades[i].region))) continue;
    if (m > mesActual) continue;   // meses que aún no ocurren
    vistos[m] = true;
  }

  return Object.keys(vistos).sort(function(a, b) { return a < b ? 1 : (a > b ? -1 : 0); });
}

/**
 * El cálculo propiamente tal: el reparto nacional y el de cada región, en una
 * sola pasada. Separado del endpoint para que la autorización, la caché y la
 * aritmética no se estorben entre sí.
 *
 * Se calculan TODAS las regiones aunque quien pregunte sea de una sola: el
 * costo está en leer las planillas, no en sumar, y así el resultado cacheado
 * sirve para cualquier dirigente que consulte el mismo mes.
 */
/**
 * Resultado de participación de CADA socio activo en un mes.
 *
 * Se separó de `_calcularParticipacionGeneral` cuando SLIM Quest necesitó los
 * mismos datos para otorgar logros y XP por participación. La alternativa era
 * que gamificación reimplementara la precedencia, y dos copias de esta regla
 * terminan divergiendo: el panel del dirigente diría que un socio cumplió y el
 * juego que no. Acá vive la única implementación; el consolidado por zona ahora
 * solo agrega lo que esta función resuelve.
 *
 * Devuelve, además del mapa RUT → resultado, el contexto que el agregador
 * necesita (socios, actividades por región, etiquetas y estado de las fuentes).
 */
/**
 * LA REGLA DE PRECEDENCIA. Dado lo que se sabe de un socio en un mes, decide
 * cuál es su resultado.
 *
 * Vive sola porque la consumen tres lugares —el consolidado por zona, SLIM Quest
 * y el informe de faltas— y dos copias de esto derivan: el panel del dirigente
 * diría que un socio cumplió y el informe que no. El calendario individual sigue
 * su propio camino por razones históricas, pero aplica el mismo orden.
 *
 * ⚠️ LO QUE EL SOCIO HIZO VA PRIMERO, ANTES QUE EL CATÁLOGO. Su asistencia, su
 *    justificación aprobada o su apelación acogida son hechos suyos y no
 *    dependen de que la actividad esté registrada en el calendario.
 *
 * @param {{asistio, just, apel, region, hayActividad, mes}} ctx
 * @return {string} ASISTIO | JUSTIFICADO | APELACION_ACOGIDA | EN_REVISION |
 *                  SIN_REGION | SIN_ACTIVIDAD | EN_PLAZO | FALTA
 */
function _resolverResultadoParticipacion(ctx) {
  if (ctx.asistio) return 'ASISTIO';
  if (ctx.just && ctx.just.aprobada) return 'JUSTIFICADO';
  if (ctx.apel && ctx.apel.aprobada) return 'APELACION_ACOGIDA';
  if ((ctx.just && ctx.just.enRevision) || (ctx.apel && ctx.apel.enRevision)) return 'EN_REVISION';

  // Todavia no era socio. Va DESPUES de la participacion y no antes: si hay
  // registro de que participo, ese hecho manda sobre la fecha de la ficha, que
  // se carga a mano y puede estar mal. Pero sin participacion, un mes anterior
  // a su afiliacion no es una falta suya: no habia nada que cumplir.
  if (ctx.mesIngreso && ctx.mes < ctx.mesIngreso) return 'NO_AFILIADO';

  // Sin región no se sabe qué actividad le correspondía, así que no se le puede
  // imputar una falta. Queda fuera de la base, contado aparte.
  if (!ctx.region) return 'SIN_REGION';

  if (!ctx.hayActividad) return 'SIN_ACTIVIDAD';

  // Mes anterior al corte y esta zona todavía sin carga histórica: hubo
  // asamblea, pero de la asistencia no quedó registro en ninguna base. Fuera de
  // la base del gráfico, nunca FALTA — eso sería imputarle una ausencia a quien
  // pudo haber ido.
  if (!_mesEvaluableConHistorico(ctx.mes, ctx.region)) return 'SIN_ACTIVIDAD';

  // Su región todavía tiene actividades por realizarse, o el plazo para
  // justificar sigue vigente: aún no es una falta.
  if (ctx.plazoAbierto) return 'EN_PLAZO';

  return 'FALTA';
}

function _participacionResultadosDelMes(mesElegido, todasActividades, ahora) {
  // --- Actividades del mes, agrupadas por región ---
  // La región es la llave: a un socio solo le corresponden las asambleas de la
  // suya. Se normaliza igual que en el calendario individual, porque la misma
  // región se escribe distinta según quién haya cargado la fila.
  var actividadesPorRegion = {};
  var totalActividadesMes = 0;

  for (var i = 0; i < todasActividades.length; i++) {
    var a = todasActividades[i];
    if (a.mes !== mesElegido) continue;
    var reg = _normalizarRegionParaComparar(a.region);
    if (!reg) continue;
    if (!actividadesPorRegion[reg]) actividadesPorRegion[reg] = [];
    actividadesPorRegion[reg].push(a);
    totalActividadesMes++;
  }

  // ¿Sigue abierto el plazo en cada región? Se resuelve UNA vez por región y no
  // una vez por socio: son las mismas actividades para todos los de la región.
  var plazoPorRegion = {};
  Object.keys(actividadesPorRegion).forEach(function(reg) {
    plazoPorRegion[reg] = _plazoAbiertoDelMes(actividadesPorRegion[reg], ahora).abierto;
  });

  // --- Las tres fuentes, cada una leída ENTERA una sola vez ---
  var socios          = _participacionGeneralSociosActivos();
  var asistencias     = _participacionGeneralAsistencias(mesElegido);
  var justificaciones = _participacionGeneralTramites('JUSTIFICACIONES', mesElegido);
  var apelaciones     = _participacionGeneralTramites('APELACIONES', mesElegido);

  // Nombres presentables de cada zona. Salen de la ficha de los socios, y el
  // catalogo completa las que tienen asamblea pero ningun socio asignado —
  // sin eso, esa zona aparaceria en el listado con su clave normalizada.
  var etiquetas = {};
  Object.keys(actividadesPorRegion).forEach(function(reg) {
    var a = actividadesPorRegion[reg][0];
    // La region CRUDA, no 'regionCorta': el catalogo separa la sede del nombre
    // ('VIII Region del Biobio' + 'Horcones') y BD_SLIMAPP la trae junta
    // ('11. VIII Region del Biobio - Horcones.'). Usar la corta hacia que una
    // zona sin socios apareciera en el listado con otra forma que las demas —y
    // sin su sede, que es justo lo que distingue a Horcones de Concepcion.
    if (a) etiquetas[reg] = a.region || a.regionCorta || reg;
  });
  // La ficha del socio manda sobre el catalogo: es como la organizacion nombra
  // la zona de su gente, y es lo que el dirigente reconoce.
  Object.keys(socios.etiquetas || {}).forEach(function(reg) {
    etiquetas[reg] = socios.etiquetas[reg];
  });

  var resultados = {};

  for (var s = 0; s < socios.lista.length; s++) {
    var socio = socios.lista[s];
    var clave = socio.rut + '|' + mesElegido;

    var resultado = _resolverResultadoParticipacion({
      asistio:      !!asistencias.mapa[clave],
      just:         justificaciones.mapa[clave],
      apel:         apelaciones.mapa[clave],
      region:       socio.region,
      hayActividad: !!actividadesPorRegion[socio.region],
      plazoAbierto: !!plazoPorRegion[socio.region],
      mesIngreso:   socio.mesIngreso,
      mes:          mesElegido
    });

    resultados[socio.rut] = resultado;
  }

  return {
    mes: mesElegido,
    resultados: resultados,
    socios: socios.lista,
    actividadesPorRegion: actividadesPorRegion,
    totalActividadesMes: totalActividadesMes,
    etiquetas: etiquetas,
    // Si una fuente falló, quien lee el gráfico DEBE saberlo: una justificación
    // que no se pudo leer se ve idéntica a una que no existe, y acá eso se
    // traduce en faltas que no son faltas.
    //
    // Para SLIM Quest la consecuencia es más grave todavía: otorgaría XP y
    // logros sobre datos incompletos, y el XP ya entregado no se quita. Por eso
    // el trabajo por lotes se detiene cuando alguna fuente viene con `ok:false`.
    fuentes: {
      socios:          { ok: socios.ok,          mensaje: socios.mensaje },
      asistencia:      { ok: asistencias.ok,     mensaje: asistencias.mensaje },
      justificaciones: { ok: justificaciones.ok, mensaje: justificaciones.mensaje },
      apelaciones:     { ok: apelaciones.ok,     mensaje: apelaciones.mensaje }
    }
  };
}

/**
 * Consolidado por zona de un mes. Agrega lo que `_participacionResultadosDelMes`
 * resolvió socio por socio; la precedencia de estados no vive aquí.
 */
function _calcularParticipacionGeneral(mesElegido, todasActividades, ahora) {
  var datos = _participacionResultadosDelMes(mesElegido, todasActividades, ahora);

  var nacional = _bloqueVacioRegion();
  var regiones = {};

  function bloqueDeRegion(reg) {
    if (!regiones[reg]) {
      regiones[reg] = _bloqueVacioRegion();
      regiones[reg].actividades = (datos.actividadesPorRegion[reg] || []).length;
    }
    return regiones[reg];
  }

  for (var s = 0; s < datos.socios.length; s++) {
    var socio = datos.socios[s];
    var resultado = datos.resultados[socio.rut];
    // El mismo socio se anota dos veces: en el total nacional y en el bloque de
    // su región. Un socio sin región solo puede sumar al nacional — no hay
    // bloque regional al que pertenezca.
    _anotarEnBloque(nacional, resultado);
    if (socio.region) _anotarEnBloque(bloqueDeRegion(socio.region), resultado);
  }

  nacional.actividades = datos.totalActividadesMes;
  nacional.regionesConActividad = Object.keys(datos.actividadesPorRegion).length;

  // Una región puede tener asamblea y ningún socio activo asignado. Si no se
  // crea igual su bloque, su dirigente vería "tu región no tuvo actividades",
  // que es falso: sí la tuvo, lo que falta son socios con esa región cargada.
  Object.keys(datos.actividadesPorRegion).forEach(function(reg) { bloqueDeRegion(reg); });

  return {
    mes: mesElegido,
    mesLegible: _mesLegible(mesElegido),
    nacional: nacional,
    regiones: regiones,
    etiquetas: datos.etiquetas,
    fuentes: datos.fuentes
  };
}

/**
 * Suma un socio al bloque que corresponda, manteniendo coherentes la base, el
 * total y la participación efectiva.
 *
 * "En revisión" NO cuenta como participación: todavía no está resuelto, y
 * contarlo a favor inflaría la cifra con trámites que pueden terminar
 * rechazados. Sí forma parte de la base, porque a ese socio le correspondía la
 * actividad.
 */
function _anotarEnBloque(bloque, resultado) {
  bloque.totalActivos++;

  // NO_AFILIADO es tan neutro como los otros dos: el socio no estaba, asi que
  // no puede sumar ni restar en el reparto de su zona.
  if (resultado === 'SIN_REGION' || resultado === 'SIN_ACTIVIDAD' ||
      resultado === 'NO_AFILIADO') {
    bloque.fueraDeBase[resultado]++;
    return;
  }

  bloque.conteos[resultado]++;
  bloque.base++;

  if (resultado === 'ASISTIO' || resultado === 'JUSTIFICADO' || resultado === 'APELACION_ACOGIDA') {
    bloque.participaron++;
  }
}

/**
 * Socios ACTIVOS de BD_SLIMAPP, con su región ya normalizada para comparar.
 *
 * "S/D" y sus variantes se tratan como sin región (CENTINELAS_SIN_REGION), no
 * como una región real: buscar asambleas de una región inexistente convertiría
 * a esos socios en faltas silenciosas.
 */
/**
 * Convierte el parámetro de mes de las tres lecturas en un conjunto.
 *
 * Nació cuando el informe de faltas necesitó 24 meses: pedirlos de a uno
 * significaba leer las cuatro planillas 24 veces, y eso no cabe en los 6
 * minutos de Apps Script. Como los mapas ya se indexan por "RUT|mes", aceptar
 * varios meses no cambia su forma — sólo se ensancha el filtro.
 *
 * @param {string|Array<string>} mesElegido Un mes, o varios.
 * @return {{tiene: function(string): boolean}}
 */
/**
 * Mes de afiliacion de un socio, como "yyyy-MM".
 *
 * A un socio NO se le puede imputar una falta de un mes en que todavia no era
 * socio. La columna FECHA_INGRESO de BD_SLIMAPP es la unica fuente de eso, y
 * suele venir como texto en formato chileno: se parsea con el parser central
 * del proyecto y nunca con new Date(string), que interpreta DD/MM como MM/DD.
 *
 * Devuelve '' si la celda esta vacia o no se entiende. Ese caso se trata como
 * "sin restriccion" a proposito: preferimos evaluarle los meses a un socio con
 * la fecha mal cargada -donde el error se ve y se corrige- antes que dejar de
 * evaluar a media base por una columna incompleta.
 */
function _mesDeAfiliacion(valor) {
  if (!valor) return '';
  var f = parsearFechaFlexible(valor);
  if (!f) return '';
  return Utilities.formatDate(f, CFG_PARTICIPACION.ZONA_HORARIA, 'yyyy-MM');
}

function _filtroDeMeses(mesElegido) {
  if (Object.prototype.toString.call(mesElegido) === '[object Array]') {
    var set = {};
    for (var i = 0; i < mesElegido.length; i++) set['m_' + mesElegido[i]] = true;
    return { tiene: function(m) { return set['m_' + m] === true; } };
  }
  return { tiene: function(m) { return m === mesElegido; } };
}

function _participacionGeneralSociosActivos() {
  try {
    var hoja = getSheet('USUARIOS', 'USUARIOS');
    var lastRow = hoja.getLastRow();
    if (lastRow < 2) return { ok: true, lista: [], etiquetas: {}, mensaje: '' };

    var COL = CONFIG.COLUMNAS.USUARIOS;
    var datos = hoja.getRange(2, 1, lastRow - 1, hoja.getLastColumn()).getValues();
    var lista = [];
    // Como se escribe cada zona, para poder MOSTRARLA. La clave normalizada
    // ("VIIIREGIONDELBIOBIO") sirve para comparar y es ilegible en pantalla.
    // Se guarda la primera forma que aparece: la planilla la escriben personas
    // y las variantes de una misma zona son de puntuacion, no de contenido.
    var etiquetas = {};

    for (var i = 0; i < datos.length; i++) {
      var estado = String(datos[i][COL.ESTADO] || '').trim().toUpperCase();
      // Mismo criterio que Modulo gamificacion.js: la columna la llenan personas
      // y aparecen las tres variantes.
      if (estado !== 'ACTIVO' && estado !== 'SI' && estado !== 'TRUE') continue;

      var rut = cleanRut(datos[i][COL.RUT]);
      if (!rut) continue;

      var regionCruda = String(datos[i][COL.REGION] || '').trim();
      var region = _normalizarRegionParaComparar(regionCruda);
      if (CENTINELAS_SIN_REGION.indexOf(region) !== -1) region = '';

      if (region && regionCruda && !etiquetas[region]) etiquetas[region] = regionCruda;

      lista.push({ rut: rut, region: region,
                   mesIngreso: _mesDeAfiliacion(datos[i][COL.FECHA_INGRESO]) });
    }

    return { ok: true, lista: lista, etiquetas: etiquetas, mensaje: '' };

  } catch (e) {
    Logger.log('Participación general: falló la lectura de socios — ' + e.toString());
    return { ok: false, lista: [], etiquetas: {}, mensaje: 'No se pudo leer la base de socios.' };
  }
}

/**
 * Marcajes del mes, indexados por "RUT|mes". SÓLO LECTURA de la planilla de
 * Brigada (regla del proyecto: de ahí no se escribe nunca).
 *
 * Lee las dos pestañas enteras en vez de filtrar por RUT, porque acá interesan
 * todos los socios. Reutiliza el contrato de encabezados de
 * Modulo asistenciaBrigada.js en lugar de copiarlo: si allá cambia el orden de
 * las columnas, esto se entera por el mismo camino.
 *
 * No usa la caché por RUT de ese módulo: son bloques distintos (uno por socio y
 * pestaña) y recorrerlos sería peor que leer la planilla una vez.
 */
function _participacionGeneralAsistencias(mesElegido) {
  var mapa = {};
  // `mesElegido` puede ser un mes o varios: ver _filtroDeMeses().
  var filtro = _filtroDeMeses(mesElegido);

  try {
    var idPlanilla = CONFIG.SPREADSHEETS.ASISTENCIA_BRIGADA;
    if (!idPlanilla) {
      return { ok: false, mapa: mapa, mensaje: 'Falta configurar la planilla de asistencia.' };
    }

    var CFG = CFG_ASISTENCIA_BRIGADA;
    var COL = CFG.COL;
    var ss = SpreadsheetApp.openById(idPlanilla);
    var hojasLeidas = 0;

    for (var h = 0; h < CFG.HOJAS_A_LEER.length; h++) {
      var nombreHoja = CFG.HOJAS_A_LEER[h];
      try {
        var hoja = ss.getSheetByName(nombreHoja);
        // Una pestaña inexistente no es un error: "Historico" puede no haberse
        // creado todavía, y "Asistencia" queda vacía tras cada archivado.
        if (!hoja) { hojasLeidas++; continue; }

        var ultimaFila = hoja.getLastRow();
        if (ultimaFila <= CFG.FILA_ENCABEZADO) { hojasLeidas++; continue; }

        var encabezados = hoja.getRange(CFG.FILA_ENCABEZADO, 1, 1, CFG.TOTAL_COLUMNAS).getValues()[0];
        var verificacion = _verificarEncabezados(encabezados);
        if (!verificacion.ok) {
          // No se adivina el nuevo orden de las columnas: eso convertiría un
          // fallo visible en uno silencioso, que es lo contrario de lo que se
          // busca acá.
          throw new Error('Encabezados inesperados en "' + nombreHoja + '". ' + verificacion.detalle);
        }

        var datos = hoja.getRange(CFG.FILA_ENCABEZADO + 1, 1,
                                  ultimaFila - CFG.FILA_ENCABEZADO, CFG.TOTAL_COLUMNAS).getValues();

        for (var i = 0; i < datos.length; i++) {
          var fila = datos[i];

          // Un DUPLICADO es la misma persona marcando dos veces la misma
          // actividad. Para este conteo daría igual (el mapa es por RUT y mes,
          // no acumula), pero se descarta igual para no depender de eso.
          var estadoNotif = String(fila[COL.ESTADO_NOTIFICACION] || '').trim().toUpperCase();
          if (estadoNotif.indexOf('DUPLICADO') === 0) continue;

          var fecha = parsearFechaFlexible(fila[COL.HORA_MARCAJE]) ||
                      parsearFechaFlexible(fila[COL.FECHA]);
          if (!fecha) continue;

          var mesFila = Utilities.formatDate(fecha, CFG.ZONA_HORARIA, 'yyyy-MM');
          if (!filtro.tiene(mesFila)) continue;

          var rut = cleanRut(fila[COL.RUT_AFILIADO]);
          if (!rut) continue;

          mapa[rut + '|' + mesFila] = true;
        }

        hojasLeidas++;

      } catch (eHoja) {
        // Una pestaña rota no puede dejar sin datos a la otra.
        Logger.log('Participación general: falló la pestaña "' + nombreHoja + '" — ' + eHoja.toString());
      }
    }

    if (hojasLeidas === 0) {
      return { ok: false, mapa: mapa, mensaje: 'No se pudo leer la asistencia.' };
    }

    // --- Asistencia anterior al sistema actual ---
    // Se suma al mismo mapa: para el consolidado, "asistió" es "asistió", venga
    // del marcaje de Brigada o de la carga histórica. Si esa lectura falla, la
    // fuente entera se declara `ok:false` aunque Brigada haya respondido bien —
    // en un mes histórico, no leerla equivale a no tener asistencia, y eso se
    // traduciría en faltas masivas que no son faltas.
    var historicos = _asistenciaHistoricaDelMes(mesElegido);
    Object.keys(historicos.mapa).forEach(function(clave) { mapa[clave] = true; });
    if (!historicos.ok) {
      return { ok: false, mapa: mapa, mensaje: historicos.mensaje };
    }

    return { ok: true, mapa: mapa, mensaje: '' };

  } catch (e) {
    Logger.log('Participación general: falló la lectura de asistencia — ' + e.toString());
    return { ok: false, mapa: mapa, mensaje: 'La asistencia no está disponible en este momento.' };
  }
}

/**
 * Justificaciones o apelaciones del mes, indexadas por "RUT|mes".
 *
 * Las dos hojas se resuelven con el mismo código porque la pregunta es la
 * misma: para este socio y este mes, ¿hay un trámite aprobado, o al menos uno
 * en revisión? Cambian los nombres de las columnas y la forma de deducir el
 * mes, y eso es todo lo que se parametriza.
 *
 * @param {string} claveFuente 'JUSTIFICACIONES' o 'APELACIONES'
 */
function _participacionGeneralTramites(claveFuente, mesElegido) {
  var mapa = {};
  var esJustificacion = (claveFuente === 'JUSTIFICACIONES');
  var etiqueta = esJustificacion ? 'justificaciones' : 'apelaciones';
  var filtro = _filtroDeMeses(mesElegido);

  try {
    var ss = getSpreadsheet(claveFuente);
    var hoja = ss.getSheetByName(CONFIG.HOJAS[claveFuente]);
    if (!hoja) {
      return { ok: false, mapa: mapa, mensaje: 'No se encontró la hoja de ' + etiqueta + '.' };
    }

    var lastRow = hoja.getLastRow();
    if (lastRow < 2) return { ok: true, mapa: mapa, mensaje: '' };

    var COL = CONFIG.COLUMNAS[claveFuente];
    var datos = hoja.getRange(2, 1, lastRow - 1, hoja.getLastColumn()).getValues();

    var aprobados = esJustificacion
      ? CFG_PARTICIPACION.ESTADOS_JUSTIFICACION_APROBADA
      : CFG_PARTICIPACION.ESTADOS_APELACION_APROBADA;

    for (var i = 0; i < datos.length; i++) {
      var fila = datos[i];

      var mesFila;
      if (esJustificacion) {
        // El mes sale del código de asamblea; la fecha de solicitud es el
        // respaldo (se justifica dentro del mismo mes).
        mesFila = _mesDesdeCodigoAsamblea(fila[COL.ASAMBLEA]) || _mesDesdeValor(fila[COL.FECHA]);
      } else {
        // MES_APELACION puede venir como texto "YYYY-MM" o convertido a Date por
        // Sheets. El orden importa: caer directo a FECHA_SOLICITUD atribuiría la
        // apelación al mes en que se presentó y no al mes reclamado.
        var crudoMes = fila[COL.MES_APELACION];
        mesFila = _normalizarMes(crudoMes) || _mesDesdeValor(crudoMes) ||
                  _mesDesdeValor(fila[COL.FECHA_SOLICITUD]);
      }
      if (!filtro.tiene(mesFila)) continue;

      var rut = cleanRut(fila[COL.RUT]);
      if (!rut) continue;

      var estado = String(fila[COL.ESTADO] || '').trim().toLowerCase();
      var clave = rut + '|' + mesFila;
      if (!mapa[clave]) mapa[clave] = { aprobada: false, enRevision: false };

      if (aprobados.indexOf(estado) !== -1) mapa[clave].aprobada = true;
      else if (CFG_PARTICIPACION.ESTADOS_EN_REVISION.indexOf(estado) !== -1) mapa[clave].enRevision = true;
    }

    return { ok: true, mapa: mapa, mensaje: '' };

  } catch (e) {
    Logger.log('Participación general: falló la lectura de ' + etiqueta + ' — ' + e.toString());
    return { ok: false, mapa: mapa, mensaje: 'Las ' + etiqueta + ' no están disponibles en este momento.' };
  }
}

/**
 * Diagnóstico desde el editor de GAS. Mide cuánto tarda el consolidado y
 * muestra el reparto nacional y el de cada región del mes más reciente, sin
 * pasar por la sesión ni el rol.
 *
 * NO devuelve nada a propósito: una función sin parámetros es invocable de
 * forma anónima con google.script.run, y aunque estas cifras sean agregadas,
 * dejarlas solo en el Logger las mantiene dentro del proyecto.
 */
function _diagnosticarParticipacionGeneral() {
  _ensureConfig();

  var TZ = CFG_PARTICIPACION.ZONA_HORARIA;
  var ahora = new Date();
  var mesActual = Utilities.formatDate(ahora, TZ, 'yyyy-MM');

  var catalogo = obtenerCatalogoActividades('');
  var todas = (catalogo && catalogo.actividades) ? catalogo.actividades : [];
  var meses = _participacionGeneralMesesDisponibles(todas, mesActual);

  var log = ['===== PARTICIPACION GENERAL ====='];
  log.push('Meses consolidables: ' + (meses.join(', ') || '(ninguno)'));

  if (meses.length === 0) {
    Logger.log(log.join(String.fromCharCode(10)));
    return;
  }

  var t0 = new Date().getTime();
  var r = _calcularParticipacionGeneral(meses[0], todas, ahora);
  var ms = new Date().getTime() - t0;

  var n = r.nacional;
  log.push('Mes calculado: ' + r.mes + ' (' + ms + ' ms)');
  log.push('NACIONAL — socios activos: ' + n.totalActivos + ' | base: ' + n.base +
           ' | participaron: ' + n.participaron);
  log.push('   Regiones con actividad: ' + n.regionesConActividad + ' | Actividades: ' + n.actividades);
  CFG_PARTICIPACION_GENERAL.ORDEN.forEach(function(k) {
    log.push('      ' + k + ': ' + n.conteos[k]);
  });
  log.push('      FUERA DE BASE - sin actividad en su region: ' + n.fueraDeBase.SIN_ACTIVIDAD);
  log.push('      FUERA DE BASE - sin region registrada: ' + n.fueraDeBase.SIN_REGION);

  // Ordenadas por tamanio, igual que el panel de seleccion: asi se ve de
  // inmediato si la columna REGION guarda regiones o faenas.
  log.push('POR ZONA (' + Object.keys(r.regiones).length + ' en total):');
  _listadoZonas(r).forEach(function(z) {
    var b = z.bloque;
    log.push('   ' + z.etiqueta + '  [' + z.clave + ']');
    log.push('      base ' + b.base + ' de ' + b.totalActivos + ' activos | participaron ' +
             b.participaron + ' | faltas ' + b.conteos.FALTA + ' | actividades ' + b.actividades);
  });

  Object.keys(r.fuentes).forEach(function(f) {
    if (!r.fuentes[f].ok) log.push('   FUENTE CAIDA -> ' + f + ': ' + r.fuentes[f].mensaje);
  });

  Logger.log(log.join(String.fromCharCode(10)));
}

/**
 * Reconcilia, fila por fila, la diferencia entre las filas de la planilla de
 * Brigada y el "Asistió" del consolidado.
 *
 * Existe porque esa diferencia tiene VARIAS causas legítimas a la vez y mirar
 * los dos totales no permite separarlas: la planilla cuenta MARCAJES y el
 * gráfico cuenta SOCIOS, además de descartar duplicados y quedarse solo con
 * quienes están activos en BD_SLIMAPP. Sin este desglose, una diferencia
 * normal y una pérdida real de datos se ven exactamente igual.
 *
 * Mes: el más reciente consolidable, o el de la propiedad MES_DIAGNOSTICO_ASISTENCIA
 * ("YYYY-MM") si existe. BORRA esa propiedad al terminar.
 *
 * SOLO LECTURA y log-only: no devuelve nada porque una función sin parámetros
 * es invocable de forma anónima, y acá salen RUTs.
 */
function _diagnosticarBrechaAsistencia() {
  _ensureConfig();

  var TZ = CFG_PARTICIPACION.ZONA_HORARIA;
  var ahora = new Date();
  // El mes por defecto sale de la PLANILLA, no del catalogo: el mes mas
  // reciente que tenga marcajes. Tomarlo del catalogo hacia analizar un mes
  // con asambleas programadas y cero asistencia, que no reconcilia nada.
  var mes = String(PropertiesService.getScriptProperties()
                     .getProperty('MES_DIAGNOSTICO_ASISTENCIA') || '').trim();

  var log = ['===== BRECHA: PLANILLA DE BRIGADA vs "ASISTIO" ====='];

  var CFG = CFG_ASISTENCIA_BRIGADA;
  var COL = CFG.COL;
  var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEETS.ASISTENCIA_BRIGADA);

  var totalFilas = 0, sinFecha = 0;
  var filas = [];        // {mes, duplicado, rut} de cada fila con fecha legible
  var porMes = {};       // cuantas filas tiene cada mes, para elegir y para mostrar

  for (var h = 0; h < CFG.HOJAS_A_LEER.length; h++) {
    var nombreHoja = CFG.HOJAS_A_LEER[h];
    var hoja = ss.getSheetByName(nombreHoja);
    if (!hoja) { log.push('   Pestania "' + nombreHoja + '": no existe.'); continue; }

    var ultima = hoja.getLastRow();
    if (ultima <= CFG.FILA_ENCABEZADO) { log.push('   Pestania "' + nombreHoja + '": vacia.'); continue; }

    var datos = hoja.getRange(CFG.FILA_ENCABEZADO + 1, 1,
                              ultima - CFG.FILA_ENCABEZADO, CFG.TOTAL_COLUMNAS).getValues();
    for (var i = 0; i < datos.length; i++) {
      totalFilas++;
      var fila = datos[i];

      var fecha = parsearFechaFlexible(fila[COL.HORA_MARCAJE]) ||
                  parsearFechaFlexible(fila[COL.FECHA]);
      if (!fecha) { sinFecha++; continue; }

      var mesFila = Utilities.formatDate(fecha, CFG.ZONA_HORARIA, 'yyyy-MM');
      var estadoNotif = String(fila[COL.ESTADO_NOTIFICACION] || '').trim().toUpperCase();

      porMes[mesFila] = (porMes[mesFila] || 0) + 1;
      filas.push({
        mes: mesFila,
        duplicado: (estadoNotif.indexOf('DUPLICADO') === 0),
        rut: cleanRut(fila[COL.RUT_AFILIADO])
      });
    }

    log.push('   Pestania "' + nombreHoja + '": ' + datos.length + ' filas.');
  }

  // --- Reparto por mes y eleccion del mes a reconciliar ---
  var mesesConDatos = Object.keys(porMes).sort();
  log.push('');
  log.push('FILAS POR MES EN LA PLANILLA');
  mesesConDatos.forEach(function(m) { log.push('   ' + m + ': ' + porMes[m]); });
  if (sinFecha) log.push('   (sin fecha legible, fuera de todo mes): ' + sinFecha);

  if (!mes) mes = mesesConDatos.length ? mesesConDatos[mesesConDatos.length - 1] : '';
  if (!mes) {
    log.push('');
    log.push('La planilla no tiene ningun marcaje con fecha. Nada que reconciliar.');
    Logger.log(log.join(String.fromCharCode(10)));
    return;
  }
  log.push('');
  log.push('MES RECONCILIADO: ' + mes);

  var filasDelMes = 0, duplicados = 0, sinRut = 0;
  var rutsDelMes = {};
  filas.forEach(function(f) {
    if (f.mes !== mes) return;
    filasDelMes++;
    if (f.duplicado) { duplicados++; return; }
    if (!f.rut) { sinRut++; return; }
    rutsDelMes[f.rut] = (rutsDelMes[f.rut] || 0) + 1;
  });

  // --- Estado de cada RUT en BD_SLIMAPP ---
  // El grafico solo cuenta socios ACTIVOS: un marcaje de alguien desvinculado
  // existe en la planilla y no tiene donde sumarse.
  var hojaU = getSheet('USUARIOS', 'USUARIOS');
  var COLU = CONFIG.COLUMNAS.USUARIOS;
  var datosU = hojaU.getRange(2, 1, hojaU.getLastRow() - 1, hojaU.getLastColumn()).getValues();
  var estadoPorRut = {};
  for (var u = 0; u < datosU.length; u++) {
    var rutU = cleanRut(datosU[u][COLU.RUT]);
    if (rutU) estadoPorRut[rutU] = String(datosU[u][COLU.ESTADO] || '').trim().toUpperCase();
  }

  var unicos = Object.keys(rutsDelMes);
  var activos = 0, noActivos = 0, noEncontrados = 0, repetidos = 0, marcajesUtiles = 0;
  var ejemplosNoActivos = [], ejemplosNoEncontrados = [];

  unicos.forEach(function(rut) {
    marcajesUtiles += rutsDelMes[rut];
    if (rutsDelMes[rut] > 1) repetidos++;

    var e = estadoPorRut[rut];
    if (e === undefined) {
      noEncontrados++;
      if (ejemplosNoEncontrados.length < 10) ejemplosNoEncontrados.push(rut);
    } else if (e === 'ACTIVO' || e === 'SI' || e === 'TRUE') {
      activos++;
    } else {
      noActivos++;
      if (ejemplosNoActivos.length < 10) ejemplosNoActivos.push(rut + ' (' + e + ')');
    }
  });

  log.push('');
  log.push('FILAS');
  log.push('   Filas totales en las dos pestanias: ' + totalFilas);
  log.push('   Filas de ' + mes + ': ' + filasDelMes);
  log.push('      - marcadas DUPLICADO (descartadas): ' + duplicados);
  log.push('      - sin RUT legible (descartadas): ' + sinRut);
  log.push('      - marcajes utiles: ' + marcajesUtiles);
  log.push('');
  log.push('DE MARCAJES A SOCIOS');
  log.push('   Socios distintos que marcaron: ' + unicos.length);
  log.push('   De ellos, con mas de un marcaje en el mes: ' + repetidos +
           '  (suman ' + (marcajesUtiles - unicos.length) + ' filas de mas)');
  log.push('');
  log.push('CRUCE CON BD_SLIMAPP');
  log.push('   ACTIVOS  -> cuentan como "Asistio": ' + activos);
  log.push('   No activos (desvinculados u otro estado): ' + noActivos);
  log.push('   RUT que no existe en BD_SLIMAPP: ' + noEncontrados);
  if (ejemplosNoActivos.length) log.push('      ej.: ' + ejemplosNoActivos.join(', '));
  if (ejemplosNoEncontrados.length) log.push('      ej.: ' + ejemplosNoEncontrados.join(', '));
  log.push('');
  log.push('CUADRATURA');
  log.push('   ' + filasDelMes + ' filas del mes');
  log.push('   - ' + duplicados + ' duplicados - ' + sinRut + ' sin RUT');
  log.push('   - ' + (marcajesUtiles - unicos.length) + ' marcajes repetidos del mismo socio');
  log.push('   - ' + noActivos + ' no activos - ' + noEncontrados + ' fuera de BD_SLIMAPP');
  log.push('   = ' + activos + '  <- debe coincidir con "Asistio" del grafico');
  log.push('');
  log.push('Recuerda BORRAR MES_DIAGNOSTICO_ASISTENCIA si la creaste.');

  Logger.log(log.join(String.fromCharCode(10)));
}

/**
 * Reconcilia, fila por fila, la diferencia entre las filas en estado "Enviado"
 * de la planilla de justificaciones y el "En revision" del consolidado.
 *
 * Es la hermana de _diagnosticarBrechaAsistencia() y existe por la misma razon:
 * esa diferencia tiene VARIAS causas legitimas a la vez y mirar los dos totales
 * no permite separarlas. La planilla cuenta FILAS y el grafico cuenta SOCIOS;
 * ademas el grafico colapsa las filas repetidas del mismo socio, descarta a
 * quien no esta activo en BD_SLIMAPP, aplica la precedencia de
 * _resolverResultadoParticipacion() —asistir o tener una justificacion aprobada
 * TAPAN un "Enviado"— y atribuye cada fila al mes de su ASAMBLEA, no al mes en
 * que se presento. Sin este desglose, una diferencia normal y una perdida real
 * de datos se ven exactamente igual.
 *
 * El "En revision" del grafico ademas suma APELACIONES, que no estan en esta
 * planilla: se reportan aparte para que la cuadratura cierre.
 *
 * Mes: el mas reciente con filas "Enviado", o el de la propiedad
 * MES_DIAGNOSTICO_JUSTIFICACIONES ("YYYY-MM") si existe. La propiedad se BORRA
 * al empezar, no al terminar: es el criterio de puerta autocerrante del
 * proyecto, asi que para volver a fijar un mes hay que crearla de nuevo.
 *
 * SOLO LECTURA y log-only: no devuelve nada porque una funcion sin parametros
 * es invocable de forma anonima, y aca salen RUTs.
 */
function _diagnosticarBrechaJustificaciones() {
  _ensureConfig();

  var props = PropertiesService.getScriptProperties();
  var mes = String(props.getProperty('MES_DIAGNOSTICO_JUSTIFICACIONES') || '').trim();
  try { props.deleteProperty('MES_DIAGNOSTICO_JUSTIFICACIONES'); } catch (eP) {}

  var log = ['===== BRECHA: JUSTIFICACIONES "Enviado" vs "EN REVISION" ====='];

  // --- La planilla entera, en una sola pasada ---
  var hoja = getSpreadsheet('JUSTIFICACIONES').getSheetByName(CONFIG.HOJAS.JUSTIFICACIONES);
  if (!hoja) {
    log.push('No se encontro la hoja de justificaciones.');
    Logger.log(log.join(String.fromCharCode(10)));
    return;
  }

  var ultima = hoja.getLastRow();
  if (ultima < 2) {
    log.push('La hoja de justificaciones esta vacia. Nada que reconciliar.');
    Logger.log(log.join(String.fromCharCode(10)));
    return;
  }

  var COL = CONFIG.COLUMNAS.JUSTIFICACIONES;
  var datos = hoja.getRange(2, 1, ultima - 1, hoja.getLastColumn()).getValues();

  var filas = [];        // solo las "Enviado": {mes, rut, porFecha}
  var totalFilas = datos.length;
  var sinMes = 0;        // filas "Enviado" cuyo mes no se pudo deducir
  var porMesTodos = {};  // todas las filas, por mes
  var porMesEnviado = {};
  var estados = {};      // como esta escrito el estado, tal cual

  for (var i = 0; i < datos.length; i++) {
    var fila = datos[i];

    var estadoCrudo = String(fila[COL.ESTADO] || '(vacio)').trim();
    estados[estadoCrudo] = (estados[estadoCrudo] || 0) + 1;

    // Exactamente el mismo criterio de _participacionGeneralTramites(): el mes
    // sale del codigo de asamblea y la fecha de solicitud es solo el respaldo.
    var porCodigo = _mesDesdeCodigoAsamblea(fila[COL.ASAMBLEA]);
    var mesFila = porCodigo || _mesDesdeValor(fila[COL.FECHA]);
    if (mesFila) porMesTodos[mesFila] = (porMesTodos[mesFila] || 0) + 1;

    var estado = estadoCrudo.toLowerCase();
    if (CFG_PARTICIPACION.ESTADOS_EN_REVISION.indexOf(estado) === -1) continue;

    if (!mesFila) { sinMes++; continue; }
    porMesEnviado[mesFila] = (porMesEnviado[mesFila] || 0) + 1;
    filas.push({ mes: mesFila, rut: cleanRut(fila[COL.RUT]), porFecha: !porCodigo });
  }

  log.push('Filas totales en la planilla: ' + totalFilas);
  log.push('');
  log.push('COMO ESTA ESCRITO EL ESTADO (solo cuenta lo que este en ' +
           CFG_PARTICIPACION.ESTADOS_EN_REVISION.join('/') + ')');
  Object.keys(estados).sort().forEach(function(e) {
    var cuenta = CFG_PARTICIPACION.ESTADOS_EN_REVISION.indexOf(e.toLowerCase()) !== -1;
    log.push('   ' + (cuenta ? '[en revision] ' : '              ') + estados[e] + '  "' + e + '"');
  });

  var mesesConEnviado = Object.keys(porMesEnviado).sort();
  log.push('');
  log.push('FILAS "Enviado" POR MES  (mes de la ASAMBLEA, no el de presentacion)');
  mesesConEnviado.forEach(function(m) {
    log.push('   ' + m + ': ' + porMesEnviado[m] + '   (de ' + (porMesTodos[m] || 0) + ' filas del mes)');
  });
  if (sinMes) {
    log.push('   (sin mes deducible, fuera de todo mes): ' + sinMes +
             '   ATENCION: estas no se ven en ningun grafico');
  }

  if (!mes) mes = mesesConEnviado.length ? mesesConEnviado[mesesConEnviado.length - 1] : '';
  if (!mes) {
    log.push('');
    log.push('No hay ninguna fila "Enviado" con mes deducible. Nada que reconciliar.');
    Logger.log(log.join(String.fromCharCode(10)));
    return;
  }
  log.push('');
  log.push('MES RECONCILIADO: ' + mes);

  // --- De filas a socios ---
  var filasDelMes = 0, sinRut = 0, porFecha = 0;
  var rutsEnviado = {};
  filas.forEach(function(f) {
    if (f.mes !== mes) return;
    filasDelMes++;
    if (f.porFecha) porFecha++;
    if (!f.rut) { sinRut++; return; }
    rutsEnviado[f.rut] = (rutsEnviado[f.rut] || 0) + 1;
  });

  var unicos = Object.keys(rutsEnviado);
  var filasConRut = 0, repetidos = 0;
  unicos.forEach(function(rut) {
    filasConRut += rutsEnviado[rut];
    if (rutsEnviado[rut] > 1) repetidos++;
  });

  // --- Estado de cada RUT en BD_SLIMAPP ---
  // El grafico recorre SOCIOS ACTIVOS, no filas: una justificacion de alguien
  // desvinculado existe en la planilla y no tiene donde sumarse.
  var hojaU = getSheet('USUARIOS', 'USUARIOS');
  var COLU = CONFIG.COLUMNAS.USUARIOS;
  var datosU = hojaU.getRange(2, 1, hojaU.getLastRow() - 1, hojaU.getLastColumn()).getValues();
  var estadoPorRut = {};
  for (var u = 0; u < datosU.length; u++) {
    var rutU = cleanRut(datosU[u][COLU.RUT]);
    if (rutU) estadoPorRut[rutU] = String(datosU[u][COLU.ESTADO] || '').trim().toUpperCase();
  }

  var activos = [], noActivos = 0, noEncontrados = 0;
  var ejemplosNoActivos = [], ejemplosNoEncontrados = [];

  unicos.forEach(function(rut) {
    var e = estadoPorRut[rut];
    if (e === undefined) {
      noEncontrados++;
      if (ejemplosNoEncontrados.length < 10) ejemplosNoEncontrados.push(rut);
    } else if (e === 'ACTIVO' || e === 'SI' || e === 'TRUE') {
      activos.push(rut);
    } else {
      noActivos++;
      if (ejemplosNoActivos.length < 10) ejemplosNoActivos.push(rut + ' (' + e + ')');
    }
  });

  // --- El calculo real, sin reimplementar la precedencia ---
  // Se le pregunta al mismo codigo que alimenta el grafico. Cualquier copia de
  // _resolverResultadoParticipacion() aca terminaria divergiendo, y entonces el
  // diagnostico explicaria una brecha distinta de la que el dirigente ve.
  var catalogo = obtenerCatalogoActividades('');
  var todas = (catalogo && catalogo.actividades) ? catalogo.actividades : [];
  var calculo = _participacionResultadosDelMes(mes, todas, new Date());

  var tapados = {};       // resultado que gano -> cuantos
  var ejemplosTapados = {};
  var enRevisionPorJust = 0;

  activos.forEach(function(rut) {
    var r = calculo.resultados[rut] || '(el socio no entro al calculo)';
    if (r === 'EN_REVISION') { enRevisionPorJust++; return; }
    tapados[r] = (tapados[r] || 0) + 1;
    if (!ejemplosTapados[r]) ejemplosTapados[r] = [];
    if (ejemplosTapados[r].length < 6) ejemplosTapados[r].push(rut);
  });

  // Los EN_REVISION que NO vienen de esta planilla son apelaciones del mes.
  var enRevisionTotal = 0, enRevisionPorApelacion = 0;
  Object.keys(calculo.resultados).forEach(function(rut) {
    if (calculo.resultados[rut] !== 'EN_REVISION') return;
    enRevisionTotal++;
    if (!rutsEnviado[rut]) enRevisionPorApelacion++;
  });

  // --- Informe ---
  log.push('');
  log.push('FILAS');
  log.push('   Filas "Enviado" de ' + mes + ': ' + filasDelMes);
  log.push('      - de ellas, con el mes deducido de la FECHA y no del codigo: ' + porFecha);
  log.push('      - sin RUT legible (descartadas): ' + sinRut);
  log.push('      - filas utiles: ' + filasConRut);
  log.push('');
  log.push('DE FILAS A SOCIOS');
  log.push('   Socios distintos con al menos una "Enviado": ' + unicos.length);
  log.push('   De ellos, con mas de una en el mes: ' + repetidos +
           '  (suman ' + (filasConRut - unicos.length) + ' filas de mas)');
  log.push('');
  log.push('CRUCE CON BD_SLIMAPP');
  log.push('   ACTIVOS -> llegan al grafico: ' + activos.length);
  log.push('   No activos (desvinculados u otro estado): ' + noActivos);
  log.push('   RUT que no existe en BD_SLIMAPP: ' + noEncontrados);
  if (ejemplosNoActivos.length) log.push('      ej.: ' + ejemplosNoActivos.join(', '));
  if (ejemplosNoEncontrados.length) log.push('      ej.: ' + ejemplosNoEncontrados.join(', '));
  log.push('');
  log.push('PRECEDENCIA: socios activos cuyo "Enviado" quedo TAPADO por algo mejor');
  var totalTapados = 0;
  Object.keys(tapados).sort().forEach(function(r) {
    totalTapados += tapados[r];
    log.push('   ' + r + ': ' + tapados[r] + '      ej.: ' + ejemplosTapados[r].join(', '));
  });
  if (!totalTapados) log.push('   (ninguno)');
  log.push('');
  log.push('CUADRATURA');
  log.push('   ' + filasDelMes + ' filas "Enviado" del mes');
  log.push('   - ' + sinRut + ' sin RUT');
  log.push('   - ' + (filasConRut - unicos.length) + ' filas repetidas del mismo socio');
  log.push('   - ' + noActivos + ' no activos - ' + noEncontrados + ' fuera de BD_SLIMAPP');
  log.push('   - ' + totalTapados + ' tapados por la precedencia');
  log.push('   = ' + enRevisionPorJust + ' socios "en revision" por justificacion');
  log.push('   + ' + enRevisionPorApelacion + ' socios "en revision" solo por APELACION');
  log.push('   = ' + enRevisionTotal + '  <- debe coincidir con "En revision" del grafico');

  Object.keys(calculo.fuentes).forEach(function(f) {
    if (!calculo.fuentes[f].ok) log.push('   FUENTE CAIDA -> ' + f + ': ' + calculo.fuentes[f].mensaje);
  });

  Logger.log(log.join(String.fromCharCode(10)));
}
