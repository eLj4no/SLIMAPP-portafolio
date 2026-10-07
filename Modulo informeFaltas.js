// ============================================================================
// INFORME DE FALTAS A ASAMBLEA (ADMIN)
// ============================================================================
// Responde una sola pregunta: en los últimos N meses, ¿qué socios activos
// faltaron, en qué meses, y cuántas veces?
//
// El informe VIAJA POR CORREO, no a la pantalla. Son miles de RUT con nombre y
// apellido, la materia prima de un descuento: devolverlos al navegador los
// dejaría en una respuesta de `google.script.run` sobre un webapp de acceso
// público. Lo que vuelve a la pantalla es un resumen sin identificar a nadie; el
// detalle sale en un adjunto dirigido a las casillas del rol ADMIN.
//
// ⚠️ UNA FALTA SÓLO EXISTE DONDE EL SISTEMA PUEDE PROBARLA. Un mes sin datos no
//    es un mes sin participación: los meses anteriores al corte sólo se evalúan
//    en las zonas con carga histórica aplicada, y el resto queda "no evaluado".
//    Por eso cada socio se informa como "3 de 6 meses evaluados" y NUNCA como un
//    porcentaje suelto: sin el denominador a la vista, un socio nuevo o una zona
//    sin datos se lee igual que un ausente crónico.
//
// LA REGLA DE QUIÉN FALTÓ NO ESTÁ ACÁ. La resuelve
// `_resolverResultadoParticipacion()` en Modulo participacion.js, que es la
// misma que usan el consolidado por zona y SLIM Quest. Reimplementarla haría que
// el panel del dirigente y este informe se contradijeran, que es exactamente el
// tipo de discrepancia que nadie descubre hasta que un socio reclama.
// ============================================================================

var CFG_INFORME_FALTAS = {
  ZONA_HORARIA: 'America/Santiago',

  // Ventanas que el ADMIN puede pedir. No es una lista arbitraria: 3 y 6 cubren
  // el ciclo de descuentos, 12 y 24 el histórico.
  VENTANAS: [3, 6, 12, 24],

  // Sólo este resultado cuenta como falta. Los demás son participación
  // (ASISTIO / JUSTIFICADO / APELACION_ACOGIDA) o estados neutros que no se le
  // pueden imputar a nadie (EN_REVISION, EN_PLAZO, SIN_ACTIVIDAD, SIN_REGION).
  RESULTADO_FALTA: 'FALTA',

  COLOR: '#B45309',

  // Tope del detalle que se muestra EN EL CUERPO del correo. El resto viaja en
  // el adjunto: un correo con tres mil filas en el cuerpo no lo abre nadie.
  MAX_FILAS_EN_CUERPO: 25
};

// ============================================================================
// API PÚBLICA
// ============================================================================

/**
 * Genera el informe y lo envía por correo a las casillas del rol ADMIN.
 *
 * Identidad por TOKEN DE SESIÓN, nunca por un RUT del navegador: este informe
 * nombra a miles de socios, así que un parámetro de RUT permitiría pedirlo
 * desde la consola pasando el RUT de cualquier ADMIN.
 *
 * @param {string} sessionToken Token entregado al ingresar.
 * @param {number} meses 3, 6, 12 o 24.
 * @return {{success, sesionExpirada, resumen, message}}
 */
function generarInformeFaltas(sessionToken, meses) {
  // _ensureConfig() primero y FUERA del try: CONFIG parte en null en cada
  // ejecución y leerlo antes de poblarlo lanza un TypeError que el catch taparía.
  _ensureConfig();

  try {
    var rut = obtenerRutDeSesion(sessionToken);
    if (!rut) {
      return { success: false, sesionExpirada: true,
               message: 'Tu sesión expiró. Vuelve a ingresar para generar el informe.' };
    }

    var verificacion = verificarRolUsuario(rut, ['ADMIN']);
    if (!verificacion.autorizado) {
      Logger.log('⚠️ Informe de faltas: intento no autorizado — RUT=' + rut);
      return { success: false, sesionExpirada: false, message: 'No autorizado.' };
    }

    var ventana = parseInt(meses, 10);
    if (CFG_INFORME_FALTAS.VENTANAS.indexOf(ventana) === -1) {
      return { success: false, sesionExpirada: false,
               message: 'El período debe ser de ' + CFG_INFORME_FALTAS.VENTANAS.join(', ') + ' meses.' };
    }

    var datos = _calcularInformeFaltas(ventana);
    if (!datos.success) return { success: false, sesionExpirada: false, message: datos.message };

    var envio = _enviarInformeFaltas(datos, rut);

    return {
      success: true,
      sesionExpirada: false,
      // A la pantalla vuelve el resumen, jamás el detalle: son datos de
      // personas y esto viaja por `google.script.run`.
      resumen: datos.resumen,
      message: envio.success
        ? ('Informe enviado a ' + envio.destinatarios.join(', ') + '.')
        : ('El informe se generó pero no se pudo enviar: ' + envio.message)
    };

  } catch (e) {
    Logger.log('❌ generarInformeFaltas: ' + e.toString());
    return { success: false, sesionExpirada: false,
             message: 'No se pudo generar el informe. Vuelve a intentarlo en unos minutos.' };
  }
}

