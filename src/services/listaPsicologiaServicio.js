'use strict';
const repo = require('./documentosRepositorio');
const PDFDocument = require('pdfkit');

const documentosRequeridos = ['licenseFront', 'licenseBack', 'ticPhoto', 'antecedentsPhoto',
  'ruatPhoto', 'soatPhoto', 'carFront', 'carBack', 'domicileProof'];
const columnas = ['N°', 'Nombre completo', 'CI', 'Teléfono', 'Correo', 'Documentos aprobados'];
const fecha = valor => valor ? new Intl.DateTimeFormat('es-BO', {
  timeZone: 'America/La_Paz', day: '2-digit', month: '2-digit', year: 'numeric'
}).format(new Date(valor)) : '—';

async function obtenerPendientesPsicologia() {
  return repo.select(`
    WITH ultimas AS (
      SELECT DISTINCT ON (id_usuario) * FROM public.solicitud_conductor
      ORDER BY id_usuario, version DESC, creado_en DESC
    )
    SELECT s.id_solicitud_conductor,
      COALESCE(NULLIF(CONCAT_WS(' ', ci.nombres, ci.apellido_paterno, ci.apellido_materno), ''), 'Sin nombre registrado') AS nombre,
      ci.numero_ci AS ci, u.telefono, u.correo, revision.aprobado_en
    FROM ultimas s
    JOIN public.usuario u ON u.id_usuario = s.id_usuario AND u.activo AND u.eliminado_en IS NULL
    LEFT JOIN LATERAL (
      SELECT ci.* FROM public.usuario_documento ud
      JOIN public.documento_ci ci ON ci.id_documento_ci = ud.id_documento
      JOIN public.documento d ON d.id_documento = ci.id_documento_ci
      WHERE ud.id_usuario = s.id_usuario AND d.vigente
      ORDER BY d.creado_en DESC, d.id_documento LIMIT 1
    ) ci ON true
    JOIN LATERAL (
      SELECT MAX(d.verificado_en) AS aprobado_en
      FROM public.solicitud_documento sd JOIN public.documento d USING (id_documento)
      WHERE sd.id_solicitud_conductor = s.id_solicitud_conductor
        AND d.tipo_documento IN (:tipos) AND d.estado_verificacion = 'verificado'
      HAVING COUNT(DISTINCT d.tipo_documento) = :cantidad
    ) revision ON true
    WHERE s.estado = 'pendiente'
      AND NOT EXISTS (SELECT 1 FROM public.evaluacion_psicologica e
        WHERE e.id_solicitud_conductor = s.id_solicitud_conductor AND e.estado = 'realizada')
    ORDER BY nombre, ci.numero_ci, s.id_solicitud_conductor
  `, { tipos: documentosRequeridos, cantidad: documentosRequeridos.length });
}

function valores(persona, indice) {
  return [String(indice + 1), persona.nombre, persona.ci || '—', persona.telefono || 'No registrado',
    persona.correo || 'No registrado', fecha(persona.aprobado_en)];
}

function generarPdf(personas) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36, bufferPages: true,
      info: { Title: 'Solicitantes pendientes de evaluación psicológica', Author: 'Línea Lila' } });
    const partes = [];
    doc.on('data', parte => partes.push(parte));
    doc.on('error', reject);
    doc.on('end', () => resolve(Buffer.concat(partes)));
    const anchos = [26, 200, 80, 100, 220, doc.page.width - 72 - 626];
    let y;
    const encabezado = () => {
      doc.fillColor('#7514C5').font('Helvetica-Bold').fontSize(18)
        .text('Línea Lila | Pendientes de psicología', 36, 30);
      doc.fillColor('#444444').font('Helvetica').fontSize(10)
        .text('Documentos aprobados y sin informe psicológico registrado', 36, 57)
        .text(`Generado: ${fecha(new Date())}    |    Total: ${personas.length}`, 36, 74);
      y = 98;
      doc.rect(36, y, doc.page.width - 72, 29).fill('#7514C5');
      let x = 36;
      columnas.forEach((titulo, i) => {
        doc.fillColor('white').font('Helvetica-Bold').fontSize(9).text(titulo, x + 6, y + 8, { width: anchos[i] - 12 });
        x += anchos[i];
      });
      y += 29;
    };
    encabezado();
    personas.forEach((persona, indice) => {
      const celdas = valores(persona, indice);
      doc.font('Helvetica').fontSize(9);
      const alto = Math.max(31, ...celdas.map((valor, i) => doc.heightOfString(String(valor), { width: anchos[i] - 12 }) + 16));
      if (y + alto > doc.page.height - 45) { doc.addPage(); encabezado(); }
      if (indice % 2 === 0) doc.rect(36, y, doc.page.width - 72, alto).fill('#F7F3FB');
      let x = 36;
      celdas.forEach((valor, i) => {
        doc.fillColor('#222222').font('Helvetica').fontSize(9).text(String(valor), x + 6, y + 8, { width: anchos[i] - 12 });
        x += anchos[i];
      });
      y += alto;
    });
    if (!personas.length) doc.fillColor('#444444').font('Helvetica').fontSize(11)
      .text('No hay solicitantes pendientes de evaluación psicológica.', 42, y + 18);
    const paginas = doc.bufferedPageRange();
    for (let i = 0; i < paginas.count; i++) {
      doc.switchToPage(i);
      doc.fillColor('#666666').font('Helvetica').fontSize(8)
        .text(`Línea Lila - ${i + 1} / ${paginas.count}`, 36, doc.page.height - 25, { lineBreak: false });
    }
    doc.end();
  });
}

module.exports = { obtenerPendientesPsicologia, generarPdf };
