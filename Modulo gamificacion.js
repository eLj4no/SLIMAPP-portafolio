// ==========================================
// MODULO_GAMIFICACION.GS — SLIM Quest
// ==========================================
//
// CONTRATO CLIENTE-SERVIDOR (importante)
// --------------------------------------
// El webapp es ANYONE_ANONYMOUS: cualquier funcion global es invocable a mano
// desde la consola del navegador. Por eso este modulo NO recibe el RUT desde
// el cliente y NO acepta puntajes calculados por el cliente:
//
//   1. `questIniciarQuiz(sessionToken, modo)` resuelve el RUT en el servidor,
//      arma las preguntas, guarda la PAUTA en CacheService bajo un `quizToken`
//      y devuelve las preguntas SIN la respuesta correcta.
//   2. `questResponder(quizToken, indice, letra)` corrige en el servidor y
//      recien ahi entrega la respuesta correcta y la explicacion.
//   3. `questFinalizar(quizToken)` calcula el XP a partir de lo que el
//      servidor guardo, no de lo que el cliente diga.
//
// El cliente nunca ve una respuesta antes de contestarla y nunca decide cuanto
// XP gano. Si esto se toca, se pierden las dos garantias a la vez.
//
// COMO SE LLAMA EL PUNTAJE
// ------------------------
// En el codigo y en la planilla se llama XP (`XP_TOTAL`, `xpGanado`, `xpMes`).
// Al socio se le presenta como FORMACION, y la unidad corta es "pts". Se dejo
// asi a proposito: renombrar los identificadores obligaria a migrar columnas de
// la hoja sin ganar nada, y el nombre visible es una decision de contenido que
// puede volver a cambiar. Si tocas un texto que el socio lee, la palabra es
// "formacion" o "pts" — nunca "XP".
//
// ==========================================

// ==========================================
// GRADOS — FUENTE UNICA DE VERDAD
// ==========================================
//
// Estos datos alimentan tres consumidores: la vista de SLIM Quest, el modal de
// "info de grado" y el correo de subida de nivel. Antes vivian duplicados en
// los tres lugares (backend + dos objetos distintos en Index.html) y ya se
// habian desincronizado. Ahora el frontend los recibe desde aca: cambiar un
// umbral, un color o una frase es un solo edit.
//
// UMBRALES (recalibrados 09/2026): la curva anterior exigia ~241 dias de juego
// PERFECTO para llegar a Dirigente — mas de tres anos a ritmo realista, lo que
// dejaba el Nivel Secreto fuera del alcance de todos. Se redujo a la mitad:
// hoy un socio constante que acierte 3-4 de 5 llega en ~9 meses, y uno
// perfecto en ~4. El XP por pregunta NO cambio, asi que el BANCO_PREGUNTAS no
// necesita migracion.
var GRADOS_SLIM = [
  { nombre: "Aspirante",  minXP: 0,     icono: "🌱",
    headerBg: '#15803d', color: '#22c55e', badgeBg: '#dcfce7', badgeText: '#14532d',
    quote: 'Cada gran viaje comienza con el primer paso. ¡Has dado el tuyo!',
    msg:   'Tu participación en SLIM Quest ha comenzado. Cada quiz diario te acerca más a convertirte en un referente sindical de la organización.' },
  { nombre: "Aprendiz",   minXP: 750,   icono: "⚙️",
    headerBg: '#1d4ed8', color: '#3b82f6', badgeBg: '#dbeafe', badgeText: '#1e3a8a',
    quote: 'El conocimiento es la herramienta más poderosa del movimiento sindical.',
    msg:   'Tu constancia está dando frutos. Ya dominas los fundamentos sindicales y estás construyendo una base sólida de conocimiento.' },
  { nombre: "Trabajador", minXP: 2250,  icono: "🔩",
    headerBg: '#c2410c', color: '#f97316', badgeBg: '#ffedd5', badgeText: '#7c2d12',
    quote: 'El trabajo organizado mueve montañas. Tú eres la fuerza del sindicato.',
    msg:   'Tu dedicación refleja los valores fundamentales de la organización. Eres un ejemplo de compromiso para tus compañeros.' },
  { nombre: "Defensor",   minXP: 5000,  icono: "🛡️",
    headerBg: '#6d28d9', color: '#8b5cf6', badgeBg: '#ede9fe', badgeText: '#4c1d95',
    quote: 'Defender los derechos colectivos es el corazón del sindicalismo.',
    msg:   'Has demostrado un compromiso profundo con los valores y derechos de la organización. Eres un pilar fundamental del Sindicato SLIM N°3.' },
  { nombre: "Negociador", minXP: 9000,  icono: "⚖️",
    headerBg: '#b45309', color: '#d97706', badgeBg: '#fef3c7', badgeText: '#78350f',
    quote: 'La negociación efectiva nace del conocimiento profundo y la preparación incansable.',
    msg:   'Tu nivel de preparación y conocimiento te posiciona entre los socios más destacados. Tu voz tiene un peso especial en la organización.' },
  { nombre: "Dirigente",  minXP: 15000, icono: "🏆",
    headerBg: '#92400e', color: '#f59e0b', badgeBg: '#fffbeb', badgeText: '#78350f',
    quote: 'El verdadero líder no es quien dirige, sino quien inspira y transforma.',
    msg:   'Has alcanzado el nivel máximo de SLIM Quest. Tu trayectoria de aprendizaje y dedicación te convierten en uno de los referentes más importantes del Sindicato SLIM N°3.' }
];

// ==========================================
// CONFIGURACION DEL MODULO
// ==========================================
//
// Los nombres de hoja son constantes locales y no claves de CONFIG.HOJAS a
// proposito — mismo criterio que HOJA_PERMISOS_ARCHIVOS y que las hojas de
// CFG_ASISTENCIA_BRIGADA: una clave en CONFIG exigiria correr un
// _configurar*() por entorno antes de que el modulo funcione, y esta hoja se
// repara sola.
var CFG_QUEST = {
  HOJA_ESTADO:          'QUEST_ESTADO',   // pestana auxiliar dentro de SS_GAMIFICACION
  PREGUNTAS_POR_QUIZ:   5,
  TTL_QUIZ_SEG:         3600,             // vida del quizToken en CacheService (1 h)
  TTL_LEADERBOARD_SEG:  300,
  TOPE_LEADERBOARD:     10,
  ZONA_HORARIA:         'America/Santiago'
};

// XP por defecto de cada nivel. Solo se usa cuando la columna XP del banco esta
// vacia o no es un numero: el valor de la hoja manda, para que el ADMIN pueda
// afinar una pregunta puntual sin tocar codigo.
var XP_POR_NIVEL_QUEST = { BASICO: 15, INTERMEDIO: 25, AVANZADO: 40, DIRIGENTE: 50 };

// Cuantas preguntas de cada nivel recibe un socio segun su grado. La suma de
// cada fila es CFG_QUEST.PREGUNTAS_POR_QUIZ.
var PESOS_QUIZ_POR_GRADO = {
  "Aspirante":  { BASICO: 4, INTERMEDIO: 1, AVANZADO: 0 },
  "Aprendiz":   { BASICO: 3, INTERMEDIO: 2, AVANZADO: 0 },
  "Trabajador": { BASICO: 2, INTERMEDIO: 2, AVANZADO: 1 },
  "Defensor":   { BASICO: 1, INTERMEDIO: 3, AVANZADO: 1 },
  "Negociador": { BASICO: 1, INTERMEDIO: 2, AVANZADO: 2 },
  "Dirigente":  { BASICO: 0, INTERMEDIO: 2, AVANZADO: 3 }
};

// Bono de XP al alcanzar exactamente ese dia de racha. Pasados los 100 dias se
// entrega un bono fijo cada 7, para que la racha larga siga significando algo.
var BONOS_RACHA_QUEST = { 3: 20, 7: 50, 14: 80, 21: 100, 30: 160, 60: 280, 100: 500 };

// ESCENARIO reutiliza este mismo motor: sus pasos tienen la forma de una
// pregunta, asi que heredan la correccion en el servidor sin duplicarla. Ver
// `Modulo questEscenarios.js`.
var MODOS_QUIZ = { DIARIO: 'DIARIO', PRACTICA: 'PRACTICA', SECRETO: 'SECRETO', ESCENARIO: 'ESCENARIO' };

// El Nivel Secreto no existe para nadie hasta que alcanza el GRADO Dirigente
// (por puntos de formacion; el rol en el sindicato no tiene nada que ver).
// Todo lo que lo nombra vive en el SERVIDOR y viaja solo al navegador de quien
// ya tiene el grado, incluido el nombre del modo con que se abre (`modo`): el
// cliente no lleva la palabra escrita en ninguna parte, ni en textos ni en
// identificadores. Para cualquier otro, pedir ese modo se responde igual que
// pedir uno que no existe. Ver questIniciarQuiz().
var TEXTOS_SECRETO_QUEST = {
  nombre:      'Nivel Secreto',
  descripcion: 'Teoría dirigencial · Conducción sindical y Economía Política',
  titulo:      '🔐 Nivel Secreto',
  etiqueta:    'Teoría dirigencial'
};

// ==========================================
// ESCUELA DE FORMACION DIRIGENCIAL (el Nivel Secreto por dentro)
// ==========================================
//
// Desde el 23/09/2026 el Nivel Secreto es una escuela con tres ramas, avance
// propio y graduacion. No usa preguntas propias: son las de nivel DIRIGENTE
// del banco, repartidas por su CATEGORIA. Una pregunta queda "dominada" la
// primera vez que se responde bien en la clase diaria (el quiz SECRETO), y la
// clase saca primero las que faltan: repetir preguntas deja de ser un problema
// porque cada repeticion es otra oportunidad de dominarla.
//
// Todo el texto de la escuela sale de aqui y viaja solo al grado Dirigente
// (ver `_payloadEscuela_`): el cliente no tiene escrita ni una palabra de ella.
//
// Si el banco crece, el avance de una rama vuelve a abrirse (18 de 25), pero
// las insignias ya ganadas no se quitan: nada de lo que el socio gano
// desaparece.
var ESCUELA_DIRIGENCIAL = {
  titulo: 'Escuela de Formación Dirigencial',
  ramas: [
    { codigo: 'CONDUCCION', nombre: 'Conducción sindical', corto: 'Conducción',
      descripcion: 'Directorio, fuero, finanzas y organización',
      categorias: ['SINDICATO', 'DERECHOS', 'REGLAMENTO', 'PROTOCOLO'],
      icono: 'account_balance', emoji: '🏛️', logro: 'ESCUELA_CONDUCCION',
      c1: '#7c3aed', bg: '#ede9fe', tx: '#5b21b6' },
    { codigo: 'NEGOCIACION', nombre: 'Negociación colectiva', corto: 'Negociación',
      descripcion: 'Huelga, plazos, oferta y contrato colectivo',
      categorias: ['NEGOCIACION', 'CONTRATO'],
      icono: 'handshake', emoji: '🤝', logro: 'ESCUELA_NEGOCIACION',
      c1: '#4f46e5', bg: '#e0e7ff', tx: '#3730a3' },
    { codigo: 'ECONOMIA', nombre: 'Economía política', corto: 'Economía',
      descripcion: 'Valor, plusvalía y salario',
      categorias: ['ECONOMIA'],
      icono: 'menu_book', emoji: '📖', logro: 'ESCUELA_ECONOMIA',
      c1: '#d97706', bg: '#fef3c7', tx: '#78350f' }
  ],
  // Una categoria que no figure en ninguna rama cae aqui, y se registra: una
  // pregunta nueva de nivel DIRIGENTE nunca debe quedar fuera de la escuela.
  ramaPorDefecto: 'CONDUCCION',
  logroGraduacion: 'ESCUELA_GRADUADO'
};

// ==========================================
// CATALOGO DE LOGROS
// ==========================================
//
// Declarativo, no una cascada de ifs: el mismo array decide que se otorga y
// alimenta la vitrina de logros del socio, que ahora muestra tambien los que
// aun no tiene. Un logro invisible no motiva a nadie.
//
// `condicion` recibe un resumen del estado del socio DESPUES de registrar el
// quiz. Los codigos son los mismos de la version anterior: los logros ya
// guardados en la columna LOGROS se siguen reconociendo.
var CATALOGO_LOGROS_QUEST = [
  { codigo: "PRIMER_QUIZ",   nombre: "Primer Quiz",           icono: "🎮", pista: "Completa tu primer quiz diario.",
    descripcion: "Diste el primer paso. Cada quiz que respondas te deja conociendo un poco mejor tus derechos y las herramientas que tienes como socio.",
    condicion: function(e) { return e.quizzes >= 1; } },
  { codigo: "10_QUIZZES",    nombre: "10 Quizzes",            icono: "⭐", pista: "Completa 10 quizzes diarios.",
    descripcion: "Diez quizzes completados. Ya no estás probando la aplicación: estás estudiando.",
    condicion: function(e) { return e.quizzes >= 10; } },
  { codigo: "25_QUIZZES",    nombre: "Estudiante Sindical",   icono: "🎓", pista: "Completa 25 quizzes diarios.",
    descripcion: "Veinticinco quizzes. A esta altura manejas conceptos que muchos compañeros todavía preguntan en asamblea.",
    condicion: function(e) { return e.quizzes >= 25; } },
  { codigo: "50_QUIZZES",    nombre: "Comprometido",          icono: "📖", pista: "Completa 50 quizzes diarios.",
    descripcion: "Cincuenta quizzes completados. Tu constancia dice más de tu compromiso que cualquier discurso.",
    condicion: function(e) { return e.quizzes >= 50; } },
  { codigo: "100_QUIZZES",   nombre: "Maestro del Sindicato", icono: "🏛️", pista: "Completa 100 quizzes diarios.",
    descripcion: "Cien quizzes. Muy pocos socios llegan hasta acá, y el conocimiento que acumulaste es patrimonio de toda la organización.",
    condicion: function(e) { return e.quizzes >= 100; } },
  { codigo: "QUIZ_PERFECTO", nombre: "Quiz Perfecto",         icono: "🎯", pista: "Responde correctamente todas las preguntas de un quiz.",
    descripcion: "Todas las respuestas correctas en un mismo quiz. No fue suerte: las sabías.",
    condicion: function(e) { return e.perfectos >= 1; } },
  { codigo: "3_PERFECTOS",   nombre: "Imparable",             icono: "💯", pista: "Consigue 3 quizzes perfectos.",
    descripcion: "Tres quizzes perfectos. Cuando se domina la materia, se nota.",
    condicion: function(e) { return e.perfectos >= 3; } },
  { codigo: "10_PERFECTOS",  nombre: "Sin Errores",           icono: "🌟", pista: "Consigue 10 quizzes perfectos.",
    descripcion: "Diez quizzes perfectos. Tienes los fundamentos sindicales realmente incorporados.",
    condicion: function(e) { return e.perfectos >= 10; } },
  { codigo: "RACHA_3",       nombre: "Primeros pasos",        icono: "✨", pista: "Juega 3 días seguidos.",
    descripcion: "Tres días seguidos jugando. Así se construye un hábito.",
    condicion: function(e) { return e.rachaMax >= 3; } },
  { codigo: "RACHA_7",       nombre: "Racha de 7 días",  icono: "🔥", pista: "Juega 7 días seguidos.",
    descripcion: "Una semana completa sin saltarte un día. La constancia es la parte difícil.",
    condicion: function(e) { return e.rachaMax >= 7; } },
  { codigo: "RACHA_14",      nombre: "Racha de 2 semanas",    icono: "🔥🔥", pista: "Juega 14 días seguidos.",
    descripcion: "Catorce días seguidos. Ya es parte de tu rutina.",
    condicion: function(e) { return e.rachaMax >= 14; } },
  { codigo: "RACHA_30",      nombre: "Racha de 30 días", icono: "📅", pista: "Juega 30 días seguidos.",
    descripcion: "Un mes entero sin cortar. Poca gente sostiene algo treinta días seguidos.",
    condicion: function(e) { return e.rachaMax >= 30; } },
  { codigo: "RACHA_60",      nombre: "Racha de 60 días", icono: "🗓️", pista: "Juega 60 días seguidos.",
    descripcion: "Dos meses sin cortar la racha. Esto ya es disciplina.",
    condicion: function(e) { return e.rachaMax >= 60; } },
  { codigo: "RACHA_100",     nombre: "Centenario",            icono: "💎", pista: "Juega 100 días seguidos.",
    descripcion: "Cien días seguidos. Un número que casi nadie alcanza.",
    condicion: function(e) { return e.rachaMax >= 100; } },
  { codigo: "ESTUDIOSO",     nombre: "Estudioso",             icono: "📚", pista: "Completa 10 rondas de práctica libre.",
    descripcion: "Diez rondas de práctica libre, sin puntos de por medio. Practicaste solo por aprender.",
    condicion: function(e) { return e.practicas >= 10; } },
  // `visibleSi` mantiene el logro FUERA de la vitrina —y fuera del total— hasta
  // que el socio llega a Dirigente. El Nivel Secreto tiene que descubrirse al
  // alcanzarlo; un logro bloqueado que dice "completa un quiz del Nivel
  // Secreto" se lo cuenta a los 2.800 socios que todavía no pueden verlo.
  //
  // Un logro ya obtenido se muestra siempre, sin importar `visibleSi`: nada de
  // lo que el socio ganó puede desaparecer de su vitrina.
  { codigo: "NIVEL_SECRETO", nombre: "Guardián del Saber", icono: "🔐", pista: "Completa un quiz del Nivel Secreto.",
    descripcion: "Completaste el nivel reservado. Llegaste al material que solo ven quienes alcanzaron el grado más alto.",
    visibleSi: function(ctx) { return ctx.esDirigente; },
    condicion: function(e) { return e.secretos >= 1; } },
  // Escuela de Formacion Dirigencial: una insignia por rama y la graduacion.
  // Mismo `visibleSi` que el anterior, y por la misma razon.
  { codigo: "ESCUELA_CONDUCCION", nombre: "Conducción sindical", icono: "🏛️", pista: "Responde bien, al menos una vez, cada pregunta de la rama Conducción sindical.",
    descripcion: "Dominaste la rama de conducción sindical: cómo se constituye, se dirige y se defiende una organización. Es el oficio de quien la conduce.",
    visibleSi: function(ctx) { return ctx.esDirigente; },
    condicion: function(e) { return !!(e.escuela && e.escuela.CONDUCCION); } },
  { codigo: "ESCUELA_NEGOCIACION", nombre: "Negociación colectiva", icono: "🤝", pista: "Responde bien, al menos una vez, cada pregunta de la rama Negociación colectiva.",
    descripcion: "Dominaste la rama de negociación colectiva: plazos, huelga, última oferta y contrato. Es el momento en que la organización se juega lo que construyó.",
    visibleSi: function(ctx) { return ctx.esDirigente; },
    condicion: function(e) { return !!(e.escuela && e.escuela.NEGOCIACION); } },
  { codigo: "ESCUELA_ECONOMIA", nombre: "Economía política", icono: "📖", pista: "Responde bien, al menos una vez, cada pregunta de la rama Economía política.",
    descripcion: "Dominaste la rama de economía política: valor, plusvalía, jornada y salario. Es la base para leer una oferta de la empresa más allá de la cifra.",
    visibleSi: function(ctx) { return ctx.esDirigente; },
    condicion: function(e) { return !!(e.escuela && e.escuela.ECONOMIA); } },
  { codigo: "ESCUELA_GRADUADO", nombre: "Graduado de la Escuela", icono: "🎓", pista: "Completa las tres ramas de la Escuela de Formación Dirigencial.",
    descripcion: "Completaste las tres ramas de la Escuela de Formación Dirigencial. Tienes la formación que la organización espera de quien la conduce.",
    visibleSi: function(ctx) { return ctx.esDirigente; },
    condicion: function(e) { return !!(e.escuela && e.escuela.CONDUCCION && e.escuela.NEGOCIACION && e.escuela.ECONOMIA); } },

  // --- Participación sindical -------------------------------------------
  //
  // Se cuentan ACTIVIDADES que le correspondían al socio, no meses del
  // calendario. La diferencia importa: enero y febrero no tienen asambleas, y
  // una racha medida en meses se rompería sola cada verano por algo que no
  // depende de nadie. Un mes sin actividad en su zona tampoco suma ni resta.
  //
  // Que "justificar a tiempo" cuente como cumplimiento es deliberado: el socio
  // que no pudo ir pero hizo el trámite dentro del plazo se comportó como la
  // organización espera. Lo que NO se premia es el trámite en sí — no existe
  // ningún logro por "presentaste N justificaciones", porque eso premiaría
  // faltar.
  { codigo: "PART_PRIMERA",    nombre: "Primera asamblea",   icono: "🤝", pista: "Asiste a tu primera actividad sindical.",
    descripcion: "Estuviste en tu primera actividad sindical. El sindicato se construye en la sala, con la gente presente.",
    condicion: function(e) { return e.partAsistidas >= 1; } },
  { codigo: "PART_COMPROMISO", nombre: "Compromiso",         icono: "🪧", pista: "Cumple con 5 actividades sindicales seguidas.",
    descripcion: "Cinco actividades seguidas cumpliendo, sin fallar ninguna. Esa seguidilla es difícil de sostener.",
    condicion: function(e) { return e.partRachaMax >= 5; } },
  { codigo: "PART_ANIO_7",     nombre: "Presente todo el año", icono: "📆", pista: "Cumple con 7 actividades sindicales en un mismo año.",
    descripcion: "Siete actividades cumplidas en un mismo año. Estuviste en la mayoría de las instancias de la organización.",
    condicion: function(e) { return e.partAnioOk >= 7; } },
  // El umbral es 10 porque el año tiene 10 asambleas: de marzo a diciembre, una
  // por mes. Con 12 el logro no se podía ganar en un año — el socio con récord
  // perfecto terminaba diciembre sin la insignia y recién la alcanzaba en abril
  // del año siguiente, cuando ya no la relacionaba con nada.
  { codigo: "PART_12",         nombre: "Un año en regla",     icono: "🎗️", pista: "Acumula 10 actividades sindicales en cumplimiento.",
    descripcion: "Diez actividades en cumplimiento: un año entero de asambleas. Asististe o justificaste dentro de plazo en todas ellas.",
    condicion: function(e) { return (e.partAsistidas + e.partJustificadas) >= 10; } },
  { codigo: "PART_24",         nombre: "Trayectoria",         icono: "🏅", pista: "Acumula 24 actividades sindicales en cumplimiento.",
    descripcion: "Veinticuatro actividades en cumplimiento. Tu historial habla por sí solo.",
    condicion: function(e) { return (e.partAsistidas + e.partJustificadas) >= 24; } },
  // No dice "presencialmente": el registro no distingue la modalidad, y de las
  // ~10 asambleas del año la mitad son virtuales. Prometer presencia sería
  // prometer algo que el sistema no mide. Lo que sí distingue este logro es
  // asistir de justificar: cuenta solo las asistencias.
  { codigo: "PART_PRESENTE_10", nombre: "Siempre en la sala", icono: "📣", pista: "Asiste a 10 actividades sindicales.",
    descripcion: "Diez asambleas con tu asistencia. No bastó con justificar: estuviste.",
    condicion: function(e) { return e.partAsistidas >= 10; } },

  // --- Ficha del socio ---------------------------------------------------
  //
  // Sin XP, a proposito: completar tu ficha no es un merito que deba competir
  // en el ranking, es algo que la organizacion necesita de todos. El incentivo
  // aca es la insignia y, sobre todo, que el socio DESCUBRA que le falta un
  // dato — la mayoria de los que reclaman que no les llega el comprobante de un
  // tramite simplemente nunca registraron su correo.
  //
  // Se registra unicamente QUE el dato existe, nunca su contenido.
  { codigo: "FICHA_CORREO",   nombre: "Localizable",     icono: "📧", pista: "Registra tu correo en Mis Datos para recibir los comprobantes de tus trámites.",
    descripcion: "Tu correo quedó registrado. Desde ahora vas a recibir el comprobante de cada trámite que hagas.",
    condicion: function(e) { return !!e.fichaCorreo; } },
  { codigo: "FICHA_CONTACTO", nombre: "En contacto",     icono: "📱", pista: "Registra tu teléfono de contacto en Mis Datos.",
    descripcion: "Tu teléfono está al día. Es la vía más rápida cuando hay algo urgente que avisarte.",
    condicion: function(e) { return !!e.fichaContacto; } },
  { codigo: "FICHA_BANCO",    nombre: "Cuenta al día",   icono: "🏦", pista: "Registra tus datos bancarios en Mis Datos.",
    descripcion: "Tus datos bancarios están completos. Es lo que permite que cualquier pago te llegue sin trámites de por medio.",
    condicion: function(e) { return !!e.fichaBanco; } },
  { codigo: "FICHA_TALLAS",   nombre: "A tu medida",     icono: "👕", pista: "Registra tus tallas de vestuario en Mis Datos.",
    descripcion: "Registraste tus tallas. El vestuario que te corresponde va a llegarte en la talla correcta.",
    condicion: function(e) { return !!e.fichaTallas; } },
  // Se nombra el beneficio con todas sus letras. "Designación de beneficiarios"
  // a secas no le dice nada a quien no conoce el trámite, y es justamente el
  // socio que todavía no lo ha hecho el que necesita entenderlo.
  { codigo: "FICHA_BENEF",    nombre: "Previsor",        icono: "🕊️", pista: "Sube tu designación de beneficiarios del Beneficio por Fallecimiento en Mis Datos.",
    descripcion: "Subiste tu designación de beneficiarios para el Beneficio por Fallecimiento, que corresponde a la cláusula DÉCIMO NOVENO del contrato colectivo. Es de las cosas menos agradables de hacer y de las más importantes: deja por escrito quiénes reciben ese beneficio si tú faltas, para que tu familia no tenga que resolverlo en el peor momento.",
    condicion: function(e) { return !!e.fichaBeneficiarios; } },
  { codigo: "FICHA_COMPLETA", nombre: "Ficha completa",  icono: "✅", pista: "Completa todos los datos de tu ficha de socio.",
    descripcion: "Tu ficha de socio no tiene ningún dato pendiente. Suena menor, pero es lo que hace que todo lo demás funcione.",
    condicion: function(e) { return e.fichaCorreo && e.fichaContacto && e.fichaBanco && e.fichaTallas && e.fichaBeneficiarios; } },

  // --- Escenarios --------------------------------------------------------
  //
  // Aca es donde entran los tramites que NO se premian como evento: preastamos,
  // permisos medicos, denuncias, justificaciones y apelaciones. Lo que se
  // reconoce es saber usarlos, practicado en un simulacro — no haberlos
  // necesitado.
  { codigo: "ESC_PRIMERO", nombre: "Primer simulacro", icono: "🧭", pista: "Completa tu primer escenario de práctica.",
    descripcion: "Completaste tu primer escenario. Practicaste un trámite entero sin arriesgar nada.",
    condicion: function(e) { return e.escenarios >= 1; } },
  { codigo: "ESC_CINCO",   nombre: "Con oficio",       icono: "🛠️", pista: "Aprueba 5 escenarios distintos.",
    descripcion: "Cinco escenarios aprobados. Ya sabes moverte en los trámites que a muchos les cuestan.",
    condicion: function(e) { return e.escenarios >= 5; } },
  { codigo: "ESC_TODOS",   nombre: "Sabe el camino",   icono: "🗺️", pista: "Aprueba todos los escenarios disponibles.",
    descripcion: "Aprobaste todos los escenarios disponibles. Si un compañero no sabe cómo hacer una gestión, ya puedes explicársela tú.",
    condicion: function(e) { return e.escenariosTotal > 0 && e.escenarios >= e.escenariosTotal; } }
];

