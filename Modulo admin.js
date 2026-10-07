// ==========================================
// MODULO_ADMIN.GS — Panel administrador, gestiones, triggers
// ==========================================

// ==========================================
// GESTIÓN DE SOCIOS (DIRIGENTE / ADMIN)
// ==========================================

/**
 * Obtiene TODAS las gestiones realizadas por dirigentes en todos los módulos.
 * Filtra registros donde gestion="Dirigente".
 */
function obtenerGestionesDirigente(rutDirigente) {
  try {
    // Datos sensibles de todos los socios (préstamos, apelaciones, permisos
    // médicos) — nunca entregar sin validar rol, el webapp es ANYONE_ANONYMOUS.
    var verificacion = verificarRolUsuario(rutDirigente, ['DIRIGENTE', 'DIRECTORIO', 'ADMIN']);
    if (!verificacion.autorizado) {
      Logger.log('⚠️ obtenerGestionesDirigente: intento no autorizado — RUT=' + rutDirigente);
      return { success: false, message: "No autorizado." };
    }

    var resultado = { prestamos: [], justificaciones: [], apelaciones: [], permisosMedicos: [] };

    // PRÉSTAMOS
    var sheetPrestamos = getSheet('PRESTAMOS', 'PRESTAMOS');
    var dataPrestamos  = sheetPrestamos.getDataRange().getDisplayValues();
    var COL_PRES       = CONFIG.COLUMNAS.PRESTAMOS;

    for (var i = 1; i < dataPrestamos.length; i++) {
      var row          = dataPrestamos[i];
      var fechaTerminoStr = "S/D";
      var ftRaw        = row[COL_PRES.FECHA_TERMINO];
      if (ftRaw) {
        try {
          var d = parsearFechaFlexible(ftRaw);
          fechaTerminoStr = d !== null
            ? Utilities.formatDate(d, Session.getScriptTimeZone(), "dd/MM/yyyy")
            : String(ftRaw).split(' ')[0];
        } catch(e) { fechaTerminoStr = String(ftRaw).split(' ')[0]; }
      }

      resultado.prestamos.push({
        // fecha viaja como string DD/MM crudo de getDisplayValues();
        // el frontend la parsea con parseCustomDate (convención DD/MM).
        id: row[COL_PRES.ID], fecha: row[COL_PRES.FECHA],
        rutSocio: row[COL_PRES.RUT], nombreSocio: row[COL_PRES.NOMBRE],
        tipo: nombreTipoPrestamo(row[COL_PRES.TIPO]) || "Préstamo", monto: row[COL_PRES.MONTO] || "$0",
        cuotas: row[COL_PRES.CUOTAS] || "S/D", medio: row[COL_PRES.MEDIO_PAGO] || "S/D",
        estado: row[COL_PRES.ESTADO], observacion: row[COL_PRES.OBSERVACION] || "",
        fechaTermino: fechaTerminoStr,
        urlComprobanteVacaciones: row[COL_PRES.URL_COMPROBANTE_VACACIONES] || ""
      });
    }

    // JUSTIFICACIONES
    var sheetJustif = getSheet('JUSTIFICACIONES', 'JUSTIFICACIONES');
    var dataJustif  = sheetJustif.getDataRange().getDisplayValues();
    var COL_JUST    = CONFIG.COLUMNAS.JUSTIFICACIONES;

    for (var j = 1; j < dataJustif.length; j++) {
      var rowJ = dataJustif[j];
      if (rowJ[COL_JUST.GESTION] === "Dirigente") {
        resultado.justificaciones.push({
          id: rowJ[COL_JUST.ID], fecha: rowJ[COL_JUST.FECHA],
          rutSocio: rowJ[COL_JUST.RUT], nombreSocio: rowJ[COL_JUST.NOMBRE],
          tipo: rowJ[COL_JUST.MOTIVO], motivo: rowJ[COL_JUST.ARGUMENTO],
          url: rowJ[COL_JUST.RESPALDO], estado: rowJ[COL_JUST.ESTADO],
          obs: rowJ[COL_JUST.OBSERVACION], asamblea: rowJ[COL_JUST.ASAMBLEA]
        });
      }
    }

    // APELACIONES
    var sheetApel = getSheet('APELACIONES', 'APELACIONES');
    var dataApel  = sheetApel.getDataRange().getDisplayValues();
    var COL_APEL  = CONFIG.COLUMNAS.APELACIONES;

    for (var k = 1; k < dataApel.length; k++) {
      var rowA = dataApel[k];
      if (rowA[COL_APEL.GESTION] === "Dirigente") {
        resultado.apelaciones.push({
          id: rowA[COL_APEL.ID], fecha: rowA[COL_APEL.FECHA_SOLICITUD],
          rutSocio: rowA[COL_APEL.RUT], nombreSocio: rowA[COL_APEL.NOMBRE],
          mesApelacion: rowA[COL_APEL.MES_APELACION], tipoMotivo: rowA[COL_APEL.TIPO_MOTIVO],
          detalleMotivo: rowA[COL_APEL.DETALLE_MOTIVO], urlComprobante: rowA[COL_APEL.URL_COMPROBANTE],
          urlLiquidacion: rowA[COL_APEL.URL_LIQUIDACION], estado: rowA[COL_APEL.ESTADO],
          obs: rowA[COL_APEL.OBSERVACION], urlComprobanteDevolucion: rowA[COL_APEL.URL_COMPROBANTE_DEVOLUCION] || ""
        });
      }
    }

    // PERMISOS MÉDICOS
    var sheetPermisos = getSheet('PERMISOS_MEDICOS', 'PERMISOS_MEDICOS');
    var dataPermisos  = sheetPermisos.getDataRange().getDisplayValues();
    var COL_PERM      = CONFIG.COLUMNAS.PERMISOS_MEDICOS;

    for (var m = 1; m < dataPermisos.length; m++) {
      var rowP = dataPermisos[m];
      if (rowP[COL_PERM.GESTION] === "Dirigente") {
        resultado.permisosMedicos.push({
          id: rowP[COL_PERM.ID], fecha: rowP[COL_PERM.FECHA_SOLICITUD],
          rutSocio: rowP[COL_PERM.RUT], nombreSocio: rowP[COL_PERM.NOMBRE],
          tipoPermiso: rowP[COL_PERM.TIPO_PERMISO], fechaInicio: rowP[COL_PERM.FECHA_INICIO],
          motivo: rowP[COL_PERM.MOTIVO_DETALLE], urlDocumento: rowP[COL_PERM.URL_DOCUMENTO],
          estado: rowP[COL_PERM.ESTADO]
        });
      }
    }

    return { success: true, datos: resultado };

  } catch (e) {
    return { success: false, message: "Ocurrió un error interno. Por favor, intente más tarde o contacte al administrador." };
  }
}

// ==========================================
// CAMBIO DE ROL (Panel Admin)
// ==========================================

/**
 * Busca usuarios por nombre con coincidencia parcial (fuzzy multi-word).
 * Retorna lista de candidatos con RUT, nombre, cargo, rol actual.
 */
