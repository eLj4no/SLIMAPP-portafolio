// ============================================================
// REGISTRO DE PERMISOS DE ARCHIVOS
// ============================================================
// Los permisos de Drive se otorgan UNA sola vez, dentro de
// subirArchivoConPermisos(), con el correo que el socio tenía en ese instante.
// Después nadie vuelve a mirar ese archivo. Eso deja tres situaciones que hoy
// nadie detecta:
//
//   1. El socio cambió de correo  → el nuevo no tiene acceso y el antiguo lo
//      conserva para siempre.
//   2. No tenía correo al hacer el trámite → el archivo se subió sin él y al
//      registrarlo después nadie repara nada.
//   3. El permiso falló al subir → permisosError se muestra al frontend en el
//      momento y ahí muere, sin reintento.
//
// Este módulo NO corrige nada todavía: sólo levanta el registro de qué archivo
// está vinculado a qué socio y quién tiene acceso hoy, para poder dimensionar
// el problema antes de decidir si se revoca el correo antiguo. La corrección
// (reconciliación periódica) se construye encima de esta hoja.
//
// Es de sólo lectura sobre Drive: no otorga ni revoca ningún permiso.
// ============================================================

/**
 * Nombre de la pestaña del registro, dentro del spreadsheet de USUARIOS.
 *
 * Constante local y no una clave de CONFIG.HOJAS a propósito: agregar una
 * clave a CONFIG obliga a ejecutar un _configurar*() en DEV y en PROD antes de
 * que nada funcione, y mientras tanto el índice queda undefined y el dato se
 * pierde en silencio. Mismo criterio que CFG_ASISTENCIA_BRIGADA.NOMBRE_HOJA.
 *
 * Al vivir dentro del spreadsheet de USUARIOS queda cubierta por el respaldo
 * semanal sin cablear nada. Si una restauración la pisa no se pierde nada:
 * es estado derivado, se reconstruye volviendo a escanear.
 */
var HOJA_PERMISOS_ARCHIVOS = 'PERMISOS_ARCHIVOS';

var CABECERAS_PERMISOS_ARCHIVOS = [
  'PASE', 'FECHA_REVISION', 'RUT', 'NOMBRE', 'MODULO', 'ID_REGISTRO',
  'FILE_ID', 'URL', 'CORREO_VIGENTE', 'CORREO_CON_ACCESO', 'ESTADO', 'DETALLE'
];

/**
 * Presupuesto de tiempo por ejecución. El límite duro de GAS son 6 minutos y
 * cada archivo cuesta una llamada a Drive, así que el escaneo se corta antes y
 * guarda por dónde iba: la próxima ejecución continúa el mismo pase.
 */
var LIMITE_MS_ESCANEO_PERMISOS = 4 * 60 * 1000;

/** Clave de PropertiesService donde vive el cursor del pase en curso. */
var CLAVE_CURSOR_PERMISOS = 'PERMISOS_ARCHIVOS_CURSOR';

/** Cuántos pases se conservan en la hoja (el actual y el anterior). */
var PASES_A_CONSERVAR = 2;

/**
 * Dónde vive cada archivo que el sistema sube a nombre de un socio.
 *
 * Declarativo a propósito: sumar un módulo nuevo es agregar una entrada, no
 * tocar el recorrido. Los nombres de columna se resuelven contra
 * CONFIG.COLUMNAS en tiempo de ejecución y los índices undefined se saltan con
 * aviso (regla del guard !== undefined), para que un entorno al que le falta
 * un _configurar*() no escriba datos falsos.
 */
var CATALOGO_ARCHIVOS_MODULOS = [
  {
    clave: 'JUSTIFICACIONES', spreadsheet: 'JUSTIFICACIONES', hoja: 'JUSTIFICACIONES',
    columnas: 'JUSTIFICACIONES', colRut: 'RUT', colId: 'ID',
    colDirigente: 'CORREO_DIRIGENTE', colsUrl: ['RESPALDO']
  },
  {
    clave: 'APELACIONES', spreadsheet: 'APELACIONES', hoja: 'APELACIONES',
    columnas: 'APELACIONES', colRut: 'RUT', colId: 'ID',
    colDirigente: 'CORREO_DIRIGENTE',
    colsUrl: ['URL_COMPROBANTE', 'URL_LIQUIDACION', 'URL_COMPROBANTE_DEVOLUCION']
  },
  {
    clave: 'PRESTAMOS', spreadsheet: 'PRESTAMOS', hoja: 'PRESTAMOS',
    columnas: 'PRESTAMOS', colRut: 'RUT', colId: 'ID',
    colDirigente: 'CORREO_DIRIGENTE', colsUrl: ['URL_COMPROBANTE_VACACIONES']
  },
  {
    clave: 'PERMISOS_MEDICOS', spreadsheet: 'PERMISOS_MEDICOS', hoja: 'PERMISOS_MEDICOS',
    columnas: 'PERMISOS_MEDICOS', colRut: 'RUT', colId: 'ID',
    colDirigente: 'CORREO_DIRIGENTE', colsUrl: ['URL_DOCUMENTO']
  },
  {
    clave: 'DENUNCIAS_JEFATURAS', spreadsheet: 'DENUNCIAS_JEFATURAS', hoja: 'DENUNCIAS_JEFATURAS',
    columnas: 'DENUNCIAS_JEFATURAS', colRut: 'RUT_DENUNCIANTE', colId: 'ID',
    colDirigente: 'CORREO_DIRIGENTE', colsUrl: ['URL_ARCHIVO']
  },
  {
    // Vive dentro del spreadsheet de denuncias, no tiene uno propio.
    clave: 'GESTIONES_EMPRESA', spreadsheet: 'DENUNCIAS_JEFATURAS', hoja: 'GESTIONES_EMPRESA',
    columnas: 'GESTIONES_EMPRESA', colRut: 'RUT', colId: 'ID',
    colsUrl: ['URLS_RESPALDO'], variasUrlPorCelda: true
  },
  {
    // Los dos archivos que cuelgan de la ficha del socio. El ID de registro es
    // el propio RUT: no hay número de solicitud.
    clave: 'USUARIOS', spreadsheet: 'USUARIOS', hoja: 'USUARIOS',
    columnas: 'USUARIOS', colRut: 'RUT', colId: 'RUT',
    colsUrl: ['URL_CERT_PIE_DIABETICO', 'DOC_FALLECIMIENTO_URL']
  },

  // --- Registros eliminados por el socio -----------------------------------
  // Al eliminar un trámite, la fila se respalda en "Registros-eliminados" y se
  // borra de la hoja viva, pero el archivo SIGUE EN DRIVE con sus permisos. Sin
  // estas tres entradas, esos archivos quedaban fuera del alcance de la
  // reconciliación para siempre: nadie volvía a actualizarle el acceso al socio
  // ni a revocarle el correo antiguo. Justo el agujero que este módulo existe
  // para tapar, por una puerta lateral.
  //
  // El respaldo copia la fila TAL CUAL y agrega columnas de trazabilidad al
  // final, así que los índices de la hoja de origen siguen siendo válidos: se
  // reutiliza la misma configuración de columnas.
  //
  // hojaLiteral porque "Registros-eliminados" es una constante (Global.js), no
  // una clave de CONFIG.HOJAS. Sólo se LEE: la pestaña es append-only.
  {
    clave: 'JUSTIFICACIONES_ELIMINADAS', spreadsheet: 'JUSTIFICACIONES',
    hoja: HOJA_REGISTROS_ELIMINADOS, hojaLiteral: true,
    columnas: 'JUSTIFICACIONES', colRut: 'RUT', colId: 'ID',
    colDirigente: 'CORREO_DIRIGENTE', colsUrl: ['RESPALDO']
  },
  {
    clave: 'APELACIONES_ELIMINADAS', spreadsheet: 'APELACIONES',
    hoja: HOJA_REGISTROS_ELIMINADOS, hojaLiteral: true,
    columnas: 'APELACIONES', colRut: 'RUT', colId: 'ID',
    colDirigente: 'CORREO_DIRIGENTE',
    colsUrl: ['URL_COMPROBANTE', 'URL_LIQUIDACION', 'URL_COMPROBANTE_DEVOLUCION']
  },
  {
    clave: 'PRESTAMOS_ELIMINADOS', spreadsheet: 'PRESTAMOS',
    hoja: HOJA_REGISTROS_ELIMINADOS, hojaLiteral: true,
    columnas: 'PRESTAMOS', colRut: 'RUT', colId: 'ID',
    colDirigente: 'CORREO_DIRIGENTE', colsUrl: ['URL_COMPROBANTE_VACACIONES']
  }
];

/**
 * Abre la hoja de una entrada del catálogo. Devuelve null si no existe — una
 * pestaña "Registros-eliminados" no existe hasta la primera eliminación.
 */
function _abrirHojaDelCatalogo(def) {
  try {
    if (def.hojaLiteral) return getSpreadsheet(def.spreadsheet).getSheetByName(def.hoja);
    return getSheet(def.spreadsheet, def.hoja);
  } catch (e) {
    return null;
  }
}

/**
 * Crea la hoja del registro si no existe y le repara la cabecera si le falta
 * alguna columna. Autoreparable por nombre, igual que
 * _asegurarColumnasTrazabilidadEliminacion(): sin claves en PropertiesService
 * y sin pasos manuales por entorno.
 */
function _asegurarHojaPermisosArchivos() {
  var ss = getSpreadsheet('USUARIOS');
  var hoja = ss.getSheetByName(HOJA_PERMISOS_ARCHIVOS);

  if (!hoja) {
    hoja = ss.insertSheet(HOJA_PERMISOS_ARCHIVOS);
    hoja.getRange(1, 1, 1, CABECERAS_PERMISOS_ARCHIVOS.length)
        .setValues([CABECERAS_PERMISOS_ARCHIVOS])
        .setFontWeight('bold');
    hoja.setFrozenRows(1);
    Logger.log('✅ Hoja "' + HOJA_PERMISOS_ARCHIVOS + '" creada.');
    return hoja;
  }

  var ultimaCol = Math.max(hoja.getLastColumn(), 1);
  var cabecera = hoja.getRange(1, 1, 1, ultimaCol).getValues()[0];
  for (var i = 0; i < CABECERAS_PERMISOS_ARCHIVOS.length; i++) {
    if (String(cabecera[i] || '').trim() !== CABECERAS_PERMISOS_ARCHIVOS[i]) {
      hoja.getRange(1, i + 1).setValue(CABECERAS_PERMISOS_ARCHIVOS[i]).setFontWeight('bold');
    }
  }
  return hoja;
}

/**
 * Correos que pertenecen a la organización y no al socio. Se usan para no
 * confundir el acceso institucional (que siempre está y es correcto) con el
 * correo personal desactualizado, que es lo que se busca.
 *
 * Lee CUENTAS_VALIDAS COMPLETA: todos los roles y todos los estados.
 *
 * Deliberadamente NO usa obtenerCorreosAdmin/Directorio/RepLegal, que era la
 * implementación anterior y estaba mal por dos motivos:
 *
 *   1. Omitía el rol DIRIGENTE, y casi todos los módulos comparten con él
 *      (apelaciones, justificaciones, permisos médicos, denuncias llaman
 *      compartirArchivoConRol(..., 'DIRIGENTE', 'leer')). Cada dirigente
 *      aparecía entonces como si fuera un correo personal del socio.
 *   2. Filtran por estado ACTIVO, así que un ex dirigente o un ex admin que
 *      conserva el permiso en Drive tampoco quedaba excluido.
 *
 * El resultado era un DESACTUALIZADO inflado, y —mucho peor— una revocación
 * automática basada en esa columna le habría quitado el acceso a los dirigentes
 * en cientos de archivos. Aquí se prefiere pecar de incluir de más: dejar fuera
 * a alguien de la organización sólo puede evitar un daño, nunca causarlo.
 */
function _correosInstitucionales() {
  var set = {};

  // 1. CUENTAS_VALIDAS completa: las cuentas de cargo.
  try {
    var sheet = getSheet('USUARIOS', 'CUENTAS_VALIDAS');
    if (sheet) {
      var COL  = CONFIG.COLUMNAS.CUENTAS_VALIDAS;
      var data = sheet.getDataRange().getValues();
      for (var i = 1; i < data.length; i++) {
        var correo = _normalizarCorreoParaComparar(data[i][COL.CORREO]);
        if (correo) set[correo] = true;
      }
    }
  } catch (e) {
    Logger.log('⚠️ _correosInstitucionales: no se pudo leer CUENTAS_VALIDAS — ' + e);
  }

  // 2. Correos personales de quienes tienen rol de gestión en BD_SLIMAPP.
  //    Hasta 2026-08-24 validarCorreosParaPermisos() otorgaba permisos con esta
  //    dirección, no con la institucional, así que hay archivos históricos
  //    compartidos con ella. Sin este bloque, cada dirigente aparece como si
  //    fuera un correo personal desactualizado de un socio.
  try {
    var sheetU = getSheet('USUARIOS', 'USUARIOS');
    if (sheetU) {
      var COLU  = CONFIG.COLUMNAS.USUARIOS;
      var datosU = sheetU.getDataRange().getDisplayValues();
      for (var u = 1; u < datosU.length; u++) {
        var rol = String(datosU[u][COLU.ROL] || '').trim().toUpperCase();
        if (rol !== 'DIRIGENTE' && rol !== 'ADMIN' && rol !== 'DIRECTORIO') continue;
        var correoU = _normalizarCorreoParaComparar(datosU[u][COLU.CORREO]);
        if (correoU) set[correoU] = true;
      }
    }
  } catch (eU) {
    Logger.log('⚠️ _correosInstitucionales: no se pudo leer BD_SLIMAPP — ' + eU);
  }

  // 3. Lista blanca explícita, para las casillas de la organización que no son
  //    de una persona (administracion@, zonanorte@, zonasur@…) y por lo tanto no
  //    figuran ni en CUENTAS_VALIDAS ni como socio con rol en BD_SLIMAPP.
  try {
    var extra = JSON.parse(PropertiesService.getScriptProperties()
                  .getProperty('CORREOS_INSTITUCIONALES_EXTRA') || '[]');
    if (Object.prototype.toString.call(extra) === '[object Array]') {
      extra.forEach(function(c) {
        var n = _normalizarCorreoParaComparar(c);
        if (n) set[n] = true;
      });
    }
  } catch (eX) {
    Logger.log('⚠️ CORREOS_INSTITUCIONALES_EXTRA mal formada, se ignora — ' + eX);
  }

  return set;
}

/**
 * Forma canónica de un correo, SÓLO para comparar. Nunca para otorgar ni
 * revocar: para actuar se usa siempre la dirección literal que está en Drive.
 *
 * Gmail ignora los puntos del nombre de usuario y todo lo que venga después de
 * un "+", así que nombre.apellido@gmail.com y nombreapellido@gmail.com
 * son la MISMA casilla. Comparándolas como texto plano, el sistema creía que el
 * socio no tenía acceso a su propio archivo — y una revocación ingenua le habría
 * quitado el permiso a su propia cuenta.
 *
 * La regla de los puntos aplica sólo a Gmail: en otros dominios sí distinguen.
 */
function _normalizarCorreoParaComparar(correo) {
  var valor = String(correo || '').trim().toLowerCase();
  if (!valor || valor.indexOf('@') === -1) return '';

  var partes  = valor.split('@');
  var usuario = partes[0];
  var dominio = partes[1];

  var mas = usuario.indexOf('+');
  if (mas !== -1) usuario = usuario.substring(0, mas);

  if (dominio === 'gmail.com' || dominio === 'googlemail.com') {
    usuario = usuario.replace(/\./g, '');
    dominio = 'gmail.com';
  }

  return usuario ? (usuario + '@' + dominio) : '';
}

