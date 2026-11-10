'use strict';
const columnas = require('./nombres-esquema.json');
const rutinas = {
  check_cancellation_reason_match: 'comprobar_motivo_cancelacion',
  generate_monthly_settlement: 'generar_liquidacion_mensual',
  mark_settlement_paid: 'marcar_liquidacion_pagada',
  mark_overdue_settlements: 'marcar_liquidaciones_vencidas',
  get_service_area: 'obtener_zona_servicio',
  is_location_serviceable: 'ubicacion_tiene_cobertura',
  guard_available_ride_offer: 'validar_disponibilidad_oferta'
};

// Se mantienen los contratos JSON existentes; los identificadores físicos son españoles.
// El analizador respeta literales, parámetros, comentarios y alias del ORM.
function traducirSql(sql, nombres = { ...columnas, ...rutinas }, conservarAlias = false) {
  let alias = false;
  return sql.replace(/--[^\n]*|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'|"(?:""|[^"])*"|(?<!:):[A-Za-z_]\w*|\$\d+|[A-Za-z_]\w*/g, (palabra) => {
    if (palabra.startsWith("'") || palabra.startsWith('--') || palabra.startsWith('/*') || palabra.startsWith(':') || palabra.startsWith('$')) return palabra;
    const citado = palabra.startsWith('"');
    const nombre = citado ? palabra.slice(1, -1).replace(/""/g, '"') : palabra;
    if (conservarAlias && alias) {alias = false;return palabra;}
    alias = conservarAlias && nombre.toUpperCase() === 'AS';
    const nuevo = Object.hasOwn(nombres, nombre) ? nombres[nombre] : undefined;
    return nuevo ? citado ? '"' + nuevo + '"' : nuevo : palabra;
  });
}

function configurarEsquema(baseDatos) {
  baseDatos.addHook('afterDefine', (modelo) => {
    for (const atributo of Object.values(modelo.rawAttributes)) {
      if (Object.hasOwn(columnas, atributo.field)) atributo.field = columnas[atributo.field];
    }
    const patronColumnas = new RegExp('(^|_)(' + Object.keys(columnas).sort((a, b) => b.length - a.length).join('|') + ')(?=_|$)', 'g');
    for (const indice of modelo.options.indexes || []) {
      indice.fields = indice.fields.map((campo) => typeof campo === 'string' && Object.hasOwn(columnas, campo) ? columnas[campo] : campo);
      if (indice.name) indice.name = indice.name.replace(patronColumnas, (_, prefijo, campo) => prefijo + columnas[campo]);
    }
    modelo.refreshAttributes();
  });
  const consultar = baseDatos.query.bind(baseDatos);
  const inversos = Object.fromEntries(Object.entries({ ...columnas, ...rutinas }).map(([anterior, nuevo]) => [nuevo, anterior]));
  baseDatos.query = async function consultarEsquema(sql, opciones = {}) {
    // Las migraciones y las consultas del catálogo trabajan con nombres físicos.
    const texto = typeof sql === 'string' ? sql : sql?.query;
    if (opciones.esquemaFisico || typeof texto !== 'string' || /\b(information_schema|pg_catalog|pg_class|pg_proc|pg_type|pg_namespace|pg_enum|pg_constraint|pg_indexes|pg_trigger)\b/.test(texto)) return consultar(sql, opciones);
    const traducido = traducirSql(texto, undefined, Boolean(opciones.model));
    // Las vistas conservan las columnas que espera Sequelize y las consultas existentes.
    const contexto = /^\s*(SELECT|INSERT|UPDATE|DELETE|WITH)\b/i.test(texto)
      ? { searchPath: 'compatibilidad, public', ...opciones }
      : opciones;
    const resultado = await consultar(typeof sql === 'string' ? traducido : { ...sql, query: traducido }, contexto);
    if (opciones.model || opciones.instance) return resultado;
    function restaurarFila(fila) {
      if (!fila || typeof fila !== 'object' || fila instanceof Date || Buffer.isBuffer(fila)) return fila;
      return Object.fromEntries(Object.entries(fila).map(([clave, valor]) => [Object.hasOwn(inversos, clave) ? inversos[clave] : clave, valor]));
    }
    // Solo la primera capa de columnas; los documentos JSON no se modifican.
    if (opciones.type === 'SELECT') return Array.isArray(resultado) ? resultado.map(restaurarFila) : restaurarFila(resultado);
    if (Array.isArray(resultado) && Array.isArray(resultado[0])) return [resultado[0].map(restaurarFila), resultado[1]];
    return resultado;
  };
}

module.exports = { columnas, rutinas, traducirSql, configurarEsquema };