function buscarUsuarioPorNombre(textoBusqueda) {
  try {
    if (!textoBusqueda || String(textoBusqueda).trim().length < 2) {
      return { success: false, message: "Ingresa al menos 2 caracteres para buscar." };
    }

    var sheet = getSheet('USUARIOS', 'USUARIOS');
    var data  = sheet.getDataRange().getDisplayValues();
    var COL   = CONFIG.COLUMNAS.USUARIOS;

    var palabras = String(textoBusqueda).trim().toUpperCase().split(/\s+/);
    var resultados = [];

    for (var i = 1; i < data.length; i++) {
      var nombreRow = String(data[i][COL.NOMBRE] || "").toUpperCase();
      var coincide  = palabras.every(function(p) { return nombreRow.indexOf(p) !== -1; });
      if (!coincide) continue;

      resultados.push({
        rut:     data[i][COL.RUT],
        nombre:  data[i][COL.NOMBRE],
        cargo:   data[i][COL.CARGO]  || "—",
        region:  data[i][COL.REGION] || "—",
        rolActual: String(data[i][COL.ROL] || "SOCIO").trim().toUpperCase()
      });

      if (resultados.length >= 10) break;
    }

    return { success: true, resultados: resultados, total: resultados.length };
  } catch (e) {
    Logger.log("❌ Error en buscarUsuarioPorNombre: " + e.toString());
    return { success: false, message: "Ocurrió un error interno. Por favor, intente más tarde o contacte al administrador." };
  }
}

/**
 * Cambia el rol de un usuario y envía notificación por correo.
 * Solo ADMIN puede ejecutar esta función.
 */
function cambiarRolUsuario(rutAdmin, rutObjetivo, nuevoRol) {
  var ROLES_VALIDOS = ["SOCIO", "DIRIGENTE", "DIRECTORIO", "ADMIN", "TESTING"];

  var lock = LockService.getScriptLock();
  if (lock.tryLock(30000)) {
    try {
      var validacion = verificarRolUsuario(rutAdmin, ['ADMIN']);
      if (!validacion.autorizado) {
        return { success: false, message: "No tienes permisos para cambiar roles." };
      }

      var nuevoRolNorm = String(nuevoRol || "").trim().toUpperCase();
      if (ROLES_VALIDOS.indexOf(nuevoRolNorm) === -1) {
        return { success: false, message: "Rol inválido. Roles permitidos: " + ROLES_VALIDOS.join(", ") };
      }

      var rutLimpio = cleanRut(rutObjetivo);
      var sheet     = getSheet('USUARIOS', 'USUARIOS');
      var data      = sheet.getDataRange().getValues();
      var COL       = CONFIG.COLUMNAS.USUARIOS;

      for (var i = 1; i < data.length; i++) {
        if (cleanRut(String(data[i][COL.RUT])) !== rutLimpio) continue;

        var rolAnterior = String(data[i][COL.ROL] || "SOCIO").trim().toUpperCase();
        var nombre      = data[i][COL.NOMBRE];
        var correo      = data[i][COL.CORREO];

        if (rolAnterior === nuevoRolNorm) {
          return { success: false, message: "El usuario ya tiene el rol " + nuevoRolNorm + ". No se realizaron cambios." };
        }

        sheet.getRange(i + 1, COL.ROL + 1).setValue(nuevoRolNorm);
        CacheService.getScriptCache().remove('user_' + rutLimpio);

        Logger.log("🔄 ROL CAMBIADO: " + nombre + " (" + rutLimpio + ") | " + rolAnterior + " → " + nuevoRolNorm + " | Por: " + rutAdmin);

        if (esCorreoValido(correo)) {
          var PERMISOS_ROL = {
            "SOCIO":       ["Módulos de socios: justificaciones, préstamos, apelaciones, permisos médicos", "Registro de asistencia", "SLIM Quest"],
            "DIRIGENTE":   ["Todos los módulos de socio", "Consulta ID Credencial", "Gestión de socios: ingresar solicitudes en nombre de terceros", "Panel Dirigente: vista de gestiones realizadas"],
            "DIRECTORIO":  ["Todos los módulos de socio", "Acceso de lectura a documentos de gestiones sindicales", "Notificaciones automáticas sobre denuncias y gestiones relevantes"],
            "ADMIN":       ["Acceso completo al sistema", "Panel Administrador", "Gestión de switches", "Cambio de roles", "Generación de informes"],
            "TESTING":     ["Acceso de pruebas al sistema"]
          };
          var permisos = PERMISOS_ROL[nuevoRolNorm] || [];
          var permisosHtml = permisos.map(function(p) { return "<li style='margin-bottom:4px;'>" + p + "</li>"; }).join("");

          enviarCorreoEstilizado(
            correo,
            "Actualización de Rol - Sindicato SLIM n°3",
            "Tu rol ha sido actualizado",
            "Hola <strong>" + nombre + "</strong>, tu nivel de acceso en la plataforma del sindicato ha sido modificado por la administración.",
            {
              "ROL ANTERIOR": rolAnterior,
              "NUEVO ROL":    nuevoRolNorm,
              "ACCESOS":      "<ul style='margin:0;padding-left:18px;'>" + permisosHtml + "</ul>",
              "MODIFICADO POR": "Administración Sindicato SLIM N°3"
            },
            "#7c3aed"
          );
        }

        return { success: true, message: "Rol cambiado exitosamente de " + rolAnterior + " a " + nuevoRolNorm + ".", rolAnterior: rolAnterior, nuevoRol: nuevoRolNorm, nombre: nombre };
      }

      return { success: false, message: "Usuario no encontrado con RUT " + formatRutDisplay(rutObjetivo) };

    } catch (e) {
      Logger.log("❌ Error en cambiarRolUsuario: " + e.toString());
      return { success: false, message: "Ocurrió un error interno. Por favor, intente más tarde o contacte al administrador." };
    } finally {
      lock.releaseLock();
    }
  } else {
    return { success: false, message: "Servidor ocupado." };
  }
}

// ==========================================
// CONFIGURAR TRIGGERS (ejecutar manualmente UNA VEZ)
// ==========================================

// Propiedad-llave de un solo uso que habilita configurarTriggers() desde el
// editor. Se pone a mano, y la propia función la BORRA apenas la consume.
var PROP_PERMISO_CONFIG_TRIGGERS = 'PERMITIR_CONFIG_TRIGGERS';

/**
 * Autoriza la reconfiguración de activadores. Acepta DOS vías, y ninguna es
 * alcanzable desde el webapp anónimo:
 *
 *   1. RUT con rol ADMIN — por si algún día se conecta a un botón del Panel.
 *   2. Llave de un solo uso en PropertiesService (uso normal, desde el editor):
 *      crear la propiedad `PERMITIR_CONFIG_TRIGGERS` con valor `SI`, ejecutar,
 *      y la función la elimina sola. Un visitante anónimo no puede crearla, así
 *      que no puede abrir esta puerta llamando google.script.run a mano.
 *
 * No se usa Session.getActiveUser() a propósito: exige el scope
 * `userinfo.email`, que no está declarado en appsscript.json, y agregarlo
 * obligaría a la cuenta que despliega a reautorizar todo el proyecto.
 *
 * La llave se borra **antes** de tocar ningún activador: si la ejecución se
 * cae a la mitad, la puerta ya quedó cerrada igual.
 *
 * @return {{autorizado: boolean, via: string, motivo: string}}
 */