// ============================================================================
// CÁLCULO
// ============================================================================

/**
 * El informe completo de una ventana de N meses.
 *
 * TODAS LAS PLANILLAS SE LEEN UNA SOLA VEZ para el rango entero. Pedir mes a mes
 * significaría releer socios, asistencia, justificaciones y apelaciones N veces:
 * a 24 meses son casi cien lecturas completas y no cabe en los 6 minutos de
 * Apps Script. Los mapas ya venían indexados por "RUT|mes", así que ensanchar el
 * filtro a un rango no cambió su forma (ver `_filtroDeMeses`).
 */
function _calcularInformeFaltas(ventanaMeses) {
  var TZ = CFG_INFORME_FALTAS.ZONA_HORARIA;
  var ahora = new Date();

  // --- La ventana ---
  // Termina en el mes ANTERIOR al actual: el mes en curso no está cerrado, sus
  // asambleas pueden no haber ocurrido todavía y contarlo produciría faltas de
  // algo que aún puede cumplirse.
  var meses = [];
  var cursor = new Date(ahora.getFullYear(), ahora.getMonth() - 1, 1);
  for (var i = 0; i < ventanaMeses; i++) {
    meses.push(Utilities.formatDate(cursor, TZ, 'yyyy-MM'));
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1);
  }
  meses.reverse();   // del más antiguo al más reciente

  // Tiempos por fase. La primera corrida real tardo dos minutos y no era
  // evidente en que: sirve para decidir con datos, no por intuicion.
  var t = {}; var _t0 = new Date().getTime();
  function marcar(fase) { var n = new Date().getTime(); t[fase] = n - _t0; _t0 = n; }

  // --- Las fuentes, una lectura cada una ---
  var socios          = _sociosParaInformeFaltas();
  marcar('socios');
  if (!socios.ok) return { success: false, message: socios.mensaje };

  var asistencias     = _participacionGeneralAsistencias(meses);  marcar('asistencia');
  var justificaciones = _participacionGeneralTramites('JUSTIFICACIONES', meses); marcar('justificaciones');
  var apelaciones     = _participacionGeneralTramites('APELACIONES', meses); marcar('apelaciones');

  var cat = obtenerCatalogoActividades('');
  if (!cat || !cat.success) return { success: false, message: 'No se pudo leer el calendario de actividades.' };
  var actividades = cat.actividades || [];
  marcar('catalogo');

  // Si una fuente falló, el informe NO SE EMITE. Una justificación que no se
  // pudo leer se ve idéntica a una que no existe, y acá esa diferencia es la que
  // separa a un socio que cumplió de uno al que se le va a descontar.
  var caidas = [];
  if (!asistencias.ok)     caidas.push('asistencia');
  if (!justificaciones.ok) caidas.push('justificaciones');
  if (!apelaciones.ok)     caidas.push('apelaciones');
  if (caidas.length) {
    return { success: false,
             message: 'No se pudo leer: ' + caidas.join(', ') +
                      '. El informe no se emite con fuentes incompletas, para no ' +
                      'imputar faltas que no lo son.' };
  }

  // --- Actividades y plazos, por mes y zona ---
  var actividadesPorMesZona = {};   // 'mes|zona' -> [actividades]
  for (var a = 0; a < actividades.length; a++) {
    var act = actividades[a];
    if (!act.mes || meses.indexOf(act.mes) === -1) continue;
    var z = _normalizarRegionParaComparar(act.region);
    if (!z) continue;
    var k = act.mes + '|' + z;
    if (!actividadesPorMesZona[k]) actividadesPorMesZona[k] = [];
    actividadesPorMesZona[k].push(act);
  }

  var plazoPorMesZona = {};
  var mesesConAsamblea = {};   // el mes tuvo al menos una actividad registrada
  Object.keys(actividadesPorMesZona).forEach(function(k) {
    plazoPorMesZona[k] = _plazoAbiertoDelMes(actividadesPorMesZona[k], ahora).abierto;
    mesesConAsamblea[k.split('|')[0]] = true;
  });

  // --- Socio por socio, mes por mes ---
  var detalle = [];          // una fila por socio y mes con falta
  var porSocio = {};         // rut -> { faltas, evaluados, meses[] }
  var porMes = {};           // mes -> { faltas, evaluados }
  var porZona = {};          // zona -> { faltas, socios{} }

  for (var s = 0; s < socios.lista.length; s++) {
    var socio = socios.lista[s];
    porSocio[socio.rut] = { faltas: 0, evaluados: 0, meses: [] };

    for (var m = 0; m < meses.length; m++) {
      var mes = meses[m];
      var clave = socio.rut + '|' + mes;
      var claveZona = mes + '|' + socio.region;

      var resultado = _resolverResultadoParticipacion({
        asistio:      !!asistencias.mapa[clave],
        just:         justificaciones.mapa[clave],
        apel:         apelaciones.mapa[clave],
        region:       socio.region,
        hayActividad: !!actividadesPorMesZona[claveZona],
        plazoAbierto: !!plazoPorMesZona[claveZona],
        mesIngreso:   socio.mesIngreso,
        mes:          mes
      });

      // "Evaluado" = el sistema pudo pronunciarse. Los estados neutros no
      // cuentan ni a favor ni en contra, y son justamente los que hacen que un
      // porcentaje sin denominador mienta.
      var evaluado = (resultado === 'ASISTIO' || resultado === 'JUSTIFICADO' ||
                      resultado === 'APELACION_ACOGIDA' || resultado === 'FALTA');
      if (evaluado) {
        porSocio[socio.rut].evaluados++;
        if (!porMes[mes]) porMes[mes] = { faltas: 0, evaluados: 0 };
        porMes[mes].evaluados++;
      }

      if (resultado !== CFG_INFORME_FALTAS.RESULTADO_FALTA) continue;

      porSocio[socio.rut].faltas++;
      porSocio[socio.rut].meses.push(mes);
      porMes[mes].faltas++;

      var zonaEtiqueta = socios.etiquetas[socio.region] || socio.region || 'Sin zona';
      if (!porZona[zonaEtiqueta]) porZona[zonaEtiqueta] = { faltas: 0, socios: {} };
      porZona[zonaEtiqueta].faltas++;
      porZona[zonaEtiqueta].socios[socio.rut] = true;

      detalle.push({
        rut:    formatRutDisplay(socio.rut),
        nombre: socio.nombre,
        zona:   zonaEtiqueta,
        mes:    mes,
        mesLegible: _mesLegible(mes)
      });
    }
  }

  marcar('calculo');

  // --- Resumen ---
  var sociosConFalta = 0, totalFaltas = 0, sinNingunaFalta = 0, sinEvaluar = 0;
  var ruts = Object.keys(porSocio);
  for (var r = 0; r < ruts.length; r++) {
    var p = porSocio[ruts[r]];
    totalFaltas += p.faltas;
    if (p.faltas > 0) sociosConFalta++;
    else if (p.evaluados > 0) sinNingunaFalta++;
    else sinEvaluar++;   // ningún mes evaluable: zona sin datos, o socio nuevo
  }

  // Del que más faltó al que menos; a igualdad, por nombre, para que dos
  // corridas del mismo informe salgan siempre en el mismo orden.
  detalle.sort(function(x, y) {
    var fx = porSocio[cleanRut(x.rut)].faltas, fy = porSocio[cleanRut(y.rut)].faltas;
    if (fx !== fy) return fy - fx;
    if (x.nombre !== y.nombre) return x.nombre < y.nombre ? -1 : 1;
    return x.mes < y.mes ? -1 : 1;
  });

  // Un mes "con datos" es uno en que hubo asamblea registrada, NO uno en que
  // alguien salio evaluado. La diferencia no es teorica: enero y febrero no
  // tienen asambleas, pero arrastran alguna justificacion suelta, y contarlos
  // como meses con datos hacia que un periodo de 12 meses con 5 utiles se
  // informara como completo. El ADMIN habria leido el total como si cubriera
  // el anio.
  marcar('orden');
  var mesesConDatos = meses.filter(function(m) { return mesesConAsamblea[m]; });

  return {
    success: true,
    ventana: ventanaMeses,
    meses: meses,
    mesesConDatos: mesesConDatos,
    mesesConAsamblea: mesesConAsamblea,
    generado: Utilities.formatDate(ahora, TZ, 'dd/MM/yyyy HH:mm'),
    tiempos: t,
    detalle: detalle,
    porSocio: porSocio,
    porMes: porMes,
    porZona: porZona,
    sociosNombre: socios.nombres,
    resumen: {
      ventana:            ventanaMeses,
      mesesPedidos:       meses.length,
      mesesConDatos:      mesesConDatos.length,
      sociosActivos:      socios.lista.length,
      sociosConFalta:     sociosConFalta,
      sociosSinFalta:     sinNingunaFalta,
      sociosSinEvaluar:   sinEvaluar,
      totalFaltas:        totalFaltas
    }
  };
}

