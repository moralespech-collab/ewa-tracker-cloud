// POST /api/items/import — Hito 10: alta de items nuevos detectados en un
// reporte EWA semanal.
//
// El flujo real (decidido con Javi, no automatizado del todo a propósito:
// SAP no da un ID estable para la mayoría de las alertas de un EWA, así que
// un merge 100% automático no es realista — ver README):
//   1. Javi comparte el reporte EWA de la semana + un CSV fresco del
//      backlog actual (el que ya baja el botón "Descargar CSV" del Hito 9).
//   2. Se compara a mano/asistido y se arma un CSV solo con lo que es
//      genuinamente nuevo: categoria, hallazgo, evidencia,
//      actividad_propuesta, prioridad — sin codigo_item, sin responsable,
//      sin fecha de compromiso. Ese CSV se sube desde la vitrina.
//   3. Este endpoint recibe esas filas ya en JSON (el parseo de CSV pasa en
//      el navegador, ver web/index.html) junto con el sistema y el periodo
//      del reporte, y hace el alta real.
//
// Dos cosas se asignan aquí, nunca las manda quien llama al endpoint, para
// no arriesgar una colisión si dos personas importan casi al mismo tiempo:
//   - El código de EWA (EWA-02, EWA-03, ...), o se reutiliza el EWA si ya
//     existe uno con el mismo sistema y el mismo periodo (para que correr
//     el import dos veces por accidente no duplique nada).
//   - El código de cada item (BAS-03, SEC-01, ...), consecutivo dentro de
//     su categoría.
//
// Los items nuevos entran con estado = 'Pendiente' (el DEFAULT del
// schema) — nunca se decide aquí un estado distinto, ni un responsable, ni
// una fecha de compromiso; eso se asigna después desde la vitrina, como
// cualquier otro item.
//
// categoria/hallazgo/evidencia/actividad_propuesta/prioridad se quedan de
// solo lectura una vez creado el item, igual que los que vinieron del
// import original del Hito 3 — si algo queda mal capturado, se corrige a
// mano en el Query Editor del Portal, no desde la app (decisión explícita
// de Javi: no vale la pena abrir esos campos a edición por esto).

import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import sql from "mssql";
import { getPool } from "../db";
import { obtenerUsuario } from "../auth";

const CATEGORIAS_VALIDAS = [
  "Basis",
  "ABAP/Desarrollo",
  "Seguridad",
  "Funcional",
  "Arquitectura",
  "Integraciones/UX",
];
const PRIORIDADES_VALIDAS = ["Alta", "Media", "Baja"];

// Prefijo de codigo_item por categoría — confirmado con Javi en el Hito 10.
const PREFIJO_CATEGORIA: Record<string, string> = {
  Basis: "BAS",
  "ABAP/Desarrollo": "ABAP",
  Seguridad: "SEC",
  Funcional: "FUN",
  Arquitectura: "ARQ",
  "Integraciones/UX": "INT",
};

interface FilaImport {
  categoria: string;
  hallazgo: string;
  evidencia: string | null;
  actividad_propuesta: string | null;
  prioridad: string;
}

