// ============================================================
// MÓDULO NOTICIAS — carrusel del inicio
// ============================================================
// Las noticias viven en la planilla propia BD_NOTICIAS (CONFIG.SPREADSHEETS
// .NOTICIAS), pestaña CONFIG.HOJAS.NOTICIAS, una fila por noticia. La edita
// una persona a mano: todo lo que sale de acá se trata como texto (el cliente
// lo pinta con textContent) y los enlaces solo se aceptan con https.
//
// Columnas (CONFIG.COLUMNAS.NOTICIAS):
//   ACTIVA · TIPO · TITULO · BAJADA · DESDE · HASTA · ZONA · BOTON · ABRE · ENLACE · ORDEN
//   · PUBLICADO_POR · ACTUALIZADO_POR · FECHA_ACTUALIZACION   (las escribe el formulario)
//
// Publica solo ADMIN, desde la tarjeta "Noticias" del inicio (vista
// noticias-admin-view): listarNoticiasAdmin / guardarNoticiaAdmin /
// cambiarEstadoNoticiaAdmin. La hoja sigue editable a mano como respaldo.
//
// Configuración: _configurarNoticias() en config_local.js, una vez en DEV y
// otra en PROD. Esa misma función prepara la hoja y le reaplica listas y notas.
// ============================================================

var NOTICIAS_CACHE_CLAVE = 'NOTICIAS_INICIO_V1';
var NOTICIAS_CACHE_SEG   = 300;   // una noticia nueva o editada tarda hasta 5 min en verse
var NOTICIAS_MAX         = 6;     // más que esto en un carrusel nadie lo llega a ver
var NOTICIAS_TIPOS       = ['ACTIVIDAD', 'NOTICIA', 'PLAZO', 'AVISO'];

// Largo máximo de cada texto: el banner mide lo mismo en todos los celulares
// y un título de tres líneas empuja el botón fuera de la tarjeta.
var NOTICIAS_LARGO = { TITULO: 70, BAJADA: 110, BOTON: 30 };

// Opción de ZONA para una noticia nacional. La celda vacía vale lo mismo,
// para que un olvido no esconda la noticia, pero la opción explícita deja
// claro que fue a propósito.
var NOTICIAS_TODAS_LAS_ZONAS = 'TODAS LAS ZONAS';

// Opción de ABRE que dice "este botón es un enlace, no un módulo". El ENLACE
// se usa SOLO con esta opción: así nunca hay que adivinar cuál de las dos
// columnas manda cuando vienen ambas llenas.
var NOTICIAS_ABRE_ENLACE = 'Enlace externo (columna ENLACE)';

// Lo que la persona elige en la columna ABRE (los mismos nombres de las
// tarjetas del inicio) → lo que el cliente le pasa a navAction().
// "Mi credencial" no está: no es un módulo, es un modal.
var NOTICIAS_DESTINOS = {
  'Justificar inasistencia':  { modulo: 'Justificaciones' },
  'Apelar una multa':         { modulo: 'Apelaciones' },
  'Permiso médico':           { modulo: 'PermisoMedico' },
  'Pedir un préstamo':        { modulo: 'Prestamos' },
  'Trámites con la empresa':  { modulo: 'DenunciasInternas', subseccion: 'gestiones' },
  'Denunciar a una jefatura': { modulo: 'DenunciasInternas', subseccion: 'jefatura' },
  'Mis datos':                { modulo: 'Mis Datos' },
  'Mi participación':         { modulo: 'RegistroAsistencia' },
  'Contrato colectivo':       { modulo: 'ContratoColectivo' },
  'Horas extra':              { modulo: 'CalculadoraHE' },
  'SLIM Quest':               { modulo: 'MiProgreso' },
  'Foro':                     { modulo: 'Foro' }
};

/**
 * Noticias vigentes para el socio de la sesión, ya ordenadas.
 *
 * Recibe el token de sesión, no un RUT: la zona se resuelve en el servidor y
 * el navegador solo recibe las noticias que le tocan. Sin sesión válida (el
 * caché de sesiones puede fallar) no se corta nada: se entregan solo las
 * nacionales, que son las que le tocan a cualquiera.
 *
 * @param {string} sessionToken
 * @return {{success: boolean, noticias: Array}}
 */
