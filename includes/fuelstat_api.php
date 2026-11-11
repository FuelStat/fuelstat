<?php

require_once __DIR__ . '/api_config.php';

/** API-Fehler: Nachricht ist der Fehlercode der API, $detail die optionale Zusatzinfo. */
class FuelstatApiException extends RuntimeException
{
    public ?string $detail;
    /** Vollständige Fehlerantwort der API (z. B. mfaToken bei mfa_required) */
    public array $data;

    public function __construct(string $message, int $code, ?string $detail = null, array $data = [])
    {
        parent::__construct($message, $code);
        $this->detail = $detail;
        $this->data = $data;
    }
}

class FuelstatApi
{
    private string $baseUrl;
    private ?string $token;
    /** GET-Antworten innerhalb eines Seitenaufrufs; wird bei jeder Änderung geleert */
    private array $getCache = [];
    /** Eine curl-Verbindung für alle Aufrufe eines Seitenaufrufs (Keep-alive statt neuem Verbindungsaufbau, #89) */
    private static $curl = null;

    public function __construct(?string $token = null, ?string $baseUrl = null)
    {
        $this->baseUrl = rtrim($baseUrl ?? getApiBaseUrl(), '/');
        $this->token = $token ?? getApiToken();
    }

    public function postAuthLogin(string $email, string $password, ?string $code = null): array
    {
        $payload = ['email' => $email, 'password' => $password];
        if ($code !== null) {
            $payload['code'] = $code;
        }
        return $this->request('POST', '/auth/login', $payload);
    }

    public function postAuthLoginMfa(string $mfaToken, string $code): array
    {
        return $this->request('POST', '/auth/login/mfa', ['mfaToken' => $mfaToken, 'code' => $code]);
    }

    public function postAuthPassword(string $currentPassword, string $newPassword): array
    {
        return $this->request('POST', '/auth/password', ['currentPassword' => $currentPassword, 'newPassword' => $newPassword]);
    }

    /** Fahrtenbuch (#52) */
    public function postTrip(array $data): array { return $this->request('POST', '/trips', $data); }
    public function getTrip(string $tripId): array { return $this->request('GET', '/trips/' . rawurlencode($tripId)); }
    public function patchTrip(string $tripId, array $data): array { return $this->request('PATCH', '/trips/' . rawurlencode($tripId), $data); }
    public function deleteTrip(string $tripId): void { $this->request('DELETE', '/trips/' . rawurlencode($tripId)); }
    public function getVehicleTrips(string $vehicleId, ?int $jahr = null, ?string $zweck = null): array
    {
        $query = http_build_query(array_filter(['year' => $jahr, 'purpose' => $zweck], fn($v) => $v !== null && $v !== ''));
        return $this->request('GET', '/vehicles/' . rawurlencode($vehicleId) . '/trips' . ($query !== '' ? '?' . $query : ''));
    }
    public function getTripSummary(string $vehicleId, ?int $jahr = null): array
    {
        return $this->request('GET', '/vehicles/' . rawurlencode($vehicleId) . '/trips/summary' . ($jahr !== null ? '?year=' . $jahr : ''));
    }
    /** CSV-Export des Fahrtenbuchs (Plus); liefert den Dateiinhalt */
    public function getTripsCsv(string $vehicleId, ?int $jahr = null): string
    {
        $url = $this->baseUrl . '/vehicles/' . rawurlencode($vehicleId) . '/trips/export' . ($jahr !== null ? '?year=' . $jahr : '');
        $ch = curl_init();
        curl_setopt($ch, CURLOPT_URL, $url);
        curl_setopt_array($ch, $this->curlOptionen('GET', ['Accept: text/csv']));
        $body = curl_exec($ch);
        $code = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        curl_close($ch);
        if ($body === false) {
            throw new RuntimeException('API request failed');
        }
        if ($code >= 400) {
            $daten = json_decode((string)$body, true) ?: [];
            throw new FuelstatApiException((string)($daten['error'] ?? 'HTTP ' . $code), $code, null, $daten);
        }
        return (string)$body;
    }

