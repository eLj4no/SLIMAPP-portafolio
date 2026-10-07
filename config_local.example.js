// ============================================================
// SETUP DE CONFIGURACIÓN — SOLO USO LOCAL
// ============================================================
// Ejecuta inicializarConfiguracion() UNA SOLA VEZ desde el
// editor de Google Apps Script (Ejecutar > inicializarConfiguracion).
// Después de ejecutarla, la configuración queda en PropertiesService
// y este archivo debe guardarse solo localmente.
//
// NUNCA commitearlo ni subirlo a repositorios.
//
// PLANTILLA PUBLICA: copia este archivo como config_local.js y reemplaza
// cada ID_DE_GOOGLE_DRIVE / correo de ejemplo por los valores reales.
// ============================================================

function inicializarConfiguracion() {
  var props = {
    // IDs de Spreadsheets
    'SS_USUARIOS':            'ID_DE_GOOGLE_DRIVE',
    'SS_JUSTIFICACIONES':     'ID_DE_GOOGLE_DRIVE',
    'SS_APELACIONES':         'ID_DE_GOOGLE_DRIVE',
    'SS_PRESTAMOS':           'ID_DE_GOOGLE_DRIVE',
    'SS_PERMISOS_MEDICOS':    'ID_DE_GOOGLE_DRIVE',
    'SS_CREDENCIALES':        'ID_DE_GOOGLE_DRIVE',
    'SS_ASISTENCIA':          'ID_DE_GOOGLE_DRIVE',
    'SS_ASISTENCIA_BRIGADA':  'ID_DE_GOOGLE_DRIVE',
    'SS_ASISTENCIA_VIRTUAL':  'ID_DE_GOOGLE_DRIVE',
    'SS_GAMIFICACION':        'ID_DE_GOOGLE_DRIVE',
    'SS_DENUNCIAS_JEFATURAS': 'ID_DE_GOOGLE_DRIVE',
    'SS_NOTICIAS':            'ID_DE_GOOGLE_DRIVE',
    'SS_FORO':                'ID_DE_GOOGLE_DRIVE',

    // URL del Web App
    'WEBAPP_URL': 'https://script.google.com/macros/s/ID_DEL_DEPLOYMENT/exec',

    // Nombres de hojas (tabs)
    'CONFIG_HOJAS': JSON.stringify({
      USUARIOS:               "BD_SLIMAPP",
      CUENTAS_VALIDAS:        "CUENTAS_VALIDAS",
      JUSTIFICACIONES:        "BD_JUSTIFICACIONES",
      CONFIG_JUSTIFICACIONES: "CONFIG_JUSTIFICACIONES",
      APELACIONES:            "BD_APELACIONES",
      PRESTAMOS:              "BD_PRESTAMOS",
      VALIDACION_PRESTAMOS:   "Validación-Prestamos",
      PERMISOS_MEDICOS:       "BD_Permisos medicos",
      CREDENCIALES:           "IMPRESION",
      HISTORIAL_CREDENCIALES: "HISTORIAL_CREDENCIALES",
      ASISTENCIA:             "BD_ASISTENCIA",
      ACTIVIDADES_SINDICALES: "ACTIVIDADES_SINDICALES",
      GAMIFICACION:           "BD_GAMIFICACION",
      BANCO_PREGUNTAS:        "BANCO_PREGUNTAS",
      DENUNCIAS_JEFATURAS:    "BD_DENUNCIAS_JEFATURAS",
      // Hoja 4 del mismo spreadsheet de USUARIOS (USUARIOS_SLIMAPP). Respaldo
      // de documentos de Fallecimiento reemplazados — ver _configurarDocFallecimiento().
      RESP_FALLECIMIENTO:     "Resp_Fallecimiento",
      // Planilla propia SS_NOTICIAS — ver _configurarNoticias().
      NOTICIAS:               "NOTICIAS",
      // Planilla propia SS_FORO — ver _configurarForo().
      FORO_CATEGORIAS:        "CATEGORIAS",
      FORO_TEMAS:             "TEMAS",
      FORO_RESPUESTAS:        "RESPUESTAS",
      FORO_REPORTES:          "REPORTES",
      FORO_REGLAS:            "REGLAS_ACEPTADAS"
    }),

    // IDs de carpetas en Google Drive
    'CONFIG_CARPETAS': JSON.stringify({
      JUSTIFICACIONES:           "ID_DE_GOOGLE_DRIVE",
      APELACIONES_COMPROBANTES:  "ID_DE_GOOGLE_DRIVE",
      APELACIONES_LIQUIDACIONES: "ID_DE_GOOGLE_DRIVE",
      APELACIONES_DEVOLUCIONES:  "ID_DE_GOOGLE_DRIVE",
      PERMISOS_MEDICOS:          "ID_DE_GOOGLE_DRIVE",
      VESTUARIO_DOCS:            "ID_DE_GOOGLE_DRIVE",
      DENUNCIAS_JEFATURAS:       "ID_DE_GOOGLE_DRIVE",
      PRESTAMOS_VACACIONES:      "ID_DE_GOOGLE_DRIVE",
      ASISTENCIA_QR:             "ID_DE_GOOGLE_DRIVE",
      DOCS_FALLECIMIENTO:        "ID_DE_GOOGLE_DRIVE"
    }),

    // Correos institucionales
    'CONFIG_CORREOS': JSON.stringify({}),

    // Índices de columna (base 0) por módulo
    // IMPORTANTE: Reflejar exactamente el orden real de cada hoja en Google Sheets.
    'CONFIG_COLUMNAS': JSON.stringify({
      USUARIOS: {
        RUT: 0, RUT_VALIDADO: 1, FECHA_INGRESO: 2, NOMBRE: 3, CARGO: 4,
        CORREO: 5, SITE: 6, REGION: 7, SEXO: 8, ESTADO: 9,
        DETALLE_DESVINCULACION: 10, ID_CREDENCIAL: 11, CORREO_REGISTRADO: 12,
        CONTACTO: 13, ROL: 14, LINK_REGISTRO: 15, QR_REGISTRO: 16,
        BANCO: 17, TIPO_CUENTA: 18, NUMERO_CUENTA: 19, ESTADO_NEG_COLECT: 20,
        TALLA_POLERA: 21, TALLA_POLAR: 22, TALLA_PANTALON: 23, TALLA_CALZADO: 24,
        CALZADO_ESPECIAL: 25, URL_CERT_PIE_DIABETICO: 26,
        // Jefatura directa declarada por el propio socio desde "Mis Datos".
        // Columnas AB y AC del Sheet (ver _configurarColumnasSupervisor()).
        SUPERVISOR: 27, CORREO_SUPERVISOR: 28,
        // Beneficio por Fallecimiento — designación de beneficiarios (cláusula
        // DÉCIMO NOVENO del contrato colectivo). Columnas AD, AE, AF y AG del
        // Sheet (ver _configurarDocFallecimiento()).
        DOC_FALLECIMIENTO_URL: 29, DOC_FALLECIMIENTO_ESTADO: 30, DOC_FALLECIMIENTO_FECHA: 31,
        // Columna AG — observación que el ADMIN escribe a mano en el Sheet al
        // revisar y rechazar un documento. No se llena desde la app.
        DOC_FALLECIMIENTO_OBSERVACION: 32
      },
      JUSTIFICACIONES: {
        ID: 0, FECHA: 1, RUT: 2, NOMBRE: 3, REGION: 4, MOTIVO: 5,
        ARGUMENTO: 6, RESPALDO: 7, ESTADO: 8, OBSERVACION: 9, NOTIFICACION: 10,
        ASAMBLEA: 11, GESTION: 12, DIRIGENTE: 13, CORREO_DIRIGENTE: 14
      },
      APELACIONES: {
        ID: 0, FECHA_SOLICITUD: 1, RUT: 2, NOMBRE: 3, CORREO: 4,
        MES_APELACION: 5, TIPO_MOTIVO: 6, DETALLE_MOTIVO: 7, URL_COMPROBANTE: 8,
        URL_LIQUIDACION: 9, ESTADO: 10, OBSERVACION: 11, NOTIFICADO: 12,
        GESTION: 13, NOMBRE_DIRIGENTE: 14, CORREO_DIRIGENTE: 15,
        URL_COMPROBANTE_DEVOLUCION: 16, PERMISO_DEVOLUCION: 17, LOG_PERMISOS: 18
      },
      PRESTAMOS: {
        ID: 0, FECHA: 1, RUT: 2, NOMBRE: 3, CORREO: 4, TIPO: 5,
        MONTO: 6, CUOTAS: 7, URL_COMPROBANTE_VACACIONES: 8, MEDIO_PAGO: 9, ESTADO: 10, FECHA_TERMINO: 11,
        GESTION: 12, NOMBRE_DIRIGENTE: 13, CORREO_DIRIGENTE: 14, INFORME: 15,
        OBSERVACION: 16,
        // Evidencia de consentimiento para uso de datos en denuncia ante la DT
        // (respaldo del protocolo comunicado a los socios — ver Modulo prestamos.js).
        // Columna R del Sheet: "Sí" si el socio autorizó.
        AUTORIZACION_DT: 17,
        // Columna S del Sheet: fecha/hora del consentimiento (Date del servidor).
        AUTORIZACION_DT_FECHA: 18
      },
      // Hoja "Registros-eliminados" del spreadsheet de PRÉSTAMOS. Replica el
      // esquema de BD_PRESTAMOS (la fila se copia tal cual) y agrega al final
      // las columnas propias de trazabilidad: cuándo se eliminó el registro y
      // quién lo eliminó (el titular o un dirigente actuando por él).
      // Columnas T, U, V y W del Sheet:
      PRESTAMOS_ELIMINADOS: {
        FECHA_ELIMINACION:     19,
        ELIMINADO_POR_RUT:     20,
        ELIMINADO_POR_NOMBRE:  21,
        ELIMINADO_POR_ROL:     22
      },
      PERMISOS_MEDICOS: {
        ID: 0, FECHA_SOLICITUD: 1, RUT: 2, NOMBRE: 3, CORREO: 4,
        TIPO_PERMISO: 5, FECHA_INICIO: 6, MOTIVO_DETALLE: 7, URL_DOCUMENTO: 8,
        ESTADO: 9, FECHA_SUBIDA: 10, NOTIFICADO_REP_LEGAL: 11, GESTION: 12,
        NOMBRE_DIRIGENTE: 13, CORREO_DIRIGENTE: 14, NOTIFICADO_SOCIO: 15,
        // Evidencia de notificación — ver _configurarEvidenciaNotificacionPermisos()
        FECHA_NOTIFICACION: 16, DESTINATARIOS_NOTIFICACION: 17
      },
      GAMIFICACION: {
        RUT: 0, NOMBRE: 1, XP_TOTAL: 2, GRADO: 3, LOGROS: 4,
        RACHA_ACTUAL: 5, RACHA_MAX: 6, ULTIMA_ACTIVIDAD: 7, QUIZ_ULTIMO_DIA: 8,
        QUIZZES_COMPLETADOS: 9, ESTADO: 10, QUIZZES_PERFECTOS: 11
      },
      BANCO_PREGUNTAS: {
        ID: 0, CATEGORIA: 1, NIVEL: 2, PREGUNTA: 3, OPCION_A: 4, OPCION_B: 5,
        OPCION_C: 6, OPCION_D: 7, RESPUESTA: 8, EXPLICACION: 9, XP: 10,
        ACTIVA: 11, FUENTE: 12
      },
      DENUNCIAS_JEFATURAS: {
        ID: 0, FECHA_REGISTRO: 1, RUT_DENUNCIANTE: 2, NOMBRE_DENUNCIANTE: 3,
        CORREO_DENUNCIANTE: 4, CELULAR_DENUNCIANTE: 5,
        CATEGORIA: 6, SUBCATEGORIA: 7, TIPO_CARGO: 8,
        NOMBRE_DENUNCIADO: 9, LUGAR_TRABAJO: 10, FECHA_EVENTO: 11, DESCRIPCION: 12,
        URL_ARCHIVO: 13, ESTADO: 14, ESTADO_SOCIO: 15, GESTION: 16,
        NOMBRE_DIRIGENTE: 17, CORREO_DIRIGENTE: 18
      },
      CUENTAS_VALIDAS: {
        CORREO: 0, RUT: 1, NOMBRE: 2, CONTACTO: 3, ROL: 4, ESTADO: 5, FECHA_REGISTRO: 6
      },
      NOTICIAS: {
        ACTIVA: 0, TIPO: 1, TITULO: 2, BAJADA: 3, DESDE: 4, HASTA: 5,
        ZONA: 6, BOTON: 7, ABRE: 8, ENLACE: 9, ORDEN: 10,
        PUBLICADO_POR: 11, ACTUALIZADO_POR: 12, FECHA_ACTUALIZACION: 13
      },
      // Foro — ver _configurarForo() (fuente de verdad de estas columnas).
      FORO_CATEGORIAS: _columnasForo_().FORO_CATEGORIAS,
      FORO_TEMAS:      _columnasForo_().FORO_TEMAS,
      FORO_RESPUESTAS: _columnasForo_().FORO_RESPUESTAS,
      FORO_REPORTES:   _columnasForo_().FORO_REPORTES,
      FORO_REGLAS:     _columnasForo_().FORO_REGLAS
    })
  };

  PropertiesService.getScriptProperties().setProperties(props);
  Logger.log('✅ Configuración completa almacenada en PropertiesService.');
}

