# Analisis: generacion mensual y bloqueo por deuda

Fecha: 2026-10-31. Zona: `America/Santiago`.
Estado: propuesta funcional y tecnica, pendiente de aprobacion para implementar.
Avance posterior: etapa 1 aprobada e implementada localmente; ver
[contratos, cambios y evidencia de etapa 1](membership-reservation-access-stage-1.md).
Ampliacion aprobada el 1 de noviembre: [controles globales en Administracion de mensualidades](membership-automation-controls.md).
Esta ampliacion supera el hallazgo historico de ausencia de API de configuracion;
la etapa 2 posterior separa consultas de emision y prueba recuperacion/bloqueo:
[implementacion local y evidencia](membership-generation-stage-2.md).
La etapa 3 y la activacion de produccion siguen pendientes.
Base revisada: backend local `a380aaf`. No se consulto ni modifico produccion.

## 1. Regla confirmada

El usuario confirmo mantener el cobro por mes vencido:

**El 6 de noviembre se exige octubre pagado, no noviembre.**

Precision posterior del usuario: desde el **primer mes vencido** se bloquean
**nuevas reservas**, no la cuenta ni la visualizacion del sitio. Puede entrar,
ver perfil, ranking, historial y mensualidades, y pagar. No se lo envia
forzosamente al portal de pagos. `statePlayer` permanece activo.

| Fecha | Generacion | Obligacion de pago |
| --- | --- | --- |
| 1 de octubre de 2026 | Se emite octubre para socios habilitados y vigentes | Octubre vence al terminar el 5 de noviembre |
| 1 de noviembre de 2026 | Se emite noviembre | Octubre sigue dentro del plazo hasta el dia 5 |
| 6 de noviembre de 2026 | No se vuelve a emitir octubre | Octubre impago restringe acceso; noviembre aun no esta vencido |
| 6 de diciembre de 2026 | Se revisa deuda vencida acumulada | Noviembre impago restringe acceso; tambien cuenta octubre si sigue abierto |

La cuota del mes en curso se puede pagar desde su emision, sin exigirla antes
del vencimiento del mes siguiente. Pagar noviembre no permite saltarse octubre.

Confirmacion adicional del usuario: si el 1 de noviembre siguen abiertas octubre
y noviembre, se permite elegir **solo octubre completo** o **octubre y noviembre
juntos**. No se obliga a pagar el mes actual para regularizar el anterior, ni se
permite pagar solo noviembre dejando octubre abierto. La generacion de noviembre
no fusiona ambas obligaciones en una cuota indivisible ni registra otro octubre.
El orden se valida por beneficiario, tambien en pagos de titular y cargas.

Ejemplo de un titular a tarifa general: octubre solo suma $18.000; octubre y
noviembre suman $36.000. Al pagar octubre quedan noviembre abierto y octubre
pagado. Si no existe otra deuda exigible ni bloqueo independiente, noviembre
abierto no restringe reservas hasta el 6 de diciembre. El 1 de noviembre octubre
es el mes anterior pendiente, pero aun no vencido: conserva plazo hasta el dia 5.

## 2. Tres operaciones distintas

1. **Habilitacion inicial del socio:** administracion aprueba inicio y vigencia
   una sola vez. No se debe aprobar nuevamente a todos los socios cada mes.
2. **Generacion mensual:** crea la cuota del mes para membresias ya habilitadas.
   Puede iniciarla administracion o una tarea automatica. No representa dinero.
3. **Confirmacion de pago:** Mercado Pago confirma el ingreso mediante evidencia
   verificada o administracion registra el ingreso bancario/efectivo real.

Propuesta: dejar manual la habilitacion inicial y automatizar la generacion
posterior. Un socio no habilitado no se incorpora silenciosamente a facturacion.

## 3. Controles propuestos

Interpreto la activacion/desactivacion solicitada como un control de la
**generacion automatica**, no como borrar meses ni suspender deudas ya emitidas.

