import numpy as np
from scipy.interpolate import CubicSpline

class Stabilizer:
    def __init__(self, threshold, stabilization_time, post_perturbation_time=0.5):
        self.threshold = threshold
        self.stabilization_time = stabilization_time
        self.post_perturbation_time = post_perturbation_time
        self.reset()

    def reset(self):
        self.previous_value = None
        self.previous_time = None
        self.perturbation_data = []
        self.time = []
        self.angular_velocity = []
        self.movement_direction = None
        self.stabilized = True
        self.stabilization_counter = 0
        self.perturbation_start_time = None
        self.last_perturbation_time = None
        self.recording_finished = False

    def update(self, new_value, current_time):
        value_for_analysis = new_value[0]  # Posición 0 para análisis de comienzo del movimiento
        angular_velocity = new_value[5]    # Posición 5 es la aceleración

        if self.previous_value is None or self.previous_time is None:
            self.previous_value = value_for_analysis
            self.previous_time = current_time
            return

        value_diff = abs(value_for_analysis - self.previous_value)
        time_diff = current_time - self.previous_time

        if value_diff > self.threshold:
            if self.perturbation_start_time is None:
                self.perturbation_start_time = current_time

            if (current_time - self.perturbation_start_time) > self.post_perturbation_time:
                self.recording_finished = True
                return

            self.perturbation_data.append(new_value)
            calibrated_time = current_time - self.perturbation_start_time
            self.time.append(calibrated_time)
            self.angular_velocity.append(angular_velocity)

            # Determinar la dirección del movimiento
            if value_for_analysis > 0:
                self.movement_direction = 'derecha'
            elif value_for_analysis < 0:
                self.movement_direction = 'izquierda'
            else:
                self.movement_direction = 'neutral'

            self.stabilized = False
            self.stabilization_counter = 0
            self.last_perturbation_time = current_time
            self.recording_finished = False
        else:
            self.stabilization_counter += 1
            if self.stabilization_counter >= self.stabilization_time:
                self.stabilized = True
                self.stabilization_counter = 0
                if self.last_perturbation_time and (current_time - self.last_perturbation_time) >= self.post_perturbation_time:
                    self.recording_finished = True
                    self.perturbation_start_time = None  # Reset to allow new perturbations
                    self.last_perturbation_time = None   # Reset to allow new perturbations

        self.previous_value = value_for_analysis
        self.previous_time = current_time

    def clear(self):
        self.reset()

    def is_stabilized(self):
        return self.stabilized

    def get_perturbation_data(self):
        if self.is_recording_finished() and len(self.time) > 2:
            return self.time, self.angular_velocity, self.movement_direction
        else:
            print(f"{self.recording_finished}:::{self.time}")
            return None
    
    def is_recording_finished(self):
        return self.recording_finished



def detect_peak_direction(data):
    """
    Detecta si el mayor pico de una curva es negativo o positivo respecto a su línea base.
    
    Parámetros:
    data (list): Lista de valores numéricos que representan la curva.

    Retorna:
    str: 'positivo' si el mayor pico es positivo respecto a la línea base,
         'negativo' si el mayor pico es negativo respecto a la línea base.
    """
    if not data:
        raise ValueError("La lista de datos no puede estar vacía")

    base_line = data[0]
    max_peak = max(data, key=lambda x: abs(x - base_line))

    if max_peak > base_line:
        return 'negativo'
    else:
        return 'positivo'

def remove_duplicates(x, y):
    """
    Elimina duplicados en x promediando los valores correspondientes en y.
    """
    unique_x, indices = np.unique(x, return_index=True)
    unique_y = np.zeros_like(unique_x)
    
    for i, ux in enumerate(unique_x):
        corresponding_y = [y[j] for j in range(len(x)) if x[j] == ux]
        unique_y[i] = np.mean(corresponding_y)
    
    return unique_x, unique_y

def smooth_curve(x, y, num_points):
    """
    Suaviza una curva utilizando interpolación cúbica.

    Parameters:
    x (list or np.array): Array de tiempos.
    y (list or np.array): Array de valores de la curva.
    num_points (int): Número de puntos en la curva suavizada.

    Returns:
    np.array, np.array: Arrays de tiempos y valores suavizados.
    """
    if not isinstance(x, np.ndarray):
        x = np.array(x)
    if not isinstance(y, np.ndarray):
        y = np.array(y)

    # Eliminar duplicados
    x_unique, y_unique = remove_duplicates(x, y)

    # Crear el interpolador cúbico
    cs = CubicSpline(x_unique, y_unique)

    # Crear un nuevo array de puntos para una curva más suave
    x_new = np.linspace(x_unique.min(), x_unique.max(), num_points)
    y_new = cs(x_new)

    return x_new, y_new