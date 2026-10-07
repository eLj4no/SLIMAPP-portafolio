// ==========================================
// MODULO_QUESTESCENARIOS.GS — SLIM Quest · Escenarios
// ==========================================
//
// QUÉ RESUELVE
// ------------
// En las asambleas los dirigentes reciben las mismas preguntas una y otra vez:
// cómo se justifica una inasistencia, cómo se apela una multa, por qué no llegó
// el comprobante de un trámite. El socio no domina las herramientas del sistema,
// y sin dominarlas no ejerce bien su derecho.
//
// Un escenario es un simulacro guiado de un trámite: el socio recorre la
// situación paso a paso, decide, y el sistema le dice si acertó y por qué.
// No presenta nada real, no toca ningún dato sensible y no depende de que le
// haya pasado algo malo para poder practicar.
//
// POR QUÉ ESTO Y NO LOGROS POR USAR LOS MÓDULOS
// ---------------------------------------------
// Se evaluó premiar el uso real de préstamos, permisos médicos o denuncias y se
// descartó: son módulos que existen porque al socio le pasó algo malo, y un
// logro por usarlos premiaría el endeudamiento, la enfermedad o el conflicto —
// además de dejar el rastro de un evento sensible en la tabla de gamificación.
// El escenario mide exactamente lo que interesa (¿sabe hacerlo?) sin nada de
// eso, y funciona igual para quien nunca ha necesitado el trámite.
//
// CÓMO ESTÁ CONSTRUIDO
// --------------------
// Un escenario es una secuencia ORDENADA de pasos, y cada paso tiene la misma
// forma que una pregunta del quiz. Por eso reutiliza entero el motor de
// `Modulo gamificacion.js`: el servidor guarda la pauta bajo un `quizToken`,
// corrige paso a paso y el navegador nunca ve la respuesta antes de decidir.
// Un motor propio habría duplicado esa garantía, y una copia se rompe sola.
//
// La diferencia con el quiz: los pasos van en su orden (una situación tiene
// secuencia; una pregunta suelta no), se puede repetir cuantas veces se quiera,
// y el XP se paga una sola vez, la primera que se aprueba.
//
// ==========================================

var CFG_ESCENARIOS = {
  HOJA_BANCO:    'BANCO_ESCENARIOS',
  HOJA_INTENTOS: 'ESCENARIOS_INTENTOS',

  XP_PRIMERA_APROBACION: 150,

  // Fracción de pasos correctos para dar el escenario por aprobado. No se exige
  // perfección: el objetivo es que aprenda el procedimiento, no filtrar gente.
  // Con menos, puede repetirlo — y repetirlo es gratis y sin castigo.
  UMBRAL_APROBACION: 0.7,

  // Tope de pasos que se sirven de una vez, por si alguien carga un escenario
  // enorme. Un simulacro largo se abandona a la mitad.
  MAX_PASOS: 12,

  // Largo acordado para el contenido: 5 pasos. No es capricho, es lo que hace
  // que el umbral tenga sentido. Con 5 pasos hay que acertar 4 (80%), asi que
  // un error no reprueba; con 3, el 70% obliga a acertar los tres y el
  // escenario se vuelve todo o nada. `_diagnosticarEscenariosQuest()` avisa
  // cuando un escenario cargado se aparta de este largo.
  PASOS_RECOMENDADOS: 5
};

var _ENCABEZADOS_BANCO_ESCENARIOS = [
  'ESCENARIO_ID', 'NOMBRE', 'MODULO', 'DESCRIPCION', 'PASO',
  'SITUACION', 'OPCION_A', 'OPCION_B', 'OPCION_C', 'OPCION_D',
  'RESPUESTA', 'EXPLICACION', 'ACTIVA'
];

var _ENCABEZADOS_ESCENARIOS_INTENTOS = [
  'FECHA', 'RUT', 'REGION', 'ESCENARIO_ID', 'PASOS', 'CORRECTOS', 'APROBADO', 'PASOS_FALLADOS'
];

// ==========================================
// HOJAS (se crean y reparan solas)
// ==========================================

function _hojaEscenariosQuest_(nombre, encabezados) {
  var ss = getSpreadsheet('GAMIFICACION');
  if (!ss) return null;

  var hoja = ss.getSheetByName(nombre);
  if (!hoja) {
    hoja = ss.insertSheet(nombre);
    hoja.appendRow(encabezados);
    hoja.getRange(1, 1, 1, encabezados.length).setFontWeight('bold');
    hoja.setFrozenRows(1);
    Logger.log('✅ Hoja ' + nombre + ' creada.');
    return hoja;
  }

  var ancho = Math.max(hoja.getLastColumn(), 1);
  var cabecera = hoja.getRange(1, 1, 1, ancho).getDisplayValues()[0];
  var faltantes = encabezados.filter(function (h) { return cabecera.indexOf(h) === -1; });
  if (faltantes.length > 0) {
    hoja.getRange(1, ancho + 1, 1, faltantes.length).setValues([faltantes]).setFontWeight('bold');
    Logger.log('✅ ' + nombre + ' reparada, columnas agregadas: ' + faltantes.join(', '));
  }
  return hoja;
}

