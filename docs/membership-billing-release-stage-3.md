# Mensualidades: nueva etapa 3, piloto y liberación

Fecha: 27 de octubre de 2026. Piloto y regresión locales; no equivale a publicación,
activación general ni autorización de un cobro nuevo. Prevalecen las reglas del
[README](../README.md#mensualidades-ctq), incluidas las cuotas históricas no exigibles
tras reinscripción aprobada. No se agregaron pantallas, colecciones ni variables de entorno.

## Corrección encontrada en el piloto

Una cuota futura emitida antes de una baja podía permanecer `VOID` después de reinscribir,
aunque ese mes ya perteneciera a la nueva vigencia. Se reprodujo el fallo tanto en el
proceso automático como al preparar cuotas desde la app y se corrigió en ambos caminos.

Ahora solo se reabre una cuota excluida por baja si corresponde a un intervalo posterior
aprobado explícitamente. Se reutiliza su ID, se calcula la tarifa vigente y se guarda la
evidencia anterior/nueva en auditoría dentro de la misma transacción. Un fallo de auditoría
revierte estado e importe. No se reabren meses inactivos, históricos `ARCHIVED` ni pagos
reales; reintentos no generan cuotas ni auditorías duplicadas.

## Chequeo operativo de solo lectura

`scripts/membership-billing-release-check.cjs` no importa AppModule, no registra workers,
no llama al proveedor y no tiene modo `apply`. No carga `.env` automáticamente. Usa la
variable existente `MONGODB_URI` y exige indicar base e IDs del piloto explícitamente:

```bash
node scripts/membership-billing-release-check.cjs \
  --database Tennis \
  --pilot-member-id ID_USUARIO_TEST_1 \
  --pilot-member-id ID_USUARIO_TEST_2
```

Comprobar autorización y ambiente antes de ejecutar contra datos del club. No imprimir
credenciales ni copiar valores de Heroku a archivos `.env`. La salida no incluye nombres,
correos, claves, contraseñas o información bancaria; sí IDs operativos de incidencias.

Revisa configuración, tarifas $18.000/$5.000 y $180/$50 solo por los dos IDs, relación
titular/carga, índices únicos, duplicados, liquidaciones, imputaciones, vigencias e históricos,
cuentas sin inicio/historial aprobado e intentos/correos que requieren revisión.

`pilotReadyForReview`/`generalReadyForReview` son orientación para revisión, no aprobación.
`mutationAllowed` siempre es `false` y `approvalRequired` siempre es `true`. No crea
cuotas, índices, colecciones, pagos, habilitaciones o bajas aunque no encuentre incidencias.
El informe no sustituye verificar webhooks, dinero y correo en el ambiente desplegado.

## Respaldo financiero

Con autorización para exportar esos datos, agregar `--backup /ruta/privada/financial.ejson`.
La lectura es consistente mediante una transacción snapshot. El archivo se crea con
permisos `0600`, no sobrescribe otro archivo y lleva SHA-256. Verificarlo sin abrir BD:

```bash
node scripts/membership-billing-release-check.cjs \
  --validate-backup /ruta/privada/financial.ejson
```

Incluye cuotas, pagos, configuración, auditoría financiera y campos de identidad/vigencia
necesarios de socios. Excluye contraseñas, tokens de recuperación y auditoría de reservas.
Es un respaldo del dominio financiero, **no un respaldo íntegro de la aplicación** ni un
comando automático de restauración. Su contenido es privado; no agregarlo a Git ni
compartirlo como informe. Antes de publicar, además revisar el respaldo operativo del
proveedor de base de datos y el procedimiento de recuperación del ambiente completo.

La restauración de prueba se realiza únicamente en una base `ctq_billing_test_*`. Nunca
reemplazar un socio completo desde este respaldo parcial ni borrar pagos para recuperar.

## Pendientes para cerrar la liberación real

1. Revisar el ambiente antes del despliegue mediante el chequeo operativo de solo lectura.
   Esa revisión no equivale a aprobación de cambios generales.
2. Resolver cuentas sin inicio/historial y casos retenidos, sin inferir deuda ni modificar
   bases iniciales, y el checkout confirmado con metadato `UNKNOWN`. Revisar el retorno
   global al login por sesión vencida, todavía pendiente según README.
3. Aprobar respaldo real y revisiones Git reproducibles de frontend/backend en `develop`.
   Excluir `.env`, lockfiles ajenos, cambios de formato y modificaciones no relacionadas.
   No se necesita cambiar código de MP/correo para este alcance; no desplegarlos sin motivo.
4. Autorizar despliegue y comprobar las versiones efectivas, salud, JWT/roles y callback
   mensual. Mantener `automation` y `autoBlockEnabled` desactivados durante el piloto.
5. Revisar las cuotas reales de ambos usuarios antes de un checkout. Si ya están pagadas,
   conservar la evidencia y no repetirlas. Un nuevo pago real exige autorización concreta,
   cuota elegible y cuenta/CLP/importe/modo/webhook verificados; el usuario completa el pago.
6. Verificar proveedor, callback, imputación única, auditoría, historial y correo entregado
   en ese ambiente. No considerar el retorno del navegador prueba de pago.
7. Presentar vista previa de generación/bajas y aprobar explícitamente la activación general,
   con responsable, fecha y monitoreo. No activar por el mero hecho de publicar código.

Estos cambios no autorizan push, despliegues, cobros, respaldos del club ni activación
general. La revisión no modificó socios/configuración. Revertir código no revierte dinero.
