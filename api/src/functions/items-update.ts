// PATCH /api/items/{codigo} — actualiza estado, notas de seguimiento y/o
// fecha de compromiso de un item (los únicos campos editables desde la
// vitrina; el resto viene del EWA original y es de solo lectura incluso
// aquí). Actualización parcial: solo se tocan los campos que vengan en el
// body. Cada campo que realmente cambie de valor genera su propia fila en
// ActivityLog, con el usuario logeado (leído del header x-ms-client-principal
// que agrega Static Web Apps una vez pasado el login de Hito 2).

import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import sql from "mssql";
import { getPool } from "../db";

const ESTADOS_VALIDOS = ["Pendiente", "En progreso", "Finalizado", "Bloqueado", "Cancelado"];

// Whitelist a propósito: nunca se arma SQL con nombres de columna que vengan
// del body de la petición, solo con estos tres, elegidos a mano.
const CAMPOS_EDITABLES = ["estado", "notas_seguimiento", "fecha_compromiso"] as const;
type CampoEditable = (typeof CAMPOS_EDITABLES)[number];

function obtenerUsuario(request: HttpRequest): string {
  const header = request.headers.get("x-ms-client-principal");
  if (!header) {
    return "desconocido";
  }
  try {
    const decoded = Buffer.from(header, "base64").toString("utf-8");
    const principal = JSON.parse(decoded) as { userDetails?: string };
    return principal.userDetails ?? "desconocido";
  } catch {
    return "desconocido";
  }
}

export async function itemsUpdate(
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

  const cambios: Partial<Record<CampoEditable, string | null>> = {};
  for (const campo of CAMPOS_EDITABLES) {
    if (Object.prototype.hasOwnProperty.call(body, campo)) {
      const valor = body[campo];
      if (valor !== null && typeof valor !== "string") {
        return { status: 400, jsonBody: { error: `El campo '${campo}' debe ser texto o null.` } };
      }
      cambios[campo] = valor;
    }
  }

  if (Object.keys(cambios).length === 0) {
    return {
      status: 400,
      jsonBody: {
        error: `No se recibio ningun campo editable. Los campos permitidos son: ${CAMPOS_EDITABLES.join(", ")}.`,
      },
    };
  }

  if (
    cambios.estado !== undefined &&
    cambios.estado !== null &&
    !ESTADOS_VALIDOS.includes(cambios.estado)
  ) {
    return {
      status: 400,
      jsonBody: { error: `Estado invalido. Valores permitidos: ${ESTADOS_VALIDOS.join(", ")}.` },
    };
  }

  const usuario = obtenerUsuario(request);
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();

  try {
    const actual = await transaction
      .request()
      .input("codigo", sql.VarChar(20), codigo)
      .query(`
        SELECT id, estado, notas_seguimiento, fecha_compromiso
        FROM Items
        WHERE codigo_item = @codigo
      `);

    if (actual.recordset.length === 0) {
      await transaction.rollback();
      return { status: 404, jsonBody: { error: `No existe el item ${codigo}` } };
    }

    const itemActual = actual.recordset[0];
    const itemId = itemActual.id as number;

    const setClauses: string[] = [];
    const updateRequest = transaction.request().input("id", sql.Int, itemId);
    const cambiosReales: { campo: CampoEditable; anterior: unknown; nuevo: unknown }[] = [];

    for (const campo of CAMPOS_EDITABLES) {
      if (!(campo in cambios)) continue;
      const nuevoValor = cambios[campo] ?? null;

      const valorActualCrudo = itemActual[campo];
      const valorActualComparable =
        valorActualCrudo instanceof Date
          ? valorActualCrudo.toISOString().slice(0, 10)
          : valorActualCrudo;

      if (nuevoValor === valorActualComparable) continue; // sin cambio real, no genera log ni UPDATE

      cambiosReales.push({ campo, anterior: valorActualComparable, nuevo: nuevoValor });

      if (campo === "estado") {
        setClauses.push("estado = @estado");
        updateRequest.input("estado", sql.VarChar(20), nuevoValor);
      } else if (campo === "notas_seguimiento") {
        setClauses.push("notas_seguimiento = @notas_seguimiento");
        updateRequest.input("notas_seguimiento", sql.NVarChar(sql.MAX), nuevoValor);
      } else if (campo === "fecha_compromiso") {
        setClauses.push("fecha_compromiso = @fecha_compromiso");
        updateRequest.input("fecha_compromiso", sql.Date, nuevoValor ? new Date(nuevoValor) : null);
      }
    }

    if (setClauses.length === 0) {
      await transaction.rollback();
      return {
        jsonBody: { mensaje: "No hubo cambios reales: los valores enviados son iguales a los actuales." },
      };
    }

    await updateRequest.query(`UPDATE Items SET ${setClauses.join(", ")} WHERE id = @id`);

    for (const cambio of cambiosReales) {
      await transaction
        .request()
        .input("item_id", sql.Int, itemId)
        .input("usuario", sql.VarChar(100), usuario)
        .input("campo_cambiado", sql.VarChar(100), cambio.campo)
        .input("valor_anterior", sql.NVarChar(sql.MAX), cambio.anterior === null ? null : String(cambio.anterior))
        .input("valor_nuevo", sql.NVarChar(sql.MAX), cambio.nuevo === null ? null : String(cambio.nuevo))
        .query(`
          INSERT INTO ActivityLog (item_id, usuario, campo_cambiado, valor_anterior, valor_nuevo)
          VALUES (@item_id, @usuario, @campo_cambiado, @valor_anterior, @valor_nuevo)
        `);
    }

    await transaction.commit();

    const actualizado = await pool
      .request()
      .input("codigo", sql.VarChar(20), codigo)
      .query(`
        SELECT codigo_item, categoria, hallazgo, evidencia, actividad_propuesta,
               prioridad, dueno_seguimiento, ejecutor, aprobador, estado,
               fecha_compromiso, notas_seguimiento
        FROM Items
        WHERE codigo_item = @codigo
      `);

    return { jsonBody: actualizado.recordset[0] };
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

app.http("itemsUpdate", {
  methods: ["PATCH"],
  authLevel: "anonymous",
  route: "items/{codigo}",
  handler: itemsUpdate,
});
