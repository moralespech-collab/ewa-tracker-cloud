// GET /api/activity-summary — agrega ActivityLog por mes y categoría, para
// la gráfica "Actividad por mes" de la vitrina. No filtra por item: cuenta
// cualquier cambio de campo (estado, dueño, notas, fecha) como una unidad
// de actividad, agrupada por el mes en que ocurrió y la categoría del item
// al que pertenece (join a Items, igual que items-list.ts).
//
// authLevel "anonymous" es a propósito, igual que en el resto de los
// endpoints: la protección real la da staticwebapp.config.json (Hito 2).

import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { getPool } from "../db";

export async function activitySummary(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const pool = await getPool();

  const resultado = await pool.request().query(`
    SELECT FORMAT(al.[timestamp], 'yyyy-MM') AS mes, i.categoria, COUNT(*) AS cantidad
    FROM ActivityLog al
    JOIN Items i ON i.id = al.item_id
    GROUP BY FORMAT(al.[timestamp], 'yyyy-MM'), i.categoria
    ORDER BY mes, i.categoria
  `);

  return { jsonBody: resultado.recordset };
}

app.http("activitySummary", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "activity-summary",
  handler: activitySummary,
});