    /** Fahrzeuge teilen (#53) */
    public function getVehicleMembers(string $vehicleId): array { return $this->request('GET', '/vehicles/' . rawurlencode($vehicleId) . '/members'); }
    public function postVehicleInvitation(string $vehicleId, string $email, string $role): array { return $this->request('POST', '/vehicles/' . rawurlencode($vehicleId) . '/invitations', ['email' => $email, 'role' => $role]); }
    public function deleteVehicleInvitation(string $vehicleId, string $invitationId): void { $this->request('DELETE', '/vehicles/' . rawurlencode($vehicleId) . '/invitations/' . rawurlencode($invitationId)); }
    public function patchVehicleMember(string $vehicleId, string $userId, string $role): array { return $this->request('PATCH', '/vehicles/' . rawurlencode($vehicleId) . '/members/' . rawurlencode($userId), ['role' => $role]); }
    public function deleteVehicleMember(string $vehicleId, string $userId): void { $this->request('DELETE', '/vehicles/' . rawurlencode($vehicleId) . '/members/' . rawurlencode($userId)); }
    public function getInvitations(): array { return $this->request('GET', '/invitations'); }
    public function postInvitationAnswer(string $invitationId, bool $annehmen): array { return $this->request('POST', '/invitations/' . rawurlencode($invitationId) . '/' . ($annehmen ? 'accept' : 'decline'), []); }

    /** E-Mail-Bestätigung (#135): Token aus der Mail einlösen (ohne Anmeldung) bzw. Mail erneut senden */
    public function postVerifyEmail(string $token): array { return $this->request('POST', '/auth/verify-email', ['token' => $token]); }
    /** Passwort vergessen (#141) */
    public function postForgotPassword(string $email): array { return $this->request('POST', '/auth/forgot-password', ['email' => $email]); }
    public function postResetPassword(string $token, string $password): array { return $this->request('POST', '/auth/reset-password', ['token' => $token, 'password' => $password]); }
    public function postAcceptTerms(string $version): array { return $this->request('POST', '/auth/accept-terms', ['version' => $version]); }
    public function postResendVerification(): array { return $this->request('POST', '/auth/resend-verification', []); }

    public function postMfaSetup(): array { return $this->request('POST', '/auth/mfa/setup', []); }
    public function postMfaEnable(string $code): array { return $this->request('POST', '/auth/mfa/enable', ['code' => $code]); }
    public function postMfaDisable(string $password, string $code): array { return $this->request('POST', '/auth/mfa/disable', ['password' => $password, 'code' => $code]); }
    public function revokeToken(string $token): array { return $this->request('POST', '/auth/tokens/revoke', ['token' => $token, 'reason' => 'logout']); }
    public function revokeAllTokens(string $userId): array { return $this->request('POST', '/auth/users/' . rawurlencode($userId) . '/revoke-all', ['reason' => 'logout_all']); }
    public function getUsers(): array { return $this->request('GET', '/auth/users'); }
    public function deleteUser(string $userId): void { $this->request('DELETE', '/auth/users/' . rawurlencode($userId)); }
    public function uploadUserMedia(string $filePath, string $mimeType, string $fileName): array
    {
        return $this->request('POST', '/media/upload', null, ['file' => new CURLFile($filePath, $mimeType, $fileName)]);
    }

    /** Registrierung; $termsVersion = zugestimmte Fassung der Nutzungsbedingungen (#135) oder null */
    public function postAuthRegister(string $email, string $password, ?string $termsVersion = null): array
    {
        $daten = ['email' => $email, 'password' => $password];
        if ($termsVersion !== null) {
            $daten['acceptTerms'] = true;
            $daten['termsVersion'] = $termsVersion;
        }
        return $this->request('POST', '/auth/register', $daten);
    }

