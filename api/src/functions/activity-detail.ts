// GET /api/activity-detail — historial completo de ActivityLog a nivel de
// item y campo, para el "Informe mensual" de la vitrina: por cada mes, qué
// items tuvieron actividad y qué cambió exactamente en cada uno (campo,
// valor anterior, valor nuevo, quién lo hizo y cuándo).
//
// Hito 7: se agrega la columna comentario. Los cambios de campo (estado,
// dueño, fecha) la traen NULL y siguen usando valor_anterior/valor_nuevo;
// las notas de seguimiento nuevas (campo_cambiado = 'nota_seguimiento', ver
// notas-add.ts) no tienen "antes/después" — es texto agregado, no un campo
// que cambió — así que viajan en comentario en su lugar.
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
           al.valor_anterior, al.valor_nuevo, al.comentario
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