function obtenerNoticiasInicio(sessionToken) {
  _ensureConfig();

  try {
    var todas = _leerNoticiasConCache_();
    if (!todas.length) return { success: true, noticias: [] };

    var zonaSocio = '';
    var rut = obtenerRutDeSesion(sessionToken);
    if (rut) {
      var usuario = obtenerUsuarioPorRut(rut);
      if (usuario && usuario.encontrado !== false) zonaSocio = _normalizarRegionParaComparar(usuario.region);
    }

    var ahora = new Date().getTime();
    var lista = todas.filter(function(n) {
      if (n.desde && ahora < n.desde) return false;
      if (n.hasta && ahora > n.hasta) return false;
      // Noticia regional: solo para su zona. Un socio sin zona ve solo las nacionales.
      if (n.zona && n.zona !== zonaSocio) return false;
      return true;
    });

    return {
      success: true,
      noticias: lista.slice(0, NOTICIAS_MAX).map(function(n) {
        return {
          tipo: n.tipo, titulo: n.titulo, bajada: n.bajada,
          textoBoton: n.textoBoton, modulo: n.modulo, subseccion: n.subseccion, url: n.url
        };
      })
    };
  } catch (e) {
    // El carrusel es accesorio: si falla, el inicio se ve igual que sin él.
    Logger.log('⚠️ obtenerNoticiasInicio: ' + e.toString());
    return { success: false, noticias: [] };
  }
}

/**
 * Todas las noticias ACTIVAS de la hoja, ordenadas y ya validadas, con fechas
 * en milisegundos. La vigencia por fecha y la zona NO se filtran acá: el
 * caché dura 5 minutos y una noticia puede entrar o salir de su rango dentro
 * de ese lapso, así que eso se decide en cada pedido.
 */
function _leerNoticiasConCache_() {
  var cache = CacheService.getScriptCache();
  var enCache = cache.get(NOTICIAS_CACHE_CLAVE);
  if (enCache) {
    try { return JSON.parse(enCache); } catch (e) { /* se relee abajo */ }
  }

  var COL = CONFIG.COLUMNAS.NOTICIAS;
  if (!COL || !CONFIG.SPREADSHEETS.NOTICIAS) {
    Logger.log('⚠️ Noticias sin configurar — ejecuta _configurarNoticias() en este proyecto.');
    return [];
  }
  var hoja = getSpreadsheet('NOTICIAS').getSheetByName(CONFIG.HOJAS.NOTICIAS);
  if (!hoja || hoja.getLastRow() < 2) return [];

  var filas = hoja.getRange(2, 1, hoja.getLastRow() - 1, hoja.getLastColumn()).getValues();
  var noticias = [];
  filas.forEach(function(row, i) {
    var n = _noticiaDesdeFila_(row, COL, i + 2);
    if (n) noticias.push(n);
  });
  noticias.sort(function(a, b) { return (a.orden - b.orden) || (a.fila - b.fila); });

  try { cache.put(NOTICIAS_CACHE_CLAVE, JSON.stringify(noticias), NOTICIAS_CACHE_SEG); }
  catch (e) { Logger.log('⚠️ Noticias: no se pudo guardar en caché — ' + e); }
  return noticias;
}

/**
 * Convierte una fila en noticia, o devuelve null si no se debe mostrar. Una
 * fila con un dato mal escrito se descarta entera y queda en el log: mostrar
 * una noticia a medias (sin fecha de término, o en la zona equivocada) es
 * peor que no mostrarla.
 */
