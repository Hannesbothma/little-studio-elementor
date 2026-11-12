<?php
if (!defined('ABSPATH')) {
    exit();
}

/** Machine-readable, user-reviewable failures; never expose PHP traces to the client. */
final class LSE_Import_Error extends RuntimeException
{
    public $details;
    public function __construct($message, $details)
    {
        parent::__construct($message);
        $this->details = $details;
    }
    public static function clip($text, $bytes)
    {
        if (!is_string($text)) {
            return '';
        }
        $end = min(strlen($text), $bytes);
        while (
            $end > 0 &&
            $end < strlen($text) &&
            (ord($text[$end]) & 192) === 128
        ) {
            --$end;
        }
        return substr($text, 0, $end);
    }
    public static function response($error, $stage = '', $input = [])
    {
        $message = $error->getMessage();
        if ($error instanceof self) {
            $details = $error->details;
        } else {
            $code =
                $error instanceof JsonException
                    ? 'invalid_json'
                    : ($error instanceof RuntimeException
                        ? 'import_validation'
                        : 'server_error');
            if (preg_match('/lock|already.*running|busy/i', $message)) {
                $code = 'import_busy';
            } elseif (
                preg_match(
                    '/changed|consent|earlier converter|no longer accepts/i',
                    $message,
                )
            ) {
                $code = 'import_conflict';
            } elseif (
                preg_match(
                    '/permission|session|administrator|signed in/i',
                    $message,
                )
            ) {
                $code = 'import_access';
            }
            $details = [
                'code' => $code,
                'recoverable' => false,
                'retryable' => !in_array(
                    $code,
                    ['import_access', 'invalid_json'],
                    true,
                ),
            ];
        }
        $details['stage'] = $details['stage'] ?? $stage;
        $details['page_key'] = is_string($input['key'] ?? null)
            ? substr($input['key'], 0, 100)
            : '';
        return ['message' => $message, 'error' => $details];
    }
}
