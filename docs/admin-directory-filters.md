# Filtros y Paginacion Administrativa

Fecha: 2026-11-05. Implementacion local; sin despliegue.

## Alcance

Se agrega `AdminDirectoryModule` con consultas de solo lectura. No se modifica
el contrato de `GET /register`, `GET /court-reserve`, nombres, ranking o reservas.
No crea tablas, cuotas, indices, trabajos programados o variables nuevas.
Los esquemas existentes se reutilizan con autoCreate/autoIndex desactivados
en este modulo. Las modificaciones locales ajenas se mantienen intactas.

Todas las rutas requieren `JwtAuthGuard` y `AdminGuard`. El servicio vuelve a
consultar el rol y estado del administrador en base, para rechazar claims de
rol antiguos o cuentas inactivas.

## Contratos

`GET /admin-directory/members`:

- `search`: nombre/correo, hasta 120 caracteres, busqueda literal sin distinguir
  mayusculas ni acentos habituales en espanol. Los metacaracteres regex se escapan.
- `state`: `active` o `inactive`; ausencia significa todos.
- `memberType`: `Titular` o `Carga`; Familiar legado se interpreta como Carga.
- `access`: `allowed` o `blocked`; no se deriva solo del flag updatePayment.
- `page`: entero 1..100000, por defecto 1. `pageSize`: 25, 50 o 100.

Respuesta: `{ items, total, page, pageSize, pages }`. Orden estable por nombre
con collation espanola y desempate `_id`. Paginas obsoletas se ajustan a la ultima
existente. Sin resultados se devuelve pagina 1, pages 1 e items vacio.
La proyeccion excluye contrasena, tokens de verificacion/recuperacion e historial
financiero; solo devuelve campos de edicion y permiso efectivo de reserva.

`GET /admin-directory/titulares?excludeId=...&currentId=...`:

Lista ligera e independiente de la pagina actual. Ofrece titulares activos,
excluyendo al socio editado. Puede incluir su asociacion actual inactiva para
identificarla y preservarla; React no la ofrece como nueva opcion elegible.
La asociacion se valida nuevamente al guardar por la ruta administrativa existente.

`GET /admin-directory/reserves`:

- `search`: player1..player4 y nombre de visita, literal y sin acentos.
- `from`/`to`: fechas calendario ISO; rechaza fechas imposibles y rango invertido.
- `court`: Cancha 1, 2 o 3. `turn`: uno de los ocho turnos existentes.
- Misma paginacion que Usuarios. Orden: fecha, turno, cancha y `_id`.

Solo reservas con state true, futuras o de hoy cuyo turno no haya terminado.
La hora se evalua en America/Santiago; fin 00:00 equivale a 24:00 del dia de juego.
No retorna claves de acceso, datos de pago ni reservas historicas/canceladas.
DTOs transforman y validan valores; campos desconocidos son rechazados.

## Permiso Efectivo y Coste

Se reutilizan `financialAccess` y `reservationPermissions`, con el mismo estado
de `MEMBERSHIP_PORTAL_ENABLED` que usa el portal. Es una variable existente,
no una bandera nueva. Cuando el portal esta deshabilitado no se exige configuracion
financiera para consultar el listado y se conserva la politica legada.

Sin filtro de acceso, MongoDB cuenta y devuelve solo la pagina solicitada; las
cuotas se consultan en lote para esa pagina. Con filtro de acceso, el servidor
lee los candidatos de los otros filtros y sus cuotas en lote, calcula la politica
completa y pagina los resultados despues. Esto preserva reglas de deuda faltante,
revision de inicio, excepcion administrativa y bloqueo manual, sin N+1.
Este ultimo filtro sigue teniendo coste proporcional a los candidatos: no se
presenta como una consulta financiera indexada ni como rendimiento certificado
para miles de socios. No se instala una cache ni se agrega estado derivado.

## Validacion

- 6 pruebas nuevas de policy/DTO/guards. Regresion backend: 726 aprobadas;
  211 integraciones preexistentes omitidas, NO dadas por validadas en esta corrida.
- Regresion frontend: 382 aprobadas, incluidas busqueda diferida, respuesta tardia,
  cancelacion, restauracion de URL, asociacion de titular y eliminacion existente.
- Arnes `test/admin-directory.e2e.ts`: MongoDB temporal en loopback, Nest y JWT
  reales; 61 socios, 63 reservas y una cuota ficticia, sin SMTP ni Mercado Pago.
  26 controles de API/estado final, incluyendo JWT vencido, rol persistido,
  filtros cruzados, tildes, paginas sin duplicados, tamanos, proyecciones y
  snapshots completos sin alteraciones. La base desechable se elimina al terminar.
- React contra ese backend: Chromium/WebKit a 320/390/820/1440px; 8 vistas,
  97 comprobaciones. Incluye cambio 25/50, titulares fuera de pagina, retorno
  desde Categorias conservando filtros/pagina y ausencia de desbordes.
- TypeScript frontend/backend, build Vite y ESLint frontend aprobados.
- ESLint de archivos nuevos backend se ejecuta con printWidth 120 de develop.
  La configuracion local ajena tiene printWidth 240 y max-len 120; no se modifica.
- Las fuentes remotas se sustituyen en la prueba: los iconos Material Icons y
  Safari en dispositivos fisicos no quedan certificados. No se prueban pagos reales.

Evidencia resumida en `docs/evidence/admin-directory/`; el frontend conserva
capturas y reporte del navegador en su carpeta de evidencia del mismo nombre.

## Compatibilidad y Pendiente Fuera de Alcance

Desplegar backend antes de este frontend: las vistas nuevas necesitan las tres
rutas administrativas. No hay fallback al listado completo antiguo.
Las rutas antiguas mantienen su comportamiento; no se utiliza GET para generar
datos ni se llama al proveedor de correo o pagos.

Se detecto que la ruta antigua `DELETE /court-reserve/:id` no declaraba guard JWT.
Despues de esta tarea, el usuario aprobo corregirla con permisos de administrador
y creador, y sin inferir propiedad en reservas antiguas. Contrato y evidencia:
[autorizacion de cancelacion](reservation-cancellation-security.md).
Es un alcance separado; no implica una auditoria completa de rutas legadas.

## Reproduccion Aislada

```bash
node node_modules/jest/bin/jest.js --runInBand admin-directory.spec.ts
node node_modules/typescript/bin/tsc --noEmit --incremental false -p tsconfig.build.json
node -r ts-node/register test/admin-directory.e2e.ts mongodb://127.0.0.1:29479/ctq_directory_test_filters /private/tmp/ctq-admin-directory-validation /ruta/tennis-court-front /ruta/playwright/index.mjs
```

El arnes rechaza hosts distintos de 127.0.0.1 o bases fuera del prefijo
`ctq_directory_test_`. No importa `.env` ni levanta AppModule, cron o servicios reales.
