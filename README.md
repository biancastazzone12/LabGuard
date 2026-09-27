# LABGUARD

Aplicación local de apoyo a la validación profesional de resultados de laboratorio.

LABGUARD no es un sistema diagnóstico, no sustituye al profesional, no toma decisiones clínicas autónomas y no libera resultados automáticamente. Los datos profesionales se cargan desde CSV o JSON y permanecen localmente en el navegador mediante `localStorage`.

## Arquitectura

El sistema se organiza en capas y contratos explícitos:

```text
React/TypeScript + Plotly (futuro)
							|
				FastAPI / Pydantic
							|
	Aplicación: casos, evaluación, revisión
							|
Dominio: datos -> reglas -> evidencia/alertas -> recomendación -> decisión profesional
							|
SQLAlchemy: SQLite (desarrollo) / PostgreSQL (futuro)
```

## Uso local-first

LABGUARD puede abrirse como una aplicación estática desde GitHub Pages. No requiere API keys, login, tokens ni un backend público. `PROFESSIONAL MODE` conserva los registros en el navegador, permite ingreso manual o importación CSV/JSON, edición, eliminación, validación local reproducible y exportación de un `Validation Report`. `CLEAR PROFESSIONAL DATA` elimina únicamente los datos profesionales; no modifica la Knowledge Base.

`DEMO MODE` está separado y contiene únicamente ejemplos sintéticos. Nunca se mezclan con los registros profesionales.

`CLINICAL PATTERN EXPLORER` utiliza exclusivamente registros profesionales guardados localmente. Permite filtrar por paciente y fechas, asignar grupos configurables, seleccionar analitos, revisar una línea temporal, comparar dos momentos con unidades idénticas y exportar un informe de observaciones. Las diferencias son descriptivas: no se usan umbrales para calificarlas como significativas, no se convierten unidades y no se infiere causalidad. Las revisiones profesionales se guardan localmente y se eliminan con `CLEAR PROFESSIONAL DATA`.

La validación local no hace `fetch()` ni envía datos durante una validación. Si no existe conocimiento suficiente, devuelve estados explícitos como `LOINC_MAPPING_REQUIRED`, `REFERENCE_INTERVAL_UNAVAILABLE`, `DELTA_CHECK_NOT_AVAILABLE` o `THRESHOLD_NOT_CONFIGURED`. No declara diagnósticos, normalidad clínica, aprobación regulatoria ni liberación automática de resultados.

## Knowledge Base

El manifiesto estático se empaqueta desde `frontend/public/knowledge/manifest.json` y registra dataset, versión, fuente, licencia, fecha y estado. UCUM está disponible localmente. LOINC, intervalos, QC, interferencias y reglas permanecen `NOT_INSTALLED` mientras no exista una release oficial o configuración profesional verificable. No se inventan códigos, intervalos ni thresholds.

Los datasets oficiales deben incorporarse manualmente, con su licencia, checksum y metadata de release. La aplicación no los consulta en Internet durante la validación. La Knowledge Base no contiene datos de pacientes.

## Validation Report y privacidad

El reporte JSON conserva `SYSTEM ANALYSIS`, cadena de evidencia, versiones de Knowledge Base y `PROFESSIONAL DECISION`, que empieza como `not_recorded` y solo puede ser completada por el profesional. Los datos quedan en `localStorage` del navegador y pueden perderse al limpiar el almacenamiento del sitio; exportar el reporte es responsabilidad del usuario.

## GitHub Pages y CI

El workflow `.github/workflows/ci.yml` ejecuta tests backend, tests frontend, build, validación de artefactos estáticos y despliegue de GitHub Pages. Para un repositorio de proyecto, el build usa `VITE_BASE_PATH=/LabGuard/`; para otro nombre de repositorio debe ajustarse esa variable en el workflow.

### Activar la publicación en GitHub

La primera vez, abrir `Settings > Pages` del repositorio, seleccionar `GitHub Actions` en `Build and deployment > Source` y guardar. Después, ejecutar nuevamente el workflow `LABGUARD CI` desde la pestaña `Actions`. El código y el artefacto ya están preparados; GitHub no permite crear el sitio automáticamente si Pages está desactivado.

Comprobaciones locales:

```bash
pytest -q
npm --prefix frontend test -- --run
npm --prefix frontend run build
```

El motor de evaluación es independiente de FastAPI y de la base de datos. Carga reglas YAML/JSON versionadas, recibe un contexto normalizado y devuelve un evento por cada regla, incluso cuando no se activa. Una regla puede producir evidencia y una alerta; una recomendación es una orientación no vinculante; la decisión profesional es siempre una acción humana registrada posteriormente.

## Módulos previstos

