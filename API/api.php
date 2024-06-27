<?php
// Ruta del archivo JSON donde se guardarán los datos numéricos
$dataFile = 'data.json';

// Datos de usuarios simulados
$users = [
    "12345678-9" => "Juan Perez",
    "98765432-1" => "Maria Rodriguez",
    "11111111-1" => "Carlos Sanchez"
];

// Configuración de la respuesta HTTP
header('Content-Type: application/json');

// Manejo de la solicitud POST
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (isset($_POST['rut'])) {
        // Manejar solicitud para obtener el nombre del usuario por RUT
        $rut = $_POST['rut'];
        if (array_key_exists($rut, $users)) {
            $response = [
                "status" => "success",
                "name" => $users[$rut]
            ];
        } else {
            $response = [
                "status" => "error",
                "message" => "Usuario no encontrado"
            ];
        }
    } elseif (isset($_POST['data'])) {
        // Manejar solicitud para guardar datos numéricos
        $data = json_decode($_POST['data'], true);
        if ($data !== null) {
            if (file_exists($dataFile)) {
                $existingData = json_decode(file_get_contents($dataFile), true);
            } else {
                $existingData = [];
            }
            $existingData[] = $data;
            if (file_put_contents($dataFile, json_encode($existingData, JSON_PRETTY_PRINT))) {
                $response = [
                    "status" => "success",
                    "message" => "Datos guardados correctamente"
                ];
            } else {
                $response = [
                    "status" => "error",
                    "message" => "Error al guardar los datos"
                ];
            }
        } else {
            $response = [
                "status" => "error",
                "message" => "Datos no válidos"
            ];
        }
    } else {
        $response = [
            "status" => "error",
            "message" => "Solicitud no válida"
        ];
    }
    echo json_encode($response);
    exit();
}
?>

<!DOCTYPE html>
<html>
<head>
<title>API Demo</title>
</head>
<body>
<h1>API Demo</h1>
<h2>Obtener Nombre por RUT</h2>
<form method="post" action="api.php">
<label for="rut">RUT:</label>
<input type="text" id="rut" name="rut">
<input type="submit" value="Obtener Nombre">
</form>
<h2>Guardar Datos Numéricos</h2>
<form method="post" action="api.php">
<label for="data">Datos (en formato JSON):</label>
<textarea id="data" name="data" rows="4" cols="50"></textarea>
<input type="submit" value="Guardar Datos">
</form>
</body>
</html>
