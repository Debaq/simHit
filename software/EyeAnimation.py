import numpy as np
from PIL import Image
import os
from scipy.ndimage import rotate  # Importa la función de rotación de scipy

class ImageSequence:
    def __init__(self, path_c_i, path_c_d):
        self.c_i = self.load_images(path_c_i)
        self.c_d = self.load_images(path_c_d)
        self.c_c = np.zeros_like(self.c_i[0])  # Supongamos que c_c es una imagen en negro del mismo tamaño

    def load_images(self, path):
        images = []
        for i in range(1, 15):
            img_path = os.path.join(path, f"{i:02d}.png")
            image = Image.open(img_path)
            np_image = np.array(image)
            rotate_image = rotate(np_image, -90, reshape=False)
            images.append(rotate_image)

        return np.array(images)

    def get(self, n):
        if n < -14 or n > 14:
            raise ValueError("n debe estar en el rango de -14 a 14")
        if n == 0:
            return self.c_c
        elif n < 0:
            return self.c_i[abs(n) - 1]
        else:
            return self.c_d[n - 1]

# Ejemplo de uso:
#sequence = ImageSequence('images/c_i', 'images/c_d')
#img = sequence.get(-3)  # Obtiene la tercera imagen de c_i
#print(img)
# img = sequence.get(5)   # Obtiene la quinta imagen de c_d
# img = sequence.get(0)   # Obtiene la imagen c_c (en negro)
