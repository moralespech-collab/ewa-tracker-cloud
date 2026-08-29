// EWA Tracker Cloud — carga inicial de datos (Hito 3)
//
// Lee el Excel real del backlog de Cuprum (hojas "EWAs procesados" y
// "Backlog EWA") y lo inserta en las tablas que ya creamos con
// db/schema.sql. Se corre una sola vez, a mano — no es parte del
// pipeline de CI/CD ni de la app en sí.
//
// Uso (PowerShell):
//   $env:SQL_ADMIN_PASSWORD = "<la contraseña real del admin SQL>"
//   npm install
//   npm run import-seed -- "C:\ruta\a\Cuprum_PS4_EWA_Backlog.xlsx"

import * as XLSX from "xlsx";
import sql from "mssql";

// Info que el Excel no trae en columna propia, pero sí en la hoja "Leyenda"
// como texto libre — la dejamos como un mapa chico, editable a mano si
// algún día se agrega un sistema nuevo (QS4, etc.).
const PRODUCTO_SAP_POR_SISTEMA: Record<string, string> = {
  PS4: "SAP S/4HANA 2022",
};

function parseFechaDMY(valor: unknown): Date | null {
  if (!valor || typeof valor !== "string") return null;
  const partes = valor.trim().split("/");
  if (partes.length !== 3) return null;
  const [d, m, y] = partes.map(Number);
  if (!d || !m || !y) return null;
  return new Date(Date.UTC(y, m - 1, d));
}

