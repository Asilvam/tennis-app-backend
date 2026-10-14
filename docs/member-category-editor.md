# Categorias de socios

## Flujo administrativo

La pantalla permite elegir una categoria principal (Primera, Segunda, Tercera,
Cuarta o ninguna) y marcar categorias adicionales. Todos los cambios permanecen
en un borrador hasta guardar. Cancelar o salir con cambios pide confirmacion.
Los puntos se ajustan mediante una accion separada, dentro del mismo guardado.

Cambiar o desactivar una categoria conserva sus puntos. Reactivarla recupera sus
puntos anteriores; una categoria nueva empieza en cero. No se transfieren puntos
entre categorias. Las categorias historicas desconocidas se conservan sin cambios.

## API

- `GET /player-category-points/:email/editor`: socio, categorias y revision.
- `PUT /player-category-points/:email/assignments`: `revision`,
  `activeCategories` y `pointAdjustments` (solo ajustes explicitos).
- Ambas rutas exigen JWT y rol admin. Las rutas antiguas de escritura tambien
  quedan protegidas y validan su cuerpo. Las lecturas publicas para perfiles y
  ranking conservan su contrato.
- El socio debe existir y estar activo para modificar sus categorias.
- El guardado usa una transaccion sobre `register` y `player_category_points`.
  Se incrementa el `__v` existente del socio para serializar escritores
  administrativos. No se agregan colecciones ni indices.
- La revision resume categorias, puntos y activacion. Si cambiaron desde la
  lectura, responde `409` y el front conserva el borrador hasta que el admin
  decida recargar. La transaccion evita resultados parciales.

## Despliegue

Coordinar front y backend. El front nuevo requiere las rutas editor/assignments.
El front antiguo no envia JWT en las escrituras y recibira `401` con el backend
nuevo. MongoDB debe admitir transacciones (replica set o cluster fragmentado).
No se ejecutan migraciones ni modificaciones automaticas de socios al iniciar.

El backend local comparte la base de produccion segun la configuracion revisada:
no usarla para pruebas automatizadas. Las pruebas de integracion solo aceptan una
URI localhost y una base cuyo nombre comience por `ctq_category_test_`.

## Pruebas

```sh
npm test -- --runInBand --runTestsByPath src/player-category-points/player-category-points.controller.spec.ts
CATEGORY_TEST_MONGO_URI='mongodb://127.0.0.1:55547/ctq_category_test_local?directConnection=true' npm test -- --runInBand --runTestsByPath src/player-category-points/player-category-points.integration.spec.ts
```

La segunda orden requiere un MongoDB aislado con replica set. La prueba elimina
exclusivamente su base de pruebas al terminar. No lee `.env`, envia correos ni usa
cuentas reales. En el front: `npm run test:category-editor`.