/**
 * Configura SOLO las propiedades nuevas del módulo de Asistencia
 * (SS_ASISTENCIA_BRIGADA, SS_ASISTENCIA_VIRTUAL, y las claves
 * ASISTENCIA_QR / ACTIVIDADES_SINDICALES dentro de CONFIG_CARPETAS /
 * CONFIG_HOJAS respectivamente) SIN tocar ninguna propiedad ya existente.
 * Ejecutar UNA VEZ desde el editor GAS (Ejecutar > _configurarPropiedadesAsistencia).
 */
function _configurarPropiedadesAsistencia() {
  var props = PropertiesService.getScriptProperties();

  props.setProperty('SS_ASISTENCIA_BRIGADA', 'ID_DE_GOOGLE_DRIVE');
  props.setProperty('SS_ASISTENCIA_VIRTUAL', 'ID_DE_GOOGLE_DRIVE');

  var carpetas = JSON.parse(props.getProperty('CONFIG_CARPETAS') || '{}');
  carpetas.ASISTENCIA_QR = 'ID_DE_GOOGLE_DRIVE';
  props.setProperty('CONFIG_CARPETAS', JSON.stringify(carpetas));

  var hojas = JSON.parse(props.getProperty('CONFIG_HOJAS') || '{}');
  hojas.ACTIVIDADES_SINDICALES = 'ACTIVIDADES_SINDICALES';
  props.setProperty('CONFIG_HOJAS', JSON.stringify(hojas));

  Logger.log('✅ Propiedades de Asistencia configuradas:');
  Logger.log('  SS_ASISTENCIA_BRIGADA = ' + props.getProperty('SS_ASISTENCIA_BRIGADA'));
  Logger.log('  SS_ASISTENCIA_VIRTUAL = ' + props.getProperty('SS_ASISTENCIA_VIRTUAL'));
  Logger.log('  CONFIG_CARPETAS.ASISTENCIA_QR = ' + carpetas.ASISTENCIA_QR);
  Logger.log('  CONFIG_HOJAS.ACTIVIDADES_SINDICALES = ' + hojas.ACTIVIDADES_SINDICALES);
}

