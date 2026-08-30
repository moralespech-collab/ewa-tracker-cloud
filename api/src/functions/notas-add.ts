// POST /api/items/{codigo}/notas — agrega una nueva nota de seguimiento a
// un item (tabla NotasSeguimiento, Hito 7). Body: { comentario: string }.
//
// Cada nota agregada también genera su propia fila en ActivityLog
// (campo_cambiado = 'nota_seguimiento', comentario = el texto de la nota,
// valor_anterior/valor_nuevo = NULL porque no hay "antes/después" — es una
// nota nueva, no el cambio de un campo existente). Así la nota aparece
// automáticamente en la gráfica de actividad y en el informe mensual, tal
// como pediste: toda la actividad del item — cambios de campo y notas
// nuevas por igual — queda en el mismo log.
//
// Las dos inserciones van en una sola transacción: si una falla, no
// queremos una nota guardada sin su rastro en ActivityLog (o viceversa).
//
// Hito 7 (ajuste) — máquina de estados, misma regla que en items-update.ts:
//   - Si el item ya está Cancelado/Finalizado, se rechaza (nada se toca).
//   - Si el item sigue "Pendiente", agregar una nota lo pasa a "En
//     progreso" (una nota es evidencia de que alguien ya le está dando
//     seguimiento). Si el item ya estaba en cualquier otro estado
//     (En progreso, Bloqueado) se deja como está — una nota no debe
//     desbloquear un item bloqueado solo.
// El estado final del item viaja en la respuesta (estado_item) para que el
// frontend lo refleje sin tener que volver a pedir el detalle completo.

import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import sql from "mssql";
import { getPool } from "../db";
import { obtenerUsuario } from "../auth";

const COMENTARIO_MAX = 500;
const ESTADOS_TERMINALES = ["Cancelado", "Finalizado"];

export async function notasAdd(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const codigo = request.params.codigo;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return { status: 400, jsonBody: { error: "El cuerpo de la peticion debe ser JSON valido." } };
  }

  const comentarioCrudo = body.comentario;
  if (typeof comentarioCrudo !== "string") {
    return { status: 400, jsonBody: { error: "El campo 'comentario' es obligatorio y debe ser texto." } };
  }
  const comentario = comentarioCrudo.trim();
  if (comentario === "") {
    return { status: 400, jsonBody: { error: "La nota no puede estar vacia." } };
  }
  // Se rechaza en vez de truncar en silencio: truncar sin avisar es
  // exactamente el tipo de falla silenciosa que ya nos mordio una vez este
  // proyecto (el bug de light-dark() de Hito 4) — mejor que el usuario sepa
  // y decida si acortar la nota.
  if (comentario.length > COMENTARIO_MAX) {
    return {
      status: 400,
      jsonBody: {
        error: `La nota no puede pasar de ${COMENTARIO_MAX} caracteres (tiene ${comentario.length}).`,
      },
    };
  }

  const usuario = obtenerUsuario(request);
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();

  try {
    const itemResultado = await transaction
      .request()
      .input("codigo", sql.VarChar(20), codigo)
      .query(`SELECT id, estado FROM Items WHERE codigo_item = @codigo`);

    if (itemResultado.recordset.length === 0) {
      await transaction.rollback();
      return { status: 404, jsonBody: { error: `No existe el item ${codigo}` } };
    }
    const itemId = itemResultado.recordset[0].id as number;
    const estadoActual = itemResultado.recordset[0].estado as string;

    if (ESTADOS_TERMINALES.includes(estadoActual)) {
      await transaction.rollback();
      return {
        status: 409,
        jsonBody: { error: `El item ${codigo} ya esta en estado '${estadoActual}' y no se puede modificar.` },
      };
    }

    const notaInsertada = await transaction
      .request()
      .input("item_id", sql.Int, itemId)
      .input("usuario", sql.VarChar(100), usuario)
      .input("comentario", sql.NVarChar(COMENTARIO_MAX), comentario)
      .query(`
        INSERT INTO NotasSeguimiento (item_id, usuario, comentario)
        OUTPUT INSERTED.id, INSERTED.usuario, INSERTED.fecha, INSERTED.comentario
        VALUES (@item_id, @usuario, @comentario)
      `);

    await transaction
      .request()
      .input("item_id", sql.Int, itemId)
      .input("usuario", sql.VarChar(100), usuario)
      .input("campo_cambiado", sql.VarChar(100), "nota_seguimiento")
      .input("comentario", sql.NVarChar(sql.MAX), comentario)
      .query(`
        INSERT INTO ActivityLog (item_id, usuario, campo_cambiado, comentario)
        VALUES (@item_id, @usuario, @campo_cambiado, @comentario)
      `);

    // Auto-transición: una nota nueva en un item que seguía "Pendiente" lo
    // pasa a "En progreso" (misma regla, y también con su propia fila en
    // ActivityLog, que la de fecha_compromiso en items-update.ts).
    let estadoFinal = estadoActual;
    if (estadoActual === "Pendiente") {
      estadoFinal = "En progreso";
      await transaction
        .request()
        .input("id", sql.Int, itemId)
        .input("estado", sql.VarChar(20), estadoFinal)
        .query(`UPDATE Items SET estado = @estado WHERE id = @id`);

      await transaction
        .request()
        .input("item_id", sql.Int, itemId)
        .input("usuario", sql.VarChar(100), usuario)
        .input("campo_cambiado", sql.VarChar(100), "estado")
        .input("valor_anterior", sql.NVarChar(sql.MAX), "Pendiente")
        .input("valor_nuevo", sql.NVarChar(sql.MAX), estadoFinal)
        .query(`
          INSERT INTO ActivityLog (item_id, usuario, campo_cambiado, valor_anterior, valor_nuevo)
          VALUES (@item_id, @usuario, @campo_cambiado, @valor_anterior, @valor_nuevo)
        `);
    }

    await transaction.commit();

    return {
      status: 201,
      jsonBody: { ...notaInsertada.recordset[0], estado_item: estadoFinal },
    };
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

app.http("notasAdd", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "items/{codigo}/notas",
  handler: notasAdd,
});
