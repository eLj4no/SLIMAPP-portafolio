// ==========================================
// BANCO_PREGUNTAS_SYNC.GS — exportar el banco para trabajarlo como codigo
// ==========================================
//
// POR QUE EXISTE
// --------------
// El contenido del BANCO_PREGUNTAS solo vive en la planilla, que no esta en el
// repositorio: no hay historial, no se puede revisar un cambio antes de que los
// socios lo vean, y validar los sesgos (letra, longitud) obliga a leer la hoja
// entera cada vez. La copia de trabajo vive en `banco/preguntas.json`, en git y
// **fuera** del proyecto GAS (ver `.claspignore`).
//
// Esta funcion es el puente en un solo sentido: **hoja → archivo**. La hoja
// sigue siendo la fuente de verdad en runtime, y se sigue pudiendo editar a
// mano; exportar es lo que permite que el archivo se ponga al dia con esas
// ediciones en vez de pisarlas.
//
// El camino inverso (archivo → hoja) NO se hace desde aqui y NO es un volcado
// completo: se genera un archivo de parches acotado, se revisa y se aplica. Un
// "reemplazar todo" borraria en silencio cualquier ajuste hecho a mano en la
// planilla — una pregunta desactivada con ACTIVA, un XP afinado, una correccion
// de ultima hora.
//
// Los parches ya aplicados se borraron del repositorio el 28/09/2026 y se
// recuperan con `git show 2475990:<archivo>`. Los del 09/09/2026:
//
//   CargaPreguntasQuest.js    96 preguntas nuevas (PQ201-PQ296)
//   CorregirOpcionesQuest.js  el sesgo de longitud de 133 preguntas viejas
//   CorregirTildesQuest.js    la acentuacion de esas mismas 96
//   CargaEscenariosQuest.js   6 escenarios, y desactivo los 3 de prueba
//   CargaPreguntasRIOHS.js    40 preguntas del reglamento interno de ISS
//
// (mas CorregirJornadaQuest.js, y del 23/09 ReclasificarNivelQuest.js y
// EquilibrarLargoQuest.js). Nunca vivieron en el bundle mas de lo necesario:
// juntos pasan los 300 KB que Apps Script parsea en cada ejecucion.
//
// Nota: BANCO_ESCENARIOS no tiene exportador propio. Su contenido es chico y
// `_diagnosticarEscenariosQuest()` alcanza para revisarlo; si algun dia crece
// como el banco de preguntas, conviene darle el mismo tratamiento.
//
// Esta funcion SI se queda: exportar es parte del flujo permanente.
//
// COMO SE CORRE (desde el editor GAS)
// -----------------------------------
// Crea la propiedad de script PERMITIR_EXPORTAR_BANCO con valor SI y ejecuta
// `_exportarBancoPreguntasDesdeEditor()`. La propiedad se borra sola.
//
// Deja en Drive uno o mas archivos `BANCO_PREGUNTAS_<fecha>_parteN.json` y
// escribe sus URLs en el Logger. Se parte en trozos porque un JSON con el banco
// completo pasa de los 250 KB y las herramientas que lo leen despues lo cortan
// a la mitad sin avisar.
//
// Los archivos quedan restringidos con `_restringirAccesoDrive()`: el dominio
// Workspace adjunta un permiso de organizacion a cada archivo nuevo, y aunque
// el banco no tiene datos personales, no hay razon para publicar la pauta de
// respuestas del quiz a toda la empresa.
// ==========================================

var BANCO_EXPORT_POR_PARTE = 100;


/**
 * Exporta el banco completo a Drive, en trozos de `BANCO_EXPORT_POR_PARTE`.
 *
 * ADMIN-only. Solo lee: no escribe una sola celda de la planilla.
 */
function exportarBancoPreguntas(rutSolicitante) {
  _ensureConfig();
  var permiso = verificarRolUsuario(rutSolicitante, ['ADMIN']);
  if (!permiso.autorizado) {
    Logger.log('⛔ exportarBancoPreguntas: no autorizado (rutSolicitante="' +
               (rutSolicitante || '') + '"). Desde el editor usa _exportarBancoPreguntasDesdeEditor().');
    return { success: false, message: 'No autorizado.' };
  }
  return _exportarBancoPreguntasImpl_();
}


/**
 * Implementacion, ya sin control de acceso.
 */