// ==========================================
// GRADOS — HELPERS
// ==========================================

function calcularGrado_(xp) {
  for (var i = GRADOS_SLIM.length - 1; i >= 0; i--) {
    if (xp >= GRADOS_SLIM[i].minXP) return GRADOS_SLIM[i];
  }
  return GRADOS_SLIM[0];
}

/**
 * Posicion de un grado en la escalera, o -1 si el nombre no existe.
 *
 * Sirve para distinguir un ascenso de un descenso: comparar los nombres con
 * `!==` solo dice que cambiaron, y hay filas con el GRADO desalineado del
 * XP_TOTAL que al recalcularse BAJAN de grado.
 */
function _indiceGrado_(nombre) {
  for (var i = 0; i < GRADOS_SLIM.length; i++) {
    if (GRADOS_SLIM[i].nombre === String(nombre || '').trim()) return i;
  }
  return -1;
}

/** El grado siguiente, o null si ya es el maximo. */
function _gradoSiguiente_(xp) {
  for (var i = 0; i < GRADOS_SLIM.length; i++) {
    if (GRADOS_SLIM[i].minXP > xp) return GRADOS_SLIM[i];
  }
  return null;
}

/**
 * La escalera completa para el frontend: cada grado con su rango ya calculado.
 * maxXP se deriva del minXP del siguiente en vez de guardarse, para que no
 * puedan quedar desalineados.
 */
function _escaleraGrados_() {
  return GRADOS_SLIM.map(function(g, i) {
    var sig = GRADOS_SLIM[i + 1] || null;
    return {
      nombre: g.nombre, minXP: g.minXP, maxXP: sig ? sig.minXP - 1 : null,
      icono: g.icono, headerBg: g.headerBg, color: g.color,
      badgeBg: g.badgeBg, badgeText: g.badgeText, quote: g.quote, msg: g.msg,
      nivel: (i + 1) + ' de ' + GRADOS_SLIM.length,
      siguienteNombre: sig ? sig.nombre : null,
      siguienteIcono:  sig ? sig.icono  : null,
      siguienteXP:     sig ? sig.minXP  : null
    };
  });
}

/** XP maximo alcanzable en un quiz diario para ese grado. */
function _xpMaximoDiario_(nombreGrado) {
  var pesos = PESOS_QUIZ_POR_GRADO[nombreGrado] || PESOS_QUIZ_POR_GRADO["Aspirante"];
  return pesos.BASICO     * XP_POR_NIVEL_QUEST.BASICO
       + pesos.INTERMEDIO * XP_POR_NIVEL_QUEST.INTERMEDIO
       + pesos.AVANZADO   * XP_POR_NIVEL_QUEST.AVANZADO;
}

// ==========================================
// FECHAS
// ==========================================

function _hoyQuest_()   { return Utilities.formatDate(new Date(), CFG_QUEST.ZONA_HORARIA, "dd/MM/yyyy"); }
function _ahoraQuest_() { return Utilities.formatDate(new Date(), CFG_QUEST.ZONA_HORARIA, "dd/MM/yyyy HH:mm"); }
function _mesQuest_()   { return Utilities.formatDate(new Date(), CFG_QUEST.ZONA_HORARIA, "yyyy-MM"); }

function _ayerQuest_() {
  var d = new Date();
  d.setDate(d.getDate() - 1);
  return Utilities.formatDate(d, CFG_QUEST.ZONA_HORARIA, "dd/MM/yyyy");
}

// ==========================================
// ACCESO A LAS HOJAS
// ==========================================

/**
 * Ubica la fila del socio en BD_GAMIFICACION con TextFinder en vez de recorrer
 * la hoja entera. Con ~3.100 filas, leer todo el rango solo para encontrar un
 * RUT era la operacion mas cara del modulo y se hacia en cada carga de vista.
 *
 * Devuelve { fila, valores } o null. `fila` es 1-based (la del Sheet).
 */
function _filaSocioQuest_(sheet, rutLimpio) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;

  var COL = CONFIG.COLUMNAS.GAMIFICACION;
  var match = sheet.getRange(2, COL.RUT + 1, lastRow - 1, 1)
    .createTextFinder(rutLimpio)
    .matchEntireCell(true)
    .findNext();
  if (!match) return null;

  var fila = match.getRow();
  // Se leen TODAS las columnas del bloque, no las primeras N: leer de menos ya
  // costo dos bugs silenciosos (guardarXP no alcanzaba ESTADO y no veia a los
  // desvinculados; getProgresoSocio no alcanzaba QUIZZES_PERFECTOS).
  var ancho = COL.QUIZZES_PERFECTOS + 1;
  return { fila: fila, valores: sheet.getRange(fila, 1, 1, ancho).getDisplayValues()[0] };
}

/**
 * La pestana auxiliar QUEST_ESTADO. Guarda lo que la tabla original no tiene
 * columnas para guardar: historial de preguntas vistas y falladas
 * (anti-repeticion), XP del mes (ranking mensual) y contadores de practica y
 * de nivel secreto.
 *
 * Se crea y se repara sola — se resolvio asi, y no con columnas nuevas en
 * BD_GAMIFICACION, para no depender de un _configurar*() corrido a mano en
 * cada entorno: hasta que ese paso ocurre, CONFIG.COLUMNAS.X queda undefined y
 * los datos se pierden en silencio.
 *
 * Es estado DERIVADO y sacrificable: si se pierde, el socio vuelve a poder
 * recibir preguntas que ya vio y su ranking mensual parte de cero. Nada mas.
 */
var _ENCABEZADOS_QUEST_ESTADO = [
  'RUT', 'IDS_VISTOS', 'IDS_FALLADOS', 'MES', 'XP_MES',
  'QUIZZES_MES', 'SECRETO_ULTIMO_DIA', 'PRACTICAS', 'SECRETOS',
  // Participación sindical — las escribe `Modulo questParticipacion.js`.
  // PART_MESES es la lista de meses ya aplicados a este socio: mientras un mes
  // figure ahí no se vuelve a contar ni a pagar, así que reprocesar es
  // inofensivo. Es la única defensa real contra otorgar XP dos veces, porque el
  // XP entregado no se quita.
  'PART_MESES', 'PART_ASISTIDAS', 'PART_JUSTIFICADAS',
  'PART_RACHA', 'PART_RACHA_MAX', 'PART_ANIO', 'PART_ANIO_OK', 'PART_ANIO_ASISTIDAS', 'PART_XP',
  // Escenarios completados (ids separados por coma). Que sea una lista y no un
  // contador es lo que permite pagar el XP solo la primera vez que se completa
  // cada uno, y saber cuales le faltan.
  'ESC_COMPLETADOS',
  // Logros cuya tarjeta el socio ya abrio. No dispara nada por si solo: sirve
  // para marcar con un punto las insignias que todavia no ha mirado, que es lo
  // que hace descubrible un logro otorgado por el lote mensual mientras no
  // estaba conectado.
  'LOGROS_CELEBRADOS',
  // Preguntas de la Escuela de Formacion Dirigencial que el socio ya respondio
  // bien al menos una vez (ids separados por coma). No se vacia nunca: es su
  // avance en la escuela, no una lista de repaso.
  'DIR_DOMINADAS',
  // Ultimos dias en que el socio jugo el quiz diario (dd/MM/yyyy, separados
  // por coma, maximo DIAS_JUGADOS_MAX_QUEST). RACHA_ACTUAL y QUIZ_ULTIMO_DIA
  // solo dicen cuantos dias seguidos lleva y cual fue el ultimo: con eso, al
  // cortarse la racha, la semana del panel borraba tambien los dias que si
  // jugo. Con esta lista esos dias se muestran como jugados (llama apagada).
  'DIAS_JUGADOS',
  'ACTUALIZADO'
];

function _hojaEstadoQuest_() {
  var ss = getSpreadsheet('GAMIFICACION');
  if (!ss) return null;

  var hoja = ss.getSheetByName(CFG_QUEST.HOJA_ESTADO);
  if (!hoja) {
    hoja = ss.insertSheet(CFG_QUEST.HOJA_ESTADO);
    hoja.appendRow(_ENCABEZADOS_QUEST_ESTADO);
    hoja.getRange(1, 1, 1, _ENCABEZADOS_QUEST_ESTADO.length).setFontWeight('bold');
    hoja.setFrozenRows(1);
    Logger.log('✅ Hoja ' + CFG_QUEST.HOJA_ESTADO + ' creada.');
    return hoja;
  }

  // Reparacion por NOMBRE de encabezado, no por posicion: una columna agregada
  // a mano en el medio no debe desalinear la lectura.
  var anchoActual = Math.max(hoja.getLastColumn(), 1);
  var cabecera = hoja.getRange(1, 1, 1, anchoActual).getDisplayValues()[0];
  var faltantes = _ENCABEZADOS_QUEST_ESTADO.filter(function(h) { return cabecera.indexOf(h) === -1; });
  if (faltantes.length > 0) {
    hoja.getRange(1, anchoActual + 1, 1, faltantes.length).setValues([faltantes]).setFontWeight('bold');
    Logger.log('✅ ' + CFG_QUEST.HOJA_ESTADO + ' reparada, columnas agregadas: ' + faltantes.join(', '));
  }
  return hoja;
}

/** Indices 0-based de QUEST_ESTADO, resueltos por nombre de encabezado. */
function _indicesEstadoQuest_(hoja) {
  var cabecera = hoja.getRange(1, 1, 1, Math.max(hoja.getLastColumn(), 1)).getDisplayValues()[0];
  var idx = {};
  _ENCABEZADOS_QUEST_ESTADO.forEach(function(h) { idx[h] = cabecera.indexOf(h); });
  return idx;
}

/**
 * Lee el estado auxiliar de un socio. Nunca lanza y nunca devuelve null: si la
 * hoja no existe o la fila no esta, entrega un estado vacio valido. El quiz
 * tiene que poder jugarse aunque esta pestana falle — es una mejora, no un
 * requisito.
 */
function _leerEstadoQuest_(rutLimpio) {
  var vacio = {
    fila: -1, vistos: [], fallados: [], mes: '', xpMes: 0, quizzesMes: 0,
    secretoUltimoDia: '', practicas: 0, secretos: 0,
    partMeses: [], partAsistidas: 0, partJustificadas: 0,
    partRacha: 0, partRachaMax: 0, partAnio: '', partAnioOk: 0, partAnioAsistidas: 0, partXp: 0,
    escCompletados: [], logrosCelebrados: [], dominadas: [], diasJugados: []
  };
  try {
    var hoja = _hojaEstadoQuest_();
    if (!hoja) return vacio;

    var idx = _indicesEstadoQuest_(hoja);
    var lastRow = hoja.getLastRow();
    if (lastRow < 2 || idx.RUT < 0) return vacio;

    var match = hoja.getRange(2, idx.RUT + 1, lastRow - 1, 1)
      .createTextFinder(rutLimpio).matchEntireCell(true).findNext();
    if (!match) return vacio;

    var fila = match.getRow();
    var v = hoja.getRange(fila, 1, 1, Math.max(hoja.getLastColumn(), 1)).getDisplayValues()[0];
    var leerLista = function(i) {
      if (i < 0) return [];
      return String(v[i] || '').split(',').map(function(s) { return s.trim(); }).filter(function(s) { return s !== ''; });
    };
    var leerNum = function(i) { return i < 0 ? 0 : (parseInt(v[i], 10) || 0); };

    return {
      fila:             fila,
      vistos:           leerLista(idx.IDS_VISTOS),
      fallados:         leerLista(idx.IDS_FALLADOS),
      mes:              idx.MES < 0 ? '' : String(v[idx.MES] || ''),
      xpMes:            leerNum(idx.XP_MES),
      quizzesMes:       leerNum(idx.QUIZZES_MES),
      secretoUltimoDia: idx.SECRETO_ULTIMO_DIA < 0 ? '' : String(v[idx.SECRETO_ULTIMO_DIA] || '').trim(),
      practicas:        leerNum(idx.PRACTICAS),
      secretos:         leerNum(idx.SECRETOS),
      partMeses:         leerLista(idx.PART_MESES),
      partAsistidas:     leerNum(idx.PART_ASISTIDAS),
      partJustificadas:  leerNum(idx.PART_JUSTIFICADAS),
      partRacha:         leerNum(idx.PART_RACHA),
      partRachaMax:      leerNum(idx.PART_RACHA_MAX),
      partAnio:          idx.PART_ANIO < 0 ? '' : String(v[idx.PART_ANIO] || '').trim(),
      partAnioOk:        leerNum(idx.PART_ANIO_OK),
      partAnioAsistidas: leerNum(idx.PART_ANIO_ASISTIDAS),
      partXp:            leerNum(idx.PART_XP),
      escCompletados:    leerLista(idx.ESC_COMPLETADOS),
      logrosCelebrados:  leerLista(idx.LOGROS_CELEBRADOS),
      dominadas:         leerLista(idx.DIR_DOMINADAS),
      diasJugados:       leerLista(idx.DIAS_JUGADOS)
    };
  } catch (e) {
    Logger.log('⚠️ _leerEstadoQuest_ (no bloqueante): ' + e.toString());
    return vacio;
  }
}

