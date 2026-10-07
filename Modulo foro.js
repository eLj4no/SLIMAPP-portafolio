// ============================================================
// MÓDULO FORO — foro de la comunidad
// ============================================================
// Los socios abren temas y conversan entre ellos. Todo vive en la planilla
// propia BD_FORO (CONFIG.SPREADSHEETS.FORO), con cinco pestañas:
//
//   CATEGORIAS · TEMAS · RESPUESTAS · REPORTES · REGLAS_ACEPTADAS
//
// Columnas en CONFIG.COLUMNAS.FORO_* y nombres de pestaña en CONFIG.HOJAS.FORO_*.
// Configuración: _configurarForo() en config_local.js, una vez en DEV y otra
// en PROD. Esa misma función prepara la planilla (_prepararHojasForo_).
//
// Reglas del módulo (ver .claude/rules/foro.md):
//   - Todo endpoint recibe el token de sesión, nunca un RUT.
//   - Nada se borra: el autor o un moderador cambian ESTADO.
//   - Las filas se buscan por su ID, nunca por número de fila.
//   - Toda escritura pasa por _foroEscribirFila_: celdas en texto plano ('@')
//     y apóstrofo delante de lo que empieza con "=", para que "=IMPORTXML(...)"
//     o "1/2" no se conviertan en fórmula o fecha. El cliente pinta con textContent.
//   - Las filas se agregan siempre al final y en orden, bajo candado. Los
//     cupos diarios leen la hoja desde abajo: no ordenar las pestañas a mano.
// ============================================================

var FORO_VERSION_REGLAS = 1;   // subirla obliga a todos a aceptar de nuevo

var FORO_LARGO = {
  TITULO: 100, TITULO_MIN: 5, TEMA: 3000, RESPUESTA: 2000,
  MOTIVO: 200, DETALLE_REPORTE: 300,
  CATEGORIA_NOMBRE: 40, CATEGORIA_DESCRIPCION: 150
};

var FORO_TEMAS_POR_PAGINA      = 20;
var FORO_RESPUESTAS_POR_PAGINA = 30;

// Límites por socio (decisión del usuario, 26/09/2026). Los moderadores
// responden sin cupo ni espera; el límite de temas sí les aplica, salvo a
// ADMIN, que no tiene ningún límite de cantidad (ver _foroCupos_). La espera
// es POR TEMA: tras responder en uno, se puede responder en otro al tiro.
// Esto no es un chat: una hora da tiempo para leer y pensar la respuesta.
var FORO_LIMITE_TEMAS_DIA      = 1;
var FORO_LIMITE_RESPUESTAS_DIA = 10;
var FORO_ESPERA_RESPUESTA_MIN  = 60;

var FORO_MINUTOS_EDICION       = 15;
// Un tema vive un mes calendario desde que se abrió; después pasa solo a
// "Archivados": se sigue leyendo, pero ya no recibe respuestas. Lo fijado por
// la directiva no se archiva mientras siga fijado.
var FORO_MESES_VIGENCIA        = 1;
var FORO_REPORTES_AUTO_OCULTAR = 3;

var FORO_MODERADORES        = ['DIRIGENTE', 'DIRECTORIO', 'ADMIN'];
var FORO_MODERADO_AUTOMATICO = 'AUTOMATICO';
var FORO_MOTIVO_AUTOMATICO  = 'En revisión por reportes';

var FORO_MOTIVOS_REPORTE = [
  'Ofensivo o insultos',
  'Datos personales de otra persona',
  'Spam o publicidad',
  'Información falsa',
  'Otro'
];

var FORO_ESTADO = { VISIBLE: 'VISIBLE', OCULTO: 'OCULTO', ELIMINADO: 'ELIMINADO_AUTOR' };
var FORO_ESTADO_REPORTE = { PENDIENTE: 'PENDIENTE', RESUELTO: 'RESUELTO', DESCARTADO: 'DESCARTADO' };

var FORO_TABLAS = ['FORO_CATEGORIAS', 'FORO_TEMAS', 'FORO_RESPUESTAS', 'FORO_REPORTES', 'FORO_REGLAS'];

var FORO_CACHE_VERSION = 'FORO_VER';
var FORO_CACHE_SEG     = 60;
var FORO_FORMATO_FECHA = 'dd/mm/yyyy HH:mm:ss';

var FORO_ERROR_GENERICO = 'No se pudo completar la acción. Intenta de nuevo.';
var FORO_ERROR_OCUPADO  = 'El foro está recibiendo muchos mensajes. Intenta en unos segundos.';

// ============================================================
// SWITCH DEL MÓDULO
// ============================================================

function obtenerEstadoSwitchForo() {
  return _switchHabilitado('foro_habilitado');
}

// Solo ADMIN (validado en _toggleSwitchModulo).
function toggleSwitchForo(estado, rutSolicitante) {
  return _toggleSwitchModulo('foro_habilitado', estado, rutSolicitante);
}

// ============================================================
// LECTURA
// ============================================================

/**
 * Lo que la pantalla del foro necesita al abrirse: categorías activas, si el
 * socio ya aceptó las reglas vigentes, su rol en el foro y cuánto le queda
 * del cupo de hoy. A un moderador le suma los reportes pendientes.
 */
function foroObtenerInicio(sessionToken) {
  _ensureConfig();
  try {
    var socio = _foroSocioDeSesion_(sessionToken);
    if (socio.error) return _foroFallo_(socio);

    var respuesta = {
      success: true,
      ahora: Date.now(),
      categorias: _foroCategorias_().filter(function(c) { return c.activa; }).map(function(c) {
        return { id: c.id, nombre: c.nombre, descripcion: c.descripcion };
      }),
      aceptoReglas: _foroAceptoReglas_(socio.rut),
      versionReglas: FORO_VERSION_REGLAS,
      esModerador: socio.esModerador,
      esAdmin: socio.esAdmin,
      cupos: _foroCupos_(socio),
      limites: {
        temasDia: FORO_LIMITE_TEMAS_DIA,
        respuestasDia: FORO_LIMITE_RESPUESTAS_DIA,
        esperaRespuestaMin: FORO_ESPERA_RESPUESTA_MIN,
        minutosEdicion: FORO_MINUTOS_EDICION,
        largo: FORO_LARGO
      },
      motivosReporte: FORO_MOTIVOS_REPORTE
    };
    if (socio.esModerador) respuesta.reportesPendientes = _foroContarReportesPendientes_();
    return respuesta;
  } catch (e) {
    Logger.log('❌ foroObtenerInicio: ' + e.toString());
    return { success: false, message: 'No se pudo abrir el foro. Intenta de nuevo.' };
  }
}

/**
 * Una página de temas. Fijados primero, luego el más nuevo (por fecha de
 * creación). El listado general no muestra lo archivado; "Archivados" muestra
 * solo eso, y "Mis temas" muestra todo lo propio.
 *
 * @param {string} sessionToken
 * @param {Object} filtro {categoria, soloMios, archivados, pagina}
 */
function foroListarTemas(sessionToken, filtro) {
  _ensureConfig();
  try {
    var socio = _foroSocioDeSesion_(sessionToken);
    if (socio.error) return _foroFallo_(socio);

    filtro = filtro || {};
    var pagina = Math.max(1, parseInt(filtro.pagina, 10) || 1);
    var categoria = String(filtro.categoria || '').trim();
    var soloMios = !!filtro.soloMios;
    var archivados = !soloMios && !!filtro.archivados;

    var nombres = {};
    _foroCategorias_().forEach(function(c) { nombres[c.id] = c.nombre; });

    var lista = _foroIndiceTemas_().filter(function(t) {
      if (categoria && t.idCategoria !== categoria) return false;
      if (soloMios) return t.rut === socio.rut;
      if (_foroArchivado_(t) !== archivados) return false;
      // Un socio ve solo lo visible; lo suyo oculto lo encuentra en "Mis temas".
      return socio.esModerador || t.estado === FORO_ESTADO.VISIBLE;
    });

    lista.sort(function(a, b) {
      if (!soloMios && !archivados && a.fijado !== b.fijado) return a.fijado ? -1 : 1;
      return b.creado - a.creado;
    });

    var total = lista.length;
    var inicio = (pagina - 1) * FORO_TEMAS_POR_PAGINA;
    var temas = lista.slice(inicio, inicio + FORO_TEMAS_POR_PAGINA).map(function(t) {
      return _foroTemaParaCliente_(t, socio, nombres, false);
    });

    return {
      success: true, ahora: Date.now(),
      temas: temas, pagina: pagina, total: total,
      hayMas: inicio + FORO_TEMAS_POR_PAGINA < total
    };
  } catch (e) {
    Logger.log('❌ foroListarTemas: ' + e.toString());
    return { success: false, message: 'No se pudieron cargar los temas. Intenta de nuevo.' };
  }
}

/**
 * Un tema con una página de sus respuestas, en orden cronológico.
 * Un tema oculto o eliminado le llega a un socio común sin título ni texto:
 * el cliente muestra el aviso en su lugar.
 */