/**
 * Socios activos con su nombre, que `_participacionGeneralSociosActivos()` no
 * devuelve porque el consolidado por zona sólo cuenta y no nombra a nadie.
 *
 * Mismo criterio de "activo" que allá —la columna la llenan personas y aparecen
 * las tres variantes— y mismo tratamiento de las zonas centinela.
 */
function _sociosParaInformeFaltas() {
  try {
    var hoja = getSheet('USUARIOS', 'USUARIOS');
    var lastRow = hoja.getLastRow();
    if (lastRow < 2) return { ok: true, lista: [], etiquetas: {}, nombres: {}, mensaje: '' };

    var COL = CONFIG.COLUMNAS.USUARIOS;
    var datos = hoja.getRange(2, 1, lastRow - 1, hoja.getLastColumn()).getValues();
    var lista = [], etiquetas = {}, nombres = {};

    for (var i = 0; i < datos.length; i++) {
      var estado = String(datos[i][COL.ESTADO] || '').trim().toUpperCase();
      if (estado !== 'ACTIVO' && estado !== 'SI' && estado !== 'TRUE') continue;

      var rut = cleanRut(datos[i][COL.RUT]);
      if (!rut) continue;

      var regionCruda = String(datos[i][COL.REGION] || '').trim();
      var region = _normalizarRegionParaComparar(regionCruda);
      if (CENTINELAS_SIN_REGION.indexOf(region) !== -1) region = '';
      if (region && regionCruda && !etiquetas[region]) etiquetas[region] = regionCruda;

      var nombre = String(datos[i][COL.NOMBRE] || '').trim() || 'Sin nombre';
      nombres[rut] = nombre;

      lista.push({ rut: rut, region: region, nombre: nombre,
                   mesIngreso: _mesDeAfiliacion(datos[i][COL.FECHA_INGRESO]) });
    }

    return { ok: true, lista: lista, etiquetas: etiquetas, nombres: nombres, mensaje: '' };

  } catch (e) {
    Logger.log('❌ Informe de faltas: falló la lectura de socios — ' + e.toString());
    return { ok: false, lista: [], etiquetas: {}, nombres: {},
             mensaje: 'No se pudo leer la base de socios.' };
  }
}

