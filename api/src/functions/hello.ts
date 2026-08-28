import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";

// Función de prueba del Hito 1: confirma que las "managed functions" de
// Static Web Apps quedan desplegadas y accesibles junto con el frontend,
// en /api/hello. No toca la base de datos todavía — eso llega en el
// Hito 3, cuando exista el modelo de datos real.
export async function hello(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  context.log(`Petición a ${request.url}`);

  return {
    jsonBody: {
      mensaje: "Hola desde la API del EWA Tracker 👋",
      hito: 1,
      timestamp: new Date().toISOString(),
    },
  };
}

app.http("hello", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "hello",
  handler: hello,
});