/**
 * Configura SOLO las propiedades nuevas del módulo Trámites y Solicitudes a
 * la Empresa (GESTIONES_EMPRESA_CORREOS_JSON, CONFIG_HOJAS.GESTIONES_EMPRESA
 * y CONFIG_COLUMNAS.GESTIONES_EMPRESA) SIN tocar ninguna propiedad existente.
 * La hoja vive en el mismo spreadsheet de DENUNCIAS_JEFATURAS — no requiere
 * SS_ nuevo. Ejecutar UNA VEZ desde el editor GAS.
 */
function _configurarPropiedadesGestionesEmpresa() {
  var props = PropertiesService.getScriptProperties();

  var hojas = JSON.parse(props.getProperty('CONFIG_HOJAS') || '{}');
  hojas.GESTIONES_EMPRESA = 'GESTIONES_EMPRESA';
  props.setProperty('CONFIG_HOJAS', JSON.stringify(hojas));

  var columnas = JSON.parse(props.getProperty('CONFIG_COLUMNAS') || '{}');
  columnas.GESTIONES_EMPRESA = {
    ID: 0, FECHA_REGISTRO: 1, RUT: 2, NOMBRE: 3, CORREO: 4, TIPO_GESTION: 5,
    ASUNTO: 6, CONTENIDO: 7, NOMBRES_ARCHIVOS: 8, URLS_RESPALDO: 9,
    DESTINATARIOS: 10, ESTADO: 11, GESTION: 12, NOMBRE_DIRIGENTE: 13
  };
  props.setProperty('CONFIG_COLUMNAS', JSON.stringify(columnas));

  // Carpeta de respaldo Drive: opcional, nace vacía (el módulo opera sin
  // respaldo si no se configura — ver Modulo gestionesEmpresa.js).
  var carpetas = JSON.parse(props.getProperty('CONFIG_CARPETAS') || '{}');
  if (!carpetas.GESTIONES_EMPRESA) carpetas.GESTIONES_EMPRESA = '';
  props.setProperty('CONFIG_CARPETAS', JSON.stringify(carpetas));

  // Mapeo gestión→correos destino. SOLO PRUEBAS por defecto: en producción
  // ejecutar _configurarCorreosGestionesEmpresaProduccion() para reemplazar
  // este mapeo por los correos oficiales de ISS.
  if (!props.getProperty('GESTIONES_EMPRESA_CORREOS_JSON')) {
    var correoPruebas = 'correo@ejemplo.com';
    props.setProperty('GESTIONES_EMPRESA_CORREOS_JSON', JSON.stringify({
      CONTRATOS:         [correoPruebas],
      VACACIONES:        [correoPruebas],
      CERTIFICADOS:      [correoPruebas],
      ASISTENCIA:        [correoPruebas],
      LICENCIAS_MEDICAS: [correoPruebas]
    }));
  }

  Logger.log('✅ Propiedades de Trámites y Solicitudes a la Empresa configuradas:');
  Logger.log('  CONFIG_HOJAS.GESTIONES_EMPRESA = ' + hojas.GESTIONES_EMPRESA);
  Logger.log('  CONFIG_CARPETAS.GESTIONES_EMPRESA = "' + carpetas.GESTIONES_EMPRESA + '" (vacío = sin respaldo Drive)');
  Logger.log('  GESTIONES_EMPRESA_CORREOS_JSON = ' + props.getProperty('GESTIONES_EMPRESA_CORREOS_JSON'));
}

/**
 * Configura SOLO las propiedades nuevas del beneficio por Fallecimiento
 * (CONFIG_COLUMNAS.USUARIOS.DOC_FALLECIMIENTO_* y CONFIG_CARPETAS.DOCS_FALLECIMIENTO)
 * SIN tocar ninguna propiedad ya existente — hace merge sobre lo que ya hay en
 * PropertiesService, nunca sobrescribe el objeto completo.
 * Ejecutar UNA VEZ por entorno desde el editor GAS (DEV y PROD por separado).
 */
