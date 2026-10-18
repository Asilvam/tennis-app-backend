# Mensualidades: base backend de etapa 2

Documento historico del cierre de etapa 2. La etapa 3 agrega rutas administrativas
protegidas y conecta el modulo al arranque con habilitacion explicita, sin migracion ni
bloqueo automatico. Ver [etapa 3](membership-billing-stage-3.md) para el estado actual.

## Alcance implementado

- Tres esquemas propuestos y aprobados: membership_dues, membership_payments y
  membership_billing_config. Los modelos no crean colecciones o indices automaticamente.
- Campos opcionales billingStartPeriod y billingBaseline en register, sin defaults ni migracion.
- Reglas de tarifas, mes vencido, dia 5 inclusivo y anticipos del mes actual mas tres futuros.
- Tarifas generales 18000/5000; tarifas TEST 180/50 solo para IDs explicitamente autorizados.
- Generacion de cuotas con transacciones, version del socio e indice unico beneficiario/mes.
- Cotizacion calculada en servidor: cuotas completas, sin saltos, duplicados ni terceros.
- Consulta de historial paginado, separando pagador y beneficiario, sin exponer imputaciones
  ni correo de otras personas a una carga.
- Calculo de restriccion financiera con control global, revision previa y excepcion admin.
- Esquemas con validacion de evidencia para pagos confirmados, cuotas pagadas y anulaciones.
- Contrato DTO de seleccion que no admite montos elegidos por el cliente.

## No activado ni implementado en esta entrega

MembershipBillingModule NO esta importado en AppModule. No hay rutas HTTP nuevas,
configuracion inicial automatica, tareas programadas ni cambios al login o a reservas.
No se ejecutaron migraciones ni se consultaron cuentas reales, incluidos los dos usuarios
autorizados para pruebas. Su resolucion a IDs reales corresponde al inventario aprobado.

La aprobacion del diseno no activa el bloqueo global. La funcion de evaluacion financiera
es una pieza de dominio, no sustituye los guards ni los controles manuales existentes.
Sin billingStartPeriod explicito, la generacion se rechaza; no inventa una politica de altas,
reactivaciones o deuda retroactiva.

Pendientes para las etapas siguientes:

- Endpoints autenticados y ventana administrativa de transferencias/depositos.
- Registro, imputacion y anulacion financiera atomicos con auditoria, idempotencia y correo.
- Portal de socio, guards/capacidades para acceso restringido y validaciones en reservas.
- Checkout, webhook mensual, conciliacion y prueba completa de pago con Mercado Pago.
- Scripts de inventario/migracion, baseline real y activacion opcional revisados por separado.

No presentar los fixtures de pagos de las pruebas como una integracion de cobro terminada.

## Contrato del servicio

| Operacion | Entrada | Comportamiento |
| --- | --- | --- |
| prepareDues | actorId, beneficiaryId, throughPeriod opcional | Autoriza y asegura cuotas consecutivas; no registra pagos |
| quote | actorId, dueIds | Revalida titular/cargas, asegura obligaciones faltantes y calcula total |
| assessFinancialAccess | memberId | Evalua deuda; si el control aplica, asegura primero cuotas exigibles |
| paymentHistory | actorId, beneficiaryId, pagina/tamano | Devuelve solo informacion autorizada |

Estos metodos reciben IDs internos que un controlador futuro debe resolver desde la
identidad autenticada. Nunca tomar actorId del cuerpo de una solicitud como autoridad.
Una cotizacion no congela una autorizacion para siempre: al registrar o confirmar un pago,
el servicio de imputacion de la etapa correspondiente debe revalidar dentro de su transaccion.

Los tipos pueden conservar el valor historico Familiar como Carga para determinar tarifa;
gestionar una carga ajena exige titularId. No se normalizan perfiles automaticamente.

## Seguridad de pruebas

Las unitarias y las validaciones de esquemas no usan red ni MongoDB. Los modelos solo
validan documentos en memoria.

La suite de integracion usa exclusivamente BILLING_TEST_MONGO_URI. Rechaza cualquier
host distinto de 127.0.0.1, bases sin prefijo ctq_billing_test_ o un servidor sin replica set.
No lee .env, no importa DatabaseModule/AppModule y no llama a Mercado Pago o correo.
Los nombres usuario test 1 y usuario test 2 son fixtures creados dentro de esa base aislada,
no cuentas reales buscadas en produccion. El tercer fixture comprueba denegacion y tarifa
general; no se modifica ningun socio real.

Ejemplo (solo con un replica set temporal ya preparado):

```sh
env 'BILLING_TEST_MONGO_URI=mongodb://127.0.0.1:27186/ctq_billing_test_manual?replicaSet=ctqBilling' \
  npm test -- --runInBand membership-billing
```

La suite crea indices explicitamente y elimina solo su base temporal al finalizar.
Sin esa variable, las integraciones se omiten expresamente; no se reportan como aprobadas.

## Validacion y decisiones tecnicas

- El reloj se inyecta para probar limites y la zona America/Santiago sin depender de Heroku.
- Durante el salto de horario, el inicio del dia 6 significa el primer instante valido de ese
  dia: en algunas fechas locales es 01:00, no una medianoche inexistente.
- No hay TTL sobre cuotas o pagos. Un estado pendiente no es dinero recibido.
- La tarifa queda congelada en la cuota; generar otra vez no modifica montos anteriores.
- Configuracion TEST habilitada sin IDs permitidos falla; nombres parecidos no habilitan tarifas.
- Se necesita revision de migracion para habilitar el control global.
- El formateador del modulo usa printWidth=100 para respetar max-len=120 sin cambiar la
  configuracion global existente del usuario.
- Los esquemas de Mongoose no sustituyen las verificaciones transaccionales. Las escrituras
  futuras deben pasar por servicios de dominio; pre-validate no protege updateOne arbitrarios.

## Revision de impacto

No se modifican MpService, el microservicio de Mercado Pago, EmailService, sus plantillas,
AuthService ni las reglas de reserva existentes. No se elimina monthpayctq ni se integra
feature/monthly-payments. El retiro y la migracion continuan pendientes segun el diseno.

No hay cambios de estilos: las pantallas futuras conservaran los tokens CTQ y CSS propio.

## Verificacion realizada

- Suite completa del backend: 577 pruebas aprobadas en 41 suites, sin omisiones.
- Nuevas pruebas: 48 de reglas, 17 de esquemas/DTO y 18 de integracion financiera.
- Se ejecutaron tambien las integraciones existentes de categorias y resultados sobre
  bases temporales distintas del mismo replica set local, sin base de produccion.
- Compilacion NestJS aprobada; ESLint del modulo nuevo aprobado; git diff --check aprobado.
- No se ejecutaron cobros ni migraciones financieras. Los pagos de los fixtures comprueban
  validacion/persistencia de estados, no transferencia bancaria ni checkout real.
- El servidor MongoDB temporal se detiene despues de las pruebas; no es un servicio de app.
