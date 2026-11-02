# Operacion de pago de mensualidades CTQ

Fecha de revision: 2026-10-31. Zona de negocio: `America/Santiago`.

Actualizacion local posterior: [etapa 1 de controles y permiso de reserva](membership-reservation-access-stage-1.md).
Reemplaza el modo de acceso limitado solo a pagos y separa generacion de baja.
Actualizacion de etapa 2: [emision explicita, recuperacion y corte del dia 6](membership-generation-stage-2.md).
El snapshot de commits de la seccion 11 corresponde a la revision anterior;
la evidencia de etapa 1 registra los nuevos archivos modificados.

Este documento describe la operacion funcional y tecnica del **codigo local**,
no certifica el estado desplegado ni la configuracion actual de Heroku o la base
del club. No habilita socios, automatizaciones, bloqueos ni pagos por si mismo.
Ante diferencias con documentos de etapas anteriores, las referencias al codigo
de esta revision explican el comportamiento aqui descrito.

## 1. Resumen funcional

La mensualidad pertenece a un socio y a un mes. El dinero recibido se registra
por separado y se distribuye entre las cuotas que cancela.

| Operacion | Que hace | Que NO hace |
| --- | --- | --- |
| Habilitar mensualidades | Aprueba desde que mes se cobra al socio, su vigencia y las cuotas del rango confirmado | No recibe dinero ni marca cuotas pagadas |
| Generar cuotas | Crea los meses faltantes de una membresia ya habilitada | No registra un ingreso ni duplica meses existentes |
| Registrar un pago | Guarda el ingreso, sus beneficiarios y las cuotas completas canceladas | No habilita una cuenta inactiva ni crea una nueva membresia |
| Consultar historial | Muestra operaciones, medios, importes, meses y estados | No constituye por si mismo una nueva operacion de cobro |
| Anular un pago manual | Conserva el registro original, documenta el motivo y revierte sus imputaciones | No devuelve dinero ni anula operaciones en Mercado Pago |

Una cuota es la obligacion mensual; un pago es el registro del ingreso. El sistema
no integra emision tributaria SII en este flujo: no confundir crear una cuota con
emitir una boleta tributaria.

## 2. Personas, tarifas y reglas

- **Beneficiario:** socio cuya mensualidad se cancela.
- **Pagador:** persona que entrega el dinero; puede pagar por varios beneficiarios.
- **Administrador receptor:** usuario autenticado que registra un pago manual.
- **Titular:** puede gestionar sus cuotas y las de sus cargas asociadas.
- **Carga:** conserva sus cuotas e historial propios. No obtiene acceso a pagos
  ajenos por pertenecer al grupo familiar.

| Concepto | Valor o regla vigente en codigo |
| --- | --- |
| Moneda | CLP, importes enteros positivos |
| Tarifa general propuesta | Titular $18.000; carga $5.000 |
| Tarifa piloto | Titular $180; carga $50, solo para IDs autorizados en configuracion |
| Abonos | No hay pagos parciales de una cuota |
| Orden | Primero los meses impagos mas antiguos de cada beneficiario |
| Socio | Atrasados y mes actual; sin meses futuros en el portal |
| Administracion | Atrasados, actual y hasta tres meses adicionales futuros |
| Inicio del sistema propuesto | Octubre de 2026; no se inventa deuda anterior |
| Plazo | Hasta el dia 5 del mes siguiente inclusive |
| Vencimiento tecnico | Dia 6 a las 00:00 en `America/Santiago` |

Los precios efectivos salen de `membership_billing_config`, no del navegador ni
del nombre del socio. La propuesta $18.000/$5.000 puede tener versiones por mes;
la cuota emitida guarda importe, tipo, version y modo de tarifa.
`pricingMode: TEST` **no significa sandbox**: con una cuenta real puede existir
un cobro real de $180/$50. Nunca ejecutar una prueba de pago sin autorizacion.
No se pueden mezclar cuotas `TEST` y `STANDARD` en un mismo pago.

Ejemplo general: un titular paga su octubre y el de una carga. Se registra un
solo ingreso de **$23.000**, distribuido en $18.000 para el titular y $5.000 para
la carga. Son dos cuotas pagadas y un pago, no dos ingresos de $23.000.

## 3. Habilitacion y generacion de meses

### 3.1 Primera habilitacion

