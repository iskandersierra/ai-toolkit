---
title: Annotation V1 Change Proposal
description: Propuesta de cambios para la primera versión del flujo de anotaciones de AI Toolkit, consolidando decisiones de producto, alcance, impacto y criterios de aceptación para revisión de Project Management.
author: GitHub Copilot
ms.date: 2026-05-21
ms.topic: overview
keywords:
  - ai-toolkit
  - vscode extension
  - annotations
  - proposal
  - product review
estimated_reading_time: 8
---

## Resumen ejecutivo

Esta propuesta consolida los cambios acordados para la primera versión del flujo de anotaciones de AI Toolkit en Visual Studio Code. El objetivo es corregir fricciones detectadas durante la revisión manual, alinear el comportamiento del producto con expectativas reales de uso y reducir acciones que hoy generan ambigüedad, trabajo perdido o resultados inconsistentes.

Los cambios propuestos afectan cinco áreas principales: atajos de teclado, reglas de targeting y reanchor, persistencia del texto seleccionado, operaciones disponibles sobre anotaciones y comportamiento visual en el panel de comentarios. La propuesta mantiene el modelo general de la v1, pero ajusta decisiones operativas que hoy limitan la usabilidad del flujo.

## Contexto

La revisión manual del flujo actual confirmó varios desajustes entre la intención funcional y la experiencia real del usuario:

* La familia de atajos basada en `Ctrl+Alt+A` genera conflictos en teclados internacionales.
* La detección de anotaciones existentes no resuelve bien selecciones vacías, solapadas o parciales.
* El campo `selectedText` se persiste con una estrategia distinta a la del fingerprint contextual.
* El estado `resolved` existe en el modelo, pero no forma parte del flujo operativo principal.
* La validación de selecciones largas ocurre demasiado tarde, después de pedir el cuerpo de la anotación.
* El panel de comentarios no ofrece todavía una superficie coherente para operar sobre anotaciones existentes.

## Objetivos

* Eliminar fricción en la activación de comandos frecuentes.
* Hacer predecible la selección de la anotación objetivo en el editor.
* Mejorar la robustez del reanchor priorizando posición y contexto antes que coincidencia textual rígida.
* Tratar `resolved` como un estado operativo real, no solo como valor persistido.
* Unificar la experiencia entre editor, menú contextual y panel de comentarios.
* Detectar entradas inválidas antes de pedir información adicional al usuario.

## Decisiones aprobadas

### Cambios de atajos

* Se reemplaza la familia de atajos `Ctrl+Alt+A` por una familia equivalente basada en `Ctrl+Shift`.
* Se conserva la estructura de comandos existente para minimizar cambio cognitivo y esfuerzo de documentación.
* La propuesta de referencia es mantener el mismo patrón de chord actual, cambiando el modificador principal.

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

### Panel de comentarios

* El panel de comentarios debe seguir siendo una proyección derivada del store.
* La proyección debe permitir menú contextual sobre la anotación para ejecutar las mismas operaciones disponibles en el flujo `Add or Edit Annotation`.
* Los comentarios activos deben mostrarse con iconografía azul.
* Los comentarios resueltos deben mostrarse con iconografía gris.
* Las anotaciones con estado `dismissed` deben permanecer ocultas, como ya ocurre hoy.

### Validación temprana

* La validación del tamaño de selección debe ocurrir antes de pedir el cuerpo de la anotación.
* Si la selección excede el límite permitido, el flujo debe detenerse con un mensaje claro y sin abrir captura adicional.

## Alcance propuesto

### En alcance

* Actualización de contribuciones de comandos y keybindings en la extensión.
* Ajuste del algoritmo que resuelve la anotación objetivo a partir de la selección activa.
* Revisión del contrato de `AnnotationAnchor` y de la lógica de persistencia asociada.
* Revisión del algoritmo de reanchor y de sus criterios de prioridad.
* Incorporación de operaciones `Resolve` y `Reopen` en servicios, comandos y quick picks.
* Extensión del panel de comentarios con acciones contextuales equivalentes al flujo principal.
* Ajuste visual del estado de comentarios activos y resueltos.
* Reordenamiento del flujo de validación de selección en creación de anotaciones.
* Actualización de pruebas unitarias del comportamiento afectado.

### Fuera de alcance

