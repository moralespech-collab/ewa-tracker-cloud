-- EWA Tracker Cloud — esquema de base de datos (Hito 3)
-- Azure SQL Database (T-SQL). Se aplica una sola vez, a mano, desde el
-- Query Editor del Portal — no forma parte del pipeline de CI/CD.
--
-- Orden de creación: Sistemas -> EWAs -> Items -> ActivityLog, porque
-- cada una referencia a la anterior por llave foránea.

CREATE TABLE Sistemas (
    id              INT IDENTITY(1,1) PRIMARY KEY,
    codigo          VARCHAR(10)  NOT NULL UNIQUE,   -- ej. 'PS4', 'QS4'
    producto_sap    VARCHAR(100) NULL               -- ej. 'SAP S/4HANA 2022'
);

CREATE TABLE EWAs (
    id              INT IDENTITY(1,1) PRIMARY KEY,
    sistema_id      INT NOT NULL REFERENCES Sistemas(id),
    codigo_ewa      VARCHAR(20)  NOT NULL UNIQUE,   -- ej. 'EWA-01'
    fecha_desde     DATE NOT NULL,
    fecha_hasta     DATE NOT NULL,
    fecha_carga     DATE NOT NULL,
    cargado_por     VARCHAR(100) NULL,
    notas           NVARCHAR(MAX) NULL
);

CREATE TABLE Items (
    id                   INT IDENTITY(1,1) PRIMARY KEY,
    ewa_id               INT NOT NULL REFERENCES EWAs(id),
    codigo_item          VARCHAR(20)  NOT NULL UNIQUE,   -- ej. 'BAS-01'
    categoria            VARCHAR(30)  NOT NULL
        CHECK (categoria IN ('Basis', 'ABAP/Desarrollo', 'Seguridad', 'Funcional', 'Arquitectura', 'Integraciones/UX')),
    hallazgo             NVARCHAR(MAX) NOT NULL,
    evidencia            NVARCHAR(MAX) NULL,
    actividad_propuesta  NVARCHAR(MAX) NULL,
    prioridad            VARCHAR(10) NOT NULL
        CHECK (prioridad IN ('Alta', 'Media', 'Baja')),
    dueno_seguimiento    VARCHAR(100) NULL,
    ejecutor             VARCHAR(100) NULL,
    aprobador            VARCHAR(100) NULL,
    estado               VARCHAR(20) NOT NULL DEFAULT 'Pendiente'
        CHECK (estado IN ('Pendiente', 'En progreso', 'Finalizado', 'Bloqueado', 'Cancelado')),
    fecha_compromiso     DATE NULL,
    notas_seguimiento    NVARCHAR(MAX) NULL
);

CREATE TABLE ActivityLog (
    id               INT IDENTITY(1,1) PRIMARY KEY,
    item_id          INT NOT NULL REFERENCES Items(id),
    [timestamp]      DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    usuario          VARCHAR(100) NOT NULL,
    campo_cambiado   VARCHAR(100) NOT NULL,
    valor_anterior   NVARCHAR(MAX) NULL,
    valor_nuevo      NVARCHAR(MAX) NULL,
    comentario       NVARCHAR(MAX) NULL
);

-- Índices sobre las llaves foráneas: no son obligatorios (SQL Server no los
-- crea solo), pero con ActivityLog creciendo con cada cambio de cada item,
-- ayudan a que las consultas por item no escaneen la tabla completa.
CREATE INDEX IX_Items_EwaId ON Items(ewa_id);
CREATE INDEX IX_ActivityLog_ItemId ON ActivityLog(item_id);

-- Hito 7 — NotasSeguimiento: bitácora de notas por item (uno-a-muchos), en
-- vez del campo Items.notas_seguimiento (que se sobreescribía en cada
-- guardado y no dejaba historial). Cada nota agregada además genera su
-- propia fila en ActivityLog (campo_cambiado = 'nota_seguimiento',
-- comentario = texto de la nota), para que aparezca en el informe mensual
-- igual que cualquier otro cambio.
--
-- Items.notas_seguimiento se deja en la tabla (no se borra la columna) por
-- ahora — dejó de leerse/escribirse desde la API, pero tumbar una columna
-- es un cambio que no se puede deshacer sin restaurar un backup, así que
-- se queda ahí hasta que estemos seguros de que ya no hace falta. Ver
-- db/migration-hito7-notas-seguimiento.sql para el script que crea esta
-- tabla y migra las notas que ya existían en esa columna.
CREATE TABLE NotasSeguimiento (
    id          INT IDENTITY(1,1) PRIMARY KEY,
    item_id     INT NOT NULL REFERENCES Items(id),
    usuario     VARCHAR(100) NOT NULL,
    fecha       DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    comentario  NVARCHAR(500) NOT NULL
);
CREATE INDEX IX_NotasSeguimiento_ItemId ON NotasSeguimiento(item_id);
