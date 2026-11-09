<?php
// Fahrzeug teilen (#53): Aktionen aus dem Bereich „Geteilt mit“ im Reiter Einstellungen.
// einladen, zurueckziehen, rolle, entfernen (Besitzer) und verlassen (Mitglied). Die Rechte prüft die API.
include '../includes/session.php';
require_once __DIR__ . '/../includes/api_helpers.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST' || !isApiAuthenticated()) {
    header('Location: ../index.php');
    exit;
}
$api = getApiClient();
$fahrzeugId = trim((string)($_POST['fahrzeug_id'] ?? ''));
$aktion = (string)($_POST['aktion'] ?? '');
$zurueck = 'fahrzeug_detail.php?id=' . urlencode($fahrzeugId) . '#einstellungen';

$fehlertexte = [
    'invalid_email' => 'Bitte eine gültige E-Mail-Adresse eingeben.',
    'cannot_invite_self' => 'Dich selbst kannst du nicht einladen.',
    'already_member' => 'Diese Person hat schon Zugriff auf das Fahrzeug.',
    'member_limit_reached' => 'Ein Fahrzeug lässt sich mit höchstens 10 Personen teilen.',
    'too_many_invitations' => 'Heute wurden schon viele Einladungen verschickt. Bitte morgen weitermachen.',
    'invitation_not_found' => 'Diese Einladung gibt es nicht mehr.',
    'member_not_found' => 'Diese Person hat keinen Zugriff (mehr).',
    'owner_cannot_leave' => 'Als Besitzer kannst du das Fahrzeug nicht verlassen, nur löschen.',
];

try {
    if ($aktion === 'einladen') {
        $email = trim((string)($_POST['email'] ?? ''));
        $rolle = ($_POST['role'] ?? '') === 'viewer' ? 'viewer' : 'editor';
        $r = $api->postVehicleInvitation($fahrzeugId, $email, $rolle);
        $_SESSION['success_message'] = !empty($r['mailed'])
            ? 'Einladung an ' . $email . ' verschickt.'
            : 'Einladung für ' . $email . ' angelegt. Sie erscheint nach der Anmeldung mit dieser Adresse unter „Einladungen“.';
    } elseif ($aktion === 'zurueckziehen') {
        $api->deleteVehicleInvitation($fahrzeugId, (string)($_POST['einladung_id'] ?? ''));
        $_SESSION['success_message'] = 'Einladung zurückgezogen.';
    } elseif ($aktion === 'rolle') {
        $api->patchVehicleMember($fahrzeugId, (string)($_POST['user_id'] ?? ''), ($_POST['role'] ?? '') === 'viewer' ? 'viewer' : 'editor');
        $_SESSION['success_message'] = 'Rolle geändert.';
    } elseif ($aktion === 'entfernen') {
        $api->deleteVehicleMember($fahrzeugId, (string)($_POST['user_id'] ?? ''));
        $_SESSION['success_message'] = 'Zugriff entzogen. Bereits erfasste Einträge bleiben beim Fahrzeug.';
    } elseif ($aktion === 'verlassen') {
        $api->deleteVehicleMember($fahrzeugId, 'me');
        $_SESSION['success_message'] = 'Du hast das Fahrzeug verlassen.';
        $zurueck = '../index.php';
    }
} catch (Throwable $e) {
    $_SESSION['error_message'] = tarifHinweis($e) ?? ($fehlertexte[$e->getMessage()] ?? $e->getMessage());
}
header('Location: ' . $zurueck);
exit;