/** Índices 0-based resueltos por nombre de encabezado. */
function _indicesHojaEscenarios_(hoja, encabezados) {
  var cabecera = hoja.getRange(1, 1, 1, Math.max(hoja.getLastColumn(), 1)).getDisplayValues()[0];
  var idx = {};
  encabezados.forEach(function (h) { idx[h] = cabecera.indexOf(h); });
  return idx;
}

/**
 * Crea las dos hojas de escenarios. Se corre una vez desde el editor GAS —
 * aunque también se autocrean en el primer uso, tenerlas antes permite cargar
 * el contenido sin esperar a que alguien entre a la app.
 */
function _setupHojasEscenarios() {
  _ensureConfig();
  _hojaEscenariosQuest_(CFG_ESCENARIOS.HOJA_BANCO, _ENCABEZADOS_BANCO_ESCENARIOS);
  _hojaEscenariosQuest_(CFG_ESCENARIOS.HOJA_INTENTOS, _ENCABEZADOS_ESCENARIOS_INTENTOS);
  Logger.log('✅ Hojas de escenarios listas: ' + CFG_ESCENARIOS.HOJA_BANCO + ' y ' + CFG_ESCENARIOS.HOJA_INTENTOS + '.');
}

// ==========================================
// LECTURA DEL BANCO
// ==========================================

/**
 * Todos los escenarios activos, cada uno con sus pasos ya ordenados.
 *
 * El nombre, el módulo y la descripción se repiten en cada fila del escenario
 * (es lo cómodo de editar en una planilla) y se toman del primer paso. Un paso
 * incompleto se descarta en silencio, igual que en el banco de preguntas: una
 * fila a medio escribir no debe tumbar el módulo entero.
 */
function _leerEscenariosQuest_() {
  var hoja = _hojaEscenariosQuest_(CFG_ESCENARIOS.HOJA_BANCO, _ENCABEZADOS_BANCO_ESCENARIOS);
  if (!hoja) return [];

  var lastRow = hoja.getLastRow();
  if (lastRow < 2) return [];

  var idx  = _indicesHojaEscenarios_(hoja, _ENCABEZADOS_BANCO_ESCENARIOS);
  if (idx.ESCENARIO_ID < 0) return [];

  var data = hoja.getRange(2, 1, lastRow - 1, Math.max(hoja.getLastColumn(), 1)).getDisplayValues();
  var porId = {}, orden = [];

  for (var i = 0; i < data.length; i++) {
    var f = data[i];
    var activa = String(f[idx.ACTIVA] || '').toUpperCase().trim();
    if (activa !== 'TRUE' && activa !== 'VERDADERO' && activa !== '1' && activa !== 'SI' && activa !== 'SÍ') continue;

    var id = String(f[idx.ESCENARIO_ID] || '').trim();
    var situacion = String(f[idx.SITUACION] || '').trim();
    var correcta  = String(f[idx.RESPUESTA] || '').toUpperCase().trim();
    if (!id || !situacion || ['A', 'B', 'C', 'D'].indexOf(correcta) === -1) continue;

    if (!porId[id]) {
      porId[id] = {
        id: id,
        nombre:      String(f[idx.NOMBRE] || id).trim(),
        modulo:      String(f[idx.MODULO] || 'GENERAL').toUpperCase().trim(),
        descripcion: String(f[idx.DESCRIPCION] || '').trim(),
        pasos: []
      };
      orden.push(id);
    }

    porId[id].pasos.push({
      id:          id + '#' + (String(f[idx.PASO] || '').trim() || porId[id].pasos.length + 1),
      orden:       parseInt(f[idx.PASO], 10) || (porId[id].pasos.length + 1),
      nivel:       'ESCENARIO',
      categoria:   porId[id].modulo,
      pregunta:    situacion,
      opciones:    { A: f[idx.OPCION_A], B: f[idx.OPCION_B], C: f[idx.OPCION_C], D: f[idx.OPCION_D] },
      respuesta:   correcta,
      explicacion: String(f[idx.EXPLICACION] || ''),
      fuente:      '',
      xp:          0   // el XP del escenario se paga por completarlo, no por paso
    });
  }

  return orden.map(function (id) {
    var e = porId[id];
    e.pasos.sort(function (a, b) { return a.orden - b.orden; });
    if (e.pasos.length > CFG_ESCENARIOS.MAX_PASOS) e.pasos = e.pasos.slice(0, CFG_ESCENARIOS.MAX_PASOS);
    return e;
  }).filter(function (e) { return e.pasos.length > 0; });
}

function _escenarioPorIdQuest_(id) {
  var todos = _leerEscenariosQuest_();
  for (var i = 0; i < todos.length; i++) if (todos[i].id === String(id || '').trim()) return todos[i];
  return null;
}

/**
 * Cuántos escenarios activos hay. Lo consume el catálogo de logros para el
 * logro de "todos los escenarios", que sin este total sería inalcanzable o
 * trivial según cuántos haya cargados.
 */