| Control administrativo | Efecto al activarlo | Efecto al desactivarlo |
| --- | --- | --- |
| Generar cuotas automaticamente | Emite mes actual y recupera meses faltantes facturables | Requiere generacion manual; no borra cuotas ni pagos |
| Bloquear reservas por deuda vencida | Impide nuevas reservas desde el primer vencimiento | No aplica ese bloqueo automatico; conserva deuda e historial |
| Baja por tres meses vencidos | Aplica el cierre aprobado con sus revisiones de seguridad | No da de baja automaticamente; conserva deuda y posibles restricciones |

Los controles no deben implicarse entre si. La baja definitiva no debe activarse
accidentalmente al habilitar solo la emision mensual. Serian configuraciones en
base de datos con permisos y auditoria, **sin nuevas variables de entorno**.
Los nombres finales de campos/API se definen en la implementacion aprobada.

Desactivar generacion no significa dejar de cobrar cuotas existentes, marcar
pagos ni apagar Mercado Pago. Desactivar bloqueo automatico tampoco elimina
una inactividad administrativa o un bloqueo legado que requiere revision.

## 4. Flujo A: operacion automatica recomendada

### Preparacion unica

1. Revisar tarifas, tipos de socio, titulares/cargas y vigencias.
2. Habilitar membresias individualmente o por lote con vista previa.
3. Conservar inicios, cuotas y pagos ya aprobados; el masivo omite esos casos.
4. Revisar el resultado del proceso y los casos excluidos antes de activar la
   generacion general y el bloqueo. Aprobar la baja por separado.

### Dia 1: emitir el mes actual

1. A las 00:00 de Chile, procesar socios activos con inicio y vigencia aprobados.
2. Generar la cuota actual a precio de backend, segun tipo y version de tarifa.
3. Incluir socios restringidos por deuda: siguen vigentes y generando cuotas.
4. Excluir inactivos, dados de baja y periodos sin vigencia; no inventar altas.
5. Si el socio/mes ya existe, conservarlo. Una cuota pagada o emitida manualmente
   antes no se reemplaza ni duplica.
6. Dejar auditoria de meses creados y casos que requieran revision.

No depender exclusivamente de una ejecucion mensual. Reutilizar el proceso
recuperable al arrancar y cada hora: el dia 1 crea el mes; las otras ejecuciones
solo reparan faltantes, sin repetir cobros. Si el backend estuvo caido, recupera
periodos facturables al volver, respetando inicios, pausas y cierres.

### Regla confirmada: no repetir un mes emitido o pagado

El usuario confirmo que la generacion automatica no debe repetir un mes que ya
este habilitado/emitido para el socio ni uno que ya este pagado. En este contexto
**generar** significa crear una cuota, no cobrar una tarjeta, crear un checkout,
registrar un ingreso o programar un debito automatico.

La identidad del mes es **ID estable del beneficiario + periodo `YYYY-MM`**.
No depende del nombre, correo, titular que paga, medio de pago ni ejecucion.
Titular y carga tienen claves diferentes aunque compartan un mismo pago.

| Situacion del socio/mes al ejecutar | Decision de generacion ordinaria |
| --- | --- |
| No existe cuota y el socio esta habilitado, activo y vigente en ese periodo | Crear una sola cuota `OPEN` con tarifa y vencimiento calculados |
| Existe `OPEN`, emitida manual o automaticamente | Omitir; conservar ID, importe, version de tarifa, vencimiento y estado |
| Existe `PAID`, incluso un mes futuro pagado por administracion | Omitir; conservar pago, imputacion, fecha e importe, sin reabrirla |
| Existe `VOID` por baja | No duplicar ni reabrir como parte de la emision ordinaria; revisar vigencia si corresponde |
| Existe `ARCHIVED`, historico no exigible | Conservar; no volver a convertirlo en deuda |
| Hay pago confirmado pero falta o no coincide su cuota/imputacion | Revision de integridad; no inventar una cuota impaga ni registrar otro pago |
| Existen duplicados previos o faltan indices unicos requeridos | Detener la escritura afectada y revisar; no borrar ni elegir un registro arbitrariamente |
| Cuenta inactiva, inicio no aprobado o mes fuera de vigencia | No emitir un mes nuevo |