function _autorizarConfiguracionTriggers(rutSolicitante) {
  if (rutSolicitante) {
    var verificacion = verificarRolUsuario(rutSolicitante, ['ADMIN']);
    if (verificacion.autorizado) {
      return { autorizado: true, via: 'RUT ADMIN', motivo: '' };
    }
    return { autorizado: false, via: '', motivo: 'el RUT recibido no tiene rol ADMIN' };
  }

  var props = PropertiesService.getScriptProperties();
  var llave = String(props.getProperty(PROP_PERMISO_CONFIG_TRIGGERS) || '').trim().toUpperCase();

  if (llave === 'SI') {
    props.deleteProperty(PROP_PERMISO_CONFIG_TRIGGERS);
    return { autorizado: true, via: 'llave de un solo uso (ya consumida)', motivo: '' };
  }

  return {
    autorizado: false,
    via: '',
    motivo: 'sin RUT ADMIN y sin la propiedad ' + PROP_PERMISO_CONFIG_TRIGGERS + '=SI'
  };
}

/**
 * Elimina TODOS los triggers existentes del proyecto y recrea los vigentes.
 * PRECAUCIÓN: Confirmar todos los horarios antes de ejecutar.
 *
 * Borra todo, no solo lo obsoleto: cualquier activador creado a mano desde el
 * editor y que no esté en esta lista también desaparece. Revisar la pantalla
 * de Activadores antes de ejecutar.
 *
 * Se ejecuta normalmente SIN argumentos desde el editor de Apps Script, previa
 * creación de la propiedad PERMITIR_CONFIG_TRIGGERS = SI (ver
 * _autorizarConfiguracionTriggers). El parámetro existe para una eventual
 * llamada desde el Panel Admin.
 *
 * @param {string} [rutSolicitante] RUT ADMIN, si se llama desde el frontend.
 */
function configurarTriggers(rutSolicitante) {
  _ensureConfig();

  var autorizacion = _autorizarConfiguracionTriggers(rutSolicitante);
  if (!autorizacion.autorizado) {
    Logger.log('⚠️ configurarTriggers: intento no autorizado — ' + autorizacion.motivo);
    return { success: false, message: "No autorizado." };
  }
  Logger.log('🔧 configurarTriggers autorizado vía ' + autorizacion.via);

  var triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function(trigger) { ScriptApp.deleteTrigger(trigger); });

  // Cada función de esta lista abre con el candado de entorno
  //   if (activadorFueraDeProduccion_(e, 'nombre')) return;
  // (Global.js), así que en DEV o en una copia del proyecto estos activadores
  // se crean pero no hacen nada. Un activador nuevo tiene que llevarlo también.

  // Verificar cambios en justificaciones — cada 8 horas
  ScriptApp.newTrigger('verificarCambiosJustificaciones').timeBased().everyHours(8).create();

  // Verificar cambios en apelaciones — cada 8 horas
  ScriptApp.newTrigger('verificarCambiosApelaciones').timeBased().everyHours(8).create();

  // Procesar validación de préstamos — diario a las 8 AM
  ScriptApp.newTrigger('procesarValidacionPrestamos').timeBased().everyDays(1).atHour(8).create();

  // Procesar permisos de comprobantes de devolución — cada 1 hora
  ScriptApp.newTrigger('procesarPermisosComprobantesDevolucion').timeBased().everyHours(1).create();

  // Verificar cambios en préstamos — diario a las 8 AM
  ScriptApp.newTrigger('verificarCambiosPrestamos').timeBased().everyDays(1).atHour(8).create();

  // Verificar cambios en credenciales — diario a las 8 AM
  ScriptApp.newTrigger('verificarCambiosCredenciales').timeBased().everyDays(1).atHour(8).create();

  // Reintentar notificación consolidada de permisos médicos — cada 30 minutos.
  // Sustituye a los dos activadores anteriores (reintentarNotificacionSocio y
  // reintentarNotificacionRepLegal): ahora hay un solo correo por permiso, con
  // REPLEGAL en "Para" y ADMIN + DIRECTORIO + socio en CC.
  ScriptApp.newTrigger('reintentarNotificacionPermisoMedico').timeBased().everyMinutes(30).create();

  // Respaldo semanal de bases de datos — todos los viernes a las 20:00
  ScriptApp.newTrigger('respaldarBasesDeDatos').timeBased().onWeekDay(ScriptApp.WeekDay.FRIDAY).atHour(20).create();

  // Recordatorio de documentos de Fallecimiento (designación de beneficiarios)
  // pendientes de revisión — diario a las 10 AM, solo a ADMIN.
  ScriptApp.newTrigger('reintentarNotificacionDocFallecimientoPendiente').timeBased().everyDays(1).atHour(10).create();

  // Permisos de archivos: reconcilia los socios que cambiaron su correo y, si
  // sobra tiempo, continúa el barrido completo que haya quedado con cursor.
  ScriptApp.newTrigger('reconciliarPermisosPendientes').timeBased().everyMinutes(30).create();

  // Barrido completo semanal de permisos — domingos a las 21:00. Es la red de
  // seguridad de la señal: arranca el recorrido de todos los archivos y el
  // activador de 30 minutos lo termina en las horas siguientes.
  ScriptApp.newTrigger('barridoSemanalPermisos').timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(21).create();

  // Reparto por cargo: reintenta los otorgamientos que fallaron al subir un
  // archivo (REPLEGAL, ADMIN, DIRIGENTE, DIRECTORIO) y continúa el pase semanal
  // que haya quedado con cursor. Sin esto, un insert fallido no lo reintentaba
  // nadie y la empresa terminaba pidiendo acceso al archivo a mano por Drive.
  ScriptApp.newTrigger('reconciliarPermisosRolesPendientes').timeBased().everyMinutes(30).create();

  // Barrido semanal del reparto por cargo — SÁBADOS a las 21:00, un día antes
  // que barridoSemanalPermisos. Los dos toman el mismo lock de script y
  // recorren los mismos ~3.100 archivos en varios pases: solapados, cada uno
  // haría que el otro se saltara vuelta tras vuelta.
  ScriptApp.newTrigger('barridoSemanalPermisosRoles').timeBased().onWeekDay(ScriptApp.WeekDay.SATURDAY).atHour(21).create();

  // Catálogo de actividades: copia lo que haya en CONFIG_JUSTIFICACIONES y aún
  // no esté registrado. Cada 6 horas y no una vez al día, porque esa hoja se
  // edita a mano: si alguien crea una actividad y la borra el mismo día, un
  // barrido diario podría no verla nunca. Es idempotente y no notifica a nadie.
  ScriptApp.newTrigger('sincronizarCatalogoDesdeConfig').timeBased().everyHours(6).create();

  // SLIM Quest: crea la fila de los socios nuevos y actualiza nombre y estado
  // de los existentes. Vivía SOLO en configurarTriggerGamificacion(), y como
  // esta función borra todos los activadores del proyecto antes de recrear los
  // suyos, cada ejecución dejaba la sincronización apagada sin que nada lo
  // dijera: el panel de Ejecuciones no muestra lo que ya no existe. Si se
  // agrega un activador nuevo en cualquier módulo, tiene que quedar aquí.
  ScriptApp.newTrigger('sincronizarSociosGamificacion').timeBased().everyDays(1).atHour(1).create();

  // SLIM Quest × participación: reparte XP y logros por las actividades
  // sindicales del mes cerrado. Día 5 y no día 1: el plazo para justificar
  // sigue abierto los primeros días del mes siguiente, y un mes con plazo
  // abierto todavía puede cambiar de resultado — el XP ya entregado no se
  // devuelve. Si igual lo encuentra abierto, no aplica el mes y lo reintenta.
  ScriptApp.newTrigger('questProcesarParticipacion').timeBased()
    .onMonthDay(5).atHour(4).create();

  // Detecta cuando el ADMIN cambia DOC_FALLECIMIENTO_ESTADO directamente en el
  // Sheet (desplegable de BD_SLIMAPP) y dispara respaldo + notificación solo.
  // Instalable (no simple trigger) porque necesita permiso para enviar correo.
  // Ligado explícitamente al spreadsheet de USUARIOS: este proyecto no está
  // contenedor-vinculado a esa hoja de cálculo.
  ScriptApp.newTrigger('_onEditDocFallecimiento')
    .forSpreadsheet(getSpreadsheet('USUARIOS'))
    .onEdit()
    .create();

  // NOTA: ya no hay activadores de asistencia. La asistencia dejó de
  // consolidarse en BD_ASISTENCIA y se lee en vivo desde el sistema externo
  // "Asistencia por Brigada" (Modulo asistenciaBrigada.js), que mantiene su
  // propia captura y sus propias notificaciones. No reponer los activadores
  // verificarNotificacionesAsistencia / sincronizarAsistenciaQR /
  // sincronizarAsistenciaBrigada: sus funciones ya no existen y un activador
  // apuntando a una función inexistente falla en silencio cada vez que corre.

  Logger.log("✅ Triggers configurados exitosamente");
  Logger.log("Total de triggers activos: " + ScriptApp.getProjectTriggers().length);

  return {
    success: true,
    message: "Triggers configurados correctamente",
    triggers: [
      "verificarCambiosJustificaciones (cada 8 horas)",
      "verificarCambiosApelaciones (cada 8 horas)",
      "procesarValidacionPrestamos (diario 8 AM)",
      "procesarPermisosComprobantesDevolucion (cada 1 hora)",
      "verificarCambiosPrestamos (diario 8 AM)",
      "verificarCambiosCredenciales (diario 8 AM)",
      "reintentarNotificacionPermisoMedico (cada 30 minutos)",
      "respaldarBasesDeDatos (viernes 20:00)",
      "reintentarNotificacionDocFallecimientoPendiente (diario 10 AM)",
      "reconciliarPermisosPendientes (cada 30 minutos)",
      "barridoSemanalPermisos (domingos 21:00)",
      "reconciliarPermisosRolesPendientes (cada 30 minutos)",
      "barridoSemanalPermisosRoles (sábados 21:00)",
      "sincronizarCatalogoDesdeConfig (cada 6 horas)",
      "_onEditDocFallecimiento (onEdit del Sheet USUARIOS)"
    ]
  };
}

