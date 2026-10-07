# `banco/` — copia de trabajo del BANCO_PREGUNTAS

Aquí vive el contenido del banco de preguntas de SLIM Quest **como código**: en
git, con historial y diffs, y validable antes de que ningún socio lo vea.

**No se sube al proyecto GAS.** `.claspignore` excluye esta carpeta, por dos
razones: serían ~266 KB (+25% del bundle) que Apps Script parsea en *cada*
ejecución del webapp, para un dato que se toca unas pocas veces al año; y GAS
solo admite `appsscript.json` como archivo `.json`.

## Quién manda

**La planilla es la fuente de verdad en runtime**, y se sigue pudiendo editar a
mano — desactivar una pregunta con `ACTIVA`, afinar un `XP`, corregir un texto.
Este archivo es una copia de trabajo, no un reemplazo.

De ahí que la sincronización sea asimétrica a propósito:

| Sentido | Cómo | Dónde |
|---|---|---|
| **Hoja → archivo** | Volcado completo | `exportarBancoPreguntas()` en `BancoPreguntasSync.js` |
| **Archivo → hoja** | Nunca completo: se genera un parche acotado, se revisa y se aplica | parche nuevo en la raíz, con `CargaPreguntasQuest.js` (altas) o `CorregirOpcionesQuest.js` (alternativas) de modelo; están en el historial de git (`git show 2475990:<archivo>`) |

Un "reemplazar todo" en sentido inverso borraría en silencio cualquier ajuste
hecho a mano en la planilla, y nadie se enteraría hasta que un socio se topara
con la pregunta.

## El flujo

1. **Exportar** para partir de lo que hay hoy en la hoja (por si alguien la
   editó desde la última vez).
2. **Editar** `preguntas.json` — redactar altas, corregir textos.
3. **Validar** con `node banco/validar.js`. No es opcional: es lo que detecta
   los dos sesgos que ya mordieron a este banco (ver abajo).
4. **Generar el parche** con solo lo que cambió, revisarlo y aplicarlo desde el
   editor GAS.

## Los dos sesgos que hay que vigilar

Ambos ya ocurrieron en este banco, así que `validar.js` los mide siempre:

- **La letra.** El banco original tenía la respuesta en `B` en 177 de 190
  preguntas (93%). Marcar "B" a ciegas sacaba 93%. Hoy lo neutraliza
  `_barajarOpcionesQuest_()` en cada quiz, así que es un problema cosmético,
  pero conviene no reintroducirlo.
- **La longitud, que es el grave.** El barajado permuta las *posiciones*, no los
  *largos*: si la correcta es sistemáticamente la más extensa, "marcar la más
  larga" pasa a ser una estrategia ganadora y el ranking mide viveza en vez de
  formación. En 133 de las 190 originales la correcta superaba en más de un 35%
  al mejor distractor (165 caracteres contra 60-80). Se corrigió el 09/09/2026.

El detalle que se pierde al acortar una alternativa no se pierde: va en
`explicacion`, que el socio lee **después** de responder, que es cuando enseña.
Una alternativa larga no enseña, delata.
