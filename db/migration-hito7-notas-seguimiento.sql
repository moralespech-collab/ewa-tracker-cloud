-- Hito 7 — crea NotasSeguimiento y migra las notas que ya existían en
-- Items.notas_seguimiento hacia la nueva tabla.
--
-- Se corre UNA VEZ, a mano, desde el Query Editor del Portal de Azure —
-- igual que schema.sql en Hito 3. No forma parte del pipeline de CI/CD.
--
-- Qué hace, en orden:
--   1. Crea la tabla NotasSeguimiento (ver comentario largo en schema.sql
--      sobre por qué es una tabla aparte y no una columna en Items).
--   2. Migra cada nota que ya existía en Items.notas_seguimiento como la
--      primera fila de su item en la tabla nueva — usando el usuario y la
--      fecha REALES de la última vez que se guardó esa nota, tomados de
--      ActivityLog (ahí ya quedó registrado cada cambio del campo
--      notas_seguimiento desde que existe el PATCH de items). No se
--      inventa un usuario ni una fecha genérica para la migración.
--
-- Después de correr esto, Items.notas_seguimiento se queda como está (con
-- los mismos textos) — no se toca ni se borra la columna. Ver el
-- comentario en schema.sql sobre por qué.

CREATE TABLE NotasSeguimiento (
    id          INT IDENTITY(1,1) PRIMARY KEY,
    item_id     INT NOT NULL REFERENCES Items(id),
    usuario     VARCHAR(100) NOT NULL,
    fecha       DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    comentario  NVARCHAR(500) NOT NULL
);
CREATE INDEX IX_NotasSeguimiento_ItemId ON NotasSeguimiento(item_id);

-- Migración: un item entra aquí solo si (a) tiene texto en
-- notas_seguimiento y (b) existe al menos una fila en ActivityLog donde
-- ese campo haya cambiado (que es como llegó ese texto ahí en primer
-- lugar, así que en la práctica siempre debería existir). CROSS APPLY con
-- TOP 1 ... ORDER BY timestamp DESC toma el guardado más reciente de ese
-- campo por item.
INSERT INTO NotasSeguimiento (item_id, usuario, fecha, comentario)
SELECT i.id, al.usuario, al.[timestamp], LEFT(i.notas_seguimiento, 500)
FROM Items i
CROSS APPLY (
    SELECT TOP 1 usuario, [timestamp]
    FROM ActivityLog
    WHERE item_id = i.id AND campo_cambiado = 'notas_seguimiento'
    ORDER BY [timestamp] DESC
) al
WHERE i.notas_seguimiento IS NOT NULL AND i.notas_seguimiento <> '';

-- Verificación rápida después de correr lo de arriba — debería regresar
-- una fila por cada item que tenía nota (a la fecha de escribir esto,
-- BAS-01 y ABAP-01, de tus pruebas de Hito 4/5):
-- SELECT ns.*, i.codigo_item FROM NotasSeguimiento ns JOIN Items i ON i.id = ns.item_id;