// ============================================================================
// ENVÍO
// ============================================================================

/**
 * Arma el correo y lo manda a las casillas del rol ADMIN.
 *
 * Va sólo a ADMIN, como el respaldo de bases de datos y por el mismo motivo:
 * es una lista nominal de socios a los que se les puede descontar. No se copia a
 * DIRECTORIO, DIRIGENTE ni REPLEGAL, y no debe empezar a copiárseles sin una
 * decisión explícita de la organización.
 */
function _enviarInformeFaltas(datos, rutSolicitante) {
  var destinatarios = obtenerCorreosAdmin();
  if (!destinatarios || !destinatarios.length) {
    Logger.log('⚠️ Informe de faltas: no hay correos ADMIN activos en CUENTAS_VALIDAS.');
    return { success: false, destinatarios: [], message: 'No hay casillas ADMIN configuradas.' };
  }

  var r = datos.resumen;
  var asunto = 'Informe de faltas a asamblea — últimos ' + r.ventana + ' meses (' + datos.generado + ')';

  var nombreBase = 'faltas_' + r.ventana + 'meses_' +
                   Utilities.formatDate(new Date(), CFG_INFORME_FALTAS.ZONA_HORARIA, 'yyyy-MM-dd');

  // XLSX con dos hojas, y CSV como red de seguridad. La exportacion a XLSX
  // depende de una peticion HTTP y del scope `script.external_request`: si el
  // proyecto todavia no fue reautorizado en este entorno, falla. Mandar el CSV
  // es preferible a no mandar el informe.
  var adjunto = _xlsxInformeFaltas(datos, nombreBase);
  var formato = 'xlsx';
  if (!adjunto) {
    adjunto = Utilities.newBlob(_csvInformeFaltas(datos), 'text/csv', nombreBase + '.csv');
    formato = 'csv';
  }

  try {
    // Un archivo adjunto y no una hoja compartida en Drive, a proposito: no hay
    // que compartirlo con nadie, no queda acumulando permisos que despues nadie
    // revisa, y viaja con el correo a donde el ADMIN lo necesite.
    GmailApp.sendEmail(destinatarios.join(','), asunto, _textoPlanoInformeFaltas(datos), {
      htmlBody: _htmlInformeFaltas(datos, rutSolicitante),
      attachments: [adjunto],
      name: 'Sindicato SLIM N°3'
    });

    return { success: true, destinatarios: destinatarios, formato: formato, message: '' };

  } catch (e) {
    Logger.log('❌ Informe de faltas: falló el envío — ' + e.toString());
    return { success: false, destinatarios: destinatarios, message: e.message };
  }
}

/**
 * El adjunto en XLSX, con dos hojas: Detalle y Resumen.
 *
 * Apps Script no sabe producir XLSX por su cuenta: hay que crear una planilla
 * de verdad, pedirle a Google que la exporte y despues borrarla. Ese `export`
 * es una peticion HTTP, y por eso el proyecto necesita el scope
 * `script.external_request` -- que se agrego junto con esta funcion y obliga a
 * reautorizar el proyecto a mano una vez por entorno.
 *
 * NO LANZA: si algo falla, devuelve null y el correo sale con el CSV. Un
 * adjunto en el formato equivocado es mejor que un informe que no llega.
 *
 * La planilla temporal se restringe apenas se crea y se borra al terminar,
 * incluso si la exportacion falla: contiene los RUT y nombres de miles de
 * socios, y el dominio de Workspace comparte por defecto lo que se crea.
 */