function _totalEscenariosQuest_() {
  // Se cachea el CONTEO, no el contenido. El panel de SLIM Quest lo consulta en
  // cada carga y sin cache eso seria una lectura extra de hoja por visita; los
  // pasos, en cambio, se leen siempre frescos, para que una correccion del ADMIN
  // se vea en el simulacro siguiente.
  var clave = 'QUEST_ESC_TOTAL';
  try {
    var guardado = CacheService.getScriptCache().get(clave);
    if (guardado !== null) return parseInt(guardado, 10) || 0;
  } catch (e) {}
  try {
    var total = _leerEscenariosQuest_().length;
    try { CacheService.getScriptCache().put(clave, String(total), 300); } catch (e) {}
    return total;
  } catch (e) { return 0; }
}

// ==========================================
// API PARA EL SOCIO
// ==========================================

/**
 * Los escenarios disponibles y cuáles ya aprobó el socio.
 */
function questListarEscenarios(sessionToken) {
  _ensureConfig();
  try {
    var rutLimpio = _rutDeSesionQuest_(sessionToken);
    if (!rutLimpio) return { success: false, sesionExpirada: true, message: MSG_SESION_QUEST };

    var aux = _leerEstadoQuest_(rutLimpio);
    var completados = aux.escCompletados || [];

    var lista = _leerEscenariosQuest_().map(function (e) {
      return {
        id: e.id, nombre: e.nombre, modulo: e.modulo, descripcion: e.descripcion,
        pasos: e.pasos.length,
        completado: completados.indexOf(e.id) !== -1,
        xp: CFG_ESCENARIOS.XP_PRIMERA_APROBACION
      };
    });

    return {
      success: true,
      escenarios: lista,
      completados: completados.length,
      total: lista.length,
      xpPorEscenario: CFG_ESCENARIOS.XP_PRIMERA_APROBACION,
      umbral: Math.round(CFG_ESCENARIOS.UMBRAL_APROBACION * 100)
    };

  } catch (e) {
    Logger.log('❌ questListarEscenarios: ' + e.toString());
    return { success: false, message: 'Ocurrió un error interno. Por favor, intente más tarde o contacte al administrador.' };
  }
}

/**
 * Los pasos de un escenario, en su orden, listos para el motor del quiz.
 *
 * A diferencia del quiz, el orden NO se baraja: una situación tiene secuencia y
 * mezclarla la vuelve incomprensible. Las alternativas de cada paso sí se
 * barajan, igual que en el quiz.
 */
function _seleccionarPasosEscenario_(escenarioId) {
  var esc = _escenarioPorIdQuest_(escenarioId);
  if (!esc) return { ok: false, message: 'Ese escenario no está disponible.' };
  return { ok: true, escenario: esc, preguntas: esc.pasos };
}

// ==========================================
// REGISTRO DE INTENTOS (insumo del informe a dirigentes)
// ==========================================

/**
 * Deja constancia de un intento. Es el insumo del informe que le dice al
 * dirigente qué trámite genera más errores en su zona.
 *
 * Guarda el RUT porque el objetivo declarado es poder acercarse a quien tiene
 * dificultades y ofrecerle ayuda. Lo que NO guarda es nada del socio más allá
 * de su zona, y el informe que lo consume sale agregado. Nunca se usa para
 * penalizar: un escenario fallado no resta XP, no quita logros y no aparece en
 * ninguna clasificación.
 *
 * No bloquea nunca: el escenario ya se completó cuando esto corre.
 */
function _registrarIntentoEscenario_(rutLimpio, escenarioId, revision, aprobado) {
  try {
    var hoja = _hojaEscenariosQuest_(CFG_ESCENARIOS.HOJA_INTENTOS, _ENCABEZADOS_ESCENARIOS_INTENTOS);
    if (!hoja) return;

    var region = '';
    try {
      var u = obtenerUsuarioPorRut(rutLimpio);
      if (u.encontrado) region = String(u.region || '').trim();
    } catch (e) {}

    var correctos = revision.filter(function (r) { return r.esCorrecta; }).length;
    var fallados  = revision
      .map(function (r, i) { return r.esCorrecta ? null : (i + 1); })
      .filter(function (n) { return n !== null; });

    var idx = _indicesHojaEscenarios_(hoja, _ENCABEZADOS_ESCENARIOS_INTENTOS);
    var ancho = Math.max(hoja.getLastColumn(), _ENCABEZADOS_ESCENARIOS_INTENTOS.length);
    var fila = [];
    for (var i = 0; i < ancho; i++) fila.push('');
    var poner = function (k, v) { if (idx[k] >= 0) fila[idx[k]] = v; };

    poner('FECHA',          _ahoraQuest_());
    poner('RUT',            rutLimpio);
    poner('REGION',         region);
    poner('ESCENARIO_ID',   escenarioId);
    poner('PASOS',          revision.length);
    poner('CORRECTOS',      correctos);
    poner('APROBADO',       aprobado ? 'SI' : 'NO');
    poner('PASOS_FALLADOS', fallados.join(','));

    hoja.appendRow(fila);
  } catch (e) {
    Logger.log('⚠️ _registrarIntentoEscenario_ (no bloqueante): ' + e.toString());
  }
}