function foroObtenerTema(sessionToken, idTema, pagina) {
  _ensureConfig();
  try {
    var socio = _foroSocioDeSesion_(sessionToken);
    if (socio.error) return _foroFallo_(socio);
    if (!_foroIdValido_(idTema, 'T')) return { success: false, message: 'Este tema no existe.' };

    var CT = CONFIG.COLUMNAS.FORO_TEMAS;
    var hojaT = _foroHoja_('FORO_TEMAS');
    var filaT = _foroBuscarFila_(hojaT, CT.ID_TEMA, idTema);
    if (filaT === -1) return { success: false, message: 'Este tema ya no existe.' };

    var nombres = {};
    _foroCategorias_().forEach(function(c) { nombres[c.id] = c.nombre; });
    var tema = _foroTemaParaCliente_(_foroTemaDesdeFila_(_foroLeerFila_(hojaT, filaT, CT)), socio, nombres, true);

    var vacio = { success: true, ahora: Date.now(), tema: tema, respuestas: [], pagina: 1, total: 0, hayMas: false };
    if (!tema.verTexto) return vacio;
    // Cupos con la espera de ESTE tema, para que el botón de responder la
    // muestre al abrirlo. Solo en la primera página: las demás no la cambian.
    if (tema.puedeResponder && (parseInt(pagina, 10) || 1) === 1) vacio.cupos = _foroCupos_(socio, idTema);

    // Respuestas del tema: el buscador entrega sus filas; se lee solo el tramo
    // que cubre la página pedida, no la hoja entera.
    var CR = CONFIG.COLUMNAS.FORO_RESPUESTAS;
    var hojaR = _foroHoja_('FORO_RESPUESTAS');
    var filas = _foroBuscarFilas_(hojaR, CR.ID_TEMA, idTema);
    var total = filas.length;
    pagina = Math.max(1, parseInt(pagina, 10) || 1);
    var inicio = (pagina - 1) * FORO_RESPUESTAS_POR_PAGINA;
    var tramo = filas.slice(inicio, inicio + FORO_RESPUESTAS_POR_PAGINA);

    var respuestas = [];
    if (tramo.length) {
      var desde = tramo[0], hasta = tramo[tramo.length - 1];
      var valores = hojaR.getRange(desde, 1, hasta - desde + 1, _foroNcol_(CR)).getValues();
      tramo.forEach(function(fila) {
        var r = _foroRespuestaDesdeFila_(valores[fila - desde]);
        if (r.idTema === idTema) respuestas.push(_foroRespuestaParaCliente_(r, socio));
      });
    }

    vacio.respuestas = respuestas;
    vacio.pagina = pagina;
    vacio.total = total;
    vacio.hayMas = inicio + FORO_RESPUESTAS_POR_PAGINA < total;
    return vacio;
  } catch (e) {
    Logger.log('❌ foroObtenerTema: ' + e.toString());
    return { success: false, message: 'No se pudo cargar el tema. Intenta de nuevo.' };
  }
}

// ============================================================
// ESCRITURA DEL SOCIO
// ============================================================

/** Registra que el socio aceptó la versión vigente de las reglas de uso. */
function foroAceptarReglas(sessionToken) {
  _ensureConfig();
  var lock = LockService.getScriptLock();
  try {
    var socio = _foroSocioDeSesion_(sessionToken);
    if (socio.error) return _foroFallo_(socio);
    if (_foroAceptoReglas_(socio.rut)) return { success: true };
    if (!lock.tryLock(10000)) return { success: false, message: FORO_ERROR_OCUPADO };

    var COL = CONFIG.COLUMNAS.FORO_REGLAS;
    var hoja = _foroHoja_('FORO_REGLAS');
    var row = _foroFilaVacia_(COL);
    row[COL.RUT] = socio.rut;
    row[COL.VERSION_REGLAS] = FORO_VERSION_REGLAS;
    row[COL.FECHA] = new Date();
    _foroEscribirFila_(hoja, hoja.getLastRow() + 1, COL, row);
    CacheService.getScriptCache().put(_foroClaveReglas_(socio.rut), '1', 21600);
    return { success: true };
  } catch (e) {
    Logger.log('❌ foroAceptarReglas: ' + e.toString());
    return { success: false, message: FORO_ERROR_GENERICO };
  } finally {
    try { lock.releaseLock(); } catch (e2) {}
  }
}

/**
 * Abre un tema nuevo. Un tema al día por socio, DIRIGENTE y DIRECTORIO
 * incluidos; ADMIN, sin límite.
 *
 * @param {Object} datos {idCategoria, titulo, texto}
 */
function foroCrearTema(sessionToken, datos) {
  _ensureConfig();
  var lock = LockService.getScriptLock();
  try {
    var socio = _foroSocioDeSesion_(sessionToken);
    if (socio.error) return _foroFallo_(socio);
    if (!_foroAceptoReglas_(socio.rut)) return _foroPideReglas_();
    datos = datos || {};

    var categoria = String(datos.idCategoria || '').trim();
    var activa = _foroCategorias_().some(function(c) { return c.id === categoria && c.activa; });
    if (!activa) return { success: false, message: 'Elige una categoría.' };

    var titulo = _foroLimpiarTexto_(datos.titulo, false);
    var texto = _foroLimpiarTexto_(datos.texto, true);
    var error = _foroValidarTitulo_(titulo) || _foroValidarTexto_(texto, FORO_LARGO.TEMA);
    if (error) return { success: false, message: error };

    if (!lock.tryLock(10000)) return { success: false, message: FORO_ERROR_OCUPADO };

    // El cupo se revisa dentro del candado: dos pedidos simultáneos (doble
    // toque) leerían los dos "0 temas hoy" y pasarían.
    var cupos = _foroCupos_(socio);
    if (!cupos.temasSinLimite && cupos.temasRestantes <= 0) {
      return { success: false, cupos: cupos, message: 'Ya abriste un tema hoy. Podrás abrir otro a partir de las 00:00.' };
    }

    var COL = CONFIG.COLUMNAS.FORO_TEMAS;
    var hoja = _foroHoja_('FORO_TEMAS');
    var ahora = new Date();
    var id = _foroNuevoId_('T');
    var row = _foroFilaVacia_(COL);
    row[COL.ID_TEMA] = id;
    row[COL.ID_CATEGORIA] = categoria;
    row[COL.TITULO] = titulo;
    row[COL.TEXTO] = texto;
    row[COL.RUT_AUTOR] = socio.rut;
    row[COL.NOMBRE_AUTOR] = socio.nombre;
    _foroFirmarRol_(row, COL, socio);
    row[COL.FECHA_CREACION] = ahora;
    row[COL.FECHA_ULTIMA_ACTIVIDAD] = ahora;
    row[COL.N_RESPUESTAS] = 0;
    row[COL.ESTADO] = FORO_ESTADO.VISIBLE;
    row[COL.CERRADO] = 'NO';
    row[COL.FIJADO] = 'NO';
    row[COL.N_REPORTES] = 0;
    _foroEscribirFila_(hoja, hoja.getLastRow() + 1, COL, row);
    SpreadsheetApp.flush();
    _foroInvalidar_();

    Logger.log('💬 Foro: tema ' + id + ' creado por ' + socio.firma);
    if (!cupos.temasSinLimite) cupos.temasRestantes = Math.max(0, cupos.temasRestantes - 1);
    return { success: true, idTema: id, cupos: cupos, message: 'Tema publicado.' };
  } catch (e) {
    Logger.log('❌ foroCrearTema: ' + e.toString());
    return { success: false, message: 'No se pudo publicar el tema. Intenta de nuevo.' };
  } finally {
    try { lock.releaseLock(); } catch (e2) {}
  }
}

/**
 * Responde un tema. Un socio: 10 al día, y una hora de espera antes de volver
 * a responder en el MISMO tema (en otro puede responder de inmediato).
 * Un moderador: sin cupo ni espera, y puede responder aunque el tema esté cerrado.
 */
function foroResponder(sessionToken, idTema, texto) {
  _ensureConfig();
  var lock = LockService.getScriptLock();
  try {
    var socio = _foroSocioDeSesion_(sessionToken);
    if (socio.error) return _foroFallo_(socio);
    if (!_foroAceptoReglas_(socio.rut)) return _foroPideReglas_();
    if (!_foroIdValido_(idTema, 'T')) return { success: false, message: 'Este tema no existe.' };

    texto = _foroLimpiarTexto_(texto, true);
    var error = _foroValidarTexto_(texto, FORO_LARGO.RESPUESTA);
    if (error) return { success: false, message: error };

    if (!lock.tryLock(10000)) return { success: false, message: FORO_ERROR_OCUPADO };

    var CT = CONFIG.COLUMNAS.FORO_TEMAS;
    var hojaT = _foroHoja_('FORO_TEMAS');
    var filaT = _foroBuscarFila_(hojaT, CT.ID_TEMA, idTema);
    if (filaT === -1) return { success: false, message: 'Este tema ya no existe.' };
    var tema = _foroTemaDesdeFila_(_foroLeerFila_(hojaT, filaT, CT));
    if (tema.estado !== FORO_ESTADO.VISIBLE) return { success: false, message: 'Este tema ya no recibe respuestas.' };
    if (tema.cerrado && !socio.esModerador) return { success: false, message: 'Este tema está cerrado y ya no recibe respuestas.' };
    if (_foroArchivado_(tema)) return { success: false, message: 'Este tema está archivado: tiene más de un mes y ya no recibe respuestas. Si quieres seguir la conversación, abre un tema nuevo.' };

    var cupos = _foroCupos_(socio, idTema);
    if (!socio.esModerador) {
      if (cupos.respuestasRestantes <= 0) {
        return { success: false, cupos: cupos, message: 'Llegaste al máximo de ' + FORO_LIMITE_RESPUESTAS_DIA + ' respuestas por hoy. Podrás responder de nuevo a partir de las 00:00.' };
      }
      if (cupos.esperaRespuestaSeg > 0) {
        var min = Math.ceil(cupos.esperaRespuestaSeg / 60);
        return { success: false, cupos: cupos, message: 'Ya respondiste en este tema hace poco. Podrás volver a responder aquí en ' +
                 (min === 1 ? '1 minuto' : min + ' minutos') + '. Mientras tanto, puedes participar en otros temas.' };
      }
    }

    var CR = CONFIG.COLUMNAS.FORO_RESPUESTAS;
    var hojaR = _foroHoja_('FORO_RESPUESTAS');
    var ahora = new Date();
    var id = _foroNuevoId_('R');
    var row = _foroFilaVacia_(CR);
    row[CR.ID_RESPUESTA] = id;
    row[CR.ID_TEMA] = idTema;
    row[CR.TEXTO] = texto;
    row[CR.RUT_AUTOR] = socio.rut;
    row[CR.NOMBRE_AUTOR] = socio.nombre;
    _foroFirmarRol_(row, CR, socio);
    row[CR.FECHA] = ahora;
    row[CR.ESTADO] = FORO_ESTADO.VISIBLE;
    row[CR.N_REPORTES] = 0;
    _foroEscribirFila_(hojaR, hojaR.getLastRow() + 1, CR, row);

    // Contadores del tema, bajo el mismo candado: el listado nunca lee RESPUESTAS.
    hojaT.getRange(filaT, CT.N_RESPUESTAS + 1).setValue(tema.nRespuestas + 1);
    hojaT.getRange(filaT, CT.FECHA_ULTIMA_ACTIVIDAD + 1).setValue(ahora);
    SpreadsheetApp.flush();
    _foroInvalidar_();

    if (!socio.esModerador) {
      cupos.respuestasRestantes = Math.max(0, cupos.respuestasRestantes - 1);
      cupos.esperaRespuestaSeg = FORO_ESPERA_RESPUESTA_MIN * 60;
    }
    return { success: true, idRespuesta: id, cupos: cupos, message: 'Respuesta publicada.' };
  } catch (e) {
    Logger.log('❌ foroResponder: ' + e.toString());
    return { success: false, message: 'No se pudo publicar la respuesta. Intenta de nuevo.' };
  } finally {
    try { lock.releaseLock(); } catch (e2) {}
  }
}

