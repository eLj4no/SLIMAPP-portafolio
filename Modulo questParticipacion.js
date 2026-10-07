// ==========================================
// MODULO_QUESTPARTICIPACION.GS — SLIM Quest × Participación sindical
// ==========================================
//
// Otorga XP y logros por participar en las actividades sindicales, leyendo el
// resultado mensual que ya calcula `Modulo participacion.js`.
//
// LA DIRECCIÓN DE LA DEPENDENCIA IMPORTA
// --------------------------------------
// SLIM Quest LEE a los demás módulos; ningún módulo llama a SLIM Quest. Se
// evaluó el camino contrario — que préstamos, justificaciones o asistencia
// avisaran al juego cuando pasa algo — y se descartó por dos razones:
//
//   1. Un fallo del juego dentro de `crearSolicitudPrestamo` podría romper un
//      trámite real. Es el mismo criterio por el que `actualizarDatoUsuario` no
//      hace el trabajo de Drive en línea: el socio está esperando la respuesta.
//   2. Con avisos solo contarían los eventos futuros. Un socio con tres años de
//      asistencia perfecta no recibiría nada. Leyendo, su historial cuenta desde
//      el primer día.
//
// QUÉ SE PREMIA Y QUÉ NO
// ----------------------
// Se premia el CUMPLIMIENTO del mes, no el trámite. `ASISTIO`, `JUSTIFICADO` y
// `APELACION_ACOGIDA` son las tres formas de cumplir; asistir vale más que
// justificar, para que nunca se lea como "me conviene faltar y justificar".
//
// No hay ni habrá logros ni XP por préstamos, permisos médicos ni denuncias.
// Son módulos que existen porque al socio le pasó algo malo: premiarlos sería
// premiar el endeudamiento, la enfermedad o el conflicto, y convertiría un
// logro en una marca de mala suerte. La competencia para usar esas
// herramientas se desarrolla y se mide en los Escenarios, sin tocar el evento
// real ni el dato sensible.
//
// ==========================================

var CFG_QUEST_PART = {
  // XP por resultado del mes. Asistir vale más del doble que justificar.
  XP: {
    ASISTIO:           500,
    JUSTIFICADO:       200,
    APELACION_ACOGIDA: 200
  },

  // Resultados que cuentan como cumplimiento.
  CUMPLE: ['ASISTIO', 'JUSTIFICADO', 'APELACION_ACOGIDA'],

  // Resultados que no suman ni rompen la racha: la actividad no le correspondía
  // o el trámite todavía no está resuelto.
  // NO_AFILIADO entra aca por la misma razon que los otros: no se puede premiar
  // ni castigar a un socio por un mes anterior a su afiliacion. Sin esto, quien
  // se afilio hace poco arrancaria con la racha rota de entrada.
  NEUTROS: ['SIN_ACTIVIDAD', 'SIN_REGION', 'EN_REVISION', 'EN_PLAZO', 'NO_AFILIADO'],

  PROP_ULTIMO_MES: 'QUEST_PART_ULTIMO_MES',  // cursor global: último mes aplicado
  PROP_XP_DESDE:   'QUEST_PART_XP_DESDE',    // desde qué mes se paga XP

  // Presupuesto de tiempo. El límite duro de Apps Script son 6 minutos; a los 4
  // se corta y se guarda el cursor, y el mes siguiente lo toma la próxima
  // ejecución.
  LIMITE_MS: 4 * 60 * 1000,

  // Tope de correos de subida de grado por ejecución. Sin tope, el primer mes
  // en que muchos socios cruzan un umbral podría agotar la cuota de MailApp,
  // que es compartida con las notificaciones de trámites — y esas sí no pueden
  // dejar de salir.
  MAX_CORREOS_NIVEL: 150,

  ZONA_HORARIA: 'America/Santiago'
};

// ==========================================
// UTILIDADES DE MES
// ==========================================

function _mesAnterior_(mes) {
  var partes = String(mes).split('-');
  var anio = parseInt(partes[0], 10), num = parseInt(partes[1], 10);
  num--;
  if (num < 1) { num = 12; anio--; }
  return anio + '-' + (num < 10 ? '0' + num : String(num));
}

