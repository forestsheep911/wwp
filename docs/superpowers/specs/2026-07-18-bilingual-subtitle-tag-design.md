# Bilingual Subtitle Tag Design

## Goal

Represent hard-burned bilingual subtitles as one compact, non-interactive source attribute.

## Decision

- When a variant has multiple subtitle languages, concatenate their existing short labels without `/` separators.
- Example: `zh-Hant` plus `en` renders as `繁英`.
- The compact label is intentionally a fixed file-specification label, not a language switcher.
- Single-language labels and non-subtitle specification separators remain unchanged.

## Scope

The change is limited to the web formatter that produces structured subtitle labels and its unit tests.