/**
 * El autor corrige lo suyo dentro de los 15 minutos, medidos en el servidor.
 * No se edita lo oculto, lo eliminado ni lo que ya tiene reportes. ADMIN se
 * salta el plazo y los reportes, no el estado. La primera
 * edición guarda la versión original, que solo ven los moderadores.
 *
 * @param {string} tipo 'TEMA' | 'RESPUESTA'
 * @param {Object} datos {titulo, texto}; el título solo en un tema
 */
function foroEditarPropio(sessionToken, tipo, id, datos) {
  _ensureConfig();
  var lock = LockService.getScriptLock();
  try {
    var socio = _foroSocioDeSesion_(sessionToken);
    if (socio.error) return _foroFallo_(socio);
    var t = _foroTabla_(tipo, id);
    if (!t) return { success: false, message: 'Este mensaje no existe.' };
    datos = datos || {};

    var texto = _foroLimpiarTexto_(datos.texto, true);
    var error = _foroValidarTexto_(texto, t.esTema ? FORO_LARGO.TEMA : FORO_LARGO.RESPUESTA);
    var titulo = '';
    if (!error && t.esTema) {
      titulo = _foroLimpiarTexto_(datos.titulo, false);
      error = _foroValidarTitulo_(titulo);
    }
    if (error) return { success: false, message: error };

    if (!lock.tryLock(10000)) return { success: false, message: FORO_ERROR_OCUPADO };
    var fila = _foroBuscarFila_(t.hoja, t.COL[t.colId], id);
    if (fila === -1) return { success: false, message: 'Este mensaje ya no existe.' };
    var row = _foroLeerFila_(t.hoja, fila, t.COL);
    var m = t.desdeFila(row);

    if (m.rut !== socio.rut) return { success: false, message: 'Solo puedes editar tus propios mensajes.' };
    if (m.estado !== FORO_ESTADO.VISIBLE) return { success: false, message: 'Este mensaje ya no se puede editar.' };
    // ADMIN edita lo suyo sin plazo y aunque tenga reportes (decisión del
    // usuario, 26/09/2026). La versión original se guarda igual.
    if (!socio.esAdmin && m.nReportes > 0) return { success: false, message: 'Este mensaje fue reportado y ya no se puede editar.' };
    if (!socio.esAdmin && Date.now() > m.creado + FORO_MINUTOS_EDICION * 60000) {
      return { success: false, message: 'Pasaron más de ' + FORO_MINUTOS_EDICION + ' minutos desde que lo publicaste. Ya no se puede editar.' };
    }
    if (texto === m.texto && (!t.esTema || titulo === m.titulo)) return { success: true, message: 'No hubo cambios.' };

    var COL = t.COL;
    if (!String(row[COL.TEXTO_ORIGINAL] || '').trim()) {
      row[COL.TEXTO_ORIGINAL] = m.texto;
      if (t.esTema) row[COL.TITULO_ORIGINAL] = m.titulo;
    }
    row[COL.TEXTO] = texto;
    if (t.esTema) row[COL.TITULO] = titulo;
    row[COL.FECHA_EDICION] = new Date();
    _foroEscribirFila_(t.hoja, fila, COL, row);
    SpreadsheetApp.flush();
    _foroInvalidar_();
    return { success: true, message: 'Cambios guardados.' };
  } catch (e) {
    Logger.log('❌ foroEditarPropio: ' + e.toString());
    return { success: false, message: FORO_ERROR_GENERICO };
  } finally {
    try { lock.releaseLock(); } catch (e2) {}
  }
}

/** El autor retira lo suyo. No se borra: queda ELIMINADO_AUTOR. No devuelve cupo. */
function foroEliminarPropio(sessionToken, tipo, id) {
  _ensureConfig();
  var lock = LockService.getScriptLock();
  try {
    var socio = _foroSocioDeSesion_(sessionToken);
    if (socio.error) return _foroFallo_(socio);
    var t = _foroTabla_(tipo, id);
    if (!t) return { success: false, message: 'Este mensaje no existe.' };

    if (!lock.tryLock(10000)) return { success: false, message: FORO_ERROR_OCUPADO };
    var fila = _foroBuscarFila_(t.hoja, t.COL[t.colId], id);
    if (fila === -1) return { success: false, message: 'Este mensaje ya no existe.' };
    var row = _foroLeerFila_(t.hoja, fila, t.COL);
    var m = t.desdeFila(row);

    if (m.rut !== socio.rut) return { success: false, message: 'Solo puedes eliminar tus propios mensajes.' };
    // Lo oculto por moderación no se "elimina": perdería el rastro de por qué se ocultó.
    if (m.estado !== FORO_ESTADO.VISIBLE) return { success: false, message: 'Este mensaje ya no se puede eliminar.' };

    row[t.COL.ESTADO] = FORO_ESTADO.ELIMINADO;
    _foroEscribirFila_(t.hoja, fila, t.COL, row);
    // Lo eliminado ya no lo ve nadie: sus reportes pendientes no deben quedar
    // en la bandeja para siempre, sin acción posible.
    _foroCerrarReportes_(id, FORO_ESTADO_REPORTE.RESUELTO, socio.firma, 'Eliminado por su autor');
    SpreadsheetApp.flush();
    _foroInvalidar_();
    Logger.log('💬 Foro: ' + id + ' eliminado por su autor ' + socio.firma);
    return { success: true, message: 'Mensaje eliminado.' };
  } catch (e) {
    Logger.log('❌ foroEliminarPropio: ' + e.toString());
    return { success: false, message: FORO_ERROR_GENERICO };
  } finally {
    try { lock.releaseLock(); } catch (e2) {}
  }
}

/**
 * Reporta un mensaje. Una vez por socio y mensaje. Al tercer reporte el
 * mensaje se oculta solo, salvo que un moderador ya lo haya revisado.
 */
function foroReportar(sessionToken, tipo, id, motivo, detalle) {
  _ensureConfig();
  var lock = LockService.getScriptLock();
  try {
    var socio = _foroSocioDeSesion_(sessionToken);
    if (socio.error) return _foroFallo_(socio);
    var t = _foroTabla_(tipo, id);
    if (!t) return { success: false, message: 'Este mensaje no existe.' };

    motivo = String(motivo || '').trim();
    if (FORO_MOTIVOS_REPORTE.indexOf(motivo) === -1) return { success: false, message: 'Elige el motivo del reporte.' };
    detalle = _foroLimpiarTexto_(detalle, false);
    if (detalle.length > FORO_LARGO.DETALLE_REPORTE) return { success: false, message: 'El detalle puede tener hasta ' + FORO_LARGO.DETALLE_REPORTE + ' caracteres.' };
    if (motivo === 'Otro' && !detalle) return { success: false, message: 'Cuéntanos brevemente el motivo.' };

    if (!lock.tryLock(10000)) return { success: false, message: FORO_ERROR_OCUPADO };
    var fila = _foroBuscarFila_(t.hoja, t.COL[t.colId], id);
    if (fila === -1) return { success: false, message: 'Este mensaje ya no existe.' };
    var row = _foroLeerFila_(t.hoja, fila, t.COL);
    var m = t.desdeFila(row);

    if (m.rut === socio.rut) return { success: false, message: 'No puedes reportar tus propios mensajes.' };
    if (m.estado !== FORO_ESTADO.VISIBLE) return { success: true, message: 'Este mensaje ya no está visible. Gracias por avisar.' };

    var CP = CONFIG.COLUMNAS.FORO_REPORTES;
    var hojaP = _foroHoja_('FORO_REPORTES');
    var yaReportado = _foroBuscarFilas_(hojaP, CP.ID_OBJETO, id).some(function(f) {
      return cleanRut(String(hojaP.getRange(f, CP.RUT_REPORTA + 1).getValue())) === socio.rut;
    });
    if (yaReportado) return { success: true, message: 'Ya habías reportado este mensaje. Un moderador lo revisará.' };

    var reporte = _foroFilaVacia_(CP);
    reporte[CP.ID_REPORTE] = _foroNuevoId_('X');
    reporte[CP.TIPO] = t.tipo;
    reporte[CP.ID_OBJETO] = id;
    reporte[CP.ID_TEMA] = t.esTema ? id : m.idTema;
    reporte[CP.RUT_REPORTA] = socio.rut;
    reporte[CP.MOTIVO] = motivo;
    reporte[CP.DETALLE] = detalle;
    reporte[CP.FECHA] = new Date();
    reporte[CP.ESTADO] = FORO_ESTADO_REPORTE.PENDIENTE;
    _foroEscribirFila_(hojaP, hojaP.getLastRow() + 1, CP, reporte);

    var COL = t.COL;
    var nReportes = m.nReportes + 1;
    row[COL.N_REPORTES] = nReportes;
    // "Revisado" = un moderador de carne y hueso ya lo dejó visible. Sin esta
    // regla, tres personas coordinadas podrían ocultarlo una y otra vez.
    var revisado = m.modPor && m.modPor !== FORO_MODERADO_AUTOMATICO;
    var ocultado = false;
    if (nReportes >= FORO_REPORTES_AUTO_OCULTAR && !revisado) {
      row[COL.ESTADO] = FORO_ESTADO.OCULTO;
      row[COL.MODERADO_POR] = FORO_MODERADO_AUTOMATICO;
      row[COL.FECHA_MODERACION] = new Date();
      row[COL.MOTIVO_MODERACION] = FORO_MOTIVO_AUTOMATICO;
      ocultado = true;
    }
    _foroEscribirFila_(t.hoja, fila, COL, row);
    SpreadsheetApp.flush();
    _foroInvalidar_();

    Logger.log('🚩 Foro: ' + id + ' reportado (' + motivo + '), lleva ' + nReportes + (ocultado ? ' — ocultado automáticamente' : ''));
    return { success: true, ocultado: ocultado, message: 'Gracias por avisar. Un moderador lo revisará.' };
  } catch (e) {
    Logger.log('❌ foroReportar: ' + e.toString());
    return { success: false, message: FORO_ERROR_GENERICO };
  } finally {
    try { lock.releaseLock(); } catch (e2) {}
  }
}