1. Entrar como administrador activo a **Administrar usuarios -> Pagos del socio**
   o a **Mensualidades CTQ** (`/adminpayments`) y buscar al socio.
2. Si aun no tiene inicio aprobado, abrir **Habilitar mensualidades**.
3. Revisar el mes inicial y el mes final del rango. El backend devuelve los
   meses, importes y total que realmente se crearan.
4. Confirmar la vista previa mediante SweetAlert2. Si cambian socio, tarifa,
   vigencia o meses, se debe revisar de nuevo.
5. El backend guarda inicio, periodo de vigencia, cuotas abiertas y auditoria.
   Aun no hay dinero recibido: despues corresponde registrar el pago.

**El motivo libre no es obligatorio en la habilitacion inicial actual.** Si no
se ingresa, el backend registra `Habilitacion inicial de mensualidades` como
motivo de auditoria. Si se proporciona texto, se valida. Reinscripcion y
anulacion tienen sus propios motivos obligatorios.

Una carga necesita un titular valido. Una cuenta activa no equivale a una
membresia facturable. Un socio con registros financieros previos y una vigencia
incompleta requiere revision; no se debe habilitar de nuevo sobre sus pagos.

### 3.2 Generacion posterior

Para una membresia ya habilitada, administracion puede revisar y confirmar la
generacion de cuotas hasta un mes final permitido. La vista previa diferencia
**nuevas, existentes y periodos excluidos**. Solo se crean las faltantes.
Elegir varios meses no implica cobrar varios si parte del rango ya existe.

El portal y la cotizacion no emiten cuotas. La siguiente tabla distingue
consultas de acciones administrativas explicitas de generacion:

| Accion o endpoint | Efecto sobre cuotas |
| --- | --- |
| Listado administrativo `GET /admin/members` | Solo consulta; un importe estimado no demuestra que la cuota exista |
| Detalle `GET /admin/members/:id` | Solo consulta, sin generar cuotas |
| Vista previa `POST /admin/members/:id/dues/preview` | Calcula plan y hash, sin crear cuotas |
| Confirmacion `POST /admin/members/:id/dues` con `approvalHash` | Genera el plan aprobado con idempotencia |
| Compatibilidad `POST /admin/members/:id/dues` sin `approvalHash` | Puede preparar cuotas del socio y su familia habilitada |
| Portal `POST /me/dues` | Solo consulta cuotas emitidas, sin generar meses aunque falten |
| Cotizacion de pago | No genera cuotas; rechaza saltar un mes anterior exigible no emitido y permite pagar la mas antigua sola o varias completas |
| Evaluacion de acceso | Solo lectura; deuda no emitida que ya debio vencer exige revision, sin crear cuotas |

Los paths de esta tabla llevan el prefijo `/membership-billing`.
La preparacion bajo demanda **no registra un pago**.

### 3.3 Habilitacion familiar o masiva

Se puede habilitar un titular y cargas seleccionadas, o un conjunto de socios.
La revision distingue elegibles, ya habilitados y casos por revisar. Una
habilitacion manual anterior se conserva: el masivo no borra ni reemplaza inicio,
cuotas o pagos, incluso si la habilitacion ocurrio despues de la vista previa.
Ver [operacion manual y masiva](membership-billing-manual-batch.md).

## 4. Pago del socio por Mercado Pago

1. El socio activo abre **Mis mensualidades** (`/monthlypayments`). Una restriccion
   financiera permite entrar y usar el sitio, pero no crear nuevas reservas;
   la inactividad administrativa no se levanta por acceder a esta pantalla.
2. Selecciona cuotas abiertas, completas y ordenadas. Un titular puede incluir
   cargas autorizadas; el total se muestra antes de continuar.
3. Confirma con SweetAlert2. React envia los IDs de cuotas, no un importe decidido
   por el cliente. El servidor recalcula el total y verifica permisos.
4. El backend guarda un intento `PENDING`, con referencia e idempotencia, antes
   de solicitar el enlace al microservicio de Mercado Pago.
5. El socio completa o abandona el checkout externo.
6. Mercado Pago notifica al microservicio. Este verifica la operacion y comunica
   su ID al backend; el backend vuelve a obtener evidencia autenticada.
7. Solo una aprobacion verificada y consistente permite guardar `CONFIRMED`,
   cuotas `PAID`, imputaciones y auditoria en una transaccion.