// ==========================================
// INFORME PARA DIRIGENTES
// ==========================================
//
// Responde la pregunta que hoy se contesta a mano en cada asamblea: qué
// trámite es el que la gente no sabe usar.
//
// El alcance por rol copia el del consolidado de participación, y por el mismo
// motivo: un DIRIGENTE ve SOLO su zona. Un tablero que permite comparar zonas
// convierte una herramienta de apoyo en una de control.
//
// NUNCA se informa "quién falló". Se informa qué escenario y qué paso concentran
// los errores, que es lo accionable: si el 60% se equivoca en el plazo para
// justificar, el problema es la comunicación del plazo, no esos socios.

function questInformeEscenarios(sessionToken, zonaPedida) {
  _ensureConfig();
  try {
    var rutLimpio = _rutDeSesionQuest_(sessionToken);
    if (!rutLimpio) return { success: false, sesionExpirada: true, message: MSG_SESION_QUEST };

    var permiso = verificarRolUsuario(rutLimpio, ['DIRIGENTE', 'DIRECTORIO', 'ADMIN']);
    if (!permiso.autorizado) return { success: false, message: 'No autorizado.' };

    var verTodo = (permiso.rol === 'ADMIN' || permiso.rol === 'DIRECTORIO');
    var zonaPropia = '';
    try {
      var u = obtenerUsuarioPorRut(rutLimpio);
      if (u.encontrado) zonaPropia = String(u.region || '').trim();
    } catch (e) {}

    // Un DIRIGENTE no elige zona: se le ignora el parámetro, no se le rechaza
    // la consulta.
    var zona = verTodo ? String(zonaPedida || '').trim() : zonaPropia;
    var zonaNorm = _normalizarRegionParaComparar(zona);

    var hoja = _hojaEscenariosQuest_(CFG_ESCENARIOS.HOJA_INTENTOS, _ENCABEZADOS_ESCENARIOS_INTENTOS);
    if (!hoja) return { success: false, message: 'Aún no hay registro de escenarios.' };

    var lastRow = hoja.getLastRow();
    var nombres = {};
    _leerEscenariosQuest_().forEach(function (e) { nombres[e.id] = { nombre: e.nombre, modulo: e.modulo, pasos: e.pasos.length }; });

    var porEscenario = {}, sociosVistos = {}, totalIntentos = 0;

    if (lastRow >= 2) {
      var idx  = _indicesHojaEscenarios_(hoja, _ENCABEZADOS_ESCENARIOS_INTENTOS);
      var data = hoja.getRange(2, 1, lastRow - 1, Math.max(hoja.getLastColumn(), 1)).getDisplayValues();

      for (var i = 0; i < data.length; i++) {
        var f = data[i];
        if (zonaNorm && _normalizarRegionParaComparar(f[idx.REGION]) !== zonaNorm) continue;

        var id = String(f[idx.ESCENARIO_ID] || '').trim();
        if (!id) continue;

        if (!porEscenario[id]) {
          porEscenario[id] = {
            id: id,
            nombre: (nombres[id] || {}).nombre || id,
            modulo: (nombres[id] || {}).modulo || '—',
            intentos: 0, aprobados: 0, fallosPorPaso: {}
          };
        }
        var e = porEscenario[id];
        e.intentos++;
        totalIntentos++;
        if (String(f[idx.APROBADO] || '').toUpperCase() === 'SI') e.aprobados++;

        String(f[idx.PASOS_FALLADOS] || '').split(',').forEach(function (n) {
          n = n.trim();
          if (n) e.fallosPorPaso[n] = (e.fallosPorPaso[n] || 0) + 1;
        });

        var rut = cleanRut(f[idx.RUT]);
        if (rut) sociosVistos[rut] = true;
      }
    }

    var lista = Object.keys(porEscenario).map(function (id) {
      var e = porEscenario[id];
      var pasoPeor = '', peorFallos = 0;
      Object.keys(e.fallosPorPaso).forEach(function (p) {
        if (e.fallosPorPaso[p] > peorFallos) { peorFallos = e.fallosPorPaso[p]; pasoPeor = p; }
      });
      return {
        id: e.id, nombre: e.nombre, modulo: e.modulo,
        intentos: e.intentos, aprobados: e.aprobados,
        tasaAprobacion: e.intentos ? Math.round((e.aprobados / e.intentos) * 100) : 0,
        pasoMasFallado: pasoPeor ? { paso: pasoPeor, fallos: peorFallos } : null
      };
    });

    // Peor tasa primero: lo que menos se aprueba es lo que hay que explicar.
    lista.sort(function (a, b) { return a.tasaAprobacion - b.tasaAprobacion; });

    return {
      success: true,
      rol: permiso.rol,
      zona: zona || 'Todas las zonas',
      puedeElegirZona: verTodo,
      escenarios: lista,
      totalIntentos: totalIntentos,
      sociosDistintos: Object.keys(sociosVistos).length
    };

  } catch (e) {
    Logger.log('❌ questInformeEscenarios: ' + e.toString());
    return { success: false, message: 'Ocurrió un error interno. Por favor, intente más tarde o contacte al administrador.' };
  }
}