// ============================================================
// MODERACIÓN (DIRIGENTE · DIRECTORIO · ADMIN)
// ============================================================

/**
 * Decisión de un moderador sobre un mensaje, que además cierra sus reportes:
 *   ocultar   VISIBLE/OCULTO → OCULTO (motivo obligatorio) · reportes RESUELTO
 *             (sobre algo ya oculto confirma un auto-ocultamiento con motivo humano)
 *   restaurar OCULTO  → VISIBLE                        · reportes DESCARTADO
 *   mantener  VISIBLE → VISIBLE, marcado como revisado  · reportes DESCARTADO
 * Nadie modera lo propio (un moderador reportado no puede restaurarse solo),
 * salvo ADMIN, por decisión del usuario.
 */
function foroModerar(sessionToken, tipo, id, accion, motivo) {
  _ensureConfig();
  var lock = LockService.getScriptLock();
  try {
    var socio = _foroSocioDeSesion_(sessionToken);
    if (socio.error) return _foroFallo_(socio);
    if (!socio.esModerador) return { success: false, message: 'No tienes permisos para moderar el foro.' };
    var t = _foroTabla_(tipo, id);
    if (!t) return { success: false, message: 'Este mensaje no existe.' };

    accion = String(accion || '').trim().toLowerCase();
    if (['ocultar', 'restaurar', 'mantener'].indexOf(accion) === -1) return { success: false, message: 'Acción no válida.' };
    motivo = _foroLimpiarTexto_(motivo, false);
    if (motivo.length > FORO_LARGO.MOTIVO) return { success: false, message: 'El motivo puede tener hasta ' + FORO_LARGO.MOTIVO + ' caracteres.' };
    if (accion === 'ocultar' && motivo.length < 5) return { success: false, message: 'Escribe el motivo: el autor lo verá.' };

    if (!lock.tryLock(10000)) return { success: false, message: FORO_ERROR_OCUPADO };
    var fila = _foroBuscarFila_(t.hoja, t.COL[t.colId], id);
    if (fila === -1) return { success: false, message: 'Este mensaje ya no existe.' };
    var row = _foroLeerFila_(t.hoja, fila, t.COL);
    var m = t.desdeFila(row);

    // Nadie modera lo propio, salvo ADMIN (decisión del usuario, 26/09/2026).
    if (m.rut === socio.rut && !socio.esAdmin) return { success: false, message: 'No puedes moderar tus propios mensajes. Otro moderador debe revisarlo.' };

    var COL = t.COL;
    var nuevoEstado, estadoReportes, motivoFinal;
    if (accion === 'ocultar') {
      if (m.estado === FORO_ESTADO.ELIMINADO) return { success: false, message: 'Su autor ya lo eliminó.', recargar: true };
      nuevoEstado = FORO_ESTADO.OCULTO;
      estadoReportes = FORO_ESTADO_REPORTE.RESUELTO;
      motivoFinal = motivo;
    } else if (accion === 'restaurar') {
      if (m.estado !== FORO_ESTADO.OCULTO) return { success: false, message: 'Este mensaje no está oculto.', recargar: true };
      nuevoEstado = FORO_ESTADO.VISIBLE;
      estadoReportes = FORO_ESTADO_REPORTE.DESCARTADO;
      motivoFinal = motivo || 'Restaurado tras revisión';
    } else {
      if (m.estado !== FORO_ESTADO.VISIBLE) return { success: false, message: 'Este mensaje ya no está visible.', recargar: true };
      nuevoEstado = FORO_ESTADO.VISIBLE;
      estadoReportes = FORO_ESTADO_REPORTE.DESCARTADO;
      motivoFinal = motivo || 'Revisado: se mantiene';
    }

    row[COL.ESTADO] = nuevoEstado;
    row[COL.MODERADO_POR] = socio.firma;
    row[COL.FECHA_MODERACION] = new Date();
    row[COL.MOTIVO_MODERACION] = motivoFinal;
    _foroEscribirFila_(t.hoja, fila, COL, row);
    var cerrados = _foroCerrarReportes_(id, estadoReportes, socio.firma, accion + (motivo ? ': ' + motivo : ''));
    SpreadsheetApp.flush();
    _foroInvalidar_();

    Logger.log('🛡️ Foro: ' + accion + ' ' + id + ' por ' + socio.firma + ' (' + cerrados + ' reportes cerrados)');
    var textos = { ocultar: 'Mensaje ocultado.', restaurar: 'Mensaje restaurado.', mantener: 'Revisado: el mensaje se mantiene.' };
    return { success: true, message: textos[accion] };
  } catch (e) {
    Logger.log('❌ foroModerar: ' + e.toString());
    return { success: false, message: FORO_ERROR_GENERICO };
  } finally {
    try { lock.releaseLock(); } catch (e2) {}
  }
}

/**
 * Cierra/reabre o fija/desfija un tema.
 * @param {Object} cambios {cerrado?: boolean, fijado?: boolean}
 */
function foroCambiarTema(sessionToken, idTema, cambios) {
  _ensureConfig();
  var lock = LockService.getScriptLock();
  try {
    var socio = _foroSocioDeSesion_(sessionToken);
    if (socio.error) return _foroFallo_(socio);
    if (!socio.esModerador) return { success: false, message: 'No tienes permisos para moderar el foro.' };
    if (!_foroIdValido_(idTema, 'T')) return { success: false, message: 'Este tema no existe.' };
    cambios = cambios || {};
    if (typeof cambios.cerrado !== 'boolean' && typeof cambios.fijado !== 'boolean') return { success: false, message: 'No hay cambios.' };

    if (!lock.tryLock(10000)) return { success: false, message: FORO_ERROR_OCUPADO };
    var COL = CONFIG.COLUMNAS.FORO_TEMAS;
    var hoja = _foroHoja_('FORO_TEMAS');
    var fila = _foroBuscarFila_(hoja, COL.ID_TEMA, idTema);
    if (fila === -1) return { success: false, message: 'Este tema ya no existe.' };

    var row = _foroLeerFila_(hoja, fila, COL);
    if (typeof cambios.cerrado === 'boolean') row[COL.CERRADO] = cambios.cerrado ? 'SI' : 'NO';
    if (typeof cambios.fijado === 'boolean') row[COL.FIJADO] = cambios.fijado ? 'SI' : 'NO';
    _foroEscribirFila_(hoja, fila, COL, row);
    SpreadsheetApp.flush();
    _foroInvalidar_();

    Logger.log('🛡️ Foro: tema ' + idTema + ' ' + JSON.stringify(cambios) + ' por ' + socio.firma);
    return { success: true, message: 'Tema actualizado.' };
  } catch (e) {
    Logger.log('❌ foroCambiarTema: ' + e.toString());
    return { success: false, message: FORO_ERROR_GENERICO };
  } finally {
    try { lock.releaseLock(); } catch (e2) {}
  }
}

/**
 * Bandeja de reportes pendientes, agrupados por mensaje (el más reportado
 * primero). Quién reportó lo ve solo ADMIN: un dirigente reportado no debe
 * poder saber qué socio lo denunció.
 */
function foroListarReportes(sessionToken) {
  _ensureConfig();
  try {
    var socio = _foroSocioDeSesion_(sessionToken);
    if (socio.error) return _foroFallo_(socio);
    if (!socio.esModerador) return { success: false, message: 'No tienes permisos para moderar el foro.' };

    var CP = CONFIG.COLUMNAS.FORO_REPORTES;
    var grupos = {};
    _foroLeerTodo_(_foroHoja_('FORO_REPORTES'), CP).forEach(function(r) {
      if (String(r[CP.ESTADO]).trim().toUpperCase() !== FORO_ESTADO_REPORTE.PENDIENTE) return;
      var id = String(r[CP.ID_OBJETO]).trim();
      if (!id) return;
      if (!grupos[id]) grupos[id] = { tipo: String(r[CP.TIPO]).trim().toUpperCase(), id: id, idTema: String(r[CP.ID_TEMA]).trim(), reportes: [], ultimo: 0 };
      var fecha = _foroMs_(r[CP.FECHA]);
      var rep = { motivo: String(r[CP.MOTIVO] || ''), detalle: String(r[CP.DETALLE] || ''), fecha: fecha };
      if (socio.esAdmin) rep.reportadoPor = _foroNombreSocio_(String(r[CP.RUT_REPORTA]));
      grupos[id].reportes.push(rep);
      grupos[id].ultimo = Math.max(grupos[id].ultimo, fecha);
    });

    var lista = Object.keys(grupos).map(function(k) { return grupos[k]; });
    lista.sort(function(a, b) { return (b.reportes.length - a.reportes.length) || (b.ultimo - a.ultimo); });
    lista = lista.slice(0, 50);

    var nombres = {};
    _foroCategorias_().forEach(function(c) { nombres[c.id] = c.nombre; });
    var hojaT = _foroHoja_('FORO_TEMAS');
    var CT = CONFIG.COLUMNAS.FORO_TEMAS;

    var items = [];
    lista.forEach(function(g) {
      var t = _foroTabla_(g.tipo, g.id);
      if (!t) return;
      var fila = _foroBuscarFila_(t.hoja, t.COL[t.colId], g.id);
      if (fila === -1) return;
      var m = t.desdeFila(_foroLeerFila_(t.hoja, fila, t.COL));
      var item = {
        tipo: g.tipo, idTema: g.idTema, reportes: g.reportes,
        mensaje: t.esTema ? _foroTemaParaCliente_(m, socio, nombres, true) : _foroRespuestaParaCliente_(m, socio)
      };
      if (!t.esTema) {
        var filaT = _foroBuscarFila_(hojaT, CT.ID_TEMA, g.idTema);
        item.tituloTema = filaT === -1 ? '' : String(hojaT.getRange(filaT, CT.TITULO + 1).getValue());
      }
      items.push(item);
    });

    return { success: true, ahora: Date.now(), items: items };
  } catch (e) {
    Logger.log('❌ foroListarReportes: ' + e.toString());
    return { success: false, message: 'No se pudieron cargar los reportes. Intenta de nuevo.' };
  }
}

