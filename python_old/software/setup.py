from setuptools import setup
import nuitka_distutils

setup(
    name="MiAplicacion",
    version="1.0",
    description="Mi aplicación PySide6",
    author="Tu Nombre",
    author_email="tuemail@example.com",
    packages=["modulos"],  # Asegúrate de incluir todos los paquetes necesarios
    install_requires=[
        "numpy",
        "pandas",
        "pyqtgraph",
        "pyserial",
        "PySide6",
        "Pillow",
        "scipy"
    ],
    entry_points={
        "console_scripts": [
            "miaplicacion = main:main",  # Asumiendo que tienes una función main en main.py
        ]
    },
    options={
        "bdist_nuitka": {
            "standalone": True,
            "onefile": True,
            "plugin-enable": ["pyside6"],
            "windows-icon-from-ico": "images/128.ico"
        }
    }
)
