# Generacion revisada de cuotas: etapa 1

Fecha: 2026-10-29, America/Santiago.
Estado: backend implementado y validado localmente. Sin commit, push o despliegue.
Plan de referencia: `tennis-court-front/docs/plan-creacion-cuotas-mensuales.md`.
La etapa 2 de React y la validacion fisica de iPhone siguen pendientes.

## Alcance ejecutado

- Alta inicial con rango explicito inclusivo. Con reloj en octubre, octubre a
  enero crea cuatro cuotas, con precios calculados por backend.
- Motivo normal opcional: backend registra `Habilitacion inicial de mensualidades`
  cuando no se envia texto o viene vacio. Se conservan motivos validos de
  clientes anteriores, pero no se acepta null, texto corto no vacio u objetos.
- Reinscripcion separada en DTOs: exige motivo y no acepta throughPeriod.
  Anulacion y aprobacion excepcional de historial mantienen sus contratos.
- Preview de cuotas posteriores sin escrituras y confirmacion con huella,
  clave de idempotencia, transaccion y auditoria.
- Alta familiar/masiva conserva seleccion explicita, razon automatica normal,
  rango revisado y proteccion de socios ya habilitados.
- Reutiliza modelos, indices y motor de generacion; sin colecciones, tarifas,
  variables, migraciones, cambios de cron o configuracion productiva nuevos.

La etapa no registra dinero ni simula pagos como parte de una generacion.
Las pruebas de regresion de pagos usan exclusivamente fixtures y transportes
simulados. No se habilitaron, cobraron ni modificaron socios reales.

## Contratos

Todos los endpoints de este informe tienen prefijo `/membership-billing/admin`,
JWT, guard admin/funcionalidad y comprobacion de administrador activo en BD.

### Alta inicial

`POST /members/:id/enrollment/preview`:

```json
{ "startPeriod": "2026-10", "throughPeriod": "2027-01" }
```

Devuelve rows, newRows, existingRows, newCount, existingCount, total y
approvalHash. El alta inicial rechaza registros financieros previos, por lo
que existingRows esta vacio; estos casos van al flujo posterior o revision,
sin reemplazar un inicio aprobado.

`POST /members/:id/enrollment`, con `Idempotency-Key` valido:

```json
{
  "startPeriod": "2026-10",
  "throughPeriod": "2027-01",
  "approvalHash": "<huella de 64 caracteres hexadecimales>"
}
```

Reason es opcional solo en el alta normal. El backend establece inicio,
baseline, vigencia, cuotas y auditoria en una sola transaccion. Devuelve
memberId, startPeriod, throughPeriod, createdDues, total y duplicate.
Mantiene los limites anteriores del mes inicial y agrega limite superior
de mes actual mas tres para el mes final. El fin nunca puede ser anterior al inicio.

### Cuotas de un socio ya habilitado

`POST /members/:id/dues/preview`, nuevo endpoint de solo lectura:

```json
{ "throughPeriod": "2027-01" }
```

Devuelve inicio registrado, rango final, mes actual, newRows, existingRows,
excludedPeriods, newCount, existingCount, total de las cuotas nuevas y
approvalHash. No altera miembros, cuotas, pagos, auditoria ni indices.
ExistingRows informa importes/estados persistidos, no un precio recalculado.

`POST /members/:id/dues`, protocolo revisado con `Idempotency-Key`:

```json
{ "throughPeriod": "2027-01", "approvalHash": "<huella revisada>" }
```

Solo afecta al beneficiario de la URL. No prepara sus cargas implicitamente:
para cada beneficiario debe existir una seleccion/revision explicita.
Devuelve memberId, startPeriod, throughPeriod, createdDues, existingDues,
total y duplicate. Si no faltan meses, createdDues y total son cero; se audita
la confirmacion sin mutar miembros o cuotas existentes.

El total corresponde solo a lo nuevo. Ejemplo: cuatro meses seleccionados,
uno pagado existente y tres nuevos: existingDues=1, createdDues=3; la cuota
pagada no se modifica ni se incluye de nuevo en ese total.

### Compatibilidad temporal

- Alta sin throughPeriod mantiene su fin por defecto en el mes actual. La
  huella legacy sigue siendo la misma para ese rango y estado sin cambios.
- Alta con reason valido anterior sigue admitida; las nuevas solicitudes
  normales no necesitan que React invente una razon oculta.
- POST /dues **sin approvalHash** mantiene la operacion legacy y su respuesta
  de contexto familiar, porque el frontend actual aun la usa al abrir el pago.
- POST /dues **con approvalHash** valida huella/rango y exige Idempotency-Key.
  Un hash vacio/null o sin rango no se convierte en generacion revisada valida.
- La ruta legacy conserva permisos y limites existentes; no se afirma que
  ya haya desaparecido su preparacion implicita. La etapa 2 debe usar GET
  para abrir el pago y el contrato revisado para generar. Su eventual retiro
  requiere comprobar clientes desplegados, no un flag de entorno.

La pantalla publicada y el React local siguen pidiendo motivo y aun no envian
el nuevo rango hasta completar etapa 2. Implementar backend no publica ni
modifica por si solo esa interfaz.

## Integridad e idempotencia

La huella de generacion posterior incluye rango, mes local actual, miembro,
version, tipo/titular, vigencias, configuracion de precios y estado financiero
de cuotas existentes. Se recalcula dentro de transaccion. Si cambia precio,
vigencia, estado, version o cuotas entre revision y confirmacion, se devuelve
409 y no se genera un rango parcial.