- `domain`: entidades y contratos de resultados, muestras, QC, reglas, evidencia, alertas y revisiones.
- `engine`: evaluación determinista de reglas y composición de evidencias.
- `application`: casos de uso y orquestación.
- `adapters`: entradas mediante archivos locales; las integraciones LIS/equipos son opcionales y no son necesarias para ejecutar la validación.
- `infrastructure`: persistencia, configuración y auditoría append-only.
- `frontend`: bandeja de revisión profesional, separando datos, señales y decisión.
- `rules`: YAML/JSON versionado, con parámetros dependientes de método, instrumento, fabricante o protocolo local.
- `engine`: loader, registry y evaluator declarativos, con evidencia por condición y resultado auditable.
- `qc`: cálculos internos, configuración de reglas QC y eventos `QC_ALERT`; preparado para políticas futuras.

El modelo incluye `discipline` para permitir química clínica, hematología, orina, coagulación, inmunología y endocrinología sin alterar el núcleo.

## Flujo de datos

1. Un profesional carga un archivo local y revisa su vista previa.
2. Se valida el esquema y se construye el contexto de muestra, resultados, QC e historial para delta checks.
3. El motor ejecuta las reglas aplicables y conserva la versión de cada regla.
4. Se generan evidencias explicables y, cuando corresponde, alertas y recomendaciones.
5. Un profesional revisa el caso y registra su decisión y comentario.
6. La auditoría registra actor, acción, fecha, caso, configuración y resultado resumido para reconstrucción posterior.

No se incorporan valores de referencia ni límites clínicos en el código. Los parámetros son configuración local y deben declararse junto con método, instrumento y versión del protocolo cuando aplique.

El módulo QC separa matemática, configuración y decisión del laboratorio. Calcula diferencia, z-score, SD index, CV y posición frente a límites configurados; no impone criterios universales.

El módulo Delta Check compara resultados del mismo paciente y analito con reglas configurables por porcentaje, diferencia absoluta, límites y ventana temporal. Si las unidades, métodos, instrumentos o intervalos de referencia no son comparables según la política, genera un `DELTA_EVENT` no disponible con el motivo explícito y no inventa equivalencias.

El `Analytical Consistency Engine` detecta inconsistencias matemáticas, analíticas o de calidad de datos mediante relaciones configurables entre analitos. Clasifica sus eventos como `DATA_ERROR`, `ANALYTICAL_REVIEW`, `SPECIMEN_REVIEW` o `CONFIGURATION_ERROR`, sin convertirlos en diagnósticos.

El `ValidationEngine` integra todas las etapas y genera un perfil con cadena de evidencia y auditoría. La recomendación del sistema permanece separada de `professional_decision`, que comienza sin registrar y solo puede completarse mediante revisión profesional.

## Estructura del repositorio

```text
backend/
	app/
		api/             # Rutas y contratos HTTP
		models/          # Modelos de dominio y transporte
		services/        # Casos de uso, sin lógica clínica aún
		validation/      # Orquestación futura de validación
		qc/              # Control de calidad interno
		delta_checks/    # Comparaciones históricas configurables
		interferences/   # Señales de posibles interferencias
		audit/           # Registro de trazabilidad
		config/          # Configuración del entorno
	tests/
frontend/
	src/
		dashboard/ samples/ results/ qc/ validation/ alerts/ configuration/
rules/
	chemistry/ hematology/ urinalysis/ general/
knowledge/
tests/
docs/
```

Las reglas viven fuera del código en `rules/`, están versionadas por Git y deben declarar sus parámetros locales. `knowledge/` queda reservado para documentación técnica controlada, no para valores clínicos implícitos. `tests/` contiene verificaciones transversales; los tests cercanos al backend pueden permanecer en `backend/tests/`.

SQLite se usa para desarrollo inicial y ya existe una migración Alembic base, manteniendo una interfaz compatible con PostgreSQL. La integración futura con LIS/equipamiento se hará mediante adaptadores idempotentes, con trazabilidad del origen y sin permitir que una fuente externa libere resultados.

## Ejecutar

```bash
python -m pip install -e '.[dev]'
uvicorn app.main:app --app-dir backend --reload
pytest

npm --prefix frontend install
npm --prefix frontend run dev
```

En terminales separadas, iniciar:

```bash
# Backend
uvicorn app.main:app --app-dir backend --host 0.0.0.0 --port 8000

# Frontend
npm --prefix frontend run dev -- --host 0.0.0.0 --port 5173
```

El frontend queda en `http://localhost:5173/`, la salud de la API en `http://localhost:8000/health` y la evaluación integrada en `POST http://localhost:8000/validation/evaluate`. En un contenedor o Codespace debe utilizarse el reenvío de esos puertos.

## Uso profesional

1. Abrir `http://localhost:5173/`.
2. Seleccionar un archivo CSV o JSON con los campos profesionales requeridos.
3. Revisar la vista previa y corregir los registros con errores críticos.
4. Importar los registros válidos, editarlos o eliminarlos desde el almacenamiento local.
5. Exportar una copia local cuando sea necesario. No se requiere API key, cuenta externa ni envío de resultados a servicios externos.