# Mensualidades: nueva etapa 1, habilitación y efectivo

Fecha: 27 de octubre de 2026. Implementación local del plan operativo en tres etapas.
No se ejecutan migraciones, cobros reales, altas generales, bajas, tareas mensuales o despliegues.
Las reglas vigentes se mantienen en [Mensualidades CTQ](../README.md#mensualidades-ctq).

## Alcance

- Habilitación inicial de un socio activo desde su detalle, accesible por Usuarios o Mensualidades.
- Vista previa del mes inicial al actual, con tarifa y total calculados por el servidor.
- Confirmación administrativa con motivo, auditoría e idempotencia. No crea un pago ficticio.
- Vigencia inicial en `register.billingPeriods`, sin colección nueva ni migración de socios anteriores.
- Medio `CASH` independiente de transferencia, depósito y Mercado Pago; folio de efectivo generado por backend.
- Confirmación, historial, correo y anulación auditable de efectivo, reutilizando el flujo administrativo.
- Colores CTQ, CSS de la ventana y confirmaciones/errores SweetAlert2.

## Contratos

Prefijo autenticado: `/membership-billing/admin`. Se verifica administrador activo en BD;
el rol antiguo de un JWT no reemplaza esa verificación.

| Ruta | Uso |
| --- | --- |
| `POST /members/:id/enrollment/preview` | Cuerpo `{ startPeriod }`; devuelve cuotas, tarifa, total y huella de aprobación. Solo lectura. |
| `POST /members/:id/enrollment` | Cuerpo `{ startPeriod, approvalHash, reason }` e `Idempotency-Key`; aprueba inicio y cuotas en una transacción. |
| `POST /payments` | Conserva contrato manual; acepta `CASH` sin `reference`. Backend genera `cash.receiptNumber` y atribuye `registeredBy`. |
| `GET /payments?method=CASH` | Historial de efectivo, folio, receptor, pagador e imputaciones. |
| `POST /payments/:id/reversal` | Corrige banco o efectivo con motivo; conserva evidencia y reabre solo sus cuotas. No devuelve dinero ni opera sobre Mercado Pago. |

La habilitación rechaza inactivos, un inicio posterior al mes actual o anterior al comienzo
del sistema, cargas sin titular válido, historiales existentes y registros financieros previos
incompatibles. No sobrescribe datos históricos para simular una primera alta.

Cambios de precio, tipo o datos relevantes después de la vista previa exigen una nueva
revisión. Reintentos con la misma clave y contenido devuelven el resultado guardado;
la misma clave con otro contenido se rechaza. Un fallo de auditoría revierte también
el inicio y todas sus cuotas.

En efectivo se verifica el total completo recibido. No se aceptan referencias bancarias,
folios elegidos por el navegador ni evidencia de Mercado Pago. Un fallo de correo no
revierte el pago; el trabajador existente procesa su aviso y reintentos.

## Vigencia y compatibilidad

`billingPeriods` guarda intervalos `fromPeriod`/`throughPeriod` y metadatos de aprobación.
El historial queda excluido de las consultas generales por defecto (`select: false`);
solo los servicios que necesitan esa información lo solicitan explícitamente.

La nueva habilitación crea el primer intervalo abierto. La generación respeta intervalos
registrados y no rellena huecos; la cotización rechaza cuotas fuera de vigencia.
Los socios anteriores sin ese campo conservan sus reglas previas. No se modifica su
inicio, baseline, estado, titular o tarifa como efecto de consultar la pantalla.

No se agregó baja manual ni cierre automático. Según la decisión confirmada, el cierre
tras tres mensualidades vencidas y la reinscripción pertenecen a la etapa 2. No se activa
el bloqueo financiero general ni se cambian sus banderas.

## Pruebas locales

- Unitarias de intervalos, selección y contratos; evidencia de efectivo y privacidad del historial.
- Integración HTTP/JWT/MongoDB replica set: vista previa sin escrituras, alta atómica,
  reintentos concurrentes, rechazo de tarifa obsoleta y rollback de auditoría.
- Efectivo: folio, total, receptor, historial filtrado, aviso por correo simulado,
  rechazo de datos bancarios/provider, deduplicación y anulación preservando evidencia.
- Reglas de tarifas generales y tarifas bajas solo para los IDs de fixtures permitidos;
  cuentas inactivas, cargas sin titular, períodos inválidos y falta de permisos.
- Frontend: revisión antes de confirmar, cancelación, motivo obligatorio, doble clic,
  misma clave tras timeout y nueva revisión ante cambios de precio; validación de efectivo.
- Recorrido completo con frontend, NestJS y MongoDB locales: alta Test 1 ($180), alta
  Test 2 ($50), efectivo agrupado $230 y folio/historial. Chrome y WebKit a 320, 390,
  820 y 1440 px. No representa dinero recibido ni certificación de un iPhone físico.

Las bases de prueba son locales, temporales y con prefijo `ctq_billing_test_`; no se lee
`.env` de producción ni se ejecutan trabajadores contra Atlas. No se agregaron dependencias,
colecciones de dominio o variables de entorno. Las modificaciones previas de búsqueda,
estilos móviles y optimización de permisos permanecen separadas del alcance de esta etapa.

## Publicación y uso

Publicar backend y frontend compatibles con autorización, sin inicializar el club al arrancar.
Una vez disponibles, entrar en Usuarios → Pagos del socio → Habilitar mensualidades,
revisar inicio/tarifa y confirmar. Luego Registrar pago → elegir medio y cuotas completas.
Para efectivo, confirmar recepción y consultar el folio en Historial de pagos.

El piloto y la liberación general continúan en la etapa 3. Las confirmaciones de Mercado
Pago, pagos reales previos y registros bancarios no se migran ni se borran por este cambio.