function _noticiaDesdeFila_(row, COL, numFila) {
  var texto = function(k) { return String(row[COL[k]] == null ? '' : row[COL[k]]).trim(); };

  if (texto('ACTIVA').toUpperCase() !== 'SI') return null;
  var titulo = texto('TITULO');
  if (!titulo) return null;

  var tipo = texto('TIPO').toUpperCase();
  if (NOTICIAS_TIPOS.indexOf(tipo) === -1) tipo = 'AVISO';

  var desde = null, hasta = null;
  if (texto('DESDE')) {
    var d = parsearFechaFlexible(row[COL.DESDE]);
    if (!d) { Logger.log('⚠️ Noticia fila ' + numFila + ': DESDE ilegible ("' + texto('DESDE') + '"). No se muestra.'); return null; }
    desde = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0).getTime();
  }
  if (texto('HASTA')) {
    var h = parsearFechaFlexible(row[COL.HASTA]);
    if (!h) { Logger.log('⚠️ Noticia fila ' + numFila + ': HASTA ilegible ("' + texto('HASTA') + '"). No se muestra.'); return null; }
    // HASTA incluye el día completo: "hasta el 15" es hasta las 23:59 del 15.
    hasta = new Date(h.getFullYear(), h.getMonth(), h.getDate(), 23, 59, 59).getTime();
  }

  // Botón: ABRE decide a dónde lleva. Un módulo de NOTICIAS_DESTINOS, o
  // NOTICIAS_ABRE_ENLACE para usar la columna ENLACE (solo https). Sin
  // destino válido la noticia se muestra igual, pero sin botón.
  var textoBoton = texto('BOTON').slice(0, NOTICIAS_LARGO.BOTON);
  var abre = texto('ABRE');
  var destino = NOTICIAS_DESTINOS[abre] || null;
  var url = '';
  if (abre === NOTICIAS_ABRE_ENLACE) {
    url = texto('ENLACE');
    if (!/^https:\/\//i.test(url)) {
      Logger.log('⚠️ Noticia fila ' + numFila + ': ABRE pide un enlace, pero ENLACE está vacío o no empieza con https://. Sin botón.');
      url = '';
    }
  } else if (abre && !destino) {
    Logger.log('⚠️ Noticia fila ' + numFila + ': ABRE "' + abre + '" no es un destino conocido. Sin botón.');
  }
  if (!destino && !url) textoBoton = '';

  var orden = parseInt(texto('ORDEN'), 10);

  return {
    fila: numFila,
    tipo: tipo,
    titulo: titulo.slice(0, NOTICIAS_LARGO.TITULO),
    bajada: texto('BAJADA').slice(0, NOTICIAS_LARGO.BAJADA),
    desde: desde,
    hasta: hasta,
    // '' = nacional: celda vacía o NOTICIAS_TODAS_LAS_ZONAS.
    zona: (texto('ZONA').toUpperCase() === NOTICIAS_TODAS_LAS_ZONAS) ? '' : _normalizarRegionParaComparar(texto('ZONA')),
    textoBoton: textoBoton,
    modulo: destino ? destino.modulo : '',
    subseccion: destino && destino.subseccion ? destino.subseccion : '',
    url: url,
    orden: isNaN(orden) ? 999 : orden
  };
}

/**
 * Deja la hoja de noticias lista para editar a mano: encabezados, listas
 * desplegables (para que TIPO, ZONA y ABRE no se escriban mal), formato de
 * fecha y una nota en cada encabezado que explica cómo se llena.
 *
 * Se puede correr cuantas veces haga falta: las listas y las notas se vuelven
 * a aplicar (así una hoja ya en uso recibe las opciones nuevas y una zona
 * nueva de BD_SLIMAPP entra a la lista), pero los encabezados y la fila de
 * ejemplo se escriben SOLO si la hoja está vacía. Nunca toca las noticias.
 * La llama _configurarNoticias(); el guion bajo final la deja fuera del
 * alcance de google.script.run.
 */
