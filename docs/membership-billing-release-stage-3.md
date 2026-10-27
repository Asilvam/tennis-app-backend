# Mensualidades: nueva etapa 3, piloto y liberación

Fecha: 27 de octubre de 2026. Piloto y regresión locales; no equivale a publicación,
activación general ni autorización de un cobro nuevo. Prevalecen las reglas del
[README](../README.md#mensualidades-ctq), incluidas las cuotas históricas no exigibles
tras reinscripción aprobada. No se agregaron pantallas, colecciones ni variables de entorno.

## Evidencia local

- Backend: 792 pruebas aprobadas con replica set local, sin integraciones omitidas.
- Frontend: 203 pruebas aprobadas.
- Mercado Pago: 125 pruebas aprobadas con proveedor simulado.
- Correo: 29 pruebas aprobadas con envío simulado.
- Compilación de los cuatro proyectos correcta. No se inició AppModule con `.env` real.
- Piloto visual con NestJS y MongoDB aislados: alta titular $180, carga $50, pago manual
  completo $230 de fixtures, folio, historial y auditoría; no representa dinero recibido.
- Recorrido de baja, meses excluidos y reinscripción con histórico no exigible.
- Chrome y WebKit en 320, 390, 820 y 1440 px; no certifica Safari en un iPhone físico.
- Respaldo financiero local validado y restaurado en otra base temporal, conservando BSON.

## Corrección encontrada en el piloto

Una cuota futura emitida antes de una baja podía permanecer `VOID` después de reinscribir,
aunque ese mes ya perteneciera a la nueva vigencia. Se reprodujo el fallo tanto en el
proceso automático como al preparar cuotas desde la app y se corrigió en ambos caminos.

Ahora solo se reabre una cuota excluida por baja si corresponde a un intervalo posterior
aprobado explícitamente. Se reutiliza su ID, se calcula la tarifa vigente y se guarda la
evidencia anterior/nueva en auditoría dentro de la misma transacción. Un fallo de auditoría
revierte estado e importe. No se reabren meses inactivos, históricos `ARCHIVED` ni pagos
reales; reintentos no generan cuotas ni auditorías duplicadas.

## Revisión del ambiente desplegado

Revisión autorizada de solo lectura el 27 de octubre de 2026, con la cuenta correcta
de Heroku. Credenciales solo en memoria, sin exportar respaldos ni modificar registros.

- Octubre de Test 1 ($180) y Test 2, carga vinculada ($50), está `PAID` con pagos
  `CONFIRMED`. La consulta GET al proveedor confirmó `approved`, CLP, modo real,
  importes/cuenta/referencias coherentes y cero devolución. No se repitieron cobros.
- Los dos avisos de confirmación están `SENT` en la base; esto no certifica entrega
  a bandeja de entrada. No se enviaron correos de prueba.
- Tarifas generales $18.000/$5.000; precios bajos solo para los dos IDs autorizados.
  No hay cuotas ni socios con inicio de facturación fuera del piloto.
- 100 socios activos sin inicio aprobado; los dos del piloto no tienen el nuevo historial
  de vigencia. Requieren revisión explícita antes de la habilitación general, sin reiniciar
  sus pagos, inventar deuda ni migrar automáticamente.
- Un checkout de Test 1 conserva `creationStatus=UNKNOWN`, aunque el pago está confirmado
  y verificado en el proveedor. Pendiente distinguir este metadato histórico de un pago
  realmente incierto en las validaciones. No se corrigió el dato ni el código en esta revisión.
- Variables obligatorias presentes en las cuatro apps, URLs/rutas coherentes y claves
  internas coincidentes. SMTP 587 con `MAIL_SECURE=false`. Sin variables mensuales
  obsoletas ni nuevas variables necesarias. No se probaron credenciales SMTP/Cloudinary
  mediante envíos o cargas reales.
- Versiones observadas: backend v64 (`b37fe449`), frontend v46 (`f00ac5df`) y MP v36
  (`df70dac5`), del 18 de octubre UTC. Las nuevas etapas locales no están desplegadas.
  `autoBlockEnabled` y automatización general siguen desactivados en la base.

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

1. Revalidar el ambiente antes del despliegue: la revisión de solo lectura ya fue realizada
   y sus hallazgos están arriba; no es aprobación de cambios generales.
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
