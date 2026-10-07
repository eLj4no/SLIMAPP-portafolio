# SLIMAPP — Plataforma de gestión sindical

Aplicación web en producción para el **Sindicato SLIM N°3** (Chile), que digitaliza los trámites de sus socios y la gestión interna de la directiva. Corre sobre **Google Apps Script** con Google Sheets como base de datos y Google Drive como almacenamiento de documentos.

> Este repositorio es una **versión pública y sanitizada** del proyecto, publicada como portafolio. Los IDs de planillas y carpetas, las URLs de despliegue, los correos y cualquier dato personal se reemplazaron por marcadores o se retiraron. No contiene datos de socios.

## Versión demo

Esta copia corre en **modo demo** (`MODO_DEMO = true` en `Global.js`): es un cascarón que muestra todas las interfaces y flujos, sin datos reales y sin enviar correos.

| | En la demo |
|---|---|
| **Acceso** | Cuentas ficticias: `11.111.111-1` (socio) y `22.222.222-2` (administrador), contraseña `DEMO`. El login trae botones de acceso rápido. |
| **SLIM Quest** | Funciona de verdad contra una planilla de juego propia de la demo. Cada ingreso recibe una identidad de visitante, así que cada persona tiene su quiz diario y aparece en el ranking. |
| **Noticias** | Lee una planilla de noticias si está configurada; si está vacía, muestra noticias de ejemplo. No se pueden publicar ni editar. |
| **Resto de módulos** | Préstamos, justificaciones, apelaciones, permisos médicos, trámites, denuncias, participación, foro, credencial y panel de administración muestran datos ficticios. Enviar, modificar o eliminar responde con un aviso de demo. |

**Cómo se protege** (en el servidor, que es lo que un visitante no puede alterar desde el navegador):

- `getSpreadsheet()` solo abre las planillas de `DEMO_SPREADSHEETS_PERMITIDAS` (juego y noticias). Los IDs de las demás, las carpetas de Drive y los correos institucionales se vacían al cargar la configuración, aunque existan en las propiedades del script.
- El manifiesto (`appsscript.json`) solo pide el scope de **Sheets**: sin Gmail, MailApp, Drive, activadores ni peticiones externas. Además, cada envío de correo y cada subida a Drive se corta antes de ejecutarse.
- El servidor no reconoce privilegios: la cuenta "admin demo" solo desbloquea las pantallas de administración en el navegador. Respaldos, restauraciones, interruptores de módulo y publicación de noticias quedan rechazados.
- Los activadores programados nunca corren.

La capa de datos ficticios está al inicio de `Index.html` (*CAPA DEMO*): intercepta `google.script.run`, deja pasar al servidor solo login, SLIM Quest y noticias, y responde el resto con datos de ejemplo. Si se abre `Index.html` directamente en el navegador (sin Apps Script), toda la demo funciona con esos datos, salvo SLIM Quest.

## Funcionalidades

| Módulo | Qué resuelve |
|---|---|
| Inicio de sesión y Mis Datos | Acceso por RUT, perfil, datos bancarios, tallas de vestuario, credencial |
| Préstamos | Solicitud de préstamos de emergencia y vacaciones con validación de elegibilidad |
| Justificaciones y Apelaciones | Justificación de inasistencias y apelación de multas, con adjuntos |
| Permisos médicos | Registro de licencias con notificación consolidada a los responsables |
| Trámites a la empresa | Asistente de 4 pasos que genera y envía un correo formal con adjuntos |
| Denuncias | Canal interno de denuncias con trazabilidad |
| Asistencia y participación | Calendario anual de participación por socio e informe de faltas |
| Beneficio por fallecimiento | Designación de beneficiarios con revisión de documentos |
| Noticias y Foro | Carrusel de noticias y foro de la comunidad con moderación |
| SLIM Quest | Módulo de formación gamificado: quiz diario, niveles, logros y ranking (banco de 300+ preguntas) |
| Panel de administración | Roles, interruptores por módulo, respaldos y restauración, auditoría de permisos de Drive |

