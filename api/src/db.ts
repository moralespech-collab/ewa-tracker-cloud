// Conexión compartida a Azure SQL. Las managed functions de Static Web Apps
// no soportan Managed Identity (lo confirmamos antes de escribir esto), así
// que nos conectamos con el usuario ewaadmin + contraseña, guardada como
// Application Setting (SQL_ADMIN_PASSWORD) — nunca en el código ni en el repo.
//
// El pool se crea una sola vez y se reutiliza entre invocaciones de la
// Function mientras la instancia siga "caliente" — abrir una conexión nueva
// en cada request sería innecesariamente lento (y, bajo carga, agotaría las
// conexiones que la base serverless permite).

import sql from "mssql";

let poolPromise: Promise<sql.ConnectionPool> | null = null;

export function getPool(): Promise<sql.ConnectionPool> {
  if (!poolPromise) {
    const password = process.env.SQL_ADMIN_PASSWORD;
    if (!password) {
      throw new Error("Falta la variable de entorno SQL_ADMIN_PASSWORD.");
    }

    poolPromise = new sql.ConnectionPool({
      server: "sql-ewatracker-portal01.database.windows.net",
      database: "sqldb-ewatracker",
      user: "ewaadmin",
      password,
      options: { encrypt: true },
    }).connect();
  }
  return poolPromise;
}