// ============================================================
// CATEGORÍAS (solo ADMIN)
// ============================================================

/** Todas las categorías, incluidas las apagadas, con cuántos temas tiene cada una. */
function foroListarCategoriasAdmin(sessionToken) {
  _ensureConfig();
  try {
    var socio = _foroSocioDeSesion_(sessionToken);
    if (socio.error) return _foroFallo_(socio);
    if (!socio.esAdmin) return { success: false, message: 'Solo un administrador puede gestionar las categorías.' };

    var conteo = {};
    _foroIndiceTemas_().forEach(function(t) { conteo[t.idCategoria] = (conteo[t.idCategoria] || 0) + 1; });
    return {
      success: true,
      categorias: _foroCategorias_().map(function(c) {
        c.nTemas = conteo[c.id] || 0;
        return c;
      }),
      largo: { nombre: FORO_LARGO.CATEGORIA_NOMBRE, descripcion: FORO_LARGO.CATEGORIA_DESCRIPCION }
    };
  } catch (e) {
    Logger.log('❌ foroListarCategoriasAdmin: ' + e.toString());
    return { success: false, message: 'No se pudieron cargar las categorías. Intenta de nuevo.' };
  }
}

/**
 * Crea (sin id) o edita una categoría. No se borran: se apagan, y sus temas
 * se siguen leyendo, pero no reciben temas nuevos.
 *
 * @param {Object} datos {id?, nombre, descripcion, orden, activa}
 */
function foroGuardarCategoria(sessionToken, datos) {
  _ensureConfig();
  var lock = LockService.getScriptLock();
  try {
    var socio = _foroSocioDeSesion_(sessionToken);
    if (socio.error) return _foroFallo_(socio);
    if (!socio.esAdmin) return { success: false, message: 'Solo un administrador puede gestionar las categorías.' };
    datos = datos || {};

    var nombre = _foroLimpiarTexto_(datos.nombre, false);
    var descripcion = _foroLimpiarTexto_(datos.descripcion, false);
    var orden = String(datos.orden == null ? '' : datos.orden).trim();
    if (nombre.length < 2) return { success: false, message: 'Escribe el nombre de la categoría.' };
    if (nombre.length > FORO_LARGO.CATEGORIA_NOMBRE) return { success: false, message: 'El nombre puede tener hasta ' + FORO_LARGO.CATEGORIA_NOMBRE + ' caracteres.' };
    if (descripcion.length > FORO_LARGO.CATEGORIA_DESCRIPCION) return { success: false, message: 'La descripción puede tener hasta ' + FORO_LARGO.CATEGORIA_DESCRIPCION + ' caracteres.' };
    if (orden && !/^[1-9]\d?$/.test(orden)) return { success: false, message: 'El orden debe ser un número del 1 al 99.' };

    var id = String(datos.id || '').trim();
    if (id && !_foroIdValido_(id, 'C')) return { success: false, message: 'La categoría no existe.' };

    if (!lock.tryLock(10000)) return { success: false, message: FORO_ERROR_OCUPADO };
    var repetida = _foroCategorias_().some(function(c) { return c.id !== id && c.nombre.toLowerCase() === nombre.toLowerCase(); });
    if (repetida) return { success: false, message: 'Ya existe una categoría con ese nombre.' };

    var COL = CONFIG.COLUMNAS.FORO_CATEGORIAS;
    var hoja = _foroHoja_('FORO_CATEGORIAS');
    var fila, row;
    if (id) {
      fila = _foroBuscarFila_(hoja, COL.ID_CATEGORIA, id);
      if (fila === -1) return { success: false, message: 'La categoría ya no existe. Recarga la lista.', recargar: true };
      row = _foroLeerFila_(hoja, fila, COL);
    } else {
      id = _foroNuevoId_('C');
      fila = hoja.getLastRow() + 1;
      row = _foroFilaVacia_(COL);
      row[COL.ID_CATEGORIA] = id;
      row[COL.CREADA_POR] = socio.firma;
    }
    row[COL.NOMBRE] = nombre;
    row[COL.DESCRIPCION] = descripcion;
    row[COL.ORDEN] = orden ? Number(orden) : '';
    row[COL.ACTIVA] = datos.activa === false ? 'NO' : 'SI';
    row[COL.ACTUALIZADA_POR] = socio.firma;
    row[COL.FECHA_ACTUALIZACION] = new Date();
    _foroEscribirFila_(hoja, fila, COL, row);
    SpreadsheetApp.flush();
    _foroInvalidar_();

    Logger.log('🗂️ Foro: categoría ' + id + ' (' + nombre + ') guardada por ' + socio.firma);
    return { success: true, id: id, message: 'Categoría guardada.' };
  } catch (e) {
    Logger.log('❌ foroGuardarCategoria: ' + e.toString());
    return { success: false, message: FORO_ERROR_GENERICO };
  } finally {
    try { lock.releaseLock(); } catch (e2) {}
  }
}

// ============================================================
// SESIÓN Y PERMISOS
// ============================================================

/**
 * Socio de la sesión, o {error} con el mensaje para el cliente.
 *
 * El rol se lee en el servidor desde USUARIOS, la misma fuente que usa
 * verificarRolUsuario(); se lee directo para no dejar en el log un "intento
 * no autorizado" por cada socio común que abre el foro.
 */
function _foroSocioDeSesion_(sessionToken) {
  if (!_foroConfigurado_()) return { error: 'El foro todavía no está disponible.' };
  var rut = obtenerRutDeSesion(sessionToken);
  if (!rut) return { error: 'Tu sesión expiró. Vuelve a ingresar.', sesionExpirada: true };

  var usuario = obtenerUsuarioPorRut(rut);
  if (!usuario || usuario.encontrado === false) return { error: 'No encontramos tu registro de socio.' };
  if (String(usuario.estado || '').trim().toUpperCase() === 'DESVINCULADO') return { error: 'El foro es solo para socios activos.' };

  var rol = String(usuario.rol || 'SOCIO').trim().toUpperCase();
  var esModerador = FORO_MODERADORES.indexOf(rol) !== -1;

  // Con el módulo apagado entran solo quienes pueden probarlo o reactivarlo.
  if (!_switchHabilitado('foro_habilitado').habilitado && !esModerador && rol !== 'TESTING') {
    return { error: 'El foro no está disponible en este momento.', moduloApagado: true };
  }

  var nombre = String(usuario.nombre || '').replace(/\s+/g, ' ').trim();
  return {
    rut: cleanRut(rut),
    nombre: nombre || 'Socio',
    cargo: _foroCargoLimpio_(usuario.cargo),
    rol: rol,
    esModerador: esModerador,
    esAdmin: rol === 'ADMIN',
    firma: (nombre ? nombre + ' ' : '') + '(' + formatRutDisplay(rut) + ')'
  };
}

function _foroFallo_(socio) {
  return { success: false, message: socio.error, sesionExpirada: !!socio.sesionExpirada, moduloApagado: !!socio.moduloApagado };
}

function _foroPideReglas_() {
  return { success: false, requiereReglas: true, message: 'Antes de publicar debes aceptar las reglas de uso del foro.' };
}

function _foroClaveReglas_(rut) {
  return 'foro_reglas_v' + FORO_VERSION_REGLAS + '_' + rut;
}

/** ¿Aceptó el socio la versión vigente de las reglas? */
function _foroAceptoReglas_(rut) {
  var cache = CacheService.getScriptCache();
  var clave = _foroClaveReglas_(rut);
  if (cache.get(clave)) return true;

  var COL = CONFIG.COLUMNAS.FORO_REGLAS;
  var hoja = _foroHoja_('FORO_REGLAS');
  var acepto = _foroBuscarFilas_(hoja, COL.RUT, rut).some(function(f) {
    return Number(hoja.getRange(f, COL.VERSION_REGLAS + 1).getValue()) === FORO_VERSION_REGLAS;
  });
  if (acepto) cache.put(clave, '1', 21600);
  return acepto;
}

/**
 * Cuánto le queda hoy al socio. "Hoy" es el día calendario de Santiago. Se
 * cuenta en la planilla, no en el caché (que dura como máximo 6 horas y puede
 * vaciarse antes), e incluye lo eliminado u oculto: si no, eliminar y volver
 * a publicar se saltaría el límite.
 *
 * Con idTema, además, cuánto falta para que pueda volver a responder EN ESE
 * tema: la espera de una hora es por tema, no global (decisión del usuario,
 * 26/09/2026). Sin idTema la espera sale en 0.
 */
