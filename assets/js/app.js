 // Variables globales
 var stylePozos = {
    radius: 8,
    fillColor: "#17202A",
    color: "#FDFEFE",
    weight: 1,
    opacity: 1,
    fillOpacity: 0.8
};

var geojson;
// A partir del zoom 15 (el mapa llega hasta 16) los pozos ya no se agrupan
// en clústeres, aunque estén cerca entre sí. Así, cuando el código hace zoom
// hacia un pozo seleccionado, casi siempre aparece visible de inmediato, sin
// pasar por la animación extra de "desenredar" el clúster (spiderfy).
var markers = L.markerClusterGroup({ disableClusteringAtZoom: 15 }); // Grupo de clústeres

var OpenStreetMap = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
     maxZoom: 20,
     attribution: '<a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors | Map data: © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors |  © <a href="https://sigagis.conagua.gob.mx/gas1">CONAGUA|SGT|GAS|SIGA</a>'
 });

// Agregar un par de mapas base al control de capas
// var baseMaps = {
//     "OpenStreetMap": L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
//         attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
//     }),
//     "CyclOSM": L.tileLayer('https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png', {
//         maxZoom: 12,
//         attribution: '<a href="https://github.com/cyclosm/cyclosm-cartocss-style/releases" title="CyclOSM - Open Bicycle render">CyclOSM</a> | Map data: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
//     })
// };

// Agregar los mapas base al mapa
// baseMaps["CyclOSM"].addTo(map);

var acuiferosLayer = L.geoJson(null, {
    onEachFeature: function(feature, layer) {
        // NOTA: acuiferos.geojson usa la propiedad "NOM_ACUI" (no "NOMBRE_ACU",
        // que es la propiedad del otro dataset, pozos_06_2026_.geojson). Con el
        // nombre equivocado el tooltip nacía vacío y, al no existir estilos para
        // la clase "acuifero-tooltip", Leaflet lo dibujaba con su apariencia por
        // defecto: una cajita blanca con borde negro (los "puntos blancos"
        // remanentes). Se usa "custom-tooltip", que sí tiene estilo definido.
        layer.bindTooltip(feature.properties.NOM_ACUI, { permanent: true, direction: 'center', className: 'custom-tooltip' });
    }
});

// Variable global del mapa (asegúrate de que esté declarada afuera)
var map; 

// Configuración de los límites de México
const mexicoBounds = L.latLngBounds(
    L.latLng(13.5, -119.0), // Esquina Suroeste
    L.latLng(33.5, -84.5)   // Esquina Noreste
);

// --- Utilidades para ocultar columnas de año sin datos ---

// Índice (0-based) donde inicia la columna del año 1996 dentro de la tabla.
// 0 Pozo, 1 Estado, 2 Acuífero, 3 Elev.Terr, 4 Latitud, 5 Longitud, 6..36 = 1996..2026
var YEAR_START_COLUMN = 6;
var YEARS = [];
for (var _y = 1996; _y <= 2026; _y++) { YEARS.push(_y); }

// Devuelve, para cada columna de año, si debe estar visible: solo si el
// año cae dentro del rango [yearStart, yearEnd] seleccionado en la barra
// de años, Y además hay al menos un pozo (dentro de "features") con un
// valor de profundidad registrado en ese año.
function getVisibleYearColumns(features, yearStart, yearEnd) {
    return YEARS.map(function(year, i) {
        var withinRange = year >= yearStart && year <= yearEnd;
        var hasData = false;

        if (withinRange) {
            var propKey = "PNE_" + year;
            hasData = features.some(function(feature) {
                var val = feature.properties[propKey];
                return val !== undefined && val !== null && val !== "";
            });
        }

        return { columnIndex: YEAR_START_COLUMN + i, visible: withinRange && hasData };
    });
}

// --- Utilidades para el filtro de años (barra deslizante) ---

// Años (inicio y fin) actualmente seleccionados en la barra deslizante.
// Por defecto cubren todo el rango de columnas de la tabla.
var selectedYearStart = YEARS[0];
var selectedYearEnd = YEARS[YEARS.length - 1];

// Devuelve los pozos que corresponden al Estado y Acuífero actualmente
// seleccionados, SIN aplicar todavía el filtro de años. Usa la misma
// lógica (incluida la excepción de "PENÍNSULA DE YUCATÁN") que ya usan
// updateWellsLayer() y buildTable(), y sirve como base para calcular qué
// años tienen datos disponibles para esa selección.
function getFeaturesByLocation() {
    if (!geojson || !geojson.features) {
        return [];
    }

    var selectedAquifer = $("#acuiferos").val();
    var selectedState = $("#estados").val();

    return geojson.features.filter(function(feature) {
        var aquiferMatch = selectedAquifer === "all" || feature.properties.NOMBRE_ACU === selectedAquifer;
        var stateMatch = selectedState === "all" || feature.properties.NOMBRE_EST === selectedState;

        if (selectedAquifer === "PENÍNSULA DE YUCATÁN") {
            var yucatanStates = ["Campeche", "Yucatán", "Quintana Roo"];
            return feature.properties.NOMBRE_ACU === "PENÍNSULA DE YUCATÁN" && yucatanStates.includes(feature.properties.NOMBRE_EST);
        }

        return aquiferMatch && stateMatch;
    });
}

// Devuelve, en orden, los años (dentro de YEARS) para los que al menos uno
// de los "features" recibidos tiene un valor de profundidad registrado.
function getAvailableYearsForFeatures(features) {
    return YEARS.filter(function(year) {
        var propKey = "PNE_" + year;
        return features.some(function(feature) {
            var val = feature.properties[propKey];
            return val !== undefined && val !== null && val !== "";
        });
    });
}

// True si "feature" tiene al menos un valor de profundidad registrado
// entre yearStart y yearEnd (inclusive).
function wellHasDataInYearRange(feature, yearStart, yearEnd) {
    for (var year = yearStart; year <= yearEnd; year++) {
        var val = feature.properties["PNE_" + year];
        if (val !== undefined && val !== null && val !== "") {
            return true;
        }
    }
    return false;
}