function _xlsxInformeFaltas(datos, nombreArchivo) {
  var idTemporal = '';
  try {
    var libro = SpreadsheetApp.create('TMP_' + nombreArchivo);
    idTemporal = libro.getId();
    try { _restringirAccesoDrive(idTemporal); } catch (eR) { /* se borra igual al final */ }

    // --- Hoja 1: el detalle ---
    var hojaDetalle = libro.getSheets()[0];
    hojaDetalle.setName('Detalle');

    var filas = [['RUT', 'NOMBRE', 'ZONA', 'MES', 'FALTAS EN EL PERIODO', 'MESES EVALUADOS']];
    for (var i = 0; i < datos.detalle.length; i++) {
      var d = datos.detalle[i];
      var p = datos.porSocio[cleanRut(d.rut)] || { faltas: 0, evaluados: 0 };
      filas.push([d.rut, d.nombre, d.zona, d.mes, p.faltas, p.evaluados]);
    }
    // Un solo setValues: fila por fila serian miles de llamadas y la ejecucion
    // se cortaria por tiempo, igual que pasaba en la carga historica.
    hojaDetalle.getRange(1, 1, filas.length, 6).setValues(filas);
    hojaDetalle.getRange(1, 1, 1, 6).setFontWeight('bold');
    hojaDetalle.setFrozenRows(1);
    // El RUT como texto: con formato numerico Excel se come el guion y el
    // digito verificador, y el archivo deja de servir para cruzar contra nada.
    hojaDetalle.getRange(2, 1, Math.max(filas.length - 1, 1), 1).setNumberFormat('@');
    hojaDetalle.autoResizeColumns(1, 4);

    // --- Hoja 2: el resumen ---
    var hojaResumen = libro.insertSheet('Resumen');
    var r = datos.resumen;
    var res = [
      ['INFORME DE FALTAS A ASAMBLEA', ''],
      ['Generado', datos.generado],
      ['Periodo', 'Ultimos ' + r.ventana + ' meses'],
      ['Meses con asambleas registradas', r.mesesConDatos + ' de ' + r.mesesPedidos],
      ['Socios activos', r.sociosActivos],
      ['Con al menos una falta', r.sociosConFalta],
      ['Sin ninguna falta', r.sociosSinFalta],
      ['Sin meses evaluables', r.sociosSinEvaluar],
      ['Total de faltas', r.totalFaltas],
      ['', ''],
      ['POR MES', 'Faltas', 'Evaluados']
    ];
    for (var m = 0; m < datos.meses.length; m++) {
      var mesX = datos.meses[m];
      if (!datos.mesesConAsamblea[mesX]) { res.push([_mesLegible(mesX), 'sin asambleas registradas', '']); continue; }
      var pm = datos.porMes[mesX] || { faltas: 0, evaluados: 0 };
      res.push([_mesLegible(mesX), pm.faltas, pm.evaluados]);
    }
    res.push(['', '']);
    res.push(['POR ZONA', 'Faltas', 'Socios']);
    Object.keys(datos.porZona).sort(function(a, b) {
      return datos.porZona[b].faltas - datos.porZona[a].faltas;
    }).forEach(function(z) {
      res.push([z, datos.porZona[z].faltas, Object.keys(datos.porZona[z].socios).length]);
    });

    var ancho = 3;
    var normalizadas = res.map(function(f) {
      var copia = f.slice();
      while (copia.length < ancho) copia.push('');
      return copia;
    });
    hojaResumen.getRange(1, 1, normalizadas.length, ancho).setValues(normalizadas);
    hojaResumen.getRange(1, 1, 1, ancho).setFontWeight('bold');
    hojaResumen.autoResizeColumns(1, ancho);

    SpreadsheetApp.flush();

    // --- Exportar ---
    var url = 'https://docs.google.com/spreadsheets/d/' + idTemporal +
              '/export?format=xlsx&portrait=false';
    var respuesta = UrlFetchApp.fetch(url, {
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true
    });

    if (respuesta.getResponseCode() !== 200) {
      Logger.log('⚠️ Informe de faltas: la exportacion a XLSX respondio ' +
                 respuesta.getResponseCode() + '. Se enviara el CSV.');
      return null;
    }

    return respuesta.getBlob().setName(nombreArchivo + '.xlsx');

  } catch (e) {
    Logger.log('⚠️ Informe de faltas: no se pudo generar el XLSX — ' + e.toString());
    return null;

  } finally {
    // Siempre, pase lo que pase: la planilla temporal lleva datos de socios.
    if (idTemporal) {
      try { DriveApp.getFileById(idTemporal).setTrashed(true); }
      catch (eB) { Logger.log('⚠️ Informe de faltas: quedo sin borrar la planilla temporal ' + idTemporal); }
    }
  }
}

/** El detalle completo, una fila por socio y mes con falta. */
function _csvInformeFaltas(datos) {
  var lineas = ['RUT,NOMBRE,ZONA,MES,FALTAS_EN_EL_PERIODO,MESES_EVALUADOS'];

  for (var i = 0; i < datos.detalle.length; i++) {
    var d = datos.detalle[i];
    var p = datos.porSocio[cleanRut(d.rut)] || { faltas: 0, evaluados: 0 };
    lineas.push([
      _csvCampo(d.rut), _csvCampo(d.nombre), _csvCampo(d.zona),
      _csvCampo(d.mes), p.faltas, p.evaluados
    ].join(','));
  }

  // BOM para que Excel en Windows no destroce los acentos al abrirlo.
  return String.fromCharCode(0xFEFF) + lineas.join(String.fromCharCode(13, 10));
}