* Cambios al formato base del store fuera de lo necesario para el nuevo tratamiento de `selectedText`.
* Clasificaciones adicionales de anotaciones más allá de `active`, `resolved` y `dismissed`.
* Nuevos canales de persistencia distintos del archivo local por workspace.
* Rediseño del flujo de draft output.
* Automatización de restauración de backups.

## Impacto esperado

### Impacto en experiencia de usuario

* Menor fricción en teclados internacionales.
* Menos ambigüedad al intentar actuar sobre anotaciones existentes.
* Menos fallos aparentes en reanchor iniciados desde una selección válida para el usuario.
* Reducción de trabajo perdido al validar longitud antes de pedir el cuerpo.
* Mayor coherencia entre editor y panel de comentarios.

### Impacto técnico

* Se requiere revisar el contrato de anchor en dominio, validación y matching.
* El algoritmo de reanchor cambia de una preferencia textual fuerte a una preferencia posicional con apoyo contextual.
* Se debe ampliar la superficie de comandos y menús para soportar `Resolve` y `Reopen`.
* Se debe revisar la proyección de comentarios para reflejar estado visual y acciones contextuales.

## Riesgos y mitigaciones

| Riesgo | Impacto | Mitigación propuesta |
| --- | --- | --- |
| La nueva estrategia de reanchor introduzca coincidencias ambiguas | Medio | Cubrir casos con pruebas de proximidad, solapamiento y cambios parciales de texto |
| El cambio de `selectedText` afecte compatibilidad con datos ya guardados | Medio | Tratar la transición como migración controlada o compatibilidad de lectura en runtime |
| La nueva superficie de acciones en comentarios genere diferencias con el editor | Medio | Reutilizar el mismo resolvedor de acciones y la misma lógica de permisos/contexto |
| El cambio de atajos no cubra todos los escenarios de teclado | Bajo | Validar el nuevo chord con layout internacional antes de cerrar la release |

## Propuesta de implementación por fases

### Fase 1

Actualizar keybindings, validación temprana y reglas de targeting. Esta fase resuelve la mayor parte de la fricción visible sin depender todavía del rediseño completo de reanchor.

### Fase 2

Actualizar el modelo de anchor, la persistencia de `selectedText` y la estrategia de reanchor. Esta fase concentra el cambio más sensible a nivel de dominio y matching.

### Fase 3

Incorporar `Resolve` y `Reopen`, junto con la extensión del panel de comentarios para operar sobre anotaciones existentes y reflejar estado visual.

## Criterios de aceptación

1. Los atajos principales dejan de depender de `Ctrl+Alt+A` y pasan a la nueva familia basada en `Ctrl+Shift`.
2. Una selección vacía sobre una anotación existente no permite crear una nueva anotación ni iniciar reanchor.
3. Una selección no vacía que se solapa con exactamente una anotación existente ofrece editar cuerpo, dismiss y reanchor.
4. Una selección no vacía que se solapa con más de una anotación existente bloquea la operación y muestra un aviso claro.
5. `selectedText` se persiste usando normalización por líneas y truncado de 200 caracteres por línea.
6. El reanchor prioriza proximidad a la posición original antes de evaluar ayudas textuales y contexto.
7. El usuario puede marcar una anotación como resuelta y reabrirla desde la misma superficie principal de operaciones.
8. El panel de comentarios permite acceder al mismo conjunto de acciones operativas definido para anotaciones existentes.
9. Las anotaciones activas se muestran con iconografía azul, las resueltas con iconografía gris y las dismiss siguen ocultas.
10. Si la selección excede el límite permitido, el sistema falla antes de pedir el cuerpo de la anotación.

## Dependencias de validación

La implementación deberá validarse con pruebas unitarias sobre targeting, commands, validation, projection y anchor matching. También se recomienda una verificación manual en Visual Studio Code con teclado internacional para confirmar la corrección del cambio de keybindings.

## Recomendación para Project Management

Se recomienda aprobar esta propuesta como ajuste de alcance de `Annotation V1`, no como una iniciativa separada. Los cambios no alteran la meta del release, pero sí corrigen decisiones operativas que hoy degradan la experiencia y aumentan el riesgo de rechazo durante validación de usuario.

La priorización sugerida es alta para validación temprana, targeting y keybindings, y media-alta para reanchor, operaciones de estado y acciones en comentarios. Este orden permite capturar valor visible rápidamente mientras dejamos el cambio estructural del anchor dentro de una fase controlada.