/** Escribe el estado auxiliar. Nunca lanza: el quiz ya se registro cuando esto corre. */
function _guardarEstadoQuest_(rutLimpio, estado) {
  try {
    var hoja = _hojaEstadoQuest_();
    if (!hoja) return;

    var idx  = _indicesEstadoQuest_(hoja);
    var ancho = Math.max(hoja.getLastColumn(), _ENCABEZADOS_QUEST_ESTADO.length);
    var fila  = new Array(ancho).fill('');

    var poner = function(clave, valor) { if (idx[clave] >= 0) fila[idx[clave]] = valor; };
    poner('RUT',                rutLimpio);
    poner('IDS_VISTOS',         estado.vistos.join(','));
    poner('IDS_FALLADOS',       estado.fallados.join(','));
    poner('MES',                estado.mes);
    poner('XP_MES',             estado.xpMes);
    poner('QUIZZES_MES',        estado.quizzesMes);
    poner('SECRETO_ULTIMO_DIA', estado.secretoUltimoDia);
    poner('PRACTICAS',          estado.practicas);
    poner('SECRETOS',           estado.secretos);
    poner('PART_MESES',           (estado.partMeses || []).join(','));
    poner('PART_ASISTIDAS',       estado.partAsistidas     || 0);
    poner('PART_JUSTIFICADAS',    estado.partJustificadas  || 0);
    poner('PART_RACHA',           estado.partRacha         || 0);
    poner('PART_RACHA_MAX',       estado.partRachaMax      || 0);
    poner('PART_ANIO',            estado.partAnio          || '');
    poner('PART_ANIO_OK',         estado.partAnioOk        || 0);
    poner('PART_ANIO_ASISTIDAS',  estado.partAnioAsistidas || 0);
    poner('PART_XP',              estado.partXp            || 0);
    poner('ESC_COMPLETADOS',      (estado.escCompletados || []).join(','));
    poner('LOGROS_CELEBRADOS',    (estado.logrosCelebrados || []).join(','));
    poner('DIR_DOMINADAS',        (estado.dominadas || []).join(','));
    poner('DIAS_JUGADOS',         (estado.diasJugados || []).join(','));
    poner('ACTUALIZADO',        _ahoraQuest_());

    if (estado.fila && estado.fila > 1) hoja.getRange(estado.fila, 1, 1, ancho).setValues([fila]);
    else                                hoja.appendRow(fila);
  } catch (e) {
    Logger.log('⚠️ _guardarEstadoQuest_ (no bloqueante): ' + e.toString());
  }
}

// ==========================================
// IDENTIDAD — QUIEN ESTA PREGUNTANDO
// ==========================================

/**
 * Resuelve el RUT a partir del token de sesion. Ninguna funcion publica de
 * este modulo acepta un RUT del cliente: con `google.script.run` cualquiera
 * puede llamar desde la consola con el RUT de otro socio y, antes de este
 * cambio, leer su progreso o sumarle XP.
 *
 * Devuelve '' cuando la sesion expiro o nunca existio.
 */
function _rutDeSesionQuest_(sessionToken) {
  try {
    return obtenerRutDeSesion(sessionToken) || '';
  } catch (e) {
    Logger.log('⚠️ _rutDeSesionQuest_: ' + e.toString());
    return '';
  }
}

var MSG_SESION_QUEST = 'Tu sesión expiró. Vuelve a ingresar para continuar.';

// ==========================================
// BANCO DE PREGUNTAS
// ==========================================

/**
 * Lee el banco completo y devuelve solo las preguntas activas, ya mapeadas.
 *
 * No se cachea a proposito: son ~200 filas (una sola lectura de rango) y el
 * ADMIN edita la hoja en vivo. Una cache aqui significaria que una pregunta
 * corregida sigue saliendo mal por varios minutos, que es justo lo que no se
 * quiere de un modulo educativo.
 */
function _leerBancoQuest_() {
  var sheet = getSheet('GAMIFICACION', 'BANCO_PREGUNTAS');
  if (!sheet) return [];

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  var COL  = CONFIG.COLUMNAS.BANCO_PREGUNTAS;
  var data = sheet.getRange(2, 1, lastRow - 1, COL.FUENTE + 1).getDisplayValues();
  var out  = [];

  for (var i = 0; i < data.length; i++) {
    var activa = String(data[i][COL.ACTIVA] || '').toUpperCase().trim();
    if (activa !== 'TRUE' && activa !== 'VERDADERO' && activa !== '1' && activa !== 'SI' && activa !== 'SÍ') continue;

    var enunciado = String(data[i][COL.PREGUNTA] || '').trim();
    var correcta  = String(data[i][COL.RESPUESTA] || '').toUpperCase().trim();
    if (!enunciado || ['A', 'B', 'C', 'D'].indexOf(correcta) === -1) continue;  // fila incompleta: se salta

    var nivel = String(data[i][COL.NIVEL] || 'BASICO').toUpperCase().trim();
    // Un ID vacio haria colapsar todo el anti-repeticion en una sola clave.
    // La fila es un identificador estable mientras nadie reordene la hoja.
    var id = String(data[i][COL.ID] || '').trim() || ('F' + (i + 2));
    var xp = parseInt(data[i][COL.XP], 10);
    if (!(xp > 0)) xp = XP_POR_NIVEL_QUEST[nivel] || XP_POR_NIVEL_QUEST.BASICO;

    out.push({
      id: id,
      categoria:   String(data[i][COL.CATEGORIA] || 'GENERAL').toUpperCase().trim(),
      nivel:       nivel,
      pregunta:    enunciado,
      opciones:    { A: data[i][COL.OPCION_A], B: data[i][COL.OPCION_B], C: data[i][COL.OPCION_C], D: data[i][COL.OPCION_D] },
      respuesta:   correcta,
      explicacion: String(data[i][COL.EXPLICACION] || ''),
      fuente:      String(data[i][COL.FUENTE] || ''),
      xp:          xp
    });
  }
  return out;
}

/**
 * Reordena las alternativas de una pregunta y recalcula cual es la correcta.
 *
 * NO es un adorno. El banco cargado a mano tiene la respuesta correcta en la
 * letra B en 177 de sus 190 preguntas (93%), en la C en 10 y en la A en 3;
 * ninguna en la D. Servidas tal cual, un socio que marcara siempre "B" sacaba
 * 93% sin leer una sola pregunta, y el ranking medía eso. Barajar en el
 * servidor lo corrige de raiz sin tocar la planilla, y de paso hace que una
 * pregunta repetida nunca vuelva con el mismo orden: se memoriza el contenido,
 * no la posicion.
 *
 * La permutacion se guarda en el quiz en curso, asi que la correccion y el
 * repaso posterior hablan siempre del orden que el socio efectivamente vio.
 */
function _barajarOpcionesQuest_(p) {
  var letras   = ['A', 'B', 'C', 'D'];
  var conTexto = letras.filter(function(l) { return String(p.opciones[l] || '').trim() !== ''; });
  var orden    = _barajarQuest_(conTexto.slice());

  var opciones = { A: '', B: '', C: '', D: '' };
  var respuestaNueva = p.respuesta;
  orden.forEach(function(letraOriginal, i) {
    opciones[letras[i]] = p.opciones[letraOriginal];
    if (letraOriginal === p.respuesta) respuestaNueva = letras[i];
  });

  return {
    id: p.id, nivel: p.nivel, categoria: p.categoria, pregunta: p.pregunta,
    opciones: opciones, respuesta: respuestaNueva,
    explicacion: p.explicacion, fuente: p.fuente, xp: p.xp
  };
}

