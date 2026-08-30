// GET /api/items/export — Hito 10: backlog completo, con exactamente las
// columnas que espera POST /api/items/import (categoria, hallazgo,
// evidencia, actividad_propuesta, prioridad).
//
// Por qué existe aparte de GET /api/items: ese endpoint (items-list.ts)
// deja fuera evidencia/actividad_propuesta a propósito desde el Hito 4,
// para no traer 48+ textos largos cada vez que se abre la vitrina. Este
// endpoint sí los trae — pero solo se llama cuando Javi le da click al
// botón "Descargar backlog actual" en la página "Importar EWA", no en
// cada carga de la app.
//
// Sin filtros, sin paginación: siempre el backlog completo — el objetivo
// es que sirva de referencia de "qué ya está trackeado" al comparar contra
// un reporte EWA nuevo, así que un item Cancelado/Finalizado también debe
// aparecer (si un hallazgo ya cerrado reaparece en el reporte, eso importa
// saberlo, no se descarta silenciosamente).

import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { getPool } from "../db";

export async function itemsExportFull(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const pool = await getPool();

  const resultado = await pool.request().query(`
    SELECT categoria, hallazgo, evidencia, actividad_propuesta, prioridad
    FROM Items
    ORDER BY codigo_item
  `);

  return { jsonBody: resultado.recordset };
}

app.http("itemsExportFull", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "items/export",
  handler: itemsExportFull,
});
