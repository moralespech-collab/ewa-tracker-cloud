// PATCH /api/items/{codigo} — actualiza estado, dueño de seguimiento y/o
// fecha de compromiso de un item (los únicos campos editables desde la
// vitrina; el resto viene del EWA original y es de solo lectura incluso
// aquí). Actualización parcial: solo se tocan los campos que vengan en el
// body. Cada campo que realmente cambie de valor genera su propia fila en
// ActivityLog, con el usuario logeado (leído del header
// x-ms-client-principal que agrega Static Web Apps una vez pasado el login
// de Hito 2).
//
// Hito 7: notas_seguimiento salió de este endpoint. Antes era un campo más
// que se sobreescribía aquí; ahora vive en su propia tabla (NotasSeguimiento)
// con su propio endpoint (notas-list.ts / notas-add.ts), porque dejó de ser
// "un campo del item" para ser una bitácora de muchas notas por item.
//
// Hito 8: ejecutor salió de la respuesta de este endpoint también — se
// fusionó en dueno_seguimiento (nunca fue un campo editable aquí, pero se
// devolvía en el item actualizado; ya no tiene caso).
//
// Hito 11: aprobador se vuelve editable. Antes se mostraba en la vitrina
// como dato de solo lectura (venía del Excel del Hito 3) y desde el reinicio
// de la base de datos (import por CSV) siempre queda NULL, sin ninguna
// forma de llenarlo — Javi pidió poder editarlo igual que el responsable.
// Incluido en el whitelist justo como dueno_seguimiento: mismo tipo
// (VARCHAR(100) nullable), misma regla de terminales (bloqueado si el item
// ya está Cancelado/Finalizado).
//
// Hito 7 (ajuste): máquina de estados. Reglas, en las palabras de Javi:
//   - Una vez que un item sale de "Pendiente", nunca puede volver ahí.
//   - "Cancelado" y "Finalizado" son terminales: el item ya no se puede
//     modificar en absoluto (ni estado, ni responsable, ni fecha, ni notas).
//   - Poner fecha de compromiso a un item que sigue "Pendiente" lo pasa
//     solo a "En progreso" (aunque no tenga responsable todavía) — la misma
//     regla que ya existía para agregar una nota (ver notas-add.ts).
// Todo lo demás (Pendiente -> cualquiera, En progreso <-> Bloqueado, etc.)
// es libre.

import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import sql from "mssql";
import { getPool } from "../db";
import { obtenerUsuario } from "../auth";

const ESTADOS_VALIDOS = ["Pendiente", "En progreso", "Finalizado", "Bloqueado", "Cancelado"];
const ESTADOS_TERMINALES = ["Cancelado", "Finalizado"];

// Whitelist a propósito: nunca se arma SQL con nombres de columna que vengan
// del body de la petición, solo con estos tres, elegidos a mano.
const CAMPOS_EDITABLES = ["estado", "dueno_seguimiento", "aprobador", "fecha_compromiso"] as const;
type CampoEditable = (typeof CAMPOS_EDITABLES)[number];

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
        SELECT id, estado, dueno_seguimiento, aprobador, fecha_compromiso
        FROM Items
        WHERE codigo_item = @codigo
      `);

    if (actual.recordset.length === 0) {
      await transaction.rollback();
      return { status: 404, jsonBody: { error: `No existe el item ${codigo}` } };
    }

    const itemActual = actual.recordset[0];
    const itemId = itemActual.id as number;

    // Cancelado/Finalizado son terminales: se rechaza el PATCH completo,
    // no solo el cambio de estado — un item terminado no se toca en nada.
    if (ESTADOS_TERMINALES.includes(itemActual.estado)) {
      await transaction.rollback();
      return {
        status: 409,
        jsonBody: { error: `El item ${codigo} ya esta en estado '${itemActual.estado}' y no se puede modificar.` },
      };
    }

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

      // Una vez que un item sale de "Pendiente" ya no puede volver — si
      // llegó hasta aquí es porque el valor SÍ cambia, así que el estado
      // anterior no puede ser ya "Pendiente" (si lo fuera, nuevoValor
      // tendría que ser distinto de "Pendiente" para pasar el filtro de
      // arriba).
      if (campo === "estado" && nuevoValor === "Pendiente") {
        await transaction.rollback();
        return {
          status: 400,
          jsonBody: { error: "No se puede regresar el estado a 'Pendiente' una vez que salio de ahi." },
        };
      }

      cambiosReales.push({ campo, anterior: valorActualComparable, nuevo: nuevoValor });

      if (campo === "estado") {
        setClauses.push("estado = @estado");
        updateRequest.input("estado", sql.VarChar(20), nuevoValor);
      } else if (campo === "dueno_seguimiento") {
        setClauses.push("dueno_seguimiento = @dueno_seguimiento");
        updateRequest.input("dueno_seguimiento", sql.VarChar(100), nuevoValor);
      } else if (campo === "aprobador") {
        setClauses.push("aprobador = @aprobador");
        updateRequest.input("aprobador", sql.VarChar(100), nuevoValor);
      } else if (campo === "fecha_compromiso") {
        setClauses.push("fecha_compromiso = @fecha_compromiso");
        updateRequest.input("fecha_compromiso", sql.Date, nuevoValor ? new Date(nuevoValor) : null);
      }
    }

    // Auto-transición: poner fecha de compromiso a un item que sigue
    // Pendiente lo pasa a "En progreso", aunque nadie haya tocado el
    // selector de Estado en este mismo guardado. Si el usuario SÍ mandó un
    // estado distinto en el mismo PATCH, ese ya está en cambiosReales y se
    // respeta tal cual — no se pisa con esta regla.
    const yaTraeCambioDeEstado = cambiosReales.some((c) => c.campo === "estado");
    const cambioDeFecha = cambiosReales.find((c) => c.campo === "fecha_compromiso");
    if (!yaTraeCambioDeEstado && cambioDeFecha && cambioDeFecha.nuevo !== null && itemActual.estado === "Pendiente") {
      cambiosReales.push({ campo: "estado", anterior: "Pendiente", nuevo: "En progreso" });
      setClauses.push("estado = @estado");
      updateRequest.input("estado", sql.VarChar(20), "En progreso");
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
               prioridad, dueno_seguimiento, aprobador, estado,
               fecha_compromiso
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