function _configurarDocFallecimiento() {
  var props = PropertiesService.getScriptProperties();

  var columnas = JSON.parse(props.getProperty('CONFIG_COLUMNAS') || '{}');
  if (!columnas.USUARIOS) {
    Logger.log('❌ CONFIG_COLUMNAS.USUARIOS no existe. Ejecuta primero inicializarConfiguracion().');
    return;
  }
  columnas.USUARIOS.DOC_FALLECIMIENTO_URL         = 29;
  columnas.USUARIOS.DOC_FALLECIMIENTO_ESTADO      = 30;
  columnas.USUARIOS.DOC_FALLECIMIENTO_FECHA       = 31;
  columnas.USUARIOS.DOC_FALLECIMIENTO_OBSERVACION = 32;
  props.setProperty('CONFIG_COLUMNAS', JSON.stringify(columnas));

  // Carpeta Drive donde se suben los documentos de designación de
  // beneficiarios (respaldo digital — copia al sindicato, ver CLAUDE.md).
  var carpetas = JSON.parse(props.getProperty('CONFIG_CARPETAS') || '{}');
  carpetas.DOCS_FALLECIMIENTO = 'ID_DE_GOOGLE_DRIVE';
  props.setProperty('CONFIG_CARPETAS', JSON.stringify(carpetas));

  // Hoja 4 del spreadsheet de USUARIOS (USUARIOS_SLIMAPP) — respaldo de
  // documentos reemplazados (ver _respaldarDocFallecimientoReemplazado() en
  // Modulo socios.js). Se crea sola con encabezados en el primer reemplazo
  // si no existe todavía.
  var hojas = JSON.parse(props.getProperty('CONFIG_HOJAS') || '{}');
  hojas.RESP_FALLECIMIENTO = 'Resp_Fallecimiento';
  props.setProperty('CONFIG_HOJAS', JSON.stringify(hojas));

  Logger.log('✅ CONFIG del beneficio por Fallecimiento configurado:');
  Logger.log('  CONFIG_COLUMNAS.USUARIOS.DOC_FALLECIMIENTO_URL    = ' + columnas.USUARIOS.DOC_FALLECIMIENTO_URL);
  Logger.log('  CONFIG_COLUMNAS.USUARIOS.DOC_FALLECIMIENTO_ESTADO = ' + columnas.USUARIOS.DOC_FALLECIMIENTO_ESTADO);
  Logger.log('  CONFIG_COLUMNAS.USUARIOS.DOC_FALLECIMIENTO_FECHA  = ' + columnas.USUARIOS.DOC_FALLECIMIENTO_FECHA);
  Logger.log('  CONFIG_COLUMNAS.USUARIOS.DOC_FALLECIMIENTO_OBSERVACION = ' + columnas.USUARIOS.DOC_FALLECIMIENTO_OBSERVACION);
  Logger.log('  CONFIG_CARPETAS.DOCS_FALLECIMIENTO = ' + carpetas.DOCS_FALLECIMIENTO);
  Logger.log('  CONFIG_HOJAS.RESP_FALLECIMIENTO = ' + hojas.RESP_FALLECIMIENTO);
}

/**
 * Agrega las claves AUTORIZACION_DT (col. R) y AUTORIZACION_DT_FECHA (col. S) a
 * CONFIG_COLUMNAS.PRESTAMOS SIN tocar ninguna otra clave ni propiedad. Son las
 * columnas de evidencia del consentimiento del socio para que el sindicato use
 * los datos de su solicitud en una denuncia ante la Inspección del Trabajo.
 *
 * Ejecutar UNA VEZ desde el editor GAS de cada entorno, DESPUÉS de que las
 * columnas existan en la hoja BD_PRESTAMOS y ANTES de desplegar el cambio:
 * mientras estas claves falten, COL_PRES.AUTORIZACION_DT es undefined y la
 * evidencia no se escribiría (crearSolicitudPrestamo lo detecta y lo registra
 * en el log, pero la solicitud igual se guarda sin respaldo legal).
 *
 * Idempotente: correrla de nuevo solo reescribe los mismos dos índices.
 */
function _configurarPropiedadesPrestamosAutorizacionDT() {
  var props = PropertiesService.getScriptProperties();
  var columnas = JSON.parse(props.getProperty('CONFIG_COLUMNAS') || '{}');

  if (!columnas.PRESTAMOS) {
    Logger.log('❌ CONFIG_COLUMNAS.PRESTAMOS no existe. Ejecuta primero inicializarConfiguracion().');
    return;
  }

  columnas.PRESTAMOS.AUTORIZACION_DT       = 17;  // Columna R
  columnas.PRESTAMOS.AUTORIZACION_DT_FECHA = 18;  // Columna S
  props.setProperty('CONFIG_COLUMNAS', JSON.stringify(columnas));

  Logger.log('✅ CONFIG_COLUMNAS.PRESTAMOS actualizado:');
  Logger.log('   AUTORIZACION_DT = 17 (columna R)');
  Logger.log('   AUTORIZACION_DT_FECHA = 18 (columna S)');
  Logger.log('   Verifica que los encabezados de BD_PRESTAMOS en R1 y S1 coincidan.');
}

/**
 * Registra las dos columnas de EVIDENCIA DE NOTIFICACIÓN de permisos médicos:
 *
 *   Q (16) FECHA_NOTIFICACION         → reloj del servidor al momento del envío
 *   R (17) DESTINATARIOS_NOTIFICACION → "Para: ... | CC: ..." con las direcciones reales
 *
 * Las escribe _marcarPermisoNotificado() (Modulo permisosMedicos.js) cada vez
 * que un correo sale bien, y las lee verificarEvidenciaNotificacionPermisos()
 * para detectar filas que dicen "notificado" sin nada que lo respalde — la firma
 * de una fila cargada o editada a mano en la planilla.
 *
 * ⚠️ EJECUTAR UNA VEZ EN DEV Y OTRA EN PROD. PropertiesService es independiente
 * por proyecto aunque la hoja de cálculo sea la misma. Hasta que se ejecute,
 * los índices son undefined, la guarda `!== undefined` del módulo se activa y la
 * evidencia NO se guarda (queda el aviso en Logger, sin romper el envío).
 *
 * ⚠️ ANTES de ejecutarlo, crear a mano los encabezados en la hoja
 * "BD_Permisos medicos": Q1 = FECHA_NOTIFICACION, R1 = DESTINATARIOS_NOTIFICACION.
 * Como DEV y PROD comparten la planilla, ese paso se hace una sola vez en total.
 */
function _configurarEvidenciaNotificacionPermisos() {
  var props = PropertiesService.getScriptProperties();
  var columnas = JSON.parse(props.getProperty('CONFIG_COLUMNAS') || '{}');

  if (!columnas.PERMISOS_MEDICOS) {
    Logger.log('❌ CONFIG_COLUMNAS.PERMISOS_MEDICOS no existe. Ejecuta primero inicializarConfiguracion().');
    return;
  }

  columnas.PERMISOS_MEDICOS.FECHA_NOTIFICACION         = 16;  // Columna Q
  columnas.PERMISOS_MEDICOS.DESTINATARIOS_NOTIFICACION = 17;  // Columna R
  props.setProperty('CONFIG_COLUMNAS', JSON.stringify(columnas));

  Logger.log('✅ CONFIG_COLUMNAS.PERMISOS_MEDICOS actualizado:');
  Logger.log('   FECHA_NOTIFICACION = 16 (columna Q)');
  Logger.log('   DESTINATARIOS_NOTIFICACION = 17 (columna R)');
  Logger.log('   Verifica que los encabezados de "BD_Permisos medicos" en Q1 y R1 coincidan.');
  Logger.log('   Recuerda ejecutar esto también en el OTRO proyecto (DEV/PROD).');
}