Una habilitacion inicial aprobada no se vuelve a aplicar cada mes. El proceso
recurrente usa esa vigencia para generar solo cuotas que realmente falten.
La generacion ordinaria tampoco reajusta cuotas ya existentes por un cambio de
tarifa: los ajustes de tipo titular/carga siguen su flujo especifico, auditado,
limitado a cuotas abiertas actuales/futuras y sin modificar cuotas pagadas.

La recuperacion excepcional de una cuota `VOID` por una reinscripcion aprobada
es una operacion diferente: exige evidencia administrativa y usa el registro
existente, no otra cuota para el mismo socio/mes. No autoriza a restaurar deuda
`ARCHIVED` ni a ignorar una baja durante un reintento del cron.

### Ejemplo de ejecucion del 1 de noviembre

| Caso ficticio | Estado previo de noviembre | Resultado |
| --- | --- | --- |
| Socio A | Sin cuota, cumple condiciones | Crear noviembre |
| Socio B | Noviembre abierto, generado manualmente | Conservar; cero nuevas |
| Socio C | Noviembre pagado anticipadamente | Conservar; cero nuevas |
| Socio D | Cuenta inactiva, sin cuota | Excluir; cero nuevas |

Al ejecutar nuevamente, el socio A tambien se omite: noviembre ya existe.
No se toca diciembre/enero anticipados ni se repiten sus pagos. El resumen
de ejecucion debe distinguir **creadas**, **ya emitidas**, **ya pagadas**,
**excluidas** y **casos por revisar**; omitir un mes existente es un resultado
normal, no un error ni una razon para cobrar de nuevo.

### Protecciones tecnicas y concurrencia

1. Reutilizar el indice unico de `membership_dues` en `{ beneficiaryId, period }`.
   Verificarlo antes de escribir. No agregar otra coleccion de cuotas.
2. Ejecutar lectura, decision, insercion y auditoria en una transaccion por socio.
   El bloqueo/version del socio coordina cambios de tipo, vigencia y generacion.
3. Insertar faltantes con `$setOnInsert`, no con un reemplazo del documento
   encontrado. No usar el cron para asignar `OPEN` indiscriminadamente.
4. Si dos instancias, o una accion manual y el cron, compiten por el mismo mes,
   resolver el conflicto con relectura/reintento acotado. El perdedor reconoce la
   cuota existente; no cambia su estado ni intenta otro ID para el mismo periodo.
5. Mantener la misma `Idempotency-Key` al reintentar una orden manual. Una vista
   previa desactualizada puede exigir nueva revision; no saltarse ese control.
6. Una caida antes del commit no deja una cuota parcial. Si el commit se completo
   pero se perdio su respuesta, la ejecucion siguiente encuentra el mes existente.
7. La generacion no crea `membership_payments`, no solicita una preferencia MP
   ni envia correos. Un control de ejecucion en memoria no sustituye al indice
   y la transaccion, especialmente con varios procesos o dynos.

**Base ya implementada:** `duesGenerationPlan()` separa filas nuevas y existentes;
`ensureMemberDues()` comprueba existencia, conserva cuotas y utiliza insercion
condicional; el esquema define el indice unico. El trabajo a aprobar consiste
en consolidar estos contratos en modo manual/automatico, controles y pruebas,
no en introducir un segundo generador que duplique esas reglas.

### Durante el mes: recibir y registrar ingresos

- Mercado Pago: intento persistido, webhook autenticado, evidencia verificada,
  pago confirmado, cuotas pagadas y auditoria atomica.