function _mesSiguiente_(mes) {
  var partes = String(mes).split('-');
  var anio = parseInt(partes[0], 10), num = parseInt(partes[1], 10);
  num++;
  if (num > 12) { num = 1; anio++; }
  return anio + '-' + (num < 10 ? '0' + num : String(num));
}

function _anioDeMes_(mes) { return String(mes).split('-')[0]; }

// ==========================================
// LECTURA Y ESCRITURA MASIVA DE QUEST_ESTADO
// ==========================================
//
// El trabajo recorre ~2.800 socios por mes. Leer y escribir fila por fila sería
// inviable dentro del presupuesto de Apps Script, así que se lee la hoja entera
// una vez, se trabaja en memoria y se escribe una vez.

function _questEstadoLeerTodo_() {
  var hoja = _hojaEstadoQuest_();
  if (!hoja) return null;

  var idx   = _indicesEstadoQuest_(hoja);
  var ancho = Math.max(hoja.getLastColumn(), _ENCABEZADOS_QUEST_ESTADO.length);
  var lastRow = hoja.getLastRow();
  var filas = (lastRow >= 2) ? hoja.getRange(2, 1, lastRow - 1, ancho).getDisplayValues() : [];

  var porRut = {};
  for (var i = 0; i < filas.length; i++) {
    var rut = cleanRut(idx.RUT >= 0 ? filas[i][idx.RUT] : '');
    if (rut) porRut[rut] = i;
  }
  return { hoja: hoja, idx: idx, ancho: ancho, filas: filas, porRut: porRut };
}

/** Lee un campo numérico de una fila cruda de QUEST_ESTADO. */
function _qeNum_(tabla, fila, clave) {
  var i = tabla.idx[clave];
  return (i < 0) ? 0 : (parseInt(fila[i], 10) || 0);
}

/** Lee un campo de lista (CSV) de una fila cruda de QUEST_ESTADO. */
function _qeLista_(tabla, fila, clave) {
  var i = tabla.idx[clave];
  if (i < 0) return [];
  return String(fila[i] || '').split(',').map(function (s) { return s.trim(); })
    .filter(function (s) { return s !== ''; });
}

function _qeTexto_(tabla, fila, clave) {
  var i = tabla.idx[clave];
  return (i < 0) ? '' : String(fila[i] || '').trim();
}

function _qePoner_(tabla, fila, clave, valor) {
  var i = tabla.idx[clave];
  if (i >= 0) fila[i] = valor;
}

function _qeFilaNueva_(tabla, rut) {
  var fila = [];
  for (var i = 0; i < tabla.ancho; i++) fila.push('');
  _qePoner_(tabla, fila, 'RUT', rut);
  return fila;
}

// ==========================================
// EL TRABAJO POR LOTES
// ==========================================

/**
 * Aplica a SLIM Quest la participación de todos los meses cerrados que falten.
 *
 * Activador mensual. Es idempotente: cada socio guarda en `PART_MESES` los
 * meses que ya se le aplicaron, y un mes que figure ahí no se vuelve a contar
 * ni a pagar. Ese registro es la única defensa real contra otorgar XP dos
 * veces, porque el XP entregado no se puede quitar.
 *
 * `rutSolicitante` vacío = ejecución por activador, igual que
 * `respaldarBasesDeDatos`. Con RUT, exige ADMIN.
 */
