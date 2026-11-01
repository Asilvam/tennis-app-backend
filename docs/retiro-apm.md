# Retiro de New Relic

Runtime posterior restaurado a Node22 por solicitud del usuario. El retiro del
agente permanece: [validacion actual en Node22](restauracion-node22-sin-apm.md).
Los resultados Node24 siguientes corresponden a la ejecucion historica inicial.

Fecha: 2026-11-01. Solicitud: retirar New Relic de ambos backends locales.

## Alcance implementado

- Eliminada la dependencia directa, su configuracion `newrelic.js` y el smoke
  remoto `scripts/newrelic-smoke-test.js`.
- Arranque Nest/Node sin precargas `-r newrelic` ni comando `newrelic:smoke`.
- Lockfile y node_modules depurados con `npm prune --ignore-scripts --no-audit --no-fund`.
  Este proyecto retiro 102 entradas del lockfile; no se agregaron entradas
  ni cambiaron versiones de las dependencias conservadas.
- No se requiere ninguna variable `NEW_RELIC_*`. El ejemplo de entorno no las
  declara. El backend original tampoco tenia estas claves en su .env local.
- En Node24 se retiro la exigencia de deshabilitar APM mediante entorno y los
  permisos de instalacion de sus dependencias. Los resguardos de base local,
  noticias y proveedores aislados permanecen.
- Prueba nueva `src/removed-apm.spec.ts`: cuatro casos que impiden reintroducir
  dependencia, precargas, archivos y variables de ejemplo del agente.

## Evidencia

Runtime: Node 24.22.2 y npm 11.19.1. Ambos builds finalizaron correctamente.
Este backend: **916 pruebas en 58 suites, cero fallos y cero omitidas**.
Se ejecutaron las siete suites de integracion (198 casos) con MongoDB temporal
`127.0.0.1:27375`, replica set `ctqNode24Lab`, y bases de prefijo de pruebas.
Nunca se arranco el AppModule original contra su .env compartido.

Node24 tambien paso lint y 16 comprobaciones HTTP con AppModule real, usuarios
sinteticos, base `ctq_node24_smoke` y proveedores locales. Incluye DI/Swagger,
login/JWT, roles, cuenta inactiva y bloqueo de reservas. No se enviaron correos,
no hubo pagos reales y no se modifico Atlas. MongoDB temporal se detuvo al terminar.

Resumen versionable: [validation.json](evidence/apm-removal/validation.json).
Salidas completas locales de esta ejecucion:
`/private/tmp/ctq-remove-newrelic-20261101/`, archivos
`original-tests.json`, `original-tests.log` y `original-prune.log`.
Para Node24: `lab-lint.log` y `lab-http-smoke.json`.
Estos temporales no sustituyen la evidencia versionable y pueden desaparecer.

## Reproduccion y operacion

Con el replica set temporal iniciado, configurar exclusivamente URIs locales:

```bash
export BILLING_TEST_MONGO_URI='mongodb://127.0.0.1:27375/ctq_billing_test_apm_original?replicaSet=ctqNode24Lab&directConnection=true'
export CATEGORY_TEST_MONGO_URI='mongodb://127.0.0.1:27375/ctq_category_test_apm_original?replicaSet=ctqNode24Lab&directConnection=true'
export RESULTS_TEST_MONGO_URI='mongodb://127.0.0.1:27375/ctq_results_test_apm_original?replicaSet=ctqNode24Lab&directConnection=true'
npm run build
npm test -- --runInBand
```

La eliminacion se aplica al proximo arranque: un proceso que ya cargo el agente
necesita reiniciarse. No se reiniciaron procesos originales, no se cambiaron
variables, add-ons ni despliegues de Heroku. No se creo un reemplazo de APM.
Los reportes y logs anteriores se conservan como historial; las referencias al
nombre del agente en documentacion y pruebas negativas no son instrumentacion.