- Transferencia/deposito/efectivo: administracion verifica y registra el ingreso
  completo con fecha y medio reales. No hay deteccion bancaria automatica.
- El pago no activa una cuenta inactiva ni elimina restricciones administrativas.
- No se agregan recordatorios ni correos: el worker mensual de correo fue retirado.

## 5. Flujo B: operacion manual y recuperacion

1. Administracion abre el socio, elige el mes final y revisa las cuotas faltantes.
2. Confirma la emision. El backend crea solo cuotas faltantes y guarda auditoria.
3. El pago se registra despues, por el medio que realmente corresponda.
4. Si la generacion automatica esta activa y pasa luego, encuentra el mismo
   socio/mes y lo conserva sin cambios.
5. Un reintento de la misma solicitud conserva su clave de idempotencia.

Este recorrido individual ya tiene componentes implementados. Una accion
**global de generar el mes** para socios ya habilitados seria una mejora adicional
a aprobar: no confundirla con el masivo existente de habilitacion inicial.

Para un modo estrictamente manual, consultar listado, portal o permisos no debe
emitir cuotas por detras. Si faltan meses, debe solicitar generacion administrativa
en vez de aparentar que el mes fue emitido o pagado. Una cuota ausente es un
problema de emision que debe revisarse, no prueba de ingreso ni de mora registrada.

## 6. Flujo C: bloqueo automatico del dia 6

1. Desde las 00:00 del dia 6, identificar cuotas `OPEN` con `dueAt <= ahora`.
2. Revisar todas las vencidas, no solo una cuota del ultimo mes.
3. Si existe una vencida exigible y el bloqueo esta activo, impedir nuevas
   reservas. Mantener login y acceso al resto del sitio conforme a su rol.
4. No cambiar `statePlayer` a `false` por este primer atraso. No es una baja.
5. Mantener exencion financiera de administradores activos.
6. Al confirmar el pago completo de todas las vencidas, recalcular el permiso
   de reserva y retirar esa restriccion. No esperar al mes siguiente.

Ejemplo: el 6 de noviembre, octubre impago bloquea reservas. Noviembre puede
seguir abierto, sin bloquear por si solo hasta el 6 de diciembre. Si queda
septiembre exigible por una vigencia valida, tambien debe regularizarse.

### Aplicacion tecnica recomendada

El bloqueo debe ser una decision del backend sobre deuda y fecha, verificada en
cada nueva reserva y su inicio de checkout/retencion. No depender solo de un proceso que cambie un booleano
el dia 6: una sesion abierta desde el dia 5 tambien debe quedar restringida.

Reutilizar `financialAccess()` y `MembershipAccessGuard`. El control horario
puede conciliar/verificar, pero no debe ser la unica barrera. Al completar un
pago, refrescar permisos del frontend; aunque la pantalla este desactualizada,
el servidor continua siendo la autoridad.

El guard actual, `MembershipSessionBoundary` y la navegacion aplican un modo
`PAYMENTS_ONLY`. Deben ajustarse a la nueva regla de **solo impedir reservas**,
sin redireccionar todo al portal ni ocultar el menu. Proponer una capacidad
`canReserve` y un motivo estructurado es distinto de reutilizar ciegamente
`financiallyRestricted` para prohibir todas las operaciones. El rol y las
restricciones administrativas conservan sus controles independientes.

Un intento `PENDING` o `UNKNOWN` no acredita ingreso. Antes de pedir otro pago,
conciliar la referencia existente. Si aun no se confirma y hay deuda vencida,
no inventar un pago ni liberar automaticamente el acceso por tener un checkout
abierto. Mostrar revision pendiente. La revision que retiene una **baja por tres
meses** no equivale a reconocer pago ni a una exencion del bloqueo financiero.

No cancelar reservas previas, aplicar sanciones retroactivas o agregar correos
como parte de esta mejora. Cualquier cambio de ese alcance requiere otra decision.

## 7. Estado financiero en Administrar usuarios

