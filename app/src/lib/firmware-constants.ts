// Constantes que deben coincidir con el firmware (firmware/simhit/simhit.ino).
//
// El firmware es la fuente de verdad: si cambia SAMPLE_RATE_HZ alla, hay que
// cambiarlo aca. Antes el valor estaba repetido literal en cuatro archivos del
// cliente (simulator, metricas, synthetic y la validacion de hardware), asi
// que tocar el ODR obligaba a acordarse de los cuatro.

/** ODR del stream del firmware, en Hz. Espejo de SAMPLE_RATE_HZ en simhit.ino. */
export const FIRMWARE_SAMPLE_RATE_HZ = 200;

/** Periodo entre muestras del firmware, en segundos. */
export const FIRMWARE_SAMPLE_DT_S = 1 / FIRMWARE_SAMPLE_RATE_HZ;