function _foroCupos_(socio, idTema) {
  var inicioHoy = new Date();
  inicioHoy.setHours(0, 0, 0, 0);
  var manana = new Date();
  manana.setHours(24, 0, 0, 0);

  // ADMIN no tiene cupos ni esperas (decisión del usuario, 26/09/2026).
  if (socio.esAdmin) {
    return { temasSinLimite: true, temasRestantes: null, respuestasSinLimite: true,
             respuestasRestantes: null, esperaRespuestaSeg: 0, renuevaEn: manana.getTime() };
  }

  var CT = CONFIG.COLUMNAS.FORO_TEMAS;
  var temasHoy = _foroFilasDesde_(_foroHoja_('FORO_TEMAS'), CT, 'FECHA_CREACION', inicioHoy.getTime()).filter(function(r) {
    return cleanRut(String(r[CT.RUT_AUTOR])) === socio.rut;
  }).length;

  var cupos = {
    temasSinLimite: false,
    temasRestantes: Math.max(0, FORO_LIMITE_TEMAS_DIA - temasHoy),
    respuestasSinLimite: socio.esModerador,
    respuestasRestantes: null,
    esperaRespuestaSeg: 0,
    renuevaEn: manana.getTime()
  };
  if (socio.esModerador) return cupos;

  // Se lee desde lo que sea más antiguo: el inicio del día (cupo diario) o
  // una hora atrás (espera por tema). A las 00:10, una respuesta de las 23:30
  // de ayer todavía cuenta para la espera, aunque ya no para el cupo.
  var CR = CONFIG.COLUMNAS.FORO_RESPUESTAS;
  var esperaMs = FORO_ESPERA_RESPUESTA_MIN * 60000;
  var desde = Math.min(inicioHoy.getTime(), Date.now() - esperaMs);
  var respuestasHoy = 0, ultimaEnTema = 0;
  _foroFilasDesde_(_foroHoja_('FORO_RESPUESTAS'), CR, 'FECHA', desde).forEach(function(r) {
    if (cleanRut(String(r[CR.RUT_AUTOR])) !== socio.rut) return;
    var ms = _foroMs_(r[CR.FECHA]);
    if (ms >= inicioHoy.getTime()) respuestasHoy++;
    if (idTema && String(r[CR.ID_TEMA]).trim() === idTema) ultimaEnTema = Math.max(ultimaEnTema, ms);
  });
  cupos.respuestasRestantes = Math.max(0, FORO_LIMITE_RESPUESTAS_DIA - respuestasHoy);
  if (ultimaEnTema) cupos.esperaRespuestaSeg = Math.max(0, Math.ceil((ultimaEnTema + esperaMs - Date.now()) / 1000));
  return cupos;
}

/** Mensajes distintos con al menos un reporte pendiente. */
function _foroContarReportesPendientes_() {
  var CP = CONFIG.COLUMNAS.FORO_REPORTES;
  var ids = {};
  _foroLeerTodo_(_foroHoja_('FORO_REPORTES'), CP).forEach(function(r) {
    if (String(r[CP.ESTADO]).trim().toUpperCase() === FORO_ESTADO_REPORTE.PENDIENTE) ids[String(r[CP.ID_OBJETO])] = true;
  });
  return Object.keys(ids).length;
}

/** Pasa los reportes pendientes de un mensaje a RESUELTO o DESCARTADO. Devuelve cuántos. */
function _foroCerrarReportes_(idObjeto, estado, firma, resolucion) {
  var CP = CONFIG.COLUMNAS.FORO_REPORTES;
  var hoja = _foroHoja_('FORO_REPORTES');
  var n = 0;
  _foroBuscarFilas_(hoja, CP.ID_OBJETO, idObjeto).forEach(function(f) {
    var row = _foroLeerFila_(hoja, f, CP);
    if (String(row[CP.ESTADO]).trim().toUpperCase() !== FORO_ESTADO_REPORTE.PENDIENTE) return;
    row[CP.ESTADO] = estado;
    row[CP.RESUELTO_POR] = firma;
    row[CP.FECHA_RESOLUCION] = new Date();
    row[CP.RESOLUCION] = String(resolucion || '').slice(0, 300);
    _foroEscribirFila_(hoja, f, CP, row);
    n++;
  });
  return n;
}

/** Nombre y RUT de un socio para la bandeja de ADMIN. Nunca lanza. */
function _foroNombreSocio_(rut) {
  try {
    var u = obtenerUsuarioPorRut(rut);
    var nombre = (u && u.encontrado !== false) ? String(u.nombre || '').trim() : '';
    return (nombre ? nombre + ' ' : '') + '(' + formatRutDisplay(rut) + ')';
  } catch (e) {
    return formatRutDisplay(rut);
  }
}

/**
 * Rol con que escribió el autor: SOCIO, DIRIGENTE, DIRECTORIO o ADMIN. Es una
 * foto al momento de escribir, como NOMBRE_AUTOR: un dirigente que deja el
 * cargo sigue apareciendo como dirigente en lo que escribió siéndolo. TESTING
 * se guarda como SOCIO. Sin la columna configurada (falta correr
 * _configurarForo() en este proyecto) el mensaje se guarda igual, sin rol.
 */
function _foroFirmarRol_(row, COL, socio) {
  // El cargo en la empresa es la misma clase de foto que el nombre y el rol:
  // un mensaje conserva el cargo que el socio tenía cuando lo escribió.
  if (COL.CARGO_AUTOR !== undefined) row[COL.CARGO_AUTOR] = socio.cargo || '';
  else Logger.log('⚠️ CONFIG sin CARGO_AUTOR del foro — ejecuta _configurarForo(). El cargo NO se guardó.');
  if (COL.ROL_AUTOR === undefined) {
    Logger.log('⚠️ CONFIG sin ROL_AUTOR del foro — ejecuta _configurarForo(). El rol NO se guardó.');
    return;
  }
  row[COL.ROL_AUTOR] = FORO_MODERADORES.indexOf(socio.rol) !== -1 ? socio.rol : 'SOCIO';
}

/** Cargo del registro del socio, sin marcadores de "sin dato". */
function _foroCargoLimpio_(valor) {
  var c = String(valor == null ? '' : valor).replace(/\s+/g, ' ').trim();
  if (/^(-+|—|S\/?D|N\/?A|SIN CARGO)$/i.test(c)) return '';
  return c.slice(0, 60);
}

// ============================================================
// MODELO: fila de la hoja ↔ objeto ↔ lo que ve el cliente
// ============================================================

function _foroTemaDesdeFila_(row) {
  var C = CONFIG.COLUMNAS.FORO_TEMAS;
  var s = function(k) { return row[C[k]] == null ? '' : String(row[C[k]]).trim(); };
  return {
    id: s('ID_TEMA'), idCategoria: s('ID_CATEGORIA'),
    titulo: s('TITULO'), texto: row[C.TEXTO] == null ? '' : String(row[C.TEXTO]),
    rut: cleanRut(s('RUT_AUTOR')), autor: s('NOMBRE_AUTOR') || 'Socio', rol: s('ROL_AUTOR').toUpperCase(),
    cargo: s('CARGO_AUTOR'),
    creado: _foroMs_(row[C.FECHA_CREACION]), actividad: _foroMs_(row[C.FECHA_ULTIMA_ACTIVIDAD]) || _foroMs_(row[C.FECHA_CREACION]),
    nRespuestas: Number(row[C.N_RESPUESTAS]) || 0,
    estado: s('ESTADO').toUpperCase() || FORO_ESTADO.VISIBLE,
    cerrado: s('CERRADO').toUpperCase() === 'SI', fijado: s('FIJADO').toUpperCase() === 'SI',
    modPor: s('MODERADO_POR'), modFecha: _foroMs_(row[C.FECHA_MODERACION]), modMotivo: s('MOTIVO_MODERACION'),
    nReportes: Number(row[C.N_REPORTES]) || 0,
    editado: _foroMs_(row[C.FECHA_EDICION]),
    textoOriginal: s('TEXTO_ORIGINAL'), tituloOriginal: s('TITULO_ORIGINAL')
  };
}

function _foroRespuestaDesdeFila_(row) {
  var C = CONFIG.COLUMNAS.FORO_RESPUESTAS;
  var s = function(k) { return row[C[k]] == null ? '' : String(row[C[k]]).trim(); };
  return {
    id: s('ID_RESPUESTA'), idTema: s('ID_TEMA'),
    texto: row[C.TEXTO] == null ? '' : String(row[C.TEXTO]),
    rut: cleanRut(s('RUT_AUTOR')), autor: s('NOMBRE_AUTOR') || 'Socio', rol: s('ROL_AUTOR').toUpperCase(),
    cargo: s('CARGO_AUTOR'),
    creado: _foroMs_(row[C.FECHA]),
    estado: s('ESTADO').toUpperCase() || FORO_ESTADO.VISIBLE,
    modPor: s('MODERADO_POR'), modFecha: _foroMs_(row[C.FECHA_MODERACION]), modMotivo: s('MOTIVO_MODERACION'),
    nReportes: Number(row[C.N_REPORTES]) || 0,
    editado: _foroMs_(row[C.FECHA_EDICION]),
    textoOriginal: s('TEXTO_ORIGINAL')
  };
}

/**
 * Lo común a temas y respuestas que puede ver quien pregunta. Nunca sale el
 * RUT de otro socio; a un moderador le llega formateado, junto con el rastro
 * de moderación y la versión original de lo editado.
 */