function questProcesarParticipacion(rutSolicitante) {
  if (activadorFueraDeProduccion_(rutSolicitante, 'questProcesarParticipacion')) return;
  // Un activador pasa su objeto de evento como primer argumento, y ese objeto
  // no es un RUT: validado como tal, terminaba en "No autorizado" y el
  // activador nunca hacía nada. Se normaliza al vacío = modo activador.
  if (esEjecucionDeActivador_(rutSolicitante)) rutSolicitante = '';
  _ensureConfig();

  if (rutSolicitante) {
    var permiso = verificarRolUsuario(rutSolicitante, ['ADMIN']);
    if (!permiso.autorizado) return { success: false, message: 'No autorizado.' };
  }

  var inicio = Date.now();
  var props  = PropertiesService.getScriptProperties();

  try {
    var catalogo = obtenerCatalogoActividades('');
    var todasActividades = (catalogo && catalogo.actividades) ? catalogo.actividades : [];
    if (todasActividades.length === 0) {
      Logger.log('⚠️ questProcesarParticipacion: el catálogo de actividades vino vacío. No se procesa nada.');
      return { success: false, message: 'El catálogo de actividades no está disponible.' };
    }

    var ahora    = new Date();
    var mesActual = Utilities.formatDate(ahora, CFG_QUEST_PART.ZONA_HORARIA, 'yyyy-MM');

    // Desde qué mes se paga XP. Se fija en la PRIMERA ejecución y no se vuelve
    // a mover: los logros son retroactivos (reconocen la trayectoria de quien
    // lleva años asistiendo) pero el XP no, para que el ranking no nazca ya
    // decidido a favor de los socios más antiguos.
    var xpDesde = props.getProperty(CFG_QUEST_PART.PROP_XP_DESDE);
    if (!xpDesde) {
      xpDesde = mesActual;
      props.setProperty(CFG_QUEST_PART.PROP_XP_DESDE, xpDesde);
      Logger.log('ℹ️ Primera ejecución: el XP por participación se pagará desde ' + xpDesde + '. Los meses anteriores solo otorgan logros.');
    }

    var pendientes = _mesesPendientesParticipacion_(props, todasActividades, mesActual);
    if (pendientes.length === 0) {
      Logger.log('✅ questProcesarParticipacion: no hay meses cerrados pendientes.');
      return { success: true, message: 'Sin meses pendientes.', meses: [] };
    }

    var procesados = [], detenidoPor = '';

    for (var m = 0; m < pendientes.length; m++) {
      if (Date.now() - inicio > CFG_QUEST_PART.LIMITE_MS) { detenidoPor = 'tiempo'; break; }

      var res = _aplicarMesParticipacion_(pendientes[m], todasActividades, ahora, xpDesde);
      if (!res.success) { detenidoPor = res.motivo || 'error'; break; }

      props.setProperty(CFG_QUEST_PART.PROP_ULTIMO_MES, pendientes[m]);
      procesados.push(pendientes[m] + ' (' + res.aplicados + ' socios, ' + res.xpTotal + ' XP)');
    }

    var msg = 'Meses aplicados: ' + (procesados.join(' | ') || 'ninguno') +
              (detenidoPor ? ' — detenido por: ' + detenidoPor : '');
    Logger.log('✅ questProcesarParticipacion — ' + msg);
    return { success: true, message: msg, meses: procesados, detenidoPor: detenidoPor };

  } catch (e) {
    Logger.log('❌ questProcesarParticipacion: ' + e.toString());
    return { success: false, message: 'Error: ' + e.toString() };
  }
}

/**
 * Qué meses faltan por aplicar.
 *
 * Nunca incluye el mes en curso: un mes abierto todavía puede cambiar de
 * resultado, y el XP ya entregado no se devuelve.
 */
