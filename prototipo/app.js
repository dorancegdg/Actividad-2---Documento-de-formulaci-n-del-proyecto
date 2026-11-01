'use strict';
/*
  Prototipo funcional: Sistema digital de registro y control de acceso.
  Todos los datos son ficticios y se guardan en el navegador (localStorage).
  En la versión final, los datos irán a una base de datos MySQL.
*/

const CLAVE = 'sca_prototipo_v1';

const ROLES = { vigilancia: 'Vigilancia', administracion: 'Administración', soporte: 'Soporte técnico' };
const TIPOS = { residente: 'Residente', visitante: 'Visitante', domiciliario: 'Domiciliario', contratista: 'Contratista', servicio: 'Personal de servicio' };
const ESTADOS = { pendiente: 'Pendiente', rechazada: 'Rechazada', dentro: 'Dentro', cerrada: 'Cerrada' };
const AUT = {
  aprobada: 'Aprobada', rechazada: 'Rechazada', pendiente: 'Pendiente',
  excepcion: 'Excepción documentada', residente: 'No requiere (residente)', preautorizada: 'Pre-autorización'
};
const TIPO_ALERTA = {
  sin_autorizacion: 'Visita sin autorización',
  repetido: 'Ingreso repetido con visita abierta',
  permanencia: 'Permanencia mayor al umbral',
  frecuencia: 'Ingresos frecuentes sin pre-registro'
};
const PANTALLAS = [
  { id: 'porteria', titulo: 'Portería', roles: ['vigilancia', 'administracion'] },
  { id: 'alertas', titulo: 'Alertas', roles: ['vigilancia', 'administracion'] },
  { id: 'contingencia', titulo: 'Contingencia sin internet', roles: ['vigilancia', 'administracion'] },
  { id: 'historial', titulo: 'Historial y correcciones', roles: ['administracion'] },
  { id: 'reportes', titulo: 'Reportes', roles: ['administracion'] },
  { id: 'residentes', titulo: 'Residentes y pre-autorizaciones', roles: ['administracion'] },
  { id: 'indicadores', titulo: 'Indicadores', roles: ['administracion'] },
  { id: 'auditoria', titulo: 'Auditoría', roles: ['administracion'] },
  { id: 'configuracion', titulo: 'Configuración', roles: ['administracion', 'soporte'] },
  { id: 'rendimiento', titulo: 'Prueba de rendimiento', roles: ['administracion', 'soporte'] },
  { id: 'respaldo', titulo: 'Respaldo y recuperación', roles: ['administracion', 'soporte'] }
];

let db = null;
let soloMemoria = false;
let inicioRegistro = null;
let filtroHistorial = null;
let filtroReporte = null;
let soloDenegados = false;

