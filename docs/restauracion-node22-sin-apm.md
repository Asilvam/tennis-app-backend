# Runtime original y retiro de New Relic

Fecha: 2026-11-01. Solicitud: retirar de los proyectos originales los cambios
iniciados para Node24 y dejar New Relic eliminado, antes de continuar otras tareas.

## Cambios acotados

| Proyecto original | Selector restaurado desde HEAD | Engines |
| --- | --- | --- |
| tennis-app-backend | v22.19.0 | Node 22.19.0 / npm 10.9.3 |
| tennis-court-front | v22 | Node 22.x / npm 10.x, sin cambios |
| mercadopago-microservice | v22 | Originales, sin cambios |
| email-send-microservice | 22 | Originales, sin cambios |

Los cuatro .nvmrc coinciden byte por byte con sus versiones originales de Git.
Solo el backend tenia engines cambiados a 24; se restauraron a 22/10.
Se retiraron las instrucciones activas de Node24 de los README. El informe de
la prueba anterior se conserva como historico y no indica el runtime vigente.
Las copias *-Node24, el Node24 instalado y los alias globales no se modificaron.

Se deshizo la eliminacion staged del lockfile backend sin reemplazar su contenido
local: ahora Git lo reconoce como archivo modificado, no borrado. npm 10 sincronizo
solo el lockfile con engines 22/10 mediante --package-lock-only --ignore-scripts,
sin ejecutar scripts ni reinstalar dependencias. El lockfile local del frontend
se conserva; sus engines ya coincidian con los originales. No se aplicaron
upgrades de paquetes ni se reemplazaron las dependencias por las de las copias.

Para el commit solicitado despues se preparo el lockfile desde HEAD en un
directorio temporal, retirando solo la dependencia del agente. Se comprueba que
las versiones conservadas no cambian. Las diferencias adicionales de una
reinstalacion presentes en el lockfile de trabajo no se incluyen ni se borran.
Los README se incorporan por hunks para excluir los cambios de mensualidades.

En frontend se retiro la regla de ignore agregada durante las pruebas de Node24
y los dos caches tsbuildinfo generados. Las mejoras funcionales de mensualidades,
permisos, editor de socios y sus pruebas previas se conservan sin revertir.

## New Relic

El retiro ya implementado se conserva en el backend original:

- Sin dependencia newrelic, entradas del agente en lockfile o paquete instalado.
- Sin precargas en start, start:dev, start:debug y start:prod.
- Sin newrelic.js, script de smoke remoto o variables activas de ejemplo.
- Cuatro pruebas de regresion de removed-apm.spec.ts siguen aprobadas.

La documentacion, pruebas negativas y evidencias historicas pueden mencionar el
nombre del agente; no son instrumentacion activa. Heroku y sus variables no se
cambiaron. No se reiniciaron procesos existentes ni se iniciaron proveedores.

## Verificacion

Runtime de comprobacion: Node 22.19.0, npm 10.9.3.
Estos resultados corresponden al arbol local de trabajo completo; conservan
cambios funcionales pendientes que no forman parte de este commit acotado.

- Backend: 718 pruebas unitarias, 51 suites, cero fallos/omisiones.
- Frontend: 324 pruebas, cero fallos/omisiones.
- Compilacion de ambos proyectos aprobada. Frontend compilo con API ficticia
  y salida temporal, sin leer ni cambiar la configuracion real para el build.
- Las siete suites de integracion backend quedaron expresamente fuera de esta
  ejecucion; no se arranco MongoDB ni se presentan como revalidadas.
- Se corrigio solo el fixture de beforeunload: el Event basico de Node22 tiene
  returnValue de solo lectura, mientras BeforeUnloadEvent del navegador permite
  escribirlo. La prueba simula esa propiedad y verifica bloqueo/asignacion y
  recarga aprobada sin reasignacion. No cambia el hook de la aplicacion.
- git diff --check aprobado en frontend/backend.

Evidencia versionada: [validation.json](evidence/node22-restoration/validation.json),
hashes y resultados JSON de backend en el mismo directorio. Las salidas .log
completas de frontend/build permanecen locales e ignoradas por Git; sus resultados
se resumen en validation.json. El lockfile seleccionado para el commit y su
comparacion con HEAD se registran en commit-scope.json.

Para terminales que todavia tengan Node24 seleccionado:

```bash
nvm use
```

Ejecutarlo dentro de cada proyecto original. Los procesos existentes mantienen
su runtime hasta reiniciarse por decision del usuario. El commit posterior
solicitado registra solo este alcance; no incluye push, despliegue, cambios
del .env real, pagos ni envio de correos.