// ==========================================
// RESPALDO AUTOMÁTICO/MANUAL DE BASES DE DATOS
// ==========================================

/**
 * Deja un archivo o carpeta de Drive en "Restringido": elimina cualquier
 * permiso de tipo dominio o "cualquier persona", conservando al dueño y a
 * los usuarios con acceso explícito.
 *
 * Necesario porque la cuenta es Workspace y, según la política del dominio,
 * cada archivo/carpeta recién creado puede nacer compartido con toda la
 * organización. Como esa política agrega un permiso EXPLÍCITO de dominio a
 * CADA elemento, restringir sólo la carpeta padre no basta: hay que quitárselo
 * a cada copia y subcarpeta que genera el respaldo.
 *
 * Usa el servicio avanzado de Drive v2 (fijado en appsscript.json), coherente
 * con el resto del código. No lanza: si un permiso puntual no se puede quitar,
 * lo registra y sigue, para no abortar todo el respaldo por un elemento.
 */
function _restringirAccesoDrive(id) {
  try {
    var permisos = Drive.Permissions.list(id);
    var items = (permisos && permisos.items) || [];
    for (var i = 0; i < items.length; i++) {
      var p = items[i];
      if (p.type === 'domain' || p.type === 'anyone') {
        try {
          Drive.Permissions.remove(id, p.id);
          Logger.log('   🔒 Acceso "' + p.type + '" removido de ' + id);
        } catch (eRemove) {
          Logger.log('   ⚠️ No se pudo remover permiso ' + p.id + ' (' + p.type + ') de ' + id + ' — ' + eRemove);
        }
      }
    }
  } catch (e) {
    Logger.log('⚠️ _restringirAccesoDrive: no se pudieron listar permisos de ' + id + ' — ' + e);
  }
}

/**
 * Claves de PropertiesService que NO se incluyen en el volcado de
 * configuración: son puertas temporales que se crean a mano para una
 * mantención puntual y se borran al terminar. Restaurarlas desde un respaldo
 * volvería a abrir esa puerta sin que nadie lo pidiera.
 */
var CLAVES_CONFIG_NO_RESPALDABLES = [
  'RUT_MANTENCION',
  'PERMITIR_CONFIG_TRIGGERS',
  'RUT_DIAGNOSTICO_ASISTENCIA',
  'PERMISO_FORZAR_RUT'
];

/**
 * Prefijos de puertas temporales de mantencion, excluidas del respaldo.
 *
 * La lista de arriba se quedo corta: al 09/09/2026 el proyecto podia crear diez
 * propiedades de este tipo y solo tres estaban excluidas. Una puerta que quede
 * abierta cuando corre el respaldo del viernes queda escrita en el JSON de
 * configuracion, y ese JSON es justamente el que se usa para reponer el
 * proyecto — restaurar desde ahi volveria a abrirla.
 *
 * Enumerarlas una por una garantiza que la proxima se olvide. Con el prefijo,
 * cualquier puerta que siga la convencion `PERMITIR_*` queda fuera sola.
 */
var PREFIJOS_CONFIG_NO_RESPALDABLES = ['PERMITIR_'];


/**
 * Decide si una clave de PropertiesService debe quedar fuera del respaldo.
 */
function _esClaveNoRespaldable_(clave) {
  if (CLAVES_CONFIG_NO_RESPALDABLES.indexOf(clave) !== -1) return true;
  for (var i = 0; i < PREFIJOS_CONFIG_NO_RESPALDABLES.length; i++) {
    if (String(clave).indexOf(PREFIJOS_CONFIG_NO_RESPALDABLES[i]) === 0) return true;
  }
  return false;
}