/** Baraja in-place (Fisher-Yates) y devuelve el mismo array. */
function _barajarQuest_(arr) {
  for (var i = arr.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
}

/**
 * Reparte un grupo de preguntas en TRAMOS de prioridad pedagogica, barajados
 * por dentro para que el orden no sea predecible.
 *
 * DIARIO:    no vistas  ->  falladas  ->  ya vistas y acertadas
 * PRACTICA:  falladas   ->  no vistas ->  el resto
 * SECRETO:   no dominadas (aun no respondidas bien)  ->  dominadas
 *            Es la clase de la Escuela de Formacion Dirigencial: lo que
 *            importa es completar las ramas, asi que sale primero lo que falta.
 *
 * La practica invierte los dos primeros a proposito: ahi el socio esta
 * estudiando, y lo que le sirve es volver sobre lo que fallo, no descubrir
 * material nuevo.
 *
 * Devuelve tramos SEPARADOS y no una sola lista concatenada. La diferencia
 * importa: el tope por categoria hace que la seleccion se salte candidatos, y
 * sobre una lista unica ese salto la hacia caer en el tramo siguiente — un
 * socio recibia preguntas ya vistas teniendo 17 sin ver disponibles. Con los
 * tramos separados, uno no se toca hasta agotar el anterior.
 */
function _priorizarPreguntasQuest_(lista, setVisto, setFallo, modo, setDominada) {
  if (modo === MODOS_QUIZ.SECRETO && setDominada) {
    var pendientes = [], dominadas = [];
    lista.forEach(function(p) { (setDominada[p.id] ? dominadas : pendientes).push(p); });
    _barajarQuest_(pendientes); _barajarQuest_(dominadas);
    return [pendientes, dominadas];
  }

  var nuevas = [], falladas = [], repasadas = [];
  lista.forEach(function(p) {
    if (setFallo[p.id])       falladas.push(p);
    else if (!setVisto[p.id]) nuevas.push(p);
    else                      repasadas.push(p);
  });

  _barajarQuest_(nuevas); _barajarQuest_(falladas); _barajarQuest_(repasadas);

  return (modo === MODOS_QUIZ.PRACTICA)
    ? [falladas, nuevas, repasadas]
    : [nuevas, falladas, repasadas];
}

/**
 * Arma las preguntas de un quiz.
 *
 * Reglas:
 *  - DIARIO  : mezcla por nivel segun el grado del socio (PESOS_QUIZ_POR_GRADO),
 *              excluyendo el nivel DIRIGENTE, que es exclusivo del Nivel Secreto.
 *  - SECRETO : solo nivel DIRIGENTE.
 *  - PRACTICA: mismos niveles que el diario, pero sin cuotas — lo que importa
 *              es repasar, no medir.
 *
 * Si un nivel no alcanza a llenar su cuota, el faltante se completa con los
 * otros niveles respetando la misma prioridad. Antes el relleno ignoraba el
 * anti-repeticion y podia devolver una pregunta recien vista.
 */
function _seleccionarPreguntasQuest_(banco, nombreGrado, estado, modo, cantidad) {
  var elegibles = banco.filter(function(p) {
    return (modo === MODOS_QUIZ.SECRETO) ? p.nivel === 'DIRIGENTE' : p.nivel !== 'DIRIGENTE';
  });
  if (elegibles.length === 0) return { preguntas: [], reciclado: false, agotado: true };

  var setVisto = {}; (estado.vistos   || []).forEach(function(id) { setVisto[id] = true; });
  var setFallo = {}; (estado.fallados || []).forEach(function(id) { setFallo[id] = true; });
  var setDominada = {}; (estado.dominadas || []).forEach(function(id) { setDominada[id] = true; });
  var reciclado = false;

  /**
   * Reinicia el historial de vistas de UN grupo cuando ya no quedan preguntas
   * nuevas suficientes para llenar su cuota.
   *
   * El reciclaje se mide por grupo y no sobre el banco entero porque el
   * agotamiento ocurre por nivel: BASICO tiene 97 preguntas y un Aspirante
   * consume 4 al dia, asi que se le acaba al dia 24 — mucho antes de que el
   * banco completo (174 preguntas fuera del Nivel Secreto) llegue a ningun
   * umbral global. Medido globalmente, el reciclaje no se disparaba nunca y el
   * socio empezaba a ver repeticiones sin que el sistema lo registrara.
   *
   * Las falladas no se tocan: son justamente lo que conviene seguir repasando.
   */
  var reciclarGrupo = function(lista, necesita) {
    if (necesita <= 0) return;
    var nuevas = 0;
    for (var i = 0; i < lista.length; i++) { if (!setVisto[lista[i].id]) nuevas++; }
    if (nuevas >= necesita) return;
    lista.forEach(function(p) { delete setVisto[p.id]; });
    reciclado = true;
  };

  var seleccion    = [];
  var usados       = {};
  var porCategoria = {};

  // Tope blando de preguntas por categoria dentro de un mismo quiz. DERECHOS
  // concentra 102 de las 190 preguntas del banco, asi que sin esto un quiz de
  // cinco salia entero de esa categoria con frecuencia y el socio no volvia a
  // ver protocolo, contrato ni negociacion en dias.
  var MAX_POR_CATEGORIA = 2;

  // Toma de UN tramo: dos pasadas, la primera respetando el tope de categoria
  // y la segunda ignorandolo, para que una cuota no quede corta solo porque el
  // banco no da para mas variedad (el Nivel Secreto, por ejemplo, es todo
  // ECONOMIA). Ambas pasadas quedan dentro del mismo tramo, de modo que el
  // tope nunca puede empujar la seleccion hacia preguntas de menor prioridad.
  var tomarDeTramo = function(tramo, n) {
    for (var pasada = 0; pasada < 2 && n > 0; pasada++) {
      for (var i = 0; i < tramo.length && n > 0; i++) {
        var p = tramo[i];
        if (usados[p.id]) continue;
        if (pasada === 0 && (porCategoria[p.categoria] || 0) >= MAX_POR_CATEGORIA) continue;
        usados[p.id] = true;
        porCategoria[p.categoria] = (porCategoria[p.categoria] || 0) + 1;
        seleccion.push(p);
        n--;
      }
    }
    return n;
  };

  /** Recorre los tramos en orden y no pasa al siguiente hasta agotar el actual. */
  var tomar = function(tramos, n) {
    for (var t = 0; t < tramos.length && n > 0; t++) n = tomarDeTramo(tramos[t], n);
    return n;  // cuanto quedo sin llenar
  };

  if (modo === MODOS_QUIZ.DIARIO) {
    var pesos = PESOS_QUIZ_POR_GRADO[nombreGrado] || PESOS_QUIZ_POR_GRADO['Aspirante'];
    ['BASICO', 'INTERMEDIO', 'AVANZADO'].forEach(function(nivel) {
      var delNivel = elegibles.filter(function(p) { return p.nivel === nivel; });
      reciclarGrupo(delNivel, pesos[nivel] || 0);
      tomar(_priorizarPreguntasQuest_(delNivel, setVisto, setFallo, modo), pesos[nivel] || 0);
    });
  }

  // Relleno: cubre tanto las cuotas que quedaron cortas como los modos que no
  // usan cuotas (PRACTICA y SECRETO).
  if (seleccion.length < cantidad) {
    reciclarGrupo(elegibles, cantidad - seleccion.length);
    tomar(_priorizarPreguntasQuest_(elegibles, setVisto, setFallo, modo, setDominada), cantidad - seleccion.length);
  }

  _barajarQuest_(seleccion);
  return {
    preguntas: seleccion.slice(0, cantidad),
    reciclado: reciclado,
    // El historial ya depurado. Se devuelve para que `questFinalizar` lo
    // persista: si el reciclaje viviera solo en memoria, la hoja seguiria
    // diciendo que el socio vio todo el nivel y el reinicio se repetiria cada
    // dia sin quedar nunca registrado.
    vistos: Object.keys(setVisto),
    agotado: seleccion.length === 0
  };
}

// ==========================================
// ESCUELA DE FORMACION DIRIGENCIAL — AVANCE Y TEXTOS
// ==========================================

/** Rama de la escuela a la que pertenece una categoria del banco. */
function _ramaEscuela_(categoria) {
  var c = String(categoria || '').toUpperCase().trim();
  for (var i = 0; i < ESCUELA_DIRIGENCIAL.ramas.length; i++) {
    if (ESCUELA_DIRIGENCIAL.ramas[i].categorias.indexOf(c) !== -1) return ESCUELA_DIRIGENCIAL.ramas[i].codigo;
  }
  return '';
}

/**
 * Avance del socio en la escuela, calculado contra el banco VIGENTE.
 *
 * Una rama cuenta como cumplida si hoy esta completa O si el socio ya tiene su
 * insignia: si el banco crece, la rama vuelve a mostrar lo que falta, pero lo
 * ganado no se pierde ni bloquea la graduacion.
 *
 * @param {Array}  banco          resultado de _leerBancoQuest_()
 * @param {Array}  dominadas      ids ya respondidos bien en la clase
 * @param {Array}  logrosCodigos  codigos de logros ya obtenidos
 */
function _progresoEscuela_(banco, dominadas, logrosCodigos) {
  var setDom  = {}; (dominadas || []).forEach(function(id) { setDom[id] = true; });
  var ganados = {}; (logrosCodigos || []).forEach(function(c) { ganados[c] = true; });

  var porCodigo = {};
  var ramas = ESCUELA_DIRIGENCIAL.ramas.map(function(def) {
    var r = { def: def, total: 0, dominadas: 0 };
    porCodigo[def.codigo] = r;
    return r;
  });

  var sinRama = {};
  (banco || []).forEach(function(p) {
    if (p.nivel !== 'DIRIGENTE') return;
    var cod = _ramaEscuela_(p.categoria);
    if (!cod) { sinRama[p.categoria] = true; cod = ESCUELA_DIRIGENCIAL.ramaPorDefecto; }
    var r = porCodigo[cod];
    r.total++;
    if (setDom[p.id]) r.dominadas++;
  });
  var huerfanas = Object.keys(sinRama);
  if (huerfanas.length) {
    Logger.log('⚠️ Escuela: categorías de nivel DIRIGENTE sin rama asignada (se cuentan en ' +
               ESCUELA_DIRIGENCIAL.ramaPorDefecto + '): ' + huerfanas.join(', '));
  }

  var total = 0, dom = 0, cumplidas = {};
  ramas.forEach(function(r) {
    r.completa = r.total > 0 && r.dominadas >= r.total;
    r.insignia = !!ganados[r.def.logro];
    cumplidas[r.def.codigo] = r.completa || r.insignia;
    total += r.total;
    dom   += r.dominadas;
  });

  return {
    ramas: ramas, total: total, dominadas: dom, cumplidas: cumplidas,
    graduado: !!ganados[ESCUELA_DIRIGENCIAL.logroGraduacion]
  };
}

/**
 * Todo lo que la pagina necesita para dibujar la escuela: numeros Y textos.
 * El cliente no tiene escrita ninguna palabra de la escuela; la recibe aqui, y
 * esto viaja solo al grado Dirigente (dentro de `reservado`).
 */
function _payloadEscuela_(prog, claseDisponible) {
  var ptsMax    = CFG_QUEST.PREGUNTAS_POR_QUIZ * (XP_POR_NIVEL_QUEST.DIRIGENTE || 50);
  var completas = prog.ramas.filter(function(r) { return r.completa || r.insignia; }).length;
  var nRamas    = prog.ramas.length;
  var pct       = prog.total ? Math.round(prog.dominadas / prog.total * 100) : 0;
  var subClase  = CFG_QUEST.PREGUNTAS_POR_QUIZ + ' preguntas · hasta ' + ptsMax + ' pts';

  return {
    eyebrow:  TEXTOS_SECRETO_QUEST.titulo,
    titulo:   ESCUELA_DIRIGENCIAL.titulo,
    pct:      pct,
    anillo:   String(prog.dominadas),
    detalle:  prog.dominadas + ' de ' + prog.total + ' dominadas · ' + completas + ' de ' + nRamas + ' ramas',
    resumen: {
      grande: String(prog.dominadas),
      unidad: 'de ' + prog.total + ' dominadas',
      sub:    (completas === 1 ? '1 rama completa' : (completas + ' ramas completas')) +
              (prog.graduado ? ' · graduado' : '')
    },
    clase: {
      disponible: !!claseDisponible,
      estado:     claseDisponible ? 'Clase de hoy disponible' : 'Clase de hoy completada',
      titulo:     'Clase de hoy',
      sub:        claseDisponible ? subClase : 'Vuelve mañana para la próxima clase'
    },
    seccion: 'Ramas',
    nota:    'La clase diaria saca primero las preguntas que aún no dominas. Una pregunta queda dominada la primera vez que la respondes bien.',
    ramas: prog.ramas.map(function(r) {
      var cumplida = r.completa || r.insignia;
      return {
        nombre: r.def.nombre, corto: r.def.corto, descripcion: r.def.descripcion,
        icono: r.def.icono, emoji: r.def.emoji, c1: r.def.c1, bg: r.def.bg, tx: r.def.tx,
        logro: r.def.logro,
        pct: r.total ? Math.round(r.dominadas / r.total * 100) : 0,
        completa: r.completa, insignia: r.insignia,
        avance: r.dominadas + ' de ' + r.total + ' dominadas',
        falta:  r.completa ? '✓ Completa' : ('Faltan ' + (r.total - r.dominadas) + (cumplida ? ' · insignia ganada' : ''))
      };
    }),
    cierre: {
      titulo:   'Graduación',
      texto:    prog.graduado
        ? 'Te graduaste de la escuela. Toca para ver tu insignia.'
        : 'Completa las tres ramas para recibir el diploma de la escuela.',
      obtenida: prog.graduado,
      logro:    ESCUELA_DIRIGENCIAL.logroGraduacion
    }
  };
}

/** Aviso del resumen tras una clase: cuanto avanzo. Texto del servidor, por lo mismo. */
function _avisoClaseEscuela_(nuevas, prog) {
  var cab = nuevas > 0
    ? ('Dominaste ' + nuevas + (nuevas === 1 ? ' pregunta nueva' : ' preguntas nuevas') + ' de la escuela.')
    : 'Esta vez no dominaste preguntas nuevas: las que fallaste volverán primero.';
  return cab + ' Llevas ' + prog.dominadas + ' de ' + prog.total + '.';
}

// ==========================================
// PROGRESO DEL SOCIO
// ==========================================

/**
 * Crea la fila del socio en BD_GAMIFICACION. Los tres argumentos son
 * obligatorios: la version anterior tenia una llamada con solo el RUT que
 * dejaba filas con el nombre en `undefined`.
 */
function _inicializarSocioQuest_(rutLimpio, nombreSocio, estadoSocio) {
  var sheet  = getSheet('GAMIFICACION', 'GAMIFICACION');
  var estado = String(estadoSocio || 'ACTIVO').toUpperCase();
  var nombre = String(nombreSocio || 'Socio').trim();
  sheet.appendRow([rutLimpio, nombre, 0, GRADOS_SLIM[0].nombre, '[]', 0, 0, _ahoraQuest_(), '', 0, estado, 0]);
  Logger.log('✅ Socio inicializado en SLIM Quest: ' + rutLimpio + ' (' + nombre + ') — ' + estado);
  return { fila: sheet.getLastRow(), nombre: nombre, estado: estado };
}

/**
 * La racha que el socio realmente tiene HOY.
 *
 * La hoja guarda el ultimo valor alcanzado, no el vigente: un socio que jugo 12
 * dias seguidos y despues estuvo una semana sin entrar seguia viendo "12 🔥" en
 * su panel, y solo descubria que la habia perdido al terminar el quiz
 * siguiente. Una racha rota se muestra rota.
 */
function _rachaVigenteQuest_(rachaGuardada, quizUltimoDia) {
  var d = String(quizUltimoDia || '').trim();
  if (!d) return 0;
  return (d === _hoyQuest_() || d === _ayerQuest_()) ? rachaGuardada : 0;
}

// ==========================================
// SEMANA DE RACHA (tarjeta del quiz diario)
// ==========================================

var DIAS_JUGADOS_MAX_QUEST = 14;
var NOMBRES_DIA_QUEST = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

/** 'dd/MM/yyyy' -> Date al mediodia (el mediodia esquiva los cambios de hora). */
function _fechaDiaQuest_(texto) {
  var p = String(texto || '').trim().split('/');
  if (p.length !== 3) return null;
  var d = new Date(parseInt(p[2], 10), parseInt(p[1], 10) - 1, parseInt(p[0], 10), 12);
  return isNaN(d.getTime()) ? null : d;
}
function _textoDiaQuest_(fecha) { return Utilities.formatDate(fecha, CFG_QUEST.ZONA_HORARIA, 'dd/MM/yyyy'); }
function _moverDiasQuest_(fecha, n) { var r = new Date(fecha.getTime()); r.setDate(r.getDate() + n); return r; }

/** Agrega hoy a la lista de dias jugados, sin duplicar, y conserva los ultimos. */
function _registrarDiaJugadoQuest_(lista, hoy) {
  var dias = (lista || []).filter(function(f) { return f !== hoy && _fechaDiaQuest_(f); }).concat([hoy]);
  dias.sort(function(a, b) { return _fechaDiaQuest_(a) - _fechaDiaQuest_(b); });
  return dias.slice(-DIAS_JUGADOS_MAX_QUEST);
}

/**
 * La semana (lunes a domingo) que dibuja la tarjeta del quiz, ya resuelta: el
 * navegador solo pinta. Estados por dia:
 *   racha   — jugado y parte de la racha vigente (llama encendida)
 *   apagada — jugado, pero de una racha que ya se corto: lo jugo, no se borra
 *   falta   — no jugo, y se sabe (hay un dia jugado conocido antes)
 *   hoy     — hoy, todavia sin jugar
 *   vacio / futuro — sin informacion o todavia no llega
 *
 * Un dia sin jugar solo se marca como falta si hay un dia jugado CONOCIDO
 * antes que el. DIAS_JUGADOS empezo a guardarse el 29/09/2026: de antes solo
 * se conoce la racha vigente y el ultimo dia, y marcar como falta un dia sobre
 * el que no hay dato seria acusar al socio de algo que tal vez no paso.
 */
function _semanaQuest_(diasJugados, quizUltimoDia, rachaGuardada, rachaVigente) {
  var hoy = _fechaDiaQuest_(_hoyQuest_());
  var conocidos = {}, enRacha = {};
  (diasJugados || []).forEach(function(f) { if (_fechaDiaQuest_(f)) conocidos[f] = true; });
  var ultimo = _fechaDiaQuest_(quizUltimoDia);
  if (ultimo) conocidos[_textoDiaQuest_(ultimo)] = true;
  if (ultimo && rachaVigente > 0) {
    for (var i = 0; i < rachaVigente; i++) {
      var f = _textoDiaQuest_(_moverDiasQuest_(ultimo, -i));
      enRacha[f] = true;
      conocidos[f] = true;
    }
  }
  var primero = null;
  Object.keys(conocidos).forEach(function(f) {
    var d = _fechaDiaQuest_(f);
    if (!primero || d < primero) primero = d;
  });

  var posHoy = (hoy.getDay() + 6) % 7;   // 0 = lunes
  var lunes  = _moverDiasQuest_(hoy, -posHoy);
  var letras = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
  var dias = [];
  for (var k = 0; k < 7; k++) {
    var dia = _moverDiasQuest_(lunes, k);
    var clave = _textoDiaQuest_(dia);
    var estado;
    if (k > posHoy)               estado = 'futuro';
    else if (k === posHoy)        estado = conocidos[clave] ? 'racha' : 'hoy';
    else if (conocidos[clave])    estado = enRacha[clave] ? 'racha' : 'apagada';
    else                          estado = (primero && dia > primero) ? 'falta' : 'vacio';
    dias.push({ letra: (k === posHoy) ? 'Hoy' : letras[k], estado: estado });
  }

  // Racha recien cortada: se explica solo durante la semana siguiente al corte.
  var cortada = null;
  if (rachaVigente === 0 && rachaGuardada > 0 && ultimo) {
    var corte = _moverDiasQuest_(ultimo, 1);
    var hace  = Math.round((hoy - corte) / 86400000);
    if (hace >= 1 && hace <= 6) {
      cortada = { dias: rachaGuardada, cuando: hace === 1 ? 'ayer' : 'el ' + NOMBRES_DIA_QUEST[corte.getDay()] };
    }
  }
  return { dias: dias, rachaCortada: cortada };
}

/**
 * Arma el resumen que evalua el catalogo de logros, juntando lo que vive en
 * BD_GAMIFICACION (quizzes, rachas) con lo que vive en QUEST_ESTADO (practicas,
 * nivel secreto, participacion sindical).
 *
 * Es un solo constructor a proposito. Antes de existir, cada camino que otorga
 * logros armaba su propio objeto, y bastaba con olvidar un campo para que un
 * logro quedara imposible de obtener por esa via — sin error, sin log, sin
 * nada que lo delatara.
 */
function _resumenLogrosQuest_(datos) {
  return {
    quizzes:          datos.quizzes          || 0,
    perfectos:        datos.perfectos        || 0,
    rachaMax:         datos.rachaMax         || 0,
    practicas:        datos.practicas        || 0,
    secretos:         datos.secretos         || 0,
    partAsistidas:    datos.partAsistidas    || 0,
    partJustificadas: datos.partJustificadas || 0,
    partRachaMax:     datos.partRachaMax     || 0,
    partAnioOk:       datos.partAnioOk       || 0,
    escenarios:       datos.escenarios       || 0,
    escenariosTotal:  datos.escenariosTotal  || 0,
    // Los campos de ficha se omiten cuando quien evalua no los leyo: `false`
    // afirmaria que el dato falta, y `_aplicarLogrosQuest_` nunca quita un
    // logro ya otorgado, asi que la diferencia no hace dano — pero mantenerla
    // explicita evita que alguien lea el resumen como una verdad sobre el socio.
    fichaCorreo:        !!datos.fichaCorreo,
    fichaContacto:      !!datos.fichaContacto,
    fichaBanco:         !!datos.fichaBanco,
    fichaTallas:        !!datos.fichaTallas,
    fichaBeneficiarios: !!datos.fichaBeneficiarios,
    // Ramas de la escuela ya cumplidas ({CONDUCCION: true, ...}). null cuando
    // quien evalua no leyo la escuela: sin el dato, ninguna insignia se otorga,
    // y las ya ganadas no se quitan.
    escuela:            datos.escuela || null
  };
}

/**
 * Que datos tiene completos el socio en su ficha. Devuelve solo banderas: el
 * contenido (su cuenta bancaria, su designacion de beneficiarios) no entra a la
 * tabla de gamificacion ni a la respuesta que viaja al navegador.
 *
 * Lee la fila de USUARIOS directamente en vez de usar `obtenerUsuarioPorRut()`
 * porque necesita tallas y el estado del documento de fallecimiento, que ese
 * helper no expone. Se cachea 10 minutos por RUT — el mismo horizonte que usa
 * `obtenerUsuarioPorRut` — para no releer la hoja en cada carga del panel.
 */
function _fichaSocioQuest_(rutLimpio) {
  var vacio = { fichaCorreo: false, fichaContacto: false, fichaBanco: false, fichaTallas: false, fichaBeneficiarios: false };
  var clave = 'QUEST_FICHA_' + rutLimpio;
  var cache = CacheService.getScriptCache();

  try {
    var guardado = cache.get(clave);
    if (guardado) return JSON.parse(guardado);
  } catch (e) {}

  try {
    var sheet = getSheet('USUARIOS', 'USUARIOS');
    if (!sheet) return vacio;
    var fila = buscarFilaPorRut(sheet, rutLimpio);
    if (fila === -1) return vacio;

    var COL = CONFIG.COLUMNAS.USUARIOS;
    var ancho = Math.max(COL.CALZADO_ESPECIAL, COL.DOC_FALLECIMIENTO_ESTADO || 0) + 1;
    var v = sheet.getRange(fila, 1, 1, ancho).getDisplayValues()[0];

    // 'S/D' es el centinela de "sin dato" con el que se cargo la base a mano:
    // tomarlo por un valor real regalaria la insignia a quien no completo nada.
    var lleno = function(i) {
      if (i === undefined || i < 0) return false;
      var t = String(v[i] || '').trim().toUpperCase();
      return t !== '' && t !== 'S/D' && t !== 'SD' && t !== 'N/A';
    };

    var estadoFall = (COL.DOC_FALLECIMIENTO_ESTADO === undefined)
      ? '' : String(v[COL.DOC_FALLECIMIENTO_ESTADO] || '').trim().toUpperCase();

    var ficha = {
      fichaCorreo:   esCorreoValidoEstricto(String(v[COL.CORREO] || '').trim()),
      fichaContacto: lleno(COL.CONTACTO),
      fichaBanco:    lleno(COL.BANCO) && lleno(COL.TIPO_CUENTA) && lleno(COL.NUMERO_CUENTA),
      fichaTallas:   lleno(COL.TALLA_POLERA) && lleno(COL.TALLA_POLAR) && lleno(COL.TALLA_PANTALON) && lleno(COL.TALLA_CALZADO),
      // Basta con haberlo subido: la insignia reconoce el trámite hecho, no el
      // veredicto del directorio. Un documento rechazado seguiria mostrando la
      // observacion en Mis Datos, que es donde corresponde resolverlo.
      fichaBeneficiarios: (estadoFall === 'EN REVISION' || estadoFall === 'APROBADO')
    };

    try { cache.put(clave, JSON.stringify(ficha), 600); } catch (e) {}
    return ficha;

  } catch (e) {
    Logger.log('⚠️ _fichaSocioQuest_ (no bloqueante): ' + e.toString());
    return vacio;
  }
}

/**
 * Une los logros guardados con el catalogo, para poder mostrar tambien los
 * bloqueados — que es lo que le dice al socio que perseguir.
 *
 * `ctx` decide que logros ocultos ya se pueden revelar. Un logro con
 * `visibleSi` que todavia no se cumple queda fuera de la lista Y del total: si
 * apareciera en el contador ("14 de 32" en vez de "14 de 31"), el socio sabria
 * que hay algo escondido, que es justo lo que se quiere evitar.
 *
 * `nuevo` marca los ganados que el socio todavia no ha abierto. No dispara
 * ninguna ventana: solo permite ponerles un punto en la vitrina para que sepa
 * que hay algo que mirar.
 */
function _componerLogrosQuest_(logrosGuardados, ctx) {
  var porCodigo = {};
  (logrosGuardados || []).forEach(function(l) { if (l && l.codigo) porCodigo[l.codigo] = l; });
  ctx = ctx || {};
  var vistos = {};
  (ctx.celebrados || []).forEach(function(c) { vistos[c] = true; });

  var salida = [];
  CATALOGO_LOGROS_QUEST.forEach(function(def) {
    var g = porCodigo[def.codigo];
    // Lo ya ganado se muestra siempre; lo oculto, solo cuando corresponde.
    if (!g && typeof def.visibleSi === 'function') {
      var visible = false;
      try { visible = !!def.visibleSi(ctx); } catch (e) { visible = false; }
      if (!visible) return;
    }
    salida.push({
      codigo: def.codigo, nombre: def.nombre, icono: def.icono,
      pista: def.pista, descripcion: def.descripcion,
      obtenido: !!g, fecha: g ? (g.fecha || '') : '',
      nuevo: !!g && !vistos[def.codigo]
    });
  });
  return salida;
}

/**
 * Marca logros como ya vistos, para que se les apague el punto de "nuevo".
 *
 * Lo llama el frontend cuando el socio ABRE la tarjeta, no el servidor al
 * entregar la lista: el punto tiene que seguir ahi hasta que efectivamente la
 * haya mirado.
 */
function questMarcarLogrosVistos(sessionToken, codigos) {
  _ensureConfig();
  try {
    var rutLimpio = _rutDeSesionQuest_(sessionToken);
    if (!rutLimpio) return { success: false, sesionExpirada: true, message: MSG_SESION_QUEST };
    if (!codigos || !codigos.length) return { success: true, marcados: 0 };

    var aux = _leerEstadoQuest_(rutLimpio);
    var yaEstaban = {};
    (aux.logrosCelebrados || []).forEach(function(c) { yaEstaban[c] = true; });

    var nuevos = [];
    codigos.forEach(function(c) {
      c = String(c || '').trim();
      if (c && !yaEstaban[c]) { yaEstaban[c] = true; nuevos.push(c); }
    });
    if (nuevos.length === 0) return { success: true, marcados: 0 };

    aux.logrosCelebrados = (aux.logrosCelebrados || []).concat(nuevos);
    _guardarEstadoQuest_(rutLimpio, aux);
    return { success: true, marcados: nuevos.length };

  } catch (e) {
    Logger.log('⚠️ questMarcarLogrosVistos: ' + e.toString());
    // No se le informa el fallo al socio: lo peor que pasa es que la tarjeta
    // vuelva a aparecer, y eso no amerita interrumpirlo con un error.
    return { success: true, marcados: 0 };
  }
}

/**
 * Todo lo que la vista de SLIM Quest necesita, en una sola llamada.
 *
 * Decide en el SERVIDOR si el socio ya jugo hoy. Antes esa comparacion la hacia
 * el navegador contra un string de fecha, y bastaba una diferencia de formato
 * (o un reloj corrido) para habilitar un segundo quiz o bloquear el del dia.
 */
function questObtenerProgreso(sessionToken) {
  _ensureConfig();
  try {
    var rutLimpio = _rutDeSesionQuest_(sessionToken);
    if (!rutLimpio) return { success: false, sesionExpirada: true, message: MSG_SESION_QUEST };

    var sheet = getSheet('GAMIFICACION', 'GAMIFICACION');
    if (!sheet) return { success: false, message: 'Módulo de gamificación no configurado.' };

    var COL = CONFIG.COLUMNAS.GAMIFICACION;
    var reg = _filaSocioQuest_(sheet, rutLimpio);

    if (!reg) {
      var usuario = obtenerUsuarioPorRut(rutLimpio);
      if (!usuario.encontrado) return { success: false, message: 'RUT no encontrado en el sistema.' };
      _inicializarSocioQuest_(rutLimpio, usuario.nombre, usuario.estado);
      reg = _filaSocioQuest_(sheet, rutLimpio);
      if (!reg) return { success: false, message: 'No se pudo inicializar tu progreso. Intenta nuevamente.' };
    }

    var v      = reg.valores;
    var estado = String(v[COL.ESTADO] || 'ACTIVO').toUpperCase().trim();
    var xp     = parseInt(v[COL.XP_TOTAL], 10) || 0;

    if (estado === 'DESVINCULADO') {
      return {
        success: false, desvinculado: true,
        message: 'Tu participación en SLIM Quest está suspendida porque tu estado en el sindicato es DESVINCULADO. Tu historial de puntos de formación y logros queda guardado.',
        xp: xp, grado: calcularGrado_(xp)
      };
    }

    var logros = [];
    try { logros = JSON.parse(v[COL.LOGROS] || '[]'); } catch (e) { logros = []; }

    var aux           = _leerEstadoQuest_(rutLimpio);
    var hoy           = _hoyQuest_();

    // Los logros de ficha y de participacion se evaluan aca, al abrir el panel.
    // Se escribe SOLO si hay alguno nuevo: sin esa condicion, cada carga de la
    // vista seria una escritura en la hoja para 2.800 socios.
    //
    // El motivo de hacerlo aca y no en un activador es la inmediatez: el socio
    // que acaba de registrar su correo en Mis Datos ve la insignia al entrar,
    // y esa es justamente la senal que buscamos — que descubra que le faltaba
    // un dato.
    var ficha = _fichaSocioQuest_(rutLimpio);

    // La escuela se calcula solo para el grado Dirigente: para el resto no se
    // lee el banco ni se arma nada que pudiera viajar al navegador. Tambien
    // otorga aca las insignias pendientes (por ejemplo, si el banco se achico y
    // una rama quedo completa sin que el socio jugara).
    var esDirigente = (calcularGrado_(xp).nombre === 'Dirigente');
    var codigosLogros = function(lista) { return (lista || []).map(function(l) { return l && l.codigo; }); };
    var bancoEscuela = esDirigente ? _leerBancoQuest_() : null;
    var progEscuela  = esDirigente ? _progresoEscuela_(bancoEscuela, aux.dominadas, codigosLogros(logros)) : null;

    var evaluados = _aplicarLogrosQuest_(logros, _resumenLogrosQuest_({
      quizzes:          parseInt(v[COL.QUIZZES_COMPLETADOS], 10) || 0,
      perfectos:        parseInt(v[COL.QUIZZES_PERFECTOS], 10)   || 0,
      rachaMax:         parseInt(v[COL.RACHA_MAX], 10)           || 0,
      practicas:        aux.practicas,
      secretos:         aux.secretos,
      partAsistidas:    aux.partAsistidas,
      partJustificadas: aux.partJustificadas,
      partRachaMax:     aux.partRachaMax,
      partAnioOk:       aux.partAnioOk,
      escenarios:       (aux.escCompletados || []).length,
      escenariosTotal:  _totalEscenariosQuest_(),
      fichaCorreo:        ficha.fichaCorreo,
      fichaContacto:      ficha.fichaContacto,
      fichaBanco:         ficha.fichaBanco,
      fichaTallas:        ficha.fichaTallas,
      fichaBeneficiarios: ficha.fichaBeneficiarios,
      escuela:            progEscuela ? progEscuela.cumplidas : null
    }));

    if (evaluados.nuevos.length > 0) {
      logros = evaluados.logros;
      sheet.getRange(reg.fila, COL.LOGROS + 1).setValue(JSON.stringify(logros));
      Logger.log('🏅 Logros otorgados al abrir el panel | ' + rutLimpio + ' | ' +
                 evaluados.nuevos.map(function(l) { return l.codigo; }).join(', '));
    }
    var quizUltimoDia = String(v[COL.QUIZ_ULTIMO_DIA] || '').trim();
    var yaJugoHoy     = (quizUltimoDia === hoy);
    var rachaGuardada = parseInt(v[COL.RACHA_ACTUAL], 10) || 0;
    var rachaVigente  = _rachaVigenteQuest_(rachaGuardada, quizUltimoDia);
    var grado         = calcularGrado_(xp);
    var sig           = _gradoSiguiente_(xp);
    var logrosVisibles = _componerLogrosQuest_(logros, {
      esDirigente: (grado.nombre === 'Dirigente'),
      celebrados:  aux.logrosCelebrados
    });

    return {
      success: true,
      nombre:             v[COL.NOMBRE],
      xp:                 xp,
      grado:              grado,
      gradoSiguiente:     sig,
      xpParaSiguiente:    sig ? sig.minXP - xp : 0,
      escalera:           _escaleraGrados_(),
      racha:              rachaVigente,
      rachaMax:           parseInt(v[COL.RACHA_MAX], 10) || 0,
      // La racha se pierde si hoy no juega: el unico momento util para avisarlo
      // es antes, no despues.
      rachaEnRiesgo:      (!yaJugoHoy && rachaVigente > 0),
      semana:             _semanaQuest_(aux.diasJugados, quizUltimoDia, rachaGuardada, rachaVigente),
      quizzesCompletados: parseInt(v[COL.QUIZZES_COMPLETADOS], 10) || 0,
      quizzesPerfectos:   parseInt(v[COL.QUIZZES_PERFECTOS], 10) || 0,
      // El total sale de la lista YA filtrada, no de CATALOGO_LOGROS_QUEST:
      // contar los ocultos delataría que existen.
      logros:             logrosVisibles,
      logrosObtenidos:    logros.length,
      logrosTotales:      logrosVisibles.length,
      logrosSinVer:       logrosVisibles.filter(function(l) { return l.nuevo; }).length,
      yaJugoHoy:          yaJugoHoy,
      xpMaximoDiario:     _xpMaximoDiario_(grado.nombre),
      xpMes:              (aux.mes === _mesQuest_()) ? aux.xpMes : 0,
      // El detalle de participación NO viaja al navegador: esas cifras las
      // muestra Registro Asistencia y no hay una segunda vista que alimentar.
      // Lo que la participación aporta acá es XP y logros, y ambos ya están
      // reflejados en `xp` y en `logros`.
      // `reservado` llega en null para todos los demas: sin objeto no hay tarjeta
      // que dibujar y no hay texto que leer en la respuesta.
      reservado: (grado.nombre === 'Dirigente') ? {
        modo:        MODOS_QUIZ.SECRETO,
        nombre:      TEXTOS_SECRETO_QUEST.nombre,
        descripcion: TEXTOS_SECRETO_QUEST.descripcion,
        disponible:  (aux.secretoUltimoDia !== hoy),
        // Recalculado con los logros ya actualizados, para que una insignia
        // recien otorgada se vea ganada en esta misma carga.
        vista:       _payloadEscuela_(_progresoEscuela_(bancoEscuela, aux.dominadas, codigosLogros(logros)),
                                      aux.secretoUltimoDia !== hoy)
      } : null,
      escenariosTotal:    _totalEscenariosQuest_(),
      escenariosHechos:   (aux.escCompletados || []).length,
      // Rol de gestión, para mostrar la entrada al informe de zona. La respuesta
      // del informe vuelve a verificar el rol: esto solo decide si se dibuja un
      // botón, y esconder un botón nunca es un control.
      esGestor: verificarRolUsuario(rutLimpio, ['DIRIGENTE', 'DIRECTORIO', 'ADMIN']).autorizado,
      estado:             estado
    };

  } catch (e) {
    Logger.log('❌ questObtenerProgreso: ' + e.toString());
    return { success: false, message: 'Ocurrió un error interno. Por favor, intente más tarde o contacte al administrador.' };
  }
}

// ==========================================
// QUIZ — CICLO DE VIDA
// ==========================================
//
// El quiz vive en CacheService bajo un `quizToken` (UUID) mientras se juega.
// Ese objeto es la unica fuente de verdad del puntaje: guarda la pauta, lo que
// el socio respondio y cuando. El navegador solo transporta el token.

function _claveCacheQuiz_(quizToken) { return 'QUEST_QUIZ_' + quizToken; }

function _leerQuizEnCurso_(quizToken) {
  if (!quizToken) return null;
  try {
    var crudo = CacheService.getScriptCache().get(_claveCacheQuiz_(quizToken));
    return crudo ? JSON.parse(crudo) : null;
  } catch (e) {
    Logger.log('⚠️ _leerQuizEnCurso_: ' + e.toString());
    return null;
  }
}

function _guardarQuizEnCurso_(quizToken, quiz) {
  CacheService.getScriptCache().put(_claveCacheQuiz_(quizToken), JSON.stringify(quiz), CFG_QUEST.TTL_QUIZ_SEG);
}

var MSG_QUIZ_EXPIRADO = 'Este quiz expiró o ya fue registrado. Vuelve a empezar — no perdiste tu intento del día.';

/**
 * Abre un quiz y devuelve las preguntas SIN la respuesta correcta.
 *
 * `modo`: DIARIO (una vez al dia, da XP), PRACTICA (libre, sin XP), SECRETO
 * (exclusivo de grado Dirigente, una vez al dia, da XP y no consume el diario)
 * o ESCENARIO (simulacro guiado; `referencia` es el id del escenario, se puede
 * repetir y paga XP solo la primera vez que se aprueba).
 */
function questIniciarQuiz(sessionToken, modo, referencia) {
  _ensureConfig();
  try {
    var rutLimpio = _rutDeSesionQuest_(sessionToken);
    if (!rutLimpio) return { success: false, sesionExpirada: true, message: MSG_SESION_QUEST };

    modo = String(modo || MODOS_QUIZ.DIARIO).toUpperCase();
    if (!MODOS_QUIZ[modo]) modo = MODOS_QUIZ.DIARIO;

    // El switch se revalida aca aunque la UI ya lo consulte: en un webapp
    // ANYONE_ANONYMOUS esconder un boton no es un control.
    //
    // Los roles de gestion quedan exceptuados a proposito, igual que en la
    // entrada a la vista: el interruptor del modulo vive DENTRO de SLIM Quest,
    // asi que un ADMIN que lo apague sin esta excepcion no puede volver a
    // entrar para probarlo ni para reactivarlo.
    if (!_switchHabilitado('slimquest_habilitado').habilitado &&
        !verificarRolUsuario(rutLimpio, ['DIRIGENTE', 'DIRECTORIO', 'ADMIN', 'TESTING']).autorizado) {
      return { success: false, message: 'El módulo SLIM Quest no está disponible en este momento.' };
    }

    var sheet = getSheet('GAMIFICACION', 'GAMIFICACION');
    if (!sheet) return { success: false, message: 'Módulo de gamificación no configurado.' };

    var COL = CONFIG.COLUMNAS.GAMIFICACION;
    var reg = _filaSocioQuest_(sheet, rutLimpio);
    if (!reg) {
      var usuario = obtenerUsuarioPorRut(rutLimpio);
      if (!usuario.encontrado) return { success: false, message: 'RUT no encontrado en el sistema.' };
      _inicializarSocioQuest_(rutLimpio, usuario.nombre, usuario.estado);
      reg = _filaSocioQuest_(sheet, rutLimpio);
      if (!reg) return { success: false, message: 'No se pudo inicializar tu progreso.' };
    }

    if (String(reg.valores[COL.ESTADO] || '').toUpperCase().trim() === 'DESVINCULADO') {
      return { success: false, desvinculado: true, message: 'Tu participación en SLIM Quest está suspendida.' };
    }

    var xp    = parseInt(reg.valores[COL.XP_TOTAL], 10) || 0;
    var grado = calcularGrado_(xp);
    var hoy   = _hoyQuest_();
    var aux   = _leerEstadoQuest_(rutLimpio);

    // Para quien no tiene el grado Dirigente, este modo no existe: se trata
    // exactamente igual que cualquier modo desconocido (arriba, un modo que no
    // esta en MODOS_QUIZ cae al DIARIO). Antes se rechazaba con un mensaje que
    // nombraba el nivel y decia como llegar a el, o sea, lo anunciaba.
    if (modo === MODOS_QUIZ.SECRETO && grado.nombre !== 'Dirigente') modo = MODOS_QUIZ.DIARIO;

    if (modo === MODOS_QUIZ.DIARIO && String(reg.valores[COL.QUIZ_ULTIMO_DIA] || '').trim() === hoy) {
      return { success: false, yaJugoHoy: true, message: 'Ya completaste el quiz de hoy. ¡Vuelve mañana! Mientras tanto puedes practicar sin límite.' };
    }
    if (modo === MODOS_QUIZ.SECRETO) {
      if (aux.secretoUltimoDia === hoy) {
        return { success: false, yaJugoHoy: true, message: 'Ya completaste el Nivel Secreto de hoy. Vuelve mañana.' };
      }
    }

    var sel, escenario = null;

    if (modo === MODOS_QUIZ.ESCENARIO) {
      // Los pasos van en su orden y no pasan por el anti-repeticion: una
      // situacion tiene secuencia, y "no repetir" es justo lo contrario de lo
      // que se busca en un simulacro que se practica hasta dominarlo.
      var pasos = _seleccionarPasosEscenario_(referencia);
      if (!pasos.ok) return { success: false, message: pasos.message };
      escenario = pasos.escenario;
      sel = { preguntas: pasos.preguntas, reciclado: false, vistos: aux.vistos };
    } else {
      var banco = _leerBancoQuest_();
      if (banco.length === 0) return { success: false, message: 'No hay preguntas disponibles en este momento.' };

      sel = _seleccionarPreguntasQuest_(banco, grado.nombre, aux, modo, CFG_QUEST.PREGUNTAS_POR_QUIZ);
      if (sel.preguntas.length === 0) {
        return { success: false, message: (modo === MODOS_QUIZ.SECRETO)
          ? 'Aún no hay preguntas cargadas en el Nivel Secreto.'
          : 'No hay preguntas disponibles en este momento.' };
      }
    }

    // Se baraja UNA vez, aca, y esa permutacion es la que se guarda: la pauta,
    // lo que se le muestra al socio y el repaso final tienen que hablar todos
    // del mismo orden.
    var preparadas = sel.preguntas.map(_barajarOpcionesQuest_);

    var quizToken = Utilities.getUuid();
    _guardarQuizEnCurso_(quizToken, {
      rut: rutLimpio, modo: modo, creado: Date.now(), finalizado: false,
      escenarioId: escenario ? escenario.id : '',
      preguntas: preparadas,
      respuestas: preparadas.map(function() { return null; }),
      // Historial ya depurado por el reciclaje de niveles agotados. Viaja con
      // el quiz para que al cerrarlo se guarde el reinicio, en lugar de
      // repetirse en memoria todos los dias sin registrarse nunca.
      vistosBase: sel.vistos
    });

    Logger.log('🎮 Quiz ' + modo + ' abierto | ' + rutLimpio + ' | grado ' + grado.nombre +
               ' | ' + sel.preguntas.length + ' preguntas' + (sel.reciclado ? ' | banco reciclado' : ''));

    return {
      success: true,
      quizToken: quizToken,
      modo: modo,
      bancoReciclado: sel.reciclado,
      escenario: escenario ? { id: escenario.id, nombre: escenario.nombre, modulo: escenario.modulo, descripcion: escenario.descripcion } : null,
      // Encabezado de la vista del quiz. Viaja desde aca en los modos cuyo
      // nombre no debe estar escrito en el cliente.
      encabezado: (modo === MODOS_QUIZ.SECRETO)
        ? { titulo: TEXTOS_SECRETO_QUEST.titulo, etiqueta: TEXTOS_SECRETO_QUEST.etiqueta }
        : (escenario ? { titulo: escenario.nombre, etiqueta: 'Simulacro · ' + escenario.modulo } : null),
      // Sin `respuesta` ni `explicacion`: viajan de vuelta en questResponder,
      // una vez que el socio ya se comprometio con una alternativa.
      preguntas: preparadas.map(function(p) {
        return { id: p.id, categoria: p.categoria, nivel: p.nivel, pregunta: p.pregunta,
                 opciones: p.opciones, xp: (modo === MODOS_QUIZ.PRACTICA || modo === MODOS_QUIZ.ESCENARIO) ? 0 : p.xp };
      })
    };

  } catch (e) {
    Logger.log('❌ questIniciarQuiz: ' + e.toString());
    return { success: false, message: 'Ocurrió un error interno. Por favor, intente más tarde o contacte al administrador.' };
  }
}

/**
 * Corrige UNA pregunta y devuelve el veredicto con su explicacion.
 *
 * Es idempotente: repetir la llamada para una pregunta ya respondida devuelve
 * el mismo resultado en vez de un error. Un doble toque en una alternativa no
 * puede cambiar lo que el socio respondio.
 */
function questResponder(quizToken, indice, letra) {
  _ensureConfig();
  try {
    var quiz = _leerQuizEnCurso_(quizToken);
    if (!quiz)            return { success: false, expirado: true, message: MSG_QUIZ_EXPIRADO };
    if (quiz.finalizado)  return { success: false, expirado: true, message: MSG_QUIZ_EXPIRADO };

    var i = parseInt(indice, 10);
    if (!(i >= 0 && i < quiz.preguntas.length)) return { success: false, message: 'Pregunta fuera de rango.' };

    var p = quiz.preguntas[i];
    var elegida = String(letra || '').toUpperCase().trim();

    if (quiz.respuestas[i] === null) {
      if (['A', 'B', 'C', 'D'].indexOf(elegida) === -1) return { success: false, message: 'Alternativa inválida.' };
      quiz.respuestas[i] = elegida;
      _guardarQuizEnCurso_(quizToken, quiz);
    }

    var dada       = quiz.respuestas[i];
    var esCorrecta = (dada === p.respuesta);
    var xpGanado   = (esCorrecta && quiz.modo !== MODOS_QUIZ.PRACTICA && quiz.modo !== MODOS_QUIZ.ESCENARIO) ? p.xp : 0;

    return {
      success: true,
      esCorrecta: esCorrecta,
      respuestaCorrecta: p.respuesta,
      tuRespuesta: dada,
      explicacion: p.explicacion,
      fuente: p.fuente,
      xpGanado: xpGanado,
      esUltima: (i === quiz.preguntas.length - 1)
    };

  } catch (e) {
    Logger.log('❌ questResponder: ' + e.toString());
    return { success: false, message: 'Ocurrió un error interno.' };
  }
}

/**
 * Cierra el quiz y registra el resultado.
 *
 * El cliente no manda puntaje: todo sale de `quiz.respuestas`, que solo
 * questResponder escribe. Las preguntas sin responder cuentan como erradas.
 *
 * El candado es necesario porque la funcion lee "¿ya jugo hoy?" y despues
 * escribe: dos llamadas simultaneas — lo que produce un doble toque en "Ver
 * resultados" — leian ambas el valor anterior y duplicaban XP, racha y
 * contador de quizzes.
 */
function questFinalizar(quizToken) {
  _ensureConfig();

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return { success: false, message: 'Servidor ocupado, intenta nuevamente.' };

  try {
    var quiz = _leerQuizEnCurso_(quizToken);
    if (!quiz)           return { success: false, expirado: true, message: MSG_QUIZ_EXPIRADO };
    if (quiz.finalizado) return { success: false, expirado: true, message: MSG_QUIZ_EXPIRADO };

    var rutLimpio = quiz.rut;
    var modo      = quiz.modo;
    var hoy       = _hoyQuest_();

    // --- Correccion, hecha solo con datos del servidor ---
    var correctas = 0, xpBase = 0;
    var revision  = [];
    var idsVistos = [], idsFallados = [], idsAcertados = [];

    quiz.preguntas.forEach(function(p, i) {
      var dada = quiz.respuestas[i];
      var ok   = (dada === p.respuesta);
      if (ok) { correctas++; xpBase += p.xp; idsAcertados.push(p.id); }
      else    { idsFallados.push(p.id); }
      idsVistos.push(p.id);
      // El repaso muestra el TEXTO de las alternativas, no la letra: como las
      // opciones se barajan por quiz, "respondiste B" no significa nada fuera
      // de la pantalla donde se respondio.
      revision.push({
        pregunta: p.pregunta, categoria: p.categoria, nivel: p.nivel,
        tuRespuesta: dada, respuestaCorrecta: p.respuesta,
        tuRespuestaTexto:       dada ? String(p.opciones[dada] || '') : '',
        respuestaCorrectaTexto: String(p.opciones[p.respuesta] || ''),
        esCorrecta: ok, explicacion: p.explicacion, fuente: p.fuente,
        xp: (modo === MODOS_QUIZ.PRACTICA ? 0 : p.xp)
      });
    });

    var total    = quiz.preguntas.length;
    var perfecto = (correctas === total && total > 0);
    if (modo === MODOS_QUIZ.PRACTICA) xpBase = 0;

    // --- Escenario: se paga por aprobarlo, y una sola vez ---
    var esEscenario   = (modo === MODOS_QUIZ.ESCENARIO);
    var escAprobado   = false;
    var escPrimeraVez = false;
    if (esEscenario) {
      xpBase = 0;
      escAprobado = total > 0 && (correctas / total) >= CFG_ESCENARIOS.UMBRAL_APROBACION;
    }

    quiz.finalizado = true;
    _guardarQuizEnCurso_(quizToken, quiz);

    var sheet = getSheet('GAMIFICACION', 'GAMIFICACION');
    var COL   = CONFIG.COLUMNAS.GAMIFICACION;
    var reg   = _filaSocioQuest_(sheet, rutLimpio);
    if (!reg) return { success: false, message: 'No se encontró tu registro de progreso.' };

    var v             = reg.valores;
    var xpActual      = parseInt(v[COL.XP_TOTAL], 10) || 0;
    var gradoAnterior = String(v[COL.GRADO] || GRADOS_SLIM[0].nombre);
    var quizUltimoDia = String(v[COL.QUIZ_ULTIMO_DIA] || '').trim();
    var aux           = _leerEstadoQuest_(rutLimpio);

    if (esEscenario && escAprobado) {
      // Repetir un escenario es gratis y sin castigo, pero el XP se paga solo
      // la primera vez que se aprueba: si no, seria una fuente infinita de XP
      // repitiendo el mismo simulacro ya memorizado.
      escPrimeraVez = (aux.escCompletados || []).indexOf(quiz.escenarioId) === -1;
      if (escPrimeraVez) xpBase = CFG_ESCENARIOS.XP_PRIMERA_APROBACION;
    }

    // Segunda verificacion, ya con el candado tomado: entre abrir el quiz y
    // cerrarlo pudo registrarse otro.
    if (modo === MODOS_QUIZ.DIARIO && quizUltimoDia === hoy) {
      return { success: false, yaJugoHoy: true, message: 'Ya habías completado el quiz de hoy.' };
    }
    if (modo === MODOS_QUIZ.SECRETO && aux.secretoUltimoDia === hoy) {
      return { success: false, yaJugoHoy: true, message: 'Ya habías completado el Nivel Secreto de hoy.' };
    }

    // --- Racha y bonos (solo el quiz diario los mueve) ---
    var rachaGuardada = parseInt(v[COL.RACHA_ACTUAL], 10) || 0;
    var rachaMax      = parseInt(v[COL.RACHA_MAX], 10)    || 0;
    var nuevaRacha    = rachaGuardada;
    var xpBonoRacha   = 0;
    var rachaRota     = false;

    if (modo === MODOS_QUIZ.DIARIO) {
      if (quizUltimoDia === _ayerQuest_()) {
        nuevaRacha = rachaGuardada + 1;
      } else {
        rachaRota  = (rachaGuardada > 0 && quizUltimoDia !== '');
        nuevaRacha = 1;
      }
      if (BONOS_RACHA_QUEST[nuevaRacha] !== undefined)      xpBonoRacha = BONOS_RACHA_QUEST[nuevaRacha];
      else if (nuevaRacha > 100 && nuevaRacha % 7 === 0)    xpBonoRacha = 100;
      rachaMax = Math.max(nuevaRacha, rachaMax);
    }

    var xpFinal = xpBase + xpBonoRacha;
    var xpNuevo = xpActual + xpFinal;
    var gradoNuevo = calcularGrado_(xpNuevo);

    var quizzes   = parseInt(v[COL.QUIZZES_COMPLETADOS], 10) || 0;
    var perfectos = parseInt(v[COL.QUIZZES_PERFECTOS], 10)   || 0;
    if (modo === MODOS_QUIZ.DIARIO) {
      quizzes++;
      if (perfecto) perfectos++;
    }

    // --- Logros ---
    var logrosPrevios = [];
    try { logrosPrevios = JSON.parse(v[COL.LOGROS] || '[]'); } catch (e) { logrosPrevios = []; }

    // Escuela de Formacion Dirigencial: la clase (modo SECRETO) marca como
    // dominadas las preguntas respondidas bien por primera vez. El avance se
    // calcula ANTES de evaluar logros para que la insignia de una rama recien
    // completada se otorgue en esta misma clase.
    var dominadasNuevas = [], progEscuela = null;
    if (modo === MODOS_QUIZ.SECRETO) {
      dominadasNuevas = idsAcertados.filter(function(id) { return (aux.dominadas || []).indexOf(id) === -1; });
      progEscuela = _progresoEscuela_(_leerBancoQuest_(), (aux.dominadas || []).concat(dominadasNuevas),
                                      logrosPrevios.map(function(l) { return l && l.codigo; }));
    }

    // Se pasa tambien el estado de participacion: si el trabajo por lotes dejo
    // un logro sindical listo para otorgar, jugar un quiz lo desbloquea sin
    // esperar al proximo mes.
    var resumenLogros = _resumenLogrosQuest_({
      quizzes:   quizzes,
      perfectos: perfectos,
      rachaMax:  rachaMax,
      practicas: aux.practicas + (modo === MODOS_QUIZ.PRACTICA ? 1 : 0),
      secretos:  aux.secretos  + (modo === MODOS_QUIZ.SECRETO  ? 1 : 0),
      escenarios:      (aux.escCompletados || []).length + ((escAprobado && escPrimeraVez) ? 1 : 0),
      escenariosTotal: esEscenario ? _totalEscenariosQuest_() : 0,
      partAsistidas:    aux.partAsistidas,
      partJustificadas: aux.partJustificadas,
      partRachaMax:     aux.partRachaMax,
      partAnioOk:       aux.partAnioOk,
      escuela:          progEscuela ? progEscuela.cumplidas : null
    });
    var otorgados    = _aplicarLogrosQuest_(logrosPrevios, resumenLogros);
    var logrosNuevos = otorgados.nuevos;

    // --- Una sola escritura para todo el bloque ---
    // Se conservan LOGROS y ESTADO leyendo lo que ya habia: el rango es
    // contiguo (columnas C..L) y escribirlo entero de una vez evita las ocho
    // llamadas setValue que hacia la version anterior.
    sheet.getRange(reg.fila, COL.XP_TOTAL + 1, 1, COL.QUIZZES_PERFECTOS - COL.XP_TOTAL + 1).setValues([[
      xpNuevo,                                                    // XP_TOTAL
      gradoNuevo.nombre,                                          // GRADO
      JSON.stringify(otorgados.logros),                           // LOGROS
      (modo === MODOS_QUIZ.DIARIO) ? nuevaRacha : rachaGuardada,  // RACHA_ACTUAL
      rachaMax,                                                   // RACHA_MAX
      _ahoraQuest_(),                                             // ULTIMA_ACTIVIDAD
      (modo === MODOS_QUIZ.DIARIO) ? hoy : quizUltimoDia,         // QUIZ_ULTIMO_DIA
      quizzes,                                                    // QUIZZES_COMPLETADOS
      v[COL.ESTADO],                                              // ESTADO (sin tocar)
      perfectos                                                   // QUIZZES_PERFECTOS
    ]]);

    // --- Estado auxiliar: anti-repeticion, ranking mensual y contadores ---
    var mesActual = _mesQuest_();
    if (aux.mes !== mesActual) { aux.mes = mesActual; aux.xpMes = 0; aux.quizzesMes = 0; }

    // El historial de vistas y de falladas es del BANCO DE PREGUNTAS. Un
    // escenario no aporta ahi: sus pasos no son preguntas del banco, y meter
    // sus ids envenenaria el anti-repeticion del quiz con claves que no existen.
    if (modo === MODOS_QUIZ.DIARIO || modo === MODOS_QUIZ.SECRETO) {
      // La practica no marca preguntas como vistas: si lo hiciera, estudiar
      // gastaria el banco del quiz diario y el socio terminaria castigado por
      // repasar.
      //
      // Se parte del historial depurado que viajo con el quiz, no del que hay
      // en la hoja: ahi es donde queda registrado el reinicio de un nivel que
      // se habia agotado.
      var vistosBase = quiz.vistosBase || aux.vistos;
      aux.vistos = vistosBase.concat(idsVistos.filter(function(id) { return vistosBase.indexOf(id) === -1; }));
      aux.quizzesMes++;
    }
    if (modo !== MODOS_QUIZ.PRACTICA) aux.xpMes += xpFinal;

    if (!esEscenario) {
      // Las falladas sí se acumulan tambien en practica: son la lista de
      // repaso, y da lo mismo donde el socio se equivoco.
      aux.fallados = aux.fallados
        .filter(function(id) { return idsAcertados.indexOf(id) === -1; })
        .concat(idsFallados.filter(function(id) { return aux.fallados.indexOf(id) === -1; }));
    }

    if (esEscenario) {
      if (escAprobado && escPrimeraVez) aux.escCompletados = (aux.escCompletados || []).concat([quiz.escenarioId]);
      _registrarIntentoEscenario_(rutLimpio, quiz.escenarioId, revision, escAprobado);
    }

    if (modo === MODOS_QUIZ.DIARIO)   aux.diasJugados = _registrarDiaJugadoQuest_(aux.diasJugados, hoy);
    if (modo === MODOS_QUIZ.PRACTICA) aux.practicas++;
    if (modo === MODOS_QUIZ.SECRETO)  {
      aux.secretos++;
      aux.secretoUltimoDia = hoy;
      aux.dominadas = (aux.dominadas || []).concat(dominadasNuevas);
    }
    _guardarEstadoQuest_(rutLimpio, aux);

    // Comparar los NOMBRES con !== solo dice que el grado cambió. Hay filas con
    // el GRADO desalineado del XP_TOTAL, y al recalcularse el socio puede BAJAR;
    // sin comparar posiciones en la escalera, esa corrección le llegaba como un
    // correo felicitándolo por el ascenso.
    var subioGrado = _indiceGrado_(gradoNuevo.nombre) > _indiceGrado_(gradoAnterior);
    if (subioGrado) {
      var correoSocio = '';
      try { correoSocio = obtenerUsuarioPorRut(rutLimpio).correo || ''; } catch (e) {}
      enviarCorreoNivel(correoSocio, v[COL.NOMBRE], gradoNuevo.nombre, xpNuevo);
    }

    // Graduacion de la escuela: el diploma sale una sola vez, cuando el logro
    // se otorga (un logro ya obtenido nunca vuelve a aparecer como nuevo).
    var seGraduo = logrosNuevos.some(function(l) { return l.codigo === ESCUELA_DIRIGENCIAL.logroGraduacion; });
    if (seGraduo && progEscuela) {
      var correoGrad = '';
      try { correoGrad = obtenerUsuarioPorRut(rutLimpio).correo || ''; } catch (e) {}
      enviarCorreoGraduacionEscuela_(correoGrad, v[COL.NOMBRE], progEscuela);
    }

    Logger.log('✅ Quiz ' + modo + ' cerrado | ' + rutLimpio + ' | ' + correctas + '/' + total +
               ' | +' + xpFinal + ' XP (bono ' + xpBonoRacha + ') | racha ' + nuevaRacha);

    return {
      success: true,
      modo: modo,
      escenarioId: quiz.escenarioId || '',
      escenarioAprobado: escAprobado,
      escenarioPrimeraVez: escPrimeraVez,
      escenarioUmbral: Math.round(CFG_ESCENARIOS.UMBRAL_APROBACION * 100),
      correctas: correctas,
      total: total,
      perfecto: perfecto,
      xpGanado: xpFinal,
      xpBase: xpBase,
      xpBonoRacha: xpBonoRacha,
      xpTotal: xpNuevo,
      nuevaRacha: (modo === MODOS_QUIZ.DIARIO) ? nuevaRacha : rachaGuardada,
      rachaRota: rachaRota,
      grado: gradoNuevo,
      gradoAnterior: gradoAnterior,
      subioGrado: subioGrado,
      gradoSiguiente: _gradoSiguiente_(xpNuevo),
      xpParaSiguiente: _gradoSiguiente_(xpNuevo) ? _gradoSiguiente_(xpNuevo).minXP - xpNuevo : 0,
      logrosNuevos: logrosNuevos,
      // Solo en la clase de la escuela, y ya redactado en el servidor: el
      // cliente no tiene escrita ninguna palabra de ella.
      avisoReservado: progEscuela ? _avisoClaseEscuela_(dominadasNuevas.length, progEscuela) : '',
      revision: revision
    };

  } catch (e) {
    Logger.log('❌ questFinalizar: ' + e.toString());
    return { success: false, message: 'Ocurrió un error interno. Por favor, intente más tarde o contacte al administrador.' };
  } finally {
    if (lock.hasLock()) lock.releaseLock();
  }
}

/**
 * Evalua el catalogo completo contra el estado del socio y devuelve la lista
 * de logros resultante mas los recien desbloqueados.
 *
 * Reevaluar TODO el catalogo en cada quiz (en vez de comprobar solo los hitos
 * que se acaban de cruzar) hace que un logro perdido por un error puntual se
 * recupere solo en la siguiente partida.
 */
function _aplicarLogrosQuest_(logrosPrevios, resumen) {
  var porCodigo = {};
  (logrosPrevios || []).forEach(function(l) { if (l && l.codigo) porCodigo[l.codigo] = l; });

  var fecha  = _hoyQuest_();
  var nuevos = [];

  CATALOGO_LOGROS_QUEST.forEach(function(def) {
    if (porCodigo[def.codigo]) return;
    var cumple = false;
    try { cumple = !!def.condicion(resumen); } catch (e) { cumple = false; }
    if (!cumple) return;
    var logro = { codigo: def.codigo, nombre: def.nombre, icono: def.icono, fecha: fecha };
    porCodigo[def.codigo] = logro;
    // Al devolverlo se le suma la descripcion, que NO se guarda en la hoja: si
    // el texto quedara copiado en cada fila, corregir una redaccion no
    // alcanzaria nunca a quien ya tiene el logro.
    nuevos.push({ codigo: def.codigo, nombre: def.nombre, icono: def.icono,
                  descripcion: def.descripcion, fecha: fecha });
  });

  // Se conserva el orden del catalogo para que la vitrina no se reordene sola.
  var lista = [];
  CATALOGO_LOGROS_QUEST.forEach(function(def) { if (porCodigo[def.codigo]) lista.push(porCodigo[def.codigo]); });
  // Y se arrastra cualquier logro historico que ya no este en el catalogo, para
  // no borrarle a nadie algo que gano.
  (logrosPrevios || []).forEach(function(l) {
    if (l && l.codigo && !CATALOGO_LOGROS_QUEST.some(function(d) { return d.codigo === l.codigo; })) lista.push(l);
  });

  return { logros: lista, nuevos: nuevos };
}

// ==========================================
// CLASIFICACION
// ==========================================
//
// Tres ambitos, y la razon de que sean tres:
//
//   GLOBAL — XP historico. Es el ranking "de siempre", pero se congela: los
//            socios que empezaron primero ocupan el top y nadie los mueve.
//   MES    — XP del mes en curso. Todos parten de cero cada mes, asi que un
//            socio nuevo puede competir de verdad.
//   ZONA   — solo su zona. Ser primero entre 150 companeros de tu region es
//            alcanzable; ser primero entre 3.100 no lo es para casi nadie.
//
// Ademas, solo entra al ranking quien tiene XP > 0. Antes se listaba a los
// ~3.100 socios sincronizados y un recien llegado se veia en el puesto ~2.000,
// junto a miles de filas en cero ordenadas al azar entre si.

/** Nombre acortado para mostrar: "JUAN PEREZ G." */
function _nombreVisibleQuest_(nombre) {
  var partes = String(nombre || 'Socio').trim().split(/\s+/);
  var out = partes[0] || 'Socio';
  if (partes[1]) out += ' ' + partes[1];
  if (partes[2]) out += ' ' + partes[2].charAt(0) + '.';
  return out;
}

/** Mapa RUT -> REGION leido de BD_SLIMAPP. Solo se usa para el ranking por zona. */
function _mapaZonasQuest_() {
  var mapa = {};
  try {
    var sheet = getSheet('USUARIOS', 'USUARIOS');
    if (!sheet) return mapa;
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return mapa;

    var COL  = CONFIG.COLUMNAS.USUARIOS;
    var data = sheet.getRange(2, 1, lastRow - 1, COL.REGION + 1).getDisplayValues();
    for (var i = 0; i < data.length; i++) {
      var rut = cleanRut(data[i][COL.RUT]);
      if (rut) mapa[rut] = String(data[i][COL.REGION] || '').trim();
    }
  } catch (e) {
    Logger.log('⚠️ _mapaZonasQuest_: ' + e.toString());
  }
  return mapa;
}

/** Mapa RUT -> XP del mes en curso. Un mes distinto al actual vale 0. */
function _mapaXpMesQuest_() {
  var mapa = {};
  try {
    var hoja = _hojaEstadoQuest_();
    if (!hoja) return mapa;
    var lastRow = hoja.getLastRow();
    if (lastRow < 2) return mapa;

    var idx = _indicesEstadoQuest_(hoja);
    if (idx.RUT < 0 || idx.XP_MES < 0 || idx.MES < 0) return mapa;

    var mesActual = _mesQuest_();
    var data = hoja.getRange(2, 1, lastRow - 1, Math.max(hoja.getLastColumn(), 1)).getDisplayValues();
    for (var i = 0; i < data.length; i++) {
      var rut = cleanRut(data[i][idx.RUT]);
      if (!rut) continue;
      if (String(data[i][idx.MES] || '') !== mesActual) continue;
      mapa[rut] = parseInt(data[i][idx.XP_MES], 10) || 0;
    }
  } catch (e) {
    Logger.log('⚠️ _mapaXpMesQuest_: ' + e.toString());
  }
  return mapa;
}

/**
 * Construye la lista ordenada de un ambito. Se cachea porque recorre una o dos
 * hojas completas y la clasificacion no necesita ser instantanea; el TTL corto
 * mantiene la sensacion de que el ranking se mueve.
 */
function _listaRankingQuest_(ambito, zonaNorm) {
  var clave = 'QUEST_LB_' + ambito + (zonaNorm ? '_' + zonaNorm : '');
  var cache = CacheService.getScriptCache();
  try {
    var guardado = cache.get(clave);
    if (guardado) return JSON.parse(guardado);
  } catch (e) {}

  var sheet = getSheet('GAMIFICACION', 'GAMIFICACION');
  if (!sheet) return [];
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  var COL  = CONFIG.COLUMNAS.GAMIFICACION;
  var data = sheet.getRange(2, 1, lastRow - 1, COL.ESTADO + 1).getDisplayValues();

  var xpMes = (ambito === 'MES')  ? _mapaXpMesQuest_() : null;
  var zonas = (ambito === 'ZONA') ? _mapaZonasQuest_() : null;

  var lista = [];
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][COL.ESTADO] || '').toUpperCase().trim() === 'DESVINCULADO') continue;

    var rut = cleanRut(data[i][COL.RUT]);
    if (!rut) continue;

    if (ambito === 'ZONA') {
      if (_normalizarRegionParaComparar(zonas[rut] || '') !== zonaNorm) continue;
    }

    var xp = (ambito === 'MES')
      ? (xpMes[rut] || 0)
      : (parseInt(data[i][COL.XP_TOTAL], 10) || 0);
    if (xp <= 0) continue;   // sin XP no se entra al ranking

    // El grado siempre refleja el XP historico, aunque el ranking sea mensual:
    // el grado es quien eres, no como te fue este mes.
    var xpHistorico = parseInt(data[i][COL.XP_TOTAL], 10) || 0;
    lista.push({ rut: rut, nombre: _nombreVisibleQuest_(data[i][COL.NOMBRE]), xp: xp, grado: calcularGrado_(xpHistorico) });
  }

  // Desempate por nombre: sin el, dos socios con el mismo XP se intercambian de
  // puesto en cada carga y el ranking parece inestable.
  lista.sort(function(a, b) { return (b.xp - a.xp) || a.nombre.localeCompare(b.nombre); });

  try {
    var json = JSON.stringify(lista);
    // CacheService rechaza valores sobre 100 KB. Si la lista crece demasiado se
    // sigue sirviendo, solo que sin cache.
    if (json.length < 90000) cache.put(clave, json, CFG_QUEST.TTL_LEADERBOARD_SEG);
  } catch (e) {}

  return lista;
}