/**
 * Deja lista la hoja "Registros-eliminados" del spreadsheet de PRÉSTAMOS:
 *
 *  1. Registra CONFIG_COLUMNAS.PRESTAMOS_ELIMINADOS en PropertiesService
 *     (columnas T a W), sin tocar ninguna otra clave.
 *  2. Alinea los encabezados con los de BD_PRESTAMOS y agrega al final las
 *     cuatro columnas de trazabilidad que escribe eliminarSolicitud():
 *     cuándo se eliminó y quién lo hizo (RUT, nombre y rol al momento).
 *
 * Esa hoja es anterior al helper global respaldarRegistroEliminado() (que copia
 * los encabezados al crear la hoja), así que quedó con la estructura vieja: le
 * faltaban "Comprobante_vacaciones" y "Observacion", y ahora también las dos
 * columnas de autorización DT. eliminarSolicitud() respalda la fila con
 * data[i].slice(), es decir con el esquema ACTUAL de BD_PRESTAMOS, por lo que
 * los encabezados viejos ya no describían lo que se estaba escribiendo.
 *
 * ⚠️ Efecto sobre el histórico: las filas respaldadas ANTES de que existiera la
 * columna "Comprobante_vacaciones" tienen un valor menos desde esa posición en
 * adelante y quedarán corridas respecto de los encabezados nuevos. No se tocan
 * los datos: preferimos que la cabecera describa lo que el sistema escribe hoy
 * y de aquí en adelante, y dejar el desfase acotado a las filas antiguas.
 * Esas filas tampoco tienen trazabilidad: se eliminaron antes de que las
 * columnas existieran y no hay forma de reconstruir la fecha ni el autor.
 *
 * Idempotente: correrla de nuevo reescribe lo mismo.
 * Las hojas "Registros-eliminados" de justificaciones y apelaciones nacen
 * alineadas (las crea respaldarRegistroEliminado) y no llevan marca temporal:
 * si se quiere ahí también, hay que agregarla en ese helper global.
 */
function _configurarRegistrosEliminadosPrestamos() {
  _ensureConfig();

  var NOMBRE_HOJA = HOJA_REGISTROS_ELIMINADOS;

  // Columnas propias de la hoja de respaldo, en orden, a partir de la última
  // de BD_PRESTAMOS. El índice se calcula desde IDX_PRIMERA para que agregar
  // una quinta columna a futuro no obligue a renumerar a mano.
  var IDX_PRIMERA = 19;  // Columna T (0-based)
  var COLUMNAS_PROPIAS = [
    'FECHA_ELIMINACION',     // T — cuándo se eliminó (hora del servidor)
    'ELIMINADO_POR_RUT',     // U — quién lo eliminó
    'ELIMINADO_POR_NOMBRE',  // V
    'ELIMINADO_POR_ROL'      // W — rol al momento de eliminar
  ];

  var ss = getSpreadsheet('PRESTAMOS');
  var sheetOrigen = getSheet('PRESTAMOS', 'PRESTAMOS');
  var sheetEliminados = ss.getSheetByName(NOMBRE_HOJA);

  if (!sheetOrigen)     { Logger.log('❌ No se encontró la hoja BD_PRESTAMOS.'); return; }
  if (!sheetEliminados) { Logger.log('❌ No existe la hoja "' + NOMBRE_HOJA + '" en ' + ss.getName() + '.'); return; }

  var colOrigen = sheetOrigen.getLastColumn();
  if (colOrigen < 1) { Logger.log('❌ BD_PRESTAMOS no tiene encabezados.'); return; }

  // Las columnas de trazabilidad van justo después de la última de
  // BD_PRESTAMOS. Si alguien agregó columnas ahí, el índice 19 dejaría de ser
  // el correcto: mejor detenerse que escribir la fecha encima de otra columna.
  if (colOrigen !== IDX_PRIMERA) {
    Logger.log('❌ BD_PRESTAMOS tiene ' + colOrigen + ' columnas, se esperaban ' + IDX_PRIMERA + '.');
    Logger.log('   Ajusta IDX_PRIMERA (y CONFIG_COLUMNAS.PRESTAMOS_ELIMINADOS) antes de continuar.');
    return;
  }

  // Recién ahora, con la hoja validada, se registran los índices: si la
  // función abortara arriba, dejar la propiedad escrita haría que
  // eliminarSolicitud escribiera en columnas sin encabezado.
  var props = PropertiesService.getScriptProperties();
  var columnas = JSON.parse(props.getProperty('CONFIG_COLUMNAS') || '{}');
  var mapa = {};
  COLUMNAS_PROPIAS.forEach(function(nombre, i) { mapa[nombre] = IDX_PRIMERA + i; });
  columnas.PRESTAMOS_ELIMINADOS = mapa;
  props.setProperty('CONFIG_COLUMNAS', JSON.stringify(columnas));
  CONFIG = null;  // fuerza la recarga en el _ensureConfig() de esta misma ejecución
  _ensureConfig();
  Logger.log('✅ CONFIG_COLUMNAS.PRESTAMOS_ELIMINADOS = ' + JSON.stringify(mapa));

  var totalCol = colOrigen + COLUMNAS_PROPIAS.length;
  var encabezados = sheetOrigen.getRange(1, 1, 1, colOrigen).getValues()[0]
                               .concat(COLUMNAS_PROPIAS);

  var colActuales = sheetEliminados.getLastColumn();
  var encabezadosActuales = colActuales > 0
    ? sheetEliminados.getRange(1, 1, 1, colActuales).getValues()[0]
    : [];

  Logger.log('Encabezados ANTES (' + colActuales + ' col.): ' + encabezadosActuales.join(' | '));

  // Amplía la hoja si tiene menos columnas de las que necesitamos.
  if (sheetEliminados.getMaxColumns() < totalCol) {
    sheetEliminados.insertColumnsAfter(sheetEliminados.getMaxColumns(),
                                       totalCol - sheetEliminados.getMaxColumns());
  }

  var rango = sheetEliminados.getRange(1, 1, 1, totalCol);
  rango.setValues([encabezados]);
  rango.setFontWeight('bold');
  sheetEliminados.setFrozenRows(1);

  var filasHistoricas = Math.max(0, sheetEliminados.getLastRow() - 1);

  Logger.log('Encabezados DESPUÉS (' + totalCol + ' col.): ' + encabezados.join(' | '));
  Logger.log('✅ "' + NOMBRE_HOJA + '" alineada con BD_PRESTAMOS + trazabilidad (columnas T a W).');
  Logger.log('   Filas históricas conservadas sin modificar: ' + filasHistoricas);
  Logger.log('   Recuerda: las filas anteriores a la columna "Comprobante_vacaciones" quedan corridas desde esa posición,');
  Logger.log('   y ninguna fila histórica tiene trazabilidad (se eliminaron antes de que las columnas existieran).');
}

/**
 * Deja lista la sección "Datos de mi Jefatura" de BD_SLIMAPP:
 *
 *  1. Escribe los encabezados SUPERVISOR (AB1) y CORREO_SUPERVISOR (AC1) si
 *     todavía no están. No toca ninguna celda de datos.
 *  2. Registra CONFIG_COLUMNAS.USUARIOS.SUPERVISOR = 27 y
 *     CORREO_SUPERVISOR = 28, sin alterar el resto de las claves.
 *
 * Hasta que esto se ejecute, ambos índices son undefined: actualizarDatoUsuario
 * rechaza el campo con un aviso en el log en vez de escribir en una columna
 * equivocada, y la tarjeta del perfil sigue mostrando "S/D".
 *
 * ⚠️ Recordar que PropertiesService es independiente por proyecto: hay que
 * correrla UNA VEZ en DEV y UNA VEZ en PRODUCCIÓN. La hoja, en cambio, es la
 * misma para ambos entornos, así que los encabezados se escriben una sola vez
 * (la segunda corrida los encuentra ya puestos y solo confirma).
 *
 * Idempotente: correrla de nuevo reescribe lo mismo.
 */
