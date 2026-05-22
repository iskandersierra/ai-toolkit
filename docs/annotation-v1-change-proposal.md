---
title: Annotation V1 Change Proposal
description: Propuesta consolidada de cambios para Annotation V1, incluyendo límites de selección, resolución de sesiones, nombres por defecto y comandos de mantenimiento de sesiones.
author: GitHub Copilot
ms.date: 2026-05-22
ms.topic: overview
keywords:
  - ai-toolkit
  - annotations
  - proposal
  - review sessions
estimated_reading_time: 10
---

## Resumen ejecutivo

Esta propuesta consolida los cambios acordados para la primera versión del flujo de anotaciones de AI Toolkit en Visual Studio Code. El objetivo es corregir fricciones de captura, reducir decisiones innecesarias en el caso dominante de una sola sesión y separar con claridad las operaciones destructivas sobre sesiones.

Los cambios propuestos afectan siete áreas principales: atajos, targeting y reanchor, persistencia del texto seleccionado, límite de selección, resolución de sesiones antes de capturar anotaciones, nombres por defecto para sesiones y nuevos comandos de mantenimiento de sesiones. La propuesta mantiene el modelo general de la v1, pero ajusta decisiones operativas que hoy agregan fricción, ambigüedad o riesgo de pérdida accidental de trabajo.

## Contexto

La revisión manual del flujo actual confirmó varios desajustes entre la intención funcional y la experiencia real del usuario:

* La familia de atajos basada en `Ctrl+Alt+A` genera conflictos en teclados internacionales.
* La detección de anotaciones existentes no resuelve bien selecciones vacías, solapadas o parciales.
* El campo `selectedText` se persiste con una estrategia distinta a la del fingerprint contextual.
* El estado `resolved` existe en el modelo, pero no forma parte del flujo operativo principal.
* La validación de selecciones largas ocurre demasiado tarde, después de pedir el cuerpo de la anotación.
* La creación de la primera review session añade fricción innecesaria para el caso más común de un solo contexto de revisión.
* No existe todavía una distinción operacional clara entre borrar una sesión y vaciar sus anotaciones.
* El panel de comentarios no ofrece todavía una superficie coherente para operar sobre anotaciones existentes.

## Objetivos

* Eliminar fricción en la activación de comandos frecuentes.
* Hacer predecible la selección de la anotación objetivo en el editor.
* Reemplazar el límite de selección basado en caracteres por una regla visible y fácil de explicar.
* Mejorar la robustez del reanchor priorizando posición y contexto antes que coincidencia textual rígida.
* Tratar `resolved` como un estado operativo real, no solo como valor persistido.
* Garantizar que toda anotación nueva tenga una sesión destino resuelta antes de pedir cuerpo.
* Reducir al mínimo la fricción para el caso `0 -> 1` de creación de la primera review session.
* Separar con claridad las operaciones de vaciar una sesión y eliminar una sesión completa.
* Unificar la experiencia entre editor, menú contextual y panel de comentarios.
* Detectar entradas inválidas antes de pedir información adicional al usuario.

## Decisiones aprobadas

### Cambios de atajos

* Se reemplaza la familia de atajos `Ctrl+Alt+A` por una familia equivalente basada en `Ctrl+Shift`.
* Se conserva la estructura de comandos existente para minimizar cambio cognitivo y esfuerzo de documentación.
* La propuesta de referencia es mantener el mismo patrón de chord actual, cambiando el modificador principal.

### Límite de selección y validación temprana

* El límite de creación y reanchor deja de medirse por caracteres y pasa a medirse por líneas del editor.
* El nuevo límite permitido es de 50 líneas con contenido realmente seleccionado.
* Si la selección termina en la columna 0 de la línea siguiente, esa última línea no cuenta para el límite.
* La validación del límite debe ocurrir antes de pedir el cuerpo de la anotación.
* Si la selección excede el límite permitido, el flujo debe detenerse con un mensaje claro y sin abrir captura adicional.

### Reglas de targeting y selección

* Si la nueva selección está vacía y el cursor cae dentro de una anotación existente, no se debe ofrecer creación ni reanchor.
* En ese caso, solo deben ofrecerse operaciones sobre la anotación existente, específicamente edición del cuerpo y dismiss.
* Si la nueva selección no está vacía y se solapa con más de una anotación existente, el sistema debe informar el conflicto y no continuar.
* Si la nueva selección no está vacía y se solapa total o parcialmente con exactamente una anotación existente, el sistema debe tratar esa anotación como objetivo.
* En ese escenario se deben ofrecer las operaciones de editar cuerpo, dismiss y reanchor.

