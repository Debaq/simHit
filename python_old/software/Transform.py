def transform_scale(value, original_max=30, new_max=14):
    """
    Transforma un valor de la escala original (-∞ a +∞) a la nueva escala (-14 a +14).

    Parameters:
    value (float): El valor en la escala original.
    original_max (float): El valor máximo positivo en la escala original (por defecto es 55).
    new_max (int): El valor máximo en la nueva escala (por defecto es 14).

    Returns:
    int: El valor transformado en la nueva escala.
    """
    # Verificar y ajustar los límites
    if value >= original_max:
        return new_max
    elif value <= -original_max:
        return -new_max

    # Calcular el valor en la nueva escala
    new_value = (value / original_max) * new_max

    # Redondear al entero más cercano
    return int(round(new_value))