/**
 * Socios que no pueden recibir los comprobantes de sus trámites porque su
 * correo no sirve o no está.
 *
 * Es la fricción más concreta y más repetida que reportan los dirigentes: gente
 * que pregunta por qué no le llegó el comprobante, cuando el sistema nunca tuvo
 * dónde mandárselo. No es un logro negativo ni una lista de infractores — es una
 * lista para llamar por teléfono.
 *
 * Devuelve nombre y contacto porque el objetivo es justamente poder contactarlos.
 * Por eso mismo exige rol y recorta por zona igual que el informe anterior.
 */
function questInformeCorreosFaltantes(sessionToken, zonaPedida) {
  _ensureConfig();
  try {
    var rutLimpio = _rutDeSesionQuest_(sessionToken);
    if (!rutLimpio) return { success: false, sesionExpirada: true, message: MSG_SESION_QUEST };

    var permiso = verificarRolUsuario(rutLimpio, ['DIRIGENTE', 'DIRECTORIO', 'ADMIN']);
    if (!permiso.autorizado) return { success: false, message: 'No autorizado.' };

    var verTodo = (permiso.rol === 'ADMIN' || permiso.rol === 'DIRECTORIO');
    var zonaPropia = '';
    try {
      var u = obtenerUsuarioPorRut(rutLimpio);
      if (u.encontrado) zonaPropia = String(u.region || '').trim();
    } catch (e) {}

    var zona = verTodo ? String(zonaPedida || '').trim() : zonaPropia;
    var zonaNorm = _normalizarRegionParaComparar(zona);

    var sheet = getSheet('USUARIOS', 'USUARIOS');
    if (!sheet) return { success: false, message: 'No se pudo leer la base de socios.' };
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return { success: true, socios: [], total: 0, zona: zona };

    var COL = CONFIG.COLUMNAS.USUARIOS;
    var ancho = Math.max(COL.CONTACTO, COL.ESTADO, COL.REGION, COL.CORREO, COL.NOMBRE) + 1;
    var data = sheet.getRange(2, 1, lastRow - 1, ancho).getDisplayValues();

    var lista = [];
    for (var i = 0; i < data.length; i++) {
      if (String(data[i][COL.ESTADO] || '').toUpperCase().trim() !== 'ACTIVO') continue;
      if (zonaNorm && _normalizarRegionParaComparar(data[i][COL.REGION]) !== zonaNorm) continue;
      if (esCorreoValidoEstricto(String(data[i][COL.CORREO] || '').trim())) continue;

      lista.push({
        rut:      formatRutDisplay(cleanRut(data[i][COL.RUT])),
        nombre:   data[i][COL.NOMBRE],
        zona:     data[i][COL.REGION],
        contacto: data[i][COL.CONTACTO] || '',
        correo:   String(data[i][COL.CORREO] || '').trim()   // vacío o inutilizable; útil para saber si hay que corregir o cargar
      });
    }

    lista.sort(function (a, b) { return String(a.nombre).localeCompare(String(b.nombre)); });

    return { success: true, rol: permiso.rol, zona: zona || 'Todas las zonas',
             puedeElegirZona: verTodo, socios: lista, total: lista.length };

  } catch (e) {
    Logger.log('❌ questInformeCorreosFaltantes: ' + e.toString());
    return { success: false, message: 'Ocurrió un error interno. Por favor, intente más tarde o contacte al administrador.' };
  }
}