// Recalcula los límites (mín/máx) de la barra de años según el Estado y
// Acuífero actualmente seleccionados: revisa qué años tienen datos de
// profundidad para esos pozos y ajusta la barra a ese rango real,
// dejándola además con el rango completo seleccionado (de extremo a
// extremo). Se llama cada vez que cambia el Estado o el Acuífero.
function updateYearFilterBounds() {
    var locationFeatures = getFeaturesByLocation();
    var availableYears = getAvailableYearsForFeatures(locationFeatures);

    var minYear = availableYears.length > 0 ? availableYears[0] : YEARS[0];
    var maxYear = availableYears.length > 0 ? availableYears[availableYears.length - 1] : YEARS[YEARS.length - 1];

    selectedYearStart = minYear;
    selectedYearEnd = maxYear;

    $("#year-slider-min").attr({ min: minYear, max: maxYear }).val(minYear);
    $("#year-slider-max").attr({ min: minYear, max: maxYear }).val(maxYear);

    updateYearSliderUI();
}

// Repinta la barra de relleno y las etiquetas de años (inicio/fin) según
// los valores actuales de los dos controles deslizantes.
function updateYearSliderUI() {
    var minSlider = document.getElementById("year-slider-min");
    var maxSlider = document.getElementById("year-slider-max");
    if (!minSlider || !maxSlider) {
        return;
    }

    var min = parseInt(minSlider.min, 10);
    var max = parseInt(minSlider.max, 10);
    var valMin = parseInt(minSlider.value, 10);
    var valMax = parseInt(maxSlider.value, 10);
    var range = max - min;

    var leftPercent = range > 0 ? ((valMin - min) / range) * 100 : 0;
    var rightPercent = range > 0 ? ((valMax - min) / range) * 100 : 100;

    $("#year-range-fill").css({
        left: leftPercent + "%",
        width: (rightPercent - leftPercent) + "%"
    });

    $("#year-start-badge").text(valMin);
    $("#year-end-badge").text(valMax);
}

// Inicialización del mapa
function initializeMap() {
    console.log("Inicializando el mapa...");
    
    // Fusionamos las capas actuales con la configuración de límites y zoom
    map = L.map("map", {
        center: [23.4326, -102.1332], // Centrado en México (coordenadas de tu función)
        zoom: 5,
        minZoom: 5,
        maxZoom: 16,
        maxBounds: mexicoBounds,
        maxBoundsViscosity: 1.0,
        layers: [OpenStreetMap, acuiferosLayer, markers] // markers ÚLTIMO (adelante)
    });

    $.getJSON("assets/geojson/pozos_06_2026_.geojson", function(data) {
        console.log("Datos de pozos cargados:", data);
        geojson = data;
        
        // Agregar un ID único a cada feature si no lo tienen
        geojson.features.forEach(function(feature, index) {
            if (!feature.properties.id) {
                feature.properties.id = index; // Usar el índice como ID
            }
        });
        buildStatesDropdown();
        buildTable();
        $("#loading-mask").hide();
    }).fail(function() {
        console.error("Error al cargar pozos_06_2026_.geojson");
    });

    L.control.scale().addTo(map);
    L.control.layers({
        "CyclOSM": CyclOSM
    }, {
        "Pozos": markers, 
        "Acuíferos": acuiferosLayer
    }).addTo(map);
}

// Construir el dropdown de Estados
function buildStatesDropdown() {
    console.log("Construyendo dropdown de estados...");
    var states = [...new Set(geojson.features.map(feature => feature.properties.NOMBRE_EST))];
    var statesDropdown = $("#estados");
    statesDropdown.empty();
    statesDropdown.append('<option value=" ">Selecciona un Estado</option>');
    states.forEach(function(state) {
        statesDropdown.append('<option value="' + state + '">' + state + '</option>');
    });
}

// Construir el dropdown de Acuíferos
function buildAquifersDropdown() {
    console.log("Construyendo dropdown de acuíferos...");
    var selectedState = $("#estados").val();
    var aquifers = [...new Set(
        geojson.features
            .filter(feature => selectedState === "all" || feature.properties.NOMBRE_EST === selectedState)
            .map(feature => feature.properties.NOMBRE_ACU)
    )];
    var aquifersDropdown = $("#acuiferos");
    aquifersDropdown.empty();
    aquifersDropdown.append('<option value="all">Todos los Acuíferos</option>');
    aquifers.forEach(function(aquifer) {
        aquifersDropdown.append('<option value="' + aquifer + '">' + aquifer + '</option>');
    });
}

// Actualiza las tarjetas de "Estado:" y "Acuífero:" ubicadas arriba de la
// tabla, según lo que haya seleccionado el usuario en los dos dropdowns.
function updateSelectionCards() {
    var selectedState = $("#estados").val();
    var selectedAquifer = $("#acuiferos").val();

    var stateText = (selectedState && selectedState !== " " && selectedState !== "all")
        ? selectedState
        : "Todos los Estados";

    var aquiferText = "Todos los Acuíferos";
    if (selectedAquifer && selectedAquifer !== "all" && geojson && geojson.features) {
        var aquiferFeature = geojson.features.find(function(feature) {
            return feature.properties.NOMBRE_ACU === selectedAquifer;
        });
        var clave = aquiferFeature ? aquiferFeature.properties.CLAVE_ACUI : null;
        aquiferText = clave ? (clave + " - " + selectedAquifer) : selectedAquifer;
    }

    $("#estado-card-value").text(stateText);
    $("#acuifero-card-value").text(aquiferText);
}