Se conserva el indice unico beneficiario/mes y la serializacion existente de
`prepareDuesInSession`. Una clave repetida con mismo contenido devuelve el
resultado auditado; contenido distinto con esa clave devuelve 409. El rango
concreto se guarda: un reintento exitoso tras el cambio de mes no se extiende.
Una revision aun no aplicada de generacion posterior se invalida al cambiar el mes.

Los meses fuera de vigencia quedan excluidos. No se reabre un VOID mediante
esta nueva operacion: si pertenece a un mes facturable se exige revision de
vigencia, conservando el tratamiento excepcional de reinscripcion existente.
PAID/ARCHIVED e importes previos se conservan. Cuentas inactivas no generan.

La auditoria usa `MEMBERSHIP_DUES_GENERATION` para la confirmacion posterior,
con admin, fecha, rango, cuotas nuevas/existentes y resultado. La habilitacion
normal mantiene `MEMBERSHIP_ENROLLMENT` con razon de sistema cuando falta
texto libre. No se crean filas de payment ni se dispara un correo de ingreso.
Si falla auditoria, la transaccion revierte cuotas y cambios de version.

## Archivos modificados

- `billing-admin.controller.ts`: DTOs separados y ruta de revision posterior.
- `billing-admin.service.ts`: preview/aplicacion posterior y alta con rango.
- `billing-generation.policy.ts`: plan puro y huella de generacion posterior.
- `billing-enrollment.policy.ts`: rango inclusivo y razon inicial automatica.
- `billing-enrollment.service.ts`: propagacion de rango y razon en lotes.
- DTOs de alta, lotes y administracion: validacion estricta/compatibilidad.
- `billing-generation.policy.spec.ts`, integraciones admin/lifecycle: pruebas.

No se modifico MembershipBillingService, el scheduler, esquemas, MP, correo o
variables de entorno. Se preservan ajustes locales previos en .prettierrc,
audit-log.entity.ts y court-reserve.service.ts; no forman parte de esta etapa.

## Pruebas y evidencia

Resultado final: **883 pruebas aprobadas en 56 suites, 0 fallos, 0 omitidas**.
Baseline anterior: 845; se agregaron 38 casos, contando parametrizaciones.
Incluye unitarias, HTTP con Nest/Passport/JWT reales e integraciones MongoDB
8 con replica set `ctqDuesStage1`, solo localhost:27289 y bases fixture.

Evidencia filtrada: [validation.json](evidence/dues-generation-stage1/validation.json),
con versiones, resultados por caso de las suites relacionadas, SHA-256 del
informe completo y hashes del codigo. No contiene tokens ni credenciales.

Casos ejecutados: rango de uno/cuatro meses, titular/carga, alta sin motivo,
motivo excepcional obligatorio, limites +3/+4, rango invertido, campos
forjados/null, administrador inactivo/no admin, GET/preview sin escrituras,
pagados e historico conservados, meses no vigentes, doble clic/clave repetida,
claves distintas concurrentes, carrera con motor mensual, cambio de precio,
baja de cuenta, fallo de auditoria, cambio de mes y lote familiar con rango.

Tipos: `npx tsc --noEmit --incremental false`, aprobado. Lint de los once
archivos de esta etapa aprobado con override explicito printWidth=100, para
conservar el formato del codigo y no reformatear integraciones completas.
La configuracion local del usuario se preserva; esto no certifica lint global
del repositorio. `git diff --check` aprobado.

Comando de regresion final, Node 22.22.2 / npm 10.9.7:

```bash
env \
  BILLING_TEST_MONGO_URI='mongodb://127.0.0.1:27289/ctq_billing_test_dues_stage1_final?replicaSet=ctqDuesStage1&directConnection=true' \
  RESULTS_TEST_MONGO_URI='mongodb://127.0.0.1:27289/ctq_results_test_dues_stage1_final?replicaSet=ctqDuesStage1&directConnection=true' \
  CATEGORY_TEST_MONGO_URI='mongodb://127.0.0.1:27289/ctq_category_test_dues_stage1_final?replicaSet=ctqDuesStage1&directConnection=true' \
  npm test -- --runInBand --silent --json --outputFile=/tmp/ctq-dues-stage1-final.json
```

Las integraciones validan URI localhost/prefijos de prueba y eliminan sus
bases al terminar. No se inicia AppModule, no se conecta la BD de Heroku ni
se ejecutan cobros o entregas SMTP reales. Los logs de fallos simulados del
runner no son incidentes del club. Usuarios test 1/2 son fixtures locales con
tarifas 180/50; no se tocan los pilotos reales.

Limpieza: se retiro el contenedor propio `ctq-dues-stage1-20261029` con
almacenamiento temporal en RAM, se verificaron cero contenedores activos y
se detuvo Docker Desktop. No se eliminaron volumenes ni contenedores ajenos.

## Pendientes

- Etapa 2: enviar rango real desde React, quitar motivo normal y separar
  generar cuotas de abrir el pago usando los contratos revisados.
- Etapa 3: E2E de interfaz completa, pruebas fisicas iPhone/iPad y evidencia
  publicada previa autorizacion. Esta etapa 1 no certifica el widget nativo
  de mes ni corrige visualmente las capturas del usuario.
- Commit, push y despliegue no realizados; requieren solicitud separada.