8. El retorno a `/monthlypayments/return?reference=...` consulta el resultado
   registrado y puede solicitar conciliacion. Los parametros `status` o
   `payment_id` del navegador no acreditan el pago.
9. El socio ve el estado y luego puede consultar el historial. **No se envia
   correo de mensualidad** en la version revisada.

Si el socio cierra el navegador, la confirmacion no depende de que regrese a la
tienda: el webhook y su procesamiento persistente tienen su propio recorrido.
La pantalla de retorno consulta un pendiente hasta aproximadamente un minuto
con esperas de cinco segundos; existe accion para volver a consultar.

**Ante cobro o respuesta incierta, consultar el mismo intento antes de pagar otra
vez.** Un timeout no prueba que Mercado Pago no haya creado o cobrado la operacion.

## 5. Pago manual: transferencia, deposito o efectivo

El socio entrega el dinero fuera del checkout. Administracion verifica el ingreso
y lo registra desde el detalle del socio o la vista global.

1. Revisar identidad, cuotas, beneficiarios y meses. Generar cuotas si corresponde.
2. Abrir **Registrar pago** y seleccionar cuotas completas desde la mas antigua.
3. Identificar el pagador. Puede ser socio existente o persona externa, sin
   inventarle una cuenta.
4. Elegir el medio real: transferencia, deposito o efectivo.
5. Informar la fecha efectiva de recepcion, nunca una fecha futura. Para banco,
   informar referencia de la operacion; observacion es opcional.
6. Marcar que el ingreso completo fue verificado y confirmar. El total recibido
   debe coincidir exactamente con la suma calculada por el backend.
7. Verificar que aparezca en historial con cuotas pagadas y administrador receptor.

| Medio | Codigo | Evidencia propia |
| --- | --- | --- |
| Transferencia electronica | `BANK_TRANSFER` | Referencia bancaria y fecha efectiva |
| Deposito bancario | `BANK_DEPOSIT` | Referencia del deposito y fecha efectiva |
| Efectivo | `CASH` | Folio `CTQ-...` generado por backend, fecha y administrador receptor |
| Pago en linea | `MERCADO_PAGO` | ID y evidencia del proveedor; no se registra como pago manual |

No hay adjuntos de comprobantes bancarios en este alcance. Efectivo no utiliza
una referencia bancaria ficticia. El servidor rechaza un importe menor o mayor
que el total; no guarda la diferencia como saldo a favor ni abono.

Si coincide referencia bancaria, fecha e importe con otro ingreso confirmado,
se exige revisar si es un ingreso realmente distinto. Esa excepcion auditada
no reemplaza la idempotencia ni permite pagar dos veces las mismas cuotas.

### Corregir un pago manual

No se sobrescribe el pago confirmado. Administracion lo anula con motivo; el
backend guarda responsable y fecha, mantiene el original como `REVERSED` y
revierte solo sus imputaciones. Si corresponde, se registra otro pago correcto.
Una cuota de una vigencia antigua ya no exigible permanece como historico, no
vuelve a convertirse en deuda exigible por la anulacion.

Mercado Pago no se corrige mediante esta ruta. Un reembolso, contracargo, doble
cobro o evidencia inconsistente se conserva en `REVIEW_REQUIRED` para revision;
este flujo no ejecuta devoluciones automaticas.

## 6. Historial, deuda y estado del socio

El socio consulta **Mis mensualidades -> Historial de pagos**. El titular puede
elegir su beneficiario autorizado; una carga no recibe informacion financiera
de otros integrantes. Administracion consulta historial global o del socio,
con filtros de mes, medio y estado. La paginacion administrativa es de 20 filas.

Se guarda referencia CTQ, pagador, beneficiarios, meses, importes, medio, fechas y
estado. Banco incorpora referencia, efectivo incorpora folio, y Mercado Pago
incorpora evidencia del proveedor. La vista administrativa incorpora responsable
y observaciones. La cuota conserva el pago que la cancelo.

### Estados diferentes, no intercambiables

| Cuota | Significado |
| --- | --- |
| `OPEN` | Emitida e impaga; puede estar al dia o vencida segun `dueAt` |
| `PAID` | Cancelada por un pago identificado y fecha efectiva |
| `VOID` | Sin cobro por baja, con evidencia del corte; no equivale a pagada |
| `ARCHIVED` | Historico no exigible tras reinscripcion aprobada; no bloquea reservas |

