# Prototipo funcional · Sistema digital de registro y control de acceso

Prototipo de la Actividad 3 del curso Proyecto de Software (Corporación Universitaria Iberoamericana).
Continúa el documento de formulación de la Actividad 2.

**Integrantes:** Cesar Augusto Benavides León, Ángel David Salgado Otero y Dorance González Duque.

> Todos los datos del prototipo son ficticios. No se deben ingresar datos reales de residentes ni visitantes.

## Cómo usarlo

### Opción 1: en línea
Abra el enlace del prototipo publicado en GitHub Pages:
https://dorancegdg.github.io/Actividad-2---Documento-de-formulaci-n-del-proyecto/prototipo/

### Opción 2: descargado
1. En la página del repositorio, haga clic en **Code → Download ZIP**.
2. Descomprima el archivo.
3. Abra la carpeta `prototipo` y haga doble clic en `index.html`.
4. Se abre en el navegador (Chrome, Edge o Firefox actualizados). No necesita instalar nada ni tener internet.

## Usuarios de demostración
Cambie de usuario en el menú **Usuario** de la parte superior:

| Usuario | Rol | Puede |
|---|---|---|
| Guarda turno día | Vigilancia | Registrar entradas y salidas, ver alertas, usar la contingencia |
| Administración | Administración | Todo lo anterior, más historial, correcciones, reportes, residentes, indicadores y auditoría |
| Soporte técnico | Soporte | Configuración, prueba de rendimiento y prueba de restauración, sin ver datos personales |

## Qué se puede probar
- **Registro de ingreso:** busque a «Valentina» (pre-autorizada) o registre una persona nueva, elija el anfitrión y registre la decisión del residente.
- **Pendientes y excepciones:** una visita sin respuesta queda pendiente; el ingreso por excepción pide motivo y genera alerta.
- **Salida:** botón «Registrar salida» en Visitas activas; si no aparece la visita, se crea una incidencia.
- **Alertas:** visita sin autorización, ingreso repetido, permanencia mayor al umbral y más de 3 ingresos al día.
- **Sin internet:** botón «En línea» de la parte superior para simular la caída y luego restablecer y sincronizar.
- **Correcciones:** como Administración, en Historial, con motivo obligatorio e historial de cambios.
- **Reportes:** descarga en Excel (CSV) y en PDF (en la ventana de impresión, elija «Guardar como PDF»).
- **Permisos:** como Vigilancia, abra una opción con candado: se niega el acceso y queda en la auditoría.

Para volver a los datos iniciales: como Administración, **Configuración → Restablecer datos de demostración**.

## Tecnología
HTML5, CSS3 y JavaScript sin librerías externas. Los datos se guardan en el almacenamiento del navegador (`localStorage`).
En la versión final, la información irá a una base de datos MySQL en un servidor.

## Estructura
```
prototipo/
├── index.html   Estructura de la página
├── estilos.css  Diseño visual
├── app.js       Lógica: registro, autorización, alertas, reportes, permisos y contingencia
└── README.md    Este archivo
```