async function main() {
  const rutaExcel = process.argv[2];
  if (!rutaExcel) {
    console.error("Uso: npm run import-seed -- <ruta al .xlsx>");
    process.exit(1);
  }

  const password = process.env.SQL_ADMIN_PASSWORD;
  if (!password) {
    console.error("Falta la variable de entorno SQL_ADMIN_PASSWORD.");
    process.exit(1);
  }

  console.log(`Leyendo ${rutaExcel}...`);
  const wb = XLSX.readFile(rutaExcel);
  const hojaBacklog = wb.Sheets["Backlog EWA"];
  const hojaEwas = wb.Sheets["EWAs procesados"];
  if (!hojaBacklog || !hojaEwas) {
    console.error('No encontré las hojas "Backlog EWA" y/o "EWAs procesados" en el archivo.');
    process.exit(1);
  }

  const filasBacklog: any[] = XLSX.utils.sheet_to_json(hojaBacklog, { defval: null });
  const filasEwas: any[] = XLSX.utils
    .sheet_to_json<any>(hojaEwas, { defval: null })
    // la hoja trae una fila en blanco y una fila de instrucciones al final
    // (texto largo en la columna "ID EWA") — nos quedamos solo con filas
    // cuyo "ID EWA" tenga el formato real (EWA-01, EWA-02, ...) y además
    // traigan un Sistema. Un simple ".trim().length > 0" no bastaba: la
    // fila de instrucciones también tiene texto ahí.
    .filter(
      (f) =>
        typeof f["ID EWA"] === "string" &&
        /^EWA-\d+$/i.test(f["ID EWA"].trim()) &&
        typeof f["Sistema"] === "string" &&
        f["Sistema"].trim().length > 0
    );

  console.log(`${filasEwas.length} EWA(s) y ${filasBacklog.length} item(s) de backlog encontrados.`);

  const pool = await sql.connect({
    server: "sql-ewatracker-portal01.database.windows.net",
    database: "sqldb-ewatracker",
    user: "ewaadmin",
    password,
    options: { encrypt: true },
  });

  try {
    // Si ya hay datos cargados, no reinsertamos encima — evita duplicados
    // por un doble `npm run import-seed`.
    const existentes = await pool.request().query("SELECT COUNT(*) AS n FROM Items");
    if (existentes.recordset[0].n > 0) {
      console.error(
        "La tabla Items ya tiene datos. Si quieres reimportar desde cero, borra las filas " +
          "primero (en orden: ActivityLog, Items, EWAs, Sistemas) y vuelve a correr este script."
      );
      process.exit(1);
    }

    // 1) Sistemas — uno por cada código distinto que aparezca en "EWAs procesados".
    const idsSistemaPorCodigo = new Map<string, number>();
    for (const fila of filasEwas) {
      const codigo = String(fila["Sistema"]).trim();
      if (idsSistemaPorCodigo.has(codigo)) continue;

      const resultado = await pool
        .request()
        .input("codigo", sql.VarChar(10), codigo)
        .input("producto_sap", sql.VarChar(100), PRODUCTO_SAP_POR_SISTEMA[codigo] ?? null)
        .query(
          "INSERT INTO Sistemas (codigo, producto_sap) OUTPUT INSERTED.id VALUES (@codigo, @producto_sap)"
        );
      idsSistemaPorCodigo.set(codigo, resultado.recordset[0].id);
      console.log(`Sistema ${codigo} -> id ${resultado.recordset[0].id}`);
    }

    // 2) EWAs
    const idsEwaPorCodigo = new Map<string, number>();
    for (const fila of filasEwas) {
      const codigoEwa = String(fila["ID EWA"]).trim();
      const sistemaId = idsSistemaPorCodigo.get(String(fila["Sistema"]).trim())!;

      const resultado = await pool
        .request()
        .input("sistema_id", sql.Int, sistemaId)
        .input("codigo_ewa", sql.VarChar(20), codigoEwa)
        .input("fecha_desde", sql.Date, parseFechaDMY(fila["Fecha analisis desde"]))
        .input("fecha_hasta", sql.Date, parseFechaDMY(fila["Fecha analisis hasta"]))
        .input("fecha_carga", sql.Date, parseFechaDMY(fila["Fecha de carga"]))
        .input("cargado_por", sql.VarChar(100), fila["Cargado por"] ?? null)
        .input("notas", sql.NVarChar(sql.MAX), fila["Notas"] ?? null)
        .query(
          `INSERT INTO EWAs (sistema_id, codigo_ewa, fecha_desde, fecha_hasta, fecha_carga, cargado_por, notas)
           OUTPUT INSERTED.id
           VALUES (@sistema_id, @codigo_ewa, @fecha_desde, @fecha_hasta, @fecha_carga, @cargado_por, @notas)`
        );
      idsEwaPorCodigo.set(codigoEwa, resultado.recordset[0].id);
      console.log(`EWA ${codigoEwa} -> id ${resultado.recordset[0].id}`);
    }

    // 3) Items — esta primera carga asume que TODAS las filas de "Backlog EWA"
    // pertenecen al único EWA que hay en "EWAs procesados" (hoy es el caso: un
    // solo EWA-01). El día que existan varios EWAs a la vez, "Backlog EWA"
    // necesita su propia columna de código de EWA para saber a cuál pertenece
    // cada item — anótalo como pendiente para el próximo ciclo.
    const [unicoEwaCodigo] = idsEwaPorCodigo.keys();
    const ewaIdParaItems = idsEwaPorCodigo.get(unicoEwaCodigo)!;

    let insertados = 0;
    for (const fila of filasBacklog) {
      await pool
        .request()
        .input("ewa_id", sql.Int, ewaIdParaItems)
        .input("codigo_item", sql.VarChar(20), String(fila["ID"]).trim())
        .input("categoria", sql.VarChar(30), fila["Categoria"])
        .input("hallazgo", sql.NVarChar(sql.MAX), fila["Hallazgo"])
        .input("evidencia", sql.NVarChar(sql.MAX), fila["Evidencia (EWA)"] ?? null)
        .input("actividad_propuesta", sql.NVarChar(sql.MAX), fila["Actividad propuesta"] ?? null)
        .input("prioridad", sql.VarChar(10), fila["Prioridad"])
        .input("dueno_seguimiento", sql.VarChar(100), fila["seguimiento"] ?? null)
        .input("ejecutor", sql.VarChar(100), fila["Ejecutor propuesto"] ?? null)
        .input("aprobador", sql.VarChar(100), fila["Aprobador"] ?? null)
        .input("estado", sql.VarChar(20), fila["Estado"] ?? "Pendiente")
        .input("fecha_compromiso", sql.Date, parseFechaDMY(fila["Fecha compromiso"]))
        .input("notas_seguimiento", sql.NVarChar(sql.MAX), fila["Notas de seguimiento"] ?? null)
        .query(
          `INSERT INTO Items
             (ewa_id, codigo_item, categoria, hallazgo, evidencia, actividad_propuesta,
              prioridad, dueno_seguimiento, ejecutor, aprobador, estado, fecha_compromiso, notas_seguimiento)
           VALUES
             (@ewa_id, @codigo_item, @categoria, @hallazgo, @evidencia, @actividad_propuesta,
              @prioridad, @dueno_seguimiento, @ejecutor, @aprobador, @estado, @fecha_compromiso, @notas_seguimiento)`
        );
      insertados++;
    }

    console.log(`Listo: ${insertados} items insertados en Items.`);
  } finally {
    await pool.close();
  }
}

main().catch((err) => {
  console.error("Error durante la importación:", err);
  process.exit(1);
});