// ==========================================
// ESCENARIOS DE PRUEBA
// ==========================================
//
// Tres escenarios para recorrer el flujo completo antes de que exista el
// contenido real: la corrección paso a paso, el repaso final, el XP de la
// primera aprobación, el logro y la fila que alimenta el informe del dirigente.
//
// ⚠️ `BANCO_ESCENARIOS` vive en la misma planilla en DEV y en PRODUCCIÓN. Estas
// filas se ven en los dos entornos, así que llevan el prefijo PRUEBA- y existe
// `_borrarEscenariosDePrueba()` para sacarlas. Bórralas antes de cargar el
// contenido definitivo.
//
// El contenido es correcto, no relleno: sale del protocolo de participación y
// del propio banco de preguntas. Si algún dato cambió, corrígelo aquí antes de
// usarlo para enseñar.
var _ESCENARIOS_DE_PRUEBA = [
  {
    id: 'PRUEBA-JUST-01', nombre: 'Justificar una inasistencia', modulo: 'JUSTIFICACIONES',
    descripcion: 'No pudiste ir a la asamblea. Qué hacer, en qué plazo y qué pasa después.',
    pasos: [
      { situacion: 'El sábado hubo asamblea y no pudiste asistir. Hoy es lunes y recién te enteras. ¿Todavía estás a tiempo de justificar?',
        a: 'No: la justificación solo se puede presentar antes de la actividad.',
        b: 'Sí: hay 5 días antes y 5 días después de la actividad, o sea 10 días en total.',
        c: 'Sí, pero solo si avisas al día siguiente.',
        d: 'Sí, tienes hasta que termine el mes.',
        correcta: 'B',
        explicacion: 'El plazo es de 5 días antes y 5 días después del evento: 10 días en total para hacer la gestión. Enterarte el lunes de una actividad del sábado te deja todavía dentro del plazo.' },
      { situacion: 'Ese sábado estabas trabajando. ¿Cuál de estas situaciones sirve como motivo para justificar?',
        a: 'Estabas cumpliendo turno en ISS.',
        b: 'Estabas haciendo un trabajo particular para otra empresa.',
        c: 'Habías planificado un viaje familiar.',
        d: 'Se te olvidó que había asamblea.',
        correcta: 'A',
        explicacion: 'Solo son válidos los trabajos realizados para ISS. Un trabajo particular o para otra empresa no es motivo de justificación, aunque sea remunerado.' },
      { situacion: 'Ya sabes que tu motivo sirve y que estás en plazo. ¿Por dónde presentas la justificación?',
        a: 'Por mensaje de WhatsApp al presidente del sindicato.',
        b: 'Avisándole de palabra a cualquier dirigente en la próxima reunión.',
        c: 'Por los medios digitales que el sindicato dispone, es decir esta misma aplicación.',
        d: 'No hace falta presentarla: basta con avisar que estabas trabajando.',
        correcta: 'C',
        explicacion: 'Las justificaciones se presentan por los medios digitales del sindicato. Un aviso verbal o por WhatsApp no queda registrado, y lo que no queda registrado no se puede revisar ni acoger.' },
      { situacion: 'Presentaste la justificación y en tu historial aparece como "En revisión". ¿Qué significa?',
        a: 'Que ya quedó acogida y no hay nada más que hacer.',
        b: 'Que fue rechazada y hay que presentarla de nuevo.',
        c: 'Que se recibió y todavía está siendo revisada: aún no hay resultado.',
        d: 'Que se venció el plazo.',
        correcta: 'C',
        explicacion: 'Presentar no es lo mismo que ser acogido. "En revisión" quiere decir que tu justificación llegó y está siendo evaluada; el resultado te llega después por correo.' },
      { situacion: 'Mientras tu justificación sigue en revisión, ¿ese mes ya cuenta como cumplimiento tuyo?',
        a: 'Sí, desde el momento en que la presentas.',
        b: 'Todavía no: cuenta cuando la justificación queda acogida.',
        c: 'No, y ya no podrá contar nunca.',
        d: 'Depende de cuántos socios hayan asistido.',
        correcta: 'B',
        explicacion: 'Una justificación en revisión todavía puede terminar rechazada, así que no se cuenta a favor mientras no se resuelva. Al quedar acogida, ese mes pasa a contar como cumplimiento.' }
    ]
  },
  {
    id: 'PRUEBA-APEL-01', nombre: 'Apelar un descuento', modulo: 'APELACIONES',
    descripcion: 'Te descontaron por una inasistencia que sí justificaste.',
    pasos: [
      { situacion: 'Revisas tu liquidación y aparece un descuento por inasistencia a una asamblea que justificaste a tiempo. ¿Qué corresponde hacer?',
        a: 'Presentar una apelación desde la aplicación, adjuntando los respaldos.',
        b: 'Esperar al mes siguiente a ver si se corrige solo.',
        c: 'Descontarlo de la próxima cuota sindical.',
        d: 'Reclamar directamente en la oficina de la empresa.',
        correcta: 'A',
        explicacion: 'La apelación es el camino formal y queda registrada. Reclamar en la empresa no corresponde: el descuento lo revisa el sindicato, que es quien tiene tu justificación.' },
      { situacion: 'Al presentar la apelación te piden respaldos. ¿Qué documentos necesitas tener a mano?',
        a: 'Solamente tu cédula de identidad.',
        b: 'El comprobante del descuento y tu liquidación de sueldo.',
        c: 'Una carta escrita a mano explicando lo ocurrido.',
        d: 'Ningún documento: basta con describir el problema.',
        correcta: 'B',
        explicacion: 'Se adjuntan el comprobante del descuento y la liquidación. Son los dos documentos que permiten verificar que el descuento existió y por cuánto fue.' },
      { situacion: 'Ya presentaste la apelación. ¿Dónde revisas en qué estado va?',
        a: 'Hay que preguntarle a un dirigente cada vez.',
        b: 'En tu historial dentro de la aplicación, donde aparece su estado.',
        c: 'Llega solo cuando termina el año.',
        d: 'No se puede consultar el estado.',
        correcta: 'B',
        explicacion: 'Tu historial en la aplicación muestra el estado de cada trámite que has presentado. Además recibes un correo cuando el estado cambia, si tienes tu correo registrado.' },
      { situacion: 'Tu apelación fue acogida. ¿Cómo recibes el comprobante de la devolución?',
        a: 'Tienes que subirlo tú a la aplicación.',
        b: 'Se te entrega en papel en la próxima asamblea.',
        c: 'El sindicato lo gestiona y te da acceso al documento cuando esté listo.',
        d: 'No se emite comprobante de devolución.',
        correcta: 'C',
        explicacion: 'La devolución la gestiona el sindicato y el comprobante se te comparte cuando está disponible. No es un documento que el socio tenga que subir.' },
      { situacion: 'Con la apelación acogida, ¿cómo queda ese mes en tu registro de participación?',
        a: 'Queda como falta de todas formas.',
        b: 'Queda como cumplimiento: una apelación acogida cuenta igual que haber asistido o justificado.',
        c: 'Queda sin registro.',
        d: 'Se traspasa al mes siguiente.',
        correcta: 'B',
        explicacion: 'Hay tres formas de cumplir con una actividad: asistir, justificar dentro de plazo o que se acoja tu apelación. Las tres dejan el mes en regla.' }
    ]
  },
  {
    id: 'PRUEBA-CORREO-01', nombre: 'No me llegó el comprobante', modulo: 'GESTIONES',
    descripcion: 'Hiciste un trámite y nunca recibiste el correo de confirmación.',
    pasos: [
      { situacion: 'Presentaste un trámite hace tres días y no te ha llegado ningún correo. ¿Qué es lo primero que conviene revisar?',
        a: 'Si tienes un correo registrado en tus datos de socio.',
        b: 'Si el sindicato está en horario de atención.',
        c: 'Si tu teléfono tiene señal.',
        d: 'Si el trámite fue rechazado.',
        correcta: 'A',
        explicacion: 'La causa más frecuente es simple: el sistema no tiene una dirección a la cual escribir. Sin correo registrado, el trámite se guarda igual, pero el aviso no puede salir.' },
      { situacion: 'Efectivamente no tenías correo registrado. ¿Dónde lo registras?',
        a: 'Hay que pedirlo por escrito al directorio.',
        b: 'En la sección "Mis Datos" de esta aplicación.',
        c: 'Se registra automáticamente al iniciar sesión.',
        d: 'Lo carga la empresa junto con el contrato.',
        correcta: 'B',
        explicacion: 'Lo registras tú mismo en "Mis Datos", y desde ese momento los avisos de tus trámites empiezan a llegarte.' },
      { situacion: 'Registras tu correo. ¿Qué pasa con los documentos de los trámites que ya habías presentado?',
        a: 'Se pierden: hay que volver a presentarlos.',
        b: 'Quedan accesibles solo para el directorio.',
        c: 'Se traspasan a tu nueva cuenta dentro de la media hora siguiente.',
        d: 'Hay que pedir el acceso uno por uno.',
        correcta: 'C',
        explicacion: 'El sistema traspasa el acceso a tus documentos a la dirección nueva dentro de los 30 minutos siguientes, y la anterior deja de tenerlo. No tienes que pedir nada ni volver a presentar ningún trámite.' },
      { situacion: 'Hay trámites que ni siquiera te dejan empezar sin correo registrado. ¿Cuáles?',
        a: 'Ninguno: el correo es siempre opcional.',
        b: 'Los permisos médicos y los trámites a la empresa.',
        c: 'Solo los préstamos.',
        d: 'Todos, sin excepción.',
        correcta: 'B',
        explicacion: 'Los permisos médicos y los trámites a la empresa exigen correo registrado antes de empezar, porque son gestiones donde la respuesta llega por esa vía y sin dirección quedarías sin enterarte.' },
      { situacion: 'Además del correo, ¿qué otro dato conviene mantener al día en tu ficha?',
        a: 'El teléfono de contacto.',
        b: 'La marca de tu teléfono.',
        c: 'Tu dirección de correo anterior.',
        d: 'Nada más: con el correo basta.',
        correcta: 'A',
        explicacion: 'El teléfono es la vía más rápida cuando hay algo urgente que avisarte. Junto con los datos bancarios y las tallas, es parte de lo que hace que todo lo demás funcione sin trámites extra.' }
    ]
  }
];

