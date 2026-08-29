// GET /api/activity-detail — historial completo de ActivityLog a nivel de
// item y campo, para el "Informe mensual" de la vitrina: por cada mes, qué
// items tuvieron actividad y qué cambió exactamente en cada uno (campo,
// valor anterior, valor nuevo, quién lo hizo y cuándo).
//
// A diferencia de activity-summary.ts (que agrega por mes/categoría para la
// gráfica), este endpoint no agrega nada — regresa cada fila de ActivityLog
// tal cual, unida a Items para tener categoría y hallazgo. La vitrina agrupa
// por mes y por item del lado del cliente, igual que ya hace con la gráfica.
//
// authLevel "anonymous" es a propósito, igual que en el resto de los
// endpoints: la protección real la da staticwebapp.config.json (Hito 2).

import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { getPool } from "../db";

export async function activityDetail(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const pool = await getPool();

  const resultado = await pool.request().query(`
    SELECT FORMAT(al.[timestamp], 'yyyy-MM') AS mes, i.codigo_item, i.categoria, i.hallazgo,
           al.[timestamp] AS fecha_hora, al.usuario, al.campo_cambiado,
           al.valor_anterior, al.valor_nuevo
    FROM ActivityLog al
    JOIN Items i ON i.id = al.item_id
    ORDER BY mes DESC, i.codigo_item, al.[timestamp]
  `);

  return { jsonBody: resultado.recordset };
}

app.http("activityDetail", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "activity-detail",
  handler: activityDetail,
});