function _configurarColumnasSupervisor() {
  _ensureConfig();

  var IDX_SUPERVISOR        = 27;  // Columna AB (0-based)
  var IDX_CORREO_SUPERVISOR = 28;  // Columna AC (0-based)

  var props = PropertiesService.getScriptProperties();
  var columnas = JSON.parse(props.getProperty('CONFIG_COLUMNAS') || '{}');

  if (!columnas.USUARIOS) {
    Logger.log('❌ CONFIG_COLUMNAS.USUARIOS no existe. Ejecuta primero inicializarConfiguracion().');
    return;
  }

  // --- 1. Encabezados en la hoja ---
  var sheet = getSheet('USUARIOS', 'USUARIOS');
  var encabezados = [
    { idx: IDX_SUPERVISOR,        nombre: 'SUPERVISOR',        letra: 'AB' },
    { idx: IDX_CORREO_SUPERVISOR, nombre: 'CORREO_SUPERVISOR', letra: 'AC' }
  ];

  encabezados.forEach(function(col) {
    var celda = sheet.getRange(1, col.idx + 1);
    var actual = String(celda.getDisplayValue() || '').trim();
    if (actual === '') {
      celda.setValue(col.nombre);
      Logger.log('✅ Encabezado ' + col.letra + '1 escrito: ' + col.nombre);
    } else if (actual.toUpperCase() === col.nombre) {
      Logger.log('• Encabezado ' + col.letra + '1 ya estaba: ' + actual);
    } else {
      Logger.log('⚠️ ' + col.letra + '1 contiene "' + actual + '" y NO se tocó. ' +
                 'Revisa la hoja: se esperaba ' + col.nombre + '.');
    }
  });

  // --- 2. Índices en PropertiesService ---
  columnas.USUARIOS.SUPERVISOR        = IDX_SUPERVISOR;
  columnas.USUARIOS.CORREO_SUPERVISOR = IDX_CORREO_SUPERVISOR;
  props.setProperty('CONFIG_COLUMNAS', JSON.stringify(columnas));

  Logger.log('✅ CONFIG_COLUMNAS.USUARIOS actualizado:');
  Logger.log('   SUPERVISOR = ' + IDX_SUPERVISOR + ' (columna AB)');
  Logger.log('   CORREO_SUPERVISOR = ' + IDX_CORREO_SUPERVISOR + ' (columna AC)');
}

/**
 * Configura CONFIG_CARPETAS.BACKUPS (la carpeta de Drive donde respaldarBasesDeDatos
 * deja las copias) SIN tocar ninguna otra clave de CONFIG_CARPETAS. Se ejecuta a
 * mano UNA VEZ por entorno — este ID es distinto en DEV y en PROD, por eso no vive
 * en el seed de CONFIG_CARPETAS.
 *
 * ANTES de ejecutar: crea (o elige) en Drive la carpeta de respaldos, abre su URL
 * y copia el ID (el tramo entre /folders/ y el siguiente "/"), y pégalo abajo en
 * ID_CARPETA_BACKUPS. La función verifica que la carpeta exista y sea accesible
 * antes de guardar; si sigue con el placeholder, no hace nada.
 */
function _configurarCarpetaBackups() {
  var ID_CARPETA_BACKUPS = 'ID_DE_GOOGLE_DRIVE';

  if (ID_CARPETA_BACKUPS === 'PEGAR_AQUI_EL_ID_DE_LA_CARPETA' || !ID_CARPETA_BACKUPS) {
    Logger.log('❌ _configurarCarpetaBackups: falta pegar el ID real de la carpeta de respaldos.');
    return;
  }

  // Falla temprano y con mensaje claro si el ID es inválido o la cuenta que
  // despliega no tiene acceso, en vez de guardar un ID que reventaría recién
  // el próximo viernes al correr el respaldo.
  var nombreCarpeta;
  try {
    nombreCarpeta = DriveApp.getFolderById(ID_CARPETA_BACKUPS).getName();
  } catch (e) {
    Logger.log('❌ _configurarCarpetaBackups: no se pudo abrir la carpeta ' + ID_CARPETA_BACKUPS + ' — ' + e);
    return;
  }

  var props = PropertiesService.getScriptProperties();
  var carpetas = JSON.parse(props.getProperty('CONFIG_CARPETAS') || '{}');
  carpetas.BACKUPS = ID_CARPETA_BACKUPS;
  props.setProperty('CONFIG_CARPETAS', JSON.stringify(carpetas));

  // La cuenta es Workspace: la carpeta pudo nacer compartida con la organización.
  // La dejamos en "Restringido" ya mismo (el respaldo hace lo propio con cada
  // subcarpeta y copia que crea después). Ver _restringirAccesoDrive en
  // Modulo admin.js.
  _restringirAccesoDrive(ID_CARPETA_BACKUPS);

  Logger.log('✅ CONFIG_CARPETAS.BACKUPS configurada: "' + nombreCarpeta + '" (' + ID_CARPETA_BACKUPS + ')');
  Logger.log('   Carpeta restringida (sin acceso de dominio). Ya puedes ejecutar respaldarBasesDeDatos().');
}

/**
 * ⚠️ EJECUTAR SOLO EN EL PROYECTO DE PRODUCCIÓN — NUNCA EN DEV. ⚠️
 * Reemplaza el mapeo GESTIONES_EMPRESA_CORREOS_JSON (correo de pruebas) por
 * las casillas reales de ISS, una por tipo de trámite. A partir de este punto
 * los correos de Trámites y Solicitudes a la Empresa llegan a la empresa real.
 * Ejecutar después de _configurarPropiedadesGestionesEmpresa() y antes de
 * habilitar el feature flag gestiones_empresa_habilitado. Reescribe el mapeo
 * completo, así que también es la vía para AGREGAR o QUITAR casillas: se edita
 * la lista de abajo y se vuelve a ejecutar UNA VEZ en PRODUCCIÓN (sigue siendo
 * la única función que debe correrse ahí y nunca en DEV, donde el mapeo debe
 * quedarse con el correo de pruebas: PropertiesService es por proyecto).
 * Última actualización: 20/08/2026 — la empresa pidió sumar
 * casilla@empresa.example a LICENCIAS_MEDICAS.
 */
