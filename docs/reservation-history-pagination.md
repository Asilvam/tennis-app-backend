# Paginacion del Historial Propio de Reservas

Fecha: 2026-11-05. Implementacion local solicitada, sin despliegue.

## Alcance y Contrato

`GET /court-reserve/my-history?page=1&pageSize=25` requiere `JwtAuthGuard`.
El servicio consulta la cuenta activa mediante el email autenticado; busca el
nombre persistido en player1..player4, igual que el historial anterior. No acepta
nombre/email/rol del cliente para elegir el historial de otro socio.
No agrega filtros ni modifica criterios de cancelacion, fechas o ranking.

Parametros: page entero de 1 a 100000; pageSize 25, 50 o 100. Por defecto 1/25.
ValidationPipe transforma valores, aplica whitelist y rechaza campos extra.

```json
{
  "items": [],
  "total": 0,
  "cancelled": 0,
  "page": 1,
  "pageSize": 25,
  "pages": 1
}
```

El servidor cuenta total y canceladas sobre todo el historial del socio, no solo
la pagina. Obtiene items con skip/limit. Conserva fecha descendente, turno y
cancha ascendentes; agrega _id como desempate estable. Paginas obsoletas se
ajustan a la ultima existente; historial vacio usa page/pages 1 y contadores 0.

La proyeccion conserva datos de presentacion y participantes para el detalle;
no expone passCourtReserve, ownerEmail ni metadatos de pago. El criterio existente
de participacion sigue basado en nombres, no se migra a nuevos IDs en esta tarea.

Errores: 401 por sesion ausente/vencida; 403 por cuenta inactiva/inexistente o
sin nombre; 400 por parametros invalidos. Las restricciones financieras no
bloquean esta lectura. No hay excepcion admin para consultar identidades ajenas.

La ruta anterior `history/:namePlayer` permanece intacta para otros consumidores.
No se cambian esquemas, indices, cuotas, correo, pagos, jobs ni env.example.
Los conteos siguen siendo consultas MongoDB; no se certifica rendimiento a gran
escala ni se agregan cache/estado derivado. El trafico de items queda acotado
a la pagina solicitada, en lugar de descargar todo el historial al frontend.

## Frontend

MyHistoryReserve consume el nuevo contrato. Usa 25/50/100 y el control visual de
paginacion ya ajustado: una fila en escritorio, dos compactas en movil.
El componente compartido acepta solo datos/acciones de paginacion, sin consultas
administrativas ni permisos de administracion en el historial del socio.

Pagina/tamano se conservan en URL. Cambiar tamano reinicia pagina 1; respuesta
con pagina ajustada actualiza URL. Tras cancelar se recarga la misma pagina:
la reserva permanece como cancelada y aumenta el contador global correspondiente.
Se mantienen SweetAlert2, detalle con nombres completos y bloqueo de doble envio.

Loading inicial mantiene AppLoader; recargas muestran spinner CTQ y bloquean
navegacion/cancelacion mientras llegan datos. AbortController y secuencia de
peticion descartan respuestas obsoletas o de componentes desmontados. Los 401
se delegan al limite global de sesion existente.

## Validacion y Evidencias

- 13 unitarias backend nuevas: JWT, identidad, DTO, limites, skip/limit, orden,
  proyeccion, conteos globales, pagina ajustada y cuentas no elegibles.
- Regresion backend: 759 aprobadas, 211 integraciones antiguas omitidas, no
  certificadas por esta corrida.
- Arnes HTTP `test/reservation-history.e2e.ts`: 19 controles con Nest/JWT/MongoDB
  reales, 61 reservas propias y una ajena ficticias. Incluye todos los partners,
  paginas sin duplicados, tamanos, conteos, rechazo de identidad ajena, historial
  vacio, proyeccion y snapshot inalterado. Sin SMTP ni proveedor de pagos.
- Frontend: 388 pruebas aprobadas, incluidas las anteriores de detalle,
  confirmacion, doble click, errores y cancelacion; tres nuevas para paginacion.
- Navegador con API ficticia: 191 controles, 30 vistas, Chromium/WebKit,
  320/390/700/820/1440px. Incluye Usuarios/Reservas como regresion del componente
  compartido, historial de 61 registros, totales globales y cambio 25/100.
- TypeScript en ambos proyectos, ESLint frontend y de archivos nuevos backend,
  y build frontend aprobados. Fuentes remotas sustituidas en navegador.

Evidencia API y hashes: `docs/evidence/reservation-history/`; capturas/reporte de
navegador en la carpeta equivalente del frontend. La API aislada y el navegador
se validan por separado: no se presenta la API ficticia como prueba conectada
de frontend/backend. No certifica iPhone/iPad fisicos ni datos de produccion.

```bash
node node_modules/jest/bin/jest.js --runInBand court-reserve.history.spec.ts
node -r ts-node/register test/reservation-history.e2e.ts mongodb://127.0.0.1:29479/ctq_history_test_pagination /private/tmp/ctq-history-validation/api
```

El arnes solo acepta loopback y base ctq_history_test_*, no carga .env/AppModule,
elimina la base al terminar y MongoDB temporal se apaga despues de verificar.

## Compatibilidad

Backend debe actualizarse antes del frontend: este necesita my-history y su
respuesta paginada. No hay fallback al listado completo anterior. Las variables
existentes de API/JWT se reutilizan; no se agrega ninguna configuracion nueva.

## Validacion del Commit

Se verifico una copia temporal del indice Git sin modificaciones ajenas de
formato, auditoria, lockfile o configuracion. Esa copia mantiene 759 pruebas
backend aprobadas y 211 integraciones omitidas, con TypeScript aprobado.
El frontend seleccionado tiene 377 pruebas aprobadas: las otras pruebas de
mejoras locales no forman parte de este recorte. Reporte y hashes del codigo
seleccionado: `docs/evidence/reservation-history/commit-validation.json`.