/**
 * Carga los escenarios de prueba. Se corre a mano desde el editor GAS.
 *
 * Reemplaza: primero saca las filas PRUEBA- que hubiera y despues inserta las
 * actuales. Asi correrla otra vez actualiza el contenido en vez de dejar
 * conviviendo una version vieja con una nueva.
 */
function _cargarEscenariosDePrueba() {
  _ensureConfig();
  try {
    _borrarEscenariosDePrueba();

    var hoja = _hojaEscenariosQuest_(CFG_ESCENARIOS.HOJA_BANCO, _ENCABEZADOS_BANCO_ESCENARIOS);
    if (!hoja) { Logger.log('❌ No se pudo abrir ' + CFG_ESCENARIOS.HOJA_BANCO); return; }

    var idx   = _indicesHojaEscenarios_(hoja, _ENCABEZADOS_BANCO_ESCENARIOS);
    var ancho = Math.max(hoja.getLastColumn(), _ENCABEZADOS_BANCO_ESCENARIOS.length);
    var filas = [];

    _ESCENARIOS_DE_PRUEBA.forEach(function (esc) {
      esc.pasos.forEach(function (p, i) {
        var fila = [];
        for (var c = 0; c < ancho; c++) fila.push('');
        var poner = function (k, v) { if (idx[k] >= 0) fila[idx[k]] = v; };
        poner('ESCENARIO_ID', esc.id);
        poner('NOMBRE',       esc.nombre);
        poner('MODULO',       esc.modulo);
        poner('DESCRIPCION',  esc.descripcion);
        poner('PASO',         i + 1);
        poner('SITUACION',    p.situacion);
        poner('OPCION_A',     p.a);
        poner('OPCION_B',     p.b);
        poner('OPCION_C',     p.c);
        poner('OPCION_D',     p.d);
        poner('RESPUESTA',    p.correcta);
        poner('EXPLICACION',  p.explicacion);
        poner('ACTIVA',       'TRUE');
        filas.push(fila);
      });
    });

    if (filas.length > 0) hoja.getRange(hoja.getLastRow() + 1, 1, filas.length, ancho).setValues(filas);

    Logger.log('✅ Escenarios de prueba cargados: ' + _ESCENARIOS_DE_PRUEBA.length +
               ' escenarios, ' + filas.length + ' pasos. Recuerda correr ' +
               '_borrarEscenariosDePrueba() antes de cargar el contenido real.');
  } catch (e) {
    Logger.log('❌ _cargarEscenariosDePrueba: ' + e.toString());
  }
}