### Persistencia de `selectedText`

* `selectedText` deja de persistirse como captura literal completa.
* Se adopta la misma estrategia ya usada para líneas de contexto: normalización por líneas y truncado a un máximo de 200 caracteres por línea.
* El texto persistido pasa a ser una ayuda de relocalización, no la fuente primaria de identidad del ancla.
* La posición original, basada en línea y columna, pasa a ser la referencia principal del anchor.

### Estrategia de reanchor

* El reanchor debe priorizar primero la cercanía respecto de la posición original.
* Como criterio secundario debe usar el texto normalizado y el fingerprint contextual.
* La coincidencia textual exacta deja de ser el criterio dominante para decidir relocalización.

### Operaciones de estado

* `resolved` pasa a ser un estado operativo completo de la v1.
* Se incorporan las acciones `Resolve` y `Reopen`.
* Estas acciones se integran en la misma superficie principal donde hoy vive `Add or Edit Annotation`.

### Resolución de sesiones y nombres por defecto

* Ninguna anotación nueva debe pedir cuerpo antes de resolver una review session activa.
* Si el usuario inicia creación de anotación y no existe ninguna review session, la extensión debe crear automáticamente la primera sesión con el nombre por defecto `Review Session`, marcarla activa y continuar con la captura.
* Esa autocreación inicial debe mostrar un mensaje breve no modal indicando que la sesión fue creada y activada.
* Si existen sesiones pero no hay una activa, el flujo de creación debe abrir el session picker antes de pedir el cuerpo de la anotación.
* Si el usuario cancela ese picker, la creación completa de la anotación debe cancelarse sin pedir cuerpo.
* Las sesiones creadas automáticamente usan nombres por defecto secuenciales: `Review Session`, `Review Session 2`, `Review Session 3`, y así sucesivamente.
* La numeración por defecto no reutiliza huecos dejados por sesiones eliminadas.
* Cuando el usuario crea una sesión manualmente desde `AI Toolkit: Select Review Session`, el prompt de nombre se mantiene, pero debe venir prellenado con el siguiente nombre por defecto editable.
* Si el usuario ejecuta `AI Toolkit: Select Review Session` cuando no existe ninguna sesión, la extensión debe crear y activar automáticamente `Review Session`.

### Comandos de mantenimiento de sesiones

* Se agrega `AI Toolkit: Delete Review Session` como comando explícito de Command Palette, sin atajo de teclado.
* `AI Toolkit: Delete Review Session` abre un picker para elegir la sesión a eliminar.
* Ese picker debe mostrar el número de anotaciones por sesión, marcar la activa y ordenar por `updatedAt` descendente.
* El borrado de sesión elimina la review session completa junto con todas sus anotaciones.
* Si se elimina la sesión activa y quedan otras sesiones, debe activarse automáticamente la sesión restante con `updatedAt` más reciente.
* Si se elimina la sesión activa y no queda ninguna sesión, `activeSessionId` debe quedar en `null`.
* La confirmación de borrado debe ser modal e incluir nombre de sesión, número de anotaciones y aviso si la sesión era la activa.
* El mensaje de éxito debe indicar la sesión eliminada y, si cambió, cuál quedó activa.
* Si no hay sesiones para eliminar, el comando debe permanecer visible y responder con un mensaje informativo claro.

### Vaciado de anotaciones por sesión

* Se agrega `AI Toolkit: Clear Review Session Annotations` como comando explícito de Command Palette, sin atajo de teclado.
* Este comando es distinto de borrar una sesión: vacía todas las anotaciones de una review session, pero conserva la sesión.
* El comando abre un picker para elegir la sesión a vaciar.
* Ese picker debe mostrar el número de anotaciones, marcar la activa y seguir el mismo orden por `updatedAt` descendente.
* El vaciado elimina todas las anotaciones de la sesión elegida, sin distinguir entre `active`, `resolved` o `dismissed`.
* Si la sesión vaciada era la activa, debe seguir siendo la activa después del vaciado.
* La confirmación de vaciado debe ser modal e incluir nombre de sesión y número total de anotaciones.
* El mensaje de éxito debe indicar nombre de sesión y cantidad de anotaciones eliminadas.
* Si no hay sesiones para vaciar, el comando debe permanecer visible y responder con un mensaje informativo claro.