function _configurarCorreosGestionesEmpresaProduccion() {
  var props = PropertiesService.getScriptProperties();
  props.setProperty('GESTIONES_EMPRESA_CORREOS_JSON', JSON.stringify({
    CONTRATOS:         ["casilla@empresa.example"],
    VACACIONES:        ["casilla@empresa.example"],
    CERTIFICADOS:      ["casilla@empresa.example"],
    ASISTENCIA:        ["casilla@empresa.example"],
    LICENCIAS_MEDICAS: [
      "casilla@empresa.example",
      "casilla@empresa.example",
      "casilla@empresa.example",
      "casilla@empresa.example"
    ]
  }));
  Logger.log('✅ Correos reales de ISS configurados para Trámites y Solicitudes a la Empresa:');
  Logger.log(props.getProperty('GESTIONES_EMPRESA_CORREOS_JSON'));
}

/**
 * Deja el módulo "Trámites y Solicitudes a la Empresa" apagado para socios
 * reales mientras se termina de verificar la configuración (correos ISS,
 * hoja GESTIONES_EMPRESA, permisos Drive). Sin esto, el flag queda habilitado
 * por defecto en cuanto exista un deploy que incluya el módulo (ver
 * _switchHabilitado() en Global.js: clave ausente = habilitado).
 * Reversible: para reactivarlo más tarde, usar el switch del panel Admin
 * (toggleSwitchGestiones) o volver a ejecutar esta función cambiando 'false'
 * por 'true' en la línea de abajo.
 */
function _desactivarGestionesEmpresaTemporalmente() {
  PropertiesService.getScriptProperties().setProperty('gestiones_empresa_habilitado', 'false');
  Logger.log('✅ gestiones_empresa_habilitado = false (módulo apagado para socios).');
}

/**
 * Reactiva el módulo "Trámites y Solicitudes a la Empresa" para socios reales,
 * una vez confirmadas las pruebas de la Fase 5 (correos ISS reales, correo
 * interno a ADMIN+DIRECTORIO+REPLEGAL, hoja GESTIONES_EMPRESA operativa).
 */
function _activarGestionesEmpresa() {
  PropertiesService.getScriptProperties().setProperty('gestiones_empresa_habilitado', 'true');
  Logger.log('✅ gestiones_empresa_habilitado = true (módulo activo para socios).');
}

/**
 * Prueba manual: confirma cuántos y cuáles correos REPLEGAL activos hay en
 * CUENTAS_VALIDAS. Ejecutar después de normalizar la hoja (paso 6). Esperado:
 * exactamente 3 correos (Pacheco, Miñano, Niedmann). Función temporal de
 * verificación — se puede borrar una vez confirmado.
 */
function _testObtenerCorreosRepLegal() {
  Logger.log(obtenerCorreosRepLegal());
}

/**
 * Solo-lectura: imprime el mapeo real gestión→correos que está guardado en
 * PropertiesService (GESTIONES_EMPRESA_CORREOS_JSON) y, por cada tipo de
 * gestión, la lista exacta que hoy se usa como destinatarios. Sirve para
 * diagnosticar de dónde salen los destinatarios de cada correo. No modifica
 * nada. Función temporal de verificación.
 */
function _verCorreosGestionesEmpresa() {
  var raw = PropertiesService.getScriptProperties().getProperty('GESTIONES_EMPRESA_CORREOS_JSON');
  Logger.log('GESTIONES_EMPRESA_CORREOS_JSON (crudo):');
  Logger.log(raw || '(no existe)');
  Logger.log('----------------------------------------');
  ['CONTRATOS', 'VACACIONES', 'CERTIFICADOS', 'ASISTENCIA', 'LICENCIAS_MEDICAS'].forEach(function(clave) {
    Logger.log(clave + ' → ' + JSON.stringify(_obtenerCorreosGestion(clave)));
  });
}

function verificarConfiguracion() {
  var props = PropertiesService.getScriptProperties().getProperties();
  var claves = [
    'SS_USUARIOS', 'SS_JUSTIFICACIONES', 'SS_APELACIONES', 'SS_PRESTAMOS',
    'SS_PERMISOS_MEDICOS', 'SS_CREDENCIALES', 'SS_ASISTENCIA',
    'SS_GAMIFICACION', 'SS_DENUNCIAS_JEFATURAS',
    'WEBAPP_URL', 'CONFIG_HOJAS', 'CONFIG_CARPETAS', 'CONFIG_CORREOS', 'CONFIG_COLUMNAS'
  ];
  var ok = true;
  claves.forEach(function(k) {
    if (props[k]) {
      Logger.log('OK  ' + k);
    } else {
      Logger.log('FALTA  ' + k);
      ok = false;
    }
  });
  Logger.log(ok ? '✅ Configuración completa.' : '⚠️ Hay claves sin configurar.');
}

/**
 * Configura CORREOS_INSTITUCIONALES_EXTRA: las casillas de la organización que
 * NO son de una persona (administracion@, zonanorte@, zonasur@…) y que por eso
 * no figuran ni en CUENTAS_VALIDAS ni como socio con rol en BD_SLIMAPP.
 *
 * Modulo permisosArchivos.js las usa para no confundirlas con el correo personal
 * desactualizado de un socio. Sin esta lista, cada una de ellas aparece como
 * "acceso ajeno" en cientos de archivos.
 *
 * ⚠️ Sólo direcciones de gente/cargos VIGENTES. Una dirección de alguien que ya
 * dejó la organización NO va acá: hay que revocarla con revocarAccesoCorreo().
 * Lista confirmada con el usuario el 2026-08-25 (correo@ejemplo.com
 * quedó deliberadamente fuera: ya no es dirigente).
 *
 * Ejecutar UNA VEZ por proyecto (DEV y PROD por separado).
 */
function _configurarCorreosInstitucionalesExtra() {
  var correos = [
    'correo@ejemplo.com',
    'correo@ejemplo.com',
    'correo@ejemplo.com',
    'correo@ejemplo.com',
    'correo@ejemplo.com',
    'correo@ejemplo.com',
    'correo@ejemplo.com',
    'correo@ejemplo.com',
    'correo@ejemplo.com',
    'correo@ejemplo.com'
  ];

  PropertiesService.getScriptProperties()
    .setProperty('CORREOS_INSTITUCIONALES_EXTRA', JSON.stringify(correos));

  Logger.log('✅ CORREOS_INSTITUCIONALES_EXTRA configurada con ' + correos.length + ' direcciones:');
  correos.forEach(function(c) { Logger.log('   • ' + c); });
}

/**
 * Configura el carrusel de noticias del inicio (Modulo noticias.js): la
 * planilla propia SS_NOTICIAS, CONFIG_HOJAS.NOTICIAS y CONFIG_COLUMNAS.NOTICIAS,
 * haciendo merge SIN tocar ninguna otra propiedad.
 *
 * Antes de correrla: crear en Drive una planilla vacía "BD_NOTICIAS" (con la
 * misma cuenta que despliega el webapp) y pegar su ID abajo.
 *
 * Ejecutar UNA VEZ por proyecto (DEV y PROD por separado): PropertiesService
 * es independiente en cada uno, aunque la planilla sea la misma. La primera
 * corrida además prepara la hoja (encabezados, listas desplegables y una fila
 * de ejemplo apagada); la segunda la encuentra lista y no la toca.
 *
 * Es idempotente: escribe siempre los mismos valores.
 */