    /** Kraftstoffsorten und Energiearten (#140), ohne Anmeldung */
    public function getFuels(): array { return $this->request('GET', '/fuels'); }
    public function getVehicles(): array { return $this->request('GET', '/vehicles'); }
    public function getVehicle(string $vehicleId): array { return $this->request('GET', '/vehicles/' . rawurlencode($vehicleId)); }
    public function postVehicle(array $data): array { return $this->request('POST', '/vehicles', $data); }
    public function getVehicleMedia(string $vehicleId): array { return $this->request('GET', '/vehicles/' . rawurlencode($vehicleId) . '/media'); }
    public function deleteVehicleMedia(string $vehicleId, string $mediaId): void { $this->request('DELETE', '/vehicles/' . rawurlencode($vehicleId) . '/media/' . rawurlencode($mediaId)); }
    public function uploadVehicleMedia(string $vehicleId, string $filePath, string $mimeType, string $fileName): array
    {
        return $this->request('POST', '/vehicles/' . rawurlencode($vehicleId) . '/media/upload', null, [
            'file' => new CURLFile($filePath, $mimeType, $fileName),
        ]);
    }
    public function patchVehicle(string $vehicleId, array $data): array { return $this->request('PATCH', '/vehicles/' . rawurlencode($vehicleId), $data); }
    public function deleteVehicle(string $vehicleId): void { $this->request('DELETE', '/vehicles/' . rawurlencode($vehicleId)); }
    public function getVehicleFillups(string $vehicleId, int $limit = 50): array { return $this->request('GET', '/vehicles/' . rawurlencode($vehicleId) . '/fillups?limit=' . $limit); }
    public function getFillup(string $fillupId): array { return $this->request('GET', '/fillups/' . rawurlencode($fillupId)); }
    public function postFillup(array $data): array { return $this->request('POST', '/fillups', $data); }
    public function patchFillup(string $fillupId, array $data): array { return $this->request('PATCH', '/fillups/' . rawurlencode($fillupId), $data); }
    public function deleteFillup(string $fillupId): array { return $this->request('DELETE', '/fillups/' . rawurlencode($fillupId)); }
    public function getVehicleStats(string $vehicleId): array { return $this->request('GET', '/vehicles/' . rawurlencode($vehicleId) . '/stats'); }
    /** Verbrauch, Mengen und CO₂ je Einheit (#82) */
    public function getVehicleConsumption(string $vehicleId): array { return $this->request('GET', '/vehicles/' . rawurlencode($vehicleId) . '/consumption'); }
    /** Kosten je Fahrzeug (#124): Summen, Kosten pro km, Monate; $jahr = null für den gesamten Zeitraum */
    public function getVehicleCosts(string $vehicleId, ?int $jahr = null): array { return $this->request('GET', '/vehicles/' . rawurlencode($vehicleId) . '/costs' . ($jahr !== null ? '?year=' . $jahr : '')); }
    public function getVehicleEntries(string $vehicleId, int $limit = 50): array { return $this->request('GET', '/vehicles/' . rawurlencode($vehicleId) . '/entries?limit=' . $limit); }

    /** Alle Tankfüllungen eines Fahrzeugs (seitenweise geladen, ohne 200er-Grenze). */
    public function getAllVehicleFillups(string $vehicleId): array { return $this->getAllPages('/vehicles/' . rawurlencode($vehicleId) . '/fillups'); }

    /** Alle Ausgaben eines Fahrzeugs (seitenweise geladen, ohne 200er-Grenze). */
    public function getAllVehicleEntries(string $vehicleId): array { return $this->getAllPages('/vehicles/' . rawurlencode($vehicleId) . '/entries'); }

    /**
     * Mehrere GET-Anfragen gleichzeitig stellen und die Antworten vormerken (#89), z. B. Statistik und
     * Fälligkeiten aller Fahrzeuge auf der Übersicht. Spätere request()-Aufrufe derselben Pfade kommen
     * dann aus dem Zwischenspeicher. Fehler werden nicht vorgemerkt: request() fragt dann normal nach.
     * @param string[] $pfade z. B. ['/vehicles/…/stats', '/vehicles/…/reminders']
     */
    public function vorladen(array $pfade): void
    {
        $multi = curl_multi_init();
        $handles = [];
        foreach (array_unique($pfade) as $pfad) {
            $url = $this->baseUrl . '/' . ltrim($pfad, '/');
            if (array_key_exists($url, $this->getCache)) {
                continue;
            }
            $ch = curl_init($url);
            curl_setopt_array($ch, $this->curlOptionen('GET', ['Accept: application/json']));
            curl_multi_add_handle($multi, $ch);
            $handles[$url] = $ch;
        }
        if (!$handles) {
            curl_multi_close($multi);
            return;
        }
        do {
            $status = curl_multi_exec($multi, $laufend);
            if ($laufend) {
                curl_multi_select($multi, 1.0);
            }
        } while ($laufend && $status === CURLM_OK);
        foreach ($handles as $url => $ch) {
            $code = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
            $body = curl_multi_getcontent($ch);
            if ($code >= 200 && $code < 300 && is_string($body)) {
                $daten = json_decode($body, true);
                if (is_array($daten)) {
                    $this->getCache[$url] = $daten;
                }
            }
            curl_multi_remove_handle($multi, $ch);
            curl_close($ch);
        }
        curl_multi_close($multi);
    }