### Panel de comentarios

* El panel de comentarios debe seguir siendo una proyección derivada del store.
* La proyección debe permitir menú contextual sobre la anotación para ejecutar las mismas operaciones disponibles en el flujo `Add or Edit Annotation`.
* Los comentarios activos deben mostrarse con iconografía azul.
* Los comentarios resueltos deben mostrarse con iconografía gris.
* Las anotaciones con estado `dismissed` deben permanecer ocultas, como ya ocurre hoy.

## Alcance propuesto

### En alcance

* Actualización de contribuciones de comandos y keybindings en la extensión.
* Ajuste del algoritmo que resuelve la anotación objetivo a partir de la selección activa.
* Reemplazo del límite basado en caracteres por validación temprana de 50 líneas.
* Revisión del contrato de `AnnotationAnchor` y de la lógica de persistencia asociada.
* Revisión del algoritmo de reanchor y de sus criterios de prioridad.
* Incorporación de operaciones `Resolve` y `Reopen` en servicios, comandos y quick picks.
* Incorporación de la resolución de sesión previa a la captura y de la autocreación de la primera sesión.
* Incorporación de nombres por defecto secuenciales para nuevas review sessions.
* Incorporación de `Delete Review Session` con confirmación, picker y reasignación de sesión activa.
* Incorporación de `Clear Review Session Annotations` con confirmación y picker.
* Extensión del panel de comentarios con acciones contextuales equivalentes al flujo principal.
* Ajuste visual del estado de comentarios activos y resueltos.
* Actualización de pruebas unitarias del comportamiento afectado.

### Fuera de alcance

* Cambios al formato base del store fuera de lo necesario para el nuevo tratamiento de `selectedText`.
* Clasificaciones adicionales de anotaciones más allá de `active`, `resolved` y `dismissed`.
* Nuevos canales de persistencia distintos del archivo local por workspace.
* Renombrado de sesiones como flujo independiente en esta iteración.
* Rediseño del flujo de draft output.
* Automatización de restauración de backups.

## Impacto esperado

### Impacto en experiencia de usuario

* Menor fricción en teclados internacionales.
* Menos ambigüedad al intentar actuar sobre anotaciones existentes.
* Menor trabajo perdido al validar el rango antes de pedir cuerpo.
* Menor fricción para empezar a anotar cuando todavía no existe ninguna sesión.
* Mayor claridad entre reutilizar una sesión vacía y eliminar una sesión completa.
* Mejor trazabilidad del contexto activo después de operaciones destructivas.
* Menos fallos aparentes en reanchor iniciados desde una selección válida para el usuario.
* Mayor coherencia entre editor y panel de comentarios.

### Impacto técnico

* Se requiere revisar el contrato de anchor en dominio, validación y matching.
* El algoritmo de reanchor cambia de una preferencia textual fuerte a una preferencia posicional con apoyo contextual.
* Se debe ampliar la superficie de comandos y menús para soportar `Resolve` y `Reopen`.
* Se debe ampliar la lógica de sesión para soportar autocreación inicial, nombres por defecto, reasignación activa y operaciones destructivas por sesión.
* Se debe cubrir la nueva política de selección por líneas y su regla de borde para finales en columna 0.
* Se debe revisar la proyección de comentarios para reflejar estado visual y acciones contextuales.

## Riesgos y mitigaciones

| Riesgo | Impacto | Mitigación propuesta |
| --- | --- | --- |
| La nueva estrategia de reanchor introduzca coincidencias ambiguas | Medio | Cubrir casos con pruebas de proximidad, solapamiento y cambios parciales de texto |
| El cambio de `selectedText` afecte compatibilidad con datos ya guardados | Medio | Tratar la transición como migración controlada o compatibilidad de lectura en runtime |
| La validación por líneas introduzca errores de borde en selecciones que terminan en columna 0 | Medio | Cubrir con pruebas unitarias explícitas el conteo real de líneas seleccionadas |
| El borrado o vaciado de sesiones genere pérdida accidental de datos | Alto | Exigir confirmaciones modales claras con nombre y conteos antes de ejecutar la operación |
| La autocreación de la primera sesión genere confusión sobre el contexto activo | Bajo | Mostrar mensaje breve no modal y mantener el nombre por defecto predecible |
| La nueva superficie de acciones en comentarios genere diferencias con el editor | Medio | Reutilizar el mismo resolvedor de acciones y la misma lógica de permisos/contexto |
| El cambio de atajos no cubra todos los escenarios de teclado | Bajo | Validar el nuevo chord con layout internacional antes de cerrar la release |

