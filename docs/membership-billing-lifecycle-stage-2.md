# Mensualidades: nueva etapa 2, automatización y reinscripción

27 de octubre de 2026. Implementación local, sin despliegue, cobros reales, bajas masivas
ni activación general. Referencia: [Mensualidades CTQ](../README.md#mensualidades-ctq).

## Reglas y estados

Se generan cuotas calendario durante la vigencia aprobada, con tarifas existentes por
tipo e ID de prueba. Inactivos no generan cuotas; activos restringidos financieramente sí.
Tres meses consecutivos vencidos de la vigencia actual causan baja el día 6 siguiente
al tercer mes. Octubre, noviembre y diciembre: corte 6 de enero de 2027, sin cobrar enero.
Se usa fecha efectiva del pago, no llegada de webhook. Desde las 00:00 del día 6 es tardío.
Administradores no se dan de baja automáticamente. No se cambia `updatePayment`.

| Estado | Tratamiento |
| --- | --- |
| `OPEN` | Cuota completa cobrable. |
| `PAID` | Pago real confirmado con evidencia e imputación. |
| `VOID` | Posterior al corte, sin cobro por baja; conserva monto, motivo y fechas. |
| `ARCHIVED` | Histórico no exigible aprobado al reinscribir; conserva monto, motivo, responsable y fecha. No es ingreso. |

No se borran cuotas ni se simulan pagos. Solo cuotas cobrables participan en selección,
orden de pago y restricción financiera. Los históricos no resucitan al generar otro mes.

## Ejecución y seguridad

`BillingLifecycleService` comprueba recuperación al arrancar y cada hora a minuto cero
en `America/Santiago`, siempre sujeto a aprobación explícita. Recupera
meses faltantes y el primer corte efectivo después de una caída. Una transacción por socio,
bloqueos de documentos y los índices únicos existentes evitan duplicados entre réplicas.
Un error no detiene al siguiente socio; un fallo de auditoría revierte toda la operación.
No se crean colecciones, índices o cursores persistentes al arrancar.

Antes de decidir bajas solicita conciliación al servicio MP existente. Pedir conciliación
no prueba pago: mientras haya un intento pendiente, desconocido o en revisión, la baja
se retiene y audita. No se cancela un intento por edad o fallo de red. Se conserva la
expiración segura existente tras una búsqueda completa del proveedor.

Futuras pagadas, historial de vigencia ausente y anulaciones que afectan el corte requieren
revisión. No se inventan aprobaciones antiguas ni devoluciones automáticas. La vista previa
`GET /membership-billing/admin/automation/preview` exige JWT de admin activo y devuelve
cuotas faltantes, corte, exención y motivos de revisión, sin escrituras ni llamadas a MP.

## Activación separada

No se agregaron variables de entorno. Se reutiliza `MEMBERSHIP_BILLING_ADMIN_ENABLED`.
Además, el documento existente `membership_billing_config` debe tener revisión aprobada:

```typescript
activation: { migrationReviewed: true },
automation: {
  enabled: true,
  approvedAt: /* fecha real de aprobación */,
  approvedBy: /* administrador responsable */,
}
```

La ausencia de `automation` o `enabled: false` mantiene la tarea desactivada. No hay ruta
pública de ejecución/activación. La aprobación, respaldo y habilitación real corresponden
a la etapa 3. `autoBlockEnabled` es independiente: restringir reservas no equivale a dar
de baja. No se cambió ninguna de esas opciones en datos del club.

## Reinscripción

Desde Mensualidades, la baja automática válida muestra **Reinscribir socio** en su detalle,
sin habilitar pagos de inactivos. Se revisa el mes actual, cuota nueva e importe histórico
que dejará de exigirse, se indica motivo y se confirma con SweetAlert2.

No exige pagar deuda anterior ni cobra inscripción extra. Conserva ID, inicio original,
pagos reales y vigencias cerradas. Abre nueva vigencia desde el mes actual y archiva las
anteriores impagas como no exigibles, sin bloquear reservas por ellas. Los meses fuera
del club siguen sin cobro; solo la cuota del nuevo período se crea o reabre con auditoría.

Contratos con validación estricta, huella de aprobación e idempotencia:

- `POST /membership-billing/admin/members/:id/reenrollment/preview`: `{ startPeriod }`.
- `POST /membership-billing/admin/members/:id/reenrollment`: `{ startPeriod, approvalHash, reason }`
  y `Idempotency-Key`. Mismos datos/clave no duplican. Cambios de tarifa o histórico exigen revisión.

La activación genérica no salta este flujo. Inactividades manuales sin cierre válido no
se convierten en bajas automáticas inventadas. Una anulación posterior de un pago antiguo
conserva la cuota como histórico no exigible. Un MP tardío sobre `VOID`/`ARCHIVED` queda
en revisión, sin imputación automática ni reactivación de cuenta.

## Pruebas y publicación

Pruebas unitarias e integración con replica set temporal: Chile día 5/6, recuperación,
concurrencia, tarifas, inactivos, admins, históricos, conciliación, pagos efectivos tardíos,
anticipos, rollback de auditoría, JWT, reintentos y reinscripción. Regresión de pagos,
correo, reservas, resultados y categorías con proveedores simulados.

Recorrido Chrome/WebKit a 320, 390, 820 y 1440 px con frontend y NestJS reales y base local
aislada; no certifica un iPhone físico. No se usó Atlas ni AppModule con `.env` real.
Etapa 3: revisar club y casos retenidos, respaldar, pilotear y aprobar activación aparte.