// Actualiza el "Total de pozos:" de la tarjeta contando los pozos del
// Acuífero actualmente seleccionado. A propósito es una función aparte de
// updateSelectionCards(): solo se llama cuando cambia el Acuífero, no
// cuando cambia el Estado, para que este valor se mantenga fijo en ese caso.
function updateWellCountCard() {
    var selectedAquifer = $("#acuiferos").val();
    var count = 0;

    if (geojson && geojson.features) {
        if (!selectedAquifer || selectedAquifer === "all") {
            count = geojson.features.length;
        } else if (selectedAquifer === "PENÍNSULA DE YUCATÁN") {
            // Misma excepción que ya se usa en updateWellsLayer()/buildTable()
            // para este acuífero, que se reparte entre varios estados.
            var yucatanStates = ["Campeche", "Yucatán", "Quintana Roo"];
            count = geojson.features.filter(function(feature) {
                return feature.properties.NOMBRE_ACU === "PENÍNSULA DE YUCATÁN" &&
                    yucatanStates.includes(feature.properties.NOMBRE_EST);
            }).length;
        } else {
            count = geojson.features.filter(function(feature) {
                return feature.properties.NOMBRE_ACU === selectedAquifer;
            }).length;
        }
    }

    $("#total-pozos-card-value").text(count);
}

// Cargar y actualizar la capa de acuíferos
// function loadAcuiferosLayer() {
//     var selectedAquifer = $("#acuiferos").val();

//     acuiferosLayer.eachLayer(function(layer) {
//         layer.unbindTooltip();
//     });

//     $.getJSON("assets/geojson/acuiferos.geojson", function(data) {
//         console.log("Datos de acuíferos cargados:", data);

//         var filteredAcuiferos = data.features.filter(function(feature) {
//             return selectedAquifer === "all" || feature.properties.NOM_ACUI === selectedAquifer;
//         });

//         acuiferosLayer.clearLayers();
//         acuiferosLayer.addData({
//             type: "FeatureCollection",
//             features: filteredAcuiferos
//         });

//         acuiferosLayer.eachLayer(function(layer) {
//             layer.bindTooltip(layer.feature.properties.NOM_ACUI, { permanent: true, direction: 'center', className: 'custom-tooltip' });
//         });
//     }).fail(function() {
//         console.error("Error al cargar acuiferos.geojson");
//     });
// }

// acuiferosLayer.clearLayers();

// Cargar y actualizar la capa de acuíferos
// function loadAcuiferosLayer() {
//     var selectedAquifer = $("#acuiferos").val();
//     var selectedState = $("#estados").val(); // Obtener el estado seleccionado

//     acuiferosLayer.eachLayer(function(layer) {
//         layer.unbindTooltip();
//     });

//     $.getJSON("assets/geojson/acuiferos.geojson", function(data) {
//         console.log("Datos de acuíferos cargados:", data);

//         var filteredAcuiferos = data.features.filter(function(feature) {
//             var aquiferMatch = selectedAquifer === "all" || feature.properties.NOM_ACUI === selectedAquifer;
//             var stateMatch = !selectedState || selectedState === " " || feature.properties.NOM_EDO === selectedState; // Filtrar por estado

//             return aquiferMatch && stateMatch;
//         });

//         acuiferosLayer.clearLayers();
//         acuiferosLayer.addData({
//             type: "FeatureCollection",
//             features: filteredAcuiferos
//         });

//         acuiferosLayer.eachLayer(function(layer) {
//             layer.bindTooltip(layer.feature.properties.NOM_ACUI, { permanent: true, direction: 'center', className: 'custom-tooltip' });
//         });
//     }).fail(function() {
//         console.error("Error al cargar acuiferos.geojson");
//     });
// }

// Cargar y actualizar la capa de acuíferos
// Cada llamada a loadAcuiferosLayer() incrementa este contador y se queda
// con "su" número de turno. Si, mientras esa petición sigue en vuelo, se
// dispara OTRA llamada más reciente (por ejemplo: cambias de Estado y
// enseguida cambias de Acuífero), el contador avanza de nuevo. Cuando la
// petición vieja finalmente responde, compara su número de turno contra el
// contador actual: si ya no coinciden, significa que llegó tarde y que hay
// una petición más nueva en curso (o ya resuelta) — así que se descarta su
// resultado en vez de sobrescribir la capa con datos obsoletos.
var acuiferosRequestId = 0;

function loadAcuiferosLayer() {
    console.log("[DEBUG] loadAcuiferosLayer() se ejecutó");
    var selectedAquifer = $("#acuiferos").val();
    var selectedState = $("#estados").val(); // Obtener el estado seleccionado
    console.log("Estado seleccionado para filtrar acuíferos:", selectedState); // Para depuración

    acuiferosRequestId++;
    var thisRequestId = acuiferosRequestId;

    acuiferosLayer.eachLayer(function(layer) {
        layer.unbindTooltip();
    });

    $.getJSON("assets/geojson/acuiferos.geojson", function(data) {
        if (thisRequestId !== acuiferosRequestId) {
            // Llegó una petición más reciente antes que esta; se descarta
            // el resultado para no pintar acuíferos que ya no corresponden
            // a la selección actual.
            console.log("Respuesta de acuíferos descartada (obsoleta):", thisRequestId, "vs actual:", acuiferosRequestId);
            return;
        }

        console.log("Datos de acuíferos cargados:", data);

        var filteredAcuiferos = data.features.filter(function(feature) {
            var aquiferMatch = selectedAquifer === "all" || feature.properties.NOM_ACUI === selectedAquifer;
            var stateMatch = !selectedState || selectedState === " " || feature.properties.NOM_EDO.toUpperCase() === selectedState.toUpperCase();

            // Lógica específica para el acuífero "PENÍNSULA DE YUCATÁN"
            if (selectedAquifer === "PENÍNSULA DE YUCATÁN") {
                return feature.properties.NOM_ACUI === "PENÍNSULA DE YUCATÁN" &&
                       ["CAMPECHE", "YUCATÁN", "QUINTANA ROO"].includes(feature.properties.NOM_EDO.toUpperCase());
            }

            return aquiferMatch && stateMatch;
        });

        // Antes de dibujar los acuíferos de la selección actual, se borran
        // del DOM TODOS los tooltips de acuífero existentes (clase
        // "custom-tooltip", exclusiva de esta capa). No basta con
        // "acuiferosLayer.eachLayer(layer => layer.unbindTooltip())" porque
        // ese método solo alcanza las capas que Leaflet todavía tiene
        // registradas internamente; un tooltip que quedó "huérfano" (su capa
        // ya no está en el registro interno, pero su elemento visual sigue
        // en el HTML) nunca es tocado por ese método y se queda pegado para
        // siempre. Borrar directamente del DOM elimina cualquier huérfano,
        // sin importar cuántas peticiones se hayan disparado antes.
        document.querySelectorAll('.custom-tooltip').forEach(function(el) {
            el.remove();
        });

        acuiferosLayer.clearLayers();
        acuiferosLayer.addData({
            type: "FeatureCollection",
            features: filteredAcuiferos
        });

        acuiferosLayer.eachLayer(function(layer) {
            layer.bindTooltip(layer.feature.properties.NOM_ACUI, { permanent: true, direction: 'center', className: 'custom-tooltip' });
        });
        
        // SOLUCIÓN DEFINITIVA: Reorganizar el DOM después de cargar acuíferos
        // Esto asegura que los markers se redibuje DESPUÉS de los acuíferos visualmente
        setTimeout(function() {
            // Remover y re-agregar markers para que se redibuje después
            map.removeLayer(markers);
            map.addLayer(markers);
            console.log("[DOM REORDER] Markers redibujados después de acuíferos");
        }, 100);
    }).fail(function() {
        console.error("Error al cargar acuiferos.geojson");
    });
}