## Propuesta de implementación por fases

### Fase 1

Actualizar keybindings, validación temprana de 50 líneas y reglas de targeting. Esta fase resuelve la mayor parte de la fricción visible sin depender todavía del rediseño completo de reanchor.

### Fase 2

Actualizar el modelo de anchor, la persistencia de `selectedText` y la estrategia de reanchor. Esta fase concentra el cambio más sensible a nivel de dominio y matching.

### Fase 3

Incorporar `Resolve` y `Reopen`, junto con la extensión del panel de comentarios para operar sobre anotaciones existentes y reflejar estado visual.

### Fase 4

Incorporar la resolución de sesiones antes de captura, la autocreación de la primera review session, los nombres por defecto y los comandos `Delete Review Session` y `Clear Review Session Annotations`.

## Criterios de aceptación

1. Los atajos principales dejan de depender de `Ctrl+Alt+A` y pasan a la nueva familia basada en `Ctrl+Shift`.
2. Una selección vacía sobre una anotación existente no permite crear una nueva anotación ni iniciar reanchor.
3. Una selección no vacía que se solapa con exactamente una anotación existente ofrece editar cuerpo, dismiss y reanchor.
4. Una selección no vacía que se solapa con más de una anotación existente bloquea la operación y muestra un aviso claro.
5. `selectedText` se persiste usando normalización por líneas y truncado de 200 caracteres por línea.
6. El límite de selección se valida por líneas y bloquea create o reanchor cuando la selección supera 50 líneas con contenido.
7. Una selección que termina en la columna 0 de la línea siguiente no cuenta esa última línea para el límite.
8. El reanchor prioriza proximidad a la posición original antes de evaluar ayudas textuales y contexto.
9. El usuario puede marcar una anotación como resuelta y reabrirla desde la misma superficie principal de operaciones.
10. Si el usuario inicia creación de anotación y no existe ninguna sesión, la extensión crea y activa `Review Session` automáticamente antes de pedir el cuerpo.
11. Si existen sesiones pero no hay una activa, la creación de anotación abre el session picker antes de pedir el cuerpo, y si el usuario lo cancela el flujo termina sin pedir cuerpo.
12. Las nuevas sesiones por defecto usan nombres secuenciales `Review Session`, `Review Session 2`, `Review Session 3`, sin reutilizar huecos numéricos.
13. `AI Toolkit: Delete Review Session` permite elegir una sesión, confirma con nombre y conteo, elimina la sesión con sus anotaciones y reasigna la sesión activa cuando corresponde.
14. `AI Toolkit: Clear Review Session Annotations` permite elegir una sesión, confirma con nombre y conteo, elimina todas sus anotaciones y conserva la sesión.
15. El panel de comentarios permite acceder al mismo conjunto de acciones operativas definido para anotaciones existentes.
16. Las anotaciones activas se muestran con iconografía azul, las resueltas con iconografía gris y las dismiss siguen ocultas.

## Dependencias de validación

La implementación deberá validarse con pruebas unitarias sobre targeting, commands, validation, projection, session selection y anchor matching. También se recomienda una verificación manual en Visual Studio Code con teclado internacional para confirmar la corrección del cambio de keybindings y una validación manual de los comandos destructivos por sesión.

## Recomendación para revisión

Se recomienda aprobar esta propuesta como ajuste de alcance de `Annotation V1`, no como una iniciativa separada. Los cambios no alteran la meta del release, pero sí corrigen decisiones operativas que hoy degradan la experiencia, agregan fricción innecesaria al caso principal de uso y dejan sin modelar operaciones destructivas que el usuario ya necesita distinguir.

La priorización sugerida es alta para validación temprana, resolución de sesiones y comandos de mantenimiento, y media-alta para reanchor, operaciones de estado y acciones en comentarios. Este orden permite capturar valor visible rápidamente, reducir fricción desde el primer uso y dejar el cambio estructural del anchor dentro de una fase controlada.