/** Escapa un campo CSV: comillas dobles y separadores dentro del texto. */
function _csvCampo(valor) {
  var t = String(valor === null || valor === undefined ? '' : valor);
  if (t.indexOf('"') !== -1 || t.indexOf(',') !== -1 ||
      t.indexOf(String.fromCharCode(10)) !== -1 || t.indexOf(String.fromCharCode(13)) !== -1) {
    return '"' + t.replace(/"/g, '""') + '"';
  }
  return t;
}

/** Cuerpo HTML: el resumen y una muestra, nunca el detalle completo. */
function _htmlInformeFaltas(datos, rutSolicitante) {
  var r = datos.resumen;
  var C = CFG_INFORME_FALTAS.COLOR;

  var detalles = {
    'Período': 'Últimos ' + r.ventana + ' meses (' +
               _mesLegible(datos.meses[0]) + ' a ' + _mesLegible(datos.meses[datos.meses.length - 1]) + ')',
    'Meses con datos': r.mesesConDatos + ' de ' + r.mesesPedidos,
    'Socios activos': r.sociosActivos,
    'Socios con al menos una falta': r.sociosConFalta,
    'Socios sin ninguna falta': r.sociosSinFalta,
    'Socios sin meses evaluables': r.sociosSinEvaluar,
    'Total de faltas': r.totalFaltas
  };

  var cuerpo = '<p>Informe generado el ' + datos.generado + '.</p>';

  if (r.mesesConDatos < r.mesesPedidos) {
    cuerpo += '<p style="background:#FEF3C7;border-left:4px solid ' + C +
              ';padding:12px 14px;margin:16px 0;">' +
              '<b>Sólo ' + r.mesesConDatos + ' de los ' + r.mesesPedidos +
              ' meses pedidos tienen datos.</b> Los demás son anteriores al registro ' +
              'del sistema y no se evalúan: no significa que nadie haya participado, ' +
              'significa que no quedó registro. Los socios cuentan sobre los meses que ' +
              'sí se pudieron evaluar.</p>';
  }

  // --- Faltas por mes ---
  cuerpo += '<h3 style="margin:22px 0 8px;font-size:15px;">Faltas por mes</h3>' +
            '<table style="border-collapse:collapse;width:100%;font-size:14px;">' +
            '<tr><th align="left" style="border-bottom:2px solid #ddd;padding:6px 4px;">Mes</th>' +
            '<th align="right" style="border-bottom:2px solid #ddd;padding:6px 4px;">Faltas</th>' +
            '<th align="right" style="border-bottom:2px solid #ddd;padding:6px 4px;">Evaluados</th></tr>';
  for (var m = 0; m < datos.meses.length; m++) {
    var mesX = datos.meses[m];
    var pm = datos.porMes[mesX];
    // Un mes sin asamblea registrada se dice con todas sus letras. Mostrarlo
    // como '0 faltas' lo haria pasar por un mes de cumplimiento perfecto.
    var hubo = !!datos.mesesConAsamblea[mesX];
    cuerpo += '<tr><td style="border-bottom:1px solid #eee;padding:6px 4px;">' +
              _mesLegible(mesX) + '</td>' +
              (hubo
                ? ('<td align="right" style="border-bottom:1px solid #eee;padding:6px 4px;">' +
                   (pm ? pm.faltas : 0) + '</td>' +
                   '<td align="right" style="border-bottom:1px solid #eee;padding:6px 4px;color:#666;">' +
                   (pm ? pm.evaluados : 0) + '</td>')
                : '<td colspan="2" align="right" style="border-bottom:1px solid #eee;padding:6px 4px;color:#999;font-style:italic;">sin asambleas registradas</td>') +
              '</tr>';
  }
  cuerpo += '</table>';

  // --- Faltas por zona ---
  var zonas = Object.keys(datos.porZona).sort(function(a, b) {
    return datos.porZona[b].faltas - datos.porZona[a].faltas;
  });
  if (zonas.length) {
    cuerpo += '<h3 style="margin:22px 0 8px;font-size:15px;">Faltas por zona</h3>' +
              '<table style="border-collapse:collapse;width:100%;font-size:14px;">' +
              '<tr><th align="left" style="border-bottom:2px solid #ddd;padding:6px 4px;">Zona</th>' +
              '<th align="right" style="border-bottom:2px solid #ddd;padding:6px 4px;">Faltas</th>' +
              '<th align="right" style="border-bottom:2px solid #ddd;padding:6px 4px;">Socios</th></tr>';
    zonas.forEach(function(z) {
      cuerpo += '<tr><td style="border-bottom:1px solid #eee;padding:6px 4px;">' + z + '</td>' +
                '<td align="right" style="border-bottom:1px solid #eee;padding:6px 4px;">' +
                datos.porZona[z].faltas + '</td>' +
                '<td align="right" style="border-bottom:1px solid #eee;padding:6px 4px;color:#666;">' +
                Object.keys(datos.porZona[z].socios).length + '</td></tr>';
    });
    cuerpo += '</table>';
  }

  // --- Muestra del detalle ---
  if (datos.detalle.length) {
    var tope = Math.min(CFG_INFORME_FALTAS.MAX_FILAS_EN_CUERPO, datos.detalle.length);
    cuerpo += '<h3 style="margin:22px 0 8px;font-size:15px;">Detalle — primeras ' + tope +
              ' de ' + datos.detalle.length + ' filas</h3>' +
              '<p style="font-size:13px;color:#666;margin:0 0 8px;">' +
              'El listado completo va en el archivo adjunto, ordenado del socio con más faltas al que menos.</p>' +
              '<table style="border-collapse:collapse;width:100%;font-size:13px;">' +
              '<tr><th align="left" style="border-bottom:2px solid #ddd;padding:5px 4px;">RUT</th>' +
              '<th align="left" style="border-bottom:2px solid #ddd;padding:5px 4px;">Nombre</th>' +
              '<th align="left" style="border-bottom:2px solid #ddd;padding:5px 4px;">Mes</th>' +
              '<th align="right" style="border-bottom:2px solid #ddd;padding:5px 4px;">Faltas</th></tr>';
    for (var d = 0; d < tope; d++) {
      var f = datos.detalle[d];
      var ps = datos.porSocio[cleanRut(f.rut)] || { faltas: 0, evaluados: 0 };
      cuerpo += '<tr><td style="border-bottom:1px solid #eee;padding:5px 4px;">' + f.rut + '</td>' +
                '<td style="border-bottom:1px solid #eee;padding:5px 4px;">' + f.nombre + '</td>' +
                '<td style="border-bottom:1px solid #eee;padding:5px 4px;">' + f.mesLegible + '</td>' +
                '<td align="right" style="border-bottom:1px solid #eee;padding:5px 4px;">' +
                ps.faltas + ' de ' + ps.evaluados + '</td></tr>';
    }
    cuerpo += '</table>';
  } else {
    cuerpo += '<p style="margin-top:20px;"><b>Ningún socio activo registra faltas en el período.</b></p>';
  }

  cuerpo += '<p style="margin-top:22px;font-size:13px;color:#666;">' +
            'La columna «Faltas» del detalle se lee como «faltas de meses evaluados»: ' +
            'un socio con «2 de 4» faltó dos veces en los cuatro meses que se le pudieron evaluar.</p>';

  return _construirHtmlCorreoEstilizado(
    'Informe de faltas a asamblea',
    cuerpo,
    detalles,
    C,
    false
  );
}

/** Versión en texto plano, para el cliente que no muestre HTML. */
function _textoPlanoInformeFaltas(datos) {
  var r = datos.resumen;
  var L = String.fromCharCode(10);
  return 'INFORME DE FALTAS A ASAMBLEA' + L + L +
         'Período: últimos ' + r.ventana + ' meses' + L +
         'Meses con datos: ' + r.mesesConDatos + ' de ' + r.mesesPedidos + L +
         'Socios activos: ' + r.sociosActivos + L +
         'Con al menos una falta: ' + r.sociosConFalta + L +
         'Sin ninguna falta: ' + r.sociosSinFalta + L +
         'Sin meses evaluables: ' + r.sociosSinEvaluar + L +
         'Total de faltas: ' + r.totalFaltas + L + L +
         'El detalle completo va en el archivo adjunto.' + L;
}

// ============================================================================
// DIAGNÓSTICO
// ============================================================================

/**
 * Genera y ENVIA el informe desde el editor, sin pasar por la interfaz.
 *
 * El boton de Registro de Asistencia resuelve la identidad por token de sesion;
 * desde el editor no hay sesion, asi que esta puerta cumple ese papel. Es una
 * funcion sin argumentos que manda un correo con los RUT y nombres de miles de
 * socios, o sea exactamente lo que no puede quedar suelto en un webapp de
 * acceso publico: por eso exige DOS cosas y borra una de ellas antes de actuar.
 *
 *   PERMITIR_INFORME_FALTAS = ENVIAR   (se borra sola en cada intento)
 *   RUT_MANTENCION          = un RUT ADMIN
 *   INFORME_FALTAS_MESES    = 3 | 6 | 12 | 24   (opcional, por defecto 6)
 *
 * Se borra la puerta ANTES de calcular: si la ejecucion se cae a la mitad, ya
 * quedo cerrada y nadie puede repetir la llamada sin volver a abrirla.
 */
function _enviarInformeFaltasDesdeEditor() {
  _ensureConfig();
  var props = PropertiesService.getScriptProperties();
  var modo = String(props.getProperty('PERMITIR_INFORME_FALTAS') || '').trim().toUpperCase();
  props.deleteProperty('PERMITIR_INFORME_FALTAS');

  if (modo !== 'ENVIAR') {
    Logger.log('Puerta cerrada. Crea la propiedad PERMITIR_INFORME_FALTAS con el valor ' +
               '"ENVIAR" y vuelve a ejecutar. (Se borra sola en cada intento.)');
    return;
  }

  var rutAdmin = String(props.getProperty('RUT_MANTENCION') || '').trim();
  if (!rutAdmin) {
    Logger.log('Falta la propiedad RUT_MANTENCION con un RUT ADMIN. Recuerda BORRARLA al terminar.');
    return;
  }

  // El rol se verifica igual que en la funcion publica: la puerta dice que
  // alguien con acceso al editor lo pidio, no que ese alguien sea ADMIN.
  var verificacion = verificarRolUsuario(rutAdmin, ['ADMIN']);
  if (!verificacion.autorizado) {
    Logger.log('RUT_MANTENCION no corresponde a un ADMIN. No se envio nada.');
    return;
  }

  var ventana = parseInt(props.getProperty('INFORME_FALTAS_MESES') || '6', 10);
  if (CFG_INFORME_FALTAS.VENTANAS.indexOf(ventana) === -1) ventana = 6;

  var datos = _calcularInformeFaltas(ventana);
  if (!datos.success) {
    Logger.log('No se pudo calcular: ' + datos.message);
    return;
  }

  var envio = _enviarInformeFaltas(datos, rutAdmin);
  var r = datos.resumen;

  var log = ['===== INFORME DE FALTAS (' + ventana + ' meses, ENVIADO) ====='];
  log.push(envio.success
    ? ('Enviado a: ' + envio.destinatarios.join(', '))
    : ('NO se pudo enviar: ' + envio.message));
  log.push('   Formato del adjunto: ' + (envio.formato || '(ninguno)'));
  if (envio.formato === 'csv') {
    log.push('   ⚠️ Salio en CSV, no en XLSX. Suele ser que falta reautorizar el');
    log.push('      proyecto tras agregar el scope script.external_request.');
  }
  log.push('   Meses con asambleas: ' + r.mesesConDatos + ' de ' + r.mesesPedidos);
  log.push('   Socios con al menos una falta: ' + r.sociosConFalta);
  log.push('   Total de faltas: ' + r.totalFaltas);
  log.push('   Filas en el adjunto: ' + datos.detalle.length);
  log.push('Recuerda BORRAR RUT_MANTENCION al terminar.');

  Logger.log(log.join(String.fromCharCode(10)));
  // Nada de vuelta: el resumen ya esta en el log y esto es invocable de forma
  // anonima. Lo que interesa revisar llego al correo.
}

/**
 * Calcula el informe SIN enviarlo y deja el resumen en el registro.
 *
 * Sin parámetros y sin devolver nada: una función así es invocable de forma
 * anónima desde la consola del navegador, y este informe nombra socios. El
 * resumen se queda dentro del proyecto.
 *
 * Usa `INFORME_FALTAS_MESES` para elegir la ventana; sin esa propiedad, 6.
 */
function _diagnosticarInformeFaltas() {
  _ensureConfig();
  var props = PropertiesService.getScriptProperties();
  var ventana = parseInt(props.getProperty('INFORME_FALTAS_MESES') || '6', 10);
  if (CFG_INFORME_FALTAS.VENTANAS.indexOf(ventana) === -1) ventana = 6;

  var t0 = new Date().getTime();
  var datos = _calcularInformeFaltas(ventana);
  var ms = new Date().getTime() - t0;

  var log = ['===== INFORME DE FALTAS (' + ventana + ' meses, sin enviar) ====='];

  if (!datos.success) {
    log.push('No se pudo calcular: ' + datos.message);
    Logger.log(log.join(String.fromCharCode(10)));
    return;
  }

  var r = datos.resumen;
  log.push('Calculado en ' + ms + ' ms.');
  log.push('   Meses pedidos: ' + r.mesesPedidos + ' — con datos: ' + r.mesesConDatos);
  log.push('   Socios activos: ' + r.sociosActivos);
  log.push('   Con al menos una falta: ' + r.sociosConFalta);
  log.push('   Sin ninguna falta: ' + r.sociosSinFalta);
  log.push('   Sin meses evaluables: ' + r.sociosSinEvaluar);
  log.push('   Total de faltas: ' + r.totalFaltas);
  log.push('   Filas de detalle: ' + datos.detalle.length);
  if (datos.tiempos) {
    log.push('--- TIEMPOS (ms) ---');
    Object.keys(datos.tiempos).forEach(function(k) { log.push('   ' + k + ': ' + datos.tiempos[k]); });
  }
  log.push('--- POR MES ---');
  datos.meses.forEach(function(m) {
    if (!datos.mesesConAsamblea[m]) { log.push('   ' + m + ': sin asambleas registradas'); return; }
    var pm = datos.porMes[m];
    log.push('   ' + m + ': ' + (pm ? pm.faltas + ' faltas de ' + pm.evaluados + ' evaluados' : '0 faltas'));
  });
  log.push('--- POR ZONA ---');
  Object.keys(datos.porZona).sort(function(a, b) {
    return datos.porZona[b].faltas - datos.porZona[a].faltas;
  }).forEach(function(z) {
    log.push('   ' + z + ': ' + datos.porZona[z].faltas + ' faltas, ' +
             Object.keys(datos.porZona[z].socios).length + ' socios');
  });

  Logger.log(log.join(String.fromCharCode(10)));
}