/**
 * `ambito`: 'GLOBAL' (por defecto), 'MES' o 'ZONA'.
 */
function questObtenerLeaderboard(sessionToken, ambito) {
  _ensureConfig();
  try {
    var rutLimpio = _rutDeSesionQuest_(sessionToken);
    if (!rutLimpio) return { success: false, sesionExpirada: true, message: MSG_SESION_QUEST };

    ambito = String(ambito || 'GLOBAL').toUpperCase();
    if (['GLOBAL', 'MES', 'ZONA'].indexOf(ambito) === -1) ambito = 'GLOBAL';

    var zonaNorm = '', zonaLabel = '';
    if (ambito === 'ZONA') {
      var usuario = obtenerUsuarioPorRut(rutLimpio);
      zonaLabel = usuario.encontrado ? String(usuario.region || '').trim() : '';
      zonaNorm  = _normalizarRegionParaComparar(zonaLabel);
      // Un socio sin zona no puede tener ranking de zona; se le dice, en vez de
      // mostrarle una tabla vacia que parece un error del sistema.
      if (!zonaNorm || CENTINELAS_SIN_REGION.indexOf(zonaNorm) !== -1) {
        return { success: true, ambito: ambito, sinZona: true, top: [], miPosicion: null, totalParticipantes: 0,
                 message: 'Tu zona no está registrada en tu ficha de socio, así que aún no podemos armar tu ranking zonal.' };
      }
    }

    var lista = _listaRankingQuest_(ambito, zonaNorm);
    var top = lista.slice(0, CFG_QUEST.TOPE_LEADERBOARD).map(function(s, idx) {
      return { posicion: idx + 1, nombre: s.nombre, xp: s.xp, grado: s.grado, esMio: (s.rut === rutLimpio) };
    });

    var miPosicion = null;
    for (var j = 0; j < lista.length; j++) {
      if (lista[j].rut === rutLimpio) {
        miPosicion = { posicion: j + 1, xp: lista[j].xp, grado: lista[j].grado };
        break;
      }
    }

    return {
      success: true, ambito: ambito, zona: zonaLabel,
      top: top, miPosicion: miPosicion, totalParticipantes: lista.length,
      mes: (ambito === 'MES') ? _mesQuest_() : ''
    };

  } catch (e) {
    Logger.log('❌ questObtenerLeaderboard: ' + e.toString());
    return { success: false, message: 'Ocurrió un error interno. Por favor, intente más tarde o contacte al administrador.' };
  }
}

