'use strict';

const db = require('../config/baseDatos');
const campos = 'id_contacto_emergencia AS id, nombre, telefono, relacion';

async function listarContactos(solicitud, respuesta) {
  const [contactos] = await db.query(`SELECT ${campos} FROM public.contacto_emergencia
    WHERE id_usuario = :usuario AND activo ORDER BY creado_en`, {
    esquemaFisico: true, replacements: { usuario: solicitud.user.id }
  });
  return respuesta.json({ contactos });
}

async function agregarContacto(solicitud, respuesta) {
  const nombre = typeof solicitud.body?.nombre === 'string' ? solicitud.body.nombre.trim() : '';
  const telefono = typeof solicitud.body?.telefono === 'string' ? solicitud.body.telefono.replace(/[\s().-]/g, '') : '';
  const relacion = typeof solicitud.body?.relacion === 'string' ? solicitud.body.relacion.trim() : '';
  if (!nombre || nombre.length > 100 || !/^\+[1-9]\d{7,14}$/.test(telefono) || relacion.length > 50) {
    return respuesta.status(400).json({ error: 'Ingresa un nombre y un teléfono con código de país, por ejemplo +591 seguido del número.' });
  }
  const usuario = solicitud.user.id;
  let resultado;
  try {
    resultado = await db.transaction(async transaction => {
      const consultar = (sql, replacements) => db.query(sql, { transaction, esquemaFisico: true, replacements });
      await consultar('SELECT id_usuario FROM public.usuario WHERE id_usuario = :usuario FOR UPDATE', { usuario });
      const [activos] = await consultar(`SELECT telefono FROM public.contacto_emergencia WHERE id_usuario = :usuario AND activo`, { usuario });
      if (activos.some(contacto => contacto.telefono.replace(/\D/g, '') === telefono.slice(1))) return { error: 'Ese número ya está registrado.' };
      if (activos.length >= 3) return { error: 'Puedes registrar hasta tres contactos.' };
      const [[contacto]] = await consultar(`INSERT INTO public.contacto_emergencia (id_usuario, nombre, telefono, relacion)
        VALUES (:usuario, :nombre, :telefono, :relacion) RETURNING ${campos}`, { usuario, nombre, telefono, relacion: relacion || null });
      return { contacto };
    });
  } catch (error) {
    if (error.original?.code === '23505' && error.original.constraint === 'contacto_emergencia_telefono_activo_unico') {
      return respuesta.status(409).json({error:'Ese número ya está registrado.'});
    }
    throw error;
  }
  return respuesta.status(resultado.error ? 409 : 201).json(resultado);
}

async function quitarContacto(solicitud, respuesta) {
  const { id } = solicitud.params;
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id)) {
    return respuesta.status(400).json({ error: 'El contacto no es válido.' });
  }
  const [[contacto]] = await db.query(`UPDATE public.contacto_emergencia SET activo = false, actualizado_en = NOW()
    WHERE id_contacto_emergencia = :id AND id_usuario = :usuario AND activo RETURNING id_contacto_emergencia`, {
    esquemaFisico: true, replacements: { id, usuario: solicitud.user.id }
  });
  return contacto ? respuesta.json({ eliminado: true }) : respuesta.status(404).json({ error: 'Contacto no encontrado.' });
}

module.exports = { listarContactos, agregarContacto, quitarContacto };