**Si: Administrar usuarios es el lugar para visualizar el atraso y su bloqueo.**
La validacion efectiva sigue siendo del backend; no depende de abrir esa ventana.

Mostrar dos datos separados, sin confundirlos en una sola etiqueta:

| Dato | Ejemplo y significado |
| --- | --- |
| Estado de cuenta | `Activo` o `Inactivo`, determinado por `statePlayer` |
| Estado de mensualidades | `Al dia`, `Octubre vencido - $18.000`, `Sin inicio aprobado` o `Revision requerida` |
| Permiso de reserva | `Habilitado` o `Bloqueado por mensualidad vencida`, con motivo |

Ejemplo: **Activo / Octubre vencido: $18.000 / Reservas bloqueadas**.
El boton existente **Pagos del socio** abre las cuotas y el historial para
consultar, registrar transferencia/deposito/efectivo o revisar Mercado Pago.
Despues del registro confirmado, se refresca el mismo resumen financiero.

No usar el interruptor **Pago al dia** como confirmacion financiera ni permitir
que un cambio de ese booleano oculte una cuota vencida real. Hoy corresponde al
campo legado `updatePayment`; debe distinguirse de la deuda calculada y de un
bloqueo administrativo manual. Si se conserva ese control legado, su nombre,
alcance y efecto deben quedar explicitos; no representa dinero recibido.

Calcular el resumen desde cuotas `OPEN` vencidas, excluyendo `PAID`, `VOID` y
`ARCHIVED`, y aplicar las exenciones/reglas correspondientes. No llamar una
consulta de detalle por fila ni guardar otro estado financiero que pueda quedar
desactualizado: resolverlo por lote para los usuarios de la pagina visible.

**Privacidad:** la ruta existente `GET /register` no tiene guards administrativos
en su controlador. No agregar deuda, importes ni detalles financieros a esa
respuesta publica. Usar un resumen de API protegido con JWT y administrador
activo, reutilizando el modulo privado de mensualidades.

## 8. Hallazgos del codigo actual

| Hallazgo | Evidencia | Consecuencia para la propuesta |
| --- | --- | --- |
| Vencimiento ya es mes siguiente, dia 6 a las 00:00 | `billing.policy.ts`, `dueAt()` | Se conserva; no requiere cambiar el calendario |
| Bloqueo por deuda se calcula y exime admin | `billing.policy.ts`, `financialAccess()` | Reutilizar, no duplicar con `statePlayer` |
| Guard consulta permisos actuales, pero bloquea el sitio excepto pagos | `membership-access.guard.ts` | Ajustar a nuevas reservas, no mantener `PAYMENTS_ONLY` |
| Frontend oculta menu y redirige restringidos | `Navigation.tsx`, `MembershipSessionBoundary.tsx` | Conservar acceso al sitio segun rol y bloquear solo reserva |
| Admin usuarios muestra deuda a partir de `updatePayment` | `AdminRegister.tsx` | Incorporar resumen privado calculado desde cuotas |
| Tarea horaria y al arranque ya existen | `billing-lifecycle.service.ts`, `tick()` y `onApplicationBootstrap()` | Reutilizar recuperacion, no crear otro worker paralelo |
| `automation.enabled` gobierna generacion y cierre por tres cuotas dentro de `processMember()` | `billing-lifecycle.service.ts` | Separar sus controles antes de habilitar solo generacion |
| Portal prepara cuotas sin consultar `automation.enabled` | `billing-portal.service.ts`, `home()` | Apagar cron hoy no produce un modo estrictamente manual |
| Acceso financiero puede preparar cuotas cuando `autoBlockEnabled` esta activo | `membership-billing.service.ts`, `assessFinancialAccess()` | Revisar contrato de lectura/emision para que el interruptor sea coherente |
| Cotizacion y endpoint administrativo de compatibilidad tambien preparan cuotas | `quoteInSession()` y `memberContext(..., prepare)` | Incluirlos en el analisis de generacion; no corregir solo la pantalla |
| No hay API para cambiar los controles desde esa ventana | `billing-lifecycle.controller.ts` solo expone vista previa | Proponer controles administrativos auditados, no edicion directa habitual de Mongo |