/**
 * Deja un volcado de PropertiesService dentro de la subcarpeta del día del
 * respaldo, junto a las copias de las planillas.
 *
 * Por qué existe: TODO el CONFIG (IDs de planillas, nombres de hoja, índices
 * de columna, carpetas, correos) y los switches de módulos viven únicamente en
 * PropertiesService. Si se pierden, la app queda caída y no hay de dónde
 * reconstruirlos: config_local.js no está versionado y ya no refleja el estado
 * real (las claves agregadas por los helpers _configurar*() nunca vuelven al
 * seed). Las planillas respaldadas no sirven de nada sin esto.
 *
 * El archivo lleva el scriptId en el nombre porque DEV y PROD son proyectos
 * distintos con propiedades distintas que comparten la misma carpeta de
 * respaldos: sin eso, uno pisaría al otro.
 *
 * No lanza nunca: un fallo aquí no debe abortar el respaldo de las planillas.
 *
 * @returns {{ok: boolean, detalle: string}}
 */
function _respaldarConfiguracion(carpetaDestino, fecha) {
  try {
    var todas = PropertiesService.getScriptProperties().getProperties();

    var propiedades = {};
    var excluidas = [];
    for (var clave in todas) {
      if (_esClaveNoRespaldable_(clave)) {
        excluidas.push(clave);
        continue;
      }
      propiedades[clave] = todas[clave];
    }

    var scriptId = ScriptApp.getScriptId();
    var contenido = JSON.stringify({
      generado:  Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss'),
      scriptId:  scriptId,
      excluidas: excluidas,
      propiedades: propiedades
    }, null, 2);

    // Prefijo corto del scriptId: identifica el entorno sin volcar el ID
    // completo en el nombre del archivo.
    var nombre = 'CONFIG_' + scriptId.substring(0, 10) + '_' + fecha + '.json';
    var archivo = carpetaDestino.createFile(nombre, contenido, MimeType.PLAIN_TEXT);

    // Mismo tratamiento que cualquier copia del respaldo: la política del
    // dominio puede haberlo creado visible para toda la organización.
    _restringirAccesoDrive(archivo.getId());

    var cuantas = Object.keys(propiedades).length;
    Logger.log('✅ Configuración respaldada: ' + nombre + ' (' + cuantas + ' claves, ' +
               excluidas.length + ' excluidas)');
    return { ok: true, detalle: nombre + ' (' + cuantas + ' claves)' };

  } catch (e) {
    Logger.log('❌ _respaldarConfiguracion: no se pudo respaldar la configuración — ' + e.toString());
    return { ok: false, detalle: 'ERROR: ' + e.toString() };
  }
}

/**
 * Copia todas las spreadsheets de CONFIG.SPREADSHEETS a una subcarpeta con
 * fecha del día dentro de CONFIG.CARPETAS.BACKUPS, y deja junto a ellas un
 * volcado de la configuración (PropertiesService) del proyecto que ejecuta.
 * @param {string} [rutSolicitante] Si viene vacío, la llamada es del trigger
 *   automático (viernes 20:00). Si viene con RUT, es una ejecución manual
 *   desde el panel Admin y se valida el rol antes de respaldar.
 */
function respaldarBasesDeDatos(rutSolicitante) {
  if (activadorFueraDeProduccion_(rutSolicitante, 'respaldarBasesDeDatos')) return;
  // Un activador pasa su objeto de evento como primer argumento, y ese objeto
  // no es un RUT: validado como tal, terminaba en "No autorizado" y el
  // activador nunca hacía nada. Se normaliza al vacío = modo activador.
  if (esEjecucionDeActivador_(rutSolicitante)) rutSolicitante = '';
  try {
    if (rutSolicitante) {
      var verificacion = verificarRolUsuario(rutSolicitante, ['ADMIN']);
      if (!verificacion.autorizado) {
        Logger.log('⚠️ respaldarBasesDeDatos: intento no autorizado — RUT=' + rutSolicitante);
        return { success: false, message: "No autorizado." };
      }
    }

    _ensureConfig();
    if (!CONFIG || !CONFIG.CARPETAS || !CONFIG.CARPETAS.BACKUPS) {
      Logger.log('❌ respaldarBasesDeDatos: falta configurar CONFIG_CARPETAS.BACKUPS en PropertiesService');
      return { success: false, message: "Falta configurar la carpeta de respaldos (CONFIG_CARPETAS.BACKUPS)." };
    }

    var carpetaBackups = DriveApp.getFolderById(CONFIG.CARPETAS.BACKUPS);
    var fecha = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');

    var carpetaDestino;
    var subcarpetas = carpetaBackups.getFoldersByName(fecha);
    if (subcarpetas.hasNext()) {
      carpetaDestino = subcarpetas.next();
    } else {
      carpetaDestino = carpetaBackups.createFolder(fecha);
    }
    // La subcarpeta del día puede nacer compartida con el dominio: se restringe
    // siempre (idempotente si ya lo estaba).
    _restringirAccesoDrive(carpetaDestino.getId());

    var respaldados = [];
    var errores = [];

    for (var clave in CONFIG.SPREADSHEETS) {
      var id = CONFIG.SPREADSHEETS[clave];
      if (!id) continue;
      try {
        var nombreCopia = "BACKUP_" + clave + "_" + fecha;
        var copia = DriveApp.getFileById(id).makeCopy(nombreCopia, carpetaDestino);
        // Cada copia es un archivo nuevo: puede traer el permiso de dominio.
        _restringirAccesoDrive(copia.getId());
        respaldados.push(clave);
      } catch (eArchivo) {
        Logger.log('❌ Error respaldando ' + clave + ': ' + eArchivo.toString());
        errores.push(clave + ": " + eArchivo.toString());
      }
    }

    // La configuración va en la misma subcarpeta del día: las planillas
    // respaldadas no se pueden volver a poner en marcha sin ella.
    var respaldoConfig = _respaldarConfiguracion(carpetaDestino, fecha);
    if (!respaldoConfig.ok) errores.push("CONFIGURACION: " + respaldoConfig.detalle);

    if (CONFIG.CORREOS && CONFIG.CORREOS.ADMIN) {
      enviarCorreoEstilizado(
        CONFIG.CORREOS.ADMIN,
        "Respaldo de Bases de Datos — " + fecha,
        "Respaldo de Bases de Datos",
        "Se ejecutó el respaldo de bases de datos del sistema.",
        {
          "FECHA":       fecha,
          "TIPO":        rutSolicitante ? "Manual" : "Automático",
          "EJECUTADO POR": rutSolicitante ? formatRutDisplay(rutSolicitante) : "Trigger automático",
          "HOJAS RESPALDADAS": respaldados.join(', ') || "Ninguna",
          "CONFIGURACIÓN": respaldoConfig.detalle,
          "ERRORES": errores.length ? errores.join('; ') : "Ninguno"
        },
        "#00e84a"
      );
    }

    return { success: true, respaldados: respaldados, errores: errores, configuracion: respaldoConfig.detalle };

  } catch (e) {
    Logger.log('❌ Error en respaldarBasesDeDatos: ' + e.toString());
    return { success: false, message: "Ocurrió un error interno al respaldar. Por favor, intente más tarde o contacte al administrador." };
  }
}

// ==========================================
// RESTAURACIÓN DE BASES DE DATOS DESDE RESPALDO
// ==========================================

