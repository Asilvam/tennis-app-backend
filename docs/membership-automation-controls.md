# Controles administrativos de automatizacion

Fecha: 2026-11-01. Implementacion local, sin despliegue ni cambios de configuracion
en Atlas/Heroku. Ampliacion solicitada despues de la etapa 1 de permisos.

## Alcance y uso

Ruta frontend: `/adminpayments`, vista global **Mensualidades CTQ**. La seccion
**Automatizacion global** ofrece dos interruptores. No aparecen en el detalle
`?memberId=...` ni durante el registro individual de un pago.

| Control | Campo persistido | Al desactivar |
| --- | --- | --- |
| Generacion recurrente de cuotas | `automation.enabled` | Detiene futuras pasadas recurrentes; conserva cuotas y generacion manual/bajo demanda |
| Bloqueo de reservas por mora | `autoBlockEnabled` | Deja de aplicar esa restriccion automatica; conserva deuda, cuentas inactivas y bloqueos manuales |

La baja automatica `automation.terminationEnabled` **no cambia** al tocar estos
controles. No se agrega un interruptor para bajas ni un nuevo worker/correo.
La preparacion bajo demanda del portal/cotizacion/compatibilidad administrativa
continua: esto NO implementa todavia un modo estrictamente manual de emision.

Operacion:

1. Abrir la vista global: consulta ligera de configuracion, sin crear cuotas.
2. Seleccionar un interruptor: SweetAlert2 explica el cambio y permite cancelar.
3. Confirmar: backend valida administrador vigente, revision y migracion aprobada.
4. Tras respuesta valida se actualiza el interruptor y muestra confirmacion.
5. Conflicto o respuesta incierta: relee estado actual, informa error, no reintenta
   automaticamente ni supone que el cambio fallo o quedo aplicado.

No hay activacion inicial implicita. Mientras carga o no hay respuesta confiable,
los controles estan deshabilitados y no muestran un falso estado editable.
Con migracion pendiente se permiten desactivaciones, no activaciones.

## Contrato HTTP

Prefijo: `/membership-billing/admin/automation`.

- `GET /settings`: flags y revision SHA-256 del documento actual. Solo lectura;
  no consulta a Mercado Pago, recorre socios, genera cuotas o escribe auditoria.
- `POST /settings`: un solo cambio; valida DTO estricto sin coercion de booleanos.

```json
{
  "setting": "generation",
  "enabled": false,
  "revision": "<SHA-256 de 64 caracteres recibido del GET>"
}
```

`setting` admite exclusivamente `generation` o `autoBlock`. No admite tarifas,
`migrationReviewed`, aprobaciones, datos de socios ni `terminationEnabled`.
Respuesta de ambas rutas:

```json
{
  "generationEnabled": false,
  "autoBlockEnabled": false,
  "terminationEnabled": false,
  "migrationReviewed": true,
  "revision": "<SHA-256 actual>"
}
```

Protecciones: `JwtAuthGuard`, `AdminGuard`, `BillingAdminEnabledGuard` existente,
y nueva consulta del rol/actividad del administrador en base. No basta un JWT
con rol viejo. `MEMBERSHIP_BILLING_ADMIN_ENABLED` conserva su funcion existente;
no hay variables nuevas ni cambios necesarios de `env.example` para estos controles.

| Respuesta | Condicion |
| --- | --- |
| 200 GET / 201 POST | Lectura o cambio valido; mismo valor es no-op sin auditoria duplicada |
| 400 | Campo extra, control desconocido, booleano no real o revision invalida |
| 401 | Sin JWT valido |
| 403 | Rol no autorizado o administrador ya no vigente |
| 409 | Revision desactualizada o activacion sin revision de migracion |
| 503 | Modulo deshabilitado o configuracion no disponible; nunca se crea por defecto |

## Persistencia y concurrencia

Colecciones existentes: `membership_billing_config`, `audit_logs`.
El cambio corre en transaccion MongoDB: se lee configuracion, compara revision,
modifica solo el campo permitido, incrementa `__v` y agrega auditoria. Un conflicto
de escritura reintenta la transaccion; la nueva lectura detecta revision distinta
y responde 409. No se sobrescribe el cambio de otro administrador.

Auditoria: `entityType=MEMBERSHIP_BILLING_CONFIG`, `entityId=MONTHLY_MEMBERSHIP`,
`performedBy=ADMIN`, nombre/correo del actor de base, `beforeData`, `afterData`,
fecha y `eventId` derivado de revision/control. Fallar auditoria revierte el cambio.
Una repeticion del mismo valor actual no escribe; repetir una revision anterior
devuelve 409 y no duplica el registro.

Activar generacion registra `automation.approvedAt/approvedBy` con reloj/actor
servidor, pero nunca marca `activation.migrationReviewed=true`. Desactivacion
conserva aprobaciones y `terminationEnabled`. Activar solo bloqueo no agrega
un objeto `automation` a configuraciones anteriores que no lo tenian.

Guardar no invoca `tick()`: generacion se observa en la siguiente pasada horaria
o arranque existente. Bloqueo se evalua en permisos y nuevas reservas con la
configuracion actual; no requiere esperar al cron ni muta `statePlayer`.
Una ejecucion que ya paso la comprobacion de habilitacion no se cancela a mitad
de transaccion; el apagado controla las siguientes comprobaciones del proceso.

No se modifican cuotas `OPEN/PAID`, pagos, historiales, tarifas, pilotos, estados
de cuenta ni el indicador manual `updatePayment` desde estas rutas.

## Fuentes y evidencia

Resultado final: **912/912 pruebas backend**, 57 suites, cero omitidas; incluyen
198 integraciones con MongoDB temporal (12 casos nuevos HTTP/transaccionales de
estos controles). **323/323 pruebas frontend**, cero omitidas. E2E: **6 vistas y
72 comprobaciones** en Chromium/WebKit a 390/820/1440px. TypeScript de ambos
proyectos, lint y build frontend correctos. MongoDB temporal detenido al terminar.
Las capturas muestran flags de fixtures, no la configuracion del club.

- Backend: `billing-lifecycle.controller.ts`, `billing-lifecycle.service.ts`,
  `dto/billing-automation.dto.ts` dentro de `src/membership-billing/`.
- Unitarias: `billing-automation.spec.ts` (DTO y delegacion de identidad).
- Integracion: subgrupo `Administrator automation settings` dentro de
  `billing-lifecycle.integration.spec.ts`: HTTP/JWT, transacciones reales,
  autorizacion, concurrencia, revision, auditoria atomica y pagos intactos.
- Frontend: `MembershipAutomationSettings.tsx`, integrado en
  `AdminMembershipPayments.tsx`, CSS propio de mensualidades.
- Evidencia final: `docs/evidence/automation-controls/validation.json` y evidencia
  responsive correspondiente del frontend. Describe datos sinteticos y limites;
  no constituye validacion de activacion o despliegue en produccion.