// ==========================================
// SINCRONIZACION CON LA BASE DE SOCIOS
// ==========================================

/**
 * Trigger diario (1 AM): crea la fila de los socios nuevos y actualiza nombre y
 * estado de los existentes.
 *
 * ⚠️ Su activador NO lo crea `configurarTriggers()` historicamente, sino
 * `configurarTriggerGamificacion()`. Como `configurarTriggers()` borra TODOS
 * los activadores del proyecto antes de recrear los suyos, cada vez que se
 * corria dejaba esta sincronizacion apagada en silencio. Por eso ahora tambien
 * figura en la lista de `configurarTriggers()`; el helper de aca se conserva
 * para poder reinstalar solo este.
 */
function sincronizarSociosGamificacion(e) {
  if (activadorFueraDeProduccion_(e, 'sincronizarSociosGamificacion')) return;
  _ensureConfig();
  try {
    Logger.log('🔄 Sincronizando socios con SLIM Quest...');

    var sheetUsuarios = getSheet('USUARIOS', 'USUARIOS');
    var sheetGame     = getSheet('GAMIFICACION', 'GAMIFICACION');
    if (!sheetUsuarios || !sheetGame) { Logger.log('❌ No se pudieron obtener las hojas necesarias.'); return; }

    var COL_U = CONFIG.COLUMNAS.USUARIOS;
    var COL_G = CONFIG.COLUMNAS.GAMIFICACION;
    var ahora = _ahoraQuest_();

    var lastRowGame = sheetGame.getLastRow();
    var mapaGame = {};
    if (lastRowGame >= 2) {
      var dataGame = sheetGame.getRange(2, 1, lastRowGame - 1, COL_G.ESTADO + 1).getDisplayValues();
      for (var i = 0; i < dataGame.length; i++) {
        var rutG = cleanRut(dataGame[i][COL_G.RUT]);
        if (rutG) mapaGame[rutG] = { fila: i + 2, nombre: dataGame[i][COL_G.NOMBRE], estado: dataGame[i][COL_G.ESTADO] };
      }
    }

    var lastRowU = sheetUsuarios.getLastRow();
    if (lastRowU < 2) { Logger.log('ℹ️ No hay socios en BD_SLIMAPP.'); return; }

    var dataU = sheetUsuarios.getRange(2, 1, lastRowU - 1, COL_U.ESTADO + 1).getDisplayValues();
    var creados = 0, actualizados = 0, sinRut = 0;
    var nuevasFilas = [];

    for (var j = 0; j < dataU.length; j++) {
      var rutLimpio = cleanRut(dataU[j][COL_U.RUT]);
      if (!rutLimpio) { sinRut++; continue; }

      var nombre     = String(dataU[j][COL_U.NOMBRE] || 'Socio').trim();
      var estadoRaw  = String(dataU[j][COL_U.ESTADO] || 'ACTIVO').trim().toUpperCase();
      var estadoNorm = (estadoRaw === 'ACTIVO' || estadoRaw === 'SI' || estadoRaw === 'TRUE') ? 'ACTIVO' : 'DESVINCULADO';

      var reg = mapaGame[rutLimpio];
      if (reg) {
        if (reg.nombre !== nombre || String(reg.estado || '').toUpperCase() !== estadoNorm) {
          sheetGame.getRange(reg.fila, COL_G.NOMBRE + 1).setValue(nombre);
          sheetGame.getRange(reg.fila, COL_G.ESTADO + 1).setValue(estadoNorm);
          actualizados++;
        }
      } else {
        nuevasFilas.push([rutLimpio, nombre, 0, GRADOS_SLIM[0].nombre, '[]', 0, 0, ahora, '', 0, estadoNorm, 0]);
        creados++;
      }
    }

    if (nuevasFilas.length > 0) {
      sheetGame.getRange(sheetGame.getLastRow() + 1, 1, nuevasFilas.length, nuevasFilas[0].length).setValues(nuevasFilas);
    }

    Logger.log('✅ SLIM Quest sincronizado | creados: ' + creados + ' | actualizados: ' + actualizados + ' | sin RUT: ' + sinRut);

  } catch (e) {
    Logger.log('❌ sincronizarSociosGamificacion: ' + e.toString());
  }
}

