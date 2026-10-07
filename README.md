# SLIMAPP — Plataforma de gestión sindical

Aplicación web en producción para el **Sindicato SLIM N°3** (Chile), que digitaliza los trámites de sus socios y la gestión interna de la directiva. Corre sobre **Google Apps Script** con Google Sheets como base de datos y Google Drive como almacenamiento de documentos.

> Este repositorio es una **versión pública y sanitizada** del proyecto, publicada como portafolio. Los IDs de planillas y carpetas, las URLs de despliegue, los correos y cualquier dato personal se reemplazaron por marcadores o se retiraron. No contiene datos de socios.

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

1. Crear un proyecto de Apps Script y copiar `.clasp.json.example` como `.clasp.json` con su Script ID.
2. Copiar `config_local.example.js` como `config_local.js` y completar los IDs de las planillas y carpetas propias.
3. `clasp push`, ejecutar `inicializarConfiguracion()` una vez desde el editor y desplegar como aplicación web.

## Autor

Desarrollado por **Alejandro Peñailillo** ([@eLj4no](https://github.com/eLj4no)).