/**
 * Direcciones históricas comprobadas de cada socio: mapa RUT → {correo: true}.
 *
 * Cada módulo guarda su propia columna CORREO congelada con la dirección que el
 * socio tenía al hacer ese trámite. Ese dato es PRUEBA de que la dirección le
 * pertenece a esa persona, con RUT y nombre en la misma fila — a diferencia de
 * "quién tiene acceso al archivo", que mezcla socios, dirigentes y ex roles.
 *
 * Es la única base admisible para revocar: sin esto, la reconciliación estaría
 * adivinando de quién es cada correo.
 *
 * Justificaciones no tiene columna CORREO y por sí sola no prueba nada, pero si
 * el mismo RUT aparece en una apelación con su correo anterior, esa evidencia
 * sirve igual para sus justificaciones: es el mismo socio.
 */
function _mapaCorreosHistoricosPorRut() {
  var mapa = {};

  var fuentes = [
    { spreadsheet: 'APELACIONES',         hoja: 'APELACIONES',         columnas: 'APELACIONES',         colRut: 'RUT',             colCorreo: 'CORREO' },
    { spreadsheet: 'PRESTAMOS',           hoja: 'PRESTAMOS',           columnas: 'PRESTAMOS',           colRut: 'RUT',             colCorreo: 'CORREO' },
    { spreadsheet: 'PERMISOS_MEDICOS',    hoja: 'PERMISOS_MEDICOS',    columnas: 'PERMISOS_MEDICOS',    colRut: 'RUT',             colCorreo: 'CORREO' },
    { spreadsheet: 'DENUNCIAS_JEFATURAS', hoja: 'DENUNCIAS_JEFATURAS', columnas: 'DENUNCIAS_JEFATURAS', colRut: 'RUT_DENUNCIANTE', colCorreo: 'CORREO_DENUNCIANTE' },
    { spreadsheet: 'DENUNCIAS_JEFATURAS', hoja: 'GESTIONES_EMPRESA',   columnas: 'GESTIONES_EMPRESA',   colRut: 'RUT',             colCorreo: 'CORREO' }
  ];

  fuentes.forEach(function(f) {
    try {
      var sheet = getSheet(f.spreadsheet, f.hoja);
      if (!sheet) return;

      var COL = (CONFIG.COLUMNAS || {})[f.columnas];
      if (!COL || COL[f.colRut] === undefined || COL[f.colCorreo] === undefined) {
        Logger.log('⚠️ ' + f.hoja + ': columnas no configuradas, se omite como fuente histórica.');
        return;
      }

      var datos = sheet.getDataRange().getDisplayValues();
      for (var i = 1; i < datos.length; i++) {
        var rut = cleanRut(datos[i][COL[f.colRut]]);
        var correoLiteral = String(datos[i][COL[f.colCorreo]] || '').trim().toLowerCase();
        if (!rut || !correoLiteral || !esCorreoValido(correoLiteral)) continue;
        // Se indexa por forma canónica: el historial existe para COMPARAR.
        var correo = _normalizarCorreoParaComparar(correoLiteral);
        if (!correo) continue;
        if (!mapa[rut]) mapa[rut] = {};
        mapa[rut][correo] = true;
      }
    } catch (e) {
      Logger.log('⚠️ Fuente histórica ' + f.hoja + ' omitida — ' + e);
    }
  });

  return mapa;
}

/** Mapa RUT limpio → {nombre, correo}. Una sola lectura de la hoja USUARIOS. */
function _mapaCorreosVigentes() {
  var sheet = getSheet('USUARIOS', 'USUARIOS');
  var COL = CONFIG.COLUMNAS.USUARIOS;
  var datos = sheet.getDataRange().getDisplayValues();
  var mapa = {};

  for (var i = 1; i < datos.length; i++) {
    var rut = cleanRut(datos[i][COL.RUT]);
    if (!rut) continue;
    mapa[rut] = {
      nombre: String(datos[i][COL.NOMBRE] || ''),
      correo: String(datos[i][COL.CORREO] || '').trim().toLowerCase()
    };
  }
  return mapa;
}

/**
 * Quién tiene acceso hoy a un archivo, según Drive.
 * Devuelve null si el archivo no se puede abrir (borrado definitivamente,
 * fuera de la cuenta, o el ID no corresponde a nada).
 */
function _accesosActualesDeArchivo(fileId) {
  try {
    var file = DriveApp.getFileById(fileId);
    var correos = [];

    file.getViewers().forEach(function(u) { correos.push(String(u.getEmail() || '').toLowerCase()); });
    file.getEditors().forEach(function(u) { correos.push(String(u.getEmail() || '').toLowerCase()); });

    return { correos: correos, enPapelera: file.isTrashed() };
  } catch (e) {
    return null;
  }
}

/**
 * Clasifica un archivo comparando el correo vigente del socio contra quién
 * tiene acceso realmente.
 *
 * ESTADO:
 *   OK                   el correo vigente del socio tiene acceso.
 *   DESACTUALIZADO       el socio tiene correo, no tiene acceso, y hay otro
 *                        correo personal con acceso: el antiguo quedó anclado.
 *   SIN_ACCESO           el socio tiene correo y nadie personal tiene acceso
 *                        (no tenía correo al subir, o el permiso falló).
 *   SOCIO_SIN_CORREO     hoy no hay correo registrado: no hay nada que otorgar.
 *   ARCHIVO_NO_ACCESIBLE el archivo ya no existe o no se puede abrir.
 */
function _clasificarAccesoArchivo(correoVigente, accesos, institucionales, correoDirigente) {
  if (!accesos) {
    return { estado: 'ARCHIVO_NO_ACCESIBLE', correoConAcceso: '', detalle: 'No se pudo abrir el archivo en Drive.' };
  }

  var detalle = accesos.enPapelera ? 'El archivo está en la papelera. ' : '';

  // El dirigente que gestionó a nombre del socio también es un acceso legítimo:
  // sin excluirlo, toda gestión de dirigente se vería como "desactualizada".
  var excluidos = {};
  for (var k in institucionales) excluidos[k] = true;
  var dirigenteCanonico = _normalizarCorreoParaComparar(correoDirigente);
  if (dirigenteCanonico) excluidos[dirigenteCanonico] = true;

  // Se compara en forma canónica y se conserva la literal: la dirección que hay
  // que otorgar o revocar después es la que realmente figura en Drive.
  var personales = accesos.correos.filter(function(c) {
    var canonico = _normalizarCorreoParaComparar(c);
    return canonico && !excluidos[canonico];
  });

  if (!correoVigente || !esCorreoValido(correoVigente)) {
    return {
      estado: 'SOCIO_SIN_CORREO',
      correoConAcceso: personales.join(', '),
      detalle: detalle + 'El socio no tiene un correo válido registrado hoy.'
    };
  }

  var vigenteCanonico = _normalizarCorreoParaComparar(correoVigente);
  var tieneAcceso = accesos.correos.some(function(c) {
    return _normalizarCorreoParaComparar(c) === vigenteCanonico;
  });
  if (tieneAcceso) {
    return { estado: 'OK', correoConAcceso: correoVigente, detalle: detalle };
  }

  if (personales.length > 0) {
    return {
      estado: 'DESACTUALIZADO',
      correoConAcceso: personales.join(', '),
      detalle: detalle + 'El acceso quedó anclado a un correo anterior del socio.'
    };
  }

  return {
    estado: 'SIN_ACCESO',
    correoConAcceso: '',
    detalle: detalle + 'El socio nunca recibió acceso a su propio archivo.'
  };
}

/**
 * Corrige el acceso de UN archivo: le otorga al socio su correo vigente y le
 * revoca la dirección anterior, cuando hay evidencia de que era suya.
 *
 * Las dos operaciones son independientes: puede otorgar sin revocar (el socio
 * nunca tuvo acceso) o revocar sin otorgar (hoy no tiene correo válido).
 *
 * REGLA DE REVOCACIÓN: sólo se quita una dirección que esté en el historial
 * COMPROBADO de ese mismo socio — las columnas CORREO congeladas de sus propios
 * trámites. Nunca se deduce de "quién tiene acceso": ahí conviven dirigentes,
 * cuentas institucionales y ex miembros, y revocar por esa vía les quitaría el
 * acceso a todos ellos.
 *
 * Se otorga y se revoca con la dirección LITERAL que figura en Drive; la forma
 * canónica sólo sirve para decidir.
 */
function _reconciliarArchivo(fileId, correoVigente, accesos, institucionales, previos, correoDirigente) {
  var res = { hizoAlgo: false, otorgado: '', revocados: [], errores: [] };

  var vigenteCanonico = _normalizarCorreoParaComparar(correoVigente);
  var excluidos = {};
  for (var k in institucionales) excluidos[k] = true;
  var dirigenteCanonico = _normalizarCorreoParaComparar(correoDirigente);
  if (dirigenteCanonico) excluidos[dirigenteCanonico] = true;

  // 1. Otorgar al correo vigente, si le falta.
  if (vigenteCanonico && esCorreoValido(correoVigente)) {
    var yaTiene = accesos.correos.some(function(c) {
      return _normalizarCorreoParaComparar(c) === vigenteCanonico;
    });
    if (!yaTiene) {
      try {
        otorgarPermisoSilencioso_(fileId, correoVigente, 'reader');
        res.otorgado = correoVigente;
        res.hizoAlgo = true;
      } catch (eIns) {
        res.errores.push('otorgar a ' + correoVigente + ': ' + eIns);
      }
    }
  }

  // 2. Revocar direcciones anteriores COMPROBADAS del socio.
  var aRevocar = accesos.correos.filter(function(c) {
    var canonico = _normalizarCorreoParaComparar(c);
    if (!canonico || excluidos[canonico]) return false;
    if (canonico === vigenteCanonico) return false;   // su casilla actual
    return !!previos[canonico];                       // sólo con evidencia
  });

  if (aRevocar.length > 0) {
    try {
      var permisos = Drive.Permissions.list(fileId);
      var items = (permisos && permisos.items) ? permisos.items : [];
      aRevocar.forEach(function(correo) {
        var canonico = _normalizarCorreoParaComparar(correo);
        for (var p = 0; p < items.length; p++) {
          if (_normalizarCorreoParaComparar(items[p].emailAddress) !== canonico) continue;
          try {
            Drive.Permissions.remove(fileId, items[p].id);
            res.revocados.push(correo);
            res.hizoAlgo = true;
          } catch (eRem) {
            res.errores.push('revocar ' + correo + ': ' + eRem);
          }
        }
      });
    } catch (eList) {
      res.errores.push('listar permisos: ' + eList);
    }
  }

  var partes = [];
  if (res.otorgado) partes.push('otorgado a ' + res.otorgado);
  if (res.revocados.length) partes.push('revocado ' + res.revocados.join(', '));
  if (res.errores.length) partes.push('ERRORES: ' + res.errores.join('; '));
  res.detalle = partes.join(' | ');

  return res;
}

/**
 * Recorre todos los módulos del catálogo, verifica en Drive quién tiene acceso
 * a cada archivo y deja el resultado en la hoja PERMISOS_ARCHIVOS.
 *
 * Con aplicarCorrecciones === true además RECONCILIA: le otorga al socio su
 * correo vigente y le revoca el anterior cuando hay evidencia. Es el mismo
 * recorrido para no mantener dos: reconciliar es escanear y además corregir.
 *
 * Sin ese parámetro SÓLO LEE Drive: no otorga ni revoca nada.
 *
 * Resumible: si se acaba el presupuesto de tiempo guarda un cursor y la
 * siguiente ejecución continúa el MISMO pase donde quedó. Un pase completo es
 * la unidad que lee el informe.
 *
 * @param {string} rutSolicitante RUT de un ADMIN (obligatorio).
 * @returns {{success: boolean, ...}}
 */