/**
 * Verifica que un archivo de Drive sea descendiente (hasta cierta profundidad)
 * de una carpeta ancestro dada. Se usa para no confiar ciegamente en un
 * fileId enviado desde el frontend antes de restaurar datos con él.
 */
function _archivoPerteneceACarpeta(archivo, idCarpetaAncestro, maxNiveles) {
  var actuales = [archivo];
  for (var nivel = 0; nivel < maxNiveles; nivel++) {
    var siguientes = [];
    for (var i = 0; i < actuales.length; i++) {
      var padres = actuales[i].getParents();
      while (padres.hasNext()) {
        var padre = padres.next();
        if (padre.getId() === idCarpetaAncestro) return true;
        siguientes.push(padre);
      }
    }
    actuales = siguientes;
    if (actuales.length === 0) break;
  }
  return false;
}

/**
 * Lista los respaldos disponibles agrupados por módulo (clave de
 * CONFIG.SPREADSHEETS), leyendo las subcarpetas de fecha dentro de
 * CONFIG.CARPETAS.BACKUPS. Solo accesible para rol ADMIN.
 */
function obtenerRespaldosDisponibles(rutSolicitante) {
  try {
    var verificacion = verificarRolUsuario(rutSolicitante, ['ADMIN']);
    if (!verificacion.autorizado) {
      Logger.log('⚠️ obtenerRespaldosDisponibles: intento no autorizado — RUT=' + rutSolicitante);
      return { success: false, message: "No autorizado." };
    }

    _ensureConfig();
    if (!CONFIG || !CONFIG.CARPETAS || !CONFIG.CARPETAS.BACKUPS) {
      return { success: false, message: "Falta configurar la carpeta de respaldos (CONFIG_CARPETAS.BACKUPS)." };
    }

    var carpetaBackups = DriveApp.getFolderById(CONFIG.CARPETAS.BACKUPS);
    var respaldosPorModulo = {};

    var subcarpetas = carpetaBackups.getFolders();
    while (subcarpetas.hasNext()) {
      var subcarpeta = subcarpetas.next();
      var fecha = subcarpeta.getName();
      var archivos = subcarpeta.getFiles();
      while (archivos.hasNext()) {
        var archivo = archivos.next();
        var nombre = archivo.getName();
        if (nombre.indexOf("BACKUP_") !== 0) continue;
        var sufijo = "_" + fecha;
        if (nombre.slice(-sufijo.length) !== sufijo) continue;

        var clave = nombre.slice("BACKUP_".length, nombre.length - sufijo.length);
        if (!respaldosPorModulo[clave]) respaldosPorModulo[clave] = [];
        respaldosPorModulo[clave].push({ fecha: fecha, fileId: archivo.getId(), nombre: nombre });
      }
    }

    for (var clave2 in respaldosPorModulo) {
      respaldosPorModulo[clave2].sort(function(a, b) { return b.fecha.localeCompare(a.fecha); });
    }

    return { success: true, respaldosPorModulo: respaldosPorModulo };

  } catch (e) {
    Logger.log('❌ Error en obtenerRespaldosDisponibles: ' + e.toString());
    return { success: false, message: "Ocurrió un error al listar los respaldos disponibles." };
  }
}

/**
 * Restaura los datos de un módulo desde un respaldo previo.
 * SIEMPRE requiere rol ADMIN (no existe modo automático/sin validar).
 * Antes de sobrescribir, crea un respaldo de seguridad del estado actual.
 * Solo copia valores hoja por hoja (misma pestaña por nombre); no reemplaza
 * el spreadsheet en vivo, para no romper triggers/permisos atados a su ID.
 *
 * La hoja HOJA_REGISTROS_ELIMINADOS queda fuera de la restauración: es un
 * histórico append-only (qué se eliminó, cuándo y quién) cuyo estado en vivo
 * siempre incluye lo del respaldo más lo posterior. Se informa como
 * "preservada", distinta de "omitida" (esa no existe en la hoja en vivo).
 */