function _prepararHojaNoticias_() {
  _ensureConfig();
  var COL = CONFIG.COLUMNAS.NOTICIAS;
  var ss = getSpreadsheet('NOTICIAS');
  var hoja = ss.getSheetByName(CONFIG.HOJAS.NOTICIAS) || ss.insertSheet(CONFIG.HOJAS.NOTICIAS);
  var claves = Object.keys(COL).sort(function(a, b) { return COL[a] - COL[b]; });
  var ncol = claves.length;
  var nueva = String(hoja.getRange(1, 1).getValue()).trim() === '';

  if (nueva) {
    hoja.getRange(1, 1, 1, ncol).setValues([claves]).setFontWeight('bold').setBackground('#0f172a').setFontColor('#ffffff');
    hoja.setFrozenRows(1);
  } else {
    // Una hoja ya en uso recibe los encabezados de columnas agregadas después
    // (p. ej. las tres de autoría). Solo se escriben celdas vacías.
    var actuales = hoja.getRange(1, 1, 1, ncol).getValues()[0];
    claves.forEach(function(k, i) {
      if (String(actuales[i]).trim() === '') {
        hoja.getRange(1, i + 1).setValue(k).setFontWeight('bold').setBackground('#0f172a').setFontColor('#ffffff');
      }
    });
  }

  var filas = Math.max(500, hoja.getMaxRows() - 1);
  var lista = function(valores) {
    return SpreadsheetApp.newDataValidation().requireValueInList(valores, true).setAllowInvalid(false).build();
  };
  hoja.getRange(2, COL.ACTIVA + 1, filas).setDataValidation(lista(['SI', 'NO']));
  hoja.getRange(2, COL.TIPO + 1, filas).setDataValidation(lista(NOTICIAS_TIPOS));
  hoja.getRange(2, COL.ABRE + 1, filas).setDataValidation(lista(Object.keys(NOTICIAS_DESTINOS).concat([NOTICIAS_ABRE_ENLACE])));
  var fecha = SpreadsheetApp.newDataValidation().requireDate()
    .setHelpText('Escribe una fecha como 15/10/2026, o haz doble clic para elegirla en el calendario.')
    .setAllowInvalid(false).build();
  hoja.getRange(2, COL.DESDE + 1, filas).setDataValidation(fecha).setNumberFormat('dd/mm/yyyy');
  hoja.getRange(2, COL.HASTA + 1, filas).setDataValidation(fecha).setNumberFormat('dd/mm/yyyy');

  var zonas = _zonasActualesDeSocios_();
  hoja.getRange(2, COL.ZONA + 1, filas).setDataValidation(lista([NOTICIAS_TODAS_LAS_ZONAS].concat(zonas)));
  if (!zonas.length) Logger.log('⚠️ No se encontraron zonas en BD_SLIMAPP: la lista de ZONA solo ofrece ' + NOTICIAS_TODAS_LAS_ZONAS + '.');

  // Una nota por encabezado: aparece al pasar el mouse por la celda.
  var notas = {
    ACTIVA: 'SI = se muestra (dentro de sus fechas). NO = guardada pero oculta. Para retirar una noticia, cámbiala a NO en vez de borrar la fila.',
    TIPO:   'Define el color del banner: ACTIVIDAD (naranjo), NOTICIA (ámbar), PLAZO (morado), AVISO (verde azulado).',
    TITULO: 'Obligatorio. Máximo ' + NOTICIAS_LARGO.TITULO + ' caracteres; lo que sobre se corta.',
    BAJADA: 'Opcional. Una línea bajo el título (fecha, hora, lugar). Máximo ' + NOTICIAS_LARGO.BAJADA + ' caracteres.',
    DESDE:  'Opcional. Primer día en que se muestra, desde las 00:00. Formato dd/mm/aaaa (ej. 01/10/2026); doble clic abre un calendario. Vacío = desde ya.',
    HASTA:  'Opcional. Último día en que se muestra, hasta las 23:59. Formato dd/mm/aaaa; doble clic abre un calendario. Vacío = sin fecha de término.',
    ZONA:   'Quién la ve. ' + NOTICIAS_TODAS_LAS_ZONAS + ' (o vacío) = todo el país. Una zona = solo los socios de esa zona.',
    BOTON:  'Opcional. Texto del botón (ej. "¿No puedes ir? Justifica"). Máximo ' + NOTICIAS_LARGO.BOTON + ' caracteres. Sin texto no hay botón.',
    ABRE:   'A dónde lleva el botón: una tarjeta de la app, o "' + NOTICIAS_ABRE_ENLACE + '" para abrir la dirección de ENLACE.',
    ENLACE: 'Solo se usa si ABRE dice "' + NOTICIAS_ABRE_ENLACE + '". Debe empezar con https://',
    ORDEN:  'Opcional. Número: 1 sale primero. Sin número va al final. Se muestran como máximo ' + NOTICIAS_MAX + ' noticias.',
    PUBLICADO_POR:       'Lo escribe la app al crear la noticia desde el formulario. No editar.',
    ACTUALIZADO_POR:     'Lo escribe la app en cada cambio hecho desde el formulario. No editar.',
    FECHA_ACTUALIZACION: 'Lo escribe la app en cada cambio hecho desde el formulario. No editar.'
  };
  hoja.getRange(1, 1, 1, ncol).setNotes([claves.map(function(k) { return notas[k] || ''; })]);

  if (nueva) {
    // Fila de ejemplo, apagada: muestra el formato sin aparecerle a nadie.
    var ejemplo = new Array(ncol).fill('');
    ejemplo[COL.ACTIVA] = 'NO';
    ejemplo[COL.TIPO]   = 'ACTIVIDAD';
    ejemplo[COL.TITULO] = 'Ejemplo: Asamblea ordinaria de octubre';
    ejemplo[COL.BAJADA] = 'Jueves 8 · 19:00 · Virtual';
    ejemplo[COL.ZONA]   = NOTICIAS_TODAS_LAS_ZONAS;
    ejemplo[COL.BOTON]  = '¿No puedes ir? Justifica';
    ejemplo[COL.ABRE]   = 'Justificar inasistencia';
    ejemplo[COL.ORDEN]  = 1;
    hoja.getRange(2, 1, 1, ncol).setValues([ejemplo]);
    hoja.autoResizeColumns(1, ncol);
  }

  Logger.log('✅ Hoja ' + CONFIG.HOJAS.NOTICIAS + (nueva ? ' preparada' : ' actualizada (listas y notas; las noticias no se tocaron)') +
             '. ZONA ofrece ' + NOTICIAS_TODAS_LAS_ZONAS + ' + ' + zonas.length + ' zonas.');
}