function _mesesPendientesParticipacion_(props, todasActividades, mesActual) {
  var ultimo = props.getProperty(CFG_QUEST_PART.PROP_ULTIMO_MES);

  // Primera ejecución: se parte del mes más antiguo con actividad registrada.
  if (!ultimo) {
    var masAntiguo = '';
    todasActividades.forEach(function (a) {
      if (a.mes && (!masAntiguo || a.mes < masAntiguo)) masAntiguo = a.mes;
    });
    if (!masAntiguo) return [];
    ultimo = _mesAnterior_(masAntiguo);
  }

  // PISO DURO: nunca antes del corte de datos evaluables.
  //
  // La carga de asistencia histórica siembra actividades de meses viejos en el
  // catálogo, y esos meses ya fueron procesados en su momento. Si el cursor se
  // perdiera o alguien lo reiniciara, el barrido volvería a bajar hasta marzo y
  // repartiría XP de nuevo: el XP entregado no se puede quitar, y cada subida
  // de grado manda un correo al socio. La carga histórica es un acto
  // administrativo silencioso sobre meses cerrados — no debe premiar a nadie ni
  // avisarle nada.
  var piso = CFG_PARTICIPACION.INICIO_DATOS_EVALUABLES;
  if (piso && ultimo < _mesAnterior_(piso)) ultimo = _mesAnterior_(piso);

  var tope = _mesAnterior_(mesActual);   // el último mes cerrado
  var lista = [], cursor = _mesSiguiente_(ultimo);
  var guarda = 0;
  while (cursor <= tope && guarda++ < 240) {   // 20 años, cortafuegos ante un cursor corrupto
    lista.push(cursor);
    cursor = _mesSiguiente_(cursor);
  }
  return lista;
}

/**
 * Aplica UN mes: reparte XP, actualiza contadores y otorga logros.
 *
 * Se calcula todo en memoria y recién al final se escribe, con el candado
 * tomado durante la escritura. Sostener el candado el trabajo entero dejaría a
 * los socios sin poder cerrar un quiz por minutos.
 */
