// GET /api/notas — todas las notas de seguimiento de todos los items, cada
// una con el codigo_item al que pertenece (Hito 7). Alimenta el reporte
// "Avance de items" de la vitrina: en vez de pedir las notas item por item
// (habría que hacerlo una vez por cada item con actividad), se traen todas
// de una sola vez y el cliente las agrupa por item — el mismo patrón que ya
// usa GET /api/items para el backlog completo.
//
// authLevel "anonymous" es a propósito, igual que en el resto de los
// endpoints: la protección real la da staticwebapp.config.json (Hito 2).

import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { getPool } from "../db";

export async function notasListTodas(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const pool = await getPool();

  const resultado = await pool.request().query(`
    SELECT ns.id, ns.usuario, ns.fecha, ns.comentario, i.codigo_item
    FROM NotasSeguimiento ns
    JOIN Items i ON i.id = ns.item_id
    ORDER BY i.codigo_item, ns.fecha DESC
  `);

  return { jsonBody: resultado.recordset };
}

app.http("notasListTodas", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "notas",
  handler: notasListTodas,
});