function _foroVista_(m, socio) {
  var esMio = m.rut === socio.rut;
  var verTexto = m.estado === FORO_ESTADO.VISIBLE || socio.esModerador || (esMio && m.estado === FORO_ESTADO.OCULTO);
  var limiteEdicion = m.creado + FORO_MINUTOS_EDICION * 60000;
  var v = {
    id: m.id, estado: m.estado, esMio: esMio, autor: m.autor, rolAutor: m.rol, cargoAutor: m.cargo || '',
    fecha: m.creado, editado: !!m.editado, verTexto: verTexto,
    puedeEditarHasta: (esMio && m.estado === FORO_ESTADO.VISIBLE && !m.nReportes && Date.now() < limiteEdicion) ? limiteEdicion : 0,
    puedeEditarSinPlazo: esMio && m.estado === FORO_ESTADO.VISIBLE && socio.esAdmin,
    puedeEliminar: esMio && m.estado === FORO_ESTADO.VISIBLE,
    puedeReportar: !esMio && m.estado === FORO_ESTADO.VISIBLE,
    puedeModerar: socio.esModerador && (!esMio || socio.esAdmin) && m.estado !== FORO_ESTADO.ELIMINADO
  };
  if (m.estado === FORO_ESTADO.OCULTO && (esMio || socio.esModerador)) v.motivoModeracion = m.modMotivo;
  if (socio.esModerador) {
    v.moderacion = {
      por: m.modPor, fecha: m.modFecha, automatico: m.modPor === FORO_MODERADO_AUTOMATICO,
      nReportes: m.nReportes, autorRut: formatRutDisplay(m.rut),
      textoOriginal: m.textoOriginal || '', tituloOriginal: m.tituloOriginal || ''
    };
  }
  return v;
}

function _foroTemaParaCliente_(t, socio, nombresCategoria, conTexto) {
  var v = _foroVista_(t, socio);
  v.idCategoria = t.idCategoria;
  v.categoria = nombresCategoria[t.idCategoria] || '';
  v.titulo = v.verTexto ? t.titulo : '';
  if (conTexto) v.texto = v.verTexto ? t.texto : '';
  v.nRespuestas = t.nRespuestas;
  v.ultimaActividad = t.actividad;
  v.cerrado = t.cerrado;
  v.fijado = t.fijado;
  v.archivado = _foroArchivado_(t);
  v.puedeResponder = t.estado === FORO_ESTADO.VISIBLE && !v.archivado && (!t.cerrado || socio.esModerador);
  return v;
}

/**
 * Un tema pasa a "Archivados" al cumplir un mes calendario desde que se abrió
 * (FORO_MESES_VIGENCIA). Se calcula al leer, no se escribe en la hoja: no hay
 * activador que lo mueva ni una columna que pueda quedar desalineada, y
 * desfijar un tema antiguo lo archiva en el acto. Nadie responde un tema
 * archivado, tampoco los moderadores; se sigue pudiendo leer, reportar y
 * moderar.
 */
function _foroArchivado_(t) {
  if (!t || t.fijado || !t.creado) return false;
  var limite = new Date(t.creado);
  limite.setMonth(limite.getMonth() + FORO_MESES_VIGENCIA);
  return Date.now() >= limite.getTime();
}

function _foroRespuestaParaCliente_(r, socio) {
  var v = _foroVista_(r, socio);
  v.idTema = r.idTema;
  v.texto = v.verTexto ? r.texto : '';
  return v;
}

/**
 * Índice de todos los temas sin su texto, para el listado. Se guarda 60 s en
 * el caché bajo una clave con versión: cada escritura sube la versión, así que
 * lo que uno publica se ve al instante. Si no cabe en una entrada del caché
 * (100 KB) se lee de la hoja cada vez, sin más.
 */
function _foroIndiceTemas_() {
  var cache = CacheService.getScriptCache();
  var clave = 'FORO_IDX_' + _foroVersionCache_();
  var enCache = cache.get(clave);
  if (enCache) {
    try { return JSON.parse(enCache); } catch (e) { /* se relee abajo */ }
  }

  var indice = _foroLeerTodo_(_foroHoja_('FORO_TEMAS'), CONFIG.COLUMNAS.FORO_TEMAS).map(function(row) {
    var t = _foroTemaDesdeFila_(row);
    delete t.texto;
    delete t.textoOriginal;
    return t;
  }).filter(function(t) { return t.id; });

  try {
    var json = JSON.stringify(indice);
    if (json.length < 95000) cache.put(clave, json, FORO_CACHE_SEG);
  } catch (e) { /* sin caché: el listado sale igual */ }
  return indice;
}

function _foroVersionCache_() {
  var cache = CacheService.getScriptCache();
  var v = cache.get(FORO_CACHE_VERSION);
  if (!v) {
    v = String(Date.now());
    cache.put(FORO_CACHE_VERSION, v, 21600);
  }
  return v;
}

function _foroInvalidar_() {
  try { CacheService.getScriptCache().put(FORO_CACHE_VERSION, String(Date.now()), 21600); } catch (e) {}
}

/** Categorías ordenadas (ORDEN y luego nombre), incluidas las apagadas. */
function _foroCategorias_() {
  var COL = CONFIG.COLUMNAS.FORO_CATEGORIAS;
  var lista = [];
  _foroLeerTodo_(_foroHoja_('FORO_CATEGORIAS'), COL).forEach(function(row) {
    var id = String(row[COL.ID_CATEGORIA] || '').trim();
    var nombre = String(row[COL.NOMBRE] || '').trim();
    if (!id || !nombre) return;
    lista.push({
      id: id, nombre: nombre,
      descripcion: String(row[COL.DESCRIPCION] || '').trim(),
      orden: parseInt(row[COL.ORDEN], 10) || '',
      activa: String(row[COL.ACTIVA] || '').trim().toUpperCase() !== 'NO'
    });
  });
  lista.sort(function(a, b) { return ((a.orden || 999) - (b.orden || 999)) || a.nombre.localeCompare(b.nombre, 'es'); });
  return lista;
}

/**
 * Datos de la tabla de un tipo de mensaje. Devuelve null si el tipo o el ID
 * no tienen la forma esperada (se valida antes de pasarlos al buscador).
 */
function _foroTabla_(tipo, id) {
  tipo = String(tipo || '').trim().toUpperCase();
  if (tipo === 'TEMA' && _foroIdValido_(id, 'T')) {
    return { tipo: tipo, esTema: true, hoja: _foroHoja_('FORO_TEMAS'), COL: CONFIG.COLUMNAS.FORO_TEMAS, colId: 'ID_TEMA', desdeFila: _foroTemaDesdeFila_ };
  }
  if (tipo === 'RESPUESTA' && _foroIdValido_(id, 'R')) {
    return { tipo: tipo, esTema: false, hoja: _foroHoja_('FORO_RESPUESTAS'), COL: CONFIG.COLUMNAS.FORO_RESPUESTAS, colId: 'ID_RESPUESTA', desdeFila: _foroRespuestaDesdeFila_ };
  }
  return null;
}

// ============================================================
// TEXTO
// ============================================================

/**
 * Normaliza lo que escribe un socio: saltos de línea, sin caracteres de
 * control ni marcas invisibles de dirección (que permiten disfrazar texto),
 * sin espacios de sobra. Los textos de una línea colapsan todo espacio.
 */
function _foroLimpiarTexto_(valor, multilinea) {
  var s = String(valor == null ? '' : valor).replace(/\r\n?/g, '\n');
  s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁦-⁩﻿]/g, '');
  if (!multilinea) return s.replace(/\s+/g, ' ').trim();
  return s.split('\n').map(function(l) { return l.replace(/[ \t]+$/, ''); }).join('\n')
          .replace(/\n{3,}/g, '\n\n').trim();
}

function _foroValidarTitulo_(titulo) {
  if (titulo.length < FORO_LARGO.TITULO_MIN) return 'El título debe tener al menos ' + FORO_LARGO.TITULO_MIN + ' caracteres.';
  if (titulo.length > FORO_LARGO.TITULO) return 'El título puede tener hasta ' + FORO_LARGO.TITULO + ' caracteres.';
  return '';
}

function _foroValidarTexto_(texto, max) {
  if (!texto) return 'Escribe tu mensaje.';
  if (texto.length > max) return 'El mensaje puede tener hasta ' + max + ' caracteres (tiene ' + texto.length + ').';
  return '';
}

// ============================================================
// PLANILLA
// ============================================================

function _foroConfigurado_() {
  if (!CONFIG.SPREADSHEETS.FORO) return false;
  for (var i = 0; i < FORO_TABLAS.length; i++) {
    if (!CONFIG.HOJAS[FORO_TABLAS[i]] || !CONFIG.COLUMNAS[FORO_TABLAS[i]]) return false;
  }
  return true;
}

var _foroSpreadsheet_ = null;   // una apertura por ejecución

function _foroHoja_(clave) {
  if (!_foroSpreadsheet_) _foroSpreadsheet_ = getSpreadsheet('FORO');
  var hoja = _foroSpreadsheet_.getSheetByName(CONFIG.HOJAS[clave]);
  if (!hoja) throw new Error('Falta la pestaña ' + CONFIG.HOJAS[clave] + ' en BD_FORO — ejecuta _configurarForo().');
  return hoja;
}

function _foroNcol_(COL) {
  return Object.keys(COL).reduce(function(m, k) { return Math.max(m, COL[k] + 1); }, 0);
}

function _foroFilaVacia_(COL) {
  return new Array(_foroNcol_(COL)).fill('');
}

function _foroLeerTodo_(hoja, COL) {
  var n = hoja.getLastRow() - 1;
  if (n < 1) return [];
  return hoja.getRange(2, 1, n, _foroNcol_(COL)).getValues();
}

function _foroLeerFila_(hoja, fila, COL) {
  return hoja.getRange(fila, 1, 1, _foroNcol_(COL)).getValues()[0];
}

/**
 * Formato de cada celda: texto plano ('@') salvo fechas y números. Con '@' un
 * texto que empieza con "=" queda como texto y "1/2" no se vuelve fecha.
 */
function _foroFormatos_(COL) {
  var f = new Array(_foroNcol_(COL)).fill('@');
  Object.keys(COL).forEach(function(k) {
    if (/^FECHA/.test(k)) f[COL[k]] = FORO_FORMATO_FECHA;
    else if (/^N_/.test(k) || k === 'ORDEN' || k === 'VERSION_REGLAS') f[COL[k]] = '0';
  });
  return f;
}

/**
 * Escribe una fila fijando antes el formato de cada celda (ver _foroFormatos_).
 *
 * El formato '@' NO basta contra las fórmulas: setValues interpreta igual un
 * texto que empieza con "=" (probado en DEV el 26/09/2026: "=1+1" quedó como
 * fórmula y se leía 2). Por eso ese texto se escribe con el apóstrofo que
 * Sheets usa para "esto es texto", y que no forma parte del valor leído. Va en
 * CADA escritura, no solo al publicar: editar o moderar reescribe la fila
 * completa con lo que se leyó, y el "=" volvería a convertirse.
 */
