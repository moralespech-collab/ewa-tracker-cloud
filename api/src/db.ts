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

    const pool = new sql.ConnectionPool({
      server: "sql-ewatracker-portal01.database.windows.net",
      database: "sqldb-ewatracker",
      user: "ewaadmin",
      password,
      options: { encrypt: true },
      // La base es Azure SQL serverless: si lleva un rato sin uso, se pausa
      // y Microsoft documenta que puede tardar hasta ~60s en "despertar" con
      // la próxima conexión. El valor por defecto de la librería (15s) no
      // alcanza para ese caso y hacía fallar el primer request tras un rato
      // de inactividad.
      connectionTimeout: 60000,
      requestTimeout: 60000,
    }).connect();

    // Si la conexión falla, no queremos dejar esta promesa rechazada
    // guardada para siempre: mientras la Function siga "caliente", cada
    // request reutilizaría el mismo error sin volver a intentar. Al
    // resetear aquí, el próximo request dispara una conexión nueva.
    pool.catch(() => {
      poolPromise = null;
    });

    poolPromise = pool;
  }
  // poolPromise no es null en este punto: si entramos al if de arriba lo
  // acabamos de asignar; si no entramos, es porque ya tenía un valor. El
  // "as" es necesario porque el closure del catch (que también asigna
  // poolPromise) le impide a TypeScript probarlo por sí solo.
  return poolPromise as Promise<sql.ConnectionPool>;
}
