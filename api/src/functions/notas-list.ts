// GET /api/items/{codigo}/notas — historial de notas de seguimiento de un
// item (tabla NotasSeguimiento, Hito 7), más reciente primero. Reemplaza al
// viejo campo único Items.notas_seguimiento: aquí cada nota es su propia
// fila con quién la escribió y cuándo, en vez de un solo texto que se
// sobreescribía en cada guardado.

import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import sql from "mssql";
import { getPool } from "../db";

export async function notasList(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const codigo = request.params.codigo;
  const pool = await getPool();

  const resultado = await pool
    .request()
    .input("codigo", sql.VarChar(20), codigo)
    .query(`
      SELECT ns.id, ns.usuario, ns.fecha, ns.comentario
      FROM NotasSeguimiento ns
      JOIN Items i ON i.id = ns.item_id
      WHERE i.codigo_item = @codigo
      ORDER BY ns.fecha DESC
    `);

  return { jsonBody: resultado.recordset };
}

app.http("notasList", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "items/{codigo}/notas",
  handler: notasList,
});
