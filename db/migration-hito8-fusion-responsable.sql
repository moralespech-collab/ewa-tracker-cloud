-- Hito 8 — fusiona ejecutor en dueno_seguimiento ("persona responsable").
--
-- Se corre UNA VEZ, a mano, desde el Query Editor del Portal de Azure —
-- igual que schema.sql en Hito 3 y la migración del Hito 7. No forma parte
-- del pipeline de CI/CD.
--
-- Por qué: en la práctica de Javi, "ejecutor" y "dueño de seguimiento" son
-- el mismo concepto — quien da seguimiento es quien dispara la acción
-- (transacción, ticket, caso con SAP), sin importar quién la ejecuta
-- materialmente en el sistema. La separación venía del Excel original de
-- Cuprum (columnas "Ejecutor propuesto" y, más tarde, la que se volvió
-- dueno_seguimiento), nunca de una decisión de este proyecto.
--
-- Qué hace: para cada item donde dueno_seguimiento sigue vacío (nunca se
-- editó desde que se importó el Excel en el Hito 3) pero ejecutor sí trae
-- un valor real, copia ese valor a dueno_seguimiento — así no se pierde la
-- asignación original. Si un item YA tiene dueno_seguimiento (alguien lo
-- editó desde la vitrina, como Roberto Ortiz en ABAP-11), ese valor gana:
-- no se pisa un dato editado a mano con el valor viejo del Excel.
--
-- No se inserta nada en ActivityLog para este cambio: a diferencia de la
-- migración de notas del Hito 7 (donde SÍ había un usuario y una fecha
-- reales, tomados del historial de ediciones vía API), el valor de
-- ejecutor nunca se editó por la API — llegó directo del import del Excel,
-- que tampoco quedó loggeado. Inventar un usuario/fecha para este cambio
-- sería un dato falso en el historial.
--
-- Después de correr esto, Items.ejecutor se queda como está (no se toca ni
-- se borra la columna) — ver el comentario en schema.sql sobre por qué.

UPDATE Items
SET dueno_seguimiento = ejecutor
WHERE (dueno_seguimiento IS NULL OR dueno_seguimiento = '')
  AND ejecutor IS NOT NULL AND ejecutor <> '';

-- Verificación rápida después de correr lo de arriba: compara cuántos
-- items tenían ejecutor pero no dueno_seguimiento (deberían ser 0 después
-- del UPDATE) contra el total de items con ejecutor no vacío.
-- SELECT
--   SUM(CASE WHEN ejecutor IS NOT NULL AND ejecutor <> '' THEN 1 ELSE 0 END) AS con_ejecutor,
--   SUM(CASE WHEN ejecutor IS NOT NULL AND ejecutor <> '' AND (dueno_seguimiento IS NULL OR dueno_seguimiento = '') THEN 1 ELSE 0 END) AS todavia_sin_responsable
-- FROM Items;