function escanearPermisosArchivos(rutSolicitante, aplicarCorrecciones) {
  _ensureConfig();

  // rutSolicitante vacío = llamada de un activador, que corre sin usuario
  // identificado (mismo criterio que respaldarBasesDeDatos). Consecuencia
  // asumida: el webapp es ANYONE_ANONYMOUS y una llamada sin RUT es invocable
  // desde la consola del navegador. Se aceptó a conciencia porque la función es
  // idempotente, no devuelve datos personales, y hace lo mismo la llame quien la
  // llame: otorgar al socio lo suyo y quitar sólo lo que se prueba que fue suyo.
  if (rutSolicitante) {
    var verificacion = verificarRolUsuario(rutSolicitante, ['ADMIN']);
    if (!verificacion.autorizado) {
      Logger.log('⚠️ escanearPermisosArchivos: intento no autorizado — RUT=' + rutSolicitante);
      return { success: false, message: 'No autorizado.' };
    }
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return { success: false, message: 'Ya hay un escaneo en curso.' };

  var inicio = new Date().getTime();

  try {
    var hojaRegistro = _asegurarHojaPermisosArchivos();
    var props = PropertiesService.getScriptProperties();

    // Cursor: o continuamos el pase interrumpido, o abrimos uno nuevo.
    var cursor = null;
    try { cursor = JSON.parse(props.getProperty(CLAVE_CURSOR_PERMISOS) || 'null'); } catch (e) { cursor = null; }

    var paseNuevo = !cursor;
    var pase = cursor ? cursor.pase
                      : Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd_HH-mm');

    if (paseNuevo) _purgarPasesAntiguos(hojaRegistro, pase);

    var institucionales = _correosInstitucionales();
    var usuarios        = _mapaCorreosVigentes();
    // El historial sólo hace falta para revocar con evidencia: en modo lectura
    // se evita el costo de leer cinco hojas más.
    var historicos      = (aplicarCorrecciones === true) ? _mapaCorreosHistoricosPorRut() : {};
    var fecha           = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm');

    var otorgados = 0, revocados = 0;
    var filasNuevas   = [];
    var procesados    = 0;
    var seAcaboTiempo = false;
    var moduloInicial = cursor ? cursor.modulo : 0;
    var filaInicial   = cursor ? cursor.fila   : 1;

    for (var m = moduloInicial; m < CATALOGO_ARCHIVOS_MODULOS.length && !seAcaboTiempo; m++) {
      var def = CATALOGO_ARCHIVOS_MODULOS[m];
      var desde = (m === moduloInicial) ? filaInicial : 1;

      var sheet = _abrirHojaDelCatalogo(def);
      if (!sheet) {
        Logger.log('⚠️ ' + def.clave + ': hoja no disponible, se omite.');
        continue;
      }

      var COL = (CONFIG.COLUMNAS || {})[def.columnas];
      if (!COL) {
        Logger.log('⚠️ CONFIG.COLUMNAS.' + def.columnas + ' no existe — ejecuta el _configurar*() correspondiente. Módulo omitido.');
        continue;
      }

      // Columnas de URL realmente configuradas en ESTE entorno.
      var colsUrl = def.colsUrl.filter(function(nombre) {
        if (COL[nombre] === undefined) {
          Logger.log('⚠️ ' + def.clave + '.' + nombre + ' sin configurar — esa columna no se revisa.');
          return false;
        }
        return true;
      });
      if (colsUrl.length === 0 || COL[def.colRut] === undefined) continue;

      var datos = sheet.getDataRange().getDisplayValues();

      for (var i = desde; i < datos.length; i++) {
        if (new Date().getTime() - inicio > LIMITE_MS_ESCANEO_PERMISOS) {
          props.setProperty(CLAVE_CURSOR_PERMISOS, JSON.stringify({ pase: pase, modulo: m, fila: i }));
          seAcaboTiempo = true;
          Logger.log('⏱️ Presupuesto agotado en ' + def.clave + ', fila ' + i + '. El pase continúa en la próxima ejecución.');
          break;
        }

        var row = datos[i];
        var rut = cleanRut(row[COL[def.colRut]]);
        if (!rut) continue;

        var socio         = usuarios[rut] || { nombre: '', correo: '' };
        var idRegistro    = (COL[def.colId] !== undefined) ? String(row[COL[def.colId]] || '') : '';
        var correoDirig   = (def.colDirigente && COL[def.colDirigente] !== undefined)
                            ? String(row[COL[def.colDirigente]] || '').trim().toLowerCase() : '';

        for (var u = 0; u < colsUrl.length; u++) {
          var celda = String(row[COL[colsUrl[u]]] || '').trim();
          if (!celda || celda.indexOf('drive.google.com') === -1) continue;

          // GESTIONES_EMPRESA guarda varias URL separadas por coma en una celda.
          var urls = def.variasUrlPorCelda ? celda.split(/[,\s]+/) : [celda];

          for (var v = 0; v < urls.length; v++) {
            var url = String(urls[v] || '').trim();
            if (!url || url.indexOf('drive.google.com') === -1) continue;

            var fileId = extraerFileIdDeDriveUrl(url);
            if (!fileId) {
              filasNuevas.push([pase, fecha, formatRutDisplay(rut), socio.nombre, def.clave,
                                idRegistro, '', url, socio.correo, '', 'URL_INVALIDA',
                                'No se pudo extraer el ID del archivo desde la URL.']);
              continue;
            }

            var accesos = _accesosActualesDeArchivo(fileId);
            var fallo   = _clasificarAccesoArchivo(socio.correo, accesos, institucionales, correoDirig);
            var detalleAccion = '';

            if (aplicarCorrecciones === true && accesos) {
              var accion = _reconciliarArchivo(fileId, socio.correo, accesos,
                                               institucionales, historicos[rut] || {}, correoDirig);
              if (accion.hizoAlgo) {
                if (accion.otorgado) otorgados++;
                revocados += accion.revocados.length;
                detalleAccion = accion.detalle;
                // Se relee el estado real después de actuar: la hoja debe
                // registrar cómo quedó el archivo, no cómo estaba antes.
                accesos = _accesosActualesDeArchivo(fileId);
                fallo   = _clasificarAccesoArchivo(socio.correo, accesos, institucionales, correoDirig);
              } else if (accion.errores.length) {
                detalleAccion = accion.detalle;
              }
            }

            filasNuevas.push([pase, fecha, formatRutDisplay(rut), socio.nombre, def.clave,
                              idRegistro, fileId, url, socio.correo,
                              fallo.correoConAcceso, fallo.estado,
                              detalleAccion ? (detalleAccion + ' — ' + fallo.detalle) : fallo.detalle]);
            procesados++;
          }
        }
      }
    }

    if (filasNuevas.length > 0) {
      hojaRegistro.getRange(hojaRegistro.getLastRow() + 1, 1, filasNuevas.length, CABECERAS_PERMISOS_ARCHIVOS.length)
                  .setValues(filasNuevas);
    }

    if (!seAcaboTiempo) props.deleteProperty(CLAVE_CURSOR_PERMISOS);

    Logger.log('✅ ' + (aplicarCorrecciones === true ? 'Reconciliación' : 'Escaneo') + ' ' +
               (seAcaboTiempo ? 'PARCIAL' : 'COMPLETO') + ' — pase ' + pase +
               ', ' + procesados + ' archivo(s) revisados en esta ejecución.');
    if (aplicarCorrecciones === true) {
      Logger.log('   Permisos otorgados: ' + otorgados + ' | revocados: ' + revocados);
    }

    return {
      success: true,
      pase: pase,
      completo: !seAcaboTiempo,
      revisadosEnEstaEjecucion: procesados,
      permisosOtorgados: otorgados,
      permisosRevocados: revocados,
      message: seAcaboTiempo
        ? 'Escaneo parcial: vuelve a ejecutar para continuar el mismo pase.'
        : 'Escaneo completo.'
    };

  } catch (e) {
    Logger.log('❌ escanearPermisosArchivos: ' + e.toString());
    return { success: false, message: 'Ocurrió un error durante el escaneo. Revisa el registro de ejecución.' };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Deja en la hoja sólo los pases más recientes. El registro es estado derivado
 * y crece un archivo por fila en cada pase: sin poda se vuelve inmanejable.
 * Se conserva el anterior para poder comparar cómo evoluciona el problema.
 */
function _purgarPasesAntiguos(hoja, paseNuevo, anchoColumnas) {
  // El ancho se pasa desde fuera porque esta función la comparten dos registros
  // de distinto largo (PERMISOS_ARCHIVOS 12 columnas, PERMISOS_ROLES 11). Si se
  // omite conserva el ancho histórico, así que los llamadores previos no cambian.
  var ancho = anchoColumnas || CABECERAS_PERMISOS_ARCHIVOS.length;

  var ultimaFila = hoja.getLastRow();
  if (ultimaFila < 2) return;

  var datos  = hoja.getRange(2, 1, ultimaFila - 1, ancho).getValues();
  var pases  = {};
  datos.forEach(function(f) { if (f[0]) pases[String(f[0])] = true; });

  var ordenados = Object.keys(pases).sort().reverse();
  var conservar = {};
  ordenados.slice(0, PASES_A_CONSERVAR - 1).forEach(function(p) { conservar[p] = true; });
  conservar[paseNuevo] = true;

  var sobrevivientes = datos.filter(function(f) { return conservar[String(f[0])]; });
  if (sobrevivientes.length === datos.length) return;

  hoja.getRange(2, 1, ultimaFila - 1, ancho).clearContent();
  if (sobrevivientes.length > 0) {
    hoja.getRange(2, 1, sobrevivientes.length, ancho).setValues(sobrevivientes);
  }
  Logger.log('🧹 Pases antiguos purgados: ' + (datos.length - sobrevivientes.length) + ' fila(s).');
}

/**
 * Informe agregado del último pase: cuántos archivos hay en cada estado, por
 * módulo, y cuántos socios distintos están afectados.
 * ADMIN-only. No toca Drive: sólo lee la hoja del registro.
 */
function informePermisosArchivos(rutSolicitante) {
  _ensureConfig();

  var verificacion = verificarRolUsuario(rutSolicitante, ['ADMIN']);
  if (!verificacion.autorizado) {
    Logger.log('⚠️ informePermisosArchivos: intento no autorizado — RUT=' + rutSolicitante);
    return { success: false, message: 'No autorizado.' };
  }

  try {
    var hoja = getSpreadsheet('USUARIOS').getSheetByName(HOJA_PERMISOS_ARCHIVOS);
    if (!hoja || hoja.getLastRow() < 2) {
      return { success: false, message: 'Todavía no hay ningún escaneo registrado. Ejecuta escanearPermisosArchivos() primero.' };
    }

    var datos = hoja.getRange(2, 1, hoja.getLastRow() - 1, CABECERAS_PERMISOS_ARCHIVOS.length).getValues();

    var pases = {};
    datos.forEach(function(f) { if (f[0]) pases[String(f[0])] = true; });
    var ultimoPase = Object.keys(pases).sort().reverse()[0];

    var porModulo = {};
    var totales   = {};
    var sociosAfectados = {};
    var total = 0;

    datos.forEach(function(f) {
      if (String(f[0]) !== ultimoPase) return;
      var modulo = String(f[4] || 'SIN_MODULO');
      var estado = String(f[10] || 'SIN_ESTADO');

      if (!porModulo[modulo]) porModulo[modulo] = {};
      porModulo[modulo][estado] = (porModulo[modulo][estado] || 0) + 1;
      totales[estado] = (totales[estado] || 0) + 1;
      total++;

      if (estado === 'DESACTUALIZADO' || estado === 'SIN_ACCESO') {
        sociosAfectados[String(f[2] || '')] = true;
      }
    });

    var cursorPendiente = PropertiesService.getScriptProperties().getProperty(CLAVE_CURSOR_PERMISOS);

    return {
      success: true,
      pase: ultimoPase,
      // Si hay cursor, el último pase quedó a medias: los números son un piso,
      // no el total. Decirlo evita leer un informe incompleto como si fuera final.
      paseCompleto: !cursorPendiente,
      totalArchivos: total,
      totalesPorEstado: totales,
      porModulo: porModulo,
      sociosAfectados: Object.keys(sociosAfectados).length
    };

  } catch (e) {
    Logger.log('❌ informePermisosArchivos: ' + e.toString());
    return { success: false, message: 'Ocurrió un error al generar el informe.' };
  }
}

/**
 * Recalcula el ESTADO de las filas del último pase SIN volver a abrir Drive.
 *
 * El primer pase clasificó con un conjunto institucional incompleto (le faltaba
 * el rol DIRIGENTE y los ex miembros inactivos — ver _correosInstitucionales),
 * así que muchas filas quedaron como DESACTUALIZADO cuando en realidad el único
 * acceso era de un dirigente. Como la hoja ya guarda en CORREO_CON_ACCESO qué
 * direcciones tenían acceso, todo esto se recalcula leyendo la hoja: segundos
 * en vez de las ~6 ejecuciones que cuesta un escaneo completo.
 *
 * Sólo puede tocar filas DESACTUALIZADO. Las OK, SOCIO_SIN_CORREO,
 * ARCHIVO_NO_ACCESIBLE y URL_INVALIDA no dependen del conjunto institucional.
 *
 * Estados resultantes:
 *   DESACTUALIZADO  queda al menos una dirección PROBADA del socio (aparece en
 *                   su historial de trámites): es revocable con evidencia.
 *   SIN_ACCESO      tras excluir a la organización no queda nadie personal.
 *   ACCESO_AJENO    queda alguien personal pero NINGUNA dirección probada del
 *                   socio. No se toca jamás de forma automática: puede ser un
 *                   ex dirigente fuera de CUENTAS_VALIDAS, o un tercero. Es
 *                   justamente lo que hay que mirar a mano.
 *
 * Corre en SIMULACIÓN salvo que aplicarCambios sea exactamente true.
 */
function reclasificarPermisosArchivos(rutSolicitante, aplicarCambios) {
  _ensureConfig();

  var verificacion = verificarRolUsuario(rutSolicitante, ['ADMIN']);
  if (!verificacion.autorizado) {
    Logger.log('⚠️ reclasificarPermisosArchivos: intento no autorizado — RUT=' + rutSolicitante);
    return { success: false, message: 'No autorizado.' };
  }

  try {
    var hoja = getSpreadsheet('USUARIOS').getSheetByName(HOJA_PERMISOS_ARCHIVOS);
    if (!hoja || hoja.getLastRow() < 2) {
      return { success: false, message: 'No hay ningún escaneo registrado.' };
    }

    var modo = (aplicarCambios === true) ? 'APLICANDO CAMBIOS' : 'SIMULACIÓN';
    Logger.log('═══ RECLASIFICACIÓN — ' + modo + ' ═══');

    var institucionales = _correosInstitucionales();
    var historicos      = _mapaCorreosHistoricosPorRut();
    var usuarios        = _mapaCorreosVigentes();

    var filas = hoja.getRange(2, 1, hoja.getLastRow() - 1, CABECERAS_PERMISOS_ARCHIVOS.length).getValues();

    var pases = {};
    filas.forEach(function(f) { if (f[0]) pases[String(f[0])] = true; });
    var ultimoPase = Object.keys(pases).sort().reverse()[0];

    var cambios = { OK: 0, SIN_ACCESO: 0, ACCESO_AJENO: 0, DESACTUALIZADO: 0 };
    var sociosRevocables = {};

    for (var i = 0; i < filas.length; i++) {
      if (String(filas[i][0]) !== ultimoPase) continue;
      if (String(filas[i][10]) !== 'DESACTUALIZADO') continue;

      var rut     = cleanRut(filas[i][2]);
      var vigente = (usuarios[rut] || {}).correo || '';
      var previos = historicos[rut] || {};
      var vigenteCanonico = _normalizarCorreoParaComparar(vigente);

      var personales = String(filas[i][9] || '')
        .split(',')
        .map(function(c) { return c.trim().toLowerCase(); })
        .filter(function(c) {
          var canonico = _normalizarCorreoParaComparar(c);
          return canonico && !institucionales[canonico];
        });

      // Caso que la comparación literal no veía: una de las direcciones con
      // acceso es la MISMA casilla del correo vigente, escrita con puntos
      // distintos (Gmail los ignora). El socio sí tiene acceso.
      var esLaMismaCasilla = personales.some(function(c) {
        return _normalizarCorreoParaComparar(c) === vigenteCanonico;
      });

      var probados = personales.filter(function(c) {
        var canonico = _normalizarCorreoParaComparar(c);
        return previos[canonico] && canonico !== vigenteCanonico;
      });

      var nuevoEstado, detalle;
      if (vigenteCanonico && esLaMismaCasilla) {
        nuevoEstado = 'OK';
        detalle = 'Reclasificado desde DESACTUALIZADO: la dirección con acceso es la misma casilla del correo vigente (Gmail ignora los puntos).';
      } else if (personales.length === 0) {
        nuevoEstado = 'SIN_ACCESO';
        detalle = 'Reclasificado desde DESACTUALIZADO: el acceso era sólo institucional (dirigentes u otros roles). El socio nunca tuvo acceso.';
      } else if (probados.length > 0) {
        nuevoEstado = 'DESACTUALIZADO';
        detalle = 'Correo anterior COMPROBADO del socio en su historial de trámites: ' + probados.join(', ') + '. Revocable con evidencia.';
        sociosRevocables[String(filas[i][2] || '')] = true;
      } else {
        nuevoEstado = 'ACCESO_AJENO';
        detalle = 'Tiene acceso ' + personales.join(', ') + ', que NO figura en el historial de trámites de este socio. Requiere revisión manual: no revocar automáticamente.';
      }

      // Se cuenta la distribución resultante, no el delta: así volver a
      // ejecutarla entrega exactamente los mismos números (es idempotente).
      cambios[nuevoEstado]++;

      filas[i][9]  = personales.join(', ');
      filas[i][10] = nuevoEstado;
      filas[i][11] = detalle;
    }

    if (aplicarCambios === true) {
      // Una sola escritura de las tres columnas recalculadas (J, K, L).
      var bloque = filas.map(function(f) { return [f[9], f[10], f[11]]; });
      hoja.getRange(2, 10, bloque.length, 3).setValues(bloque);
      Logger.log('✏️ Hoja actualizada.');
    }

    Logger.log('Pase reclasificado: ' + ultimoPase);
    Logger.log('— DESACTUALIZADO con correo comprobado del socio (revocables): ' + cambios.DESACTUALIZADO);
    Logger.log('— Pasan a OK (era la misma casilla, sólo cambiaban los puntos): ' + cambios.OK);
    Logger.log('— Pasan a SIN_ACCESO (el acceso era sólo institucional): ' + cambios.SIN_ACCESO);
    Logger.log('— Pasan a ACCESO_AJENO (revisión manual): ' + cambios.ACCESO_AJENO);
    Logger.log('— Socios con al menos un archivo revocable: ' + Object.keys(sociosRevocables).length);
    Logger.log('═══ FIN — ' + modo + ' ═══');

    return {
      success: true,
      aplicado: aplicarCambios === true,
      pase: ultimoPase,
      revocablesConEvidencia: cambios.DESACTUALIZADO,
      pasanAOk: cambios.OK,
      pasanASinAcceso: cambios.SIN_ACCESO,
      requierenRevisionManual: cambios.ACCESO_AJENO,
      sociosRevocables: Object.keys(sociosRevocables).length
    };

  } catch (e) {
    Logger.log('❌ reclasificarPermisosArchivos: ' + e.toString());
    return { success: false, message: 'Ocurrió un error durante la reclasificación.' };
  }
}

/**
 * Diagnóstico de las filas que la reclasificación mandaría a ACCESO_AJENO.
 *
 * Existe porque 219 de 246 cayeron ahí en la primera simulación, y ese número
 * es demasiado alto para ser rotación normal de correos de socios. La pregunta
 * que responde es una sola: ¿son muchas direcciones distintas (socios reales) o
 * unas pocas repitiéndose cientos de veces (gente de la organización)?
 *
 * Un caso sospechado: cuando un dirigente gestiona a nombre de un socio,
 * validarCorreosParaPermisos() otorga el permiso al correo del gestor tomado de
 * obtenerUsuarioPorRut() — es decir, de BD_SLIMAPP y no de CUENTAS_VALIDAS. Si
 * el correo personal de ese dirigente difiere del institucional, no queda
 * excluido y aparece como acceso ajeno.
 *
 * Sin parámetros y sólo escribe en el Logger, igual que los otros
 * _diagnosticar*: no devuelve datos personales a un llamador anónimo.
 */
function _diagnosticarAccesoAjeno() {
  _ensureConfig();

  var hoja = getSpreadsheet('USUARIOS').getSheetByName(HOJA_PERMISOS_ARCHIVOS);
  if (!hoja || hoja.getLastRow() < 2) { Logger.log('❌ No hay escaneo registrado.'); return; }

  var institucionales = _correosInstitucionales();
  var historicos      = _mapaCorreosHistoricosPorRut();
  var usuarios        = _mapaCorreosVigentes();

  var filas = hoja.getRange(2, 1, hoja.getLastRow() - 1, CABECERAS_PERMISOS_ARCHIVOS.length).getValues();
  var pases = {};
  filas.forEach(function(f) { if (f[0]) pases[String(f[0])] = true; });
  var ultimoPase = Object.keys(pases).sort().reverse()[0];

  var frecuencia = {};   // correo → cuántos archivos
  var modulos    = {};   // correo → módulos donde aparece
  var muestras   = [];
  var sinHistorial = 0, conHistorial = 0;

  for (var i = 0; i < filas.length; i++) {
    if (String(filas[i][0]) !== ultimoPase) continue;
    if (String(filas[i][10]) !== 'DESACTUALIZADO') continue;

    var rut     = cleanRut(filas[i][2]);
    var vigente = (usuarios[rut] || {}).correo || '';
    var previos = historicos[rut] || {};
    var vigenteCanonico = _normalizarCorreoParaComparar(vigente);

    var personales = String(filas[i][9] || '')
      .split(',')
      .map(function(c) { return c.trim().toLowerCase(); })
      .filter(function(c) {
        var canonico = _normalizarCorreoParaComparar(c);
        return canonico && !institucionales[canonico];
      });

    var esLaMismaCasilla = personales.some(function(c) {
      return _normalizarCorreoParaComparar(c) === vigenteCanonico;
    });
    var probados = personales.filter(function(c) {
      var canonico = _normalizarCorreoParaComparar(c);
      return previos[canonico] && canonico !== vigenteCanonico;
    });

    // Mismo criterio que reclasificarPermisosArchivos: si divergen, el
    // diagnóstico deja de explicar lo que la reclasificación realmente hace.
    if ((vigenteCanonico && esLaMismaCasilla) || personales.length === 0 || probados.length > 0) continue;

    if (Object.keys(previos).length === 0) sinHistorial++; else conHistorial++;

    personales.forEach(function(c) {
      frecuencia[c] = (frecuencia[c] || 0) + 1;
      if (!modulos[c]) modulos[c] = {};
      modulos[c][String(filas[i][4])] = true;
    });

    if (muestras.length < 8) {
      muestras.push({
        rut: String(filas[i][2]), modulo: String(filas[i][4]),
        vigente: vigente || '(sin correo)',
        acceso: personales.join(', '),
        historial: Object.keys(previos).join(', ') || '(ninguno)'
      });
    }
  }

  var ordenados = Object.keys(frecuencia).sort(function(a, b) { return frecuencia[b] - frecuencia[a]; });

  Logger.log('═══ DIAGNÓSTICO DE ACCESO_AJENO ═══');
  Logger.log('Direcciones distintas involucradas: ' + ordenados.length);
  Logger.log('Filas cuyo socio NO tiene ningún historial de correos: ' + sinHistorial);
  Logger.log('Filas cuyo socio SÍ tiene historial (pero no coincide): ' + conHistorial);
  Logger.log('— Top 15 direcciones por cantidad de archivos —');
  ordenados.slice(0, 15).forEach(function(c) {
    Logger.log('   ' + frecuencia[c] + ' archivo(s)  ' + c + '   [' + Object.keys(modulos[c]).join(', ') + ']');
  });
  Logger.log('— Muestra de casos —');
  muestras.forEach(function(m) {
    Logger.log('   ' + m.rut + ' (' + m.modulo + ')');
    Logger.log('      vigente:   ' + m.vigente);
    Logger.log('      con acceso: ' + m.acceso);
    Logger.log('      historial:  ' + m.historial);
  });
  Logger.log('═══ FIN ═══');
}

// ==========================================================
// CORRECCIÓN: certificados de pie diabético compartidos por enlace
// ==========================================================
// El escaneo dejó a la vista que en el módulo USUARIOS 18 de 20 archivos
// figuran SIN_ACCESO: nadie es lector. La causa está en el propio código —
// la subida del certificado de pie diabético usaba
// setSharing(ANYONE_WITH_LINK, VIEW) antes de migrarse a
// subirArchivoConPermisos(). Esos archivos quedaron abiertos a cualquiera que
// tenga la URL, y son documentos de salud.
//
// ANYONE_WITH_LINK aparece una sola vez en toda la historia del repositorio y
// es esta: ningún otro módulo estuvo expuesto. Los demás archivos suben por
// subirArchivoConPermisos(), que siempre deja el archivo PRIVATE.
//
// A diferencia del resto de este módulo, esta función SÍ escribe en Drive.
// ==========================================================

/**
 * Cierra el acceso por enlace de los certificados de pie diabético y deja al
 * socio como lector, replicando lo que hace hoy la subida en Modulo socios.js
 * (socio + ADMIN + DIRECTORIO, nunca DIRIGENTE ni REPLEGAL).
 *
 * Corre en SIMULACIÓN salvo que aplicarCambios sea exactamente true: sin eso
 * no toca ni un archivo y sólo informa qué haría. Idempotente: un archivo ya
 * privado se cuenta y se salta.
 *
 * ORDEN DE LAS OPERACIONES: primero otorga, después cierra el enlace. Al revés
 * habría un instante en que el archivo ya no es accesible por enlace y todavía
 * no lo es por permiso, y si el otorgamiento falla ahí, nadie —ni el DIRECTORIO—
 * conserva acceso.
 *
 * DECISIÓN DELIBERADA: si el socio no tiene un correo válido registrado, el
 * enlace se cierra IGUAL. La exposición de un documento de salud a cualquiera
 * que tenga la URL pesa más que la comodidad de ese socio, que recuperará el
 * acceso en cuanto registre un correo. Esos casos se informan aparte.
 *
 * @param {string} rutSolicitante RUT de un ADMIN (obligatorio).
 * @param {boolean} aplicarCambios true para escribir; cualquier otra cosa simula.
 */
function corregirAccesoEnlaceCertificadosPieDiabetico(rutSolicitante, aplicarCambios) {
  _ensureConfig();

  var verificacion = verificarRolUsuario(rutSolicitante, ['ADMIN']);
  if (!verificacion.autorizado) {
    Logger.log('⚠️ corregirAccesoEnlaceCertificadosPieDiabetico: intento no autorizado — RUT=' + rutSolicitante);
    return { success: false, message: 'No autorizado.' };
  }

  var COL = CONFIG.COLUMNAS.USUARIOS;
  if (COL.URL_CERT_PIE_DIABETICO === undefined) {
    Logger.log('⚠️ CONFIG sin URL_CERT_PIE_DIABETICO — no se puede ubicar la columna.');
    return { success: false, message: 'Falta configurar la columna URL_CERT_PIE_DIABETICO.' };
  }

  var modo = (aplicarCambios === true) ? 'APLICANDO CAMBIOS' : 'SIMULACIÓN';
  Logger.log('═══ CERTIFICADOS PIE DIABÉTICO — ' + modo + ' ═══');

  var sheet = getSheet('USUARIOS', 'USUARIOS');
  var datos = sheet.getDataRange().getDisplayValues();

  var corregidos = [], yaPrivados = [], sinCorreo = [], errores = [];

  for (var i = 1; i < datos.length; i++) {
    var url = String(datos[i][COL.URL_CERT_PIE_DIABETICO] || '').trim();
    if (!url || url.indexOf('drive.google.com') === -1) continue;

    var rut    = cleanRut(datos[i][COL.RUT]);
    var nombre = String(datos[i][COL.NOMBRE] || '');
    var correo = String(datos[i][COL.CORREO] || '').trim().toLowerCase();
    var etiqueta = formatRutDisplay(rut) + ' (' + nombre + ')';

    var fileId = extraerFileIdDeDriveUrl(url);
    if (!fileId) { errores.push(etiqueta + ': URL sin ID reconocible'); continue; }

    try {
      var file   = DriveApp.getFileById(fileId);
      var acceso = file.getSharingAccess();

      if (acceso !== DriveApp.Access.ANYONE && acceso !== DriveApp.Access.ANYONE_WITH_LINK) {
        yaPrivados.push(etiqueta);
        continue;
      }

      var tieneCorreo = esCorreoValido(correo);
      if (!tieneCorreo) sinCorreo.push(etiqueta);

      if (aplicarCambios === true) {
        // 1) Otorgar antes de cerrar.
        if (tieneCorreo) {
          otorgarPermisoSilencioso_(fileId, correo, 'reader');
        }
        // Los roles que gestionan vestuario, igual que en la subida actual.
        compartirArchivoConRol(fileId, 'ADMIN',      'leer');
        compartirArchivoConRol(fileId, 'DIRECTORIO', 'leer');

        // 2) Recién ahora se cierra el enlace. setSharing no toca los permisos
        //    explícitos por usuario, sólo el acceso general del archivo.
        file.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
      }

      corregidos.push(etiqueta + (tieneCorreo ? '' : ' [SIN CORREO: enlace cerrado, sin lector]'));

    } catch (e) {
      Logger.log('❌ ' + etiqueta + ' — ' + e.toString());
      errores.push(etiqueta + ': ' + e.toString());
    }
  }

  Logger.log('— Archivos abiertos por enlace ' + (aplicarCambios === true ? 'corregidos' : 'que se corregirían') + ': ' + corregidos.length);
  corregidos.forEach(function(c) { Logger.log('   • ' + c); });
  Logger.log('— Ya estaban privados: ' + yaPrivados.length);
  Logger.log('— Sin correo válido (quedan cerrados y sin lector): ' + sinCorreo.length);
  sinCorreo.forEach(function(c) { Logger.log('   • ' + c); });
  Logger.log('— Errores: ' + errores.length);
  errores.forEach(function(c) { Logger.log('   • ' + c); });
  Logger.log('═══ FIN — ' + modo + ' ═══');

  return {
    success: true,
    aplicado: aplicarCambios === true,
    corregidos: corregidos.length,
    yaPrivados: yaPrivados.length,
    sinCorreoValido: sinCorreo.length,
    errores: errores
  };
}

// ==========================================================
// AUTOMATIZACIÓN: el correo cambia → los permisos se actualizan solos
// ==========================================================
// Dos piezas. La señal la deja actualizarDatoUsuario() cuando el socio cambia
// su correo; el trabajo lo hace un activador poco después.
//
// Por qué NO se corrige en el mismo momento del cambio: actualizarDatoUsuario()
// corre dentro de un LockService y es una llamada interactiva. Recorrer las
// hojas y abrir los archivos de Drive ahí dejaría al socio esperando, con riesgo
// de topar los 6 minutos, y si falla a la mitad no habría reintento.
//
// ALCANCE, DELIBERADAMENTE ESTRECHO: esto sólo actualiza el acceso del SOCIO en
// archivos que YA EXISTEN. No cambia ninguna regla de los módulos: permisos
// médicos, apelaciones y el resto siguen otorgando al subir exactamente como
// siempre. Los permisos de la organización y de REPLEGAL no se tocan nunca —
// ver la doble protección en _reconciliarArchivo().
// ==========================================================

/** Clave donde se acumulan los RUT cuyo correo cambió y falta reconciliar. */
var CLAVE_RUTS_PENDIENTES_PERMISOS = 'PERMISOS_RUTS_PENDIENTES';

/**
 * Anota un RUT como pendiente de reconciliación de permisos.
 *
 * La invoca actualizarDatoUsuario() cuando el campo modificado es el correo.
 * Nunca lanza: un fallo acá no puede impedir que el socio guarde su correo — el
 * barrido semanal terminaría corrigiéndolo igual, sólo que más tarde.
 */
function marcarRutParaReconciliacionPermisos(rutLimpio) {
  try {
    if (!rutLimpio) return;
    var props = PropertiesService.getScriptProperties();
    var lista = [];
    try { lista = JSON.parse(props.getProperty(CLAVE_RUTS_PENDIENTES_PERMISOS) || '[]'); } catch (e) { lista = []; }
    if (Object.prototype.toString.call(lista) !== '[object Array]') lista = [];

    if (lista.indexOf(rutLimpio) === -1) {
      lista.push(rutLimpio);
      props.setProperty(CLAVE_RUTS_PENDIENTES_PERMISOS, JSON.stringify(lista));
      Logger.log('📌 ' + rutLimpio + ' queda pendiente de reconciliación de permisos.');
    }
  } catch (e) {
    Logger.log('⚠️ marcarRutParaReconciliacionPermisos: ' + e);
  }
}

/**
 * Reconcilia los archivos de un socio puntual. Rápido: son unos pocos archivos,
 * no los 3.143 del barrido completo.
 *
 * @param {Object} datosModulos Hojas ya leídas, para no releerlas por cada RUT.
 */
function _reconciliarArchivosDeSocio(rutLimpio, datosModulos, institucionales, usuarios, historicos) {
  var socio = usuarios[rutLimpio] || { nombre: '', correo: '' };
  var res = { archivos: 0, otorgados: 0, revocados: 0, errores: [] };

  for (var m = 0; m < CATALOGO_ARCHIVOS_MODULOS.length; m++) {
    var def = CATALOGO_ARCHIVOS_MODULOS[m];
    var paquete = datosModulos[def.clave];
    if (!paquete) continue;

    var COL = paquete.COL;
    var datos = paquete.datos;

    for (var i = 1; i < datos.length; i++) {
      if (cleanRut(datos[i][COL[def.colRut]]) !== rutLimpio) continue;

      var correoDirig = (def.colDirigente && COL[def.colDirigente] !== undefined)
        ? String(datos[i][COL[def.colDirigente]] || '').trim().toLowerCase() : '';

      for (var u = 0; u < paquete.colsUrl.length; u++) {
        var celda = String(datos[i][COL[paquete.colsUrl[u]]] || '').trim();
        if (!celda || celda.indexOf('drive.google.com') === -1) continue;

        var urls = def.variasUrlPorCelda ? celda.split(/[,\s]+/) : [celda];
        for (var v = 0; v < urls.length; v++) {
          var fileId = extraerFileIdDeDriveUrl(String(urls[v] || '').trim());
          if (!fileId) continue;

          var accesos = _accesosActualesDeArchivo(fileId);
          if (!accesos) continue;

          res.archivos++;
          var accion = _reconciliarArchivo(fileId, socio.correo, accesos,
                                           institucionales, historicos[rutLimpio] || {}, correoDirig);
          if (accion.otorgado) res.otorgados++;
          res.revocados += accion.revocados.length;
          if (accion.errores.length) res.errores = res.errores.concat(accion.errores);
        }
      }
    }
  }

  return res;
}

/**
 * ACTIVADOR (cada 30 minutos). Procesa los RUT anotados por
 * marcarRutParaReconciliacionPermisos() y, si queda tiempo, continúa el barrido
 * completo que haya dejado un cursor pendiente.
 *
 * _ensureConfig() va primero y fuera del try: leer CONFIG antes reventaría con
 * un TypeError que el catch se tragaría, y la ejecución se vería "exitosa"
 * mientras no hace nada. Ya pasó dos veces en este proyecto.
 */
function reconciliarPermisosPendientes(e) {
  if (activadorFueraDeProduccion_(e, 'reconciliarPermisosPendientes')) return;
  _ensureConfig();

  var inicio = new Date().getTime();
  var props  = PropertiesService.getScriptProperties();
  var lock   = LockService.getScriptLock();

  if (!lock.tryLock(10000)) {
    Logger.log('⏭️ reconciliarPermisosPendientes: hay otra ejecución en curso, se omite.');
    return;
  }

  var pendientes = [];
  try {
    try { pendientes = JSON.parse(props.getProperty(CLAVE_RUTS_PENDIENTES_PERMISOS) || '[]'); } catch (e) { pendientes = []; }
    if (Object.prototype.toString.call(pendientes) !== '[object Array]') pendientes = [];
    // Se vacía de inmediato: si un socio vuelve a cambiar su correo mientras
    // esto corre, su RUT se anota de nuevo y se procesa en la próxima vuelta.
    if (pendientes.length > 0) props.deleteProperty(CLAVE_RUTS_PENDIENTES_PERMISOS);
  } finally {
    lock.releaseLock();
  }

  if (pendientes.length > 0) {
    Logger.log('🔄 Reconciliando ' + pendientes.length + ' socio(s) con correo actualizado.');

    var institucionales = _correosInstitucionales();
    var usuarios        = _mapaCorreosVigentes();
    var historicos      = _mapaCorreosHistoricosPorRut();

    // Las hojas se leen UNA vez para todos los RUT de esta tanda.
    var datosModulos = {};
    CATALOGO_ARCHIVOS_MODULOS.forEach(function(def) {
      try {
        var sheet = _abrirHojaDelCatalogo(def);
        if (!sheet) return;
        var COL = (CONFIG.COLUMNAS || {})[def.columnas];
        if (!COL || COL[def.colRut] === undefined) return;
        var colsUrl = def.colsUrl.filter(function(n) { return COL[n] !== undefined; });
        if (colsUrl.length === 0) return;
        datosModulos[def.clave] = { COL: COL, colsUrl: colsUrl, datos: sheet.getDataRange().getDisplayValues() };
      } catch (e) {
        Logger.log('⚠️ ' + def.clave + ' omitido: ' + e);
      }
    });

    var sinProcesar = [];
    for (var p = 0; p < pendientes.length; p++) {
      if (new Date().getTime() - inicio > LIMITE_MS_ESCANEO_PERMISOS) {
        sinProcesar = pendientes.slice(p);
        break;
      }
      var r = _reconciliarArchivosDeSocio(pendientes[p], datosModulos, institucionales, usuarios, historicos);
      Logger.log('   ' + formatRutDisplay(pendientes[p]) + ': ' + r.archivos + ' archivo(s), ' +
                 r.otorgados + ' otorgado(s), ' + r.revocados + ' revocado(s)' +
                 (r.errores.length ? ' — ERRORES: ' + r.errores.join('; ') : ''));
    }

    // Lo que no alcanzó vuelve a la cola, sin pisar lo que llegó entretanto.
    if (sinProcesar.length > 0) {
      var lock2 = LockService.getScriptLock();
      if (lock2.tryLock(10000)) {
        try {
          var actuales = [];
          try { actuales = JSON.parse(props.getProperty(CLAVE_RUTS_PENDIENTES_PERMISOS) || '[]'); } catch (e2) { actuales = []; }
          sinProcesar.forEach(function(r) { if (actuales.indexOf(r) === -1) actuales.push(r); });
          props.setProperty(CLAVE_RUTS_PENDIENTES_PERMISOS, JSON.stringify(actuales));
          Logger.log('↩️ ' + sinProcesar.length + ' RUT devueltos a la cola por falta de tiempo.');
        } finally { lock2.releaseLock(); }
      }
      return;   // sin tiempo para el barrido
    }
  }

  // Con tiempo disponible, se continúa el barrido completo si quedó a medias.
  if (props.getProperty(CLAVE_CURSOR_PERMISOS) &&
      (new Date().getTime() - inicio) < (LIMITE_MS_ESCANEO_PERMISOS / 2)) {
    Logger.log('▶️ Continuando el barrido completo pendiente.');
    escanearPermisosArchivos('', true);
  }
}

/**
 * ACTIVADOR (semanal). Inicia el barrido completo de los 3.143 archivos, que
 * queda con cursor y lo termina reconciliarPermisosPendientes() en las horas
 * siguientes.
 *
 * Es la red de seguridad de la señal: atrapa lo que ésta no ve — un
 * otorgamiento que falló por un error transitorio, un archivo subido mientras
 * el socio no tenía correo, o un correo cambiado a mano en la hoja sin pasar
 * por la app.
 */
function barridoSemanalPermisos(e) {
  if (activadorFueraDeProduccion_(e, 'barridoSemanalPermisos')) return;
  _ensureConfig();
  Logger.log('🧹 Iniciando barrido semanal de permisos de archivos.');
  escanearPermisosArchivos('', true);
}

/**
 * Lista los socios cuyo correo registrado NO sirve para otorgar acceso.
 *
 * Son los casos que la reconciliación no puede resolver: Drive rechaza el
 * permiso con "Bad Request — se detectó un problema con el correo electrónico o
 * dominio", que es lo que responde cuando la dirección no corresponde a una
 * cuenta Google existente. Dos orígenes vistos en producción:
 *
 *   • Errores de tipeo del socio al registrarse (oscar…@gamil.com,
 *     direcciones que se ven bien pero cuya cuenta nunca existió).
 *   • Datos corruptos en la hoja: "s/socio.ejemplo@gmail.com", con el
 *     centinela S/D pegado al correo.
 *
 * No hay arreglo por código: hay que contactar a esas personas y corregir el
 * dato. Esta función existe para entregar esa lista lista para gestionar.
 *
 * ADMIN-only, sólo lectura de la hoja.
 */
function informeCorreosInutilizables(rutSolicitante) {
  _ensureConfig();

  var verificacion = verificarRolUsuario(rutSolicitante, ['ADMIN']);
  if (!verificacion.autorizado) {
    Logger.log('⚠️ informeCorreosInutilizables: intento no autorizado — RUT=' + rutSolicitante);
    return { success: false, message: 'No autorizado.' };
  }

  var hoja = getSpreadsheet('USUARIOS').getSheetByName(HOJA_PERMISOS_ARCHIVOS);
  if (!hoja || hoja.getLastRow() < 2) return { success: false, message: 'No hay escaneo registrado.' };

  var filas = hoja.getRange(2, 1, hoja.getLastRow() - 1, CABECERAS_PERMISOS_ARCHIVOS.length).getValues();
  var pases = {};
  filas.forEach(function(f) { if (f[0]) pases[String(f[0])] = true; });
  var ultimoPase = Object.keys(pases).sort().reverse()[0];

  var porSocio = {};

  for (var i = 0; i < filas.length; i++) {
    if (String(filas[i][0]) !== ultimoPase) continue;

    var estado = String(filas[i][10]);
    if (estado !== 'DESACTUALIZADO' && estado !== 'SIN_ACCESO') continue;

    // Si no tiene correo registrado el caso es otro (SOCIO_SIN_CORREO) y no
    // corresponde a esta lista: aquí van los que SÍ tienen uno que no funciona.
    var correo = String(filas[i][8] || '').trim();
    if (!correo) continue;

    var rut = String(filas[i][2] || '');
    if (!porSocio[rut]) {
      porSocio[rut] = {
        rut: rut, nombre: String(filas[i][3] || ''), correo: correo,
        archivos: 0, modulos: {}, fallaConfirmada: false
      };
    }
    porSocio[rut].archivos++;
    porSocio[rut].modulos[String(filas[i][4])] = true;
    // La reconciliación deja el mensaje de Drive en DETALLE cuando el
    // otorgamiento falló: distingue "no se pudo" de "no se intentó".
    if (String(filas[i][11] || '').indexOf('ERRORES') !== -1) porSocio[rut].fallaConfirmada = true;
  }

  var lista = Object.keys(porSocio).map(function(k) { return porSocio[k]; });
  lista.sort(function(a, b) { return b.archivos - a.archivos; });

  Logger.log('═══ SOCIOS CON CORREO INUTILIZABLE ═══');
  Logger.log('Pase: ' + ultimoPase);
  Logger.log('Socios: ' + lista.length);
  Logger.log('(RUT | correo registrado | archivos inaccesibles | módulos | rechazo confirmado por Drive)');
  lista.forEach(function(s) {
    Logger.log('   ' + s.rut + ' | ' + s.correo + ' | ' + s.archivos + ' | ' +
               Object.keys(s.modulos).join(', ') + ' | ' + (s.fallaConfirmada ? 'SÍ' : '—') +
               '   (' + s.nombre + ')');
  });
  Logger.log('═══ FIN ═══');

  return { success: true, pase: ultimoPase, socios: lista.length, detalle: lista };
}

// ==========================================================
// REVOCACIÓN DE ACCESO DE UNA PERSONA QUE YA NO CORRESPONDE
// ==========================================================

/**
 * Carpetas de SLIMAPP donde viven documentos de socios. La revocación se limita
 * a estas: fuera de aquí puede haber archivos personales que la cuenta compartió
 * por otros motivos, y no nos corresponde tocarlos.
 *
 * BACKUPS queda EXCLUIDA a propósito — los respaldos son ADMIN-only y nadie más
 * debería tener permisos ahí; si los tuviera, es otro problema y se resuelve
 * aparte, no de pasada en esta función.
 */
var CARPETAS_DOCUMENTOS_SOCIOS = [
  'JUSTIFICACIONES', 'APELACIONES_COMPROBANTES', 'APELACIONES_LIQUIDACIONES',
  'APELACIONES_DEVOLUCIONES', 'PERMISOS_MEDICOS', 'VESTUARIO_DOCS',
  'DENUNCIAS_JEFATURAS', 'PRESTAMOS_VACACIONES', 'ASISTENCIA_QR',
  'GESTIONES_EMPRESA', 'DOCS_FALLECIMIENTO'
];

/**
 * Quita todo acceso de un correo a los documentos de socios.
 *
 * Pensada para cuando alguien deja la organización: mientras estuvo activo,
 * compartirArchivoConRol() le fue otorgando lectura a cada archivo que se subía,
 * y esos permisos no se van solos al salir.
 *
 * NO se apoya en la hoja PERMISOS_ARCHIVOS. Ese registro sólo anotó los correos
 * con acceso en las filas problemáticas; en las filas OK guardó únicamente el
 * correo vigente del socio, así que subestima gravemente el alcance de un ex
 * dirigente. Se le pregunta a Drive directamente, carpeta por carpeta, con la
 * consulta '"correo" in readers' — así aparecen TODOS los archivos, estén o no
 * en el registro.
 *
 * Corre en SIMULACIÓN salvo que aplicarCambios sea exactamente true.
 *
 * @param {string} rutSolicitante RUT de un ADMIN.
 * @param {string} correoObjetivo Correo a revocar.
 * @param {boolean} aplicarCambios true para revocar de verdad.
 */
function revocarAccesoCorreo(rutSolicitante, correoObjetivo, aplicarCambios) {
  _ensureConfig();

  var verificacion = verificarRolUsuario(rutSolicitante, ['ADMIN']);
  if (!verificacion.autorizado) {
    Logger.log('⚠️ revocarAccesoCorreo: intento no autorizado — RUT=' + rutSolicitante);
    return { success: false, message: 'No autorizado.' };
  }

  var correo = String(correoObjetivo || '').trim().toLowerCase();
  if (!esCorreoValido(correo)) return { success: false, message: 'Correo inválido.' };

  // Salvaguarda: nunca revocar a alguien que sigue ACTIVO en CUENTAS_VALIDAS.
  // Un error de tipeo aquí le quitaría el acceso a un dirigente en ejercicio a
  // cientos de archivos, y volver a otorgarlo es mucho más caro que este chequeo.
  try {
    var sheetCV = getSheet('USUARIOS', 'CUENTAS_VALIDAS');
    var COLCV   = CONFIG.COLUMNAS.CUENTAS_VALIDAS;
    var datosCV = sheetCV.getDataRange().getValues();
    for (var c = 1; c < datosCV.length; c++) {
      var correoCV = String(datosCV[c][COLCV.CORREO] || '').trim().toLowerCase();
      var estadoCV = String(datosCV[c][COLCV.ESTADO] || '').trim().toUpperCase();
      if (correoCV === correo && estadoCV === 'ACTIVO') {
        Logger.log('⛔ ' + correo + ' figura ACTIVO en CUENTAS_VALIDAS. Revocación cancelada.');
        return {
          success: false,
          message: 'Ese correo figura ACTIVO en CUENTAS_VALIDAS. Márcalo como inactivo primero si la persona ya no corresponde.'
        };
      }
    }
  } catch (eCV) {
    Logger.log('❌ No se pudo verificar CUENTAS_VALIDAS: ' + eCV);
    return { success: false, message: 'No se pudo verificar CUENTAS_VALIDAS. Revocación cancelada por seguridad.' };
  }

  var modo = (aplicarCambios === true) ? 'APLICANDO CAMBIOS' : 'SIMULACIÓN';
  Logger.log('═══ REVOCACIÓN DE ' + correo + ' — ' + modo + ' ═══');

  var inicio = new Date().getTime();
  var encontrados = 0, revocados = 0, errores = 0, porCarpeta = {}, seAcaboTiempo = false;

  for (var f = 0; f < CARPETAS_DOCUMENTOS_SOCIOS.length && !seAcaboTiempo; f++) {
    var clave = CARPETAS_DOCUMENTOS_SOCIOS[f];
    var idCarpeta = (CONFIG.CARPETAS || {})[clave];
    if (!idCarpeta) { Logger.log('   (carpeta ' + clave + ' no configurada, se omite)'); continue; }

    var carpeta;
    try { carpeta = DriveApp.getFolderById(idCarpeta); }
    catch (eC) { Logger.log('⚠️ No se pudo abrir la carpeta ' + clave + ' — ' + eC); continue; }

    porCarpeta[clave] = 0;

    // Lectores y editores por separado: un permiso de escritura no aparece en
    // la consulta de lectores y quedaría intacto.
    ['readers', 'writers'].forEach(function(tipo) {
      var archivos = carpeta.searchFiles('"' + correo + '" in ' + tipo);
      while (archivos.hasNext()) {
        if (new Date().getTime() - inicio > LIMITE_MS_ESCANEO_PERMISOS) {
          seAcaboTiempo = true;
          Logger.log('⏱️ Presupuesto agotado en ' + clave + '. Vuelve a ejecutar para continuar.');
          break;
        }

        var archivo = archivos.next();
        encontrados++;
        porCarpeta[clave]++;

        if (aplicarCambios !== true) continue;

        try {
          var permisos = Drive.Permissions.list(archivo.getId());
          var items = (permisos && permisos.items) ? permisos.items : [];
          for (var p = 0; p < items.length; p++) {
            var valor = String(items[p].emailAddress || '').trim().toLowerCase();
            if (valor !== correo) continue;
            Drive.Permissions.remove(archivo.getId(), items[p].id);
            revocados++;
          }
        } catch (eRev) {
          errores++;
          Logger.log('❌ No se pudo revocar en "' + archivo.getName() + '" — ' + eRev);
        }
      }
    });
  }

  Logger.log('— Archivos donde ' + correo + ' tiene acceso: ' + encontrados);
  Object.keys(porCarpeta).forEach(function(k) {
    if (porCarpeta[k] > 0) Logger.log('   ' + k + ': ' + porCarpeta[k]);
  });
  if (aplicarCambios === true) {
    Logger.log('— Permisos revocados: ' + revocados);
    Logger.log('— Errores: ' + errores);
  } else {
    Logger.log('(Simulación: no se revocó nada.)');
  }
  Logger.log('═══ FIN — ' + modo + ' ═══');

  return {
    success: true,
    aplicado: aplicarCambios === true,
    completo: !seAcaboTiempo,
    correo: correo,
    archivosConAcceso: encontrados,
    permisosRevocados: revocados,
    errores: errores,
    porCarpeta: porCarpeta
  };
}

// ==========================================================
// ATAJOS PARA EJECUTAR DESDE EL EDITOR DE APPS SCRIPT
// ==========================================================
// El editor no permite pasar argumentos, así que estos wrappers leen el RUT
// ADMIN desde la propiedad RUT_MANTENCION.
//
// ⚠️ BORRA RUT_MANTENCION AL TERMINAR. Mientras exista, estas dos funciones
// sin argumentos son invocables vía google.script.run desde la consola del
// navegador en un webapp ANYONE_ANONYMOUS. Sin la propiedad quedan inertes.
// ==========================================================

function _escanearPermisosArchivosDesdeEditor() {
  return _correrEscaneoPermisos(false);
}

/**
 * Reconciliación: mismo recorrido que el escaneo, pero otorgando al socio su
 * correo vigente y revocando el anterior cuando hay evidencia. ESCRIBE en Drive.
 *
 * Igual que el escaneo, se corta a los 4 minutos y continúa el mismo pase en la
 * siguiente ejecución: hay que repetirla hasta que diga COMPLETO.
 */
function _reconciliarPermisosArchivosDesdeEditor() {
  return _correrEscaneoPermisos(true);
}

function _correrEscaneoPermisos(aplicarCorrecciones) {
  var rut = PropertiesService.getScriptProperties().getProperty('RUT_MANTENCION');
  if (!rut) {
    Logger.log('❌ Falta la propiedad RUT_MANTENCION en PropertiesService (RUT de un ADMIN).');
    return { success: false, message: 'Falta configurar RUT_MANTENCION.' };
  }
  var resultado = escanearPermisosArchivos(rut, aplicarCorrecciones);
  Logger.log(JSON.stringify(resultado, null, 2));
  return resultado;
}

/**
 * Revocación desde el editor. Además de RUT_MANTENCION exige la propiedad
 * CORREO_A_REVOCAR: obliga a escribir explícitamente a quién se le quita el
 * acceso, en vez de dejarlo fijo en el código.
 *
 * No lleva cursor: si se corta por tiempo, basta volver a ejecutarla. Es
 * idempotente — los archivos ya revocados dejan de aparecer en la búsqueda.
 */
function _informeCorreosInutilizablesDesdeEditor() {
  var rut = PropertiesService.getScriptProperties().getProperty('RUT_MANTENCION');
  if (!rut) {
    Logger.log('❌ Falta la propiedad RUT_MANTENCION en PropertiesService (RUT de un ADMIN).');
    return { success: false, message: 'Falta configurar RUT_MANTENCION.' };
  }
  var resultado = informeCorreosInutilizables(rut);
  Logger.log('Socios en la lista: ' + (resultado.socios || 0));
  return resultado;
}

function _simularRevocacionCorreo() {
  return _correrRevocacionCorreo(false);
}

function _aplicarRevocacionCorreo() {
  return _correrRevocacionCorreo(true);
}

function _correrRevocacionCorreo(aplicar) {
  var props = PropertiesService.getScriptProperties();
  var rut    = props.getProperty('RUT_MANTENCION');
  var correo = props.getProperty('CORREO_A_REVOCAR');

  if (!rut) {
    Logger.log('❌ Falta la propiedad RUT_MANTENCION en PropertiesService (RUT de un ADMIN).');
    return { success: false, message: 'Falta configurar RUT_MANTENCION.' };
  }
  if (!correo) {
    Logger.log('❌ Falta la propiedad CORREO_A_REVOCAR con el correo al que se le quitará el acceso.');
    return { success: false, message: 'Falta configurar CORREO_A_REVOCAR.' };
  }

  var resultado = revocarAccesoCorreo(rut, correo, aplicar);
  Logger.log(JSON.stringify(resultado, null, 2));
  return resultado;
}

function _simularReclasificacion() {
  return _correrReclasificacion(false);
}

function _aplicarReclasificacion() {
  return _correrReclasificacion(true);
}

function _correrReclasificacion(aplicar) {
  var rut = PropertiesService.getScriptProperties().getProperty('RUT_MANTENCION');
  if (!rut) {
    Logger.log('❌ Falta la propiedad RUT_MANTENCION en PropertiesService (RUT de un ADMIN).');
    return { success: false, message: 'Falta configurar RUT_MANTENCION.' };
  }
  var resultado = reclasificarPermisosArchivos(rut, aplicar);
  Logger.log(JSON.stringify(resultado, null, 2));
  return resultado;
}

function _simularCorreccionPieDiabetico() {
  return _correrCorreccionPieDiabetico(false);
}

function _aplicarCorreccionPieDiabetico() {
  return _correrCorreccionPieDiabetico(true);
}

function _correrCorreccionPieDiabetico(aplicar) {
  var rut = PropertiesService.getScriptProperties().getProperty('RUT_MANTENCION');
  if (!rut) {
    Logger.log('❌ Falta la propiedad RUT_MANTENCION en PropertiesService (RUT de un ADMIN).');
    return { success: false, message: 'Falta configurar RUT_MANTENCION.' };
  }
  var resultado = corregirAccesoEnlaceCertificadosPieDiabetico(rut, aplicar);
  Logger.log(JSON.stringify(resultado, null, 2));
  return resultado;
}

function _informePermisosArchivosDesdeEditor() {
  var rut = PropertiesService.getScriptProperties().getProperty('RUT_MANTENCION');
  if (!rut) {
    Logger.log('❌ Falta la propiedad RUT_MANTENCION en PropertiesService (RUT de un ADMIN).');
    return { success: false, message: 'Falta configurar RUT_MANTENCION.' };
  }

  var res = informePermisosArchivos(rut);
  if (!res.success) { Logger.log('❌ ' + res.message); return res; }

  Logger.log('═══ INFORME DE PERMISOS DE ARCHIVOS ═══');
  Logger.log('Pase: ' + res.pase + (res.paseCompleto ? ' (completo)' : ' ⚠️ INCOMPLETO — vuelve a ejecutar el escaneo'));
  Logger.log('Archivos revisados: ' + res.totalArchivos);
  Logger.log('Socios con algún archivo inaccesible para ellos: ' + res.sociosAfectados);
  Logger.log('— Totales por estado —');
  Object.keys(res.totalesPorEstado).sort().forEach(function(e) {
    Logger.log('   ' + e + ': ' + res.totalesPorEstado[e]);
  });
  Logger.log('— Detalle por módulo —');
  Object.keys(res.porModulo).sort().forEach(function(mod) {
    var partes = [];
    Object.keys(res.porModulo[mod]).sort().forEach(function(e) {
      partes.push(e + '=' + res.porModulo[mod][e]);
    });
    Logger.log('   ' + mod + ': ' + partes.join('  '));
  });
  Logger.log('═══ FIN DEL INFORME ═══');

  return res;
}

// ============================================================
// AUDITORÍA DEL REPARTO POR ROL
// ============================================================
//
// Por qué existe. Todo lo de más arriba vigila UNA sola cosa: que el socio
// pueda abrir su propio archivo. El acceso de los CARGOS (REPLEGAL, ADMIN,
// DIRIGENTE, DIRECTORIO) se otorga una única vez, al subir, dentro de
// compartirArchivoConRol(), y nunca más se vuelve a mirar:
//
//   1. Ningún llamador revisa lo que compartirArchivoConRol() devuelve. La
//      función atrapa el error de cada correo y lo deja en `errores`, pero los
//      seis módulos la invocan como si fuera void. Un insert que falla no deja
//      rastro fuera del Logger, no reintenta y no avisa a nadie.
//   2. La reconciliación (escanearPermisosArchivos) sólo toca el correo del
//      socio, por diseño declarado. Un permiso de rol que no se otorgó queda
//      roto para siempre.
//   3. El reparto es una foto del momento: quien entra a un cargo después no
//      ve nada de lo anterior.
//
// El síntoma es siempre el mismo y siempre llega por fuera del sistema: alguien
// de la empresa pide acceso a un archivo suelto desde Drive.
//
// Esto NO reemplaza el reparto en la subida: lo verifica después y, si se le
// pide, lo repara. Es el equivalente por rol de lo que
// FECHA_NOTIFICACION/DESTINATARIOS_NOTIFICACION hicieron por los correos.

/** Pestaña del informe, dentro del spreadsheet de USUARIOS (misma razón que HOJA_PERMISOS_ARCHIVOS). */
var HOJA_PERMISOS_ROLES = 'PERMISOS_ROLES';

var CABECERAS_PERMISOS_ROLES = [
  'PASE', 'FECHA_REVISION', 'MODULO', 'ID_REGISTRO', 'RUT', 'FILE_ID', 'URL',
  'ROLES_ESPERADOS', 'CORREOS_FALTANTES', 'ESTADO', 'DETALLE'
];

var CLAVE_CURSOR_PERMISOS_ROLES = 'PERMISOS_ROLES_CURSOR';

/**
 * Roles que cada módulo reparte al subir un archivo.
 *
 * Es el espejo de las llamadas a compartirArchivoConRol() que hay en cada
 * módulo — si cambia el reparto allá, cambia acá, o la auditoría empieza a
 * otorgar de más o a reportar faltantes que nadie quiso.
 *
 * USUARIOS es deliberadamente más angosto: el certificado de pie diabético y
 * el documento de Beneficio por Fallecimiento llevan datos de salud y de
 * familia, y su invariante es ADMIN + DIRECTORIO, nunca DIRIGENTE ni REPLEGAL.
 *
 * REPLEGAL NO APARECE EN NINGUNA ENTRADA, a propósito (01/09/2026). Sus tres
 * casillas no son cuentas Google y Drive rechaza todo permiso silencioso hacia
 * ellas, así que dejaron de repartirse por acá: reciben los documentos como
 * adjunto del correo de la gestión que los involucra. Esperarlos en esta tabla
 * haría que la auditoría reportara para siempre ~1.004 archivos incompletos que
 * ninguna corrida podría arreglar.
 */
var ROLES_ESPERADOS_POR_MODULO = {
  JUSTIFICACIONES:            ['ADMIN', 'DIRIGENTE', 'DIRECTORIO'],
  JUSTIFICACIONES_ELIMINADAS: ['ADMIN', 'DIRIGENTE', 'DIRECTORIO'],
  APELACIONES:                ['ADMIN', 'DIRIGENTE', 'DIRECTORIO'],
  APELACIONES_ELIMINADAS:     ['ADMIN', 'DIRIGENTE', 'DIRECTORIO'],
  PRESTAMOS:                  ['ADMIN', 'DIRIGENTE', 'DIRECTORIO'],
  PRESTAMOS_ELIMINADOS:       ['ADMIN', 'DIRIGENTE', 'DIRECTORIO'],
  PERMISOS_MEDICOS:           ['ADMIN', 'DIRIGENTE', 'DIRECTORIO'],
  DENUNCIAS_JEFATURAS:        ['ADMIN', 'DIRIGENTE', 'DIRECTORIO'],
  GESTIONES_EMPRESA:          ['ADMIN', 'DIRIGENTE', 'DIRECTORIO'],
  USUARIOS:                   ['ADMIN', 'DIRECTORIO']
};

/**
 * Lee CUENTAS_VALIDAS UNA vez y devuelve { ROL: [correos ACTIVOS] }.
 *
 * compartirArchivoConRol() relee la hoja entera en cada llamada; a cuatro roles
 * por archivo eso son cuatro lecturas por archivo y el presupuesto de 6 minutos
 * se va en leer siempre lo mismo. Acá se lee una vez por ejecución.
 *
 * REPLEGAL admite variantes numeradas por el mismo motivo defensivo que en
 * obtenerCorreosRepLegal(): la hoja se edita a mano.
 */
/**
 * Correo del propietario del archivo, o '' si no se puede determinar.
 *
 * Hace falta porque getViewers()/getEditors() NO incluyen al dueño: sin esto,
 * la cuenta institucional — el único ADMIN y propietario de todos los
 * archivos que sube la app — figura como "faltante" en TODOS ellos. El primer
 * pase dio 281 de 281 archivos con cargos faltantes por esta sola razón, y
 * aplicar la corrección habría intentado insertarle un permiso de LECTOR al
 * propietario en ~3.100 archivos.
 *
 * Va aparte y no dentro de _accesosActualesDeArchivo() a propósito: esa función
 * la comparten el escaneo y la reconciliación del correo del socio, que llevan
 * meses en producción, y cambiarle lo que devuelve alteraría clasificaciones y
 * revocaciones ya calibradas.
 */
function _correoPropietarioArchivo(fileId) {
  try {
    var duenio = DriveApp.getFileById(fileId).getOwner();
    return duenio ? String(duenio.getEmail() || '').toLowerCase() : '';
  } catch (e) {
    // En una unidad compartida no hay propietario individual: no es un error.
    return '';
  }
}

function _correosPorRolVigentes() {
  var mapa = {};
  try {
    var sheet = getSheet('USUARIOS', 'CUENTAS_VALIDAS');
    if (!sheet) return mapa;

    var COL  = CONFIG.COLUMNAS.CUENTAS_VALIDAS;
    var data = sheet.getDataRange().getValues();

    for (var i = 1; i < data.length; i++) {
      var correo = (data[i][COL.CORREO] || '').toString().trim();
      var rol    = (data[i][COL.ROL]    || '').toString().trim().toUpperCase();
      var estado = (data[i][COL.ESTADO] || '').toString().trim().toUpperCase();
      if (estado !== 'ACTIVO' || !esCorreoValido(correo)) continue;

      var clave = /^REPLEGAL\d*$/.test(rol) ? 'REPLEGAL' : rol;
      if (!mapa[clave]) mapa[clave] = [];
      if (mapa[clave].indexOf(correo) === -1) mapa[clave].push(correo);
    }
  } catch (e) {
    Logger.log('❌ _correosPorRolVigentes: ' + e);
  }
  return mapa;
}

/**
 * Audita (y opcionalmente repara) el acceso de los CARGOS a cada archivo de
 * socio, recorriendo el mismo CATALOGO_ARCHIVOS_MODULOS que el escaneo.
 *
 * Simulación salvo que aplicarCorrecciones === true. Idempotente: sólo otorga
 * lo que falta, y NUNCA revoca — quitarle acceso a un cargo es una decisión
 * organizacional, no algo que deba deducir un barrido (ver la decisión de
 * 2026-08-25 sobre los ~208 archivos del ex dirigente).
 *
 * Presupuesto y cursor propios: no comparte estado con el escaneo del socio,
 * así que los dos pases pueden convivir sin pisarse.
 *
 * @param {string}  rutSolicitante ADMIN. Vacío = activador (mismo criterio que escanearPermisosArchivos).
 * @param {boolean} aplicarCorrecciones true para otorgar de verdad.
 */
function auditarPermisosRolesArchivos(rutSolicitante, aplicarCorrecciones) {
  _ensureConfig();

  if (rutSolicitante) {
    var verificacion = verificarRolUsuario(rutSolicitante, ['ADMIN']);
    if (!verificacion.autorizado) {
      Logger.log('⚠️ auditarPermisosRolesArchivos: intento no autorizado — RUT=' + rutSolicitante);
      return { success: false, message: 'No autorizado.' };
    }
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return { success: false, message: 'Ya hay una auditoría en curso.' };

  var inicio = new Date().getTime();

  try {
    var hoja  = _asegurarHojaGenerica(HOJA_PERMISOS_ROLES, CABECERAS_PERMISOS_ROLES);
    var props = PropertiesService.getScriptProperties();

    var cursor = null;
    try { cursor = JSON.parse(props.getProperty(CLAVE_CURSOR_PERMISOS_ROLES) || 'null'); } catch (e) { cursor = null; }

    var pase = cursor ? cursor.pase
                      : Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd_HH-mm');
    if (!cursor) _purgarPasesAntiguos(hoja, pase, CABECERAS_PERMISOS_ROLES.length);

    var correosPorRol = _correosPorRolVigentes();
    var fecha = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm');

    var filas = [], procesados = 0, conFaltantes = 0, otorgados = 0, errores = 0;
    var seAcaboTiempo = false;
    var moduloInicial = cursor ? cursor.modulo : 0;
    var filaInicial   = cursor ? cursor.fila   : 1;

    for (var m = moduloInicial; m < CATALOGO_ARCHIVOS_MODULOS.length && !seAcaboTiempo; m++) {
      var def = CATALOGO_ARCHIVOS_MODULOS[m];
      var rolesEsperados = ROLES_ESPERADOS_POR_MODULO[def.clave];
      if (!rolesEsperados) {
        Logger.log('⚠️ ' + def.clave + ': sin reparto de roles declarado, se omite.');
        continue;
      }

      // Correos que este módulo debería haber repartido, ya resueltos.
      var esperados = [];
      rolesEsperados.forEach(function(rol) {
        (correosPorRol[rol] || []).forEach(function(c) {
          if (esperados.indexOf(c) === -1) esperados.push(c);
        });
      });
      if (esperados.length === 0) {
        Logger.log('⚠️ ' + def.clave + ': ningún correo ACTIVO para ' + rolesEsperados.join('/') + '. Módulo omitido.');
        continue;
      }

      var sheet = _abrirHojaDelCatalogo(def);
      if (!sheet) continue;

      var COL = (CONFIG.COLUMNAS || {})[def.columnas];
      if (!COL) {
        Logger.log('⚠️ CONFIG.COLUMNAS.' + def.columnas + ' no existe — módulo omitido.');
        continue;
      }

      var colsUrl = def.colsUrl.filter(function(nombre) { return COL[nombre] !== undefined; });
      if (colsUrl.length === 0 || COL[def.colRut] === undefined) continue;

      var datos = sheet.getDataRange().getDisplayValues();
      var desde = (m === moduloInicial) ? filaInicial : 1;

      for (var i = desde; i < datos.length; i++) {
        if (new Date().getTime() - inicio > LIMITE_MS_ESCANEO_PERMISOS) {
          props.setProperty(CLAVE_CURSOR_PERMISOS_ROLES, JSON.stringify({ pase: pase, modulo: m, fila: i }));
          seAcaboTiempo = true;
          Logger.log('⏱️ Presupuesto agotado en ' + def.clave + ', fila ' + i + '. Vuelve a ejecutar para continuar el mismo pase.');
          break;
        }

        var row = datos[i];
        var rut = cleanRut(row[COL[def.colRut]]);
        if (!rut) continue;
        var idRegistro = (COL[def.colId] !== undefined) ? String(row[COL[def.colId]] || '') : '';

        for (var u = 0; u < colsUrl.length; u++) {
          var celda = String(row[COL[colsUrl[u]]] || '').trim();
          if (!celda || celda.indexOf('drive.google.com') === -1) continue;

          var urls = def.variasUrlPorCelda ? celda.split(/[,\s]+/) : [celda];

          for (var v = 0; v < urls.length; v++) {
            var url = String(urls[v] || '').trim();
            if (!url || url.indexOf('drive.google.com') === -1) continue;

            var fileId = extraerFileIdDeDriveUrl(url);
            if (!fileId) {
              filas.push([pase, fecha, def.clave, idRegistro, formatRutDisplay(rut), '', url,
                          rolesEsperados.join('+'), '', 'URL_INVALIDA',
                          'No se pudo extraer el ID del archivo desde la URL.']);
              continue;
            }

            var accesos = _accesosActualesDeArchivo(fileId);
            if (!accesos) {
              filas.push([pase, fecha, def.clave, idRegistro, formatRutDisplay(rut), fileId, url,
                          rolesEsperados.join('+'), '', 'ARCHIVO_NO_ACCESIBLE',
                          'No se pudo abrir el archivo en Drive.']);
              procesados++;
              continue;
            }

            // Comparación canónica (Gmail ignora puntos y +alias); se actúa con
            // la dirección literal de CUENTAS_VALIDAS, la única que Drive resuelve.
            var tienen = {};
            accesos.correos.forEach(function(c) {
              var k = _normalizarCorreoParaComparar(c);
              if (k) tienen[k] = true;
            });

            // El propietario tiene acceso total y no aparece en viewers/editors.
            var propietario = _normalizarCorreoParaComparar(_correoPropietarioArchivo(fileId));
            if (propietario) tienen[propietario] = true;

            var faltantes = esperados.filter(function(correo) {
              return !tienen[_normalizarCorreoParaComparar(correo)];
            });

            var estado  = 'OK';
            var detalle = accesos.enPapelera ? 'El archivo está en la papelera. ' : '';

            if (faltantes.length > 0) {
              conFaltantes++;
              estado  = 'FALTA_ROL';
              detalle += 'El reparto por cargo no llegó a ' + faltantes.length + ' cuenta(s).';

              if (aplicarCorrecciones === true) {
                var ok = [], mal = [], sinCuenta = [];
                faltantes.forEach(function(correo) {
                  try {
                    // Silencioso siempre: nunca addViewer() (no puede suprimir
                    // el aviso nativo de Drive). Ver el invariante en CLAUDE.md.
                    otorgarPermisoSilencioso_(fileId, correo, 'reader');
                    ok.push(correo);
                  } catch (eIns) {
                    // Un rechazo por no ser cuenta Google es permanente mientras
                    // se otorgue en silencio, y no debe contarse como un fallo a
                    // corregir: si no se separa, el informe reporta miles de
                    // errores que ninguna corrida va a poder resolver nunca.
                    if (esErrorSinCuentaGoogle(eIns)) sinCuenta.push(correo);
                    else mal.push(correo + ' (' + eIns + ')');
                  }
                });
                otorgados += ok.length;
                errores   += mal.length;
                if (ok.length)        detalle += ' Otorgado a: ' + ok.join(', ') + '.';
                if (mal.length)       detalle += ' NO se pudo otorgar a: ' + mal.join('; ') + '.';
                if (sinCuenta.length) detalle += ' SIN CUENTA GOOGLE (reciben el documento adjunto por correo): ' + sinCuenta.join(', ') + '.';

                if (mal.length === 0 && sinCuenta.length === 0)      estado = 'CORREGIDO';
                else if (mal.length === 0 && sinCuenta.length > 0)   estado = 'SIN_CUENTA_GOOGLE';
              }
            }

            filas.push([pase, fecha, def.clave, idRegistro, formatRutDisplay(rut), fileId, url,
                        rolesEsperados.join('+'), faltantes.join(', '), estado, detalle]);
            procesados++;
          }
        }
      }
    }

    if (filas.length > 0) {
      hoja.getRange(hoja.getLastRow() + 1, 1, filas.length, CABECERAS_PERMISOS_ROLES.length).setValues(filas);
    }
    if (!seAcaboTiempo) props.deleteProperty(CLAVE_CURSOR_PERMISOS_ROLES);

    Logger.log('✅ Auditoría de roles ' + (seAcaboTiempo ? 'PARCIAL' : 'COMPLETA') + ' — pase ' + pase);
    Logger.log('   Archivos revisados: ' + procesados + ' | con cargos faltantes: ' + conFaltantes);
    if (aplicarCorrecciones === true) {
      Logger.log('   Permisos otorgados: ' + otorgados + ' | fallidos: ' + errores);
    } else {
      Logger.log('   MODO SIMULACIÓN: no se otorgó ningún permiso.');
    }

    return {
      success: true,
      pase: pase,
      completo: !seAcaboTiempo,
      revisadosEnEstaEjecucion: procesados,
      archivosConCargosFaltantes: conFaltantes,
      permisosOtorgados: otorgados,
      permisosFallidos: errores,
      message: seAcaboTiempo
        ? 'Auditoría parcial: vuelve a ejecutar para continuar el mismo pase.'
        : 'Auditoría completa.'
    };

  } catch (e) {
    Logger.log('❌ auditarPermisosRolesArchivos: ' + e.toString());
    return { success: false, message: 'Ocurrió un error durante la auditoría. Revisa el registro de ejecución.' };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Crea o repara una pestaña de informe con las cabeceras dadas.
 * Genérico para no duplicar _asegurarHojaPermisosArchivos() por cada registro.
 */
function _asegurarHojaGenerica(nombreHoja, cabeceras) {
  var ss = getSpreadsheet('USUARIOS');
  var hoja = ss.getSheetByName(nombreHoja);

  if (!hoja) {
    hoja = ss.insertSheet(nombreHoja);
    hoja.getRange(1, 1, 1, cabeceras.length).setValues([cabeceras]).setFontWeight('bold');
    hoja.setFrozenRows(1);
    return hoja;
  }
  if (hoja.getLastRow() === 0) {
    hoja.getRange(1, 1, 1, cabeceras.length).setValues([cabeceras]).setFontWeight('bold');
    hoja.setFrozenRows(1);
  }
  return hoja;
}

/**
 * Comprueba UN archivo suelto: quién tiene acceso hoy y qué cargos faltan.
 *
 * Para el caso que llega por Drive ("fulano pide acceso a este archivo"): pega
 * la URL o el ID y responde si es un hueco de ese archivo o del reparto entero.
 * Sólo lee, nunca otorga.
 *
 * @param {string} urlOId URL de Drive o fileId.
 * @param {string} claveModulo Clave de ROLES_ESPERADOS_POR_MODULO (ej: 'PERMISOS_MEDICOS').
 */
function diagnosticarPermisosDeArchivo(urlOId, claveModulo) {
  _ensureConfig();

  // El botón "Ejecutar" del editor llama sin argumentos, y sin este guard
  // String(undefined) pasaba como fileId literal "undefined": la función se veía
  // correr bien y respondía "no se pudo abrir el archivo undefined", que parece
  // un problema de Drive y no lo que es. Para el editor está _diagnosticarArchivoDesdeEditor().
  var entrada = String(urlOId == null ? '' : urlOId).trim();
  if (!entrada || entrada === 'undefined') {
    Logger.log('❌ Esta función necesita argumentos y el editor de GAS no los pasa.');
    Logger.log('   Usa _diagnosticarArchivoDesdeEditor(), que los lee de una propiedad.');
    return;
  }

  var fileId = (entrada.indexOf('drive.google.com') !== -1)
             ? extraerFileIdDeDriveUrl(entrada) : entrada;
  if (!fileId) { Logger.log('❌ No se pudo determinar el fileId desde: ' + entrada); return; }

  var accesos = _accesosActualesDeArchivo(fileId);
  if (!accesos) { Logger.log('❌ No se pudo abrir el archivo ' + fileId + ' en Drive.'); return; }

  Logger.log('📄 Archivo: ' + fileId);
  Logger.log('   En papelera: ' + (accesos.enPapelera ? 'SÍ' : 'no'));
  Logger.log('   Con acceso hoy (' + accesos.correos.length + '): ' + (accesos.correos.join(', ') || '— nadie más que el dueño —'));

  var roles = ROLES_ESPERADOS_POR_MODULO[claveModulo];
  if (!roles) {
    Logger.log('ℹ️ Sin módulo indicado: se omite la comparación por cargo. Claves válidas: ' +
               Object.keys(ROLES_ESPERADOS_POR_MODULO).join(', '));
    return;
  }

  var correosPorRol = _correosPorRolVigentes();
  var tienen = {};
  accesos.correos.forEach(function(c) {
    var k = _normalizarCorreoParaComparar(c);
    if (k) tienen[k] = true;
  });

  var propietario = _correoPropietarioArchivo(fileId);
  if (propietario) {
    tienen[_normalizarCorreoParaComparar(propietario)] = true;
    Logger.log('   Propietario: ' + propietario + ' (acceso total; no figura en la lista de arriba)');
  }

  Logger.log('   Reparto esperado para ' + claveModulo + ': ' + roles.join(' + '));
  roles.forEach(function(rol) {
    (correosPorRol[rol] || []).forEach(function(correo) {
      var ok = tienen[_normalizarCorreoParaComparar(correo)];
      Logger.log('     ' + (ok ? '✅' : '❌ FALTA') + '  [' + rol + '] ' + correo);
    });
  });
}

// --- Atajos para el editor de GAS ---------------------------------------
// Leen el RUT ADMIN desde RUT_MANTENCION. BORRA esa propiedad al terminar:
// mientras exista, estos atajos sin argumentos son invocables por google.script.run
// en un webapp ANYONE_ANONYMOUS sin probar que quien llama es ADMIN.

/**
 * Diagnostica UN archivo desde el editor, que no puede pasar argumentos.
 *
 * Lee la propiedad ARCHIVO_DIAGNOSTICO con el formato "<url o fileId>|<MODULO>".
 * Sólo lee Drive y sólo escribe en el Logger — no otorga nada y no devuelve
 * datos al frontend, así que la propiedad no abre ninguna puerta. Aun así,
 * bórrala al terminar: deja menos superficie y menos confusión después.
 */
function _diagnosticarArchivoDesdeEditor() {
  var valor = PropertiesService.getScriptProperties().getProperty('ARCHIVO_DIAGNOSTICO');
  if (!valor) {
    Logger.log('❌ Falta la propiedad ARCHIVO_DIAGNOSTICO.');
    Logger.log('   Formato: <url o fileId>|<MODULO>');
    Logger.log('   Ejemplo: ID_DEL_ARCHIVO|PERMISOS_MEDICOS');
    Logger.log('   Módulos válidos: ' + Object.keys(ROLES_ESPERADOS_POR_MODULO).join(', '));
    return;
  }
  var partes = String(valor).split('|');
  diagnosticarPermisosDeArchivo(partes[0].trim(), (partes[1] || '').trim());
}

function _simularAuditoriaRoles() { _correrAuditoriaRoles(false); }
function _aplicarAuditoriaRoles() { _correrAuditoriaRoles(true); }

function _correrAuditoriaRoles(aplicar) {
  var rut = PropertiesService.getScriptProperties().getProperty('RUT_MANTENCION');
  if (!rut) { Logger.log('❌ Falta la propiedad RUT_MANTENCION con un RUT ADMIN.'); return; }
  var r = auditarPermisosRolesArchivos(rut, aplicar);
  Logger.log(JSON.stringify(r, null, 2));
}

// ============================================================
// REPARACIÓN AUTOMÁTICA DEL REPARTO POR ROL
// ============================================================
//
// La auditoría de más arriba responde "¿está bien?" cuando alguien pregunta.
// Esto es lo que hace que no haya que preguntar.
//
// Dos vías, igual que en la reconciliación del correo del socio:
//
//   SEÑAL   compartirArchivoConRol() encola el archivo cuando un otorgamiento
//           falla, y reconciliarPermisosRolesPendientes() lo reintenta dentro
//           de los 30 minutos siguientes. Cubre el fallo transitorio, que es
//           el caso que hoy se descubre porque la empresa pide acceso a mano.
//
//   BARRIDO barridoSemanalPermisosRoles() repasa todo. Es la red para lo que
//           la señal no puede ver: un cargo que entró después de que el
//           archivo se subiera, o un fallo tan viejo que su cola ya se perdió.
//
// Por qué no se corrige dentro de la subida: el socio está esperando la
// respuesta. Reintentar ahí lo haría esperar más, arriesga el techo de 6
// minutos, y si el reintento también falla no queda nada anotado — que es
// exactamente el problema que se está resolviendo.

/** Cola de archivos con reparto de cargo fallido: entradas "fileId|ROL". */
var CLAVE_ARCHIVOS_PENDIENTES_ROLES = 'PERMISOS_ROLES_PENDIENTES';

/**
 * Tope de la cola. Si se desborda no se pierde nada importante: el barrido
 * semanal repasa igual todos los archivos. Existe para que un incidente masivo
 * (Drive caído una hora) no deje una propiedad gigante que después no se pueda
 * ni leer — PropertiesService tiene un límite de 9 KB por valor.
 */
var MAX_COLA_ROLES_PENDIENTES = 300;

/**
 * Anota que a un archivo le faltó el reparto de un cargo.
 *
 * La llama compartirArchivoConRol() (Global.js) cuando algún insert falla.
 * NUNCA lanza: un fallo acá no puede tumbar la subida del socio, que ya
 * terminó bien en todo lo demás.
 */
function marcarArchivoParaReparacionRoles(fileId, rolAsignado) {
  try {
    if (!fileId || !rolAsignado) return;
    var entrada = String(fileId) + '|' + String(rolAsignado).trim().toUpperCase();

    var props = PropertiesService.getScriptProperties();
    var lista = [];
    try { lista = JSON.parse(props.getProperty(CLAVE_ARCHIVOS_PENDIENTES_ROLES) || '[]'); } catch (e) { lista = []; }
    if (Object.prototype.toString.call(lista) !== '[object Array]') lista = [];

    if (lista.indexOf(entrada) !== -1) return;

    if (lista.length >= MAX_COLA_ROLES_PENDIENTES) {
      Logger.log('⚠️ Cola de reparación de roles llena (' + lista.length + '). ' +
                 entrada + ' no se encoló; lo tomará el barrido semanal.');
      return;
    }

    lista.push(entrada);
    props.setProperty(CLAVE_ARCHIVOS_PENDIENTES_ROLES, JSON.stringify(lista));
    Logger.log('📌 Reparto de cargo pendiente de reintento: ' + entrada);
  } catch (e) {
    Logger.log('⚠️ marcarArchivoParaReparacionRoles: ' + e);
  }
}

/**
 * ACTIVADOR (cada 30 minutos). Reintenta los repartos de cargo que fallaron y,
 * si le sobra presupuesto, continúa el pase semanal que haya quedado con cursor.
 *
 * _ensureConfig() primero y FUERA del try: leer CONFIG antes reventaría con un
 * TypeError que el catch se tragaría, y la ejecución se vería "exitosa" sin
 * haber hecho nada. Ya pasó dos veces en este proyecto.
 */
function reconciliarPermisosRolesPendientes(e) {
  if (activadorFueraDeProduccion_(e, 'reconciliarPermisosRolesPendientes')) return;
  _ensureConfig();

  var inicio = new Date().getTime();
  var props  = PropertiesService.getScriptProperties();
  var lock   = LockService.getScriptLock();

  if (!lock.tryLock(10000)) {
    Logger.log('⏭️ reconciliarPermisosRolesPendientes: hay otra ejecución en curso, se omite.');
    return;
  }

  var pendientes = [];
  try {
    try { pendientes = JSON.parse(props.getProperty(CLAVE_ARCHIVOS_PENDIENTES_ROLES) || '[]'); } catch (e) { pendientes = []; }
    if (Object.prototype.toString.call(pendientes) !== '[object Array]') pendientes = [];
    // Se vacía de inmediato: si algo vuelve a fallar mientras esto corre, se
    // anota de nuevo y entra en la próxima vuelta.
    if (pendientes.length > 0) props.deleteProperty(CLAVE_ARCHIVOS_PENDIENTES_ROLES);
  } finally {
    lock.releaseLock();
  }

  if (pendientes.length > 0) {
    Logger.log('🔄 Reintentando el reparto de cargo en ' + pendientes.length + ' archivo(s).');

    var sinProcesar = [];
    for (var i = 0; i < pendientes.length; i++) {
      if (new Date().getTime() - inicio > LIMITE_MS_ESCANEO_PERMISOS) {
        sinProcesar = pendientes.slice(i);
        break;
      }

      var partes = String(pendientes[i]).split('|');
      var fileId = partes[0], rol = partes[1];
      if (!fileId || !rol) continue;

      // Se reintenta el rol completo, no el correo suelto: compartirArchivoConRol
      // es idempotente y vuelve a resolver quién está ACTIVO hoy, que es lo que
      // corresponde otorgar ahora — no lo que correspondía cuando falló.
      var res = compartirArchivoConRol(fileId, rol, 'leer');
      if (res.success && res.errores.length === 0) {
        Logger.log('   ✅ ' + rol + ' reparado en ' + fileId + ' (' + res.correos.length + ' cuenta(s)).');
      } else {
        // Vuelve a la cola una sola vez más por vuelta; si el correo es
        // inservible (no es cuenta Google) esto se repetirá hasta que el
        // barrido lo deje registrado en la hoja para revisión humana.
        sinProcesar.push(pendientes[i]);
        Logger.log('   ❌ ' + rol + ' sigue fallando en ' + fileId + ': ' + res.errores.join(', '));
      }
    }

    if (sinProcesar.length > 0) {
      var lock2 = LockService.getScriptLock();
      if (lock2.tryLock(10000)) {
        try {
          var actuales = [];
          try { actuales = JSON.parse(props.getProperty(CLAVE_ARCHIVOS_PENDIENTES_ROLES) || '[]'); } catch (e2) { actuales = []; }
          sinProcesar.forEach(function(x) {
            if (actuales.indexOf(x) === -1 && actuales.length < MAX_COLA_ROLES_PENDIENTES) actuales.push(x);
          });
          props.setProperty(CLAVE_ARCHIVOS_PENDIENTES_ROLES, JSON.stringify(actuales));
          Logger.log('↩️ ' + sinProcesar.length + ' entrada(s) devueltas a la cola.');
        } finally { lock2.releaseLock(); }
      }
      return;   // sin presupuesto para continuar el pase
    }
  }

  // Con tiempo disponible, se continúa el pase semanal si quedó a medias.
  if (props.getProperty(CLAVE_CURSOR_PERMISOS_ROLES) &&
      (new Date().getTime() - inicio) < (LIMITE_MS_ESCANEO_PERMISOS / 2)) {
    Logger.log('▶️ Continuando la auditoría de roles pendiente.');
    auditarPermisosRolesArchivos('', true);
  }
}

/**
 * ACTIVADOR (semanal). Arranca la auditoría completa CON corrección; queda con
 * cursor y la termina reconciliarPermisosRolesPendientes() en las horas
 * siguientes, igual que el barrido del correo del socio.
 *
 * Va en un día distinto al de barridoSemanalPermisos() a propósito: los dos
 * toman el mismo lock de script y recorren los mismos ~3.100 archivos en varios
 * pases. Solapados, cada uno haría que el otro se saltara vuelta tras vuelta.
 */
function barridoSemanalPermisosRoles(e) {
  if (activadorFueraDeProduccion_(e, 'barridoSemanalPermisosRoles')) return;
  _ensureConfig();
  Logger.log('🧹 Iniciando barrido semanal del reparto por cargo.');
  auditarPermisosRolesArchivos('', true);
}

/**
 * Informe agregado del último pase de la auditoría de roles.
 *
 * Sólo lee la hoja PERMISOS_ROLES: no toca Drive, así que corre en segundos
 * aunque el pase tenga miles de filas.
 *
 * El bloque que importa es el RANKING DE CUENTAS: cuántos archivos le faltan a
 * cada cuenta institucional. Un reparto que falla al azar reparte los faltantes
 * entre todos los cargos; uno que falla por el ORDEN de inserción los concentra
 * en las cuentas que se otorgan primero. Los totales por módulo no distinguen
 * esos dos casos y el ranking sí.
 *
 * ADMIN-only, y devuelve el agregado sin nombres ni RUT: son cuentas de cargo,
 * no datos personales de socios.
 */
function informePermisosRoles(rutSolicitante) {
  _ensureConfig();

  if (rutSolicitante) {
    var verificacion = verificarRolUsuario(rutSolicitante, ['ADMIN']);
    if (!verificacion.autorizado) {
      Logger.log('⚠️ informePermisosRoles: intento no autorizado — RUT=' + rutSolicitante);
      return { success: false, message: 'No autorizado.' };
    }
  }

  var ss   = getSpreadsheet('USUARIOS');
  var hoja = ss.getSheetByName(HOJA_PERMISOS_ROLES);
  if (!hoja || hoja.getLastRow() < 2) {
    Logger.log('ℹ️ No hay datos en ' + HOJA_PERMISOS_ROLES + '. Corre primero _simularAuditoriaRoles().');
    return { success: true, filas: 0, message: 'Sin datos.' };
  }

  var datos = hoja.getRange(2, 1, hoja.getLastRow() - 1, CABECERAS_PERMISOS_ROLES.length).getValues();

  // Columnas: 0 PASE, 2 MODULO, 8 CORREOS_FALTANTES, 9 ESTADO
  var pases = {};
  datos.forEach(function(f) { if (f[0]) pases[String(f[0])] = true; });
  var ultimoPase = Object.keys(pases).sort().reverse()[0];

  var filas = datos.filter(function(f) { return String(f[0]) === ultimoPase; });

  var porModulo = {}, porEstado = {}, porCuenta = {};
  var conFaltantes = 0;

  filas.forEach(function(f) {
    var modulo = String(f[2] || '(sin módulo)');
    var estado = String(f[9] || '(sin estado)');

    if (!porModulo[modulo]) porModulo[modulo] = { total: 0, conFaltantes: 0 };
    porModulo[modulo].total++;
    porEstado[estado] = (porEstado[estado] || 0) + 1;

    var faltantes = String(f[8] || '').trim();
    if (!faltantes) return;

    conFaltantes++;
    porModulo[modulo].conFaltantes++;
    faltantes.split(',').forEach(function(c) {
      var correo = c.trim().toLowerCase();
      if (correo) porCuenta[correo] = (porCuenta[correo] || 0) + 1;
    });
  });

  var pct = function(n, d) { return d ? Math.round((n / d) * 100) + '%' : '—'; };

  Logger.log('════════════════════════════════════════════');
  Logger.log('INFORME DEL REPARTO POR CARGO — pase ' + ultimoPase);
  Logger.log('════════════════════════════════════════════');
  Logger.log('Archivos en el pase: ' + filas.length);
  Logger.log('Con cargos faltantes: ' + conFaltantes + ' (' + pct(conFaltantes, filas.length) + ')');

  Logger.log('');
  Logger.log('--- POR ESTADO ---');
  Object.keys(porEstado).sort().forEach(function(e) {
    Logger.log('  ' + e + ': ' + porEstado[e]);
  });

  Logger.log('');
  Logger.log('--- POR MÓDULO ---');
  Object.keys(porModulo).sort().forEach(function(m) {
    var d = porModulo[m];
    Logger.log('  ' + m + ': ' + d.conFaltantes + ' de ' + d.total + ' con faltantes (' + pct(d.conFaltantes, d.total) + ')');
  });

  Logger.log('');
  Logger.log('--- RANKING DE CUENTAS (a cuántos archivos le falta cada una) ---');
  var ranking = Object.keys(porCuenta).sort(function(a, b) { return porCuenta[b] - porCuenta[a]; });
  if (ranking.length === 0) {
    Logger.log('  (ninguna: el reparto está completo)');
  } else {
    ranking.forEach(function(c) {
      Logger.log('  ' + porCuenta[c] + '  (' + pct(porCuenta[c], filas.length) + ')  ' + c);
    });
  }
  Logger.log('════════════════════════════════════════════');

  return {
    success: true,
    pase: ultimoPase,
    archivos: filas.length,
    conCargosFaltantes: conFaltantes,
    porEstado: porEstado,
    porModulo: porModulo,
    porCuenta: porCuenta
  };
}

/** Atajo de editor. Lee RUT_MANTENCION; bórrala al terminar. */
function _informePermisosRolesDesdeEditor() {
  var rut = PropertiesService.getScriptProperties().getProperty('RUT_MANTENCION');
  if (!rut) { Logger.log('❌ Falta la propiedad RUT_MANTENCION con un RUT ADMIN.'); return; }
  informePermisosRoles(rut);
  // Deliberadamente no devuelve nada: el detalle queda en el Logger, dentro del
  // proyecto. Mismo criterio que _verificarEvidenciaNotificacionPermisosDesdeEditor().
}

/**
 * Intenta otorgar los cargos faltantes en UN SOLO archivo y reporta el error
 * literal que devuelve Drive por cada cuenta.
 *
 * Existe para distinguir dos cosas que la auditoría no separa y que llevan a
 * decisiones opuestas:
 *
 *   • El permiso NUNCA SE OTORGÓ y se puede otorgar ahora  → lo repara el barrido.
 *   • El permiso NO SE PUEDE OTORGAR nunca — Drive rechaza la dirección porque
 *     no corresponde a una cuenta Google → no hay arreglo por código, hay que
 *     hablarlo con la empresa. Es el mismo límite duro ya documentado para los
 *     socios en informeCorreosInutilizables().
 *
 * Correr el barrido completo a ciegas gastaría miles de escrituras repitiendo
 * un insert que falla siempre, y dejaría el registro lleno de errores sin
 * explicar por qué. Un archivo basta para saberlo.
 *
 * SÍ ESCRIBE EN DRIVE, pero sólo sobre el archivo indicado y sólo otorgando
 * lectura a cuentas institucionales que ya deberían tenerla. Nunca revoca.
 */
function probarOtorgarCargosEnUnArchivo(urlOId, claveModulo) {
  _ensureConfig();

  var entrada = String(urlOId == null ? '' : urlOId).trim();
  if (!entrada || entrada === 'undefined') {
    Logger.log('❌ Esta función necesita argumentos. Usa _probarOtorgarCargosDesdeEditor().');
    return;
  }

  var fileId = (entrada.indexOf('drive.google.com') !== -1)
             ? extraerFileIdDeDriveUrl(entrada) : entrada;
  if (!fileId) { Logger.log('❌ No se pudo determinar el fileId desde: ' + entrada); return; }

  var roles = ROLES_ESPERADOS_POR_MODULO[claveModulo];
  if (!roles) {
    Logger.log('❌ Módulo desconocido: "' + claveModulo + '".');
    Logger.log('   Válidos: ' + Object.keys(ROLES_ESPERADOS_POR_MODULO).join(', '));
    return;
  }

  var accesos = _accesosActualesDeArchivo(fileId);
  if (!accesos) { Logger.log('❌ No se pudo abrir el archivo ' + fileId + ' en Drive.'); return; }

  var tienen = {};
  accesos.correos.forEach(function(c) {
    var k = _normalizarCorreoParaComparar(c);
    if (k) tienen[k] = true;
  });
  var propietario = _correoPropietarioArchivo(fileId);
  if (propietario) tienen[_normalizarCorreoParaComparar(propietario)] = true;

  var correosPorRol = _correosPorRolVigentes();

  Logger.log('🧪 PRUEBA DE OTORGAMIENTO — archivo ' + fileId + ' (' + claveModulo + ')');
  Logger.log('   Se intenta otorgar SÓLO lo que falta. No se revoca nada.');
  Logger.log('');

  var intentados = 0, exitosos = 0;
  var fallidos = [];

  roles.forEach(function(rol) {
    (correosPorRol[rol] || []).forEach(function(correo) {
      if (tienen[_normalizarCorreoParaComparar(correo)]) return;

      intentados++;
      try {
        otorgarPermisoSilencioso_(fileId, correo, 'reader');
        exitosos++;
        Logger.log('   ✅ OTORGADO   [' + rol + '] ' + correo);
      } catch (e) {
        fallidos.push({ rol: rol, correo: correo, error: String(e) });
        Logger.log('   ❌ RECHAZADO  [' + rol + '] ' + correo);
        Logger.log('        → ' + e);
      }
    });
  });

  Logger.log('');
  if (intentados === 0) {
    Logger.log('ℹ️ No faltaba ningún cargo en este archivo.');
    return;
  }

  Logger.log('Resultado: ' + exitosos + ' otorgado(s), ' + fallidos.length + ' rechazado(s) de ' + intentados + '.');

  if (fallidos.length > 0) {
    Logger.log('');
    Logger.log('⚠️ Las cuentas rechazadas NO se arreglan reintentando. Si el error habla');
    Logger.log('   de "Bad Request" o de un problema con el correo o el dominio, esa');
    Logger.log('   dirección no corresponde a una cuenta Google y Drive no le puede dar');
    Logger.log('   acceso por ninguna vía — tampoco compartiendo a mano.');
  }

  // Se relee para dejar constancia de cómo quedó, no de cómo se creía que quedaría.
  var despues = _accesosActualesDeArchivo(fileId);
  Logger.log('');
  Logger.log('Con acceso después (' + (despues ? despues.correos.length : 0) + '): ' +
             (despues ? despues.correos.join(', ') : '—'));
}

/** Atajo de editor. Lee ARCHIVO_DIAGNOSTICO con el formato "<url o fileId>|<MODULO>". */
function _probarOtorgarCargosDesdeEditor() {
  var valor = PropertiesService.getScriptProperties().getProperty('ARCHIVO_DIAGNOSTICO');
  if (!valor) {
    Logger.log('❌ Falta la propiedad ARCHIVO_DIAGNOSTICO.');
    Logger.log('   Formato: <url o fileId>|<MODULO>');
    return;
  }
  var partes = String(valor).split('|');
  probarOtorgarCargosEnUnArchivo(partes[0].trim(), (partes[1] || '').trim());
}
