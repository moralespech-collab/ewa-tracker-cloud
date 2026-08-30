// Helper compartido para leer el usuario logeado del header que agrega
// Static Web Apps una vez pasado el login de Hito 2 (x-ms-client-principal,
// en base64). Antes vivía duplicado dentro de items-update.ts; a partir de
// Hito 7, notas-add.ts también lo necesita, así que se movió aquí.

import { HttpRequest } from "@azure/functions";

export function obtenerUsuario(request: HttpRequest): string {
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