| Pago | Significado |
| --- | --- |
| `PENDING` | Intento sin confirmacion suficiente; no cancela deuda |
| `CONFIRMED` | Ingreso confirmado y cuotas imputadas |
| `REJECTED` | Rechazo del proveedor; revisar posibilidad de continuar el intento |
| `CANCELLED` | Intento cerrado sin confirmacion de ingreso |
| `REVIEW_REQUIRED` | Evidencia que exige revision, no una invitacion a repetir el pago |
| `REVERSED` | Registro manual anulado, conservado para auditoria |

El checkout tiene otra dimension: `CREATING`, `READY`, `UNKNOWN` o `FAILED`.
`UNKNOWN` refleja incertidumbre al crear el enlace; no invalida por si solo un
pago que despues quedo confirmado con evidencia verificada.

### Vencimiento, baja y reinscripcion

- Octubre de 2026 es pagable hasta el 5 de noviembre inclusive; vence el dia 6.
- El bloqueo financiero automatico depende de `autoBlockEnabled` y no da de baja
  la cuenta. Un socio restringido sigue generando cuotas mientras este vigente.
- La automatizacion de vigencias tiene una habilitacion distinta. Tres cuotas
  vencidas consecutivas de la vigencia actual producen baja efectiva el dia 6.
- Ejemplo: octubre, noviembre y diciembre impagos llevan a baja el **6 de enero
  de 2027**. Se conservan esos tres meses; enero no se cobra en ese corte.
- Inactivos no generan nuevas cuotas. Pagos inciertos, anticipos o inconsistencias
  pueden retener el corte para revision en vez de ejecutar una baja insegura.
- La reinscripcion debe aprobarla administracion para el mes actual. Conserva
  pagos e identidad; la deuda anterior queda historica no exigible, sin cobrar
  meses de inactividad ni bloquear reservas por ese historico.
- Administradores activos estan exentos del bloqueo financiero; pagar no activa
  automaticamente una cuenta inactiva ni elimina otros bloqueos administrativos.

## 7. Arquitectura y responsabilidad tecnica

```text
React: Mis mensualidades / Admin mensualidades
    | JWT + IDs de cuotas + Idempotency-Key cuando corresponde
    v
Backend NestJS: membership-billing
    | permisos, tarifas, periodos, transacciones y auditoria
    +---- MongoDB: socios, cuotas, pagos y configuracion
    |
    +---- Microservicio Mercado Pago ---- API Mercado Pago
                  ^                           |
                  +------ webhook firmado ----+
                  |
                  +------ callback interno autenticado al backend
```

| Componente | Responsabilidad |
| --- | --- |
| `MembershipPayments.tsx` | Seleccion, confirmacion, checkout e historial del socio |
| `MembershipPaymentReturn.tsx` | Consultar resultado y conciliacion; no aprobar por URL |
| `AdminMembershipPayments.tsx` y `AdminMembershipMember.tsx` | Administracion global y por socio |
| `MembershipBillingService` | Preparacion, cotizacion, acceso e historial con permisos |
| `BillingAdminService` | Generacion aprobada, pagos manuales, anulacion y auditoria |
| `BillingEnrollmentService` | Habilitacion familiar/masiva y revision de vigencia anterior |
| `MembershipMpService` | Intentos, conciliacion y confirmacion verificada del proveedor |
| `BillingLifecycleService` | Generacion y baja recuperables, bajo habilitacion explicita |
| Microservicio Mercado Pago | Preferencias, cuenta receptora, evidencia, webhook e inbox |

### Persistencia

| Coleccion | Datos y relacion |
| --- | --- |
| `register` | Identidad, estado activo, tipo, `titularId`, inicio y periodos de vigencia |
| `membership_billing_config` | Documento `MONTHLY_MEMBERSHIP`, versiones de tarifas, piloto y automatizacion |
| `membership_dues` | Una cuota por `beneficiaryId + period`; importe y version emitidos, vencimiento, estado y `settlementPaymentId` |
| `membership_payments` | Ingreso/intento, `publicReference`, pagador, medio, estado e `allocations[]` |
| `audit_logs` | Evidencia financiera y administrativa con eventos deduplicados |
| `mp_webhook_inbox` y `mp_webhook_effects`, en microservicio | Recepcion durable y deduplicacion de procesamiento/callbacks de Mercado Pago |