// Cargar y actualizar la capa de acuíferos
// function loadAcuiferosLayer() {
//     var selectedAquifer = $("#acuiferos").val();
//     var selectedState = $("#estados").val(); // Obtener el estado seleccionado
//     console.log("Estado seleccionado para filtrar acuíferos:", selectedState); // Para depuración

//     acuiferosLayer.eachLayer(function(layer) {
//         layer.unbindTooltip();
//     });

//     $.getJSON("assets/geojson/acuiferos.geojson", function(data) {
//         console.log("Datos de acuíferos cargados:", data);

//         var filteredAcuiferos = data.features.filter(function(feature) {
//             var aquiferMatch = selectedAquifer === "all" || feature.properties.NOM_ACUI === selectedAquifer;
//             var stateMatch = !selectedState || selectedState === " " || feature.properties.NOM_EDO.toUpperCase() === selectedState.toUpperCase();

//             // Lógica específica para el acuífero "PENÍNSULA DE YUCATÁN"
//             if (selectedAquifer === "PENÍNSULA DE YUCATÁN") {
//                 return feature.properties.NOM_ACUI === "PENÍNSULA DE YUCATÁN" &&
//                        ["CAMPECHE", "YUCATÁN", "QUINTANA ROO"].includes(feature.properties.NOM_EDO.toUpperCase());
//             }

//             return aquiferMatch && stateMatch;
//         });

//         acuiferosLayer.clearLayers();
//         acuiferosLayer.addData({
//             type: "FeatureCollection",
//             features: filteredAcuiferos
//         });

//         acuiferosLayer.eachLayer(function(layer) {
//             layer.bindTooltip(layer.feature.properties.NOM_ACUI, { permanent: true, direction: 'center', className: 'custom-tooltip' });
//         });
//     }).fail(function() {
//         console.error("Error al cargar acuiferos.geojson");
//     });
// }

// Actualizar los pozos en el mapa
// CAMBIO: ahora recibe yearStart y yearEnd como parámetros explícitos para garantizar
// sincronización 100% con buildTable() — evita que usen valores globales que podrían
// estar desincronizados.
function updateWellsLayer(yearStart, yearEnd) {
    var selectedAquifer = $("#acuiferos").val();
    var selectedState = $("#estados").val();
    
    // Usar los parámetros recibidos, no las variables globales
    if (yearStart === undefined) yearStart = selectedYearStart;
    if (yearEnd === undefined) yearEnd = selectedYearEnd;

    var filteredFeatures = geojson.features.filter(function(feature) {
        var aquiferMatch = selectedAquifer === "all" || feature.properties.NOMBRE_ACU === selectedAquifer;
        var stateMatch = selectedState === "all" || feature.properties.NOMBRE_EST === selectedState;
        var yearMatch = wellHasDataInYearRange(feature, yearStart, yearEnd);

        if (selectedAquifer === "PENÍNSULA DE YUCATÁN") {
            var yucatanStates = ["Campeche", "Yucatán", "Quintana Roo"];
            return feature.properties.NOMBRE_ACU === "PENÍNSULA DE YUCATÁN" && yucatanStates.includes(feature.properties.NOMBRE_EST) && yearMatch;
        }

        return aquiferMatch && stateMatch && yearMatch;
    });

    // El pozo resaltado (si lo hay) va a desaparecer junto con el resto de
    // los marcadores; quitamos también su radar para no dejarlo "huérfano".
    clearWellSelection();

    markers.clearLayers();

    filteredFeatures.forEach(function(feature) {
        var latlng = L.latLng(feature.geometry.coordinates[1], feature.geometry.coordinates[0]);
        var marker = L.circleMarker(latlng, stylePozos);
        // El clic en el pozo directamente sobre el mapa usa la misma
        // selección que el clic en la tabla (selectWellOnMap): así se
        // limpia siempre el resaltado/radar del pozo anterior antes de
        // mostrar el nuevo, y no queda ningún pozo "huérfano" marcado
        // en rojo cuando se elige otro distinto.
        marker.on('click', function(e) {
            L.DomEvent.stopPropagation(e);
            selectWellOnMap(feature);
        });
        marker.bindTooltip(feature.properties.NOMBRE_POZ, { permanent: true, direction: 'right', className: 'pozo-tooltip' });

        // Asignar el ID único al marcador
        marker.featureId = feature.properties.id;

        markers.addLayer(marker);
    });

    // CAMBIO: No agregamos markers de nuevo porque ya está en el mapa desde initializeMap()
    // map.addLayer(markers);  // ← REMOVIDO para evitar cambios de z-index

    if (filteredFeatures.length > 0) {
        var bounds = L.geoJson(filteredFeatures).getBounds();
        map.fitBounds(bounds);
    }
    acuiferosLayer.clearLayers();
    loadAcuiferosLayer();
}