/** Zonas (REGION de BD_SLIMAPP) tal como están escritas, sin repetidas ni "sin asignar". */
function _zonasActualesDeSocios_() {
  var hoja = getSheet('USUARIOS', 'USUARIOS');
  var col = CONFIG.COLUMNAS.USUARIOS.REGION;
  if (hoja.getLastRow() < 2 || col === undefined) return [];
  var valores = hoja.getRange(2, col + 1, hoja.getLastRow() - 1, 1).getDisplayValues();
  var vistas = {};
  var zonas = [];
  valores.forEach(function(r) {
    var z = String(r[0] || '').trim();
    var clave = _normalizarRegionParaComparar(z);
    if (!z || _regionSinAsignar(z) || vistas[clave]) return;
    vistas[clave] = true;
    zonas.push(z);
  });
  return zonas.sort();
}


// ============================================================
// ADMINISTRACIÓN (solo ADMIN)
// ============================================================
// Las tres funciones reciben el token de sesión y resuelven quién pide en el
// servidor: un RUT enviado por el navegador se podría falsificar desde la
// consola. Guardar borra el caché, así que un cambio se ve al instante (no a
// los 5 minutos de una edición a mano).
//
// Las filas se identifican por su número, que cambia si alguien borra una
// fila a mano en la hoja. Por eso cada escritura manda también el título que
// tenía la fila al listarla: si ya no coincide, no se escribe nada y se pide
// recargar. Así nunca se pisa la noticia equivocada.

/** ADMIN de la sesión, o {error} con el mensaje para el cliente. */
function _adminDeSesionNoticias_(sessionToken) {
  var rut = obtenerRutDeSesion(sessionToken);
  if (!rut) return { error: 'Tu sesión expiró. Vuelve a ingresar.', sesionExpirada: true };
  var permiso = verificarRolUsuario(rut, ['ADMIN']);
  if (!permiso.autorizado) return { error: 'No tienes permisos para administrar noticias.' };
  var usuario = obtenerUsuarioPorRut(rut);
  var nombre = (usuario && usuario.nombre) ? String(usuario.nombre).trim() : '';
  return { rut: rut, firma: (nombre ? nombre + ' ' : '') + '(' + formatRutDisplay(rut) + ')' };
}

/** Fecha de la hoja → 'yyyy-mm-dd' (lo que espera un <input type="date">), o ''. */
function _fechaParaFormulario_(valor) {
  if (valor === '' || valor == null) return '';
  var d = parsearFechaFlexible(valor);
  return d ? Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd') : '';
}

/** 'yyyy-mm-dd' del formulario → Date a medianoche local, o null. */
function _fechaDesdeFormulario_(texto) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(texto || ''));
  if (!m) return null;
  var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return (d.getMonth() === Number(m[2]) - 1) ? d : null;
}

/**
 * Todas las noticias de la hoja, incluidas las apagadas y las vencidas, más
 * las opciones de cada lista para armar el formulario.
 */
