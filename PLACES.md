# Búsqueda de destinos con Google Places

La pantalla de origen, destino y paradas, y el modal para agregar una parada, usan Autocomplete (New). Al elegir una sugerencia, Place Details (New) obtiene sus coordenadas antes de enviar el destino al mapa. Se conserva el área anterior de La Paz y los resultados en español, restringidos a Bolivia.

## Configuración

- Habilitar **Places API (New)** en el proyecto de Google Cloud con facturación activa y permitirla en las restricciones de API de la clave.
- Usar `GOOGLE_MAPS_API_KEY` en `backend/.env`, la misma variable que usa el cálculo de rutas.
- Reiniciar el backend y recargar la aplicación. **No hay migración de base de datos.**

La clave permanece en el backend. Las rutas `POST /api/places/autocomplete` y `POST /api/places/details` requieren autenticación. Las búsquedas esperan 400 ms desde la última edición, usan una sesión por búsqueda/selección y descartan respuestas antiguas. No se solicitan detalles para cada sugerencia, solo para el lugar elegido. Los resultados incluyen la atribución Google Maps y no se guardan listas de sugerencias en caché persistente.

Pruebas: `npm run test:places` desde `backend`; `npx jest __tests__/SearchBar.test.tsx --runInBand` desde la raíz. Las pruebas automatizadas simulan Google y no consumen consultas externas.

El geocodificado inverso al mover el marcador y el trazado de rutas existente mantienen sus proveedores; este cambio sustituye el buscador de destinos y paradas.

Con ubicación disponible, se ordenan las sugerencias devueltas por Google por `distanceMeters` (distancia en línea recta al usuario). No se hacen consultas de rutas ni de detalles adicionales para ordenarlas. Sin ubicación, se conserva el orden de Google. La lista separa el nombre antes de la primera coma de la dirección secundaria y oculta el sufijo «Bolivia».

La sesión mantiene el mismo token entre Autocomplete y Place Details y se renueva después de seleccionar o limpiar el campo. Con los campos Essentials utilizados, Google factura hasta 12 solicitudes de Autocomplete por sesión más Place Details; no equivale siempre a una única consulta cobrada. El debounce de 400 ms reduce llamadas mientras se escribe. Véase [tarifación por sesión](https://developers.google.com/maps/documentation/places/web-service/session-pricing).

Referencias: [Autocomplete (New)](https://developers.google.com/maps/documentation/places/web-service/place-autocomplete), [Place Details (New)](https://developers.google.com/maps/documentation/places/web-service/place-details).