/** Reinstala solo el activador de sincronizacion. Correr desde el editor GAS. */
function configurarTriggerGamificacion() {
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === 'sincronizarSociosGamificacion') ScriptApp.deleteTrigger(trigger);
  });
  ScriptApp.newTrigger('sincronizarSociosGamificacion').timeBased().everyDays(1).atHour(1).create();
  Logger.log('✅ Activador diario configurado: sincronizarSociosGamificacion, 1 AM.');
}

// ==========================================
// CORREO DE SUBIDA DE NIVEL — DIPLOMA
// ==========================================
//
// El correo es un certificado: doble marco en el color del grado, medalla,
// nombre en serif, el mensaje y la frase propios del grado, la escalera
// completa y la barra de avance hacia el siguiente. Disenado el 23/09/2026
// (estilo "A · Diploma", elegido entre dos propuestas).
//
// Los colores, la frase, el mensaje y los umbrales salen de GRADOS_SLIM, no de
// una tabla propia: antes este correo tenia su copia de los datos y quedaba
// desactualizado cada vez que se movia un umbral.
//
// HTML de correo, no de pagina: todo con tablas y estilos en linea, sin flex
// ni fuentes web. Gmail descarta los <style> de cabecera en muchos casos y
// Outlook no entiende flex; asi se ve igual en ambos. Fondo claro fijo.
//
// Dirigente, el grado maximo, anuncia que "hay algo nuevo esperandote" sin
// nombrar el Nivel Secreto: su nombre vive solo en TEXTOS_SECRETO_QUEST y lo
// descubre el socio al entrar.

var MESES_DIPLOMA_ = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
                      'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function _dipEsc_(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** "CAMILA ANDREA DE LA FUENTE" -> "Camila Andrea de la Fuente". */
function _dipNombreLegible_(nombre) {
  var menores = { de: 1, del: 1, la: 1, las: 1, los: 1, y: 1 };
  return String(nombre || '').trim().toLowerCase().split(/\s+/).map(function(p, i) {
    if (i > 0 && menores[p]) return p;
    return p.charAt(0).toUpperCase() + p.slice(1);
  }).join(' ');
}