// Actualizar los pozos en el mapa
// function updateWellsLayer() {
//     var selectedAquifer = $("#acuiferos").val();
//     var selectedState = $("#estados").val();

//     var filteredFeatures = geojson.features.filter(function(feature) {
//         var aquiferMatch = selectedAquifer === "all" || feature.properties.NOMBRE_ACU === selectedAquifer;
//         var stateMatch = selectedState === " " || selectedState === "all" || feature.properties.NOMBRE_EST === selectedState;

//         // Manejo específico para el acuífero "PENÍNSULA DE YUCATÁN"
//         if (selectedAquifer === "PENÍNSULA DE YUCATÁN") {
//             var yucatanStates = ["Campeche", "Yucatán", "Quintana Roo"];
//             return feature.properties.NOMBRE_ACU === "PENÍNSULA DE YUCATÁN" && yucatanStates.includes(feature.properties.NOMBRE_EST);
//         }

//         return aquiferMatch && stateMatch;
//     });

//     markers.clearLayers();

//     filteredFeatures.forEach(function(feature) {
//         var latlng = L.latLng(feature.geometry.coordinates[1], feature.geometry.coordinates[0]);
//         var marker = L.circleMarker(latlng, stylePozos);
//         marker.bindPopup(createPopupContent(feature));
//         marker.bindTooltip(feature.properties.NOMBRE_POZ, { permanent: true, direction: 'right', className: 'pozo-tooltip' });

//         // Asignar el ID único al marcador
//         marker.featureId = feature.properties.id;

//         markers.addLayer(marker);
//     });

//     map.addLayer(markers);

//     if (filteredFeatures.length > 0) {
//         var bounds = L.geoJson(filteredFeatures).getBounds();
//         map.fitBounds(bounds);
//     }
//     acuiferosLayer.clearLayers();
//     loadAcuiferosLayer();
// }
       // Construir la tabla de datos
    // CAMBIO: ahora recibe yearStart y yearEnd como parámetros explícitos para garantizar
    // sincronización 100% con updateWellsLayer() — evita que usen valores globales que podrían
    // estar desincronizados.
    function buildTable(yearStart, yearEnd) {
    if (!geojson || !geojson.features) {
        console.error("los datos del GeoJSON no se han cargado aún");
        return;
    }

    // Usar los parámetros recibidos, no las variables globales
    if (yearStart === undefined) yearStart = selectedYearStart;
    if (yearEnd === undefined) yearEnd = selectedYearEnd;

    var selectedAquifer = $("#acuiferos").val();
    var selectedState = $("#estados").val();
    var filteredFeatures = geojson.features.filter(function(feature) {
        var yearMatch = wellHasDataInYearRange(feature, yearStart, yearEnd);

        if (selectedAquifer === "PENÍNSULA DE YUCATÁN") {
            return ["Campeche", "Yucatán", "Quintana Roo"].includes(feature.properties.NOMBRE_EST) && feature.properties.NOMBRE_ACU === selectedAquifer && yearMatch;
        } else {
            return (selectedAquifer === "all" || feature.properties.NOMBRE_ACU === selectedAquifer) &&
                (selectedState === "all" || feature.properties.NOMBRE_EST === selectedState) &&
                yearMatch;
        }
    });

    console.log("[FILTRO AÑOS] Mapa: " + yearStart + "-" + yearEnd + " | Pozos filtrados en tabla: " + filteredFeatures.length);

    // Qué columnas de año deben mostrarse: solo las que caen dentro del
    // periodo elegido en la barra de años y que además tienen datos entre
    // los pozos filtrados actualmente.
    var visibleYearColumns = getVisibleYearColumns(filteredFeatures, yearStart, yearEnd);

    var tableData = filteredFeatures.map(function(feature) {
        return [
            feature.properties.NOMBRE_POZ,
            feature.properties.NOMBRE_EST,
            feature.properties.NOMBRE_ACU,
            feature.properties.ELEV_TN,
            feature.properties.LATITUD,
            feature.properties.LONGITUD,
            feature.properties.PNE_1996,
            feature.properties.PNE_1997,
            feature.properties.PNE_1998,
            feature.properties.PNE_1999,
            feature.properties.PNE_2000,
            feature.properties.PNE_2001,
            feature.properties.PNE_2002,
            feature.properties.PNE_2003,
            feature.properties.PNE_2004,
            feature.properties.PNE_2005,
            feature.properties.PNE_2006,
            feature.properties.PNE_2007,
            feature.properties.PNE_2008,
            feature.properties.PNE_2009,
            feature.properties.PNE_2010,
            feature.properties.PNE_2011,
            feature.properties.PNE_2012,
            feature.properties.PNE_2013,
            feature.properties.PNE_2014,
            feature.properties.PNE_2015,
            feature.properties.PNE_2016,
            feature.properties.PNE_2017,
            feature.properties.PNE_2018,
            feature.properties.PNE_2019,
            feature.properties.PNE_2020,
            feature.properties.PNE_2021,
            feature.properties.PNE_2022,
            feature.properties.PNE_2023,
            feature.properties.PNE_2024,
            feature.properties.PNE_2025,
            feature.properties.PNE_2026,
          
            feature // Almacenar el feature original
        ];
    });

    if ($.fn.DataTable.isDataTable('#data-table')) {
        var table = $("#data-table").DataTable();
        table.clear().rows.add(tableData);

        // Mostrar/ocultar cada columna de año. El "false" evita que
        // DataTables redibuje después de cada columna; lo hacemos una
        // sola vez al final con columns.adjust().draw().
        visibleYearColumns.forEach(function(col) {
            table.column(col.columnIndex).visible(col.visible, false);
        });
        table.columns.adjust().draw();
    } else {
        $("#data-table").DataTable({
            data: tableData,
            columnDefs: visibleYearColumns.map(function(col) {
                return { targets: col.columnIndex, visible: col.visible };
            }).concat([
                // Estado (índice 1) y Acuífero (índice 2) se mantienen en los
                // datos (siguen usándose en los filtros y en la exportación),
                // solo se ocultan visualmente en la tabla.
                { targets: 1, visible: false },
                { targets: 2, visible: false }
            ]),
            columns: [
                { title: "Pozo" },
                { title: "Estado" },
                { title: "Acuífero" },
                { title: "Elev.Terr" },
                { title: "Latitud" },
                { title: "Longitud" },
                { title: "1996" },
                { title: "1997" },
                { title: "1998" },
                { title: "1999" },
                { title: "2000" },
                { title: "2001" },
                { title: "2002" },
                { title: "2003" },
                { title: "2004" },
                { title: "2005" },
                { title: "2006" },
                { title: "2007" },
                { title: "2008" },
                { title: "2009" },
                { title: "2010" },
                { title: "2011" },
                { title: "2012" },
                { title: "2013" },
                { title: "2014" },
                { title: "2015" },
                { title: "2016" },
                { title: "2017" },
                { title: "2018" },
                { title: "2019" },
                { title: "2020" },
                { title: "2021" },
                { title: "2022" },
                { title: "2023" },
                { title: "2024" },
                { title: "2025" },
                { title: "2026" }
            ],
                   
                    dom: '<"top"lBf>rt<"bottom"ip><"clear">',
                    buttons: [
                        // Por defecto, los botones solo exportan las columnas
                        // visibles. Como Estado y Acuífero (índices 1 y 2)
                        // ahora se ocultan solo visualmente, se agregan aquí
                        // de forma explícita para que sigan apareciendo en
                        // el CSV/Excel exportado.
                        { extend: 'csvHtml5', exportOptions: { columns: ':visible, 1, 2' } },
                        { extend: 'excelHtml5', exportOptions: { columns: ':visible, 1, 2' } }
                    ],
                    lengthMenu: [[10, 25, 50, -1], [10, 25, 50, "Todos"]],
                    pageLength: 10,
                    language: {
                        "sProcessing":     "Procesando...",
                        "sLengthMenu":     "Mostrar _MENU_ registros",
                        "sZeroRecords":    "No se encontraron resultados",
                        "sEmptyTable":     "Ningún dato disponible en esta tabla",
                        "sInfo":           "Mostrando registros del _START_ al _END_ de un total de _TOTAL_ registros",
                        "sInfoEmpty":      "Mostrando registros del 0 al 0 de un total de 0 registros",
                        "sInfoFiltered":   "(filtrado de un total de _MAX_ registros)",
                        "sInfoPostFix":    "",
                        "sSearch":         "Buscar:",
                        "sUrl":            "",
                        "sInfoThousands":  ",",
                        "sLoadingRecords": "Cargando...",
                        "oPaginate": {
                            "sFirst":    "Primero",
                            "sLast":     "Último",
                            "sNext":     "Siguiente",
                            "sPrevious": "Anterior"
                        },
                        "oAria": {
                            "sSortAscending":  ": Activar para ordenar la columna de manera ascendente",
                            "sSortDescending": ": Activar para ordenar la columna de manera descendente"
                        },
                        "buttons": {
                            "csv": "Exportar CSV",
                            "excel": "Exportar Excel"
                        }
                    }
                });
            }
}