    /** Gemeinsame curl-Optionen (Kopfzeilen inkl. Anmeldung, Zeitlimits) */
    private function curlOptionen(string $method, array $headers): array
    {
        if ($this->token !== null && $this->token !== '') {
            $headers[] = 'Authorization: Bearer ' . $this->token;
        }
        // Client-IP an die API weitergeben (Login-Sperren und Rate-Limits je IP, statt alle Web-Nutzer unter der IP
        // des Servers zu zählen). Die API übernimmt X-Forwarded-For nur von lokalen bzw. privaten Adressen.
        $clientIp = filter_var($_SERVER['REMOTE_ADDR'] ?? '', FILTER_VALIDATE_IP);
        if ($clientIp !== false) {
            $headers[] = 'X-Forwarded-For: ' . $clientIp;
        }
        return [
            CURLOPT_CUSTOMREQUEST => $method,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT => 10,
            CURLOPT_TIMEOUT => 30,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_ENCODING => '',
        ];
    }

    private function getAllPages(string $path): array
    {
        $alle = [];
        $offset = 0;
        do {
            $seite = $this->request('GET', $path . '?limit=200&offset=' . $offset);
            $alle = array_merge($alle, $seite);
            $offset += 200;
        } while (count($seite) === 200);
        return $alle;
    }
    public function postEntry(array $data): array { return $this->request('POST', '/entries', $data); }
    public function postVehicleImport(string $vehicleId, array $fillups, array $entries, bool $dryRun = false): array { return $this->request('POST', '/vehicles/' . rawurlencode($vehicleId) . '/import', ['fillups' => $fillups, 'entries' => $entries] + ($dryRun ? ['dryRun' => true] : [])); }
    public function getEntry(string $entryId): array { return $this->request('GET', '/entries/' . rawurlencode($entryId)); }
    public function patchEntry(string $entryId, array $data): array { return $this->request('PATCH', '/entries/' . rawurlencode($entryId), $data); }
    public function deleteEntry(string $entryId): void { $this->request('DELETE', '/entries/' . rawurlencode($entryId)); }
    public function getCategories(): array { return $this->request('GET', '/categories'); }
    /** Tankstellen bzw. Ladestationen in der Nähe (#123): Fremddienste fragt nur die API, Keys liegen nur dort */
    public function getStations(array $query): array { return $this->request('GET', '/stations?' . http_build_query($query)); }
    public function getChargingStations(array $query): array { return $this->request('GET', '/charging-stations?' . http_build_query($query)); }
    public function postCategory(array $data): array { return $this->request('POST', '/categories', $data); }
    public function patchCategory(string $id, array $data): array { return $this->request('PATCH', '/categories/' . rawurlencode($id), $data); }
    public function deleteCategory(string $id, ?string $moveTo = null): array { return $this->request('DELETE', '/categories/' . rawurlencode($id) . ($moveTo !== null ? '?moveTo=' . rawurlencode($moveTo) : '')); }
    public function getUser(string $userId): array { return $this->request('GET', '/auth/users/' . rawurlencode($userId)); }
    public function patchUser(string $userId, array $data): array { return $this->request('PATCH', '/auth/users/' . rawurlencode($userId), $data); }
    public function getWhoAmI(): array { return $this->request('GET', '/whoami'); }
    public function postAuthRefresh(): array { return $this->request('POST', '/auth/refresh', []); }
    public function getHealth(): array { return $this->request('GET', '/health'); }
    public function getVehicleReminders(string $vehicleId): array { return $this->request('GET', '/vehicles/' . rawurlencode($vehicleId) . '/reminders'); }
    public function getMailSettings(): array { return $this->request('GET', '/auth/mail-settings'); }
    public function putMailSettings(array $data): array { return $this->request('PUT', '/auth/mail-settings', $data); }
    public function postMailTest(): array { return $this->request('POST', '/auth/mail-settings/test', []); }
    public function postMailSendNow(string $type): array { return $this->request('POST', '/auth/mail-settings/send-now', ['type' => $type]); }
    public function putUserBeta(string $userId, bool $betaTester): array { return $this->request('PUT', '/auth/users/' . rawurlencode($userId) . '/beta', ['betaTester' => $betaTester]); }
    public function putUserPlan(string $userId, string $plan, ?string $planUntil): array { return $this->request('PUT', '/auth/users/' . rawurlencode($userId) . '/plan', ['plan' => $plan, 'planUntil' => $planUntil]); }
    public function putPlans(array $userIds, string $plan, ?string $planUntil): array { return $this->request('PUT', '/auth/plans', ['userIds' => array_values($userIds), 'plan' => $plan, 'planUntil' => $planUntil]); }
    public function postFeedback(string $category, string $message, ?string $page): array { return $this->request('POST', '/feedback', ['category' => $category, 'message' => $message, 'page' => $page]); }
    public function getFeedback(): array { return $this->request('GET', '/feedback'); }
    public function patchFeedback(string $id, bool $done): array { return $this->request('PATCH', '/feedback/' . rawurlencode($id), ['done' => $done]); }