function listarNoticiasAdmin(sessionToken) {
  _ensureConfig();
  try {
    var admin = _adminDeSesionNoticias_(sessionToken);
    if (admin.error) return { success: false, message: admin.error, sesionExpirada: !!admin.sesionExpirada };

    var COL = CONFIG.COLUMNAS.NOTICIAS;
    if (!COL || !CONFIG.SPREADSHEETS.NOTICIAS) return { success: false, message: 'Las noticias no están configuradas en este proyecto.' };
    var hoja = getSpreadsheet('NOTICIAS').getSheetByName(CONFIG.HOJAS.NOTICIAS);
    var noticias = [];
    if (hoja && hoja.getLastRow() >= 2) {
      var ncol = Math.max(hoja.getLastColumn(), COL.ORDEN + 1);
      var filas = hoja.getRange(2, 1, hoja.getLastRow() - 1, ncol).getValues();
      var hoy = new Date(); hoy.setHours(0, 0, 0, 0);
      filas.forEach(function(row, i) {
        var t = function(k) { return (COL[k] === undefined || row[COL[k]] == null) ? '' : String(row[COL[k]]).trim(); };
        if (!t('TITULO')) return;   // fila vacía o a medio escribir a mano
        var desde = _fechaParaFormulario_(row[COL.DESDE]);
        var hasta = _fechaParaFormulario_(row[COL.HASTA]);
        // Estado que ve ADMIN en la lista: el mismo criterio que el carrusel.
        var estado = 'PUBLICADA';
        if (t('ACTIVA').toUpperCase() !== 'SI') estado = 'APAGADA';
        else if (desde && _fechaDesdeFormulario_(desde) > hoy) estado = 'PROGRAMADA';
        else if (hasta && _fechaDesdeFormulario_(hasta) < hoy) estado = 'VENCIDA';
        var fechaAct = COL.FECHA_ACTUALIZACION !== undefined ? row[COL.FECHA_ACTUALIZACION] : '';
        noticias.push({
          fila: i + 2,
          activa: t('ACTIVA').toUpperCase() === 'SI',
          tipo: t('TIPO').toUpperCase(), titulo: t('TITULO'), bajada: t('BAJADA'),
          desde: desde, hasta: hasta, zona: t('ZONA'),
          textoBoton: t('BOTON'), abre: t('ABRE'), enlace: t('ENLACE'), orden: t('ORDEN'),
          estado: estado,
          publicadoPor: t('PUBLICADO_POR'), actualizadoPor: t('ACTUALIZADO_POR'),
          fechaActualizacion: fechaAct instanceof Date ? formatearFechaConHora(fechaAct) : String(fechaAct || '')
        });
      });
    }
    // Primero lo que el socio está viendo, en el orden en que lo ve.
    var peso = { PUBLICADA: 0, PROGRAMADA: 1, VENCIDA: 2, APAGADA: 3 };
    noticias.sort(function(a, b) {
      return (peso[a.estado] - peso[b.estado]) || ((parseInt(a.orden, 10) || 999) - (parseInt(b.orden, 10) || 999)) || (a.fila - b.fila);
    });

    return {
      success: true,
      noticias: noticias,
      opciones: {
        tipos: NOTICIAS_TIPOS,
        zonas: [NOTICIAS_TODAS_LAS_ZONAS].concat(_zonasActualesDeSocios_()),
        destinos: Object.keys(NOTICIAS_DESTINOS),
        abreEnlace: NOTICIAS_ABRE_ENLACE,
        largo: NOTICIAS_LARGO,
        maximo: NOTICIAS_MAX
      }
    };
  } catch (e) {
    Logger.log('❌ listarNoticiasAdmin: ' + e.toString());
    return { success: false, message: 'No se pudieron cargar las noticias. Intenta de nuevo.' };
  }
}

/**
 * Crea (datos.fila vacío) o edita una noticia. Valida todo en el servidor:
 * el formulario ayuda, pero la puerta es esta.
 *
 * @param {string} sessionToken
 * @param {Object} datos {fila, tituloOriginal, activa, tipo, titulo, bajada,
 *   desde, hasta, zona, textoBoton, abre, enlace, orden}; fechas 'yyyy-mm-dd'.
 */