/* ---------- Utilidades ---------- */
const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n, l = 6) => String(n).padStart(l, '0');
const ahora = () => new Date().toISOString();
const fmt = iso => iso ? new Date(iso).toLocaleString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
const fechaInput = d => { const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 10); };
const horaInput = iso => { if (!iso) return ''; const x = new Date(iso); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 16); };
const deInput = v => v ? new Date(v).toISOString() : null;
function duracion(ms) { const m = Math.max(0, Math.round(ms / 60000)); const h = Math.floor(m / 60); return h ? `${h} h ${m % 60} min` : `${m} min`; }
function sig(nombre) { db.seq[nombre] = (db.seq[nombre] || 0) + 1; return db.seq[nombre]; }
function usuario() { return db.usuarios.find(u => u.id === db.sesion) || db.usuarios[0]; }
function persona(id) { return db.personas.find(p => p.id === id); }
function residente(id) { return db.residentes.find(r => r.id === id); }
function nombreP(id) { return persona(id)?.nombre ?? '—'; }
function documentoP(id) { const p = persona(id); return p && p.numDoc ? `${p.tipoDoc} ${p.numDoc}` : '—'; }
function anfitrion(v) { const r = residente(v.residenteId); return r ? `${r.unidad} – ${r.nombre}` : '—'; }
function opciones(obj, sel) { return Object.entries(obj).map(([k, t]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${esc(t)}</option>`).join(''); }
function residentesOpts(sel) { return db.residentes.map(r => `<option value="${r.id}" ${r.id === sel ? 'selected' : ''}>${esc(r.unidad)} – ${esc(r.nombre)}</option>`).join(''); }
function externos() { return db.personas.filter(p => p.tipo !== 'residente'); }
function puede(roles) { return roles.includes(usuario().rol); }

function estadoVisita(v) {
  if (v.autorizacion.estado === 'rechazada') return 'rechazada';
  if (!v.entrada) return 'pendiente';
  if (!v.salida) return 'dentro';
  return 'cerrada';
}
function chipEstado(v) { const e = estadoVisita(v); return `<span class="estado e-${e}">${ESTADOS[e]}</span>`; }
function textoAut(a) {
  const partes = [AUT[a.estado] || a.estado];
  if (a.quien) partes.push(a.quien);
  if (a.canal && a.canal !== '—') partes.push(a.canal);
  if (a.motivo) partes.push('Motivo: ' + a.motivo);
  return partes.join(' · ');
}

/* ---------- Almacenamiento ---------- */
function cargar() {
  try {
    const t = localStorage.getItem(CLAVE);
    if (t) { db = JSON.parse(t); return; }
  } catch (e) { /* el navegador no permite leer: se usa la semilla */ }
  db = semilla();
  guardar();
}
function guardar() {
  try { localStorage.setItem(CLAVE, JSON.stringify(db)); }
  catch (e) {
    if (!soloMemoria) { soloMemoria = true; aviso('El navegador no permitió guardar. Los datos quedan solo mientras la página esté abierta.', 'error'); }
  }
}

/* ---------- Auditoría y alertas ---------- */
function auditar(accion, detalle, resultado = 'ok') {
  const u = usuario();
  db.auditoria.unshift({ id: sig('auditoria'), fecha: ahora(), usuario: u.nombre, rol: ROLES[u.rol], accion, detalle, resultado });
}
function denegarAccion(accion) {
  auditar('Acceso denegado', `Intentó: ${accion}`, 'denegado');
  guardar();
  aviso(`Acceso denegado: el rol ${ROLES[usuario().rol]} no puede ${accion}. Quedó registrado.`, 'error');
}
function alerta(tipo, descripcion, visitaId, clave) {
  if (clave && db.alertas.some(a => a.clave === clave)) return;
  db.alertas.unshift({ id: 'A-' + pad(sig('alerta'), 4), tipo, descripcion, visitaId: visitaId || null, clave: clave || null, fecha: ahora(), revisada: false, revisadaPor: null, observacion: '' });
}
function revisarPermanencia() {
  const limite = db.config.umbralPermanenciaMin * 60000;
  db.visitas.forEach(v => {
    if (estadoVisita(v) === 'dentro' && Date.now() - new Date(v.entrada) > limite) {
      alerta('permanencia', `${nombreP(v.personaId)} lleva ${duracion(Date.now() - new Date(v.entrada))} dentro; el umbral es ${duracion(limite)} (${v.id}).`, v.id, 'perm-' + v.id);
    }
  });
}
function preautorizacionVigente(personaId, residenteId) {
  const t = Date.now();
  return db.preautorizaciones.find(p => p.personaId === personaId && (!residenteId || p.residenteId === residenteId) && !p.revocada &&
    new Date(p.desde + 'T00:00:00') <= t && t <= new Date(p.hasta + 'T23:59:59'));
}
function revisarFrecuencia(personaId) {
  const hoy = new Date().toDateString();
  const n = db.visitas.filter(v => v.personaId === personaId && v.entrada && new Date(v.entrada).toDateString() === hoy).length;
  if (n > db.config.maxIngresosDia && !preautorizacionVigente(personaId, null)) {
    alerta('frecuencia', `${nombreP(personaId)} ha ingresado ${n} veces hoy sin pre-registro (máximo configurado: ${db.config.maxIngresosDia}).`, null, `frec-${personaId}-${hoy}-${n}`);
  }
}

/* ---------- Visitas ---------- */
function nuevaVisita({ personaId, residenteId, tipo, aut, entrada = null, origen = 'en_linea', folio = null, horaCaptura = null }) {
  const v = {
    id: 'V-' + pad(sig('visita')), personaId, residenteId: residenteId || null, tipo, autorizacion: aut,
    entrada, salida: null, registradoPor: usuario().nombre, cerradoPor: null,
    origen, folio, horaCaptura, creado: ahora(), cambios: []
  };
  db.visitas.push(v);
  return v;
}
function encolar(item) {
  db.cola.push({ ...item, usuario: usuario().nombre });
  auditar('Registro en contingencia', `${item.folio}: ${item.tipo === 'salida' ? 'salida de ' + item.visitaId : nombreP(item.personaId)}`);
}
function sincronizar() {
  const res = { fecha: ahora(), cargados: 0, duplicados: 0, detalle: [] };
  for (const it of db.cola) {
    if (it.tipo === 'salida') {
      const v = db.visitas.find(x => x.id === it.visitaId);
      if (v && !v.salida) {
        v.salida = it.horaCaptura; v.cerradoPor = it.usuario; v.salidaFolio = it.folio; delete v.salidaPendiente;
        res.cargados++; res.detalle.push({ folio: it.folio, resultado: 'Salida cargada', visita: v.id, hora: it.horaCaptura });
      } else {
        res.duplicados++; res.detalle.push({ folio: it.folio, resultado: 'Descartado: la salida ya estaba registrada', visita: it.visitaId, hora: it.horaCaptura });
      }
      continue;
    }
    const dup = it.entra && db.visitas.find(v => v.personaId === it.personaId && v.entrada && Math.abs(new Date(v.entrada) - new Date(it.horaCaptura)) <= 120000);
    if (dup) {
      res.duplicados++; res.detalle.push({ folio: it.folio, resultado: 'Descartado por duplicado', visita: dup.id, hora: it.horaCaptura });
      continue;
    }
    const v = nuevaVisita({ personaId: it.personaId, residenteId: it.residenteId, tipo: it.tipoPersona, aut: it.aut, entrada: it.entra ? it.horaCaptura : null, origen: it.origen, folio: it.folio, horaCaptura: it.horaCaptura });
    v.registradoPor = it.usuario; v.sincronizado = ahora();
    res.cargados++; res.detalle.push({ folio: it.folio, resultado: 'Cargado', visita: v.id, hora: it.horaCaptura });
    if (it.entra) revisarFrecuencia(it.personaId);
  }
  db.cola = [];
  db.sincronizaciones.unshift(res);
  auditar('Sincronización', `Cargados: ${res.cargados}. Duplicados descartados: ${res.duplicados}.`);
  return res;
}

/* ---------- Datos de demostración (ficticios) ---------- */
function semilla() {
  db = {
    seq: {}, config: { umbralPermanenciaMin: 360, maxIngresosDia: 3, conservacionDias: 365 }, enLinea: true, sesion: 'u1',
    usuarios: [
      { id: 'u1', nombre: 'Guarda turno día (ficticio)', rol: 'vigilancia' },
      { id: 'u2', nombre: 'Administración (ficticio)', rol: 'administracion' },
      { id: 'u3', nombre: 'Soporte técnico (ficticio)', rol: 'soporte' }
    ],
    residentes: [], personas: [], preautorizaciones: [], visitas: [], incidencias: [], alertas: [],
    auditoria: [], cola: [], tiemposRegistro: [], sincronizaciones: [], pruebas: [], restauraciones: []
  };
  const res = [['Ana Restrepo', 'Torre 1 – Apto 101'], ['Luis Cardona', 'Torre 1 – Apto 202'], ['Sofía Marín', 'Torre 1 – Apto 303'],
    ['Jorge Ospina', 'Torre 2 – Apto 104'], ['Paula Henao', 'Torre 2 – Apto 205'], ['Andrés Giraldo', 'Torre 2 – Apto 306'],
    ['Diana Valencia', 'Casa 7'], ['Camilo Arango', 'Casa 12']];
  res.forEach(([nombre, unidad], i) => {
    const rid = 'R' + (i + 1);
    db.residentes.push({ id: rid, nombre, unidad, canal: 'Citófono' });
    db.personas.push({ id: 'P' + sig('persona'), nombre, tipoDoc: 'CC', numDoc: String(1000000100 + i), tipo: 'residente', residenteId: rid });
  });
  [['Valentina Ríos', 'visitante'], ['Mateo López', 'domiciliario'], ['Julián Mora', 'contratista'], ['Gloria Patiño', 'servicio'],
    ['Santiago Pérez', 'visitante'], ['Laura Castaño', 'visitante'], ['Felipe Duque', 'domiciliario'], ['Natalia Zuluaga', 'visitante']]
    .forEach(([nombre, tipo], i) => db.personas.push({ id: 'P' + sig('persona'), nombre, tipoDoc: 'CC', numDoc: String(1000000200 + i), tipo }));

  const P = n => db.personas.find(p => p.nombre === n).id;
  const H = (dias, h, m) => { const d = new Date(); d.setDate(d.getDate() - dias); d.setHours(h, m, 0, 0); return d.toISOString(); };
  const hoy = new Date();
  db.preautorizaciones.push({ id: 'PA-' + pad(sig('preaut'), 3), personaId: P('Gloria Patiño'), residenteId: 'R2', desde: fechaInput(new Date(hoy - 30 * 864e5)), hasta: fechaInput(new Date(+hoy + 60 * 864e5)), creadaPor: 'Administración (ficticio)', revocada: false });
  db.preautorizaciones.push({ id: 'PA-' + pad(sig('preaut'), 3), personaId: P('Valentina Ríos'), residenteId: 'R1', desde: fechaInput(new Date(hoy - 10 * 864e5)), hasta: fechaInput(new Date(+hoy + 20 * 864e5)), creadaPor: 'Administración (ficticio)', revocada: false });

  const plan = [
    [6, 'Valentina Ríos', 'R1', 9, 10, 11, 40], [6, 'Mateo López', 'R3', 12, 5, 12, 15], [5, 'Gloria Patiño', 'R2', 7, 0, 15, 0],
    [5, 'Julián Mora', 'R5', 8, 30, 12, 0], [5, 'Santiago Pérez', 'R4', 18, 20, 21, 10], [4, 'Laura Castaño', 'R6', 10, 0, 13, 30],
    [4, 'Felipe Duque', 'R7', 19, 45, 19, 55], [3, 'Gloria Patiño', 'R2', 7, 5, 15, 10], [3, 'Natalia Zuluaga', 'R8', 16, 0, 18, 30],
    [2, 'Mateo López', 'R1', 13, 0, 13, 10], [2, 'Valentina Ríos', 'R1', 17, 0, 20, 15], [1, 'Gloria Patiño', 'R2', 7, 0, 15, 5],
    [1, 'Julián Mora', 'R5', 8, 0, 11, 45], [1, 'Ana Restrepo', 'R1', 6, 30, 18, 0]
  ];
  plan.forEach(([d, nombre, rid, h1, m1, h2, m2]) => {
    const p = persona(P(nombre));
    const e = H(d, h1, m1);
    const aut = p.tipo === 'residente'
      ? { estado: 'residente', quien: p.nombre, canal: '—', fecha: e, cotejo: true }
      : p.nombre === 'Gloria Patiño'
        ? { estado: 'preautorizada', quien: residente(rid).nombre + ' (pre-autorización)', canal: 'Pre-registro', fecha: e, cotejo: true }
        : { estado: 'aprobada', quien: residente(rid).nombre, canal: 'Citófono', fecha: e, cotejo: true };
    const v = nuevaVisita({ personaId: p.id, residenteId: rid, tipo: p.tipo, aut, entrada: e });
    v.salida = H(d, h2, m2); v.cerradoPor = v.registradoPor; v.creado = e;
  });
  const rech = nuevaVisita({ personaId: P('Santiago Pérez'), residenteId: 'R3', tipo: 'visitante', aut: { estado: 'rechazada', quien: 'Sofía Marín', canal: 'Llamada', fecha: H(3, 20, 0), cotejo: false } });
  rech.creado = H(3, 20, 0);
  const ahoraMs = Date.now();
  const abierta = nuevaVisita({ personaId: P('Julián Mora'), residenteId: 'R5', tipo: 'contratista', aut: { estado: 'aprobada', quien: 'Paula Henao', canal: 'Citófono', fecha: new Date(ahoraMs - 7 * 36e5).toISOString(), cotejo: true }, entrada: new Date(ahoraMs - 7 * 36e5).toISOString() });
  abierta.creado = abierta.entrada;
  const dom = nuevaVisita({ personaId: P('Mateo López'), residenteId: 'R4', tipo: 'domiciliario', aut: { estado: 'aprobada', quien: 'Jorge Ospina', canal: 'Mensaje', fecha: new Date(ahoraMs - 12 * 6e4).toISOString(), cotejo: true }, entrada: new Date(ahoraMs - 12 * 6e4).toISOString() });
  dom.creado = dom.entrada;
  const pend = nuevaVisita({ personaId: P('Laura Castaño'), residenteId: 'R6', tipo: 'visitante', aut: { estado: 'pendiente', quien: null, canal: 'Citófono', fecha: null, cotejo: false } });
  pend.creado = new Date(ahoraMs - 3 * 6e4).toISOString();
  db.tiemposRegistro = [52, 47, 61, 44, 39, 58, 50];
  db.auditoria.unshift({ id: sig('auditoria'), fecha: ahora(), usuario: 'Sistema', rol: '—', accion: 'Datos de demostración cargados', detalle: 'Residentes, visitantes y visitas ficticios', resultado: 'ok' });
  revisarPermanencia();
  return db;
}

/* ---------- Interfaz general ---------- */
function aviso(texto, tipo = 'ok') {
  const caja = $('#avisos');
  if (!caja) return;
  const d = document.createElement('div');
  d.className = 'aviso ' + tipo;
  d.textContent = texto;
  caja.appendChild(d);
  setTimeout(() => d.remove(), 6000);
}
function abrirModal(titulo, cuerpo, boton = 'Guardar', soloLectura = false) {
  return new Promise(resolver => {
    const m = $('#modal');
    m.innerHTML = `<div class="modal-caja" role="dialog" aria-modal="true" aria-label="${esc(titulo)}"><h3>${esc(titulo)}</h3>
      <form id="modal-form">${cuerpo}<div class="modal-botones">
      ${soloLectura ? '' : `<button class="primario" type="submit">${esc(boton)}</button>`}
      <button type="button" id="modal-cancelar">${soloLectura ? 'Cerrar' : 'Cancelar'}</button></div></form></div>`;
    m.hidden = false;
    const cerrar = valor => { m.hidden = true; m.innerHTML = ''; resolver(valor); };
    $('#modal-cancelar').onclick = () => cerrar(null);
    $('#modal-form').onsubmit = e => { e.preventDefault(); cerrar(Object.fromEntries(new FormData(e.target))); };
    const primero = m.querySelector('textarea, input, select');
    if (primero) primero.focus();
  });
}
async function pedirTexto(titulo, mensaje, boton, etiqueta = 'Motivo') {
  const r = await abrirModal(titulo, `<p>${esc(mensaje)}</p><label>${esc(etiqueta)}<textarea name="texto" required minlength="5" rows="3"></textarea></label>`, boton);
  return r ? r.texto.trim() : null;
}
async function confirmar(titulo, mensaje, boton) {
  return (await abrirModal(titulo, `<p>${esc(mensaje)}</p>`, boton)) !== null;
}

function renderCabecera() {
  const b = $('#btn-conexion');
  b.textContent = db.enLinea ? '● En línea' : '● Sin conexión (simulada)';
  b.className = 'chip ' + (db.enLinea ? 'en-linea' : 'sin-conexion');
  b.title = db.enLinea ? 'Clic para simular una caída de internet' : 'Clic para restablecer la conexión y sincronizar';
  $('#sel-usuario').innerHTML = db.usuarios.map(u => `<option value="${u.id}" ${u.id === db.sesion ? 'selected' : ''}>${esc(u.nombre)} · ${ROLES[u.rol]}</option>`).join('');
}
function renderMenu(actual) {
  const rol = usuario().rol;
  const sinRevisar = db.alertas.filter(a => !a.revisada).length;
  $('#menu').innerHTML = PANTALLAS.map(p => {
    const permitido = p.roles.includes(rol);
    const extra = p.id === 'alertas' && sinRevisar && permitido ?`<span class="insignia">${sinRevisar}</span>` : (permitido ? '' : '<span aria-label="sin permiso">🔒</span>');
    return `<a href="#${p.id}" class="${p.id === actual ? 'activo' : ''} ${permitido ? '' : 'bloqueada'}">${esc(p.titulo)}${extra}</a>`;
  }).join('');
}
function render() {
  const id = (location.hash || '#porteria').slice(1);
  const pant = PANTALLAS.find(p => p.id === id) || PANTALLAS[0];
  revisarPermanencia();
  renderCabecera();
  renderMenu(pant.id);
  if (!pant.roles.includes(usuario().rol)) {
    auditar('Acceso denegado', `Intentó abrir «${pant.titulo}»`, 'denegado');
    guardar();
    $('#contenido').innerHTML = `<section class="tarjeta denegado"><h2>Acceso denegado</h2>
      <p>El rol <b>${ROLES[usuario().rol]}</b> no tiene permiso para abrir «${esc(pant.titulo)}».</p>
      <p>El intento quedó registrado en la auditoría.</p></section>`;
    return;
  }
  guardar();
  $('#contenido').innerHTML = VISTAS[pant.id]();
  document.title = `${pant.titulo} · Control de Acceso`;
}
function irA(id) { if (location.hash === '#' + id) render(); else location.hash = id; }

/* ---------- Vistas ---------- */
const VISTAS = {};

function bannerSinConexion() {
  return db.enLinea ? '' : `<div class="banner error">Sin conexión (simulada). Los registros se guardan en la cola de contingencia con folio numerado y se cargarán al volver la conexión. Si el equipo no funciona, use el formato en papel.</div>`;
}

VISTAS.porteria = () => {
  const activas = db.visitas.filter(v => estadoVisita(v) === 'dentro').sort((a, b) => new Date(a.entrada) - new Date(b.entrada));
  const pendientes = db.visitas.filter(v => estadoVisita(v) === 'pendiente');
  return `${bannerSinConexion()}
  <div class="grid2">
    <section class="tarjeta">
      <h2>Registrar ingreso</h2>
      <form data-form="ingreso" autocomplete="off">
        <label>Tipo de persona <select name="tipo" id="f-tipo">${opciones(TIPOS, 'visitante')}</select></label>
        <div id="bloque-residente" hidden>
          <label>Residente que ingresa <select name="residenteEntra">${residentesOpts()}</select></label>
        </div>
        <div id="bloque-externo">
          <label>Buscar persona registrada (nombre o documento)
            <input id="f-buscar" placeholder="Ej.: Valentina o 1000000200"></label>
          <div id="resultados-busqueda" class="resultados"></div>
          <input type="hidden" name="personaId" id="f-personaId">
          <fieldset id="persona-nueva"><legend>Persona nueva (datos mínimos)</legend>
            <label>Nombre completo <input name="nombre"></label>
            <div class="fila">
              <label>Tipo de documento <select name="tipoDoc"><option>CC</option><option>CE</option><option>TI</option><option>PAS</option></select></label>
              <label>Número <input name="numDoc" inputmode="numeric"></label>
            </div>
          </fieldset>
          <label>Residente anfitrión <select name="residenteId" id="f-anfitrion"><option value="">Seleccione…</option>${residentesOpts()}</select></label>
          <div id="info-preaut"></div>
          <fieldset id="bloque-autorizacion"><legend>Autorización del residente</legend>
            <label>Canal <select name="canal"><option>Citófono</option><option>Llamada</option><option>Mensaje</option></select></label>
            <div class="radios">
              <label><input type="radio" name="decision" value="aprobada"> Aprobó</label>
              <label><input type="radio" name="decision" value="rechazada"> Rechazó</label>
              <label><input type="radio" name="decision" value="pendiente"> Sin respuesta</label>
            </div>
          </fieldset>
          <label class="check"><input type="checkbox" name="cotejo" id="f-cotejo"> Cotejé el documento físico con los datos declarados</label>
          <p class="nota">El cotejo es visual: el sistema no certifica la autenticidad del documento ni guarda copia.</p>
        </div>
        <button class="primario" type="submit">Guardar registro</button>
      </form>
    </section>
    <section>
      <div class="tarjeta">
        <h2>Visitas activas (${activas.length})</h2>
        ${activas.length ? `<div class="tabla-scroll"><table><tr><th>ID</th><th>Persona</th><th>Tipo</th><th>Anfitrión</th><th>Entrada</th><th>Tiempo dentro</th><th></th></tr>
          ${activas.map(v => `<tr><td>${v.id}</td><td>${esc(nombreP(v.personaId))}</td><td>${TIPOS[v.tipo]}</td><td>${esc(anfitrion(v))}</td>
            <td>${fmt(v.entrada)}</td><td>${duracion(Date.now() - new Date(v.entrada))}</td>
            <td>${v.salidaPendiente ? `<span class="estado e-pendiente">Salida en cola ${esc(v.salidaPendiente)}</span>` : `<button class="mini" data-accion="salida" data-id="${v.id}">Registrar salida</button>`}</td></tr>`).join('')}
          </table></div>` : '<p class="vacio">No hay visitas abiertas.</p>'}
        <form data-form="buscar-salida" class="fila" style="margin-top:12px">
          <label>¿No aparece la visita? Búsquela para registrar la salida <input name="q" placeholder="ID, nombre o documento"></label>
          <button type="submit">Buscar</button>
        </form>
        <div id="res-salida"></div>
      </div>
      <div class="tarjeta">
        <h2>Pendientes de autorización (${pendientes.length})</h2>
        <p class="nota">Una visita pendiente no se marca como autorizada. Registre la decisión cuando el residente responda.</p>
        ${pendientes.length ? `<table><tr><th>ID</th><th>Persona</th><th>Anfitrión</th><th>Desde</th><th>Acciones</th></tr>
          ${pendientes.map(v => `<tr><td>${v.id}</td><td>${esc(nombreP(v.personaId))}<br><small>${esc(documentoP(v.personaId))}</small></td><td>${esc(anfitrion(v))}</td><td>${fmt(v.creado)}</td>
            <td><button class="mini" data-accion="aprobar" data-id="${v.id}">Aprobó</button>
            <button class="mini" data-accion="rechazar" data-id="${v.id}">Rechazó</button>
            <button class="mini peligro" data-accion="excepcion" data-id="${v.id}">Ingreso por excepción</button></td></tr>`).join('')}</table>`
          : '<p class="vacio">No hay visitas pendientes.</p>'}
      </div>
    </section>
  </div>`;
};

VISTAS.alertas = () => {
  const lista = db.alertas;
  return `<section class="tarjeta"><h2>Alertas para revisión humana</h2>
    <p class="nota">Las alertas son señales para revisar, no una conclusión automática de mala conducta.</p>
    ${lista.length ? `<div class="tabla-scroll"><table><tr><th>ID</th><th>Fecha</th><th>Tipo</th><th>Descripción</th><th>Estado</th></tr>
    ${lista.map(a => `<tr><td>${a.id}</td><td>${fmt(a.fecha)}</td><td>${TIPO_ALERTA[a.tipo]}</td><td>${esc(a.descripcion)}</td>
      <td>${a.revisada ? `<span class="estado e-cerrada">Revisada</span><br><small>${esc(a.revisadaPor)}${a.observacion ? ': ' + esc(a.observacion) : ''}</small>`
        : `<button class="mini" data-accion="revisar-alerta" data-id="${a.id}">Marcar revisada</button>`}</td></tr>`).join('')}
    </table></div>` : '<p class="vacio">No hay alertas.</p>'}</section>`;
};

VISTAS.contingencia = () => {
  const ult = db.sincronizaciones[0];
  return `${bannerSinConexion()}
  <section class="tarjeta"><h2>Estado de la conexión</h2>
    <p>Conexión: <b class="${db.enLinea ? 'ok-txt' : 'mal-txt'}">${db.enLinea ? 'En línea' : 'Sin conexión (simulada)'}</b>.
    Registros en cola: <b>${db.cola.length}</b>.</p>
    <div class="fila" style="max-width:640px">
      <button data-accion="conexion">${db.enLinea ? 'Simular caída de internet' : 'Restablecer conexión y sincronizar'}</button>
      <button data-accion="imprimir-formato">Imprimir formato de contingencia en papel</button>
    </div>
  </section>
  <section class="tarjeta"><h2>Cola de contingencia (${db.cola.length})</h2>
    ${db.cola.length ? `<table><tr><th>Folio</th><th>Movimiento</th><th>Persona</th><th>Anfitrión</th><th>Hora real de captura</th><th>Origen</th><th>Registró</th></tr>
      ${db.cola.map(c => `<tr><td>${esc(c.folio)}</td><td>${c.tipo === 'salida' ? 'Salida' : (c.entra ? 'Entrada' : 'Visita sin entrada')}</td>
      <td>${esc(c.tipo === 'salida' ? c.visitaId : nombreP(c.personaId))}</td><td>${c.tipo === 'salida' ? '—' : esc(anfitrion(c))}</td><td>${fmt(c.horaCaptura)}</td>
      <td>${c.origen === 'papel' ? 'Formato en papel' : 'Equipo sin conexión'}</td><td>${esc(c.usuario)}</td></tr>`).join('')}</table>`
      : '<p class="vacio">La cola está vacía.</p>'}
  </section>
  <section class="tarjeta"><h2>Transcribir un registro del formato en papel</h2>
    <form data-form="papel" class="filtros">
      <label>Folio del formato <input name="folio" required placeholder="F-0001"></label>
      <label>Persona <select name="personaId" required>${externos().map(p => `<option value="${p.id}">${esc(p.nombre)} (${p.tipoDoc} ${p.numDoc})</option>`).join('')}</select></label>
      <label>Anfitrión <select name="residenteId" required>${residentesOpts()}</select></label>
      <label>Hora de entrada anotada <input type="datetime-local" name="hora" required value="${horaInput(ahora())}"></label>
      <button type="submit">Agregar a la cola</button>
    </form>
    <p class="nota">Al sincronizar, el sistema descarta los registros que coinciden con uno ya cargado (misma persona y diferencia de hasta 2 minutos).</p>
  </section>
  ${ult ? `<section class="tarjeta"><h2>Última sincronización: ${fmt(ult.fecha)}</h2>
    <p>Cargados: <b>${ult.cargados}</b> · Duplicados descartados: <b>${ult.duplicados}</b></p>
    <table><tr><th>Folio</th><th>Hora real de captura</th><th>Resultado</th><th>Visita</th></tr>
    ${ult.detalle.map(d => `<tr><td>${esc(d.folio)}</td><td>${fmt(d.hora)}</td><td>${esc(d.resultado)}</td><td>${esc(d.visita)}</td></tr>`).join('')}</table></section>` : ''}`;
};

function visitasFiltradas(f) {
  const desde = new Date(f.desde + 'T00:00:00'), hasta = new Date(f.hasta + 'T23:59:59');
  const q = (f.texto || '').trim().toLowerCase();
  return db.visitas.filter(v => {
    const ref = new Date(v.entrada || v.creado);
    if (ref < desde || ref > hasta) return false;
    if (f.estado && estadoVisita(v) !== f.estado) return false;
    if (f.tipo && v.tipo !== f.tipo) return false;
    if (q) {
      const p = persona(v.personaId) || {};
      if (![v.id, p.nombre, p.numDoc].some(x => String(x || '').toLowerCase().includes(q))) return false;
    }
    return true;
  }).sort((a, b) => new Date(b.entrada || b.creado) - new Date(a.entrada || a.creado));
}
function filtroInicial() { return { desde: fechaInput(Date.now() - 7 * 864e5), hasta: fechaInput(Date.now()), texto: '', estado: '', tipo: '' }; }

VISTAS.historial = () => {
  filtroHistorial = filtroHistorial || filtroInicial();
  const f = filtroHistorial;
  const lista = visitasFiltradas(f);
  return `<section class="tarjeta"><h2>Historial de visitas</h2>
    <form data-form="filtro-historial" class="filtros">
      <label>Desde <input type="date" name="desde" value="${f.desde}"></label>
      <label>Hasta <input type="date" name="hasta" value="${f.hasta}"></label>
      <label>Buscar <input name="texto" value="${esc(f.texto)}" placeholder="ID, nombre o documento"></label>
      <label>Estado <select name="estado"><option value="">Todos</option>${opciones(ESTADOS, f.estado)}</select></label>
      <button type="submit">Consultar</button>
    </form>
    <p class="nota">${lista.length} visita(s) encontradas. Las correcciones nunca borran el historial: guardan el valor anterior, el nuevo, el usuario, la fecha y el motivo.</p>
    <div class="tabla-scroll"><table><tr><th>ID</th><th>Persona</th><th>Tipo</th><th>Anfitrión</th><th>Autorización</th><th>Entrada</th><th>Salida</th><th>Estado</th><th>Origen</th><th></th></tr>
    ${lista.slice(0, 300).map(v => `<tr><td>${v.id}</td><td>${esc(nombreP(v.personaId))}<br><small>${esc(documentoP(v.personaId))}</small></td><td>${TIPOS[v.tipo]}</td>
      <td>${esc(anfitrion(v))}</td><td><small>${esc(textoAut(v.autorizacion))}</small></td><td>${fmt(v.entrada)}</td><td>${fmt(v.salida)}</td><td>${chipEstado(v)}</td>
      <td><small>${v.origen === 'en_linea' ? 'En línea' : (v.origen === 'papel' ? 'Papel ' : 'Contingencia ') + esc(v.folio || '')}</small></td>
      <td><button class="mini" data-accion="corregir" data-id="${v.id}">Corregir</button>
      ${v.cambios.length ? `<button class="mini" data-accion="ver-cambios" data-id="${v.id}">Cambios (${v.cambios.length})</button>` : ''}</td></tr>`).join('')}
    </table></div></section>`;
};

function resumenReporte(lista) {
  const porTipo = {}, porEstado = {};
  lista.forEach(v => { porTipo[v.tipo] = (porTipo[v.tipo] || 0) + 1; const e = estadoVisita(v); porEstado[e] = (porEstado[e] || 0) + 1; });
  return { porTipo, porEstado };
}
function contarEnBase(f) {
  // Conteo independiente, recorriendo la base, para conciliar con el reporte.
  let n = 0;
  const desde = new Date(f.desde + 'T00:00:00').getTime(), hasta = new Date(f.hasta + 'T23:59:59').getTime();
  for (const v of db.visitas) {
    const t = new Date(v.entrada || v.creado).getTime();
    if (t >= desde && t <= hasta && (!f.tipo || v.tipo === f.tipo)) n++;
  }
  return n;
}

VISTAS.reportes = () => {
  filtroReporte = filtroReporte || filtroInicial();
  const f = filtroReporte;
  const lista = visitasFiltradas({ ...f, texto: '', estado: '' });
  const { porTipo, porEstado } = resumenReporte(lista);
  const enBase = contarEnBase(f);
  return `<section class="tarjeta"><h2>Reporte de accesos</h2>
    <form data-form="filtro-reporte" class="filtros">
      <label>Desde <input type="date" name="desde" value="${f.desde}"></label>
      <label>Hasta <input type="date" name="hasta" value="${f.hasta}"></label>
      <label>Tipo de persona <select name="tipo"><option value="">Todos</option>${opciones(TIPOS, f.tipo)}</select></label>
      <button type="submit">Generar</button>
      <button type="button" data-accion="excel">Descargar Excel (CSV)</button>
      <button type="button" data-accion="pdf">Descargar PDF</button>
    </form>
    <p>Conciliación: el reporte tiene <b>${lista.length}</b> registro(s) y la base de datos tiene <b>${enBase}</b> para el mismo rango.
      ${lista.length === enBase ? '<span class="ok-txt">✔ Coinciden</span>' : '<span class="mal-txt">✖ No coinciden</span>'}</p>
    <div class="grid-ind" style="margin-bottom:14px">
      <div class="ind"><div class="meta">Por tipo de persona</div>${Object.entries(porTipo).map(([k, n]) => `<div>${TIPOS[k]}: <b>${n}</b></div>`).join('') || '—'}</div>
      <div class="ind"><div class="meta">Por estado</div>${Object.entries(porEstado).map(([k, n]) => `<div>${ESTADOS[k]}: <b>${n}</b></div>`).join('') || '—'}</div>
    </div>
    <div class="tabla-scroll">${tablaReporte(lista)}</div></section>`;
};
function filasReporte(lista) {
  return lista.map(v => [v.id, fmt(v.entrada), fmt(v.salida), nombreP(v.personaId), documentoP(v.personaId), TIPOS[v.tipo], anfitrion(v),
    AUT[v.autorizacion.estado], v.autorizacion.quien || '—', v.autorizacion.canal || '—', ESTADOS[estadoVisita(v)],
    v.origen === 'en_linea' ? 'En línea' : 'Contingencia ' + (v.folio || '')]);
}
const COLS_REPORTE = ['ID', 'Entrada', 'Salida', 'Persona', 'Documento', 'Tipo', 'Anfitrión', 'Autorización', 'Autorizó', 'Canal', 'Estado', 'Origen'];
function tablaReporte(lista) {
  return `<table><tr>${COLS_REPORTE.map(c => `<th>${c}</th>`).join('')}</tr>
    ${filasReporte(lista).map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</table>`;
}

VISTAS.residentes = () => {
  const hoy = Date.now();
  const estadoPA = p => p.revocada ? 'Revocada' : (new Date(p.hasta + 'T23:59:59') < hoy ? 'Vencida' : (new Date(p.desde + 'T00:00:00') > hoy ? 'Programada' : 'Vigente'));
  return `<section class="tarjeta"><h2>Residentes autorizados</h2>
    <table><tr><th>Unidad</th><th>Residente</th><th>Canal de autorización</th></tr>
    ${db.residentes.map(r => `<tr><td>${esc(r.unidad)}</td><td>${esc(r.nombre)}</td><td>${esc(r.canal)}</td></tr>`).join('')}</table></section>
  <section class="tarjeta"><h2>Pre-autorizaciones de visitantes frecuentes</h2>
    <table><tr><th>ID</th><th>Persona</th><th>Anfitrión</th><th>Desde</th><th>Hasta</th><th>Estado</th><th></th></tr>
    ${db.preautorizaciones.map(p => `<tr><td>${p.id}</td><td>${esc(nombreP(p.personaId))}</td><td>${esc(anfitrion(p))}</td><td>${p.desde}</td><td>${p.hasta}</td>
      <td>${estadoPA(p)}</td><td>${p.revocada ? '' : `<button class="mini peligro" data-accion="revocar" data-id="${p.id}">Revocar</button>`}</td></tr>`).join('')}</table>
    <h3 style="margin-top:16px">Nueva pre-autorización</h3>
    <form data-form="preaut" class="filtros">
      <label>Persona <select name="personaId">${externos().map(p => `<option value="${p.id}">${esc(p.nombre)}</option>`).join('')}</select></label>
      <label>Anfitrión <select name="residenteId">${residentesOpts()}</select></label>
      <label>Desde <input type="date" name="desde" required value="${fechaInput(Date.now())}"></label>
      <label>Hasta <input type="date" name="hasta" required value="${fechaInput(Date.now() + 30 * 864e5)}"></label>
      <button type="submit">Guardar</button>
    </form></section>`;
};

function completo(v) {
  const p = persona(v.personaId);
  if (!p || !p.nombre || !v.tipo || !v.autorizacion || !v.autorizacion.estado) return false;
  if (v.tipo !== 'residente' && (!p.numDoc || !v.residenteId)) return false;
  if (v.entrada && v.tipo !== 'residente' && v.autorizacion.estado !== 'excepcion' && !v.autorizacion.cotejo) return false;
  return true;
}
function mediana(a) { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }

VISTAS.indicadores = () => {
  const total = db.visitas.length;
  const pct = (n, d) => d ? Math.round(n / d * 1000) / 10 : 0;
  const comp = pct(db.visitas.filter(completo).length, total);
  const conEntrada = db.visitas.filter(v => v.entrada);
  const decision = pct(conEntrada.filter(v => ['aprobada', 'preautorizada', 'residente', 'excepcion'].includes(v.autorizacion.estado)).length, conEntrada.length);
  const localizables = pct(db.visitas.filter(v => v.id && v.personaId && (v.entrada || v.creado)).length, total);
  const med = mediana(db.tiemposRegistro);
  const alertasRev = db.alertas.filter(a => a.revisada).length;
  const tarjeta = (titulo, valor, meta, cumple) => `<div class="ind"><div class="meta">${titulo}</div><div class="valor">${valor}</div>
    <div class="meta">${meta}${cumple === undefined ? '' : ` · <span class="${cumple ? 'ok-txt' : 'mal-txt'}">${cumple ? 'Cumple' : 'No cumple'}</span>`}</div></div>`;
  return `<section class="tarjeta"><h2>Indicadores del piloto</h2>
    <p class="nota">Calculados con los datos del prototipo (ficticios). En el piloto se comparan con la línea base medida en el conjunto.</p>
    <div class="grid-ind">
      ${tarjeta('Registros totales', total, 'Visitas en la base de datos')}
      ${tarjeta('Completitud de campos obligatorios', comp + ' %', 'Meta ≥ 98 %', comp >= 98)}
      ${tarjeta('Ingresos con decisión registrada o excepción', decision + ' %', 'Meta 100 %', decision === 100)}
      ${tarjeta('Visitas localizables', localizables + ' %', 'Por ID, persona y fecha · Meta 100 %', localizables === 100)}
      ${tarjeta('Tiempo de registro (mediana)', med === null ? '—' : med + ' s', `${db.tiemposRegistro.length} medición(es) · se compara con la línea base`)}
      ${tarjeta('Alertas revisadas', `${alertasRev} / ${db.alertas.length}`, 'Revisión humana de las alertas')}
      ${tarjeta('Visitas abiertas ahora', db.visitas.filter(v => estadoVisita(v) === 'dentro').length, 'Para conciliar al cambiar de turno')}
      ${tarjeta('Incidencias registradas', db.incidencias.length, 'Salidas no localizadas y otros casos')}
    </div></section>`;
};

VISTAS.auditoria = () => {
  const lista = db.auditoria.filter(a => !soloDenegados || a.resultado === 'denegado');
  return `<section class="tarjeta"><h2>Auditoría</h2>
    <label class="check"><input type="checkbox" data-accion="filtro-denegados" ${soloDenegados ? 'checked' : ''}> Ver solo accesos denegados</label>
    <p class="nota">${lista.length} evento(s). Esta bitácora no se puede editar desde la aplicación.</p>
    <div class="tabla-scroll"><table><tr><th>#</th><th>Fecha</th><th>Usuario</th><th>Rol</th><th>Acción</th><th>Detalle</th><th>Resultado</th></tr>
    ${lista.slice(0, 400).map(a => `<tr><td>${a.id}</td><td>${fmt(a.fecha)}</td><td>${esc(a.usuario)}</td><td>${esc(a.rol)}</td><td>${esc(a.accion)}</td><td>${esc(a.detalle)}</td>
      <td>${a.resultado === 'denegado' ? '<span class="estado e-rechazada">Denegado</span>' : '<span class="estado e-cerrada">OK</span>'}</td></tr>`).join('')}
    </table></div></section>`;
};

VISTAS.configuracion = () => `<section class="tarjeta"><h2>Parámetros de las alertas y los datos</h2>
  <form data-form="config" style="max-width:520px">
    <label>Umbral de permanencia (minutos) <input type="number" name="umbralPermanenciaMin" min="10" max="1440" required value="${db.config.umbralPermanenciaMin}"></label>
    <label>Máximo de ingresos por persona en un día sin pre-registro <input type="number" name="maxIngresosDia" min="1" max="20" required value="${db.config.maxIngresosDia}"></label>
    <label>Plazo de conservación de los datos (días) <input type="number" name="conservacionDias" min="30" max="3650" required value="${db.config.conservacionDias}"></label>
    <p class="nota">El plazo de conservación lo define el responsable del tratamiento de datos del conjunto.</p>
    <button class="primario" type="submit">Guardar parámetros</button>
  </form></section>
  ${usuario().rol === 'administracion' ? `<section class="tarjeta"><h2>Datos de demostración</h2>
    <p>Vuelve a cargar los datos ficticios iniciales. Se pierden los cambios hechos en este navegador.</p>
    <button class="peligro" data-accion="restablecer">Restablecer datos de demostración</button></section>` : ''}`;

VISTAS.rendimiento = () => {
  const r = db.pruebas[0];
  return `<section class="tarjeta"><h2>Prueba de rendimiento (CA-08)</h2>
    <p>Genera 10.000 registros sintéticos en memoria y ejecuta 100 consultas por documento y por rango de fechas. No modifica los datos guardados.</p>
    <button class="primario" data-accion="rendimiento">Ejecutar prueba</button>
    ${r ? `<h3 style="margin-top:16px">Resultado del ${fmt(r.fecha)}</h3>
    <table style="max-width:560px"><tr><th>Medida</th><th>Valor</th></tr>
      <tr><td>Registros generados</td><td>${r.registros.toLocaleString('es-CO')}</td></tr>
      <tr><td>Consultas ejecutadas</td><td>${r.consultas}</td></tr>
      <tr><td>Tiempo de generación</td><td>${r.generacionMs} ms</td></tr>
      <tr><td>Tiempo promedio por consulta</td><td>${r.promedioMs} ms</td></tr>
      <tr><td>Percentil 95 por consulta</td><td>${r.p95Ms} ms</td></tr>
      <tr><td>Consulta más lenta</td><td>${r.maxMs} ms</td></tr>
      <tr><td>Criterio: 95 % de las consultas en ≤ 3 segundos</td><td class="${r.cumple ? 'ok-txt' : 'mal-txt'}">${r.cumple ? 'Cumple' : 'No cumple'}</td></tr>
    </table>
    <p class="nota">Prueba hecha en el navegador del equipo. La prueba con 50 usuarios simultáneos se hará sobre el servidor con MySQL.</p>` : ''}</section>`;
};

VISTAS.respaldo = () => {
  const r = db.restauraciones[0];
  const admin = usuario().rol === 'administracion';
  return `<section class="tarjeta"><h2>Respaldo y recuperación</h2>
    <p>En la versión final, la copia se hace cada día, cifrada, y la restauración se prueba cada mes. En el prototipo se puede hacer a mano.</p>
    <div class="fila" style="max-width:760px">
      <button data-accion="probar-restauracion">Probar restauración</button>
      <button data-accion="descargar-respaldo">Descargar copia de seguridad</button>
    </div>
    ${admin ? `<label style="max-width:520px">Restaurar desde una copia (.json) <input type="file" id="f-restaurar" accept=".json,application/json"></label>` : '<p class="nota">El rol de soporte puede probar la restauración, pero no descargar copias con datos personales.</p>'}
    ${r ? `<h3>Última prueba de restauración: ${fmt(r.fecha)}</h3>
    <table style="max-width:560px"><tr><th>Colección</th><th>Original</th><th>Restaurada</th></tr>
    ${r.detalle.map(d => `<tr><td>${esc(d.coleccion)}</td><td>${d.original}</td><td>${d.restaurada}</td></tr>`).join('')}</table>
    <p class="${r.ok ? 'ok-txt' : 'mal-txt'}">${r.ok ? '✔ La copia se restauró completa' : '✖ La copia no coincide con el original'}</p>` : ''}</section>`;
};

/* ---------- Acciones ---------- */
const ACCIONES = {};
const FORMULARIOS = {};

ACCIONES.conexion = () => {
  if (db.enLinea) {
    db.enLinea = false;
    auditar('Caída de internet simulada', 'Se activa el procedimiento de contingencia');
    guardar(); render();
    aviso('Sin conexión. Los registros irán a la cola de contingencia.', 'info');
  } else {
    db.enLinea = true;
    const res = sincronizar();
    guardar(); render();
    aviso(`Conexión restablecida. Cargados: ${res.cargados}. Duplicados descartados: ${res.duplicados}.`, 'ok');
  }
};

ACCIONES['elegir-persona'] = d => {
  const p = persona(d.id);
  $('#f-personaId').value = p.id;
  $('#f-tipo').value = p.tipo;
  $('#persona-nueva').disabled = true;
  $('#f-buscar').value = '';
  $('#resultados-busqueda').innerHTML = `<div class="seleccion"><span>Seleccionado: <b>${esc(p.nombre)}</b> (${esc(p.tipoDoc)} ${esc(p.numDoc)})</span>
    <button type="button" class="mini" data-accion="quitar-persona">Quitar</button></div>`;
  mostrarPreautorizacion();
};
ACCIONES['quitar-persona'] = () => {
  $('#f-personaId').value = '';
  $('#persona-nueva').disabled = false;
  $('#resultados-busqueda').innerHTML = '';
  mostrarPreautorizacion();
};
function buscarPersonas(q) {
  const caja = $('#resultados-busqueda');
  q = q.trim().toLowerCase();
  if (q.length < 2) { caja.innerHTML = ''; return; }
  const r = externos().filter(p => p.nombre.toLowerCase().includes(q) || p.numDoc.includes(q)).slice(0, 6);
  caja.innerHTML = r.length
    ? r.map(p => `<button type="button" data-accion="elegir-persona" data-id="${p.id}">${esc(p.nombre)} · ${esc(p.tipoDoc)} ${esc(p.numDoc)} · ${TIPOS[p.tipo]}</button>`).join('')
    : '<p class="nota">No está registrada. Complete los datos de persona nueva.</p>';
}
function mostrarPreautorizacion() {
  const caja = $('#info-preaut');
  if (!caja) return;
  const pid = $('#f-personaId').value, rid = $('#f-anfitrion').value;
  const pre = pid && rid ? preautorizacionVigente(pid, rid) : null;
  caja.innerHTML = pre ? `<div class="banner info">✔ Pre-autorizada por ${esc(residente(rid).nombre)} hasta el ${pre.hasta}. No requiere llamar al residente.</div>` : '';
  $('#bloque-autorizacion').disabled = !!pre;
}
function cambiarTipo() {
  const res = $('#f-tipo').value === 'residente';
  $('#bloque-residente').hidden = !res;
  $('#bloque-externo').hidden = res;
}

FORMULARIOS.ingreso = async form => {
  const f = Object.fromEntries(new FormData(form));
  const cotejo = $('#f-cotejo').checked;
  const ts = ahora();
  let personaId, residenteId, aut;
  if (f.tipo === 'residente') {
    const r = residente(f.residenteEntra);
    personaId = db.personas.find(p => p.residenteId === r.id).id;
    residenteId = r.id;
    aut = { estado: 'residente', quien: r.nombre, canal: '—', fecha: ts, cotejo: true };
  } else {
    personaId = f.personaId;
    if (!personaId) {
      const nombre = (f.nombre || '').trim(), numDoc = (f.numDoc || '').trim();
      if (!nombre || !numDoc) return aviso('Busque a la persona o escriba su nombre y número de documento.', 'error');
      if (!/^[A-Za-z0-9]{4,15}$/.test(numDoc)) return aviso('El número de documento debe tener entre 4 y 15 letras o números, sin espacios.', 'error');
      const existe = db.personas.find(p => p.tipoDoc === f.tipoDoc && p.numDoc === numDoc);
      if (existe) personaId = existe.id;
      else {
        const p = { id: 'P' + sig('persona'), nombre, tipoDoc: f.tipoDoc, numDoc, tipo: f.tipo };
        db.personas.push(p); personaId = p.id;
        auditar('Persona registrada', `${p.nombre} (${p.tipoDoc} ${p.numDoc}) · ${TIPOS[p.tipo]}`);
      }
    }
    if (!f.residenteId) return aviso('Seleccione al residente anfitrión.', 'error');
    residenteId = f.residenteId;
    const pre = preautorizacionVigente(personaId, residenteId);
    if (pre) aut = { estado: 'preautorizada', quien: residente(residenteId).nombre + ' (pre-autorización)', canal: 'Pre-registro', fecha: ts, cotejo };
    else {
      if (!f.decision) return aviso('Registre la decisión del residente: aprobó, rechazó o sin respuesta.', 'error');
      aut = { estado: f.decision, quien: f.decision === 'pendiente' ? null : residente(residenteId).nombre, canal: f.canal, fecha: f.decision === 'pendiente' ? null : ts, cotejo };
    }
    if (['aprobada', 'preautorizada'].includes(aut.estado) && !cotejo) return aviso('Antes de registrar la entrada, coteje el documento y marque la casilla.', 'error');
  }
  const entra = ['aprobada', 'preautorizada', 'residente'].includes(aut.estado);
  if (entra) {
    const abierta = db.visitas.find(v => v.personaId === personaId && estadoVisita(v) === 'dentro');
    if (abierta) {
      const motivo = await pedirTexto('Ingreso repetido', `${nombreP(personaId)} ya tiene una visita abierta (${abierta.id}, entrada ${fmt(abierta.entrada)}). Revise antes de continuar. Si de todas formas debe registrar el ingreso (por ejemplo, una emergencia), escriba el motivo.`, 'Registrar de todas formas');
      if (motivo === null) return aviso('Registro cancelado. Revise la visita abierta antes de continuar.', 'info');
      alerta('repetido', `${nombreP(personaId)} registró un nuevo ingreso con la visita ${abierta.id} abierta. Motivo: ${motivo}`, abierta.id);
      auditar('Ingreso repetido aceptado', `Visita abierta ${abierta.id}. Motivo: ${motivo}`);
    }
  }
  if (inicioRegistro) { db.tiemposRegistro.push(Math.max(1, Math.round((Date.now() - inicioRegistro) / 1000))); inicioRegistro = null; }
  if (!db.enLinea) {
    const folio = 'C-' + pad(sig('contingencia'), 4);
    encolar({ folio, tipo: 'entrada', personaId, residenteId, tipoPersona: f.tipo, aut, entra, horaCaptura: ts, origen: 'contingencia' });
    guardar(); render();
    return aviso(`Sin conexión: registro guardado con el folio ${folio}. Se cargará al volver la conexión.`, 'info');
  }
  const v = nuevaVisita({ personaId, residenteId, tipo: f.tipo, aut, entrada: entra ? ts : null });
  auditar(entra ? 'Entrada registrada' : 'Visita registrada sin entrada', `${v.id} · ${nombreP(personaId)} · ${AUT[aut.estado]}`);
  if (entra) revisarFrecuencia(personaId);
  guardar(); render();
  if (entra) aviso(`Entrada registrada. Visita ${v.id}.`, 'ok');
  else if (aut.estado === 'rechazada') aviso(`Visita ${v.id} rechazada: no se registra el ingreso. Siga el protocolo del conjunto.`, 'info');
  else aviso(`Visita ${v.id} pendiente: no se marca como autorizada.`, 'info');
};

function exigirEnLinea() {
  if (db.enLinea) return true;
  aviso('Sin conexión: registre el movimiento como nuevo registro (va a la cola) o use el formato en papel.', 'error');
  return false;
}
ACCIONES.aprobar = async d => {
  if (!exigirEnLinea()) return;
  const v = db.visitas.find(x => x.id === d.id);
  if (!await confirmar('Registrar aprobación', `¿El residente aprobó la visita de ${nombreP(v.personaId)} y usted cotejó el documento físico con los datos declarados?`, 'Sí, registrar entrada')) return;
  const ts = ahora();
  v.autorizacion = { ...v.autorizacion, estado: 'aprobada', quien: residente(v.residenteId).nombre, fecha: ts, cotejo: true };
  v.entrada = ts;
  auditar('Entrada registrada', `${v.id} · ${nombreP(v.personaId)} · aprobada después de estar pendiente`);
  revisarFrecuencia(v.personaId);
  guardar(); render(); aviso(`Entrada registrada. Visita ${v.id}.`, 'ok');
};
ACCIONES.rechazar = d => {
  if (!exigirEnLinea()) return;
  const v = db.visitas.find(x => x.id === d.id);
  v.autorizacion = { ...v.autorizacion, estado: 'rechazada', quien: residente(v.residenteId).nombre, fecha: ahora() };
  auditar('Visita rechazada', `${v.id} · ${nombreP(v.personaId)}`);
  guardar(); render(); aviso(`Visita ${v.id} rechazada: no se registra el ingreso.`, 'info');
};
ACCIONES.excepcion = async d => {
  if (!exigirEnLinea()) return;
  const v = db.visitas.find(x => x.id === d.id);
  const motivo = await pedirTexto('Ingreso por excepción', `La visita de ${nombreP(v.personaId)} no tiene autorización del residente. Solo registre el ingreso si el protocolo del conjunto lo permite (por ejemplo, una emergencia) y escriba el motivo.`, 'Registrar excepción');
  if (motivo === null) return;
  const ts = ahora();
  v.autorizacion = { ...v.autorizacion, estado: 'excepcion', quien: usuario().nombre, fecha: ts, motivo };
  v.entrada = ts;
  alerta('sin_autorizacion', `${nombreP(v.personaId)} ingresó sin autorización del residente (${v.id}). Motivo: ${motivo}`, v.id);
  auditar('Ingreso por excepción', `${v.id} · Motivo: ${motivo}`);
  guardar(); render(); aviso('Ingreso por excepción registrado y alerta generada para revisión.', 'info');
};
ACCIONES.salida = d => {
  const v = db.visitas.find(x => x.id === d.id);
  if (!db.enLinea) {
    const folio = 'C-' + pad(sig('contingencia'), 4);
    encolar({ folio, tipo: 'salida', visitaId: v.id, horaCaptura: ahora(), origen: 'contingencia' });
    v.salidaPendiente = folio;
    guardar(); render();
    return aviso(`Sin conexión: salida guardada con el folio ${folio}.`, 'info');
  }
  v.salida = ahora(); v.cerradoPor = usuario().nombre;
  auditar('Salida registrada', `${v.id} · ${nombreP(v.personaId)}`);
  guardar(); render(); aviso(`Salida registrada. Visita ${v.id} cerrada.`, 'ok');
};
FORMULARIOS['buscar-salida'] = form => {
  const q = form.q.value.trim().toLowerCase();
  const caja = $('#res-salida');
  if (q.length < 2) return aviso('Escriba al menos 2 letras o números.', 'error');
  const r = db.visitas.filter(v => estadoVisita(v) === 'dentro').filter(v => {
    const p = persona(v.personaId) || {};
    return [v.id, p.nombre, p.numDoc].some(x => String(x || '').toLowerCase().includes(q));
  });
  caja.innerHTML = r.length
    ? r.map(v => `<div class="seleccion"><span>${v.id} · ${esc(nombreP(v.personaId))} · entrada ${fmt(v.entrada)}</span><button class="mini" data-accion="salida" data-id="${v.id}">Registrar salida</button></div>`).join('')
    : `<div class="banner info">No hay una visita abierta que coincida con «${esc(q)}». <button class="mini" data-accion="incidencia" data-q="${esc(q)}">Crear incidencia para revisión</button></div>`;
};
ACCIONES.incidencia = async d => {
  const texto = await pedirTexto('Salida sin visita abierta', `No se encontró una visita abierta para «${d.q}». Describa el caso para que la administración lo revise.`, 'Crear incidencia', 'Descripción');
  if (texto === null) return;
  const inc = { id: 'I-' + pad(sig('incidencia'), 4), fecha: ahora(), usuario: usuario().nombre, busqueda: d.q, descripcion: texto, estado: 'Abierta' };
  db.incidencias.unshift(inc);
  auditar('Incidencia creada', `${inc.id}: ${texto}`);
  guardar(); render(); aviso(`Incidencia ${inc.id} creada para revisión administrativa.`, 'ok');
};
ACCIONES['revisar-alerta'] = async d => {
  const a = db.alertas.find(x => x.id === d.id);
  const r = await abrirModal('Revisar alerta', `<p><b>${TIPO_ALERTA[a.tipo]}</b>: ${esc(a.descripcion)}</p><label>Observación (opcional)<textarea name="obs" rows="2"></textarea></label>`, 'Marcar revisada');
  if (r === null) return;
  a.revisada = true; a.revisadaPor = usuario().nombre; a.observacion = (r.obs || '').trim();
  auditar('Alerta revisada', `${a.id}${a.observacion ? ': ' + a.observacion : ''}`);
  guardar(); render();
};

ACCIONES.corregir = async d => {
  if (!puede(['administracion'])) return denegarAccion('corregir registros');
  const v = db.visitas.find(x => x.id === d.id);
  const r = await abrirModal(`Corregir ${v.id} · ${nombreP(v.personaId)}`, `
    <label>Residente anfitrión <select name="residenteId"><option value="">— Sin anfitrión —</option>${residentesOpts(v.residenteId)}</select></label>
    <label>Tipo de persona <select name="tipo">${opciones(TIPOS, v.tipo)}</select></label>
    <div class="fila"><label>Entrada <input type="datetime-local" name="entrada" value="${horaInput(v.entrada)}"></label>
    <label>Salida <input type="datetime-local" name="salida" value="${horaInput(v.salida)}"></label></div>
    <label>Motivo de la corrección (obligatorio) <textarea name="motivo" required minlength="5" rows="2"></textarea></label>
    <p class="nota">Se guardan el valor anterior, el nuevo, el usuario, la fecha y el motivo. El historial no se borra.</p>`, 'Guardar corrección');
  if (r === null) return;
  const nuevos = { residenteId: r.residenteId || null, tipo: r.tipo, entrada: deInput(r.entrada), salida: deInput(r.salida) };
  if (nuevos.entrada && nuevos.salida && new Date(nuevos.salida) < new Date(nuevos.entrada)) return aviso('La salida no puede ser anterior a la entrada.', 'error');
  if (nuevos.salida && !nuevos.entrada) return aviso('No puede haber salida sin entrada.', 'error');
  const etiquetas = { residenteId: 'Anfitrión', tipo: 'Tipo de persona', entrada: 'Entrada', salida: 'Salida' };
  const mostrar = (k, val) => k === 'residenteId' ? (residente(val) ? residente(val).unidad : '—') : k === 'tipo' ? TIPOS[val] : fmt(val);
  let n = 0;
  for (const k of Object.keys(nuevos)) {
    const antes = v[k] ?? null;
    const misma = (k === 'entrada' || k === 'salida') ? horaInput(antes) === horaInput(nuevos[k]) : antes === nuevos[k];
    if (misma) continue;
    v.cambios.push({ fecha: ahora(), usuario: usuario().nombre, campo: etiquetas[k], anterior: mostrar(k, antes), nuevo: mostrar(k, nuevos[k]), motivo: r.motivo.trim() });
    auditar('Corrección de registro', `${v.id} · ${etiquetas[k]}: «${mostrar(k, antes)}» → «${mostrar(k, nuevos[k])}». Motivo: ${r.motivo.trim()}`);
    v[k] = nuevos[k]; n++;
  }
  if (!n) return aviso('No cambió ningún dato.', 'info');
  guardar(); render(); aviso(`Corrección guardada (${n} campo(s)).`, 'ok');
};
ACCIONES['ver-cambios'] = d => {
  const v = db.visitas.find(x => x.id === d.id);
  abrirModal(`Historial de cambios de ${v.id}`, `<table><tr><th>Fecha</th><th>Usuario</th><th>Campo</th><th>Anterior</th><th>Nuevo</th><th>Motivo</th></tr>
    ${v.cambios.map(c => `<tr><td>${fmt(c.fecha)}</td><td>${esc(c.usuario)}</td><td>${esc(c.campo)}</td><td>${esc(c.anterior)}</td><td>${esc(c.nuevo)}</td><td>${esc(c.motivo)}</td></tr>`).join('')}</table>`, '', true);
};

FORMULARIOS['filtro-historial'] = form => { filtroHistorial = Object.fromEntries(new FormData(form)); render(); };
FORMULARIOS['filtro-reporte'] = form => {
  const f = Object.fromEntries(new FormData(form));
  if (f.hasta < f.desde) return aviso('La fecha final no puede ser anterior a la inicial.', 'error');
  filtroReporte = f; render();
};
function listaReporte() { filtroReporte = filtroReporte || filtroInicial(); return visitasFiltradas({ ...filtroReporte, texto: '', estado: '' }); }
ACCIONES.excel = () => {
  const lista = listaReporte();
  const celda = c => `"${String(c).replace(/"/g, '""')}"`;
  const csv = '﻿' + [COLS_REPORTE, ...filasReporte(lista)].map(r => r.map(celda).join(';')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `reporte_accesos_${filtroReporte.desde}_a_${filtroReporte.hasta}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  auditar('Reporte exportado', `Excel (CSV) · ${lista.length} registros · ${filtroReporte.desde} a ${filtroReporte.hasta}`);
  guardar(); aviso(`Reporte descargado con ${lista.length} registros.`, 'ok');
};
ACCIONES.pdf = () => {
  const lista = listaReporte();
  const { porTipo } = resumenReporte(lista);
  $('#impresion').innerHTML = `<h2>Reporte de accesos · ${filtroReporte.desde} a ${filtroReporte.hasta}</h2>
    <p>Generado el ${fmt(ahora())} por ${esc(usuario().nombre)}. Total: ${lista.length} registros.
    ${Object.entries(porTipo).map(([k, n]) => `${TIPOS[k]}: ${n}`).join(' · ')}</p>${tablaReporte(lista)}
    <p>Prototipo con datos ficticios.</p>`;
  auditar('Reporte exportado', `PDF · ${lista.length} registros · ${filtroReporte.desde} a ${filtroReporte.hasta}`);
  guardar();
  window.print();
};
ACCIONES['imprimir-formato'] = () => {
  const filas = Array.from({ length: 20 }, (_, i) => `<tr><td>F-${pad(i + 1, 4)}</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>`).join('');
  $('#impresion').innerHTML = `<h2>Formato de contingencia · Registro de accesos sin internet</h2>
    <p>Fecha: ____________ Portería: ____________ Vigilante: ______________________</p>
    <table><tr><th>Folio</th><th>Hora</th><th>Nombre</th><th>Documento</th><th>Tipo de persona</th><th>Anfitrión (unidad)</th><th>¿Autorizó? Sí/No</th><th>Hora de salida</th></tr>${filas}</table>
    <p>Al volver la conexión, transcriba cada folio en «Contingencia sin internet» y guarde este formato como soporte.</p>`;
  auditar('Formato de contingencia impreso', 'Folios F-0001 a F-0020');
  guardar();
  window.print();
};
FORMULARIOS.papel = form => {
  const f = Object.fromEntries(new FormData(form));
  const folio = f.folio.trim().toUpperCase();
  if (db.cola.some(c => c.folio === folio) || db.visitas.some(v => v.folio === folio)) return aviso(`El folio ${folio} ya fue transcrito.`, 'error');
  const r = residente(f.residenteId);
  const hora = deInput(f.hora);
  encolar({ folio, tipo: 'entrada', personaId: f.personaId, residenteId: r.id, tipoPersona: persona(f.personaId).tipo, entra: true, horaCaptura: hora, origen: 'papel',
    aut: { estado: 'aprobada', quien: r.nombre + ' (según formato)', canal: 'Formato en papel', fecha: hora, cotejo: true } });
  guardar(); render();
  aviso(`Folio ${folio} agregado a la cola.${db.enLinea ? ' Use «Simular caída» y «Restablecer» o sincronice al volver la conexión.' : ''}`, 'ok');
};
ACCIONES.sincronizar = () => { const r = sincronizar(); guardar(); render(); aviso(`Cargados: ${r.cargados}. Duplicados descartados: ${r.duplicados}.`, 'ok'); };

FORMULARIOS.preaut = form => {
  if (!puede(['administracion'])) return denegarAccion('crear pre-autorizaciones');
  const f = Object.fromEntries(new FormData(form));
  if (f.hasta < f.desde) return aviso('La fecha final no puede ser anterior a la inicial.', 'error');
  const p = { id: 'PA-' + pad(sig('preaut'), 3), personaId: f.personaId, residenteId: f.residenteId, desde: f.desde, hasta: f.hasta, creadaPor: usuario().nombre, revocada: false };
  db.preautorizaciones.push(p);
  auditar('Pre-autorización creada', `${p.id}: ${nombreP(p.personaId)} → ${residente(p.residenteId).unidad} (${p.desde} a ${p.hasta})`);
  guardar(); render(); aviso(`Pre-autorización ${p.id} guardada.`, 'ok');
};
ACCIONES.revocar = async d => {
  if (!puede(['administracion'])) return denegarAccion('revocar pre-autorizaciones');
  const p = db.preautorizaciones.find(x => x.id === d.id);
  if (!await confirmar('Revocar pre-autorización', `¿Revocar la pre-autorización de ${nombreP(p.personaId)}? Queda en el historial como revocada.`, 'Revocar')) return;
  p.revocada = true;
  auditar('Pre-autorización revocada', p.id);
  guardar(); render();
};

FORMULARIOS.config = form => {
  if (!puede(['administracion', 'soporte'])) return denegarAccion('cambiar la configuración');
  const f = Object.fromEntries(new FormData(form));
  const cambios = [];
  for (const k of ['umbralPermanenciaMin', 'maxIngresosDia', 'conservacionDias']) {
    const n = parseInt(f[k], 10);
    if (Number.isNaN(n)) return aviso('Revise los valores numéricos.', 'error');
    if (n !== db.config[k]) { cambios.push(`${k}: ${db.config[k]} → ${n}`); db.config[k] = n; }
  }
  if (!cambios.length) return aviso('No cambió ningún parámetro.', 'info');
  auditar('Configuración modificada', cambios.join('; '));
  guardar(); render(); aviso('Parámetros guardados.', 'ok');
};
ACCIONES.restablecer = async () => {
  if (!puede(['administracion'])) return denegarAccion('restablecer los datos');
  if (!await confirmar('Restablecer datos', 'Se borrarán los cambios hechos en este navegador y se cargarán de nuevo los datos ficticios iniciales.', 'Restablecer')) return;
  db = semilla(); guardar();
  filtroHistorial = filtroReporte = null;
  irA('porteria'); aviso('Datos de demostración restablecidos.', 'ok');
};

ACCIONES.rendimiento = () => {
  const N = 10000, CONSULTAS = 100;
  const nombres = ['Ana', 'Luis', 'Sofía', 'Jorge', 'Paula', 'Andrés', 'Diana', 'Camilo', 'Laura', 'Mateo'];
  const t0 = performance.now();
  const regs = [];
  const base = Date.now();
  for (let i = 0; i < N; i++) {
    regs.push({ id: 'T-' + pad(i + 1), nombre: `${nombres[i % 10]} Prueba ${i}`, numDoc: String(2000000000 + i), entrada: base - ((i * 7919) % (90 * 864e5)), estado: i % 10 ? 'cerrada' : 'dentro' });
  }
  const generacion = performance.now() - t0;
  const tiempos = [];
  for (let q = 0; q < CONSULTAS; q++) {
    const s = performance.now();
    const doc = String(2000000000 + (q * 97) % N);
    const desde = base - ((q % 30) + 1) * 864e5;
    const r = q % 2
      ? regs.filter(x => x.numDoc === doc)
      : regs.filter(x => x.entrada >= desde && x.entrada <= base);
    r.sort((a, b) => b.entrada - a.entrada);
    tiempos.push(performance.now() - s);
  }
  tiempos.sort((a, b) => a - b);
  const red = x => Math.round(x * 100) / 100;
  const res = {
    fecha: ahora(), registros: N, consultas: CONSULTAS, generacionMs: red(generacion),
    promedioMs: red(tiempos.reduce((a, b) => a + b, 0) / CONSULTAS), p95Ms: red(tiempos[Math.ceil(CONSULTAS * 0.95) - 1]), maxMs: red(tiempos[CONSULTAS - 1])
  };
  res.cumple = res.p95Ms <= 3000;
  db.pruebas.unshift(res);
  auditar('Prueba de rendimiento', `${N} registros, ${CONSULTAS} consultas, p95 ${res.p95Ms} ms`);
  guardar(); render(); aviso(`Prueba terminada: percentil 95 = ${res.p95Ms} ms.`, res.cumple ? 'ok' : 'error');
};

const COLECCIONES = ['residentes', 'personas', 'preautorizaciones', 'visitas', 'alertas', 'incidencias', 'auditoria'];
ACCIONES['probar-restauracion'] = () => {
  const copia = JSON.stringify(db);
  const restaurada = JSON.parse(copia);
  const detalle = COLECCIONES.map(c => ({ coleccion: c, original: db[c].length, restaurada: restaurada[c].length }));
  const ok = detalle.every(d => d.original === d.restaurada) && JSON.stringify(restaurada) === copia;
  db.restauraciones.unshift({ fecha: ahora(), ok, detalle });
  auditar('Prueba de restauración', ok ? 'Copia restaurada completa' : 'La copia no coincide');
  guardar(); render(); aviso(ok ? 'Prueba de restauración correcta.' : 'La prueba de restauración falló.', ok ? 'ok' : 'error');
};
ACCIONES['descargar-respaldo'] = () => {
  if (!puede(['administracion'])) return denegarAccion('descargar copias con datos personales');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(db, null, 1)], { type: 'application/json' }));
  a.download = `respaldo_control_acceso_${fechaInput(Date.now())}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  auditar('Copia de seguridad descargada', `${db.visitas.length} visitas`);
  guardar(); aviso('Copia de seguridad descargada.', 'ok');
};
async function restaurarArchivo(input) {
  if (!puede(['administracion'])) return denegarAccion('restaurar copias');
  const archivo = input.files[0];
  if (!archivo) return;
  try {
    const datos = JSON.parse(await archivo.text());
    if (!COLECCIONES.every(c => Array.isArray(datos[c])) || !datos.config || !datos.seq) throw new Error('estructura');
    if (!await confirmar('Restaurar copia', `La copia tiene ${datos.visitas.length} visitas. Reemplazará los datos actuales de este navegador.`, 'Restaurar')) { input.value = ''; return; }
    const sesion = db.sesion;
    db = datos; db.sesion = sesion;
    auditar('Copia restaurada', `${archivo.name} · ${datos.visitas.length} visitas`);
    guardar(); render(); aviso('Copia restaurada.', 'ok');
  } catch (e) {
    input.value = '';
    aviso('El archivo no es una copia válida de este sistema.', 'error');
  }
}
ACCIONES['filtro-denegados'] = (d, el) => { soloDenegados = el.checked; render(); };

/* ---------- Eventos ---------- */
document.addEventListener('click', e => {
  const b = e.target.closest('[data-accion]');
  if (!b || b.tagName === 'SELECT') return;
  if (b.tagName === 'INPUT' && b.type !== 'checkbox') return;
  const fn = ACCIONES[b.dataset.accion];
  if (fn) { if (b.tagName === 'BUTTON') e.preventDefault(); fn(b.dataset, b); }
});
document.addEventListener('submit', e => {
  const f = e.target.closest('form[data-form]');
  if (!f) return;
  e.preventDefault();
  FORMULARIOS[f.dataset.form](f);
});
document.addEventListener('input', e => {
  if (e.target.closest('form[data-form="ingreso"]') && !inicioRegistro) inicioRegistro = Date.now();
  if (e.target.id === 'f-buscar') buscarPersonas(e.target.value);
});
document.addEventListener('change', e => {
  const t = e.target;
  if (t.closest('form[data-form="ingreso"]') && !inicioRegistro) inicioRegistro = Date.now();
  if (t.id === 'f-tipo') cambiarTipo();
  if (t.id === 'f-anfitrion') mostrarPreautorizacion();
  if (t.id === 'f-restaurar') restaurarArchivo(t);
  if (t.id === 'sel-usuario') {
    db.sesion = t.value;
    auditar('Cambio de usuario', `${usuario().nombre} · ${ROLES[usuario().rol]}`);
    guardar();
    const actual = PANTALLAS.find(p => p.id === (location.hash || '#porteria').slice(1)) || PANTALLAS[0];
    irA(actual.roles.includes(usuario().rol) ? actual.id : PANTALLAS.find(p => p.roles.includes(usuario().rol)).id);
  }
});
window.addEventListener('hashchange', render);

/* ---------- Escenarios para capturas de pantalla (?escenario=...) ---------- */
function prepararEscenario(nombre) {
  const P = n => db.personas.find(p => p.nombre === n).id;
  const entradaCola = (persona, rid, minutos, folio, origen = 'contingencia') => encolar({
    folio, tipo: 'entrada', personaId: P(persona), residenteId: rid, tipoPersona: persona === 'Felipe Duque' ? 'domiciliario' : 'visitante', entra: true,
    horaCaptura: new Date(Date.now() - minutos * 6e4).toISOString(), origen,
    aut: { estado: 'aprobada', quien: residente(rid).nombre, canal: origen === 'papel' ? 'Formato en papel' : 'Citófono', fecha: ahora(), cotejo: true }
  });
  if (nombre === 'sinconexion' || nombre === 'sincronizado') {
    db.enLinea = false;
    entradaCola('Natalia Zuluaga', 'R8', 25, 'C-' + pad(sig('contingencia'), 4));
    entradaCola('Felipe Duque', 'R7', 18, 'C-' + pad(sig('contingencia'), 4));
    entradaCola('Natalia Zuluaga', 'R8', 24, 'F-0001', 'papel');
    if (nombre === 'sincronizado') { db.enLinea = true; sincronizar(); }
  }
  if (nombre === 'alertas') {
    const v = db.visitas.find(x => estadoVisita(x) === 'pendiente');
    v.autorizacion = { ...v.autorizacion, estado: 'excepcion', quien: usuario().nombre, fecha: ahora(), motivo: 'Emergencia médica reportada por el residente' };
    v.entrada = ahora();
    alerta('sin_autorizacion', `${nombreP(v.personaId)} ingresó sin autorización del residente (${v.id}). Motivo: Emergencia médica reportada por el residente`, v.id);
    alerta('repetido', `Mateo López registró un nuevo ingreso con una visita abierta. Motivo: Segundo pedido para otra unidad`, null);
    alerta('frecuencia', 'Felipe Duque ha ingresado 4 veces hoy sin pre-registro (máximo configurado: 3).', null);
  }
  if (nombre === 'correccion') {
    const v = db.visitas.find(x => x.salida && x.tipo === 'contratista');
    v.cambios.push({ fecha: ahora(), usuario: 'Administración (ficticio)', campo: 'Salida', anterior: fmt(v.salida), nuevo: fmt(new Date(new Date(v.salida).getTime() + 15 * 6e4).toISOString()), motivo: 'El guarda registró la salida 15 minutos tarde; se verificó con la minuta.' });
    v.salida = new Date(new Date(v.salida).getTime() + 15 * 6e4).toISOString();
  }
  if (nombre === 'denegado') { /* basta con abrir una pantalla sin permiso */ }
  guardar();
}

/* ---------- Inicio ---------- */
(function iniciar() {
  const qs = new URLSearchParams(location.search);
  if (qs.get('reiniciar') === '1') { try { localStorage.removeItem(CLAVE); } catch (e) { /* sin almacenamiento */ } }
  cargar();
  const u = qs.get('u');
  if (u && db.usuarios.some(x => x.id === u)) db.sesion = u;
  if (qs.get('escenario')) prepararEscenario(qs.get('escenario'));
  render();
  if (qs.get('accion') === 'rendimiento') ACCIONES.rendimiento();
  if (qs.get('accion') === 'probar-restauracion') ACCIONES['probar-restauracion']();
  if (qs.get('accion') === 'ver-cambios') { const v = db.visitas.find(x => x.cambios.length); if (v) ACCIONES['ver-cambios']({ id: v.id }); }
  if (qs.get('accion') === 'llenar') {
    const f = $('form[data-form="ingreso"]');
    ACCIONES['elegir-persona']({ id: db.personas.find(p => p.nombre === 'Santiago Pérez').id });
    f.residenteId.value = 'R4';
    mostrarPreautorizacion();
    f.querySelector('input[name=decision][value=aprobada]').checked = true;
    $('#f-cotejo').checked = true;
  }
})();