/** 15000 -> "15.000". */
function _dipFmt_(n) {
  return String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** "23 de septiembre de 2026", en la zona horaria del sindicato. */
function _dipFechaHoy_() {
  var ahora = new Date();
  var tz = CFG_QUEST.ZONA_HORARIA;
  return Utilities.formatDate(ahora, tz, 'd') + ' de ' +
         MESES_DIPLOMA_[Number(Utilities.formatDate(ahora, tz, 'M')) - 1] + ' de ' +
         Utilities.formatDate(ahora, tz, 'yyyy');
}

/** Tramo recorrido hacia el siguiente grado, 0..100. */
function _dipAvance_(g, sig, xp) {
  if (!sig) return 100;
  var p = (Number(xp) - g.minXP) / (sig.minXP - g.minXP) * 100;
  return Math.max(0, Math.min(100, Math.round(p)));
}

/**
 * La escalera de grados en una fila: los alcanzados en el color de su grado,
 * el actual destacado, los siguientes apagados.
 */
function _dipEscalera_(idx) {
  var celdas = GRADOS_SLIM.map(function(e, i) {
    var fondo, borde, texto, opac;
    if (i === idx)     { fondo = e.headerBg; borde = e.headerBg; texto = '#ffffff';   opac = '1'; }
    else if (i < idx)  { fondo = e.badgeBg;  borde = e.badgeBg;  texto = e.badgeText; opac = '1'; }
    else               { fondo = '#f8fafc';  borde = '#e2e8f0';  texto = '#94a3b8';   opac = '0.35'; }
    return '<td align="center" valign="top" width="16%" style="padding:0 2px;">' +
      '<div style="background:' + fondo + ';border:1px solid ' + borde + ';border-radius:10px;padding:8px 2px 7px;">' +
        '<div style="font-size:18px;line-height:22px;opacity:' + opac + ';">' + e.icono + '</div>' +
        '<div style="font-family:Arial,Helvetica,sans-serif;font-size:9px;line-height:12px;font-weight:bold;color:' + texto + ';margin-top:3px;">' + e.nombre + '</div>' +
      '</div></td>';
  }).join('');
  return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>' + celdas + '</tr></table>';
}

/** Barra de avance hecha con tabla: los clientes de correo no pintan <progress>. */
function _dipBarra_(pct, color) {
  var lleno = Math.max(pct, 2);
  return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-radius:99px;overflow:hidden;background:#e2e8f0;"><tr>' +
    '<td width="' + lleno + '%" style="background:' + color + ';height:8px;font-size:0;line-height:0;">&nbsp;</td>' +
    (lleno < 100 ? '<td style="height:8px;font-size:0;line-height:0;">&nbsp;</td>' : '') +
    '</tr></table>';
}

/**
 * HTML completo del diploma. Sin efectos: lo usan enviarCorreoNivel() y la
 * prueba desde el editor.
 *
 * @param {number} idx     indice del grado alcanzado en GRADOS_SLIM
 * @param {string} nombre  nombre del socio tal como viene de la hoja
 * @param {number} xp      puntos de formacion acumulados
 * @param {string} fecha   fecha ya formateada
 * @param {string} urlApp  enlace a SLIMAPP ('' = sin boton)
 */
function _construirHtmlDiplomaNivel_(idx, nombre, xp, fecha, urlApp) {
  var g = GRADOS_SLIM[idx], sig = GRADOS_SLIM[idx + 1] || null;
  var maximo = !sig;
  var marco = maximo ? '#b8860b' : g.color;
  var serif = "Georgia,'Times New Roman',Times,serif";
  var sans  = 'Arial,Helvetica,sans-serif';

  var proximo;
  if (maximo) {
    proximo =
      '<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:12px;padding:16px 18px;text-align:center;">' +
        '<div style="font-family:' + sans + ';font-size:10px;font-weight:bold;letter-spacing:2px;color:#92400e;text-transform:uppercase;">Grado máximo alcanzado</div>' +
        '<div style="font-family:' + serif + ';font-size:15px;color:#78350f;margin-top:6px;line-height:22px;">Completaste la escalera de SLIM Quest. <b>Hay algo nuevo esperándote</b> la próxima vez que entres: descúbrelo tú.</div>' +
      '</div>';
  } else {
    proximo =
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>' +
        '<td style="font-family:' + sans + ';font-size:10px;font-weight:bold;letter-spacing:1.5px;color:#64748b;text-transform:uppercase;">Próximo grado</td>' +
        '<td align="right" style="font-family:' + sans + ';font-size:12px;color:#334155;"><b>' + sig.icono + ' ' + sig.nombre + '</b> · faltan ' + _dipFmt_(Math.max(0, sig.minXP - xp)) + ' pts</td>' +
      '</tr></table>' +
      '<div style="margin-top:8px;">' + _dipBarra_(_dipAvance_(g, sig, xp), g.color) + '</div>';
  }

  var boton = urlApp
    ? '<tr><td align="center" style="padding:6px 36px 30px;">' +
        '<a href="' + _dipEsc_(urlApp) + '" style="display:inline-block;background:' + g.headerBg + ';color:#ffffff;font-family:' + sans + ';font-size:14px;font-weight:bold;text-decoration:none;padding:13px 28px;border-radius:10px;">Seguir aprendiendo en SLIM Quest</a>' +
      '</td></tr>'
    : '';

  return '<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>Diploma SLIM Quest</title></head>' +
  '<body style="margin:0;padding:0;background:' + g.badgeBg + ';">' +
  '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:' + g.badgeBg + ';"><tr><td align="center" style="padding:28px 12px;">' +

  '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#ffffff;border:6px double ' + marco + ';border-radius:6px;">' +
  '<tr><td style="padding:6px;">' +
  '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ' + marco + '55;border-radius:2px;">' +

    '<tr><td align="center" style="background:' + g.headerBg + ';padding:12px 16px;">' +
      '<span style="font-family:' + sans + ';font-size:10px;font-weight:bold;letter-spacing:3px;color:#ffffff;text-transform:uppercase;">SLIM Quest &nbsp;·&nbsp; Sindicato SLIM N°3</span>' +
    '</td></tr>' +

    '<tr><td align="center" style="padding:34px 24px 6px;">' +
      '<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" valign="middle" width="104" height="104" style="width:104px;height:104px;border-radius:52px;background:' + g.badgeBg + ';border:4px solid ' + marco + ';font-size:54px;line-height:104px;">' + g.icono + '</td></tr></table>' +
    '</td></tr>' +

    '<tr><td align="center" style="padding:18px 30px 0;">' +
      '<div style="font-family:' + sans + ';font-size:11px;font-weight:bold;letter-spacing:4px;color:' + g.color + ';text-transform:uppercase;">Certificado de grado</div>' +
      '<div style="font-family:' + serif + ';font-size:15px;font-style:italic;color:#64748b;margin-top:16px;">Se otorga a</div>' +
      '<div style="font-family:' + serif + ';font-size:28px;line-height:36px;color:#0f172a;margin-top:6px;">' + _dipEsc_(_dipNombreLegible_(nombre)) + '</div>' +
      '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:12px auto 0;"><tr><td width="140" style="border-top:2px solid ' + marco + ';font-size:0;line-height:0;">&nbsp;</td></tr></table>' +
      '<div style="font-family:' + serif + ';font-size:15px;font-style:italic;color:#64748b;margin-top:14px;">por alcanzar el grado de</div>' +
      '<div style="font-family:' + serif + ';font-size:30px;line-height:38px;letter-spacing:3px;color:' + g.headerBg + ';text-transform:uppercase;margin-top:4px;">' + g.nombre + '</div>' +
      '<div style="font-family:' + sans + ';font-size:11px;color:#94a3b8;margin-top:4px;">Grado ' + (idx + 1) + ' de ' + GRADOS_SLIM.length + '</div>' +
    '</td></tr>' +

    '<tr><td style="padding:22px 36px 0;">' +
      '<p style="font-family:' + sans + ';font-size:14px;line-height:23px;color:#334155;margin:0;text-align:center;">' + _dipEsc_(g.msg) + '</p>' +
    '</td></tr>' +

    '<tr><td style="padding:20px 36px 0;">' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:' + g.badgeBg + ';border-radius:12px;"><tr><td style="padding:16px 20px;">' +
        '<div style="font-family:' + serif + ';font-size:34px;line-height:20px;color:' + g.color + ';">&ldquo;</div>' +
        '<div style="font-family:' + serif + ';font-size:15px;font-style:italic;line-height:23px;color:' + g.badgeText + ';">' + _dipEsc_(g.quote) + '</div>' +
      '</td></tr></table>' +
    '</td></tr>' +

    '<tr><td style="padding:22px 36px 0;">' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>' +
        '<td align="center" width="50%" style="border-right:1px solid #e2e8f0;padding:4px;">' +
          '<div style="font-family:' + serif + ';font-size:24px;color:' + g.headerBg + ';">' + _dipFmt_(xp) + '</div>' +
          '<div style="font-family:' + sans + ';font-size:10px;letter-spacing:1px;color:#94a3b8;text-transform:uppercase;margin-top:2px;">Puntos de formación</div>' +
        '</td>' +
        '<td align="center" width="50%" style="padding:4px;">' +
          '<div style="font-family:' + serif + ';font-size:16px;line-height:29px;color:' + g.headerBg + ';">' + _dipEsc_(fecha) + '</div>' +
          '<div style="font-family:' + sans + ';font-size:10px;letter-spacing:1px;color:#94a3b8;text-transform:uppercase;margin-top:2px;">Fecha de obtención</div>' +
        '</td>' +
      '</tr></table>' +
    '</td></tr>' +

    '<tr><td style="padding:24px 30px 0;">' +
      '<div style="font-family:' + sans + ';font-size:10px;font-weight:bold;letter-spacing:1.5px;color:#64748b;text-transform:uppercase;text-align:center;margin-bottom:10px;">Tu camino en SLIM Quest</div>' +
      _dipEscalera_(idx) +
    '</td></tr>' +

    '<tr><td style="padding:22px 36px 26px;">' + proximo + '</td></tr>' +

    boton +

    '<tr><td align="center" style="border-top:1px solid #f1f5f9;padding:18px 24px 20px;">' +
      '<div style="font-family:' + serif + ';font-size:13px;color:#475569;">Sindicato de Trabajadores SLIM N°3</div>' +
      '<div style="font-family:' + sans + ';font-size:10px;color:#94a3b8;margin-top:4px;">Programa de formación sindical SLIM Quest</div>' +
    '</td></tr>' +

  '</table></td></tr></table>' +

  '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;"><tr><td align="center" style="padding:14px 12px 0;font-family:' + sans + ';font-size:11px;line-height:17px;color:#64748b;">' +
    'Mensaje automático de SLIMAPP · Por favor, no respondas a este correo.' +
  '</td></tr></table>' +

  '</td></tr></table></body></html>';
}

function enviarCorreoNivel(correo, nombre, gradoNuevo, xpTotal) {
  _ensureConfig();
  // Un diploma que no sale tiene que dejar rastro: antes estos dos retornos
  // eran silenciosos, y un socio que subia de grado sin correo registrado no
  // aparecia en ninguna parte (se noto el 23/09/2026: una cuenta de prueba
  // subio a Dirigente y el diploma no llego, sin nada que dijera por que).
  // Se registra el grado y el nombre, nunca la direccion invalida.
  if (!correo || !esCorreoValido(correo)) {
    Logger.log('⚠️ Diploma de ' + gradoNuevo + ' NO enviado a ' + nombre + ': sin correo válido registrado.');
    return;
  }

  var idx = -1;
  for (var i = 0; i < GRADOS_SLIM.length; i++) { if (GRADOS_SLIM[i].nombre === gradoNuevo) { idx = i; break; } }
  if (idx === -1) {
    Logger.log('⚠️ Diploma NO enviado a ' + nombre + ': el grado "' + gradoNuevo + '" no existe en GRADOS_SLIM.');
    return;
  }

  var g = GRADOS_SLIM[idx];
  var html = _construirHtmlDiplomaNivel_(idx, nombre, xpTotal, _dipFechaHoy_(), WEBAPP_BASE_URL || '');

  try {
    MailApp.sendEmail({
      to: correo,
      subject: g.icono + ' ¡Subiste a ' + g.nombre + '! Tu certificado de SLIM Quest',
      htmlBody: html,
      name: 'Sindicato SLIM N°3'
    });
    Logger.log('📧 Correo de nivel enviado a ' + correo + ' — ' + g.nombre);
  } catch (e) {
    Logger.log('⚠️ Error enviando correo de nivel: ' + e.toString());
  }
}

/**
 * Diploma de graduacion de la Escuela de Formacion Dirigencial. Misma factura
 * que el diploma de grado (tablas y estilos en linea), en dorado e indigo, con
 * el avance de las tres ramas. Sin efectos: lo usan el envio real y la prueba.
 */
function _construirHtmlDiplomaEscuela_(nombre, prog, fecha, urlApp) {
  var serif = "Georgia,'Times New Roman',Times,serif";
  var sans  = 'Arial,Helvetica,sans-serif';
  var oro = '#b8860b', indigo = '#1e1b4b';

  var celdas = prog.ramas.map(function(r) {
    return '<td align="center" valign="top" width="33%" style="padding:0 3px;">' +
      '<div style="background:' + r.def.bg + ';border-radius:10px;padding:10px 4px 9px;">' +
        '<div style="font-size:20px;line-height:24px;">' + r.def.emoji + '</div>' +
        '<div style="font-family:' + sans + ';font-size:10px;line-height:13px;font-weight:bold;color:' + r.def.tx + ';margin-top:4px;">' + r.def.corto + '</div>' +
        '<div style="font-family:' + sans + ';font-size:10px;line-height:13px;color:' + r.def.tx + ';">' + r.dominadas + ' de ' + r.total + '</div>' +
      '</div></td>';
  }).join('');

  var boton = urlApp
    ? '<tr><td align="center" style="padding:6px 36px 30px;">' +
        '<a href="' + _dipEsc_(urlApp) + '" style="display:inline-block;background:' + indigo + ';color:#f5d060;font-family:' + sans + ';font-size:14px;font-weight:bold;text-decoration:none;padding:13px 28px;border-radius:10px;">Ver mi escuela en SLIM Quest</a>' +
      '</td></tr>'
    : '';

  return '<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>Graduación SLIM Quest</title></head>' +
  '<body style="margin:0;padding:0;background:#fef3c7;">' +
  '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#fef3c7;"><tr><td align="center" style="padding:28px 12px;">' +

  '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#ffffff;border:6px double ' + oro + ';border-radius:6px;">' +
  '<tr><td style="padding:6px;">' +
  '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ' + oro + '55;border-radius:2px;">' +

    '<tr><td align="center" style="background:' + indigo + ';padding:12px 16px;">' +
      '<span style="font-family:' + sans + ';font-size:10px;font-weight:bold;letter-spacing:3px;color:#f5d060;text-transform:uppercase;">SLIM Quest &nbsp;·&nbsp; Sindicato SLIM N°3</span>' +
    '</td></tr>' +

    '<tr><td align="center" style="padding:34px 24px 6px;">' +
      '<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" valign="middle" width="104" height="104" style="width:104px;height:104px;border-radius:52px;background:#fffbeb;border:4px solid ' + oro + ';font-size:54px;line-height:104px;">🎓</td></tr></table>' +
    '</td></tr>' +

    '<tr><td align="center" style="padding:18px 30px 0;">' +
      '<div style="font-family:' + sans + ';font-size:11px;font-weight:bold;letter-spacing:4px;color:' + oro + ';text-transform:uppercase;">Certificado de graduación</div>' +
      '<div style="font-family:' + serif + ';font-size:15px;font-style:italic;color:#64748b;margin-top:16px;">Se otorga a</div>' +
      '<div style="font-family:' + serif + ';font-size:28px;line-height:36px;color:#0f172a;margin-top:6px;">' + _dipEsc_(_dipNombreLegible_(nombre)) + '</div>' +
      '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:12px auto 0;"><tr><td width="140" style="border-top:2px solid ' + oro + ';font-size:0;line-height:0;">&nbsp;</td></tr></table>' +
      '<div style="font-family:' + serif + ';font-size:15px;font-style:italic;color:#64748b;margin-top:14px;">por completar la</div>' +
      '<div style="font-family:' + serif + ';font-size:24px;line-height:32px;letter-spacing:1px;color:' + indigo + ';margin-top:4px;">' + ESCUELA_DIRIGENCIAL.titulo + '</div>' +
    '</td></tr>' +

    '<tr><td style="padding:22px 36px 0;">' +
      '<p style="font-family:' + sans + ';font-size:14px;line-height:23px;color:#334155;margin:0;text-align:center;">Dominaste las tres ramas de la escuela: conducción sindical, negociación colectiva y economía política. Es la formación que la organización espera de quien la conduce.</p>' +
    '</td></tr>' +

    '<tr><td style="padding:22px 30px 0;">' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>' + celdas + '</tr></table>' +
    '</td></tr>' +

    '<tr><td style="padding:22px 36px 0;">' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#fffbeb;border-radius:12px;"><tr><td style="padding:16px 20px;">' +
        '<div style="font-family:' + serif + ';font-size:34px;line-height:20px;color:' + oro + ';">&ldquo;</div>' +
        '<div style="font-family:' + serif + ';font-size:15px;font-style:italic;line-height:23px;color:#78350f;">La conducción de una organización se aprende: nadie nace sabiendo negociar, y nadie debería tener que improvisarlo.</div>' +
      '</td></tr></table>' +
    '</td></tr>' +

    '<tr><td align="center" style="padding:22px 36px 26px;">' +
      '<div style="font-family:' + serif + ';font-size:16px;color:' + indigo + ';">' + _dipEsc_(fecha) + '</div>' +
      '<div style="font-family:' + sans + ';font-size:10px;letter-spacing:1px;color:#94a3b8;text-transform:uppercase;margin-top:2px;">Fecha de graduación</div>' +
    '</td></tr>' +

    boton +

    '<tr><td align="center" style="border-top:1px solid #f1f5f9;padding:18px 24px 20px;">' +
      '<div style="font-family:' + serif + ';font-size:13px;color:#475569;">Sindicato de Trabajadores SLIM N°3</div>' +
      '<div style="font-family:' + sans + ';font-size:10px;color:#94a3b8;margin-top:4px;">Programa de formación sindical SLIM Quest</div>' +
    '</td></tr>' +

  '</table></td></tr></table>' +

  '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;"><tr><td align="center" style="padding:14px 12px 0;font-family:' + sans + ';font-size:11px;line-height:17px;color:#64748b;">' +
    'Mensaje automático de SLIMAPP · Por favor, no respondas a este correo.' +
  '</td></tr></table>' +

  '</td></tr></table></body></html>';
}

function enviarCorreoGraduacionEscuela_(correo, nombre, prog) {
  _ensureConfig();
  if (!correo || !esCorreoValido(correo)) {
    Logger.log('⚠️ Diploma de graduación de la escuela NO enviado a ' + nombre + ': sin correo válido registrado.');
    return;
  }
  try {
    MailApp.sendEmail({
      to: correo,
      subject: '🎓 Te graduaste de la ' + ESCUELA_DIRIGENCIAL.titulo + ' — SLIM Quest',
      htmlBody: _construirHtmlDiplomaEscuela_(nombre, prog, _dipFechaHoy_(), WEBAPP_BASE_URL || ''),
      name: 'Sindicato SLIM N°3'
    });
    Logger.log('📧 Diploma de graduación de la escuela enviado a ' + correo);
  } catch (e) {
    Logger.log('⚠️ Error enviando el diploma de graduación: ' + e.toString());
  }
}

/**
 * Prueba desde el editor: manda el diploma de los cinco grados a los que se
 * puede subir (Aprendiz a Dirigente) y el de graduacion de la escuela a UNA
 * casilla, con datos de ejemplo.
 *
 * Puerta autoclausurante: crear la propiedad de script
 * PERMITIR_PRUEBA_DIPLOMA con el CORREO de destino como valor. Se borra antes
 * de enviar nada, asi que esta funcion sin argumentos — invocable desde la
 * consola del navegador en este webapp anonimo — no puede usarse para mandar
 * correos a quien se quiera.
 */
function _probarDiplomaNivelDesdeEditor() {
  _ensureConfig();
  var props = PropertiesService.getScriptProperties();
  var destino = String(props.getProperty('PERMITIR_PRUEBA_DIPLOMA') || '').trim();
  props.deleteProperty('PERMITIR_PRUEBA_DIPLOMA');

  if (!destino || !esCorreoValido(destino)) {
    Logger.log('⛔ Puerta cerrada. Crea la propiedad de script PERMITIR_PRUEBA_DIPLOMA ' +
               'con tu correo como valor y vuelve a ejecutar.');
    return;
  }

  var fecha = _dipFechaHoy_();
  for (var i = 1; i < GRADOS_SLIM.length; i++) {
    var g = GRADOS_SLIM[i];
    var html = _construirHtmlDiplomaNivel_(i, 'SOCIA DE PRUEBA', g.minXP + 180, fecha, WEBAPP_BASE_URL || '');
    MailApp.sendEmail({
      to: destino,
      subject: '[PRUEBA] ' + g.icono + ' ¡Subiste a ' + g.nombre + '! Tu certificado de SLIM Quest',
      htmlBody: html,
      name: 'Sindicato SLIM N°3'
    });
  }
  // Graduacion, con el banco real y todas las ramas como dominadas.
  var banco = _leerBancoQuest_();
  var todas = banco.filter(function(p) { return p.nivel === 'DIRIGENTE'; }).map(function(p) { return p.id; });
  MailApp.sendEmail({
    to: destino,
    subject: '[PRUEBA] 🎓 Te graduaste de la ' + ESCUELA_DIRIGENCIAL.titulo + ' — SLIM Quest',
    htmlBody: _construirHtmlDiplomaEscuela_('SOCIA DE PRUEBA', _progresoEscuela_(banco, todas, []), fecha, WEBAPP_BASE_URL || ''),
    name: 'Sindicato SLIM N°3'
  });
  Logger.log('📧 Enviados ' + GRADOS_SLIM.length + ' diplomas de prueba (5 de grado + graduación) a ' + destino);
}

// ==========================================
// MANTENCION
// ==========================================

/**
 * Normaliza la columna XP del banco segun el nivel de cada pregunta.
 *
 * Escribe sobre el banco, asi que exige un ADMIN: sin la reja, al ser una
 * funcion global de un webapp ANYONE_ANONYMOUS, cualquiera podia reescribir el
 * puntaje de las 191 preguntas desde la consola.
 *
 * `aplicarCambios` en false (por defecto) solo simula.
 */
function normalizarXpBancoPreguntas(rutSolicitante, aplicarCambios) {
  _ensureConfig();
  try {
    var permiso = verificarRolUsuario(rutSolicitante, ['ADMIN']);
    if (!permiso.autorizado) return { success: false, message: 'No autorizado.' };

    var sheet   = getSheet('GAMIFICACION', 'BANCO_PREGUNTAS');
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return { success: true, message: 'Banco vacío.', actualizadas: 0 };

    var COL  = CONFIG.COLUMNAS.BANCO_PREGUNTAS;
    var data = sheet.getRange(2, 1, lastRow - 1, COL.FUENTE + 1).getDisplayValues();
    var actualizadas = 0, sinCambio = 0, nivelDesconocido = [];

    for (var i = 0; i < data.length; i++) {
      var nivel   = String(data[i][COL.NIVEL] || '').toUpperCase().trim();
      var xpNuevo = XP_POR_NIVEL_QUEST[nivel];
      if (!xpNuevo) { nivelDesconocido.push('fila ' + (i + 2) + ': "' + nivel + '"'); continue; }
      if ((parseInt(data[i][COL.XP], 10) || 0) === xpNuevo) { sinCambio++; continue; }
      if (aplicarCambios === true) sheet.getRange(i + 2, COL.XP + 1).setValue(xpNuevo);
      actualizadas++;
    }

    var msg = (aplicarCambios === true ? 'Aplicado' : 'SIMULACIÓN') +
      ' | a actualizar: ' + actualizadas + ' | sin cambio: ' + sinCambio + ' | nivel desconocido: ' + nivelDesconocido.length;
    Logger.log('🔧 normalizarXpBancoPreguntas — ' + msg);
    if (nivelDesconocido.length) Logger.log('   ' + nivelDesconocido.join(' | '));
    return { success: true, message: msg, actualizadas: actualizadas, sinCambio: sinCambio, nivelDesconocido: nivelDesconocido };

  } catch (e) {
    Logger.log('❌ normalizarXpBancoPreguntas: ' + e.toString());
    return { success: false, message: 'Error: ' + e.toString() };
  }
}

/**
 * Radiografia del modulo para correr a mano desde el editor GAS.
 *
 * No recibe ni devuelve nada: es una funcion global de un webapp anonimo y el
 * informe nombra socios y cuenta preguntas — dejarlo en el Logger mantiene ese
 * dato dentro del proyecto. Mismo criterio que
 * `_verificarEvidenciaNotificacionPermisosDesdeEditor()`.
 */
function _diagnosticarSlimQuest() {
  _ensureConfig();
  var log = ['=== DIAGNOSTICO SLIM QUEST ==='];

  try {
    log.push('Módulo habilitado: ' + _switchHabilitado('slimquest_habilitado').habilitado);

    var trigger = ScriptApp.getProjectTriggers().filter(function(t) { return t.getHandlerFunction() === 'sincronizarSociosGamificacion'; });
    log.push('Activador de sincronización: ' + (trigger.length ? 'INSTALADO (' + trigger.length + ')' : '❌ AUSENTE — corre configurarTriggerGamificacion()'));

    var banco = _leerBancoQuest_();
    var porNivel = {}, porCategoria = {};
    banco.forEach(function(p) {
      porNivel[p.nivel]         = (porNivel[p.nivel] || 0) + 1;
      porCategoria[p.categoria] = (porCategoria[p.categoria] || 0) + 1;
    });
    log.push('--- BANCO: ' + banco.length + ' preguntas activas y bien formadas ---');
    Object.keys(porNivel).sort().forEach(function(n) { log.push('   nivel ' + n + ': ' + porNivel[n]); });
    Object.keys(porCategoria).sort().forEach(function(c) { log.push('   categoría ' + c + ': ' + porCategoria[c]); });

    // ¿Alcanza el banco para la cuota diaria de cada grado?
    Object.keys(PESOS_QUIZ_POR_GRADO).forEach(function(grado) {
      var pesos = PESOS_QUIZ_POR_GRADO[grado];
      var faltas = [];
      ['BASICO', 'INTERMEDIO', 'AVANZADO'].forEach(function(n) {
        if (pesos[n] > 0 && (porNivel[n] || 0) < pesos[n]) faltas.push(n);
      });
      if (faltas.length) log.push('   ⚠️ ' + grado + ': el banco no cubre su cuota de ' + faltas.join(', ') + ' (se rellena con otros niveles)');
    });

    var ids = {}, duplicados = [];
    banco.forEach(function(p) { if (ids[p.id]) duplicados.push(p.id); else ids[p.id] = true; });
    if (duplicados.length) log.push('   ⚠️ IDs duplicados (rompen el anti-repetición): ' + duplicados.join(', '));

    var sinExplicacion = banco.filter(function(p) { return !p.explicacion.trim(); }).length;
    var sinFuente      = banco.filter(function(p) { return !p.fuente.trim(); }).length;
    if (sinExplicacion) log.push('   ⚠️ ' + sinExplicacion + ' preguntas sin explicación (el socio no aprende del error)');
    if (sinFuente)      log.push('   ℹ️ ' + sinFuente + ' preguntas sin fuente');

    var hoja = _hojaEstadoQuest_();
    log.push('--- HOJA ' + CFG_QUEST.HOJA_ESTADO + ': ' + (hoja ? (Math.max(hoja.getLastRow() - 1, 0)) + ' socios con estado' : '❌ no disponible') + ' ---');

    var sheet = getSheet('GAMIFICACION', 'GAMIFICACION');
    if (sheet) {
      var COL = CONFIG.COLUMNAS.GAMIFICACION;
      var lastRow = sheet.getLastRow();
      if (lastRow >= 2) {
        var data = sheet.getRange(2, 1, lastRow - 1, COL.ESTADO + 1).getDisplayValues();
        var activos = 0, conXp = 0, jugaronHoy = 0;
        var hoy = _hoyQuest_();
        data.forEach(function(f) {
          if (String(f[COL.ESTADO] || '').toUpperCase().trim() === 'DESVINCULADO') return;
          activos++;
          if ((parseInt(f[COL.XP_TOTAL], 10) || 0) > 0) conXp++;
          if (String(f[COL.QUIZ_ULTIMO_DIA] || '').trim() === hoy) jugaronHoy++;
        });
        log.push('--- SOCIOS: ' + activos + ' activos | ' + conXp + ' con XP | ' + jugaronHoy + ' jugaron hoy ---');
      }
    }
  } catch (e) {
    log.push('❌ ' + e.toString());
  }

  Logger.log(log.join('\n'));
}

// ==========================================
// SWITCHES DE MODULOS RELACIONADOS
// ==========================================

function obtenerEstadoSwitchSlimQuest() {
  return _switchHabilitado('slimquest_habilitado');
}

// Solo ADMIN (validado en _toggleSwitchModulo).
function toggleSwitchSlimQuest(estado, rutSolicitante) {
  return _toggleSwitchModulo('slimquest_habilitado', estado, rutSolicitante);
}

function obtenerEstadoSwitchCalculadora() {
  return _switchHabilitado('calculadora_habilitada');
}

// Solo ADMIN (validado en _toggleSwitchModulo).
function toggleSwitchCalculadora(estado, rutSolicitante) {
  return _toggleSwitchModulo('calculadora_habilitada', estado, rutSolicitante);
}

function obtenerEstadoSwitchContratoColectivo() {
  return _switchHabilitado('contrato_colectivo_habilitado');
}

// Solo ADMIN (validado en _toggleSwitchModulo).
function toggleSwitchContratoColectivo(estado, rutSolicitante) {
  return _toggleSwitchModulo('contrato_colectivo_habilitado', estado, rutSolicitante);
}