function guardarNoticiaAdmin(sessionToken, datos) {
  _ensureConfig();
  var lock = LockService.getScriptLock();
  try {
    var admin = _adminDeSesionNoticias_(sessionToken);
    if (admin.error) return { success: false, message: admin.error, sesionExpirada: !!admin.sesionExpirada };
    datos = datos || {};

    var limpio = function(v, max) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max || 500); };
    var L = NOTICIAS_LARGO;
    var titulo = limpio(datos.titulo);
    var bajada = limpio(datos.bajada);
    var textoBoton = limpio(datos.textoBoton);
    var tipo = limpio(datos.tipo).toUpperCase();
    var zona = limpio(datos.zona);
    var abre = limpio(datos.abre);
    var enlace = limpio(datos.enlace);
    var orden = limpio(datos.orden);

    if (!titulo) return { success: false, message: 'El título es obligatorio.' };
    if (titulo.length > L.TITULO) return { success: false, message: 'El título puede tener hasta ' + L.TITULO + ' caracteres.' };
    if (bajada.length > L.BAJADA) return { success: false, message: 'La bajada puede tener hasta ' + L.BAJADA + ' caracteres.' };
    if (textoBoton.length > L.BOTON) return { success: false, message: 'El texto del botón puede tener hasta ' + L.BOTON + ' caracteres.' };
    if (NOTICIAS_TIPOS.indexOf(tipo) === -1) return { success: false, message: 'Elige el tipo de noticia.' };

    var zonasValidas = [NOTICIAS_TODAS_LAS_ZONAS].concat(_zonasActualesDeSocios_());
    if (!zona) zona = NOTICIAS_TODAS_LAS_ZONAS;
    if (zonasValidas.indexOf(zona) === -1) return { success: false, message: 'La zona elegida no existe. Recarga la lista y vuelve a elegirla.' };

    if (abre && abre !== NOTICIAS_ABRE_ENLACE && !NOTICIAS_DESTINOS[abre]) return { success: false, message: 'El destino del botón no es válido.' };
    if (textoBoton && !abre) return { success: false, message: 'Elige a dónde lleva el botón, o deja su texto vacío.' };
    if (abre && !textoBoton) return { success: false, message: 'Escribe el texto del botón, o deja "A dónde lleva" vacío.' };
    if (abre === NOTICIAS_ABRE_ENLACE) {
      if (!/^https:\/\/\S+$/i.test(enlace)) return { success: false, message: 'El enlace debe empezar con https:// y no llevar espacios.' };
    } else {
      enlace = '';   // ENLACE solo se usa con la opción de enlace externo
    }

    var desde = datos.desde ? _fechaDesdeFormulario_(datos.desde) : null;
    var hasta = datos.hasta ? _fechaDesdeFormulario_(datos.hasta) : null;
    if (datos.desde && !desde) return { success: false, message: 'La fecha "desde" no es válida.' };
    if (datos.hasta && !hasta) return { success: false, message: 'La fecha "hasta" no es válida.' };
    if (desde && hasta && hasta < desde) return { success: false, message: 'La fecha "hasta" no puede ser anterior a "desde".' };

    if (orden && !/^[1-9]\d?$/.test(orden)) return { success: false, message: 'El orden debe ser un número del 1 al 99.' };

    var COL = CONFIG.COLUMNAS.NOTICIAS;
    if (!lock.tryLock(15000)) return { success: false, message: 'Otra persona está guardando una noticia. Intenta en unos segundos.' };

    var ss = getSpreadsheet('NOTICIAS');
    var hoja = ss.getSheetByName(CONFIG.HOJAS.NOTICIAS);
    if (!hoja) return { success: false, message: 'No se encontró la hoja de noticias.' };
    var ncol = Object.keys(COL).reduce(function(m, k) { return Math.max(m, COL[k] + 1); }, 0);

    var fila = parseInt(datos.fila, 10);
    var esNueva = !fila;
    var row;
    if (esNueva) {
      row = new Array(ncol).fill('');
      fila = hoja.getLastRow() + 1;
    } else {
      if (fila < 2 || fila > hoja.getLastRow()) return { success: false, message: 'La noticia ya no existe en la hoja. Recarga la lista.', recargar: true };
      row = hoja.getRange(fila, 1, 1, ncol).getValues()[0];
      if (String(row[COL.TITULO]).trim() !== String(datos.tituloOriginal || '').trim()) {
        return { success: false, message: 'La hoja cambió desde que abriste esta noticia. Recarga la lista y vuelve a editarla.', recargar: true };
      }
    }

    row[COL.ACTIVA] = datos.activa ? 'SI' : 'NO';
    row[COL.TIPO]   = tipo;
    row[COL.TITULO] = titulo;
    row[COL.BAJADA] = bajada;
    row[COL.DESDE]  = desde || '';
    row[COL.HASTA]  = hasta || '';
    row[COL.ZONA]   = zona;
    row[COL.BOTON]  = textoBoton;
    row[COL.ABRE]   = abre;
    row[COL.ENLACE] = enlace;
    row[COL.ORDEN]  = orden ? Number(orden) : '';
    _firmarNoticia_(row, COL, admin.firma, esNueva);

    hoja.getRange(fila, 1, 1, ncol).setValues([row]);
    SpreadsheetApp.flush();
    CacheService.getScriptCache().remove(NOTICIAS_CACHE_CLAVE);
    Logger.log('📰 Noticia ' + (esNueva ? 'creada' : 'editada') + ' (fila ' + fila + ') por ' + admin.firma + ': ' + titulo);
    return { success: true, fila: fila, message: esNueva ? 'Noticia creada.' : 'Noticia actualizada.' };
  } catch (e) {
    Logger.log('❌ guardarNoticiaAdmin: ' + e.toString());
    return { success: false, message: 'No se pudo guardar la noticia. Intenta de nuevo.' };
  } finally {
    try { lock.releaseLock(); } catch (e2) {}
  }
}