Cada `allocation` vincula `dueId`, `beneficiaryId`, `period` y `amount`.
No se registra un pago global en un booleano del socio. `updatePayment` es un
indicador legado de acceso y no reemplaza cuotas, recibos ni evidencia bancaria.

### Atomicidad e idempotencia

MongoDB debe soportar transacciones mediante replica set. En un pago manual se
revalidan administrador y seleccion, se compara el importe, se crea el pago,
se marcan todas sus cuotas y se guarda auditoria dentro de una transaccion.
En una confirmacion MP se verifican evidencia y disponibilidad de cuotas antes
de imputarlas. Un fallo de auditoria o cambio concurrente impide un registro parcial.

Indices unicos relevantes: socio/mes, `publicReference`, actor/clave de idempotencia,
proveedor/ID de pago y evento de auditoria. Las operaciones financieras comprueban
indices requeridos; la falta de preparacion no se resuelve creando cobros a ciegas.
Se serializan cambios de socio, tarifas y generacion mediante versiones y transacciones.

`Idempotency-Key` identifica un reintento de la misma operacion. Misma clave y
mismo contenido devuelven el registro anterior; misma clave con otro contenido
genera conflicto. React conserva identidad de checkout durante reintentos y
sesion de pestaña; el servidor conserva la evidencia durable. Un hash de vista
previa no reemplaza la clave: detecta cambios entre revision y confirmacion.

## 8. API principal

Base relativa al backend: `/membership-billing`. Las rutas de socio llevan JWT;
las administrativas tambien requieren rol admin, cuenta activa y guard del modulo.
Los cuerpos usan validacion y rechazan campos ajenos al contrato.

| Metodo y ruta | Uso |
| --- | --- |
| `GET /me/access` | Permisos financieros y disponibilidad MP |
| `POST /me/dues` | Contexto y preparacion de cuotas propias/familia autorizada |
| `GET /me/payments?beneficiaryId=...&page=1` | Historial autorizado |
| `POST /checkout` | Crear o recuperar intento MP, con `dueIds` e idempotencia |
| `GET /payments/:reference` | Estado local autorizado de un intento |
| `POST /payments/:reference/reconcile` | Solicitar verificacion contra proveedor |
| `GET /admin/members?search=...&period=YYYY-MM&page=1` | Listado rapido y estado del mes |
| `GET /admin/members/:id` | Detalle administrativo y familia |
| `POST /admin/members/:id/enrollment/preview` y `/enrollment` | Vista previa y aprobacion inicial |
| `POST /admin/members/:id/dues/preview` y `/dues` | Vista previa y generacion aprobada; compatibilidad sin hash descrita antes |
| `POST /admin/quote` | Cotizar cuotas seleccionadas |
| `POST /admin/payments` | Transferencia, deposito o efectivo con idempotencia |
| `GET /admin/payments` | Historial con filtros |
| `POST /admin/payments/:id/reversal` | Anulacion manual con motivo e idempotencia |
| `POST /admin/enrollment/preview` y `/admin/enrollment` | Habilitacion por lote |
| `GET /admin/members/:id/billing-history/preview` y `POST /admin/members/:id/billing-history` | Revision/aprobacion de historial previo |
| `POST /admin/members/:id/reenrollment/preview` y `/reenrollment` | Reinscripcion aprobada |
| `GET /admin/automation/preview` | Revision de automatizacion; no habilita por si sola |
| `GET /admin/automation/settings` | Lee dos controles globales, revision y estado de aprobacion; sin recorrer socios |
| `POST /admin/automation/settings` | Cambia un control con revision optimista y auditoria administrativa transaccional |
| `POST /internal/mercado-pago` | Callback interno con `paymentId`; requiere `x-api-key`, no JWT del socio |

Ejemplo ilustrativo de pago manual: sustituir IDs por cuotas realmente revisadas;
no ejecutar contra produccion como prueba.

```http
POST /membership-billing/admin/payments
Authorization: Bearer <JWT_ADMIN>
Idempotency-Key: ejemplo-operacion-unica-20261031
Content-Type: application/json

{
  "dueIds": ["<ID_CUOTA_TITULAR>", "<ID_CUOTA_CARGA>"],
  "method": "BANK_TRANSFER",
  "amount": 23000,
  "payerName": "Titular de ejemplo",
  "receivedDate": "2026-10-31",
  "reference": "REFERENCIA-BANCARIA-VERIFICADA",
  "verified": true
}
```

