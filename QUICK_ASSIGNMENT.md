# Asignación rápida

El pasajero solicita una reserva, ve el precio y confirma en 20 segundos. El conductor queda bloqueado desde la reserva y recibe el viaje automáticamente al confirmar el pasajero. El modo negociación conserva su flujo de ofertas.

## Configuración y puesta en marcha

1. Configurar en el `.env` del backend `GOOGLE_MAPS_API_KEY` con acceso a Directions. La clave no se envía al cliente. Sin rutas disponibles se devuelve `ROUTING_UNAVAILABLE`; no se cobra una distancia inventada.
2. La migración maestra `00000000-initial-schema.js` ya incluye las columnas e índices de asignación rápida. En una base nueva, ejecutar `npm run migrate` desde `backend`.
3. Para probar con `conductor.prueba@linealila.test`, ejecutar `npm run seed:test-driver`. El registro de prueba incluye un taxi activo; en la aplicación, el conductor debe estar en servicio y enviar una ubicación reciente a menos de 3 km del origen.
4. Reiniciar el backend y recompilar/recargar la aplicación móvil. La reserva aparece automáticamente en una tarjeta modal del conductor; no entra en la lista de ofertas negociables.

Tarifa de recogida inicial, configurable en el backend:

```dotenv
QUICK_PICKUP_FEE_PER_KM=2
QUICK_PICKUP_FEE_MAX=4
```

El primer kilómetro por carretera está incluido. El suplemento es `min(tope, max(0, km_recogida - 1) × tarifa_por_km)`. La tarifa base del viaje se calcula en el servidor con las tarifas de zona y la ruta real, incluidas las paradas. No se aceptan precios, duración o distancia del cliente. El suplemento se agrega a `finalFare`, se incluye en el pago y queda fuera de la base de comisión del conductor. Los importes quedan fijos al confirmar. Esta versión no aplica cupones en asignación rápida.

## Disponibilidad y estados

- Radio geográfico máximo: 3.000 metros del punto de recogida; no es un límite a los kilómetros de carretera.
- Si no hay conductor en la primera consulta, el servidor vuelve a buscar cada 500 ms durante un máximo de 5 segundos. Responde en cuanto encuentra uno; al vencer el plazo devuelve `NO_DRIVERS`.
- Conductor aprobado, ubicación de menos de 60 segundos, conectado, vehículo activo compatible, sin viaje activo ni reserva. No se asigna al propio pasajero como conductor.
- `request_mode=quick_assignment`, `status=requested`, `driver_id` presente: reserva. `expires_at` es el vencimiento del servidor.
- Confirmación válida del pasajero: `accepted`; continúan `arrived`, `in_progress`, `completed`. No hay aceptación ni rechazo del conductor.
- Vencimiento: `expired`; cancelación de la reserva: `cancelled`. Un temporizador de servidor libera reservas, y las consultas también limpian vencimientos tras reinicios. El reloj del teléfono es solo visual.
- La confirmación verifica de nuevo ubicación, conexión, aprobación, vehículo y radio. Si falla, expira la reserva. No cambia el conductor ni aumenta el precio silenciosamente. No se reasignan automáticamente viajes ya confirmados.
- Índices únicos impiden que negociación o asignación rápida ocupen al mismo conductor/pasajero simultáneamente. Los bloqueos de filas serializan solicitudes del pasajero y selección de conductor. Las ofertas pendientes del conductor reservado expiran.

## API

Todas las rutas requieren autenticación:

- `POST /api/rides/quick/reserve`: origen, destino, paradas opcionales, `vehicleTypeRequested`, `paymentMethod`, `requestKey` estable por intento (16–100 caracteres alfanuméricos, guion o guion bajo).
- `GET /api/rides/quick/current?role=passenger|driver`: recuperación de la reserva o viaje rápido activo del usuario.
- `GET /api/rides/:rideId/quick`: estado y precio; solo participantes.
- `POST /api/rides/:rideId/quick/confirm`: solo pasajero dueño; idempotente. Revisar el estado devuelto: una respuesta puede contener una reserva expirada.
- `POST /api/rides/:rideId/quick/cancel`: libera solo una reserva pendiente; nunca deshace un viaje ya confirmado.

Las respuestas contienen `{ ride, serverTime }`. `ride:assignment` avisa a los canales personales del pasajero y conductor después del commit. La aplicación consulta REST como respaldo y recupera el viaje tras reconexión. El conductor actualiza su ubicación periódicamente mientras está disponible.

## Verificación

`npm run test:quick` ejecuta las pruebas de política y rutas. Para incluir PostgreSQL/PostGIS, en PowerShell:

```powershell
$env:RUN_QUICK_DB_TESTS='1'
npm run test:quick
```

Las pruebas de integración solo admiten un servidor local y crean una base temporal `linealila_quick_test_<timestamp>`, que eliminan al terminar. Requieren permisos para crear bases y PostGIS instalado. No migran la base de la aplicación. Las rutas externas se simulan en pruebas; validar la clave real y el recorrido completo con dos dispositivos antes de publicar.