Las implementaciones actuales no demuestran que esas opciones esten habilitadas
en produccion. Esta revision no consulta valores ni cuenta socios reales.

## 9. Implementacion sugerida en tres etapas

### Etapa 1: contratos y controles

- Separar generacion, bloqueo financiero y baja automatica, reutilizando campos
  existentes cuando su significado siga siendo correcto.
- Definir compatibilidad con configuraciones anteriores. Un campo nuevo ausente
  no debe encender bajas por defecto ni reinterpretar silenciosamente opciones.
- Dar un significado unico al modo manual y a la emision por consultas.
- Separar estado de cuenta, deuda y capacidad de reservar en el resumen privado
  de Administrar usuarios, sin exponer datos financieros en la ruta publica.
- Permisos admin, vista previa, SweetAlert2 y auditoria para cambios.
- No activar opciones en el club durante esta etapa.

### Etapa 2: ejecucion y acceso

- Reutilizar generador idempotente para recorrido manual y automatico.
- Probar cambio de mes, recuperacion tras caida y varias instancias concurrentes.
- Verificar bloqueo de nuevas reservas desde el dia 6 y liberacion tras
  confirmacion, sin depender de renovar el JWT. Mantener acceso al resto del sitio.
- Conservar bajas y reinscripcion aprobadas, sin mezclarlas con bloqueo simple.

### Etapa 3: piloto y activacion controlada

- Pruebas unitarias e integracion HTTP/JWT con MongoDB aislado y MP simulado.
- E2E del portal y administracion en escritorio, movil y tablet cuando sea posible.
- Piloto autorizado con Usuario test 1 y Usuario test 2, por sus IDs y tarifas
  $180/$50; ningun cobro real sin autorizacion especifica.
- Revisar vista previa, respaldo, despliegue y configuracion antes de activar.
- Documentar quien habilito cada control, desde cuando, resultados y excepciones.

## 10. Pruebas obligatorias de aceptacion

1. Dia 1 crea una cuota del mes; reejecutar no duplica ni modifica una manual/pagada.
2. Modo manual no crea meses desde lecturas; la generacion explicita sigue disponible.
3. Apagar generacion conserva cuotas, pagos e historial; no apaga los otros controles.
4. Activar generacion no enciende baja automatica por accidente.
5. Socio sin inicio aprobado, inactivo o fuera de vigencia no recibe cuotas nuevas.
6. Restringido por deuda sigue vigente y recibe su cuota mensual.
7. Titular/carga usan tarifa correcta; pilotos por ID; sin abonos parciales.
8. El 5 de noviembre a las 23:59:59 de Chile octubre aun esta en plazo; el 6 a
   las 00:00 esta vencido. Noviembre no bloquea por si solo ese dia.
9. Sesion del dia anterior recibe restriccion al intentar operar tras el corte.
10. Pago MP verificado y pago manual liberan solo la restriccion por deuda al
    quedar regularizado; no reactivan inactivos ni borran bloqueos administrativos.
11. `UNKNOWN`/webhook tardio, duplicidad y pagos concurrentes conservan integridad.
12. Deuda anterior exigible sigue restringiendo aunque el ultimo mes este pagado.
13. Administradores exentos; cargas no heredan permisos ni deuda ajena.
14. Caida el dia 1 o 6 y ejecucion en varias instancias recuperan sin dobles registros.
15. Tres vencidas, anticipos, anulaciones y reinscripcion conservan las reglas
    anteriores y la revision de casos inciertos.
16. Socio con primer atraso ve el sitio y su menu; no se fuerza `/monthlypayments`.
17. Reserva simple, multi-booking e inicio de pago/retencion de nueva reserva no
    permiten eludir el bloqueo con una llamada directa a API.