Para efectivo se usa `method: CASH` y se omite `reference`. Para checkout MP el
cuerpo contiene solo `dueIds`; no se envia un monto arbitrario.

## 9. Verificacion de Mercado Pago y casos inciertos

El microservicio reutiliza su token y consulta la cuenta receptora al proveedor.
La preferencia identifica `purpose: MEMBERSHIP`, referencia externa y modo de
tarifa. Sus tres retornos usan `/monthlypayments/return`, con el dominio tomado
de `MP_SUCCESS_URL`; esto es distinto de los retornos de reservas/luz/visitas.

El webhook valida firma y persiste el evento. El callback interno lleva solo el
ID; `MembershipMpService.receive()` solicita evidencia al microservicio y compara:
referencia, proposito, cuenta receptora, preferencia, moneda, importe, modo real
o sandbox, modo de tarifa, fecha aprobada y cuotas abiertas sin cambios.
Una notificacion repetida se deduplica; un evento tardio pendiente/rechazado no
degrada un pago ya confirmado. Doble cobro, devolucion o discrepancia retienen
evidencia y exigen revision, sin volver a cancelar las mismas cuotas.

El enlace se prepara con vencimiento de 30 minutos. Eso no autoriza a cancelar
un intento solo por reloj: el cierre de un pendiente sin evidencia requiere
busqueda completa del proveedor y un margen adicional de seguridad. Si la
consulta falla, la incertidumbre se conserva. La conciliacion del mismo intento
tiene control de frecuencia; no genera otra preferencia por haber un timeout.

El inbox y el callback MP **siguen funcionando**: son necesarios para confirmar
dinero. No son el worker de correos que se elimino.

## 10. Automatizacion, configuracion y mantenimiento

### Tareas automaticas

`BillingLifecycleService.tick()` conserva su tarea horaria (`0 0 * * * *`, zona
chilena). Solo procesa cuando estan habilitados el modulo administrativo y
algun control de `membership_billing_config.automation` este activo, con revision/aprobacion valida.
Recupera meses/cortes, trata cada socio por separado y concilia operaciones
inciertas antes de decidir bajas. Es independiente de `autoBlockEnabled`.
`automation.enabled` controla generacion y `automation.terminationEnabled`
controla bajas, independientemente. Ausencia del segundo significa bajas desactivadas.

**No existe el anterior worker `BillingNotificationsService` ni su consulta cada
30 segundos.** No se crean ni reintentan correos mensuales. Los antiguos
`notifications[]` permanecen como evidencia; el detalle administrativo devuelve
`notificationStatus: null`. No se altera correo de acceso, verificacion o reservas.

### Configuracion existente, sin agregar variables

| Proyecto | Configuracion utilizada |
| --- | --- |
| Frontend | `VITE_API_URL`; rutas y permisos derivados del backend, sin flags de mensualidades en Vite |
| Backend | `MONGODB_URI`, JWT existente, `MEMBERSHIP_BILLING_ADMIN_ENABLED`, `MEMBERSHIP_PORTAL_ENABLED`, `MP_API_URL`, `INTERNAL_API_KEY` |
| Microservicio MP | `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`, `INTERNAL_API_KEY`, `BACKEND_URL`, `NOTIFICATION_URL`, `MP_SUCCESS_URL`; configuracion existente de su inbox |
| Base de datos | Tarifas, IDs piloto, inicio global, `autoBlockEnabled`, `activation` y `automation` |
| Correo | Ninguna configuracion adicional para mensualidades; configuracion compartida permanece para otros flujos |

Los tres controles son distintos: disponibilidad del modulo/portal, bloqueo
financiero y automatizacion de bajas. Habilitar uno no habilita los otros.
No se utiliza `MEMBERSHIP_MP_ENABLED`, `MEMBERSHIP_MP_COLLECTOR_ID`,
`MEMBERSHIP_MP_LIVE_MODE` ni URLs opcionales nuevas para mensualidades.

### Rutina recomendada

1. **Al incorporar un socio:** revisar tipo/titular, activar cuenta segun proceso
   del club, aprobar inicio y rango, comprobar cuotas abiertas. No marcarlo pagado
   solo por habilitarlo.
2. **Al recibir dinero manual:** verificar banco/efectivo, registrar medio y fecha
   reales, comprobar cuotas e historial; mantener evidencia externa del ingreso.