/** Enciende o apaga una noticia sin abrir el formulario. */
function cambiarEstadoNoticiaAdmin(sessionToken, fila, tituloOriginal, activa) {
  _ensureConfig();
  var lock = LockService.getScriptLock();
  try {
    var admin = _adminDeSesionNoticias_(sessionToken);
    if (admin.error) return { success: false, message: admin.error, sesionExpirada: !!admin.sesionExpirada };
    if (!lock.tryLock(15000)) return { success: false, message: 'Otra persona está guardando una noticia. Intenta en unos segundos.' };

    var COL = CONFIG.COLUMNAS.NOTICIAS;
    var hoja = getSpreadsheet('NOTICIAS').getSheetByName(CONFIG.HOJAS.NOTICIAS);
    fila = parseInt(fila, 10);
    if (!hoja || !fila || fila < 2 || fila > hoja.getLastRow()) return { success: false, message: 'La noticia ya no existe en la hoja. Recarga la lista.', recargar: true };

    var ncol = Object.keys(COL).reduce(function(m, k) { return Math.max(m, COL[k] + 1); }, 0);
    var row = hoja.getRange(fila, 1, 1, ncol).getValues()[0];
    if (String(row[COL.TITULO]).trim() !== String(tituloOriginal || '').trim()) {
      return { success: false, message: 'La hoja cambió desde que cargaste la lista. Recárgala e intenta de nuevo.', recargar: true };
    }
    row[COL.ACTIVA] = activa ? 'SI' : 'NO';
    _firmarNoticia_(row, COL, admin.firma, false);
    hoja.getRange(fila, 1, 1, ncol).setValues([row]);
    SpreadsheetApp.flush();
    CacheService.getScriptCache().remove(NOTICIAS_CACHE_CLAVE);
    Logger.log('📰 Noticia fila ' + fila + (activa ? ' encendida' : ' apagada') + ' por ' + admin.firma);
    return { success: true, message: activa ? 'Noticia encendida.' : 'Noticia apagada.' };
  } catch (e) {
    Logger.log('❌ cambiarEstadoNoticiaAdmin: ' + e.toString());
    return { success: false, message: 'No se pudo cambiar el estado. Intenta de nuevo.' };
  } finally {
    try { lock.releaseLock(); } catch (e2) {}
  }
}

/**
 * Escribe la autoría en la fila. Con las columnas sin configurar (falta
 * correr _configurarNoticias() en este proyecto) la noticia se guarda igual,
 * pero sin rastro, y queda dicho en el log: escribir row[undefined] no falla,
 * simplemente se pierde.
 */
function _firmarNoticia_(row, COL, firma, esNueva) {
  if (COL.ACTUALIZADO_POR === undefined || COL.FECHA_ACTUALIZACION === undefined || COL.PUBLICADO_POR === undefined) {
    Logger.log('⚠️ CONFIG sin columnas de autoría de NOTICIAS — ejecuta _configurarNoticias(). La autoría NO se guardó.');
    return;
  }
  if (esNueva || !String(row[COL.PUBLICADO_POR] || '').trim()) row[COL.PUBLICADO_POR] = firma;
  row[COL.ACTUALIZADO_POR] = firma;
  row[COL.FECHA_ACTUALIZACION] = new Date();
}