function _configurarNoticias() {
  var ID_PLANILLA_NOTICIAS = 'ID_DE_GOOGLE_DRIVE';

  if (!ID_PLANILLA_NOTICIAS || ID_PLANILLA_NOTICIAS.indexOf('PEGAR_AQUI') === 0) {
    Logger.log('❌ Falta pegar el ID de la planilla BD_NOTICIAS en _configurarNoticias(). No se configuró nada.');
    return;
  }
  var props = PropertiesService.getScriptProperties();

  props.setProperty('SS_NOTICIAS', ID_PLANILLA_NOTICIAS);

  var hojas = JSON.parse(props.getProperty('CONFIG_HOJAS') || '{}');
  hojas.NOTICIAS = 'NOTICIAS';
  props.setProperty('CONFIG_HOJAS', JSON.stringify(hojas));

  var columnas = JSON.parse(props.getProperty('CONFIG_COLUMNAS') || '{}');
  columnas.NOTICIAS = {
    ACTIVA: 0, TIPO: 1, TITULO: 2, BAJADA: 3, DESDE: 4, HASTA: 5,
    ZONA: 6, BOTON: 7, ABRE: 8, ENLACE: 9, ORDEN: 10,
    // Autoría: la escribe el formulario del Panel de noticias (solo ADMIN).
    PUBLICADO_POR: 11, ACTUALIZADO_POR: 12, FECHA_ACTUALIZACION: 13
  };
  props.setProperty('CONFIG_COLUMNAS', JSON.stringify(columnas));

  Logger.log('✅ Noticias configuradas:');
  Logger.log('  SS_NOTICIAS = ' + props.getProperty('SS_NOTICIAS'));
  Logger.log('  CONFIG_HOJAS.NOTICIAS = ' + hojas.NOTICIAS);
  Logger.log('  CONFIG_COLUMNAS.NOTICIAS = ' + JSON.stringify(columnas.NOTICIAS));

  // CONFIG ya pudo cargarse en esta ejecución con los valores anteriores.
  CONFIG = null;
  _prepararHojaNoticias_();
}

/**
 * Columnas del foro (Modulo foro.js). Una sola definición, usada por
 * _configurarForo() y por el objeto semilla de inicializarConfiguracion().
 */
function _columnasForo_() {
  return {
    FORO_CATEGORIAS: {
      ID_CATEGORIA: 0, NOMBRE: 1, DESCRIPCION: 2, ORDEN: 3, ACTIVA: 4,
      CREADA_POR: 5, ACTUALIZADA_POR: 6, FECHA_ACTUALIZACION: 7
    },
    FORO_TEMAS: {
      ID_TEMA: 0, ID_CATEGORIA: 1, TITULO: 2, TEXTO: 3, RUT_AUTOR: 4, NOMBRE_AUTOR: 5,
      FECHA_CREACION: 6, FECHA_ULTIMA_ACTIVIDAD: 7, N_RESPUESTAS: 8, ESTADO: 9,
      CERRADO: 10, FIJADO: 11, MODERADO_POR: 12, FECHA_MODERACION: 13, MOTIVO_MODERACION: 14,
      N_REPORTES: 15, FECHA_EDICION: 16, TEXTO_ORIGINAL: 17, TITULO_ORIGINAL: 18,
      ROL_AUTOR: 19,  // agregada el 26/09/2026: rol con que escribió (foto)
      CARGO_AUTOR: 20 // agregada el 29/09/2026: cargo en la empresa al escribir (foto)
    },
    FORO_RESPUESTAS: {
      ID_RESPUESTA: 0, ID_TEMA: 1, TEXTO: 2, RUT_AUTOR: 3, NOMBRE_AUTOR: 4, FECHA: 5,
      ESTADO: 6, MODERADO_POR: 7, FECHA_MODERACION: 8, MOTIVO_MODERACION: 9,
      N_REPORTES: 10, FECHA_EDICION: 11, TEXTO_ORIGINAL: 12,
      ROL_AUTOR: 13,  // agregada el 26/09/2026: rol con que escribió (foto)
      CARGO_AUTOR: 14 // agregada el 29/09/2026: cargo en la empresa al escribir (foto)
    },
    FORO_REPORTES: {
      ID_REPORTE: 0, TIPO: 1, ID_OBJETO: 2, ID_TEMA: 3, RUT_REPORTA: 4, MOTIVO: 5,
      DETALLE: 6, FECHA: 7, ESTADO: 8, RESUELTO_POR: 9, FECHA_RESOLUCION: 10, RESOLUCION: 11
    },
    FORO_REGLAS: { RUT: 0, VERSION_REGLAS: 1, FECHA: 2 }
  };
}

/**
 * Configura el foro de la comunidad (Modulo foro.js): la planilla propia
 * SS_FORO, CONFIG_HOJAS.FORO_* y CONFIG_COLUMNAS.FORO_*, haciendo merge SIN
 * tocar ninguna otra propiedad.
 *
 * Ejecutar UNA VEZ por proyecto (DEV y PROD por separado): PropertiesService
 * es independiente en cada uno, aunque la planilla sea la misma. La primera
 * corrida además prepara BD_FORO (pestañas, encabezados, formatos, listas y
 * tres categorías de partida); las siguientes reaplican formatos y listas sin
 * tocar ninguna fila con datos.
 *
 * Es idempotente: escribe siempre los mismos valores.
 */
function _configurarForo() {
  var ID_PLANILLA_FORO = 'ID_DE_GOOGLE_DRIVE';

  var props = PropertiesService.getScriptProperties();
  props.setProperty('SS_FORO', ID_PLANILLA_FORO);

  var hojas = JSON.parse(props.getProperty('CONFIG_HOJAS') || '{}');
  hojas.FORO_CATEGORIAS = 'CATEGORIAS';
  hojas.FORO_TEMAS      = 'TEMAS';
  hojas.FORO_RESPUESTAS = 'RESPUESTAS';
  hojas.FORO_REPORTES   = 'REPORTES';
  hojas.FORO_REGLAS     = 'REGLAS_ACEPTADAS';
  props.setProperty('CONFIG_HOJAS', JSON.stringify(hojas));

  var columnas = JSON.parse(props.getProperty('CONFIG_COLUMNAS') || '{}');
  var foro = _columnasForo_();
  Object.keys(foro).forEach(function(k) { columnas[k] = foro[k]; });
  props.setProperty('CONFIG_COLUMNAS', JSON.stringify(columnas));

  Logger.log('✅ Foro configurado:');
  Logger.log('  SS_FORO = ' + props.getProperty('SS_FORO'));
  Object.keys(foro).forEach(function(k) {
    Logger.log('  ' + k + ' → pestaña ' + hojas[k] + ' · ' + JSON.stringify(columnas[k]));
  });

  // CONFIG ya pudo cargarse en esta ejecución con los valores anteriores.
  CONFIG = null;
  _prepararHojasForo_();
}