function _exportarBancoPreguntasImpl_() {
  _ensureConfig();
  try {
    var sheet = getSheet('GAMIFICACION', 'BANCO_PREGUNTAS');
    if (!sheet) return { success: false, message: 'No se encontro la hoja BANCO_PREGUNTAS.' };

    var COL = CONFIG.COLUMNAS.BANCO_PREGUNTAS;
    if (COL.FUENTE === undefined) {
      return { success: false, message: 'CONFIG.COLUMNAS.BANCO_PREGUNTAS incompleta.' };
    }

    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return { success: false, message: 'El banco esta vacio.' };

    // getDisplayValues y no getValues: se quiere el texto tal como lo ve quien
    // edita la hoja, sin que un numero o una fecha se transformen al pasar por
    // JSON y vuelvan distintos.
    var data = sheet.getRange(2, 1, lastRow - 1, COL.FUENTE + 1).getDisplayValues();

    var preguntas = [];
    for (var i = 0; i < data.length; i++) {
      var f = data[i];
      // La fila de la hoja se guarda para poder señalar exactamente donde esta
      // cada pregunta cuando algo no calce.
      preguntas.push({
        fila:        i + 2,
        id:          String(f[COL.ID] || '').trim(),
        categoria:   String(f[COL.CATEGORIA] || '').trim(),
        nivel:       String(f[COL.NIVEL] || '').trim(),
        pregunta:    String(f[COL.PREGUNTA] || ''),
        a:           String(f[COL.OPCION_A] || ''),
        b:           String(f[COL.OPCION_B] || ''),
        c:           String(f[COL.OPCION_C] || ''),
        d:           String(f[COL.OPCION_D] || ''),
        respuesta:   String(f[COL.RESPUESTA] || '').trim(),
        explicacion: String(f[COL.EXPLICACION] || ''),
        xp:          String(f[COL.XP] || '').trim(),
        activa:      String(f[COL.ACTIVA] || '').trim(),
        fuente:      String(f[COL.FUENTE] || '').trim()
      });
    }

    var fecha  = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd_HH-mm');
    var partes = Math.ceil(preguntas.length / BANCO_EXPORT_POR_PARTE);
    var urls   = [];

    for (var p = 0; p < partes; p++) {
      var trozo = preguntas.slice(p * BANCO_EXPORT_POR_PARTE, (p + 1) * BANCO_EXPORT_POR_PARTE);
      var nombre = 'BANCO_PREGUNTAS_' + fecha + '_parte' + (p + 1) + 'de' + partes + '.json';
      var contenido = JSON.stringify({
        exportado: fecha,
        parte: (p + 1), de: partes,
        total: preguntas.length,
        preguntas: trozo
      }, null, 1);

      var archivo = DriveApp.createFile(nombre, contenido, MimeType.PLAIN_TEXT);
      try {
        _restringirAccesoDrive(archivo.getId());
      } catch (eR) {
        // Nunca aborta la exportacion: el archivo ya existe y es lo que importa.
        Logger.log('⚠️ no se pudo restringir ' + nombre + ': ' + eR);
      }
      urls.push(nombre + ' → ' + archivo.getUrl());
    }

    var msg = 'Exportadas ' + preguntas.length + ' preguntas en ' + partes + ' archivo(s).';
    Logger.log('📤 exportarBancoPreguntas — ' + msg);
    for (var u = 0; u < urls.length; u++) Logger.log('   ' + urls[u]);

    return { success: true, message: msg, total: preguntas.length, partes: partes, urls: urls };

  } catch (e) {
    Logger.log('❌ exportarBancoPreguntas: ' + e.toString());
    return { success: false, message: 'Error: ' + e.toString() };
  }
}


/**
 * Atajo para el editor GAS, con la misma puerta autoclausurante que el resto
 * de las utilidades del banco: la propiedad se borra ANTES de actuar.
 *
 * No devuelve nada: lo que interesa son las URLs, y quedan en el Logger.
 */
function _exportarBancoPreguntasDesdeEditor() {
  var props = PropertiesService.getScriptProperties();
  if (String(props.getProperty('PERMITIR_EXPORTAR_BANCO') || '').toUpperCase().trim() !== 'SI') {
    Logger.log('⛔ Puerta cerrada. Crea la propiedad de script PERMITIR_EXPORTAR_BANCO ' +
               'con valor SI y vuelve a ejecutar.');
    return;
  }
  props.deleteProperty('PERMITIR_EXPORTAR_BANCO');
  Logger.log('🔓 Puerta consumida y cerrada.');

  var r = _exportarBancoPreguntasImpl_();
  Logger.log(r && r.success ? '✅ ' + r.message : '❌ ' + (r ? r.message : 'sin resultado'));
}