18. Admin usuarios distingue cuenta activa, deuda y permiso, actualiza al registrar
    pago y no permite aparentar un ingreso mediante `updatePayment`.
19. Usuarios no administradores no reciben resumen financiero ajeno; el listado
    publico de socios no incorpora deuda ni importes de mensualidades.
20. Mes abierto manualmente, mes emitido automaticamente y mes pagado anticipado:
    el cron deja mismos IDs, estados, importes y relaciones de pago.
21. Ejecutar dos veces, reiniciar el backend y ejecutar desde dos instancias:
    sigue existiendo una sola cuota por beneficiario/periodo.
22. Generacion manual y automatica concurrentes, con pago confirmado durante la
    carrera: una sola cuota, sin devolver `PAID` a `OPEN` ni perder su pago.
23. Mes `VOID`/`ARCHIVED` conserva evidencia; la emision ordinaria no lo reabre.
    Una reinscripcion aprobada se prueba separadamente.
24. Pago confirmado sin cuota consistente, duplicado historico o indice faltante:
    se reporta revision sin inventar deuda ni borrar registros.
25. Espiar creacion de pagos y llamadas externas durante generacion ordinaria:
    cero ingresos nuevos, cero checkouts y cero correos por emitir cuotas.
26. El 1 de noviembre, con octubre y noviembre abiertos, admitir octubre solo
    o ambos completos, rechazar noviembre solo y mantener noviembre impago si
    se pago unicamente octubre. Probar UI, cotizacion, pago manual y checkout MP.

## 11. Fuentes y estado de aprobacion

- [Operacion funcional/tecnica actual](operacion-pago-mensualidades.md).
- [Reglas y calculo de vencimiento/acceso](../src/membership-billing/billing.policy.ts).
- [Guard de acceso](../src/membership-billing/membership-access.guard.ts).
- [Automatizacion y baja actuales](../src/membership-billing/billing-lifecycle.service.ts).
- [Emision desde portal](../src/membership-billing/billing-portal.service.ts).
- [Preparacion y evaluacion financiera](../src/membership-billing/membership-billing.service.ts).
- [Plan que diferencia cuotas nuevas y existentes](../src/membership-billing/billing-generation.policy.ts).
- [Cuotas y unicidad socio/periodo](../src/membership-billing/entities/membership-due.entity.ts).
- [Configuracion persistida](../src/membership-billing/entities/membership-billing-config.entity.ts).
- [API actual de automatizacion](../src/membership-billing/billing-lifecycle.controller.ts).
- [Listado y edicion de usuarios](../../tennis-court-front/src/components/AdminRegister.tsx).
- [Navegacion actual](../../tennis-court-front/src/components/Navigation.tsx).
- [Restriccion de navegacion actual](../../tennis-court-front/src/components/MembershipSessionBoundary.tsx).
- [Rutas de socios y sus guards](../src/register/register.controller.ts).

Confirmado en esta conversacion: mes vencido y ejemplo octubre/6 de noviembre.
Confirmado despues: primer atraso impide reservar, pero permite ver el resto del
sitio. No significa baja de cuenta ni modo limitado exclusivamente a pagos.
Confirmado tambien: una cuota mensual ya emitida o pagada no se vuelve a generar.
Confirmado tambien: con varios meses abiertos se permite pagar la cuota mas
antigua completa o varias consecutivas, sin obligar a pagar el mes actual.
Lo demas es una propuesta de flujos y alcance para aprobar antes de implementar.
El analisis original no modifico codigo ni ejecuto pruebas. La etapa 1 posterior
si modifica codigo local y tiene pruebas/evidencias en su documento tecnico.
No se modificaron datos ni opciones de produccion. Los resultados locales de etapa 2
se registran en su documento tecnico; no implican aprobar la etapa 3 ni activar opciones del club.