/** Saca del banco todas las filas cuyo ESCENARIO_ID empieza con PRUEBA-. */
function _borrarEscenariosDePrueba() {
  _ensureConfig();
  try {
    var hoja = _hojaEscenariosQuest_(CFG_ESCENARIOS.HOJA_BANCO, _ENCABEZADOS_BANCO_ESCENARIOS);
    if (!hoja) return;

    var idx = _indicesHojaEscenarios_(hoja, _ENCABEZADOS_BANCO_ESCENARIOS);
    var lastRow = hoja.getLastRow();
    if (lastRow < 2 || idx.ESCENARIO_ID < 0) { Logger.log('ℹ️ Nada que borrar.'); return; }

    var ids = hoja.getRange(2, idx.ESCENARIO_ID + 1, lastRow - 1, 1).getDisplayValues();
    var borradas = 0;
    // De abajo hacia arriba: borrar de arriba corre las filas siguientes y el
    // recorrido se saltaria una por cada eliminacion.
    for (var i = ids.length - 1; i >= 0; i--) {
      if (String(ids[i][0] || '').trim().indexOf('PRUEBA-') === 0) {
        hoja.deleteRow(i + 2);
        borradas++;
      }
    }
    Logger.log('✅ Filas de prueba eliminadas: ' + borradas + '.');
  } catch (e) {
    Logger.log('❌ _borrarEscenariosDePrueba: ' + e.toString());
  }
}

// ==========================================
// DIAGNÓSTICO
// ==========================================

function _diagnosticarEscenariosQuest() {
  _ensureConfig();
  var log = ['=== DIAGNOSTICO ESCENARIOS ==='];
  try {
    var escenarios = _leerEscenariosQuest_();
    log.push('Escenarios activos: ' + escenarios.length);
    escenarios.forEach(function (e) {
      log.push('   [' + e.id + '] ' + e.nombre + ' — módulo ' + e.modulo + ' — ' + e.pasos.length + ' pasos');
      var sinExpl = e.pasos.filter(function (p) { return !p.explicacion.trim(); }).length;
      if (sinExpl) log.push('      ⚠️ ' + sinExpl + ' pasos sin explicación (el socio no aprende del error)');
      if (e.pasos.length !== CFG_ESCENARIOS.PASOS_RECOMENDADOS) {
        var necesarios = Math.ceil(e.pasos.length * CFG_ESCENARIOS.UMBRAL_APROBACION);
        log.push('      ⚠️ tiene ' + e.pasos.length + ' pasos y lo acordado son ' +
                 CFG_ESCENARIOS.PASOS_RECOMENDADOS + ': hay que acertar ' + necesarios +
                 ' de ' + e.pasos.length + ' para aprobar');
      }
      var letras = {};
      e.pasos.forEach(function (p) { letras[p.respuesta] = (letras[p.respuesta] || 0) + 1; });
      log.push('      letra correcta en la planilla: ' + JSON.stringify(letras) + ' (se baraja al servir)');
    });
    if (escenarios.length === 0) {
      log.push('   La hoja ' + CFG_ESCENARIOS.HOJA_BANCO + ' está vacía o sin filas ACTIVA=TRUE.');
      log.push('   Corre _setupHojasEscenarios() y carga el contenido.');
    }

    var hojaInt = _hojaEscenariosQuest_(CFG_ESCENARIOS.HOJA_INTENTOS, _ENCABEZADOS_ESCENARIOS_INTENTOS);
    log.push('Intentos registrados: ' + (hojaInt ? Math.max(hojaInt.getLastRow() - 1, 0) : 'hoja no disponible'));
  } catch (e) {
    log.push('❌ ' + e.toString());
  }
  Logger.log(log.join('\n'));
}
