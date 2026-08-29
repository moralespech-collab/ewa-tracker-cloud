// GET /api/items — lista de items del backlog, con filtro opcional por
// categoria/estado/prioridad vía query params (?categoria=Basis&estado=Pendiente).
// Incluye "sistema" (join hasta Sistemas) para que la vitrina no tenga que
// pedir el detalle de cada item solo para saber de qué sistema es.
//
// authLevel "anonymous" es a propósito: la protección real de este endpoint
// no la da Azure Functions, la da staticwebapp.config.json (Hito 2) — todo
// /api/* ya exige el rol "colaborador" antes de que la petición llegue aquí.

import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import sql from "mssql";
import { getPool } from "../db";

export async function itemsList(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const categoria = request.query.get("categoria");
  const estado = request.query.get("estado");
  const prioridad = request.query.get("prioridad");

  const pool = await getPool();
  const dbRequest = pool.request();

  const condiciones: string[] = [];
  if (categoria) {
    condiciones.push("categoria = @categoria");
    dbRequest.input("categoria", sql.VarChar(30), categoria);
  }
  if (estado) {
    condiciones.push("estado = @estado");
    dbRequest.input("estado", sql.VarChar(20), estado);
  }
  if (prioridad) {
    condiciones.push("prioridad = @prioridad");
    dbRequest.input("prioridad", sql.VarChar(10), prioridad);
  }
  const where = condiciones.length > 0 ? `WHERE ${condiciones.join(" AND ")}` : "";

  const resultado = await dbRequest.query(`
    SELECT i.codigo_item, i.categoria, i.hallazgo, i.prioridad, i.dueno_seguimiento,
           i.ejecutor, i.aprobador, i.estado, i.fecha_compromiso, s.codigo AS sistema
    FROM Items i
    JOIN EWAs e ON e.id = i.ewa_id
    JOIN Sistemas s ON s.id = e.sistema_id
    ${where}
    ORDER BY
      CASE i.prioridad WHEN 'Alta' THEN 1 WHEN 'Media' THEN 2 WHEN 'Baja' THEN 3 END,
      i.codigo_item
  `);

  return { jsonBody: resultado.recordset };
}

app.http("itemsList", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "items",
  handler: itemsList,
});