function restaurarBaseDeDatos(rutSolicitante, claveModulo, fileIdRespaldo) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    return { success: false, message: "Servidor ocupado, intente nuevamente." };
  }

  try {
    var verificacion = verificarRolUsuario(rutSolicitante, ['ADMIN']);
    if (!verificacion.autorizado) {
      Logger.log('⚠️ restaurarBaseDeDatos: intento no autorizado — RUT=' + rutSolicitante);
      return { success: false, message: "No autorizado." };
    }

    _ensureConfig();
    if (!CONFIG || !CONFIG.SPREADSHEETS || !CONFIG.SPREADSHEETS[claveModulo]) {
      return { success: false, message: "Módulo no reconocido: " + claveModulo };
    }
    if (!CONFIG.CARPETAS || !CONFIG.CARPETAS.BACKUPS) {
      return { success: false, message: "Falta configurar la carpeta de respaldos (CONFIG_CARPETAS.BACKUPS)." };
    }

    var archivoRespaldo;
    try {
      archivoRespaldo = DriveApp.getFileById(fileIdRespaldo);
    } catch (eArchivo) {
      return { success: false, message: "El respaldo seleccionado no existe o no es accesible." };
    }

    // Nunca confiar en el fileId recibido sin validar que realmente
    // pertenece a la carpeta de respaldos del sistema y al módulo indicado.
    if (!_archivoPerteneceACarpeta(archivoRespaldo, CONFIG.CARPETAS.BACKUPS, 2)) {
      Logger.log('⚠️ restaurarBaseDeDatos: archivo fuera de la carpeta de respaldos — fileId=' + fileIdRespaldo);
      return { success: false, message: "El archivo seleccionado no corresponde a un respaldo válido del sistema." };
    }

    var prefijoEsperado = "BACKUP_" + claveModulo + "_";
    if (archivoRespaldo.getName().indexOf(prefijoEsperado) !== 0) {
      return { success: false, message: "El respaldo seleccionado no corresponde al módulo indicado." };
    }

    var idEnVivo = CONFIG.SPREADSHEETS[claveModulo];
    var fechaHoraActual = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd_HH-mm-ss');

    // Respaldo de seguridad del estado actual — ANTES de sobrescribir nada.
    var carpetaBackups = DriveApp.getFolderById(CONFIG.CARPETAS.BACKUPS);
    var nombreSeguridad = "PRE_RESTAURACION_" + claveModulo + "_" + fechaHoraActual;
    try {
      var copiaSeguridad = DriveApp.getFileById(idEnVivo).makeCopy(nombreSeguridad, carpetaBackups);
      // Misma sensibilidad que un respaldo: no debe quedar visible al dominio.
      _restringirAccesoDrive(copiaSeguridad.getId());
    } catch (eSeguridad) {
      Logger.log('❌ restaurarBaseDeDatos: no se pudo crear el respaldo de seguridad previo: ' + eSeguridad.toString());
      return { success: false, message: "No se pudo crear el respaldo de seguridad previo. Restauración cancelada por seguridad." };
    }

    var ssRespaldo = SpreadsheetApp.openById(fileIdRespaldo);
    var ssEnVivo   = SpreadsheetApp.openById(idEnVivo);

    var restauradas = [];
    var omitidas = [];
    var preservadas = [];
    var errores = [];

    var hojasRespaldo = ssRespaldo.getSheets();
    for (var i = 0; i < hojasRespaldo.length; i++) {
      var hojaRespaldo = hojasRespaldo[i];
      var nombreHoja = hojaRespaldo.getName();
      try {
        // "Registros-eliminados" es evidencia histórica append-only: guarda qué
        // se eliminó, cuándo y quién. La hoja en vivo siempre contiene lo del
        // respaldo MÁS lo ocurrido después, así que pisarla solo puede perder
        // trazabilidad. Se deja intacta; si alguna vez se necesitara una fila
        // borrada a mano, sigue estando en el archivo de respaldo.
        if (nombreHoja === HOJA_REGISTROS_ELIMINADOS) {
          preservadas.push(nombreHoja);
          continue;
        }

        var hojaEnVivo = ssEnVivo.getSheetByName(nombreHoja);
        if (!hojaEnVivo) {
          omitidas.push(nombreHoja);
          continue;
        }
        var datos = hojaRespaldo.getDataRange().getValues();
        hojaEnVivo.clearContents();
        if (datos.length > 0 && datos[0].length > 0) {
          hojaEnVivo.getRange(1, 1, datos.length, datos[0].length).setValues(datos);
        }
        restauradas.push(nombreHoja);
      } catch (eHoja) {
        Logger.log('❌ Error restaurando hoja "' + nombreHoja + '": ' + eHoja.toString());
        errores.push(nombreHoja + ": " + eHoja.toString());
      }
    }

    if (CONFIG.CORREOS && CONFIG.CORREOS.ADMIN) {
      enviarCorreoEstilizado(
        CONFIG.CORREOS.ADMIN,
        "Restauración de Base de Datos — " + claveModulo,
        "Restauración de Base de Datos Ejecutada",
        "Se restauró la base de datos del módulo " + claveModulo + " desde un respaldo anterior.",
        {
          "MÓDULO":                      claveModulo,
          "RESPALDO UTILIZADO":          archivoRespaldo.getName(),
          "EJECUTADO POR":               formatRutDisplay(rutSolicitante),
          "RESPALDO DE SEGURIDAD PREVIO": nombreSeguridad,
          "HOJAS RESTAURADAS":           restauradas.join(', ') || "Ninguna",
          "HOJAS OMITIDAS (no existen en vivo)": omitidas.join(', ') || "Ninguna",
          "HOJAS PRESERVADAS (histórico append-only, no se sobrescriben)": preservadas.join(', ') || "Ninguna",
          "ERRORES":                     errores.length ? errores.join('; ') : "Ninguno"
        },
        "#ef4444"
      );
    }

    return {
      success: true,
      restauradas: restauradas,
      omitidas: omitidas,
      preservadas: preservadas,
      errores: errores,
      respaldoSeguridad: nombreSeguridad
    };

  } catch (e) {
    Logger.log('❌ Error en restaurarBaseDeDatos: ' + e.toString());
    return { success: false, message: "Ocurrió un error interno al restaurar. Por favor, intente más tarde o contacte al administrador." };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Diagnóstico del sistema de respaldos. Se ejecuta A MANO desde el editor de
 * Apps Script, en cada proyecto por separado (DEV y PROD tienen sus propios
 * activadores y su propio PropertiesService).
 *
 * Existe porque un respaldo que no corre no avisa: si falta
 * CONFIG.CARPETAS.BACKUPS, respaldarBasesDeDatos() retorna antes de enviar el
 * correo y el activador aparece como "exitoso" en el panel de Ejecuciones. La
 * única forma de notarlo es mirar la carpeta o ejecutar esto.
 *
 * Sin parámetros y sólo escribe en el Logger, igual que
 * _diagnosticarAsistenciaBrigada(): el webapp es ANYONE_ANONYMOUS y cualquier
 * función sin argumentos es invocable desde la consola del navegador, así que
 * no debe devolver nada que no se pueda mostrar a un desconocido.
 */
function _diagnosticarRespaldos() {
  _ensureConfig();

  Logger.log('═══ DIAGNÓSTICO DEL SISTEMA DE RESPALDOS ═══');
  Logger.log('Proyecto (scriptId): ' + ScriptApp.getScriptId());

  // 1. Activadores: ¿está instalado el respaldo semanal?
  var triggers = ScriptApp.getProjectTriggers();
  Logger.log('— Activadores instalados en ESTE proyecto: ' + triggers.length);
  var tieneRespaldo = false;
  for (var i = 0; i < triggers.length; i++) {
    var fn = triggers[i].getHandlerFunction();
    if (fn === 'respaldarBasesDeDatos') tieneRespaldo = true;
    Logger.log('   • ' + fn + '  [' + triggers[i].getEventType() + ']');
  }
  Logger.log(tieneRespaldo
    ? '   ✅ respaldarBasesDeDatos TIENE activador en este proyecto.'
    : '   ❌ respaldarBasesDeDatos NO tiene activador aquí: el respaldo automático NO corre. Ejecuta configurarTriggers().');

  // 2. Carpeta de respaldos configurada y accesible.
  if (!CONFIG || !CONFIG.CARPETAS || !CONFIG.CARPETAS.BACKUPS) {
    Logger.log('❌ CONFIG.CARPETAS.BACKUPS NO está configurada en ESTE proyecto.');
    Logger.log('   El respaldo sale por el return temprano y no envía correo: falla en silencio.');
    Logger.log('   Solución: ejecutar _configurarCarpetaBackups() aquí (config_local.js).');
    return;
  }

  var carpetaBackups;
  try {
    carpetaBackups = DriveApp.getFolderById(CONFIG.CARPETAS.BACKUPS);
    Logger.log('✅ Carpeta de respaldos accesible: "' + carpetaBackups.getName() + '"');
  } catch (e) {
    Logger.log('❌ La carpeta de respaldos configurada no se puede abrir — ' + e);
    return;
  }

  // 3. Qué hay realmente adentro, del más reciente al más antiguo.
  var fechas = [];
  var subcarpetas = carpetaBackups.getFolders();
  while (subcarpetas.hasNext()) fechas.push(subcarpetas.next().getName());
  fechas.sort(function(a, b) { return b.localeCompare(a); });

  Logger.log('— Respaldos encontrados: ' + fechas.length);
  if (fechas.length === 0) {
    Logger.log('   ❌ No hay ningún respaldo en la carpeta.');
  } else {
    Logger.log('   Último: ' + fechas[0] + (fechas.length > 1 ? '   Anterior: ' + fechas[1] : ''));
    var diasDesde = Math.floor(
      (new Date() - new Date(fechas[0] + 'T00:00:00')) / (1000 * 60 * 60 * 24)
    );
    if (!isNaN(diasDesde)) {
      Logger.log('   Antigüedad del último respaldo: ' + diasDesde + ' día(s).');
      if (diasDesde > 8) Logger.log('   ⚠️ Más de una semana sin respaldar: el activador no está dejando copias.');
    }
  }

  Logger.log('═══ FIN DEL DIAGNÓSTICO ═══');
}

// ==========================================================
// MANTENCIÓN: normalización de teléfonos de contacto
// ==========================================================

/**
 * Lleva un teléfono a formato canónico "+569XXXXXXXX".
 *
 * Devuelve "" cuando el valor no permite deducir el número con certeza. En ese
 * caso la fila se deja intacta y se reporta para revisión manual: preferimos un
 * dato heterogéneo antes que uno inventado.
 *
 * Sólo se reconocen dos formas, las únicas que identifican un móvil chileno sin
 * ambigüedad. Un valor de 8 dígitos sueltos ("12345678") NO se normaliza: podría
 * ser un móvil al que le falta el 9 o un fijo antiguo, y la validación del
 * frontend ya lo acepta tal como está.
 *
 * Espejo de parsePhoneToSuffix() en Index.html — si cambia el criterio de uno,
 * actualizar el otro.
 */
function _normalizarTelefonoCanonico(valor) {
  var digitos = (valor === null || valor === undefined ? '' : String(valor)).replace(/[^0-9]/g, '');
  if (digitos.length === 11 && digitos.indexOf('569') === 0) return '+' + digitos;   // 56912345678
  if (digitos.length === 9  && digitos.charAt(0) === '9')    return '+56' + digitos; // 912345678
  return '';
}

/**
 * Normaliza la columna CONTACTO de la hoja USUARIOS al formato "+569XXXXXXXX".
 *
 * Corre en SIMULACIÓN salvo que aplicarCambios sea exactamente true: sin eso no
 * escribe nada y sólo informa qué haría. Es idempotente, y nunca toca las celdas
 * vacías, las que dicen "S/D" (centinela de "sin datos") ni las que no puede
 * interpretar con certeza.
 *
 * ADMIN-only y sin modo automático: no la ejecuta ningún activador. Se corre a
 * mano desde el editor de GAS con simularNormalizacionTelefonos() y, una vez
 * revisado el informe, con aplicarNormalizacionTelefonos().
 */
function normalizarTelefonosUsuarios(rutSolicitante, aplicarCambios) {
  _ensureConfig();

  // Sin excepción para rutSolicitante vacío: a diferencia de respaldarBasesDeDatos
  // esta función escribe sobre la ficha de todos los socios y ningún trigger la
  // invoca, así que siempre exige un ADMIN identificado.
  var verificacion = verificarRolUsuario(rutSolicitante, ['ADMIN']);
  if (!verificacion.autorizado) {
    Logger.log('⚠️ normalizarTelefonosUsuarios: intento no autorizado — RUT=' + rutSolicitante);
    return { success: false, message: "No autorizado." };
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    return { success: false, message: "Servidor ocupado. Intente nuevamente." };
  }

  try {
    var sheet      = getSheet('USUARIOS', 'USUARIOS');
    var COL        = CONFIG.COLUMNAS.USUARIOS;
    var ultimaFila = sheet.getLastRow();

    if (ultimaFila < 2) {
      return { success: true, aplicado: false, total: 0, normalizados: [], yaCorrectos: 0, sinDatos: 0, revisarManualmente: [] };
    }

    var filas = ultimaFila - 1;
    // getValues() y no getDisplayValues(): las filas que no se tocan se reescriben
    // con su valor original y así conservan el tipo que ya tenían en la celda.
    var rangoContacto = sheet.getRange(2, COL.CONTACTO + 1, filas, 1);
    var valores = rangoContacto.getValues();
    var ruts    = sheet.getRange(2, COL.RUT + 1, filas, 1).getDisplayValues();

    var normalizados = [];
    var revisar      = [];
    var yaCorrectos  = 0;
    var sinDatos     = 0;

    for (var i = 0; i < filas; i++) {
      var original = valores[i][0];
      var texto    = (original === null || original === undefined ? '' : String(original)).trim();
      var rutFila  = (ruts[i][0] || '').toString().trim();

      if (texto === '' || texto.toUpperCase() === 'S/D') { sinDatos++; continue; }

      var canonico = _normalizarTelefonoCanonico(texto);

      if (canonico === '')     { revisar.push({ fila: i + 2, rut: rutFila, valor: texto }); continue; }
      if (canonico === texto)  { yaCorrectos++; continue; }

      normalizados.push({ fila: i + 2, rut: rutFila, antes: texto, despues: canonico });
      valores[i][0] = canonico;
    }

    if (aplicarCambios === true && normalizados.length > 0) {
      // Una sola escritura para toda la columna en vez de N celdas sueltas: las
      // filas sin cambio se reescriben con el valor que ya traían y el trabajo
      // queda muy por debajo del límite de 6 minutos.
      rangoContacto.setValues(valores);
      SpreadsheetApp.flush();
    }

    Logger.log(
      (aplicarCambios === true ? '✅ APLICADO' : '🔍 SIMULACIÓN') +
      ' — normalizarTelefonosUsuarios: ' + filas + ' filas | ' +
      normalizados.length + ' a normalizar | ' + yaCorrectos + ' ya correctos | ' +
      sinDatos + ' sin datos | ' + revisar.length + ' a revisar a mano'
    );
    normalizados.forEach(function(n) { Logger.log('   fila ' + n.fila + ' (' + n.rut + '): "' + n.antes + '" → "' + n.despues + '"'); });
    revisar.forEach(function(r)      { Logger.log('   ⚠️ fila ' + r.fila + ' (' + r.rut + '): "' + r.valor + '" no se pudo interpretar'); });

    return {
      success: true,
      aplicado: aplicarCambios === true,
      total: filas,
      normalizados: normalizados,
      yaCorrectos: yaCorrectos,
      sinDatos: sinDatos,
      revisarManualmente: revisar
    };

  } catch (e) {
    Logger.log('❌ Error en normalizarTelefonosUsuarios: ' + e.toString());
    return { success: false, message: "Ocurrió un error interno al normalizar los teléfonos." };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Atajos para ejecutar la mantención desde el editor de GAS, que no permite
 * pasar argumentos. El RUT del ADMIN se lee de PropertiesService (clave
 * RUT_MANTENCION) para no versionarlo en el código.
 *
 * ⚠️ BORRAR RUT_MANTENCION AL TERMINAR. La webapp es ANYONE_ANONYMOUS y toda
 * función global es invocable con google.script.run; mientras la propiedad
 * exista, estos dos atajos corren sin que quien los llame acredite ser ADMIN.
 * Sin la propiedad quedan inertes y sólo sirve normalizarTelefonosUsuarios(),
 * que sí exige un RUT con rol ADMIN.
 */
function simularNormalizacionTelefonos() {
  return _correrNormalizacionTelefonos(false);
}

function aplicarNormalizacionTelefonos() {
  return _correrNormalizacionTelefonos(true);
}

function _correrNormalizacionTelefonos(aplicar) {
  var rut = PropertiesService.getScriptProperties().getProperty('RUT_MANTENCION');
  if (!rut) {
    Logger.log('❌ Falta la propiedad RUT_MANTENCION en PropertiesService (RUT de un ADMIN).');
    return { success: false, message: "Falta configurar RUT_MANTENCION." };
  }
  var resultado = normalizarTelefonosUsuarios(rut, aplicar);
  Logger.log(JSON.stringify(resultado, null, 2));
  return resultado;
}

