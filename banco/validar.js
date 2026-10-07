#!/usr/bin/env node
// Valida banco/preguntas.json antes de generar cualquier parche.
//
//   node banco/validar.js
//
// Sale con codigo 1 si hay errores (rompen el quiz) y 0 si solo hay avisos.
// Los avisos son de contenido: no rompen nada, pero degradan el banco.

const fs = require('fs');
const path = require('path');

const ARCHIVO = path.join(__dirname, 'preguntas.json');
const LETRAS = ['A', 'B', 'C', 'D'];

// Un distractor no puede ser mucho mas corto que la respuesta correcta: si lo
// es, "marcar la mas larga" se vuelve una estrategia ganadora y el barajado del
// servidor no lo corrige, porque permuta posiciones y no largos.
const TOLERANCIA_LARGO = 1.35;

if (!fs.existsSync(ARCHIVO)) {
  console.error('No existe ' + ARCHIVO + '. Corre exportarBancoPreguntas() primero.');
  process.exit(1);
}

const banco = JSON.parse(fs.readFileSync(ARCHIVO, 'utf8'));
const P = Array.isArray(banco) ? banco : banco.preguntas;
if (!Array.isArray(P)) {
  console.error('El archivo no tiene un arreglo de preguntas.');
  process.exit(1);
}

const errores = [];
const avisos = [];
const vistos = new Set();

for (const p of P) {
  const id = (p.id || '').trim() || '(sin id)';
  const op = { A: p.a, B: p.b, C: p.c, D: p.d };
  const marca = (l, m) => l.push(id + ': ' + m);

  if (!p.id || !p.id.trim()) marca(errores, 'sin ID');
  else if (vistos.has(id)) marca(errores, 'ID duplicado');
  vistos.add(id);

  if (!p.pregunta || !p.pregunta.trim()) marca(errores, 'enunciado vacio');

  for (const l of LETRAS) {
    if (!op[l] || !String(op[l]).trim()) marca(errores, 'alternativa ' + l + ' vacia');
  }

  const r = String(p.respuesta || '').toUpperCase().trim();
  if (!LETRAS.includes(r)) marca(errores, 'respuesta invalida ("' + p.respuesta + '")');
  else if (op[r] && !String(op[r]).trim()) marca(errores, 'la respuesta apunta a una alternativa vacia');

  const textos = LETRAS.map(l => String(op[l] || '').trim().toLowerCase()).filter(Boolean);
  if (new Set(textos).size !== textos.length) marca(errores, 'alternativas repetidas entre si');

  if (!p.explicacion || !p.explicacion.trim()) marca(avisos, 'sin explicacion');
  if (!p.fuente || !p.fuente.trim()) marca(avisos, 'sin fuente');

  // sesgo de longitud, por pregunta
  if (LETRAS.includes(r) && LETRAS.every(l => op[l])) {
    const correcta = String(op[r]).length;
    const mejorOtro = Math.max(...LETRAS.filter(l => l !== r).map(l => String(op[l]).length));
    if (correcta > mejorOtro * TOLERANCIA_LARGO) {
      marca(avisos, 'la correcta es ' + Math.round(correcta / mejorOtro * 100) +
        '% del mejor distractor (' + correcta + ' vs ' + mejorOtro + ') — se delata por el largo');
    }
  }
}

// sesgos agregados
const activas = P.filter(p => {
  const a = String(p.activa || '').toUpperCase().trim();
  return a === '' || ['TRUE', 'VERDADERO', '1', 'SI', 'SÍ'].includes(a);
});

const cuenta = (f) => activas.reduce((acc, p) => {
  const k = f(p) || '(vacio)';
  acc[k] = (acc[k] || 0) + 1;
  return acc;
}, {});

const porLetra = cuenta(p => String(p.respuesta || '').toUpperCase().trim());
const porNivel = cuenta(p => String(p.nivel || '').toUpperCase().trim());
const porCategoria = cuenta(p => String(p.categoria || '').toUpperCase().trim());

const total = activas.length;
const masLarga = activas.filter(p => {
  const op = { A: p.a, B: p.b, C: p.c, D: p.d };
  const r = String(p.respuesta || '').toUpperCase().trim();
  if (!LETRAS.includes(r) || !LETRAS.every(l => op[l])) return false;
  return String(op[r]).length >= Math.max(...LETRAS.map(l => String(op[l]).length));
}).length;

console.log('preguntas: ' + P.length + ' (' + total + ' activas)');
console.log('por nivel:     ', porNivel);
console.log('por categoria: ', porCategoria);
console.log('por letra:     ', porLetra);

const pico = Math.max(...Object.values(porLetra));
if (total && pico / total > 0.4) {
  console.log('  ⚠️  la letra correcta se concentra en un ' + Math.round(pico / total * 100) +
    '% de las preguntas (el servidor lo baraja, pero la planilla queda sesgada)');
}
if (total) {
  console.log('la correcta es la mas larga en ' + masLarga + '/' + total +
    ' = ' + Math.round(masLarga / total * 100) + '%  (al azar seria 25%)');
}

if (avisos.length) {
  console.log('\nAVISOS (' + avisos.length + '):');
  avisos.forEach(a => console.log('  · ' + a));
}
if (errores.length) {
  console.log('\nERRORES (' + errores.length + '):');
  errores.forEach(e => console.log('  ✗ ' + e));
  console.log('\nNo generes el parche hasta corregirlos.');
  process.exit(1);
}

console.log('\n✅ sin errores' + (avisos.length ? ' (' + avisos.length + ' avisos por revisar)' : ''));
