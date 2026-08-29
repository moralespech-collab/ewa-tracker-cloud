// GET /api/items/{codigo} — detalle completo de un item (incluye los campos
// de texto largo que la lista deliberadamente no trae: evidencia, actividad
// propuesta, notas de seguimiento), más el EWA del que viene.

import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import sql from "mssql";
import { getPool } from "../db";

export async function itemsDetail(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const codigo = request.params.codigo;
  const pool = await getPool();

  const resultado = await pool
    .request()
    .input("codigo", sql.VarChar(20), codigo)
    .query(`
      SELECT i.codigo_item, i.categoria, i.hallazgo, i.evidencia, i.actividad_propuesta,
             i.prioridad, i.dueno_seguimiento, i.ejecutor, i.aprobador, i.estado,
             i.fecha_compromiso, i.notas_seguimiento,
             e.codigo_ewa, e.fecha_desde, e.fecha_hasta
      FROM Items i
      JOIN EWAs e ON e.id = i.ewa_id
      WHERE i.codigo_item = @codigo
    `);

  if (resultado.recordset.length === 0) {
    return { status: 404, jsonBody: { error: `No existe el item ${codigo}` } };
  }

  return { jsonBody: resultado.recordset[0] };
}

app.http("itemsDetail", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "items/{codigo}",
  handler: itemsDetail,
});