function _aplicarMesParticipacion_(mes, todasActividades, ahora, xpDesde) {
  var datos = _participacionResultadosDelMes(mes, todasActividades, ahora);

  // Si una fuente falló, sus trámites se leen como inexistentes y un socio que
  // justificó aparecería como falta. Con XP de por medio eso no se puede
  // arreglar después, así que el mes no se aplica y se reintenta la próxima vez.
  var rotas = [];
  Object.keys(datos.fuentes).forEach(function (k) { if (!datos.fuentes[k].ok) rotas.push(k); });
  if (rotas.length > 0) {
    Logger.log('⛔ Mes ' + mes + ' NO aplicado: fuentes con problemas (' + rotas.join(', ') + ').');
    return { success: false, motivo: 'fuente ' + rotas.join('/') + ' no disponible' };
  }

  // Un mes cuyo plazo sigue abierto en alguna zona todavía puede cambiar.
  var plazoAbierto = false;
  Object.keys(datos.actividadesPorRegion).forEach(function (reg) {
    if (_plazoAbiertoDelMes(datos.actividadesPorRegion[reg], ahora).abierto) plazoAbierto = true;
  });
  if (plazoAbierto) {
    Logger.log('⏳ Mes ' + mes + ' aún con plazo abierto en alguna zona. Se deja para la próxima ejecución.');
    return { success: false, motivo: 'plazo abierto' };
  }

  var pagaXp = (mes >= xpDesde);

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return { success: false, motivo: 'servidor ocupado' };

  try {
    var tabla = _questEstadoLeerTodo_();
    if (!tabla) return { success: false, motivo: 'QUEST_ESTADO no disponible' };

    var sheetGame = getSheet('GAMIFICACION', 'GAMIFICACION');
    if (!sheetGame) return { success: false, motivo: 'BD_GAMIFICACION no disponible' };

    var COL = CONFIG.COLUMNAS.GAMIFICACION;
    var lastRowGame = sheetGame.getLastRow();
    if (lastRowGame < 2) return { success: true, aplicados: 0, xpTotal: 0 };

    var anchoGame = COL.QUIZZES_PERFECTOS + 1;
    var datosGame = sheetGame.getRange(2, 1, lastRowGame - 1, anchoGame).getDisplayValues();
    var filaDeRut = {};
    for (var g = 0; g < datosGame.length; g++) {
      var r = cleanRut(datosGame[g][COL.RUT]);
      if (r) filaDeRut[r] = g;
    }

    var aplicados = 0, xpTotal = 0, subidas = [];
    var nuevasFilasEstado = [];

    for (var s = 0; s < datos.socios.length; s++) {
      var socio = datos.socios[s];
      var rut   = socio.rut;
      var resultado = datos.resultados[rut];

      var iEstado = tabla.porRut[rut];
      var filaEstado;
      if (iEstado === undefined) {
        filaEstado = _qeFilaNueva_(tabla, rut);
        nuevasFilasEstado.push(filaEstado);
      } else {
        filaEstado = tabla.filas[iEstado];
      }

      var meses = _qeLista_(tabla, filaEstado, 'PART_MESES');
      if (meses.indexOf(mes) !== -1) continue;   // ya aplicado: no se cuenta ni se paga dos veces

      var asistidas     = _qeNum_(tabla, filaEstado, 'PART_ASISTIDAS');
      var justificadas  = _qeNum_(tabla, filaEstado, 'PART_JUSTIFICADAS');
      var racha         = _qeNum_(tabla, filaEstado, 'PART_RACHA');
      var rachaMax      = _qeNum_(tabla, filaEstado, 'PART_RACHA_MAX');
      var anio          = _qeTexto_(tabla, filaEstado, 'PART_ANIO');
      var anioOk        = _qeNum_(tabla, filaEstado, 'PART_ANIO_OK');
      var anioAsistidas = _qeNum_(tabla, filaEstado, 'PART_ANIO_ASISTIDAS');
      var partXp        = _qeNum_(tabla, filaEstado, 'PART_XP');

      var anioDelMes = _anioDeMes_(mes);
      if (anio !== anioDelMes) { anio = anioDelMes; anioOk = 0; anioAsistidas = 0; }

      var cumple = (CFG_QUEST_PART.CUMPLE.indexOf(resultado) !== -1);
      var neutro = (CFG_QUEST_PART.NEUTROS.indexOf(resultado) !== -1);
      var xpMes  = 0;

      if (cumple) {
        if (resultado === 'ASISTIO') { asistidas++; anioAsistidas++; }
        else                          justificadas++;
        anioOk++;
        racha++;
        if (racha > rachaMax) rachaMax = racha;
        if (pagaXp) { xpMes = CFG_QUEST_PART.XP[resultado] || 0; partXp += xpMes; }
      } else if (!neutro) {
        // FALTA: la única que corta la racha. Un mes sin actividad en su zona,
        // un socio sin región cargada o un trámite todavía en revisión no
        // pueden castigar a nadie — no dependen de lo que el socio hizo.
        racha = 0;
      }

      meses.push(mes);
      _qePoner_(tabla, filaEstado, 'PART_MESES',           meses.join(','));
      _qePoner_(tabla, filaEstado, 'PART_ASISTIDAS',       asistidas);
      _qePoner_(tabla, filaEstado, 'PART_JUSTIFICADAS',    justificadas);
      _qePoner_(tabla, filaEstado, 'PART_RACHA',           racha);
      _qePoner_(tabla, filaEstado, 'PART_RACHA_MAX',       rachaMax);
      _qePoner_(tabla, filaEstado, 'PART_ANIO',            anio);
      _qePoner_(tabla, filaEstado, 'PART_ANIO_OK',         anioOk);
      _qePoner_(tabla, filaEstado, 'PART_ANIO_ASISTIDAS',  anioAsistidas);
      _qePoner_(tabla, filaEstado, 'PART_XP',              partXp);
      _qePoner_(tabla, filaEstado, 'ACTUALIZADO',          _ahoraQuest_());
      aplicados++;

      // --- Reflejo en BD_GAMIFICACION: XP, grado y logros ---
      var iGame = filaDeRut[rut];
      if (iGame === undefined) continue;   // socio aún sin fila de juego: la crea su primer ingreso

      var filaGame = datosGame[iGame];
      if (String(filaGame[COL.ESTADO] || '').toUpperCase().trim() === 'DESVINCULADO') continue;

      var xpAntes = parseInt(filaGame[COL.XP_TOTAL], 10) || 0;
      var xpDesp  = xpAntes + xpMes;
      var gradoAntes = String(filaGame[COL.GRADO] || GRADOS_SLIM[0].nombre);
      var gradoDesp  = calcularGrado_(xpDesp);

      var logrosPrevios = [];
      try { logrosPrevios = JSON.parse(filaGame[COL.LOGROS] || '[]'); } catch (e) { logrosPrevios = []; }

      var otorgados = _aplicarLogrosQuest_(logrosPrevios, _resumenLogrosQuest_({
        quizzes:          parseInt(filaGame[COL.QUIZZES_COMPLETADOS], 10) || 0,
        perfectos:        parseInt(filaGame[COL.QUIZZES_PERFECTOS], 10)   || 0,
        rachaMax:         parseInt(filaGame[COL.RACHA_MAX], 10)           || 0,
        practicas:        _qeNum_(tabla, filaEstado, 'PRACTICAS'),
        secretos:         _qeNum_(tabla, filaEstado, 'SECRETOS'),
        partAsistidas:    asistidas,
        partJustificadas: justificadas,
        partRachaMax:     rachaMax,
        partAnioOk:       anioOk
      }));

      filaGame[COL.XP_TOTAL] = xpDesp;
      filaGame[COL.GRADO]    = gradoDesp.nombre;
      filaGame[COL.LOGROS]   = JSON.stringify(otorgados.logros);
      xpTotal += xpMes;

      // Solo se avisa una subida REAL, y con dos condiciones, porque este lote
      // reescribe el grado a partir del XP y eso a veces corrige la hoja en vez
      // de reflejar un logro:
      //
      //   1. El mes tuvo que pagar XP. Si repartió cero, ningún socio pudo
      //      ascender por mérito y cualquier cambio de grado es reparación de
      //      un dato desalineado.
      //   2. El grado tiene que ir hacia ARRIBA en la escalera. Hay filas con
      //      el GRADO desalineado del XP_TOTAL (por ejemplo XP 0 con grado
      //      "Dirigente"); al recalcularlas el socio BAJA, y sin esta condición
      //      recibía un correo felicitándolo por ello.
      if (xpMes > 0 && _indiceGrado_(gradoDesp.nombre) > _indiceGrado_(gradoAntes)) {
        subidas.push({ rut: rut, nombre: filaGame[COL.NOMBRE], grado: gradoDesp.nombre, xp: xpDesp });
      } else if (gradoAntes !== gradoDesp.nombre) {
        Logger.log('🔧 Grado corregido sin aviso | ' + rut + ' | ' + gradoAntes + ' → ' +
                   gradoDesp.nombre + ' (XP real: ' + xpDesp + ')');
      }
    }

    // --- Escritura: dos rangos completos, no miles de celdas sueltas ---
    if (tabla.filas.length > 0) {
      tabla.hoja.getRange(2, 1, tabla.filas.length, tabla.ancho).setValues(tabla.filas);
    }
    if (nuevasFilasEstado.length > 0) {
      tabla.hoja.getRange(tabla.hoja.getLastRow() + 1, 1, nuevasFilasEstado.length, tabla.ancho)
        .setValues(nuevasFilasEstado);
    }
    sheetGame.getRange(2, 1, datosGame.length, anchoGame).setValues(datosGame);

    lock.releaseLock();

    // Los correos van FUERA del candado: son lentos y no deben mantener
    // bloqueado el cierre de quizzes de nadie.
    _avisarSubidasDeGrado_(subidas, mes);

    Logger.log('✅ Mes ' + mes + ' aplicado | socios: ' + aplicados + ' | XP repartido: ' + xpTotal +
               ' | subidas de grado: ' + subidas.length + (pagaXp ? '' : ' | (mes retroactivo: solo logros)'));
    return { success: true, aplicados: aplicados, xpTotal: xpTotal, subidas: subidas.length };

  } finally {
    if (lock.hasLock()) lock.releaseLock();
  }
}