## Stack y arquitectura

- **Backend:** Google Apps Script (V8). 23 módulos `.js` planos, sin clases; cada módulo agrupa las funciones de su dominio.
- **Frontend:** SPA en un solo `Index.html` con Tailwind CSS, SweetAlert2 y Material Icons, sin bundler. Se comunica con el servidor exclusivamente por `google.script.run`.
- **Datos:** Google Sheets como base de datos (una planilla por dominio) y Google Drive para documentos.
- **Herramientas:** [clasp](https://github.com/google/clasp) para desarrollo local, Git para control de versiones, entornos DEV y PRODUCCIÓN separados.
- **Tamaño:** ~46.000 líneas.

### Decisiones de diseño destacadas

- **Configuración centralizada fuera del código.** Ningún ID, nombre de hoja o índice de columna está escrito en duro: todo vive en un objeto `CONFIG` que se carga en forma diferida desde `PropertiesService` (`_ensureConfig()` en `Global.js`). Ver `config_local.example.js`.
- **Sesiones del lado del servidor.** Tokens opacos en `CacheService` para resolver la identidad de quien llama sin confiar en datos enviados por el navegador.
- **Permisos de Drive silenciosos y por rol.** Los documentos se comparten con cuentas institucionales por rol, nunca con correos personales, y sin el correo nativo de Google. Un módulo de auditoría reconcilia los permisos existentes.
- **Notificaciones consolidadas.** Un solo correo por evento con destinatarios en Para/CC, en lugar de envíos repetidos, sobre una plantilla HTML común.
- **Activadores protegidos por entorno.** Los procesos programados solo se ejecutan en el proyecto de producción, para que una copia de desarrollo nunca actúe sobre datos reales.
- **Respaldos y trazabilidad.** Respaldo de las bases de datos, y copia de cada registro eliminado con quién y cuándo lo eliminó.
- **Control de concurrencia** con `LockService` en las operaciones críticas.

## Estructura

```
Global.js                 Configuración, utilidades compartidas, correo, sesiones, permisos
Index.html                Interfaz completa (SPA)
Modulo <dominio>.js       Un archivo por módulo funcional
BancoPreguntasSync.js     Sincronización del banco de preguntas
banco/                    Banco de preguntas de SLIM Quest (JSON) y su validador
config_local.example.js   Plantilla de configuración (sin valores reales)
appsscript.json           Manifiesto de Apps Script
```

## Puesta en marcha

### Desplegar la demo

1. **Usar una cuenta de Google aparte**, sin acceso a las planillas de producción. La aplicación web se ejecuta como quien la despliega: con una cuenta aislada, la demo no puede alcanzar datos reales aunque fallara todo lo demás.
2. En esa cuenta, crear la planilla del juego: una copia de la planilla de gamificación que conserva `BANCO_PREGUNTAS` y `BANCO_ESCENARIOS`, y en la que se **borran las filas de socios** de `BD_GAMIFICACION`, `QUEST_ESTADO` y `ESCENARIOS_INTENTOS` (quedan solo los encabezados). Opcional: una planilla de noticias.
3. Crear un proyecto de Apps Script y copiar `.clasp.json.example` como `.clasp.json` con su Script ID.
4. Copiar `config_local.example.js` como `config_local.js` y completar **solo** `SS_GAMIFICACION` (y `SS_NOTICIAS` si corresponde). Las demás claves pueden quedar con el marcador: en modo demo se ignoran.
5. `clasp push`, ejecutar `inicializarConfiguracion()` una vez desde el editor, autorizar (solo pedirá acceso a Sheets) y desplegar como aplicación web.

### Proyecto completo (producción)

Cambiar `MODO_DEMO` a `false` en `Global.js`, restaurar los scopes y el servicio avanzado de Drive en `appsscript.json` (ver historial de git) y completar todos los IDs en `config_local.js`.

## Autor

Desarrollado por **Alejandro Peñailillo** ([@eLj4no](https://github.com/eLj4no)).