3. **Diariamente:** revisar pendientes, `UNKNOWN`, `REVIEW_REQUIRED`, duplicados
   y fallos de callback. Conciliar antes de abrir otro cobro o editar cuotas.
4. **Cada mes:** verificar generacion de activos habilitados y cantidades por
   tarifa. Desde el dia 6 revisar deuda y casos retenidos; aplicar automatizacion
   solo con aprobacion, respaldo y configuracion verificada.
5. **Cambios de tipo:** el ajuste automatico afecta solo cuotas `OPEN` actuales y
   futuras, no pagadas ni anteriores. Un checkout incierto obliga a revisar antes
   de cambiar un importe que aun podria cobrarse.
6. **Corregir datos financieros:** usar anulacion/reinscripcion y auditoria,
   nunca borrar pagos o editar MongoDB como mantenimiento habitual.

| Situacion | Conducta operativa |
| --- | --- |
| `401` | Sesion no autorizada; iniciar sesion. No interpretar como pago fallido |
| `403` | Revisar cuenta activa, rol y permiso sobre beneficiario |
| `409` | Revisar cambios concurrentes, orden, duplicidad, idempotencia o vigencia |
| `503` | Revisar configuracion, indices o disponibilidad; no inventar cuotas pagadas |
| Timeout o `CHECKOUT_UNKNOWN` | Conservar referencia y clave; conciliar antes de reintentar otro cobro |
| El banco muestra ingreso pero la app no confirma | Revisar proveedor/callback/historial; no crear un deposito para ocultar un pago MP |

## 11. Evidencias, fuentes y limites

Revision de codigo: backend `a380aaf`, frontend `a02509e`, microservicio MP
`234e4ed`. Son referencias locales, no versiones certificadas de produccion.
El [snapshot de fuentes](evidence/operacion-mensualidades/source-snapshot.json)
registra commits y hashes de los archivos consultados, sin secretos ni socios.

La [regresion previa del retiro de correos](evidence/billing-email-removal/validation.json)
registra **883 pruebas aprobadas, 56 suites, sin fallos ni omitidas**, incluidas
**182 integraciones** con MongoDB replica set aislado, HTTP/JWT y proveedores
simulados. Cubre pagos, cuotas, MP, anulaciones, vigencia, tarifas y regresiones.
No acredita entrega bancaria real, configuracion actual de Heroku ni Safari fisico.
Esta tarea documental no vuelve a ejecutar cobros ni modifica comportamiento.

Fuentes principales:

- [Reglas, permisos, tarifas y vencimiento](../src/membership-billing/billing.policy.ts).
- [Generacion, cotizacion e historial](../src/membership-billing/membership-billing.service.ts).
- [Habilitacion inicial y motivo por defecto](../src/membership-billing/billing-enrollment.policy.ts).
- [Plan de cuotas nuevas y existentes](../src/membership-billing/billing-generation.policy.ts).
- [API administrativa](../src/membership-billing/billing-admin.controller.ts).
- [Pagos manuales, anulacion y detalle](../src/membership-billing/billing-admin.service.ts).
- [Portal del socio y preparacion bajo demanda](../src/membership-billing/billing-portal.service.ts).
- [Confirmacion y conciliacion MP](../src/membership-billing/billing-mp.service.ts).
- [Vigencias y tarea horaria](../src/membership-billing/billing-lifecycle.service.ts).
- [Esquema de cuotas](../src/membership-billing/entities/membership-due.entity.ts).
- [Esquema de pagos e indices](../src/membership-billing/entities/membership-payment.entity.ts).
- [Retiro de correos, alcance y pruebas](billing-email-removal.md).
- [Frontend del socio](../../tennis-court-front/src/components/MembershipPayments.tsx).
- [Frontend administrativo](../../tennis-court-front/src/components/AdminMembershipPayments.tsx).
- [Retorno de pago](../../tennis-court-front/src/components/MembershipPaymentReturn.tsx).
- [Microservicio MP](../../mercadopago-microservice/src/mercadopago/mercadopago.service.ts).

No se relevaron saldos o variables de produccion para este documento. La URI del
backend local puede apuntar a la misma base del club: **local no significa base
aislada**. Toda prueba que escriba debe utilizar una base temporal explicitamente
aislada o una operacion real previamente autorizada. No publicar secretos,
comprobantes bancarios o datos personales junto con evidencias tecnicas.