/** Avisa por correo a quienes subieron de grado, con tope de envíos. */
function _avisarSubidasDeGrado_(subidas, mes) {
  if (!subidas || subidas.length === 0) return;

  var enviados = 0;
  for (var i = 0; i < subidas.length && enviados < CFG_QUEST_PART.MAX_CORREOS_NIVEL; i++) {
    try {
      var usuario = obtenerUsuarioPorRut(subidas[i].rut);
      if (!usuario.encontrado || !usuario.correo) continue;
      enviarCorreoNivel(usuario.correo, subidas[i].nombre, subidas[i].grado, subidas[i].xp);
      enviados++;
    } catch (e) {
      Logger.log('⚠️ Correo de nivel no enviado a ' + subidas[i].rut + ': ' + e.toString());
    }
  }
  if (subidas.length > enviados) {
    Logger.log('⚠️ Mes ' + mes + ': ' + (subidas.length - enviados) +
               ' subidas de grado sin correo por el tope de envíos. El socio lo verá igual al entrar a SLIM Quest.');
  }
}

// ==========================================
// DIAGNÓSTICO
// ==========================================

/**
 * Estado del cruce entre SLIM Quest y participación. Se corre a mano desde el
 * editor GAS.
 *
 * No devuelve nada a propósito: es una función global de un webapp anónimo y el
 * informe cuenta socios. Mismo criterio que `_diagnosticarSlimQuest()`.
 */
