// ==========================================
// HELPER UNIVERSAL DE CACHÉ (Stale-While-Revalidate)
// ==========================================
async function cargarConCache(cacheKey, fetchFunction, renderFunction) {
    // 1. Mostrar datos guardados en localStorage al INSTANTE
    const datosGuardados = localStorage.getItem(cacheKey);
    let firmaGuardada = datosGuardados || '';
    if (datosGuardados) {
        try {
            const parsedData = JSON.parse(datosGuardados);
            renderFunction(parsedData, true); // true indica que viene del caché
        } catch (e) {
            console.error("Error al parsear el caché:", e);
        }
    }

    // Sin Internet conservamos exactamente la última versión guardada.
    // No intentamos una petición que sabemos que no podrá completarse.
    if (navigator.onLine === false) return;

    // 2. Buscar datos frescos en Supabase en segundo plano
    try {
        const freshData = await fetchFunction();
        if (freshData !== null && freshData !== undefined) {
            const firmaNueva = JSON.stringify(freshData);
            localStorage.setItem(cacheKey, firmaNueva);

            // Conservamos exactamente la vista ya pintada cuando Supabase
            // devuelve los mismos datos. Solo se repinta si hubo un cambio real.
            if (firmaNueva !== firmaGuardada) {
                renderFunction(freshData, false); // false indica que son datos frescos de la BD
                firmaGuardada = firmaNueva;
            }
        }
    } catch (err) {
        console.error(`Error actualizando segundo plano [${cacheKey}]:`, err);
    }
}