export async function itemsImport(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return { status: 400, jsonBody: { error: "El cuerpo de la peticion debe ser JSON valido." } };
  }

  const sistema = body.sistema;
  const fechaDesde = body.fecha_desde;
  const fechaHasta = body.fecha_hasta;
  const items = body.items;

  if (typeof sistema !== "string" || sistema.trim() === "") {
    return { status: 400, jsonBody: { error: "Falta 'sistema' (ej. 'PS4')." } };
  }
  if (typeof fechaDesde !== "string" || typeof fechaHasta !== "string" || !fechaDesde || !fechaHasta) {
    return { status: 400, jsonBody: { error: "Faltan 'fecha_desde'/'fecha_hasta' (formato YYYY-MM-DD)." } };
  }
  if (!Array.isArray(items) || items.length === 0) {
    return { status: 400, jsonBody: { error: "'items' debe ser un arreglo con al menos un elemento." } };
  }

  // Se valida TODO antes de tocar la base — todo o nada. Un import a
  // medias por un error en la fila 40 de 50 dejaría un EWA creado con solo
  // parte de sus items, lo cual es peor que rechazar el archivo completo.
  const filas: FilaImport[] = [];
  for (let i = 0; i < items.length; i++) {
    const fila = items[i] as Record<string, unknown>;
    const numFila = i + 1;

    if (typeof fila.categoria !== "string" || !CATEGORIAS_VALIDAS.includes(fila.categoria)) {
      return {
        status: 400,
        jsonBody: { error: `Fila ${numFila}: categoria invalida ('${fila.categoria}'). Validas: ${CATEGORIAS_VALIDAS.join(", ")}.` },
      };
    }
    if (typeof fila.hallazgo !== "string" || fila.hallazgo.trim() === "") {
      return { status: 400, jsonBody: { error: `Fila ${numFila}: falta 'hallazgo'.` } };
    }
    if (typeof fila.prioridad !== "string" || !PRIORIDADES_VALIDAS.includes(fila.prioridad)) {
      return {
        status: 400,
        jsonBody: { error: `Fila ${numFila}: prioridad invalida ('${fila.prioridad}'). Validas: ${PRIORIDADES_VALIDAS.join(", ")}.` },
      };
    }

    filas.push({
      categoria: fila.categoria,
      hallazgo: fila.hallazgo.trim(),
      evidencia: typeof fila.evidencia === "string" && fila.evidencia.trim() !== "" ? fila.evidencia.trim() : null,
      actividad_propuesta:
        typeof fila.actividad_propuesta === "string" && fila.actividad_propuesta.trim() !== ""
          ? fila.actividad_propuesta.trim()
          : null,
      prioridad: fila.prioridad,
    });
  }

  const usuario = obtenerUsuario(request);
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();

  try {
    const sistemaResultado = await transaction
      .request()
      .input("codigo", sql.VarChar(10), sistema)
      .query(`SELECT id FROM Sistemas WHERE codigo = @codigo`);

    if (sistemaResultado.recordset.length === 0) {
      await transaction.rollback();
      return { status: 404, jsonBody: { error: `No existe el sistema '${sistema}'.` } };
    }
    const sistemaId = sistemaResultado.recordset[0].id as number;

    // Reutiliza el EWA si ya existe uno con el mismo sistema y el mismo
    // periodo exacto (mismo fecha_desde y fecha_hasta) — así correr este
    // import dos veces por accidente con el mismo reporte no crea un
    // EWA-03 y un EWA-04 para la misma semana.
    let ewaId: number;
    let codigoEwa: string;
    const ewaExistente = await transaction
      .request()
      .input("sistema_id", sql.Int, sistemaId)
      .input("fecha_desde", sql.Date, new Date(fechaDesde))
      .input("fecha_hasta", sql.Date, new Date(fechaHasta))
      .query(`
        SELECT id, codigo_ewa FROM EWAs
        WHERE sistema_id = @sistema_id AND fecha_desde = @fecha_desde AND fecha_hasta = @fecha_hasta
      `);

    if (ewaExistente.recordset.length > 0) {
      ewaId = ewaExistente.recordset[0].id as number;
      codigoEwa = ewaExistente.recordset[0].codigo_ewa as string;
    } else {
      const siguienteEwa = await transaction.request().query(`
        SELECT ISNULL(MAX(CAST(SUBSTRING(codigo_ewa, 5, 10) AS INT)), 0) + 1 AS siguiente
        FROM EWAs WHERE codigo_ewa LIKE 'EWA-%'
      `);
      const numeroEwa = siguienteEwa.recordset[0].siguiente as number;
      codigoEwa = "EWA-" + String(numeroEwa).padStart(2, "0");

      const nuevoEwa = await transaction
        .request()
        .input("sistema_id", sql.Int, sistemaId)
        .input("codigo_ewa", sql.VarChar(20), codigoEwa)
        .input("fecha_desde", sql.Date, new Date(fechaDesde))
        .input("fecha_hasta", sql.Date, new Date(fechaHasta))
        .input("fecha_carga", sql.Date, new Date())
        .input("cargado_por", sql.VarChar(100), usuario)
        .query(`
          INSERT INTO EWAs (sistema_id, codigo_ewa, fecha_desde, fecha_hasta, fecha_carga, cargado_por)
          OUTPUT INSERTED.id
          VALUES (@sistema_id, @codigo_ewa, @fecha_desde, @fecha_hasta, @fecha_carga, @cargado_por)
        `);
      ewaId = nuevoEwa.recordset[0].id as number;
    }

    // Consecutivo por prefijo de categoría: se consulta el máximo actual
    // una sola vez por prefijo (no una vez por fila) y se incrementa en
    // memoria dentro de la misma transacción — así dos items de la misma
    // categoría en el mismo import no compiten por el mismo número.
    const siguienteNumero: Record<string, number> = {};
    const itemsCreados: { codigo_item: string; categoria: string }[] = [];

    for (const fila of filas) {
      const prefijo = PREFIJO_CATEGORIA[fila.categoria];

      if (siguienteNumero[prefijo] === undefined) {
        const resultado = await transaction
          .request()
          .input("patron", sql.VarChar(20), prefijo + "-%")
          .query(`
            SELECT ISNULL(MAX(CAST(SUBSTRING(codigo_item, ${prefijo.length + 2}, 10) AS INT)), 0) + 1 AS siguiente
            FROM Items WHERE codigo_item LIKE @patron
          `);
        siguienteNumero[prefijo] = resultado.recordset[0].siguiente as number;
      }

      const numero = siguienteNumero[prefijo]++;
      const codigoItem = prefijo + "-" + String(numero).padStart(2, "0");

      const insertado = await transaction
        .request()
        .input("ewa_id", sql.Int, ewaId)
        .input("codigo_item", sql.VarChar(20), codigoItem)
        .input("categoria", sql.VarChar(30), fila.categoria)
        .input("hallazgo", sql.NVarChar(sql.MAX), fila.hallazgo)
        .input("evidencia", sql.NVarChar(sql.MAX), fila.evidencia)
        .input("actividad_propuesta", sql.NVarChar(sql.MAX), fila.actividad_propuesta)
        .input("prioridad", sql.VarChar(10), fila.prioridad)
        .query(`
          INSERT INTO Items (ewa_id, codigo_item, categoria, hallazgo, evidencia, actividad_propuesta, prioridad)
          OUTPUT INSERTED.id
          VALUES (@ewa_id, @codigo_item, @categoria, @hallazgo, @evidencia, @actividad_propuesta, @prioridad)
        `);
      const itemId = insertado.recordset[0].id as number;

      // Alta también queda en ActivityLog, igual que cualquier otro cambio
      // (Hito 7): así "Actividad por mes" refleja cuándo entró cada item,
      // no solo cuándo se editó.
      await transaction
        .request()
        .input("item_id", sql.Int, itemId)
        .input("usuario", sql.VarChar(100), usuario)
        .input("campo_cambiado", sql.VarChar(100), "creacion")
        .input("comentario", sql.NVarChar(sql.MAX), `Item creado desde ${codigoEwa}`)
        .query(`
          INSERT INTO ActivityLog (item_id, usuario, campo_cambiado, comentario)
          VALUES (@item_id, @usuario, @campo_cambiado, @comentario)
        `);

      itemsCreados.push({ codigo_item: codigoItem, categoria: fila.categoria });
    }

    await transaction.commit();

    return {
      status: 201,
      jsonBody: {
        codigo_ewa: codigoEwa,
        items_creados: itemsCreados.length,
        items: itemsCreados,
      },
    };
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

app.http("itemsImport", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "items/import",
  handler: itemsImport,
});