// --- Resaltado del pozo seleccionado en la tabla ---

// Estilo del pozo actualmente seleccionado (contraste respecto a stylePozos)
var selectedStylePozo = {
    radius: 11,
    fillColor: "#611232",
    color: "#a57f2c",
    weight: 3,
    opacity: 1,
    fillOpacity: 1
};

var highlightMarker = null; // circleMarker independiente que representa al pozo seleccionado
var radarMarker = null;     // marcador con la animación tipo radar

// Icono divIcon con el anillo animado (definido en el CSS: .radar-pulse-icon)
var radarIcon = L.divIcon({
    className: 'radar-divicon',
    html: '<div class="radar-pulse-icon"><div class="radar-ring"></div><div class="radar-dot"></div></div>',
    iconSize: [22, 22],
    iconAnchor: [11, 11]
});

// Quita el resaltado y el radar del pozo previamente seleccionado
function clearWellSelection() {
    if (highlightMarker) {
        map.removeLayer(highlightMarker);
        highlightMarker = null;
    }
    if (radarMarker) {
        map.removeLayer(radarMarker);
        radarMarker = null;
    }
}

// Resalta en el mapa el pozo correspondiente a "feature" (llamado al hacer clic en una fila)
//
// En vez de intentar controlar el circleMarker que administra el plugin de
// clústeres (Leaflet.markercluster), aquí se agrega un marcador NUEVO e
// independiente directo al mapa, en las mismas coordenadas. El plugin de
// clústeres decide por su cuenta, con lógica interna compleja según el
// zoom, cuándo un marcador está "realmente" en el mapa — y en ciertos casos
// (sobre todo con muchos pozos muy juntos, como en Baja California) esa
// lógica nunca termina de soltarlo. Un marcador propio, fuera de ese
// sistema, se muestra siempre al instante, sin depender de nada de eso.
function selectWellOnMap(feature) {
    var latlng = L.latLng(feature.geometry.coordinates[1], feature.geometry.coordinates[0]);

    clearWellSelection();

    // Centramos el mapa en el pozo con un zoom cómodo para verlo en contexto
    map.setView(latlng, Math.max(map.getZoom(), 13));

    highlightMarker = L.circleMarker(latlng, selectedStylePozo)
        .addTo(map)
        .bindPopup(createPopupContent(feature))
        .openPopup();

    // Limpiar la selección cuando se cierra el popup (X o ESC)
    highlightMarker.on('popupclose', function() {
        clearWellSelection();
    });

    // Evitar que los clicks en el highlightMarker disparen el evento click del mapa
    highlightMarker.on('click', function(e) {
        L.DomEvent.stopPropagation(e);
    });

    radarMarker = L.marker(latlng, {
        icon: radarIcon,
        interactive: false,
        zIndexOffset: 1000
    }).addTo(map);
}

        var attributeNames = {
            "CLAVE_ACUI": "Clave",
            "ELEV_TN": "Elev.Terr",
            "NOMBRE_POZ": "Pozo",
            "NOMBRE_EST": "Estado",
            "NOMBRE_ACU": "Acuífero",
            "CLAVE_ESTA": "Clave Entidad",
            "LATITUD": "Latitud",
            "LONGITUD": "Longitud",
            "PNE_1996": "1996",
            "PNE_1997": "1997",
            "PNE_1998": "1998",
            "PNE_1999": "1999",
            "PNE_2000": "2000",
            "PNE_2001": "2001",
            "PNE_2002": "2002",
            "PNE_2003": "2003",
            "PNE_2004": "2004",
            "PNE_2005": "2005",
            "PNE_2006": "2006",
            "PNE_2007": "2007",
            "PNE_2008": "2008",
            "PNE_2009": "2009",
            "PNE_2010": "2010",
            "PNE_2011": "2011",
            "PNE_2012": "2012",
            "PNE_2013": "2013",
            "PNE_2014": "2014",
            "PNE_2015": "2015",
            "PNE_2016": "2016",
            "PNE_2017": "2017",
            "PNE_2018": "2018",
            "PNE_2019": "2019",
            "PNE_2020": "2020",
            "PNE_2021": "2021",
            "PNE_2022": "2022",
            "PNE_2023": "2023",
            "PNE_2024": "2024",
            "PNE_2024": "2024",
            "PNE_2025": "2025",
            "PNE_2026": "2026"
        };

        function createPopupContent(feature) {
            var content = '<table style="width:100%; border-collapse: collapse;">';
            var rowCount = 0;
            var displayedKeys = ['NOMBRE_POZ', 'CLAVE_ESTA', 'NOMBRE_EST', 'NOMBRE_ACU'];
        
            // Fila para el nombre del pozo
            content += '<tr style="background-color: ' + (rowCount % 2 === 0 ? 'rgb(221,201,163)' : '#ffffff') + ';">';
            content += '<th>Pozo:</th><td>' + feature.properties.NOMBRE_POZ + '</td></tr>';
            rowCount++;
        
            // Fila para la clave de entidad
            content += '<tr style="background-color: ' + (rowCount % 2 === 0 ? 'rgb(221,201,163)' : '#ffffff') + ';">';
            content += '<th>Clave Entidad:</th><td>' + feature.properties.CLAVE_ESTA + '</td></tr>';
            rowCount++;
        
            // Fila para el estado
            content += '<tr style="background-color: ' + (rowCount % 2 === 0 ? 'rgb(221,201,163)' : '#ffffff') + ';">';
            content += '<th>Estado:</th><td>' + feature.properties.NOMBRE_EST + '</td></tr>';
            rowCount++;
        
            // Fila para el acuífero
            content += '<tr style="background-color: ' + (rowCount % 2 === 0 ? 'rgb(221,201,163)' : '#ffffff') + ';">';
            content += '<th>Acuífero:</th><td>' + feature.properties.NOMBRE_ACU + '</td></tr>';
            rowCount++;
        
            // Filas para las propiedades restantes
            Object.keys(feature.properties).forEach(function(key) {
                if (feature.properties[key] && !displayedKeys.includes(key) && key !== 'id') {
                    var displayName = attributeNames[key] || key;
                    content += '<tr style="background-color: ' + (rowCount % 2 === 0 ? 'rgb(221,201,163)' : '#ffffff') + ';">';
                    content += '<th>' + displayName + ':</th><td>' + feature.properties[key] + '</td></tr>';
                    rowCount++;
                }
            });
        
            content += '</table>';
            return content;
        }

        // function createPopupContent(feature) {
        //     var content = '<b>Pozo: ' + feature.properties.NOMBRE_POZ + '</b><br>';
        //     content += 'Clave Entidad: ' + feature.properties.CLAVE_ESTA + '<br>';
        //     content += 'Estado: ' + feature.properties.NOMBRE_EST + '<br>';
        //     content += 'Acuífero: ' + feature.properties.NOMBRE_ACU + '<br>';
        //     var displayedKeys = ['NOMBRE_POZ', 'CLAVE_ESTA', 'NOMBRE_EST', 'NOMBRE_ACU'];
        //     Object.keys(feature.properties).forEach(function(key) {
        //         if (feature.properties[key] && !displayedKeys.includes(key) && key !== 'id') {
        //             var displayName = attributeNames[key] || key;
        //             content += displayName + ': ' + feature.properties[key] + '<br>';
        //         }
        //     });
        //     return content;
        // }

        // function createPopupContent(feature) {
        //     var content = '<b>Pozo: ' + feature.properties.NOMBRE_POZ + '</b><br>';
        //     content += 'Clave Entidad: ' + feature.properties.CLAVE_ESTA + '<br>';
        //     content += 'Estado: ' + feature.properties.NOMBRE_EST + '<br>';
        //     content += 'Acuífero: ' + feature.properties.NOMBRE_ACU + '<br>';
        //     var displayedKeys = ['NOMBRE_POZ', 'CLAVE_ESTA', 'NOMBRE_EST', 'NOMBRE_ACU'];
        //     Object.keys(feature.properties).forEach(function(key) {
        //         if (feature.properties[key] && !displayedKeys.includes(key)) {
        //             var displayName = attributeNames[key] || key;
        //             content += displayName + ': ' + feature.properties[key] + '<br>';
        //         }
        //     });
        //     return content;
        // }

        // function createPopupContent(feature) {
        //     var content = '<b>Pozo: ' + feature.properties.NOMBRE_POZ + '</b><br>';
        //     content += 'Estado: ' + feature.properties.NOMBRE_EST + '<br>';
        //     content += 'Acuífero: ' + feature.properties.NOMBRE_ACU + '<br>';
        //     Object.keys(feature.properties).forEach(function(key) {
        //         if (feature.properties[key] && key !== 'NOMBRE_POZ' && key !== 'NOMBRE_EST' && key !== 'NOMBRE_ACU') {
        //             var displayName = attributeNames[key] || key;
        //             content += displayName + ': ' + feature.properties[key] + '<br>';
        //         }
        //     });
        //     return content;
        // }

        // $("#estados").change(function() {
        //     console.log("Estado seleccionado:", $("#estados").val());
        //     buildAquifersDropdown();
        //     updateWellsLayer();
        //     buildTable();
        // });

        $("#estados").change(function() {
            console.log("Estado seleccionado:", $("#estados").val());
            buildAquifersDropdown();
            updateYearFilterBounds(); // Ajusta la barra de años a los datos del nuevo Estado
            // updateWellsLayer() ya llama a loadAcuiferosLayer() internamente al
            // final; llamarla aquí también duplicaba la petición $.getJSON a
            // acuiferos.geojson en cada cambio de Estado.
            // CAMBIO: pasar los años explícitamente (ahora contienen el rango correcto del nuevo Estado)
            updateWellsLayer(selectedYearStart, selectedYearEnd);
            buildTable(selectedYearStart, selectedYearEnd);
            updateSelectionCards();
        });

        $("#acuiferos").change(function() {
            console.log("Acuífero seleccionado:", $("#acuiferos").val());
            updateYearFilterBounds(); // Ajusta la barra de años a los datos del nuevo Acuífero
            // CAMBIO: pasar los años explícitamente (ahora contienen el rango correcto del nuevo Acuífero)
            updateWellsLayer(selectedYearStart, selectedYearEnd);
            buildTable(selectedYearStart, selectedYearEnd);
            updateSelectionCards();
            updateWellCountCard();
        });

        $(document).ready(function() {
            initializeMap();
            
            // Limpiar la selección del pozo cuando se hace click en cualquier parte del mapa (fuera del pozo)
            map.on('click', function(e) {
                // Solo limpiar si hay un pozo seleccionado actualmente
                if (highlightMarker) {
                    clearWellSelection();
                }
            });
            
            $.getJSON("assets/geojson/pozos_06_2026_.geojson", function(data) {
                geojson = data;
                // CAMBIO: pasar explícitamente los años iniciales
                buildTable(selectedYearStart, selectedYearEnd);
                updateWellCountCard(); // Valor inicial: total de pozos con "Todos los Acuíferos"
                updateYearFilterBounds(); // Valor inicial: rango completo de años con datos
            });

            // Delegado desde "document" (en vez de "#data-table tbody" dentro
            // de buildTable): así se registra UNA sola vez sin importar
            // cuántas veces se reconstruya la tabla al cambiar de filtro.
            // El .off() previo es una medida de seguridad por si este bloque
            // llegara a ejecutarse más de una vez.
            $(document).off('click', '#data-table tbody tr');
            $(document).on('click', '#data-table tbody tr', function() {
                var data = $("#data-table").DataTable().row(this).data();
                var feature = data[data.length - 1]; // Obtener el feature

                if (feature) {
                    scrollToMap();
                    selectWellOnMap(feature);
                }
            });

            // Filtro de años: al arrastrar cualquiera de los dos controles,
            // se evita que se crucen entre sí, se refresca la barra visual
            // y se vuelven a filtrar el mapa y la tabla con el nuevo rango.
            // CAMBIO: Ahora se pasan los valores explícitamente a updateWellsLayer() y buildTable()
            // para garantizar sincronización 100% (evita que una función vea valores desincronizados
            // si hay cambios simultáneos en las variables globales).
            $("#year-slider-min").on("input", function() {
                var minVal = parseInt(this.value, 10);
                var maxVal = parseInt($("#year-slider-max").val(), 10);

                if (minVal > maxVal) {
                    minVal = maxVal;
                    this.value = minVal;
                }

                selectedYearStart = minVal;
                selectedYearEnd = maxVal;

                updateYearSliderUI();
                // CAMBIO CRÍTICO: pasar los valores exactos a ambas funciones en el mismo instante
                updateWellsLayer(minVal, maxVal);
                buildTable(minVal, maxVal);
            });

            $("#year-slider-max").on("input", function() {
                var maxVal = parseInt(this.value, 10);
                var minVal = parseInt($("#year-slider-min").val(), 10);

                if (maxVal < minVal) {
                    maxVal = minVal;
                    this.value = maxVal;
                }

                selectedYearStart = minVal;
                selectedYearEnd = maxVal;

                updateYearSliderUI();
                // CAMBIO CRÍTICO: pasar los valores exactos a ambas funciones en el mismo instante
                updateWellsLayer(minVal, maxVal);
                buildTable(minVal, maxVal);
            });
        });

// Desplaza la página (scroll vertical) para que el mapa quede visible,
// sin quedar tapado detrás de la barra de navegación fija superior.
function scrollToMap() {
    var mapEl = document.getElementById("map");
    if (!mapEl) {
        return;
    }

    var navEl = document.querySelector(".navbar-fixed-top");
    var navHeight = navEl ? navEl.getBoundingClientRect().height : 0;
    var margen = 15; // pequeño espacio extra para que no quede pegado al borde

    var destino = mapEl.getBoundingClientRect().top + window.pageYOffset - navHeight - margen;

    window.scrollTo({
        top: Math.max(destino, 0),
        behavior: "smooth"
    });
}