function _diagnosticarQuestParticipacion() {
  _ensureConfig();
  var log = ['=== DIAGNOSTICO SLIM QUEST × PARTICIPACION ==='];

  try {
    var props = PropertiesService.getScriptProperties();
    log.push('Último mes aplicado: ' + (props.getProperty(CFG_QUEST_PART.PROP_ULTIMO_MES) || '(ninguno — no ha corrido nunca)'));
    log.push('XP se paga desde:    ' + (props.getProperty(CFG_QUEST_PART.PROP_XP_DESDE) || '(se fijará en la primera ejecución)'));

    var trigger = ScriptApp.getProjectTriggers().filter(function (t) {
      return t.getHandlerFunction() === 'questProcesarParticipacion';
    });
    log.push('Activador: ' + (trigger.length ? 'INSTALADO' : '❌ AUSENTE — corre configurarTriggers() o créalo a mano'));

    var catalogo = obtenerCatalogoActividades('');
    var actividades = (catalogo && catalogo.actividades) ? catalogo.actividades : [];
    var meses = {};
    actividades.forEach(function (a) { if (a.mes) meses[a.mes] = (meses[a.mes] || 0) + 1; });
    var listaMeses = Object.keys(meses).sort();
    log.push('--- CATALOGO: ' + actividades.length + ' actividades en ' + listaMeses.length + ' meses ---');
    if (listaMeses.length) log.push('   desde ' + listaMeses[0] + ' hasta ' + listaMeses[listaMeses.length - 1]);

    var mesActual = Utilities.formatDate(new Date(), CFG_QUEST_PART.ZONA_HORARIA, 'yyyy-MM');
    var pendientes = _mesesPendientesParticipacion_(props, actividades, mesActual);
    log.push('Meses cerrados pendientes de aplicar: ' + pendientes.length +
             (pendientes.length ? ' (' + pendientes[0] + ' … ' + pendientes[pendientes.length - 1] + ')' : ''));

    var tabla = _questEstadoLeerTodo_();
    if (tabla) {
      var conPart = 0, sumAsist = 0, sumJust = 0, sumXp = 0, maxRacha = 0;
      tabla.filas.forEach(function (f) {
        var a = _qeNum_(tabla, f, 'PART_ASISTIDAS');
        var j = _qeNum_(tabla, f, 'PART_JUSTIFICADAS');
        if (a + j > 0) conPart++;
        sumAsist += a; sumJust += j;
        sumXp += _qeNum_(tabla, f, 'PART_XP');
        maxRacha = Math.max(maxRacha, _qeNum_(tabla, f, 'PART_RACHA_MAX'));
      });
      log.push('--- SOCIOS: ' + conPart + ' con participación registrada ---');
      log.push('   asistencias: ' + sumAsist + ' | justificadas: ' + sumJust +
               ' | XP repartido: ' + sumXp + ' | racha más larga: ' + maxRacha);
    } else {
      log.push('❌ QUEST_ESTADO no disponible.');
    }
  } catch (e) {
    log.push('❌ ' + e.toString());
  }

  Logger.log(log.join('\n'));
}