function _foroEscribirFila_(hoja, fila, COL, row) {
  var seguro = row.map(function(v) {
    return (typeof v === 'string' && v.charAt(0) === '=') ? "'" + v : v;
  });
  var rango = hoja.getRange(fila, 1, 1, seguro.length);
  rango.setNumberFormats([_foroFormatos_(COL)]);
  rango.setValues([seguro]);
}

function _foroNuevoId_(prefijo) {
  return prefijo + Utilities.getUuid().replace(/-/g, '').slice(0, 12).toUpperCase();
}

/** Un ID con la forma exacta que genera _foroNuevoId_ (lo demás ni se busca). */
function _foroIdValido_(id, prefijo) {
  return new RegExp('^' + prefijo + '[0-9A-F]{12}$').test(String(id || ''));
}

/** Primera fila (1-based) cuya columna colIdx es exactamente valor, o -1. */
function _foroBuscarFila_(hoja, colIdx, valor) {
  var filas = _foroBuscarFilas_(hoja, colIdx, valor);
  return filas.length ? filas[0] : -1;
}

/** Todas las filas (1-based, ascendentes) cuya columna colIdx es exactamente valor. */
function _foroBuscarFilas_(hoja, colIdx, valor) {
  valor = String(valor || '').trim();
  var n = hoja.getLastRow() - 1;
  if (!valor || n < 1) return [];
  return hoja.getRange(2, colIdx + 1, n, 1)
    .createTextFinder(valor).matchEntireCell(true).matchCase(true)
    .findAll()
    .map(function(celda) { return celda.getRow(); })
    .sort(function(a, b) { return a - b; });
}

/**
 * Filas escritas desde `desde` (ms), leyendo desde el final hacia arriba en
 * bloques hasta encontrar una más antigua. Se apoya en que las filas se
 * agregan siempre al final y en orden, bajo candado: por eso las hojas del
 * foro no se ordenan a mano.
 */
function _foroFilasDesde_(hoja, COL, claveFecha, desde) {
  var ncol = _foroNcol_(COL);
  var BLOQUE = 200;
  var resultado = [];
  var ultima = hoja.getLastRow();
  while (ultima >= 2) {
    var primera = Math.max(2, ultima - BLOQUE + 1);
    var valores = hoja.getRange(primera, 1, ultima - primera + 1, ncol).getValues();
    for (var i = valores.length - 1; i >= 0; i--) {
      var ms = _foroMs_(valores[i][COL[claveFecha]]);
      if (ms && ms < desde) return resultado;
      resultado.push(valores[i]);
    }
    ultima = primera - 1;
  }
  return resultado;
}

/** Valor de celda → milisegundos, o 0. */
function _foroMs_(v) {
  if (v === '' || v == null) return 0;
  if (v instanceof Date) return isNaN(v.getTime()) ? 0 : v.getTime();
  if (typeof v === 'number') return v;
  var d = parsearFechaFlexible(v);
  return d ? d.getTime() : 0;
}

// ============================================================
// PREPARACIÓN DE LA PLANILLA (la llama _configurarForo)
// ============================================================

/**
 * Crea las pestañas que falten con sus encabezados, fija el formato de cada
 * columna, reaplica listas desplegables y notas, y siembra categorías de
 * partida si no hay ninguna. Nunca toca filas con datos. El guion bajo final
 * la deja fuera del alcance de google.script.run.
 */
function _prepararHojasForo_() {
  _ensureConfig();
  var ss = getSpreadsheet('FORO');
  var ENCABEZADO = { fondo: '#0f172a', letra: '#ffffff' };
  var lista = function(valores) {
    return SpreadsheetApp.newDataValidation().requireValueInList(valores, true).setAllowInvalid(false).build();
  };
  var notas = {
    FORO_CATEGORIAS: {
      ID_CATEGORIA: 'Lo genera la app. No editar.',
      ACTIVA: 'SI = recibe temas nuevos. NO = apagada: sus temas se siguen leyendo. No borrar filas.',
      ORDEN: 'Opcional. 1 sale primero.'
    },
    FORO_TEMAS: {
      ID_TEMA: 'Lo genera la app. No editar. No ordenar esta hoja: los cupos diarios la leen desde abajo.',
      ESTADO: 'VISIBLE · OCULTO (moderación) · ELIMINADO_AUTOR. Nada se borra.',
      TEXTO_ORIGINAL: 'Primera versión de un mensaje editado. Solo la ven los moderadores.'
    },
    FORO_RESPUESTAS: {
      ID_RESPUESTA: 'Lo genera la app. No editar. No ordenar esta hoja: los cupos diarios la leen desde abajo.',
      ESTADO: 'VISIBLE · OCULTO (moderación) · ELIMINADO_AUTOR. Nada se borra.'
    },
    FORO_REPORTES: {
      ESTADO: 'PENDIENTE · RESUELTO (se ocultó) · DESCARTADO (se mantuvo).'
    },
    FORO_REGLAS: {
      VERSION_REGLAS: 'Versión de las reglas que aceptó. Si sube FORO_VERSION_REGLAS, todos deben aceptar de nuevo.'
    }
  };
  var listas = {
    FORO_CATEGORIAS: { ACTIVA: ['SI', 'NO'] },
    FORO_TEMAS: { ESTADO: [FORO_ESTADO.VISIBLE, FORO_ESTADO.OCULTO, FORO_ESTADO.ELIMINADO], CERRADO: ['SI', 'NO'], FIJADO: ['SI', 'NO'] },
    FORO_RESPUESTAS: { ESTADO: [FORO_ESTADO.VISIBLE, FORO_ESTADO.OCULTO, FORO_ESTADO.ELIMINADO] },
    FORO_REPORTES: { ESTADO: [FORO_ESTADO_REPORTE.PENDIENTE, FORO_ESTADO_REPORTE.RESUELTO, FORO_ESTADO_REPORTE.DESCARTADO], TIPO: ['TEMA', 'RESPUESTA'] },
    FORO_REGLAS: {}
  };

  FORO_TABLAS.forEach(function(clave) {
    var COL = CONFIG.COLUMNAS[clave];
    var nombre = CONFIG.HOJAS[clave];
    var hoja = ss.getSheetByName(nombre) || ss.insertSheet(nombre);
    var claves = Object.keys(COL).sort(function(a, b) { return COL[a] - COL[b]; });
    var ncol = _foroNcol_(COL);
    if (hoja.getMaxColumns() < ncol) hoja.insertColumnsAfter(hoja.getMaxColumns(), ncol - hoja.getMaxColumns());

    // Encabezados: solo las celdas vacías (una columna agregada después se suma sola).
    var actuales = hoja.getRange(1, 1, 1, ncol).getValues()[0];
    claves.forEach(function(k) {
      if (String(actuales[COL[k]]).trim() === '') hoja.getRange(1, COL[k] + 1).setValue(k);
    });
    hoja.getRange(1, 1, 1, ncol).setFontWeight('bold').setBackground(ENCABEZADO.fondo).setFontColor(ENCABEZADO.letra);
    hoja.setFrozenRows(1);

    // Formato por columna para las filas existentes y las que vienen. La app
    // igual lo reaplica fila a fila al escribir (_foroEscribirFila_).
    var filas = Math.max(1, hoja.getMaxRows() - 1);
    var formatos = _foroFormatos_(COL);
    formatos.forEach(function(f, i) { hoja.getRange(2, i + 1, filas, 1).setNumberFormat(f); });

    Object.keys(listas[clave]).forEach(function(k) {
      hoja.getRange(2, COL[k] + 1, filas, 1).setDataValidation(lista(listas[clave][k]));
    });
    var notasTabla = notas[clave] || {};
    hoja.getRange(1, 1, 1, ncol).setNotes([claves.map(function(k) { return notasTabla[k] || ''; })]);
  });

  // La hoja por defecto de una planilla nueva, si quedó vacía, sobra.
  ['Hoja 1', 'Sheet1', 'Hoja1'].forEach(function(n) {
    var h = ss.getSheetByName(n);
    if (h && h.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(h);
  });

  // Categorías de partida, solo si no hay ninguna. ADMIN las cambia desde la app.
  var CC = CONFIG.COLUMNAS.FORO_CATEGORIAS;
  var hojaC = ss.getSheetByName(CONFIG.HOJAS.FORO_CATEGORIAS);
  var sembradas = 0;
  if (hojaC.getLastRow() < 2) {
    [
      ['Conversación general', 'Temas de interés para todos los socios.'],
      ['Consultas y dudas', 'Preguntas sobre beneficios, trámites y el día a día en el trabajo.'],
      ['Contrato colectivo y derechos', 'Conversemos sobre lo que dice el contrato y la ley.']
    ].forEach(function(c, i) {
      var row = _foroFilaVacia_(CC);
      row[CC.ID_CATEGORIA] = _foroNuevoId_('C');
      row[CC.NOMBRE] = c[0];
      row[CC.DESCRIPCION] = c[1];
      row[CC.ORDEN] = i + 1;
      row[CC.ACTIVA] = 'SI';
      row[CC.CREADA_POR] = 'Configuración inicial';
      row[CC.ACTUALIZADA_POR] = 'Configuración inicial';
      row[CC.FECHA_ACTUALIZACION] = new Date();
      _foroEscribirFila_(hojaC, hojaC.getLastRow() + 1, CC, row);
      sembradas++;
    });
  }
  SpreadsheetApp.flush();
  _foroInvalidar_();

  Logger.log('✅ BD_FORO preparada: ' + FORO_TABLAS.map(function(k) { return CONFIG.HOJAS[k]; }).join(', ') +
             (sembradas ? '. Se crearon ' + sembradas + ' categorías de partida.' : '. Las filas existentes no se tocaron.'));
}