    private function request(string $method, string $path, ?array $payload = null, ?array $multipart = null): array
    {
        $url = $this->baseUrl . '/' . ltrim($path, '/');
        if ($method === 'GET' && array_key_exists($url, $this->getCache)) {
            return $this->getCache[$url];
        }
        if ($method !== 'GET') {
            $this->getCache = [];
        }
        // Verbindung wiederverwenden: curl_reset löscht nur die Optionen, nicht die offene Verbindung
        if (self::$curl === null) {
            self::$curl = curl_init();
            if (self::$curl === false) {
                self::$curl = null;
                throw new RuntimeException('curl_init failed');
            }
        } else {
            curl_reset(self::$curl);
        }
        $ch = self::$curl;
        curl_setopt($ch, CURLOPT_URL, $url);

        $headers = ['Accept: application/json'];
        if ($payload !== null) {
            $json = json_encode($payload);
            if ($json === false) {
                throw new RuntimeException('json_encode failed');
            }
            $headers[] = 'Content-Type: application/json';
            curl_setopt($ch, CURLOPT_POSTFIELDS, $json);
        }
        if ($multipart !== null) {
            // curl setzt Content-Type multipart/form-data inkl. Boundary selbst
            curl_setopt($ch, CURLOPT_POSTFIELDS, $multipart);
        }
        curl_setopt_array($ch, $this->curlOptionen($method, $headers));

        $body = curl_exec($ch);
        if ($body === false) {
            $err = curl_error($ch);
            // Verbindung verwerfen, die nächste Anfrage baut eine neue auf
            curl_close($ch);
            self::$curl = null;
            throw new RuntimeException('API request failed: ' . $err);
        }

        $httpCode = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);

        $data = [];
        if ($body !== '') {
            $decoded = json_decode($body, true);
            if (is_array($decoded)) {
                $data = $decoded;
            }
        }

        if ($httpCode >= 400) {
            $message = $data['error'] ?? $data['message'] ?? ('HTTP ' . $httpCode);
            // Ohne Query loggen: sie kann z. B. Koordinaten der Stationssuche enthalten
            error_log('[FuelstatApi] ' . $method . ' ' . strtok($url, '?') . ' => ' . $httpCode . ' ' . (string)$message);
            throw new FuelstatApiException((string)$message, $httpCode, isset($data['detail']) ? (string)$data['detail'] : null, $data);
        }

        if ($method === 'GET') {
            $this->getCache[$url] = $data;
        }
        return $data;
    }
}
