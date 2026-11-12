<?php
if (!defined('ABSPATH')) {
    exit();
}

/** Validate CSS in its syntactic context, and omit only explicitly approved units. */
final class LSE_CSS
{
    private static function decode($value)
    {
        return preg_replace_callback(
            '/\\\\([0-9a-f]{1,6}\s?|[^\r\n\f])|\\\\[\r\n\f]/i',
            static function ($m) {
                if (empty($m[1])) {
                    return '';
                }
                if (!ctype_xdigit(trim($m[1]))) {
                    return $m[1];
                }
                $n = hexdec(trim($m[1]));
                return html_entity_decode(
                    '&#' . ($n ?: 65533) . ';',
                    ENT_NOQUOTES,
                    'UTF-8',
                );
            },
            $value,
        );
    }
    private static function mask($css, &$comments = [])
    {
        $chunks = [];
        $copied = 0;
        $length = strlen($css);
        for ($i = 0; $i < $length; ) {
            if (substr($css, $i, 2) === '/*') {
                $end = strpos($css, '*/', $i + 2);
                $end = $end === false ? $length : $end + 2;
                $comments[] = ['start' => $i, 'end' => $end];
            } elseif ($css[$i] === '"' || $css[$i] === "'") {
                $quote = $css[$i];
                $end = $i + 1;
                while ($end < $length) {
                    if ($css[$end] === '\\') {
                        $end += 2;
                        continue;
                    }
                    if ($css[$end++] === $quote) {
                        break;
                    }
                }
                $end = min($length, $end);
            } elseif ($css[$i] === '\\' && $i + 1 < $length) {
                // Escaped punctuation cannot delimit a CSS statement or string.
                if (str_contains("{};()\\\"'", $css[$i + 1])) {
                    $chunks[] = substr($css, $copied, $i - $copied);
                    $chunks[] = '  ';
                    $copied = $i + 2;
                }
                $i += 2;
                continue;
            } else {
                $i += max(1, strcspn($css, "\"'\\/", $i));
                continue;
            }
            $chunks[] = substr($css, $copied, $i - $copied);
            $chunks[] = str_repeat(' ', $end - $i);
            $copied = $end;
            $i = $end;
        }
        $chunks[] = substr($css, $copied);
        return implode('', $chunks);
    }
    private static function excerpt($text, $start, $bytes)
    {
        $length = strlen($text);
        while (
            $start > 0 &&
            $start < $length &&
            (ord($text[$start]) & 192) === 128
        ) {
            --$start;
        }
        $end = min($length, $start + $bytes);
        while (
            $end > $start &&
            $end < $length &&
            (ord($text[$end]) & 192) === 128
        ) {
            --$end;
        }
        return substr($text, $start, $end - $start);
    }
    private static function quoted_values($text)
    {
        $values = [];
        $length = strlen($text);
        for ($i = 0; $i < $length; ++$i) {
            if ($text[$i] !== '"' && $text[$i] !== "'") {
                continue;
            }
            $quote = $text[$i];
            $start = ++$i;
            while ($i < $length) {
                if ($text[$i] === '\\') {
                    $i += 2;
                    continue;
                }
                if ($text[$i] === $quote) {
                    break;
                }
                ++$i;
            }
            $values[] = substr($text, $start, min($i, $length) - $start);
        }
        return $values;
    }
    public static function inspect($css, $field = 'css')
    {
        if (!is_string($css)) {
            throw new LSE_Import_Error('Generated styles must be CSS text.', [
                'code' => 'css_type',
                'field' => $field,
                'recoverable' => false,
            ]);
        }
        $comments = [];
        $mask = self::mask($css, $comments);
        $units = [];
        $stack = [];
        $start = 0;
        $paren = 0;
        preg_match_all('/[{};()]/', $mask, $delimiters, PREG_OFFSET_CAPTURE);
        foreach ($delimiters[0] as [$char, $offset]) {
            if ($char === '(') {
                ++$paren;
                continue;
            }
            if ($char === ')') {
                $paren = max(0, $paren - 1);
                continue;
            }
            if ($paren) {
                continue;
            }
            if ($char === '{') {
                $label = trim(substr($css, $start, $offset - $start));
                $stack[] = [
                    'start' => $start,
                    'header_end' => $offset,
                    'label' => $label,
                ];
                $start = $offset + 1;
            } elseif ($char === ';') {
                $units[] = [
                    'start' => $start,
                    'end' => $offset + 1,
                    'header_end' => $offset + 1,
                    'label' => end($stack)['label'] ?? '@stylesheet',
                    'declaration' => (bool) $stack,
                ];
                $start = $offset + 1;
            } else {
                if (trim(substr($mask, $start, $offset - $start)) !== '') {
                    $units[] = [
                        'start' => $start,
                        'end' => $offset,
                        'header_end' => $offset,
                        'label' => end($stack)['label'] ?? '@stylesheet',
                        'declaration' => (bool) $stack,
                    ];
                }
                $parent = array_pop($stack);
                if ($parent) {
                    $units[] = $parent + [
                        'end' => $offset + 1,
                        'declaration' => false,
                    ];
                }
                $start = $offset + 1;
            }
        }
        if ($start < strlen($css)) {
            $units[] = [
                'start' => $start,
                'end' => strlen($css),
                'header_end' => strlen($css),
                'label' => '@stylesheet',
                'declaration' => false,
            ];
        }
        $hazards = [];
        // HTML style terminators are unsafe even inside a CSS string/comment when delivered inline.
        preg_match_all('~</?style\b|\x00~i', $css, $html, PREG_OFFSET_CAPTURE);
        foreach ($html[0] as [$token, $offset]) {
            $hazards[] = [$offset, $token, 'HTML/style boundary or null byte'];
        }
        foreach ($units as $unit) {
            $head = substr(
                $mask,
                $unit['start'],
                $unit['header_end'] - $unit['start'],
            );
            $decoded = self::decode($head);
            if (preg_match('/^\s*@import\b/i', $decoded, $m)) {
                $hazards[] = [
                    $unit['start'] + strspn($head, " \t\r\n\f"),
                    $m[0],
                    'External stylesheet import must be packaged first',
                ];
            }
            if (
                $unit['declaration'] &&
                preg_match('/^\s*(?:-moz-binding|behavior)\s*:/i', $decoded, $m)
            ) {
                $hazards[] = [
                    $unit['start'] + strspn($head, " \t\r\n\f"),
                    $m[0],
                    'Legacy executable CSS property',
                ];
            }
        }
        // Only actual URL functions count. Quoted attribute selectors and content text do not.
        // Decode escapes per token below so all diagnostic offsets refer to the original payload.
        preg_match_all(
            '/(?:[a-z_-]|\\\\[0-9a-f]{1,6}\s?|\\\\[^\r\n])+(?=\s*\()/i',
            $mask,
            $functions,
            PREG_OFFSET_CAPTURE,
        );
        foreach ($functions[0] as [$name, $offset]) {
            $function = strtolower(self::decode($name));
            if ($function === 'expression') {
                foreach ($units as $unit) {
                    if (
                        $unit['declaration'] &&
                        $unit['start'] <= $offset &&
                        $unit['end'] > $offset
                    ) {
                        $hazards[] = [
                            $offset,
                            $name,
                            'Executable CSS expression',
                        ];
                        break;
                    }
                }
                continue;
            }
            if (
                !in_array(
                    $function,
                    ['url', 'src', 'image', 'image-set', '-webkit-image-set'],
                    true,
                )
            ) {
                continue;
            }
            $open = strpos($mask, '(', $offset + strlen($name));
            $depth = 1;
            $cursor = $open + 1;
            $end = strlen($mask);
            while (
                preg_match('/[()]/', $mask, $part, PREG_OFFSET_CAPTURE, $cursor)
            ) {
                $depth += $part[0][0] === '(' ? 1 : -1;
                if (!$depth) {
                    $end = $part[0][1];
                    break;
                }
                $cursor = $part[0][1] + 1;
            }
            $arguments = substr($css, $open + 1, $end - $open - 1);
            $values = self::quoted_values($arguments);
            if (
                ($function === 'url' || $function === 'src') &&
                !preg_match('/^\s*[\"\x27]/', $arguments)
            ) {
                $values[] = trim($arguments, " \t\r\n\f\"'");
            }
            foreach ($values as $value) {
                $value = preg_replace(
                    '/[\x00-\x20\x7f]+/',
                    '',
                    self::decode($value),
                );
                if (
                    preg_match(
                        '~^(?:javascript:|vbscript:|data:(?:text/html|application/(?:xhtml\+xml|javascript)))~i',
                        $value,
                        $match,
                    )
                ) {
                    $hazards[] = [$offset, $match[0], 'Executable URL in CSS'];
                    break;
                }
            }
        }

        usort($hazards, static fn($a, $b) => $a[0] <=> $b[0]);
        $issues = [];
        foreach ($hazards as [$offset, $token, $reason]) {
            $candidates = array_filter(
                $units,
                static fn($u) => $u['start'] <= $offset && $u['end'] > $offset,
            );
            usort(
                $candidates,
                static fn($a, $b) => $a['end'] - $a['start'] <=>
                    $b['end'] - $b['start'],
            );
            $unit = !$stack && !$paren ? $candidates[0] ?? null : null;
            // A terminator in a standalone comment can be removed without touching adjacent rules.
            if (substr($css, $offset, 1) === '<') {
                foreach ($comments as $comment) {
                    if (
                        $comment['start'] <= $offset &&
                        $comment['end'] > $offset
                    ) {
                        $unit = $comment + [
                            'label' => 'CSS comment',
                            'declaration' => true,
                        ];
                        break;
                    }
                }
            }
            $line = substr_count(substr($css, 0, $offset), "\n") + 1;
            $last = strrpos(substr($css, 0, $offset), "\n");
            $column =
                preg_match_all(
                    '/./us',
                    substr(
                        $css,
                        $last === false ? 0 : $last + 1,
                        $offset - ($last === false ? 0 : $last + 1),
                    ),
                ) + 1;
            $id = $unit
                ? hash(
                    'sha256',
                    $field .
                        ':' .
                        $unit['start'] .
                        ':' .
                        substr(
                            $css,
                            $unit['start'],
                            $unit['end'] - $unit['start'],
                        ),
                )
                : '';
            if (isset($issues[$id ?: 'unscoped'])) {
                continue;
            }
            $issues[$id ?: 'unscoped'] = [
                'code' => 'css_unsafe',
                'field' => $field,
                'line' => $line,
                'column' => $column,
                'token' => trim($token),
                'reason' => $reason,
                'selector' => self::excerpt($unit['label'] ?? '', 0, 240),
                'snippet' => self::excerpt($css, max(0, $offset - 100), 360),
                'recoverable' => (bool) $unit,
                'skip' => $unit
                    ? [
                        'kind' => 'css',
                        'id' => $id,
                        'field' => $field,
                        'start' => $unit['start'],
                        'end' => $unit['end'],
                        'label' => $unit['declaration']
                            ? 'CSS declaration'
                            : 'CSS rule',
                    ]
                    : null,
            ];
        }
        return array_values($issues);
    }
    public static function clean(
        $css,
        $field = 'css',
        $approved = [],
        &$skipped = [],
    ) {
        if (!is_array($approved)) {
            throw new RuntimeException(
                'Skipped CSS references must be a list.',
            );
        }
        foreach ($approved as $id) {
            if (!is_string($id) || !preg_match('/^[a-f0-9]{64}$/D', $id)) {
                throw new RuntimeException('Invalid skipped CSS reference.');
            }
        }
        $issues = self::inspect($css, $field);
        $ranges = [];
        foreach ($issues as $issue) {
            if (
                !$issue['skip'] ||
                !in_array($issue['skip']['id'], $approved, true)
            ) {
                throw new LSE_Import_Error(
                    'Unsafe CSS was rejected: ' .
                        $issue['reason'] .
                        ' in ' .
                        $field .
                        ', line ' .
                        $issue['line'] .
                        ', column ' .
                        $issue['column'] .
                        '.',
                    $issue,
                );
            }
            $ranges[$issue['skip']['id']] = $issue['skip'];
            $skipped[] = $issue;
        }
        usort($ranges, static fn($a, $b) => $a['start'] <=> $b['start']);
        $merged = [];
        foreach ($ranges as $range) {
            $i = count($merged) - 1;
            if ($i >= 0 && $range['start'] <= $merged[$i]['end']) {
                $merged[$i]['end'] = max($merged[$i]['end'], $range['end']);
            } else {
                $merged[] = $range;
            }
        }
        foreach (array_reverse($merged) as $range) {
            $css = substr_replace(
                $css,
                '',
                $range['start'],
                $range['end'] - $range['start'],
            );
        }
        // A skipped outer rule can include another flagged declaration: revalidate the result.
        if ($ranges && self::inspect($css, $field)) {
            throw new LSE_Import_Error(
                'CSS still needs review after skipping this item.',
                [
                    'code' => 'css_remaining',
                    'field' => $field,
                    'recoverable' => false,
                ],
            );
        }
        return $css;
    }
}
